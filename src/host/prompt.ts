import { DirectiveAction, MAX_DIRECTIVES_PER_TICK } from "../types/directive.js";

/**
 * The protocol block. Prepended to every tick ask.
 *
 * Note what it does NOT do: it does not ask the host to be three characters.
 * It asks the host to be the *district* and decide what happens next. One
 * Mind, one decision, several actors -- which is the only shape that fits a
 * platform with no mind-to-mind Circles and a three-Mind free tier, and which
 * happens to also be the shape that keeps a cast coherent.
 */
export function protocolPreamble(): string {
  const actions = DirectiveAction.options.join(", ");
  return `You are the narrative engine for a small district. You are not one character.
You are the thing that decides what the district does next.

You will be given: the cast, the standing between them, open storylines, what
has happened since you last acted, and any visitors on record.

Return ONE JSON object and nothing else. No prose, no code fence, no preamble.

SHAPE
{
  "directives": [
    {
      "actor": "<character id from the cast>",
      "action": "<one of: ${actions}>",
      "target": "<character id | fan:<id> | location | null>",
      "dialogue_intent": "<what they mean to get across, one sentence, not the literal line>",
      "arc_id": "<open arc id this belongs to, or null>",
      "significance_hint": 0.0-1.0,
      "canon_deltas": [ ... ]
    }
  ],
  "note": "<optional, ignored by canon>"
}

RULES THAT WILL GET YOU REJECTED IF BROKEN
- 1 to ${MAX_DIRECTIVES_PER_TICK} directives. Usually 1 or 2. A quiet tick is a valid tick.
- Use ONLY character ids that appear in the cast. Do not invent people.
- Use ONLY arc ids that appear in open arcs, unless you are opening one with arc_open.
- An actor may not target themselves.
- greet_visitor and recruit_visitor REQUIRE a "fan:<id>" target.
- dialogue_intent is intent, not dialogue. The characters speak for themselves.

CANON DELTAS (the only way you may change the world)
  {"op":"relationship_delta","from_id":"a","to_id":"b","affinity":-10,"trust":-5,"tension":8,"note":"why, one line"}
  {"op":"arc_open","arc_id":"arc_x","title":"...","participants":["a","b"],"summary":"...","tension":20}
  {"op":"arc_advance","arc_id":"arc_x","stage_delta":1,"tension":10,"summary":"updated state of play"}
  {"op":"arc_resolve","arc_id":"arc_x","resolution":"how it ended"}
  {"op":"visitor_stance","fan_id":"f1","character_id":"a","sentiment":15,"moment":"what they'll remember","moment_weight":0.8}
    NOTE: fan_id takes the BARE id ("f1"), not the "fan:f1" form used in target/actors.
  {"op":"character_mood","character_id":"a","mood":"one or two words"}
  {"op":"world_fact","statement":"a durable fact","about":["a"]}

Movement is clamped: affinity/trust +/-25, tension +/-30, stance +/-30 per tick.
Do not try to swing a relationship from hatred to love in one step. Grudges are
earned slowly and that is the point.

WRITE FOR CONTINUITY
- Advance an existing arc rather than opening a new one, unless the existing
  ones are genuinely spent.
- If a visitor is on record, their standing is real. An ally is greeted as an
  ally. Someone who sided against a character is remembered for it.
- When a character refers to something that happened, it must be something in
  the events you were shown. Do not invent history. You will be checked.`;
}

/** Wraps a compiled digest in the protocol. */
export function buildTickPrompt(digestText: string): string {
  return `${protocolPreamble()}

=== DIGEST ===
${digestText}
=== END DIGEST ===

Decide what happens next. JSON only.`;
}

/** Prompt for a visitor's first contact with the district. */
export function buildOnboardPrompt(digestText: string, fanId: string, displayName: string): string {
  return `${protocolPreamble()}

=== DIGEST ===
${digestText}
=== END DIGEST ===

A visitor has just arrived: fan:${fanId}${displayName ? ` ("${displayName}")` : ""}.
They have no standing with anyone yet.

Produce 1-2 directives in which one or two members of the cast register the
visitor's arrival in a way that is in character and that reflects the current
state of the arcs. At least one directive must carry a visitor_stance delta with
a "moment" -- something this visitor will be able to be reminded of later.

JSON only.`;
}

/** Prompt for a visitor action (taking a side, speaking, giving). */
export function buildFanEventPrompt(
  digestText: string,
  fanId: string,
  what: string,
): string {
  return `${protocolPreamble()}

=== DIGEST ===
${digestText}
=== END DIGEST ===

fan:${fanId} just did this: ${what}

Produce 1-3 directives showing how the cast reacts. Reactions must be
asymmetric: whoever benefits warms, whoever loses cools. Carry visitor_stance
deltas so the standing actually moves, and give at least one of them a "moment"
so it can be recalled later.

JSON only.`;
}
