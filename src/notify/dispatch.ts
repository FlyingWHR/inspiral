/**
 * THE ONE PLACE THAT DECIDES WHETHER SOMEBODY GETS PINGED.
 *
 * Channels do not make this judgement. If an email path and a chat path each
 * decided when to send, they would drift, and the drift would show up as a
 * person being messaged twice about the same thing by two routes -- which is
 * the failure this product can least afford, because a notification is the one
 * thing that reaches somebody who did not choose to be reached today.
 *
 * So: `enqueue` records that somebody should be told. `dispatch` decides who is
 * actually told, batches, respects quiet windows and opt-outs, and hands a
 * finished `Delivery` to a channel whose only job is transport.
 */

import type { CanonRepo } from "../canon/repo.js";
import { getPiece } from "../pieces/repo.js";
import { isHidden } from "../pieces/moderation.js";
import {
  DEFAULT_QUIET_MINUTES,
  MAX_ATTEMPTS,
  type Delivery,
  type NotifyChannel,
  type NotifyKind,
  type NotifyPreference,
  type Notification,
} from "./contract.js";
import { log } from "../log.js";

const db = (repo: CanonRepo): {
  prepare(sql: string): {
    get(...a: unknown[]): unknown;
    all(...a: unknown[]): unknown[];
    run(...a: unknown[]): { changes?: number };
  };
} => (repo as unknown as { db: ReturnType<typeof db> }).db;

/**
 * Somebody should be told. Cheap, synchronous, and safe to call on the request
 * path -- it writes one row and never touches a network.
 *
 * Silently does nothing if this person has already been told about this event.
 * The UNIQUE constraint makes that true even with two workers racing, and
 * "already queued" is not an error worth propagating into an extend request.
 */
export function enqueue(
  repo: CanonRepo,
  n: { fan_id: string; kind: NotifyKind; piece_id: string; event_id: string },
): boolean {
  const r = db(repo)
    .prepare(
      `INSERT INTO notifications (fan_id, kind, piece_id, event_id, created_ts)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (fan_id, event_id) DO NOTHING`,
    )
    .run(n.fan_id, n.kind, n.piece_id, n.event_id, repo.now());
  return (r.changes ?? 0) > 0;
}

export function setPreference(
  repo: CanonRepo,
  p: { fan_id: string; channel: string; address: string; enabled?: boolean; quiet_minutes?: number },
): void {
  db(repo)
    .prepare(
      `INSERT INTO notify_prefs (fan_id, channel, address, enabled, quiet_minutes, updated_ts)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (fan_id, channel) DO UPDATE SET
         address = excluded.address, enabled = excluded.enabled,
         quiet_minutes = excluded.quiet_minutes, updated_ts = excluded.updated_ts`,
    )
    .run(
      p.fan_id,
      p.channel,
      p.address,
      p.enabled === false ? 0 : 1,
      p.quiet_minutes ?? DEFAULT_QUIET_MINUTES,
      repo.now(),
    );
}

/** Off until they say otherwise. One call, and it is respected everywhere. */
export function unsubscribe(repo: CanonRepo, fanId: string, channel?: string): void {
  db(repo)
    .prepare(
      channel
        ? "UPDATE notify_prefs SET enabled = 0, updated_ts = ? WHERE fan_id = ? AND channel = ?"
        : "UPDATE notify_prefs SET enabled = 0, updated_ts = ? WHERE fan_id = ?",
    )
    .run(...(channel ? [repo.now(), fanId, channel] : [repo.now(), fanId]));
}

export function preferencesFor(repo: CanonRepo, fanId: string): NotifyPreference[] {
  return (
    db(repo)
      .prepare("SELECT * FROM notify_prefs WHERE fan_id = ?")
      .all(fanId) as Record<string, unknown>[]
  ).map((r) => ({
    fan_id: String(r.fan_id),
    channel: String(r.channel),
    address: String(r.address),
    enabled: Number(r.enabled) === 1,
    quiet_minutes: Number(r.quiet_minutes),
    updated_ts: String(r.updated_ts),
  }));
}

function rowToNotification(r: Record<string, unknown>): Notification {
  return {
    id: Number(r.id),
    fan_id: String(r.fan_id),
    kind: String(r.kind) as NotifyKind,
    piece_id: String(r.piece_id),
    event_id: String(r.event_id),
    created_ts: String(r.created_ts),
    sent_ts: r.sent_ts ? String(r.sent_ts) : null,
    channel: r.channel ? String(r.channel) : null,
    error: r.error ? String(r.error) : null,
    attempts: Number(r.attempts ?? 0),
  };
}

export function pending(repo: CanonRepo, limit = 500): Notification[] {
  return (
    db(repo)
      .prepare(
        `SELECT * FROM notifications
         WHERE sent_ts IS NULL AND attempts < ?
         ORDER BY id ASC LIMIT ?`,
      )
      .all(MAX_ATTEMPTS, limit) as Record<string, unknown>[]
  ).map(rowToNotification);
}

