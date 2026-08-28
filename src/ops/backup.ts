/**
 * THE FILE THAT CANNOT BE REGENERATED.
 *
 * Everything else in this repo is code: delete it, `git checkout`, carry on.
 * `canon.db` is the one artefact with no upstream -- a month of accumulated
 * history, and the whole pitch is that accumulated time cannot be compressed
 * after the fact.
 *
 * ---------------------------------------------------------------------------
 * WHY `VACUUM INTO` AND NOT `copyFileSync`
 * ---------------------------------------------------------------------------
 *
 * `scripts/clock.ts` copies the file. That is wrong twice over on a WAL
 * database, and both failures are silent:
 *
 *   1. The newest commits live in `canon.db-wal` until a checkpoint moves
 *      them. Copying `canon.db` alone captures the database as of the last
 *      checkpoint and loses everything since -- which is exactly the recent
 *      history you took the backup for. This bug has already bitten this
 *      project once.
 *   2. A copy taken while a writer is mid-transaction captures a torn page
 *      set. The file opens. It just fails `PRAGMA quick_check`, and you find
 *      out on the day you need it.
 *
 * `VACUUM INTO` runs inside a read transaction against a live database: it
 * sees one consistent snapshot including the WAL, and writes a single
 * defragmented file with no sidecars. Rejected alternatives: `sqlite3 .backup`
 * (a second binary to depend on), better-sqlite3's `db.backup()` (correct, but
 * async and page-stepped for a file this size there is nothing to gain), and
 * "just checkpoint first then copy" (still races the next writer).
 *
 * ---------------------------------------------------------------------------
 * RESTORING
 * ---------------------------------------------------------------------------
 *
 * There is deliberately no `restore()` here. A restore is destructive, happens
 * roughly never, and wants a human reading the output of `verifyBackup` before
 * anything is overwritten -- a function that does it in one call is a function
 * somebody calls by accident. The procedure, which is three shell lines:
 *
 *     1. stop the writer (the clock holds `canon.db.clock.lock`)
 *     2. mv data/canon.db{,-wal,-shm} /tmp/                # keep, do not delete
 *     3. cp data/backups/canon-<stamp>.db data/canon.db    # no -wal to copy:
 *                                                          # VACUUM INTO output
 *                                                          # has none
 *
 * Step 2 keeps the old file because a backup restored over a live database is
 * how you lose both copies.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CanonRepo } from "../canon/repo.js";

/** Matches `scripts/clock.ts`, on purpose -- see `prune`. */
const KEEP_DEFAULT = 12;
const PREFIX = "canon-";
const SUFFIX = ".db";

export interface BackupOptions {
  /** Default: a `backups/` directory beside the database, as the clock uses. */
  dir?: string;
  /** How many to keep, newest first. Clamped to >= 1. */
  keep?: number;
}

export interface BackupResult {
  /**
   * Absolute path of the file written. For an operator's terminal, NOT for an
   * HTTP response -- it leaks the deployment's directory layout, which is why
   * `/v1/stats` reports sizes and never paths.
   */
  path: string;
  bytes: number;
  /** How many old backups the rotation deleted. */
  pruned: number;
  ms: number;
}

export interface VerifyResult {
  ok: boolean;
  events: number;
  pieces: number;
  schema_version: number;
  /** Present only when `ok` is false. */
  error?: string;
}

/**
 * Where this repo's database actually lives, `""` for `:memory:`.
 *
 * Asked of SQLite rather than threaded down from config, because the answer
 * has to be true for the connection in hand -- a path argument that has drifted
 * from the open handle would back up the wrong world and report success.
 */
export function dbFile(repo: CanonRepo): string {
  const rows = repo.db.pragma("database_list") as { name: string; file: string }[];
  return rows.find((r) => r.name === "main")?.file ?? "";
}

