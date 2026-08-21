/**
 * RE-RANKING ON READ, so a host cannot flatter its way into permanent memory.
 *
 * `SCHEMA.md` and `types/events.ts` both promised this. Neither implemented it:
 * `selectClips`, `showrunnerNote`, `findGrievance`, `bible.ts` and `onboard.ts`
 * all read `significance_hint` raw, which meant a host could mark its own beat
 * 0.95 and that beat would outrank every real consequence in the log forever.
 * A documented integrity guarantee that does not exist is worse than no
 * guarantee, because it is in the document we hand judges.
 *
 * The fix keeps the hint useful without letting it be authoritative. Canon
 * computes an EVIDENCE score from things the host does not control, and the
 * hint is then clamped into a band around it. A host can express a view; it
 * cannot manufacture importance.
 *
 *   real = evidence + (hint - 0.5) * 2 * BAND
 *
 * The hint is a SIGNED NUDGE around neutral, not an absolute value clamped into
 * a window. The first version did the latter -- `clamp(hint, e-BAND, e+BAND)` --
 * and it had a hole: whenever the hint already sat inside the band the result
 * WAS the hint, so evidence changed nothing. An event cited three times scored
 * identically to one nobody had ever mentioned. Evidence has to drive.
 *
 * Evidence is four things, all of them observable in the log itself:
 *
 *   TYPE        the closed vocabulary is not flat. An alliance breaking is
 *               structurally a bigger deal than a rumour being repeated, and
 *               that is a property of the world, not of the narrator.
 *   REACH       an event naming two parties is a relationship event; one naming
 *               nobody is a mood.
 *   EFFECT      did it actually change canon -- move a stance, a relationship,
 *               an arc? An event that changed nothing did not matter, whatever
 *               it says about itself.
 *   PROVENANCE  an event pulled from the owner's REAL feed is notable by
 *               construction -- it is the thing the IP actually did, and the
 *               whole post-to-reaction claim rests on those beats being
 *               findable. `source` is set by the pipeline, never by the model.
 *   UPTAKE      has anything cited it since? This is the strongest signal and
 *               the one a host can least game, because it is other beats,
 *               later, referring back. It is also exactly what "significance"
 *               means in a story: the bits that get brought up again.
 */

import type { WorldEvent } from "../types/events.js";

/**
 * How far the hint may pull the score away from the evidence, in either
 * direction. Wide enough that the host's judgement is worth having, narrow
 * enough that it cannot invent a landmark out of nothing.
 */
export const HINT_BAND = 0.15;

/**
 * Structural weight per event type. These are the floor of what an event of
 * that kind is worth before anything else is known about it.
 */
const TYPE_WEIGHT: Record<string, number> = {
  // things that permanently change who stands with whom
  alliance_broken: 0.72,
  alliance_formed: 0.68,
  confrontation: 0.6,
  sabotage: 0.6,
  concession: 0.55,
  arc_resolved: 0.7,
  arc_opened: 0.58,
  /**
   * 0.18, not 0.5. `arc_advanced` is a stage counter ticking over, and it is
   * also where every `hold` lands via ACTION_EVENT_TYPE -- 80 of the 134 events
   * in the live log are holds, and at 0.5 thirty-one of them cleared the clip
   * bar. A character declining to act is not a beat worth clipping.
   */
  arc_advanced: 0.18,
  // public acts with a witness
  snub: 0.5,
  notice_posted: 0.45,
  tribute_offered: 0.45,
  alliance_offered: 0.45,
  rumor_spread: 0.35,
  // the visitor relationship, which is the thing this project is about
  visitor_pledged: 0.68,
  visitor_recognized: 0.62,
  visitor_gifted: 0.5,
  visitor_spoke: 0.35,
  visitor_arrived: 0.3,
  visitor_departed: 0.25,
  // the world editing itself
  character_minted: 0.5,
  terrain_altered: 0.35,
  world_created: 0.4,
  // bookkeeping is not drama
  tick_skipped: 0.05,
  directive_rejected: 0.05,
};

const DEFAULT_WEIGHT = 0.4;

export interface RankContext {
  /** How many later events cite this one. Canon's own uptake measure. */
  citedBy?: number;
  /** Whether the event actually moved canon state when it was applied. */
  changedState?: boolean;
}

/**
 * The evidence score on its own, before the hint is allowed near it. Exported
 * so a test can assert that evidence and hint are genuinely separable.
 */
export function evidenceScore(
  e: Pick<WorldEvent, "type" | "actors"> & { source?: string; payload?: Record<string, unknown> },
  ctx: RankContext = {},
): number {
  let score = TYPE_WEIGHT[e.type] ?? DEFAULT_WEIGHT;

  /**
   * A HOLD IS NOT AN EVENT. `ACTION_EVENT_TYPE` maps the `hold` action onto
   * `arc_advanced`, so keying on `type` alone gave every "this character did
   * nothing this tick" the weight of a story beat. The original action survives
   * in the payload, which is the only place the two can be told apart.
   *
   * This is the engagement-formula problem in a new costume: without it, a hold
   * with a flattering hint of 0.85 scored 0.73 and outranked real consequences.
   */
  if (e.payload && (e.payload as { action?: string }).action === "hold") {
    score = Math.min(score, 0.1);
  }

  const actors = Array.isArray(e.actors) ? e.actors.length : 0;
  if (actors >= 2) score += 0.08;

  // Straight from the owner's feed. Not a judgement, a fact about where the
  // event came from -- and the beats that prove "you post, the world reacts"
  // have to stay findable in the clip drafts.
  if (e.source === "ingest") score += 0.14;
  // Seeded day-zero canon is scaffolding, not something that happened.
  if (e.source === "seed") score -= 0.08;

  if (ctx.changedState) score += 0.07;

  // Uptake compounds but saturates: being cited once is the signal, being cited
  // nine times mostly means the cast has a favourite anecdote.
  const cited = Math.max(0, ctx.citedBy ?? 0);
  if (cited > 0) score += Math.min(0.18, 0.08 + (cited - 1) * 0.035);

  return Math.max(0.05, Math.min(0.95, score));
}

/**
 * The number every read site should use instead of `significance_hint`.
 *
 * Deliberately a pure function of the event plus context rather than a stored
 * column: significance changes as the world takes the event up, so a value
 * frozen at write time would be wrong by the second time anyone asked.
 */
export function rankSignificance(
  e: Pick<WorldEvent, "type" | "actors" | "significance_hint"> & {
    source?: string;
    payload?: Record<string, unknown>;
  },
  ctx: RankContext = {},
): number {
  const evidence = evidenceScore(e, ctx);
  const hint = typeof e.significance_hint === "number" ? e.significance_hint : 0.5;
  // 0.5 is "no opinion". Above it the host is arguing the beat matters more
  // than it looks; below, less. Either way it can move the score by at most
  // HINT_BAND, and evidence carries the rest.
  const nudged = evidence + (hint - 0.5) * 2 * HINT_BAND;
  return Math.max(0.05, Math.min(0.95, Number(nudged.toFixed(3))));
}