/** When we last got through to this person, on any channel. */
function lastSentTo(repo: CanonRepo, fanId: string): string | null {
  const r = db(repo)
    .prepare("SELECT MAX(sent_ts) AS m FROM notifications WHERE fan_id = ? AND sent_ts IS NOT NULL")
    .get(fanId) as { m: string | null } | undefined;
  return r?.m ?? null;
}

export interface DispatchResult {
  considered: number;
  sent: number;
  skipped: { quiet: number; disabled: number; unreachable: number; hidden: number };
  failed: number;
}

/**
 * Send what is due.
 *
 * Batches by person, because three people building on your work in ten minutes
 * is one interesting fact, not three interruptions. Everything held back stays
 * pending and goes out with the next batch -- nothing is dropped for being
 * early.
 */
export async function dispatch(
  repo: CanonRepo,
  channels: NotifyChannel[],
  opts: { baseUrl?: string; now?: () => number } = {},
): Promise<DispatchResult> {
  const now = opts.now ?? (() => Date.now());
  const base = (opts.baseUrl ?? "").replace(/\/+$/, "");
  const out: DispatchResult = {
    considered: 0,
    sent: 0,
    skipped: { quiet: 0, disabled: 0, unreachable: 0, hidden: 0 },
    failed: 0,
  };

  const byFan = new Map<string, Notification[]>();
  for (const n of pending(repo)) {
    out.considered++;
    /**
     * A takedown must stop a notification that has not gone out yet. The
     * window between somebody posting abuse and a creator hiding it is exactly
     * when a queued message would land in the target's inbox.
     */
    if (isHidden(repo, n.event_id)) {
      markSent(repo, [n.id], "suppressed");
      out.skipped.hidden++;
      continue;
    }
    const list = byFan.get(n.fan_id) ?? [];
    list.push(n);
    byFan.set(n.fan_id, list);
  }

  for (const [fanId, items] of byFan) {
    const prefs = preferencesFor(repo, fanId).filter((p) => p.enabled);
    if (prefs.length === 0) {
      // No address, or opted out. Leave them pending rather than marking them
      // sent: if they add an address tomorrow, they should still hear about it.
      out.skipped.disabled++;
      continue;
    }

    const quiet = Math.min(...prefs.map((p) => p.quiet_minutes));
    const last = lastSentTo(repo, fanId);
    if (last && now() - Date.parse(last) < quiet * 60_000) {
      out.skipped.quiet++;
      continue;
    }

    const delivery = compose(repo, fanId, items, base);
    if (!delivery) {
      out.skipped.unreachable++;
      continue;
    }

    let delivered = false;
    for (const pref of prefs) {
      const channel = channels.find((c) => c.name === pref.channel);
      if (!channel) continue;
      try {
        await channel.send({ ...delivery, address: pref.address });
        markSent(repo, delivery.ids, channel.name);
        out.sent++;
        delivered = true;
        break; // one message per person per round, not one per channel
      } catch (e) {
        bumpAttempt(repo, delivery.ids, (e as Error).message);
        log.warn(`notify: ${channel.name} failed for ${fanId}: ${(e as Error).message}`);
      }
    }
    if (!delivered) out.failed++;
  }

  return out;
}

/**
 * Turn queued rows into something worth reading.
 *
 * The sentence goes in the body when there is one, because THAT is the reason
 * to come back. "You have 1 update" is a notification about nothing, and it is
 * how a product teaches people to ignore it.
 */
function compose(
  repo: CanonRepo,
  fanId: string,
  items: Notification[],
  base: string,
): Delivery | null {
  const lines: string[] = [];
  let headline = "";

  for (const n of items) {
    const e = repo.getEvent(n.event_id);
    if (!e) continue;
    const p = e.payload as Record<string, unknown>;
    const who = repo.getVisitor(String(p.fan_id ?? ""))?.display_name || String(p.fan_id ?? "");
    const piece = getPiece(repo, n.piece_id)?.title ?? n.piece_id;
    const changed = typeof p.changed === "string" ? p.changed : "";
    if (!headline) {
      headline =
        items.length === 1
          ? `${who} built on your work in ${piece}`
          : `${items.length} people built on your work`;
    }
    lines.push(changed || `${who} built on your work in ${piece}.`);
  }

  if (lines.length === 0) return null;
  return {
    fan_id: fanId,
    address: "", // filled per preference at send time
    headline,
    body: lines.join("\n\n"),
    url: `${base}/?fan=${encodeURIComponent(fanId)}`,
    ids: items.map((i) => i.id),
  };
}

function markSent(repo: CanonRepo, ids: number[], channel: string): void {
  const stmt = db(repo).prepare(
    "UPDATE notifications SET sent_ts = ?, channel = ?, error = NULL WHERE id = ?",
  );
  const ts = repo.now();
  for (const id of ids) stmt.run(ts, channel, id);
}

function bumpAttempt(repo: CanonRepo, ids: number[], error: string): void {
  const stmt = db(repo).prepare(
    "UPDATE notifications SET attempts = attempts + 1, error = ? WHERE id = ?",
  );
  for (const id of ids) stmt.run(error.slice(0, 500), id);
}
