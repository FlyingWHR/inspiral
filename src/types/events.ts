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
  "ingest", // pulled in from the owner's real feeds by an IPSource
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
  "character_minted", // a sheet was pasted in and became an inhabitant
  "terrain_altered", // a visitor dug out or built onto the world itself
  // --- pieces: the things people make together ---
  //
  // `piece_seeded` is the root of a lineage; `piece_extended` is somebody
  // building on somebody else. Both are events rather than rows because
  // attribution IS the product here, and the events table refuses UPDATE and
  // DELETE at the database level. A lineage that could be edited to take a
  // name off somebody's work would be worth nothing.
  "piece_seeded",
  "piece_extended",
  /**
   * Moderation is append-only too. Hiding is a NEW event that readers respect,
   * never a mutation -- the log refuses UPDATE by design, and attribution has
   * to survive a takedown or it was never permanent in the first place.
   *
   * Their own names rather than reusing `notice_posted`, which would drag
   * reports and takedowns into the clip pipeline as publishable moments.
   */
  "piece_reported",
  "piece_hidden",
]);
export type EventType = z.infer<typeof EventType>;

/**
 * Actor reference: a character id, or a prefixed reference.
 *
 * `piece:` and `event:` were added after the pieces layer had been writing them
 * for a while and nothing had noticed: appends are not validated, so the
 * regex never fired -- but `WorldEvent.parse()` on any piece event threw, and
 * the two ingest tests that round-trip an event through the schema would have
 * failed the moment somebody wrote one for a piece. A validator that is wrong
 * about real data and silent about it is worse than no validator.
 */
export const ActorRef = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^((fan|piece|event):)?[a-z0-9_.-]+$/i,
    "actor must be a character_id, or fan:/piece:/event:<id>",
  );

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
   *
   * ADVISORY ONLY, and enforced as such: nothing reads this field directly.
   * `rankSignificance()` in canon/significance.ts computes significance from
   * evidence the host does not control -- event type, how many parties, whether
   * it changed state, where it came from, and how often later events cite it --
   * and lets this hint move the result by at most +/-0.15.
   *
   * For a long time that was a comment describing behaviour that did not exist
   * and every read site used the raw number. See SCHEMA.md, "Re-ranking on
   * read", and tests/significance.test.ts.
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
