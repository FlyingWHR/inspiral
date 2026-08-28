/**
 * THE FLOOR, NOT A PRODUCT.
 *
 * Nothing here judges anything. It records what people assert and reports what
 * it recorded; the creator decides. That split is the whole design, and it is
 * why there is no score, no queue, no auto-hide threshold and no appeal state
 * machine in this file -- every one of those is a system that decides on the
 * creator's behalf and then has to be argued with.
 *
 * ---------------------------------------------------------------------------
 * HIDING IS ADDITIVE
 * ---------------------------------------------------------------------------
 *
 * The events table refuses UPDATE and DELETE at the database level, and that
 * is not an obstacle to work around -- it is the reason attribution here is
 * worth anything. So a hidden extension is not an edited row and not a deleted
 * one: it is a NEW event that readers respect. The original stands, unmodified,
 * with its author's name on it. Visibility is a read-time decision.
 *
 * REJECTED: a `hidden` column on a projection table. It typechecks, it is one
 * UPDATE, and it quietly makes "was this ever hidden, by whom, when" an
 * unanswerable question the first time somebody asks it in anger.
 */

import type { CanonRepo } from "../canon/repo.js";
import type { EventType, WorldEvent } from "../types/events.js";
import type { PieceWithLineage } from "./contract.js";

/**
 * Their own event types, added to `EventType` rather than cast in here.
 *
 * Not `notice_posted`, which would drag reports and takedowns into the clip
 * pipeline -- `roleOf` calls anything with a `fan:` actor "community", so an
 * owner could be handed somebody's abuse report as a postable draft.
 */
const REPORTED: EventType = "piece_reported";
const HIDDEN: EventType = "piece_hidden";

/**
 * Moderation must never become content.
 *
 * A hint this low keeps both events under the clip bar (0.5) and the
 * showrunner's note bar (0.45) once `rankSignificance` re-ranks them. Handing
 * an owner "ada reported maya's contribution" as a draft to post would be the
 * worst thing this file could do.
 */
const MOD_HINT = 0.05;

/** Reasons are a sentence, not an essay. Capped at a trust boundary. */
const REASON_MAX = 280;

