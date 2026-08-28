/**
 * IS THIS THING ACTUALLY WORKING.
 *
 * Two questions with two different audiences, which is why they are two
 * routes and not one with a `?verbose`:
 *
 *   GET /health     a load balancer, every few seconds, no key
 *   GET /v1/stats   a creator or an operator, occasionally, with a key
 *
 * ---------------------------------------------------------------------------
 * WHY /health IS PUBLIC
 * ---------------------------------------------------------------------------
 *
 * A health check behind auth is useless to the thing that needs it. A load
 * balancer holds no API key, so an authenticated `/health` answers 401 forever
 * and every instance is marked dead -- or, worse, the balancer is taught to
 * treat 401 as healthy and the check stops checking anything. It is safe to be
 * public because it says nothing: two booleans, a version, and an uptime. No
 * paths, no counts, no env, no world name.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DOES WORK RATHER THAN RETURNING 200
 * ---------------------------------------------------------------------------
 *
 * `res.end('ok')` proves the event loop is turning, which was never in doubt.
 * The failures that actually take this process down are the database handle
 * being closed or corrupt and the volume going read-only after a deploy -- so
 * those are the two things checked, and both are cheap enough to poll.
 *
 * ---------------------------------------------------------------------------
 * MOUNTING (in `src/pieces/api.ts`, in `route()`)
 * ---------------------------------------------------------------------------
 *
 *     // before the `denied()` block -- public
 *     if (method === "GET" && path === "/health") {
 *       const h = health(this.repo);
 *       return json(res, h.ok ? 200 : 503, h);
 *     }
 *     // after it -- authenticated
 *     if (method === "GET" && path === "/v1/stats") {
 *       if (deny) return closed();
 *       return json(res, 200, stats(this.repo, { subscribers: this.live.subscribers }));
 *     }
 *
 * These return plain objects rather than writing to a `ServerResponse`: the
 * http helpers (`json`, `denied`) are private to that file, and a handler
 * exported from here would either duplicate them or force them to be shared.
 * A pure function is also testable without binding a port.
 */

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { CanonRepo } from "../canon/repo.js";
import { MAX_ATTEMPTS } from "../notify/contract.js";
import { dbFile } from "./backup.js";

export interface HealthReport {
  /** False means 503. A caller with a load balancer needs the status code. */
  ok: boolean;
  checks: {
    /** The handle answers SQL. Closed, locked or corrupt all land here. */
    db: boolean;
    /** The directory holding the database still accepts writes. */
    disk: boolean;
  };
  version: string;
  uptime_s: number;
}

export interface StatsOptions {
  /**
   * `LiveHub.subscribers`. Passed in rather than imported so this file does not
   * make an ops report depend on the SSE implementation -- and so a second
   * caller with no hub at all still gets numbers.
   */
  subscribers?: number;
  /** Override the version read from package.json. */
  version?: string;
}

export interface StatsReport {
  world: string;
  /** Which Mind is authoring this history, per `clock_host`. Null before a run. */
  host: string | null;
  pieces: { total: number; open: number; extensions: number; contributors: number };
  /** Delivery state, not canon. See `src/notify/contract.ts`. */
  notifications: { pending: number; sent: number; failed: number };
  live_subscribers: number;
  /** Rows in the append-only log. */
  events: number;
  db: {
    /** Main file. 0 for `:memory:`. Never the path -- that leaks the layout. */
    bytes: number;
    /** The WAL, which on a busy world is not a rounding error. */
    wal_bytes: number;
    schema_version: number;
    on_disk: boolean;
  };
  uptime_s: number;
  version: string;
}

/**
 * Cheap enough to poll at 1Hz: one trivial statement and one `access(2)`.
 *
 * Never throws. A health check that can 500 is a health check that reports
 * "unknown" as "down" through a stack trace, and the stack trace is the part
 * that ends up in a public response body.
 */
export function health(repo: CanonRepo): HealthReport {
  let db = false;
  let file = "";
  try {
    // Not `SELECT COUNT(*)` off a real table: this must stay O(1) whatever
    // the log grows to. It only has to prove the handle round-trips.
    repo.db.prepare("SELECT 1 AS ok").get();
    file = dbFile(repo);
    db = true;
  } catch {
    db = false;
  }

  const disk = diskWritable(file);
  return {
    ok: db && disk,
    checks: { db, disk },
    version: version(),
    uptime_s: Math.round(process.uptime()),
  };
}

