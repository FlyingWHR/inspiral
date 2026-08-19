import { z } from "zod";
import { EventType } from "./events.js";

/**
 * THE DIRECTIVE SPEC IS FROZEN.
 *
 * {actor, action, target, dialogue_intent, canon_deltas}
 *
 * A directive is an *intent*, not a rendered performance. The host decides
 * what happens; the character runtime decides how it sounds. That split is
 * what lets one Mind project three characters without their voices bleeding
 * together, and it is what lets the same directive drive Luanti, Godot or
 * Telegram from one decision.
 */

/** Actions a host may command. Deliberately narrower than EventType. */
export const DirectiveAction = z.enum([
  "confront",
  "post_notice",
  "snub",
  "offer_tribute",
  "offer_alliance",
  "accept_alliance",
  "break_alliance",
  "sabotage",
  "concede",
  "spread_rumor",
  "greet_visitor",
  "recruit_visitor",
  "hold", // do nothing visible this tick; still may carry canon_deltas
]);
export type DirectiveAction = z.infer<typeof DirectiveAction>;

/** Maps an action onto the event type it logs. */
export const ACTION_EVENT_TYPE: Record<DirectiveAction, z.infer<typeof EventType>> = {
  confront: "confrontation",
  post_notice: "notice_posted",
  snub: "snub",
  offer_tribute: "tribute_offered",
  offer_alliance: "alliance_offered",
  accept_alliance: "alliance_formed",
  break_alliance: "alliance_broken",
  sabotage: "sabotage",
  concede: "concession",
  spread_rumor: "rumor_spread",
  greet_visitor: "visitor_recognized",
  recruit_visitor: "visitor_recognized",
  hold: "arc_advanced",
};

/**
 * Bounded mutation vocabulary. A host cannot write arbitrary state; it can
 * only request one of these, within these limits. This is the guardrail that
 * keeps a hallucinating host from corrupting a world's history.
 */

/** Per-tick clamp on relationship movement. Grudges must be earned slowly. */
export const MAX_AFFINITY_STEP = 25;
export const MAX_TRUST_STEP = 25;
export const MAX_TENSION_STEP = 30;
export const MAX_STANCE_STEP = 30;
/** A single directive may not carry more than this many deltas. */
export const MAX_DELTAS_PER_DIRECTIVE = 8;
/** A single tick may not carry more than this many directives. */
export const MAX_DIRECTIVES_PER_TICK = 4;

export const RelationshipDelta = z.object({
  op: z.literal("relationship_delta"),
  from_id: z.string().min(1).max(64),
  to_id: z.string().min(1).max(64),
  affinity: z.number().min(-MAX_AFFINITY_STEP).max(MAX_AFFINITY_STEP).default(0),
  trust: z.number().min(-MAX_TRUST_STEP).max(MAX_TRUST_STEP).default(0),
  tension: z.number().min(-MAX_TENSION_STEP).max(MAX_TENSION_STEP).default(0),
  note: z.string().max(500).optional(),
});

export const ArcOpen = z.object({
  op: z.literal("arc_open"),
  arc_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  participants: z.array(z.string().min(1).max(64)).min(1).max(8),
  summary: z.string().max(2000).default(""),
  tension: z.number().min(0).max(100).default(10),
});

export const ArcAdvance = z.object({
  op: z.literal("arc_advance"),
  arc_id: z.string().min(1).max(64),
  /** Relative. Stage only moves forward. */
  stage_delta: z.number().int().min(0).max(5).default(1),
  tension: z.number().min(-MAX_TENSION_STEP).max(MAX_TENSION_STEP).default(0),
  summary: z.string().max(2000).optional(),
});

export const ArcResolve = z.object({
  op: z.literal("arc_resolve"),
  arc_id: z.string().min(1).max(64),
  resolution: z.string().min(1).max(1000),
});

/**
 * Visitors are referred to as "fan:<id>" everywhere else in the prompt -- in
 * `actors`, in `target`, in the narration -- and then this one field wanted the
 * bare id. A live Mind reliably wrote "fan:wren" here and every visitor
 * directive was rejected, which broke the whole return-visit beat. Both spellings
 * denote the same visitor unambiguously, so accept both and normalise. This is
 * not a loosened schema: the value still has to name a visitor that exists.
 */
const FanId = z
  .string()
  .min(1)
  .max(68)
  .transform((s) => s.replace(/^fan:/, ""))
  .pipe(z.string().min(1).max(64));

export const VisitorStance = z.object({
  op: z.literal("visitor_stance"),
  fan_id: FanId,
  character_id: z.string().min(1).max(64),
  sentiment: z.number().min(-MAX_STANCE_STEP).max(MAX_STANCE_STEP),
  /** If set, becomes a notable_moment the NPC can cite on a later visit. */
  moment: z.string().max(500).optional(),
  moment_weight: z.number().min(0).max(1).default(0.6),
});

export const CharacterMood = z.object({
  op: z.literal("character_mood"),
  character_id: z.string().min(1).max(64),
  mood: z.string().min(1).max(60),
});

export const WorldFact = z.object({
  op: z.literal("world_fact"),
  statement: z.string().min(1).max(500),
  about: z.array(z.string().min(1).max(64)).max(8).default([]),
});

export const CanonDelta = z.discriminatedUnion("op", [
  RelationshipDelta,
  ArcOpen,
  ArcAdvance,
  ArcResolve,
  VisitorStance,
  CharacterMood,
  WorldFact,
]);
export type CanonDelta = z.infer<typeof CanonDelta>;

export const Directive = z.object({
  /** Must be an existing character_id. Validated referentially, not just by shape. */
  actor: z.string().min(1).max(64),
  action: DirectiveAction,
  /** character_id, `fan:<id>`, a location, or null for undirected actions. */
  target: z.string().max(64).nullable().default(null),
  /**
   * WHAT they mean to get across -- not the literal line. The character
   * runtime renders the words. Keep it short and declarative.
   */
  dialogue_intent: z.string().min(1).max(500),
  canon_deltas: z.array(CanonDelta).max(MAX_DELTAS_PER_DIRECTIVE).default([]),
  /** Optional: which open arc this belongs to. Used for digest threading. */
  arc_id: z.string().max(64).nullable().default(null),
  /** Advisory, forwarded onto the logged event. */
  significance_hint: z.number().min(0).max(1).default(0.5),
});
export type Directive = z.infer<typeof Directive>;

/** Exactly what the host must return. Nothing else is accepted. */
export const DirectiveBatch = z.object({
  directives: z.array(Directive).min(1).max(MAX_DIRECTIVES_PER_TICK),
  /** Optional host commentary. Logged, never applied. */
  note: z.string().max(1000).optional(),
});
export type DirectiveBatch = z.infer<typeof DirectiveBatch>;
