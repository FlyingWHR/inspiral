import { z } from "zod";

/**
 * CANON IS THE SOURCE OF TRUTH. The Minds platform is not.
 *
 * This is the sovereignty seam: the host is a stateless opinion generator. It
 * is handed a digest and returns directives. Everything durable -- who hates
 * whom, what happened, who the visitor sided with -- lives here, in a file we
 * own, in a schema we control. If Minds vanishes tomorrow the world survives
 * and a different host is swapped in behind `HostRuntime`.
 */

/** A character sheet. Stable identity; the parts that do not move. */
export const CharacterSheet = z.object({
  character_id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  faction: z.string().min(1).max(120),
  title: z.string().max(120).default(""),
  /** One paragraph. The spine of who they are. */
  brief: z.string().max(2000).default(""),
  /** Concrete wants. Drives what the host proposes. */
  goals: z.array(z.string().max(300)).max(12).default([]),
  /** Hard "this character would never" lines. Enforced at render time. */
  taboos: z.array(z.string().max(300)).max(12).default([]),
  /** Diction, rhythm, verbal tics. Consumed by the character runtime. */
  voice: z.object({
    register: z.string().max(120).default("plain"),
    tics: z.array(z.string().max(80)).max(8).default([]),
    /** Rough words-per-line ceiling for rendered dialogue. */
    /**
     * Rough words-per-line ceiling for rendered dialogue.
     *
     * CLAMPED, not validated. A live Mind returned a value below the floor and
     * the whole enrichment was thrown away with it -- an entire cast and two
     * storylines lost to one cosmetic number. A ceiling that is out of range is
     * a ceiling to correct, not a reason to discard the world.
     */
    max_words: z
      .number()
      .catch(28)
      .transform((n) => Math.min(80, Math.max(4, Math.round(n))))
      .default(28),
  }),
  /** Volatile. Updated by directives, unlike the rest of the sheet. */
  mood: z.string().max(60).default("even"),
  /** Where they hold court. Engine-agnostic string; no coordinates here. */
  home_location: z.string().max(120).default("district"),
});
export type CharacterSheet = z.infer<typeof CharacterSheet>;

/**
 * A directed edge. A->B is not B->A: Vane may fear Okonkwo while Okonkwo
 * merely finds Vane tiresome. Asymmetry is where the drama lives.
 */
export const Relationship = z.object({
  from_id: z.string().min(1).max(64),
  to_id: z.string().min(1).max(64),
  /** -100 hatred .. +100 devotion */
  affinity: z.number().min(-100).max(100).default(0),
  /** 0 none .. 100 total. Falls faster than it rises. */
  trust: z.number().min(0).max(100).default(50),
  /** 0 calm .. 100 about to break. Drives escalation. */
  tension: z.number().min(0).max(100).default(0),
  /** Why it currently stands where it stands. One line, host-authored. */
  note: z.string().max(500).default(""),
  /** The event that last moved this edge. Enables "because of what you did". */
  last_event_id: z.string().max(64).nullable().default(null),
  updated_ts: z.string().datetime().optional(),
});
export type Relationship = z.infer<typeof Relationship>;

export const ArcStatus = z.enum(["open", "escalating", "resolved", "dormant"]);
export type ArcStatus = z.infer<typeof ArcStatus>;

/** A running storyline. Open arcs are what the next tick is asked to advance. */
export const Arc = z.object({
  arc_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  status: ArcStatus.default("open"),
  participants: z.array(z.string().min(1).max(64)).min(1).max(8),
  /** 0 = just opened. Increments as the arc advances. */
  stage: z.number().int().min(0).max(100).default(0),
  tension: z.number().min(0).max(100).default(10),
  /** Running prose summary. Rewritten by the host as the arc advances. */
  summary: z.string().max(2000).default(""),
  resolution: z.string().max(1000).nullable().default(null),
  opened_ts: z.string().datetime().optional(),
  updated_ts: z.string().datetime().optional(),
});
export type Arc = z.infer<typeof Arc>;

/** World-level style constraints. Applied to every rendered line. */
export const ToneRules = z.object({
  world_id: z.string().default("default"),
  /** e.g. "grimy municipal fantasy, dry, no winking at the camera" */
  register: z.string().max(500).default(""),
  /** Phrases that must never appear. Checked at render time. */
  banned_phrases: z.array(z.string().max(80)).max(64).default([]),
  /** Subjects nobody in this world discusses. */
  forbidden_topics: z.array(z.string().max(120)).max(32).default([]),
  max_line_words: z.number().int().min(4).max(120).default(32),
});
export type ToneRules = z.infer<typeof ToneRules>;

/** One thing a visitor did, from the visitor's point of view. */
export const VisitorInteraction = z.object({
  event_id: z.string().max(64),
  ts: z.string().datetime(),
  character_id: z.string().max(64).nullable().default(null),
  kind: z.string().max(60),
  detail: z.string().max(500).default(""),
});
export type VisitorInteraction = z.infer<typeof VisitorInteraction>;

/**
 * A moment worth bringing up unprompted on a later visit. This is the demo
 * payoff: on day 6 an NPC cites one of these, with its event_id, so the
 * callback is provably grounded rather than improvised.
 */
export const NotableMoment = z.object({
  event_id: z.string().max(64),
  ts: z.string().datetime(),
  summary: z.string().max(500),
  /** 0..1. Sorted descending when recalling. */
  weight: z.number().min(0).max(1).default(0.5),
  /** Who should remember this. Empty = everyone. */
  witnesses: z.array(z.string().max(64)).max(8).default([]),
});
export type NotableMoment = z.infer<typeof NotableMoment>;

/** {fan_id, first_seen, interactions[], stance{character: sentiment}, notable_moments[]} */
export const VisitorRecord = z.object({
  fan_id: z.string().min(1).max(64),
  first_seen: z.string().datetime(),
  last_seen: z.string().datetime(),
  display_name: z.string().max(120).default(""),
  interactions: z.array(VisitorInteraction).default([]),
  /** character_id -> sentiment, -100..100. The visitor's standing with each NPC. */
  stance: z.record(z.number().min(-100).max(100)).default({}),
  notable_moments: z.array(NotableMoment).default([]),
});
export type VisitorRecord = z.infer<typeof VisitorRecord>;

/** Everything the host is allowed to see in one tick. */
export interface CanonSnapshot {
  characters: CharacterSheet[];
  relationships: Relationship[];
  arcs: Arc[];
  tone: ToneRules;
}