export class ModerationError extends Error {
  constructor(
    message: string,
    readonly code: "no_event" | "not_extension" | "no_reason",
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

/** A report, as it went into the log. */
export interface ModerationReport {
  /** The report event itself. Citable, like everything else here. */
  event_id: string;
  /** The extension being reported. */
  target_event_id: string;
  piece_id: string;
  /** Who filed it. Asserted, not authenticated -- same as every other fan id. */
  fan_id: string;
  reason: string;
  ts: string;
}

/** A hiding, as it went into the log. */
export interface HideRecord {
  event_id: string;
  target_event_id: string;
  piece_id: string;
  /** Who hid it. The creator, or whoever the caller decided speaks for them. */
  by: string;
  ts: string;
}

/**
 * The extension an id points at, or a refusal.
 *
 * Checked rather than trusted: a report filed against an id that resolves to
 * nothing is a record of nothing, and it would sit in an append-only log
 * forever looking like evidence.
 */
function targetExtension(repo: CanonRepo, eventId: string): WorldEvent {
  const e = repo.getEvent(eventId);
  if (!e) throw new ModerationError(`no event '${eventId}'`, "no_event");
  if (e.type !== "piece_extended") {
    throw new ModerationError("only a contribution can be reported or hidden", "not_extension");
  }
  return e;
}

const pieceOf = (e: WorldEvent): string => String((e.payload as Record<string, unknown>).piece_id ?? "");

/**
 * Actors, and why an event id is one of them.
 *
 * `event:<id>` lets `isHidden` answer "is this one hidden" without knowing
 * which piece it belongs to, using `eventsInvolving` -- the lookup every other
 * reader in this codebase already uses -- instead of scanning the log. It
 * follows the precedent `repo.ts` already set with `piece:<id>`.
 */
const modActors = (who: string, pieceId: string, targetId: string): string[] =>
  [`fan:${who}`, `piece:${pieceId}`, `event:${targetId}`];

/**
 * SOMEBODY FLAGS SOMETHING.
 *
 * Written as an event so it is auditable and cannot be quietly dropped. A
 * report changes nothing about what is visible -- it is a message to the
 * creator, in a place the creator cannot lose it and nobody can edit it.
 */
export function report(
  repo: CanonRepo,
  input: { fan_id: string; event_id: string; reason: string },
): ModerationReport {
  const target = targetExtension(repo, input.event_id);
  const reason = input.reason.trim().slice(0, REASON_MAX);
  if (!reason) throw new ModerationError("a report needs a reason", "no_reason");

  const piece_id = pieceOf(target);
  repo.ensureVisitor(input.fan_id, "");
  const e = repo.appendEvent({
    source: "visitor",
    actors: modActors(input.fan_id, piece_id, input.event_id),
    type: REPORTED,
    payload: {
      summary: `${input.fan_id} reported a contribution in ${piece_id}.`,
      piece_id,
      target_event_id: input.event_id,
      fan_id: input.fan_id,
      reason,
    },
    significance_hint: MOD_HINT,
  });

  return {
    event_id: e.event_id,
    target_event_id: input.event_id,
    piece_id,
    fan_id: input.fan_id,
    reason,
    ts: e.ts,
  };
}

/**
 * THE CREATOR TAKES SOMETHING DOWN.
 *
 * A second event, never a mutation. The contribution stays in the log with its
 * author's name on it and its receipt still resolves; readers that respect
 * `withoutHidden` stop rendering it. That is the whole mechanism.
 *
 * NOT BUILT: unhide. It is one more additive event plus a latest-wins read, and
 * nobody has asked to reverse one yet. `isHidden` is written as "a hide exists"
 * rather than "the latest verdict is hide" so that the day it is needed the
 * change is visible rather than accidental.
 */
export function hide(repo: CanonRepo, eventId: string, by: string): HideRecord {
  const target = targetExtension(repo, eventId);
  const piece_id = pieceOf(target);
  const e = repo.appendEvent({
    source: "system",
    actors: modActors(by, piece_id, eventId),
    type: HIDDEN,
    payload: {
      summary: `A contribution in ${piece_id} was hidden by ${by}.`,
      piece_id,
      target_event_id: eventId,
      by,
    },
    significance_hint: MOD_HINT,
  });
  return { event_id: e.event_id, target_event_id: eventId, piece_id, by, ts: e.ts };
}

/** Is this contribution hidden right now. */
export function isHidden(repo: CanonRepo, eventId: string): boolean {
  return repo.eventsInvolving(`event:${eventId}`, 50).some((e) => e.type === HIDDEN);
}

const targetIds = (events: WorldEvent[], type: EventType): Set<string> =>
  new Set(
    events
      .filter((e) => e.type === type)
      .map((e) => String((e.payload as Record<string, unknown>).target_event_id ?? "")),
  );

/** Every contribution hidden on one piece. One query, not one per extension. */
export function hiddenOn(repo: CanonRepo, pieceId: string): Set<string> {
  // ponytail: 500 matches the cap `lineage()` already uses. Both need paging
  // together on the day a piece outgrows it, so neither gets it early.
  return targetIds(repo.eventsInvolving(`piece:${pieceId}`, 500), HIDDEN);
}

/**
 * WHAT CALLERS ACTUALLY USE. A lineage with the hidden contributions dropped.
 *
 * Note what is NOT recomputed: `generation` and `contributors` on the piece
 * stay as they were. Hiding is a visibility decision, not a rewrite of who was
 * there -- and quietly decrementing a count would be the first small step
 * toward the log and the page telling different stories.
 */
export function withoutHidden(repo: CanonRepo, l: PieceWithLineage): PieceWithLineage {
  const hidden = hiddenOn(repo, l.piece.piece_id);
  if (hidden.size === 0) return l;
  return { ...l, extensions: l.extensions.filter((x) => !hidden.has(x.event_id)) };
}

/**
 * Everything reported on one piece, newest first. The reporting half of
 * "records and reports": a creator who cannot read the reports has no authority
 * to be final about.
 */
export function reportsOn(repo: CanonRepo, pieceId: string): ModerationReport[] {
  return repo
    .eventsInvolving(`piece:${pieceId}`, 500)
    .filter((e) => e.type === REPORTED)
    .map((e) => {
      const p = e.payload as Record<string, unknown>;
      return {
        event_id: e.event_id,
        target_event_id: String(p.target_event_id ?? ""),
        piece_id: String(p.piece_id ?? ""),
        fan_id: String(p.fan_id ?? ""),
        reason: String(p.reason ?? ""),
        ts: e.ts,
      };
    });
}

// ---------------------------------------------------------------------------
// RATE LIMIT
// ---------------------------------------------------------------------------

/**
 * A cap, not a punishment. Loose enough that a person having a good session
 * never meets it, tight enough that one person cannot bury a piece under
 * twenty contributions before anybody else sees it.
 */
const EXTEND_CAP = { max: 5, hours: 1 } as const;

export interface RateVerdict {
  /** False means the caller should refuse. This module does not refuse for it. */
  ok: boolean;
  /** Extensions by this fan inside the window. Counted from the log. */
  recent: number;
  limit: number;
  window_hours: number;
  /** When the oldest counted extension falls out of the window, if capped. */
  retry_after?: string;
}

/**
 * Per-fan extension cap over a rolling window.
 *
 * Counted from the log rather than a counter table, so it cannot drift out of
 * agreement with what actually happened and there is nothing to reset. It also
 * releases on its own: the window slides, so the oldest extension ages out and
 * the answer becomes `ok` again with nothing scheduled and nothing swept.
 *
 * REJECTED: a token bucket in memory. Faster, and it forgets everything on
 * restart -- which turns a redeploy into a free flood.
 */
export function extendRate(
  repo: CanonRepo,
  fanId: string,
  cap: { max: number; hours: number } = EXTEND_CAP,
): RateVerdict {
  const cutoff = Date.parse(repo.now()) - cap.hours * 3_600_000;
  const inWindow = repo
    .eventsInvolving(`fan:${fanId}`, 200)
    .filter((e) => e.type === "piece_extended" && Date.parse(e.ts) >= cutoff)
    .sort((a, b) => a.ts.localeCompare(b.ts));

  const verdict: RateVerdict = {
    ok: inWindow.length < cap.max,
    recent: inWindow.length,
    limit: cap.max,
    window_hours: cap.hours,
  };
  const oldest = inWindow[0];
  if (!verdict.ok && oldest) {
    verdict.retry_after = new Date(Date.parse(oldest.ts) + cap.hours * 3_600_000).toISOString();
  }
  return verdict;
}
