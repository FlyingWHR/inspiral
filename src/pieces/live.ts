/**
 * WHO IS HERE, AND WHAT JUST CHANGED.
 *
 * Two things a piece page cannot get from canon, for the same reason: canon is
 * the permanent record and both of these are about *now*.
 *
 * ---------------------------------------------------------------------------
 * PRESENCE IS NOT WRITTEN DOWN
 * ---------------------------------------------------------------------------
 *
 * "ada is looking at this" is true for ninety seconds and worth citing never.
 * Appending it to a log whose whole value is that every row in it is worth
 * citing would bury the rows that are. So presence lives in this process's
 * memory, is lost on restart, and that is correct -- a restart means nobody is
 * connected anyway, so the empty state after one is the accurate state.
 *
 * ---------------------------------------------------------------------------
 * SSE, NOT WEBSOCKETS
 * ---------------------------------------------------------------------------
 *
 * Everything here flows server -> client: somebody extended a piece, somebody
 * arrived, somebody left. The browser's half of a WebSocket would carry
 * nothing, and buying it costs a dependency (`ws`), a second protocol for
 * proxies to mishandle, and a reconnect loop to write by hand. `text/event-
 * stream` is a `res.write()` on the http server that is already running, and
 * `EventSource` reconnects on its own.
 *
 * The one real cost is that SSE holds a connection open per viewer, which is
 * why there is a cap (see `maxClients`) rather than an unbounded Set.
 */

import type { ServerResponse } from "node:http";
import type { Piece, Presence, SpaceView } from "./contract.js";

/**
 * What goes down the wire. A union rather than `Record<string, unknown>` so the
 * caller cannot publish an event missing the fields a frontend needs to update
 * without refetching the whole page -- which is the entire point of pushing it.
 *
 * Type names match the canon event types (`piece_seeded`, `piece_extended`) on
 * purpose: one vocabulary from the log to the browser, so nobody has to hold a
 * translation table in their head at 3am.
 */
export type LiveEvent =
  | { type: "piece_seeded"; piece_id: string; title: string }
  | {
      type: "piece_extended";
      piece_id: string;
      event_id: string;
      fan_id: string;
      display_name: string;
      /** Post-extension depth, so a client can render it without a refetch. */
      generation: number;
      /** The Mind's sentence. Absent when the host was unavailable. */
      changed?: string;
    }
  | { type: "presence"; piece_id: string; here: Presence["here"] };

export interface LiveHubOptions {
  /**
   * How long somebody stays present after their last sign of life. A browser
   * that closes without saying goodbye must not haunt a piece forever, and 60s
   * is long enough that a client heartbeating every ~20s survives one lost
   * request.
   */
  ttlMs?: number;
  /**
   * Comment heartbeat interval. Idle connections get reaped by proxies and by
   * some mobile radios; a `: ping` costs nine bytes and keeps them open. Also
   * the only sweep that runs on its own -- see `pulse`.
   */
  heartbeatMs?: number;
  /**
   * Concurrent SSE clients. When full the OLDEST is dropped, not the newest:
   * the oldest connection is the most likely to be an abandoned tab, and
   * refusing the newcomer would mean the person actually here is the one who
   * gets nothing. EventSource reconnects, so a wrongly-dropped client comes
   * back.
   */
  maxClients?: number;
  /**
   * Wall-clock milliseconds, injectable for tests.
   *
   * Deliberately NOT the world `Clock`. Presence expiry is about real seconds
   * of a real person's attention; under a VirtualClock -- which a demo may hold
   * still or run at 100x -- a stale tab would either haunt a piece forever or
   * vanish mid-sentence.
   */
  now?: () => number;
}

interface Here {
  display_name: string;
  /** When they first arrived. Not reset by a second tab or a heartbeat. */
  since: number;
  /** Last sign of life. What expiry is measured against. */
  last: number;
}

