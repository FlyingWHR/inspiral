/**
 * THE TWO THINGS THE MIND ACTUALLY DOES HERE.
 *
 * Most of this product is retrieval. "Three people built on your work" is a
 * join; the return screen is a query; attribution is a column. Saying so keeps
 * the cost structure honest, and it makes the two places that genuinely need
 * judgement stand out:
 *
 *   ROUTE    which piece to put in front of this person
 *   NARRATE  one sentence on what somebody changed about their work
 *
 * NARRATE is the product. Everything else in `src/pieces/` is storage for that
 * sentence. It is also the thing most likely to kill this: the previous version
 * of this project produced five days of fluent, differently-worded, completely
 * identical confrontations, and nobody noticed because each one read fine on
 * its own. Bland output here fails the same way -- plausible and inert.
 *
 * Both degrade to nothing rather than to something invented. A missing sentence
 * loses a flourish; a fabricated one loses the only thing this product sells.
 */

import type { HostRuntime } from "../host/HostRuntime.js";
import { extractJson } from "../directive/validate.js";
import { CHANGED_MAX, type NarrateRequest, type RouteRequest, type RouteResponse } from "./contract.js";
import { log } from "../log.js";

/**
 * NARRATE.
 *
 * The host sees only the parent and the child, never the whole lineage. Handed
 * the lineage it writes a summary of the piece, and a summary is not what the
 * person waiting wants -- they want to know what THIS person did to THEIR
 * thing.
 *
 * The shape of a good sentence is always the same: name one thing that was
 * KEPT and one thing that was CHANGED. Keeping is what makes the original
 * author feel read rather than overwritten, and it is the half a model will
 * drop first if you do not ask for it explicitly.
 */
function narratePrompt(r: NarrateRequest): string {
  return `Two people are building on each other's work in "${r.piece_title}".

${r.parent_author} wrote:
"""
${r.parent_body}
"""

${r.child_author} then built on it:
"""
${r.child_body}
"""

Write ONE sentence, addressed to ${r.parent_author}, saying what ${r.child_author}
did to their work.

RULES
- Name one specific thing they KEPT and one specific thing they CHANGED.
- Use the actual nouns from the two texts. No paraphrase into generalities.
- Second person: "your", not "${r.parent_author}'s".
- Never praise, never evaluate, never encourage. Report the change.
- No greeting, no preamble, no quotes around it.
- Under ${CHANGED_MAX} characters. One sentence.

GOOD   Maya kept your fennel base and cut it with acid instead of reducing it.
BAD    Maya extended your contribution with an interesting new idea.
BAD    Great news -- someone loved your work and built on it!

Return ONLY the sentence.`;
}

/**
 * One sentence, or nothing.
 *
 * Never throws and never invents. A host that is down, slow, over budget or
 * chatty costs the caller a flourish, not the contribution -- `extendPiece`
 * stores the work whether or not this returns.
 */
export async function narrateChange(
  host: HostRuntime | undefined,
  req: NarrateRequest,
): Promise<string | undefined> {
  if (!host) return undefined;
  try {
    const res = await host.ask({ kind: "narrate", prompt: narratePrompt(req) });
    if (!res.ok) {
      log.warn(`narrate unavailable (${res.reason}); the extension stands without a sentence`);
      return undefined;
    }
    const line = clean(res.text);
    return line || undefined;
  } catch (e) {
    log.warn(`narrate threw, absorbed: ${(e as Error).message}`);
    return undefined;
  }
}

/**
 * Models wrap. They open with "Sure!", they fence, they quote, they add a
 * second sentence of encouragement. Take the first sentence of substance and
 * throw the packaging away rather than rejecting the whole answer -- the same
 * lesson as `prose()`: trimming beats refusing.
 */
function clean(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  t = t.replace(/^["'“]|["'”]$/g, "").trim();
  // Drop a leading "Sure, here's..." style preamble ending in a colon.
  const colon = t.indexOf(":");
  if (colon > 0 && colon < 60 && /^[^.!?]*$/.test(t.slice(0, colon))) t = t.slice(colon + 1).trim();
  /**
   * A host answering the wrong question. Any lane can be handed a model that
   * pattern-matched its history and returned JSON, and a directive batch shown
   * to a reader as "what somebody changed about your work" is worse than
   * silence. Refuse anything structural rather than trimming it into a
   * sentence-shaped fragment.
   */
  if (/^[[{]/.test(t) || /"(actor|action|directives|dialogue_intent)"\s*:/.test(t)) return "";

  const stop = t.search(/[.!?](\s|$)/);
  if (stop !== -1) t = t.slice(0, stop + 1);
  return t.slice(0, CHANGED_MAX).trim();
}

/**
 * ROUTE.
 *
 * Not a sort. The right piece is rarely the newest or the busiest one -- it is
 * the one this person can add something to, and ideally one where somebody is
 * waiting for an answer. A piece with a single lonely extension needs a visitor
 * far more than a piece with nine, and no ORDER BY expresses that.
 */
function routePrompt(r: RouteRequest): string {
  const seen = r.history.length
    ? r.history.map((h) => `- ${h.piece_id}: "${h.body.slice(0, 160)}"`).join("\n")
    : "(they have not made anything here yet)";
  const open = r.pieces
    .map((p) => `- ${p.piece_id} | "${p.title}" | ${p.brief.slice(0, 160)} | ${p.generation} contribution(s)`)
    .join("\n");

  return `Someone has arrived. Choose which open piece to put in front of them.

WHAT THEY HAVE MADE HERE BEFORE
${seen}

OPEN PIECES
${open}

Prefer a piece where their contribution would actually land: one somebody is
waiting on, or one thin enough that an addition changes it. Do not simply pick
the busiest. Do not pick one they have already worked on unless it is clearly
the best fit.

Return ONE JSON object, nothing else:
{"piece_id": "<id from the list>", "because": "<one line, addressed to them, why this one>"}`;
}

/**
 * Which piece, and why. Falls back to the thinnest open piece.
 *
 * The fallback is deliberately not "the newest": a piece nobody has touched is
 * where a contribution matters most, and that heuristic is defensible without a
 * model. Cheap, explicable, and it means routing survives a dead host.
 */
export async function routeVisitor(
  host: HostRuntime | undefined,
  req: RouteRequest,
): Promise<RouteResponse | undefined> {
  const thinnest = [...req.pieces].sort((a, b) => a.generation - b.generation)[0];
  const fallback: RouteResponse | undefined = thinnest
    ? { piece_id: thinnest.piece_id, because: "Nobody has taken this one far yet." }
    : undefined;

  if (!host || req.pieces.length === 0) return fallback;

  try {
    const res = await host.ask({ kind: "route", prompt: routePrompt(req) });
    if (!res.ok) return fallback;
    const json = extractJson(res.text);
    if (!json) return fallback;
    const parsed = JSON.parse(json) as { piece_id?: unknown; because?: unknown };
    const id = typeof parsed.piece_id === "string" ? parsed.piece_id : "";
    // Referential check, same discipline as the directive validator: a host may
    // not route somebody to a piece that does not exist.
    if (!req.pieces.some((p) => p.piece_id === id)) {
      log.warn(`route named an unknown piece '${id}'; using the thinnest instead`);
      return fallback;
    }
    const because = typeof parsed.because === "string" ? parsed.because.slice(0, 240) : "";
    return { piece_id: id, because: because || (fallback?.because ?? "") };
  } catch (e) {
    log.warn(`route threw, absorbed: ${(e as Error).message}`);
    return fallback;
  }
}