/**
 * Snapshot the database, then rotate.
 *
 * Returns null for `:memory:`. `VACUUM INTO` would in fact succeed there, but
 * an in-memory database has no durable home to protect and no obvious place to
 * put the file -- a rotation of backups of a test fixture is pure noise. Tests
 * and the demo scripts get a no-op instead of a thrown error.
 */
export function backup(repo: CanonRepo, opts: BackupOptions = {}): BackupResult | null {
  const file = dbFile(repo);
  if (!file) return null;

  const dir = opts.dir ?? join(dirname(file), "backups");
  const keep = Math.max(1, opts.keep ?? KEEP_DEFAULT);
  mkdirSync(dir, { recursive: true });

  const started = Date.now();
  const target = freeTarget(dir);
  // Bound parameter, not string interpolation: the path can contain a quote
  // and SQL injection through your own backup filename is a stupid way to go.
  repo.db.prepare("VACUUM INTO ?").run(target);

  return {
    path: target,
    bytes: statSync(target).size,
    pruned: prune(dir, keep),
    ms: Date.now() - started,
  };
}

/**
 * Does this backup open, and does it hold a plausible world?
 *
 * `quick_check` is the part that matters: it is what a torn `copyFileSync`
 * snapshot fails, and it is the difference between having a backup and
 * believing you have one. Full `integrity_check` reads every page and every
 * index; `quick_check` skips the index cross-checks and catches the structural
 * damage this failure mode actually produces.
 *
 * Read-only and `fileMustExist`, so verifying a path typo creates an empty
 * database and cheerfully reports zero rows instead of failing.
 */
export function verifyBackup(path: string): VerifyResult {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const check = db.pragma("quick_check", { simple: true }) as string;
    const events = (db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
    /**
     * A backup older than schema 3 has no `pieces` table, and that is not a
     * fault -- it is a good backup of an earlier world. Counting it as an
     * error reported ok:false for every snapshot taken before the pieces
     * layer existed, which is worse than having no check at all: a verifier
     * that cries wolf teaches you to ignore it on the day it is right.
     *
     * `quick_check` is the integrity signal. This is a row count.
     */
    const hasPieces =
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pieces'")
        .get() !== undefined;
    const pieces = hasPieces
      ? (db.prepare("SELECT COUNT(*) AS c FROM pieces").get() as { c: number }).c
      : 0;
    const schema_version = db.pragma("user_version", { simple: true }) as number;
    return check === "ok"
      ? { ok: true, events, pieces, schema_version }
      : { ok: false, events, pieces, schema_version, error: `quick_check: ${check}` };
  } catch (e) {
    return { ok: false, events: 0, pieces: 0, schema_version: 0, error: (e as Error).message };
  } finally {
    db?.close();
  }
}

/**
 * ISO stamps sort lexically in chronological order, so "oldest first" is
 * `.sort()` and needs no stat per file.
 *
 * The name matches `scripts/clock.ts`'s so the two rotations are ONE rotation:
 * a boot copy from the clock and a snapshot from here land in the same
 * directory and prune each other, rather than each keeping its own twelve.
 */
function prune(dir: string, keep: number): number {
  const old = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .sort()
    .slice(0, -keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return old.length;
}

/**
 * `VACUUM INTO` refuses to overwrite, and two backups inside the same
 * millisecond would otherwise turn that refusal into a thrown error on a
 * perfectly reasonable call.
 *
 * ponytail: no lock file here, unlike the clock's. Concurrent clocks corrupt
 * pacing and the invocation budget; concurrent backups just waste a little IO,
 * because the targets are unique and `rmSync(force)` makes a prune race
 * harmless. Add one if backups ever get big enough that two at once matters.
 */
function freeTarget(dir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const at = (n: number): string =>
    join(dir, `${PREFIX}${stamp}${n ? `-${n}` : ""}${SUFFIX}`);
  let n = 0;
  while (existsSync(at(n)) && n < 100) n++;
  return at(n);
}