interface Client {
  res: ServerResponse;
  /** Only this piece's events, or null for everything (a space view). */
  piece: string | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class LiveHub {
  private readonly rooms = new Map<string, Map<string, Here>>();
  /** A Set, because insertion order IS age order -- "drop the oldest" is `.next()`. */
  private readonly clients = new Set<Client>();
  private timer: NodeJS.Timeout | null = null;

  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  private readonly maxClients: number;
  private readonly now: () => number;

  constructor(opts: LiveHubOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.heartbeatMs = opts.heartbeatMs ?? 25_000;
    this.maxClients = opts.maxClients ?? 200;
    this.now = opts.now ?? Date.now;
  }

  // -------------------------------------------------------------------------
  // PRESENCE
  // -------------------------------------------------------------------------

  /**
   * Somebody has the piece open. Also the heartbeat: calling it again refreshes
   * their last-seen, so there is no second `ping()` method to forget to call and
   * no way for a page that is heartbeating to still be considered gone.
   *
   * Distinct by fan_id. The same person in two tabs is one person present --
   * counting them twice would make a room look busier than it is, which is the
   * first step toward the manufactured activity this product must never have.
   */
  join(pieceId: string, fanId: string, displayName = ""): Presence {
    let people = this.rooms.get(pieceId);
    if (!people) this.rooms.set(pieceId, (people = new Map()));

    const t = this.now();
    const existing = people.get(fanId);
    people.set(fanId, {
      display_name: displayName || existing?.display_name || fanId,
      since: existing?.since ?? t,
      last: t,
    });

    const p = this.presence(pieceId);
    // Only news when the room actually changed shape. A heartbeat from somebody
    // already here is not an arrival and must not wake every other client up.
    if (!existing) this.publish({ type: "presence", piece_id: pieceId, here: p.here });
    return p;
  }

  /** They closed the tab and said so. The polite path; expiry is the other one. */
  leave(pieceId: string, fanId: string): Presence {
    const people = this.rooms.get(pieceId);
    const was = people?.delete(fanId) ?? false;
    if (people && people.size === 0) this.rooms.delete(pieceId);
    const p = this.presence(pieceId);
    if (was) this.publish({ type: "presence", piece_id: pieceId, here: p.here });
    return p;
  }

  /**
   * Who is here right now, stale entries already gone.
   *
   * Sweeping on read rather than on a timer: the answer is only wrong when
   * somebody is looking, and a timer that fires whether or not anybody cares is
   * a process that will not exit. (The heartbeat timer sweeps too, but only
   * while there are subscribers to tell.)
   */
  presence(pieceId: string): Presence {
    this.expire(pieceId);
    const people = this.rooms.get(pieceId);
    return {
      piece_id: pieceId,
      here: [...(people?.entries() ?? [])].map(([fan_id, h]) => ({
        fan_id,
        display_name: h.display_name,
        since: iso(h.since),
      })),
    };
  }

  /** How many distinct people are on this piece. The number a space view draws. */
  count(pieceId: string): number {
    this.expire(pieceId);
    return this.rooms.get(pieceId)?.size ?? 0;
  }

  /**
   * A space, in one call. Takes the pieces rather than a repo: which pieces are
   * in a space is the caller's question (open? placed in this room?), and
   * teaching this file to answer it would make an in-memory presence cache
   * depend on the database.
   */
  spaceView(world: string, pieces: Piece[]): SpaceView {
    return { world, pieces: pieces.map((p) => ({ ...p, here: this.count(p.piece_id) })) };
  }

  /** Drop anyone whose last sign of life is older than the TTL. */
  private expire(pieceId?: string): string[] {
    const cutoff = this.now() - this.ttlMs;
    const changed: string[] = [];
    for (const [id, people] of this.rooms) {
      if (pieceId !== undefined && id !== pieceId) continue;
      let dropped = false;
      for (const [fan, h] of people) {
        if (h.last <= cutoff) {
          people.delete(fan);
          dropped = true;
        }
      }
      if (people.size === 0) this.rooms.delete(id);
      if (dropped) changed.push(id);
    }
    return changed;
  }

  // -------------------------------------------------------------------------
  // THE FEED
  // -------------------------------------------------------------------------

  /** Open connections. Exposed for the cap test and for an ops line. */
  get subscribers(): number {
    return this.clients.size;
  }

  /**
   * Register an SSE client. Never resolves anything -- the response stays open
   * until the browser goes away or `close()` runs.
   */
  subscribe(res: ServerResponse, opts: { piece?: string | null } = {}): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx buffers proxied responses by default, which turns a live feed
      // into a feed that arrives all at once when the connection closes.
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();

    const client: Client = { res, piece: opts.piece ?? null };
    this.clients.add(client);

    // The stream must say something immediately or `EventSource.onopen` waits
    // on the first real event, and a piece nobody is extending never has one.
    // `retry` sets the browser's reconnect backoff; the default is unspecified.
    res.write("retry: 3000\n: open\n\n");

    if (this.clients.size > this.maxClients) {
      const oldest = this.clients.values().next().value;
      if (oldest && oldest !== client) this.drop(oldest, true);
    }

    // Cleanup on disconnect. Without this the Set grows for the lifetime of the
    // process and `publish` writes to dead sockets forever.
    res.on("close", () => this.drop(client, false));
    this.startPulse();
  }

  /**
   * Fan out. Best-effort by design: a client whose socket has gone is dropped
   * rather than retried, because there is no queue here and inventing one would
   * mean deciding how long to hold a "somebody is here" that stopped being true.
   */
  publish(event: LiveEvent): void {
    if (this.clients.size === 0) return;
    const frame = `data: ${JSON.stringify({ ...event, ts: iso(this.now()) })}\n\n`;
    for (const c of this.clients) {
      if (c.piece && c.piece !== event.piece_id) continue;
      try {
        if (c.res.writableEnded) this.drop(c, false);
        else c.res.write(frame);
      } catch {
        this.drop(c, true);
      }
    }
  }

  /**
   * Stop the timer and hang up on everyone. Tests and shutdown both need this;
   * an open response keeps `server.close()` from ever calling back.
   */
  close(): void {
    for (const c of [...this.clients]) this.drop(c, true);
    this.stopPulse();
  }

  private drop(client: Client, end: boolean): void {
    this.clients.delete(client);
    if (end) {
      try {
        client.res.end();
      } catch {
        /* already gone; nothing to do about it */
      }
    }
    if (this.clients.size === 0) this.stopPulse();
  }

  private startPulse(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.pulse(), this.heartbeatMs);
    // An interval that keeps node alive would make every script that opened a
    // hub hang on exit, and every test file with it.
    this.timer.unref?.();
  }

  private stopPulse(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Keepalive plus the one sweep that runs without a reader. A comment line is
   * ignored by EventSource but still moves bytes, which is what stops a proxy
   * deciding the connection is idle.
   */
  private pulse(): void {
    for (const id of this.expire()) {
      this.publish({ type: "presence", piece_id: id, here: this.presence(id).here });
    }
    for (const c of [...this.clients]) {
      try {
        if (c.res.writableEnded) this.drop(c, false);
        else c.res.write(": ping\n\n");
      } catch {
        this.drop(c, true);
      }
    }
  }
}