/**
 * The numbers a creator or an operator would ask for, in six indexed queries.
 *
 * READ-ONLY and NO HOST CALLS. This gets polled by a dashboard; a stats route
 * that spent an invocation would burn the daily cognition budget on nobody
 * looking at anything.
 */
export function stats(repo: CanonRepo, opts: StatsOptions = {}): StatsReport {
  const d = repo.db;

  const p = d
    .prepare("SELECT COUNT(*) AS total, SUM(status = 'open') AS open FROM pieces")
    .get() as { total: number; open: number | null };

  /**
   * Distinct PEOPLE, from the pieces table rather than the log. `contributors`
   * is already the deduplicated set per piece, so this is a scan of tens of
   * rows instead of a `DISTINCT` over every `piece_extended` event ever
   * written.
   */
  const c = d
    .prepare("SELECT COUNT(DISTINCT j.value) AS c FROM pieces, json_each(pieces.contributors) j")
    .get() as { c: number };

  /**
   * `idx_events_type` means this touches only the matching index entries, not
   * the log. ponytail: still O(extensions). If that ever stops being instant,
   * the number is a counter in `meta`, not a faster query.
   */
  const x = d
    .prepare("SELECT COUNT(*) AS c FROM events WHERE type = 'piece_extended'")
    .get() as { c: number };

  /**
   * `MAX(seq)` IS the row count, and it is an index lookup rather than a full
   * count: `seq` is assigned `MAX+1` on append and the table refuses DELETE at
   * the trigger level, so the sequence has no holes to account for.
   */
  const events = repo.maxSeq();

  /**
   * FAILED means given up on, not "errored once" -- the dispatcher retries, so
   * a row with an error and two attempts is still pending and saying otherwise
   * would page somebody about a mail server that already recovered. The
   * threshold is imported rather than re-declared so it cannot drift from the
   * dispatcher's own queue query.
   */
  const n = d
    .prepare(
      `SELECT SUM(sent_ts IS NOT NULL)                        AS sent,
              SUM(sent_ts IS NULL AND attempts <  @max)       AS pending,
              SUM(sent_ts IS NULL AND attempts >= @max)       AS failed
         FROM notifications`,
    )
    .get({ max: MAX_ATTEMPTS }) as { sent: number | null; pending: number | null; failed: number | null };

  const file = dbFile(repo);
  return {
    world: repo.getMeta("world_name") ?? "the world",
    host: repo.getMeta("clock_host") ?? null,
    pieces: {
      total: p.total,
      open: p.open ?? 0,
      extensions: x.c,
      contributors: c.c,
    },
    notifications: { pending: n.pending ?? 0, sent: n.sent ?? 0, failed: n.failed ?? 0 },
    live_subscribers: opts.subscribers ?? 0,
    events,
    db: {
      bytes: size(file),
      // The WAL is where the newest commits are until a checkpoint. An
      // operator watching disk needs it counted, not assumed to be small.
      wal_bytes: size(file && `${file}-wal`),
      schema_version: d.pragma("user_version", { simple: true }) as number,
      on_disk: file !== "",
    },
    uptime_s: Math.round(process.uptime()),
    version: opts.version ?? version(),
  };
}

/**
 * ponytail: `access(W_OK)`, not a real write-and-unlink. It catches what
 * actually happens -- a read-only remount, wrong ownership after a deploy,
 * a volume that failed to mount -- for the cost of one syscall, and this is on
 * the polled path. It does NOT catch a full disk. If ENOSPC ever becomes a
 * real incident here, write one byte to a temp file instead and pay for it.
 *
 * An empty path is `:memory:`: there is no disk to be unwritable, so this is
 * vacuously true rather than a failure.
 */
function diskWritable(file: string): boolean {
  if (!file) return true;
  try {
    accessSync(dirname(file), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function size(path: string): number {
  if (!path || !existsSync(path)) return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Read once, not per request. `/health` is polled, and an fs read per poll is
 * the sort of thing that is invisible until it is the top of a flame graph.
 * `createRequire` rather than a JSON import so the build has no opinion about
 * whether package.json is an emitted module.
 */
let cachedVersion: string | undefined;
function version(): string {
  if (cachedVersion === undefined) {
    try {
      const pkg = createRequire(import.meta.url)("../../package.json") as { version?: string };
      cachedVersion = pkg.version ?? "0.0.0";
    } catch {
      cachedVersion = "0.0.0";
    }
  }
  return cachedVersion;
}
