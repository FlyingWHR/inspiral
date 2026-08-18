import { z } from "zod";

/**
 * THE EVENT SCHEMA IS FROZEN.
 *
 * {event_id, ts, source, actors[], type, payload, significance_hint}
 *
 * Every mutation to the world passes through an event. The event log is
 * append-only: rows are never updated and never deleted. Canon state is a
 * derived projection and can always be rebuilt by replaying the log.
 */

/** Where the event came from. Not who acted -- that is `actors`. */
export const EventSource = z.enum([
  "seed", // day-zero canon written at world creation
  "tick", // the world tick fired and an NPC acted
  "visitor", // a visitor did something (arrived, pledged, spoke)
  "system", // scheduler / operator bookkeeping
  "host", // the Mind said something about itself (QC, refusal, timeout)
]);
export type EventSource = z.infer<typeof EventSource>;

/**
 * Closed action vocabulary. The host may only produce these. A closed
 * vocabulary is what makes directives validatable and what keeps a single
 * Mind projecting three characters coherently.
 */
export const EventType = z.enum([
  // --- NPC-driven ---
  "confrontation", // actor confronts target in public
  "notice_posted", // actor posts a notice on the district board
  "snub", // actor publicly ignores / withholds from target
  "tribute_offered", // actor gives something to target
  "alliance_offered",
  "alliance_formed",
  "alliance_broken",
  "sabotage", // actor undermines target indirectly
  "concession", // actor backs down
  "rumor_spread",
  // --- arc bookkeeping ---
  "arc_opened",
  "arc_advanced",
  "arc_resolved",
  // --- visitor-driven ---
  "visitor_arrived",
  "visitor_departed",
  "visitor_pledged", // visitor takes a side
  "visitor_spoke",
  "visitor_recognized", // NPC greets a returning visitor by standing
  "visitor_gifted",
  // --- system ---
  "tick_skipped", // host unavailable; ran on last directives
  "directive_rejected", // validator refused a directive
  "world_created",
]);
export type EventType = z.infer<typeof EventType>;

/** Actor reference: a character id, or a visitor as `fan:<fan_id>`. */
export const ActorRef = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(fan:)?[a-z0-9_.-]+$/i, "actor must be a character_id or fan:<fan_id>");

export const WorldEvent = z.object({
  /** Monotonic, sortable, unique. See `newEventId`. */
  event_id: z.string().min(1).max(64),
  /** ISO-8601 UTC. World time, which may be faster than wall time in demos. */
  ts: z.string().datetime(),
  source: EventSource,
  /** Everyone materially involved. First entry is the initiator by convention. */
  actors: z.array(ActorRef).min(1).max(8),
  type: EventType,
  /** Free-form, type-specific. Kept small; prose belongs in `summary`. */
  payload: z.record(z.unknown()).default({}),
  /**
   * The host's own guess at how much this should matter later, 0..1.
   * ADVISORY ONLY. Canon recomputes real significance on read, so a host that
   * flatters itself cannot inflate its way into permanent memory.
   */
  significance_hint: z.number().min(0).max(1).default(0.5),
});
export type WorldEvent = z.infer<typeof WorldEvent>;

/** What a caller supplies; ids and timestamps are assigned by the repo. */
export type NewWorldEvent = Omit<WorldEvent, "event_id" | "ts"> &
  Partial<Pick<WorldEvent, "event_id" | "ts">>;

let counter = 0;
/**
 * Sortable id: `evt_<base36 ms>_<counter>`. Lexicographic order matches
 * insertion order, which makes "what happened after X" a string comparison.
 */
export function newEventId(now: Date = new Date()): string {
  counter = (counter + 1) % 1_000_000;
  return `evt_${now.getTime().toString(36)}_${counter.toString(36).padStart(4, "0")}`;
}

/** Human-readable one-liner used in digests and the demo transcript. */
export function describeEvent(e: WorldEvent): string {
  const p = e.payload as Record<string, unknown>;
  const summary = typeof p.summary === "string" ? p.summary : undefined;
  if (summary) return summary;
  const [a, ...rest] = e.actors;
  return `${a} ${e.type.replace(/_/g, " ")}${rest.length ? ` -> ${rest.join(", ")}` : ""}`;
}
