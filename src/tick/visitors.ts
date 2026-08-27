/**
 * MANY FANS, ONE WARD.
 *
 * The pitch is that fans are there together, which chat's one-fan-one-window
 * cannot do. Canon was already ready for it -- every visitor call takes a
 * fanId, standing is per visitor, interactions are per visitor -- so the only
 * things missing were an identity per connection and an arrival path that does
 * not cost an invocation every time somebody walks back in.
 *
 * Additive on purpose: runTick.ts is untouched, so this cannot collide with
 * the ingestion work landing alongside it.
 */

import type { TickContext, TickOutcome } from "./runTick.js";
import { onboardVisitor, visitorAction } from "./runTick.js";
import { performDirective, type RenderedBehavior } from "../runtime/character.js";
import type { SurfaceAdapter } from "../runtime/surface.js";
import { log } from "../log.js";

export interface VisitorIdentity {
  id: string;
  name: string;
}

/** Fans get a name each so two people in the ward are told apart on sight. */
export const VISITOR_POOL: VisitorIdentity[] = [
  { id: "wren", name: "Wren" },
  { id: "ash", name: "Ash" },
  { id: "juno", name: "Juno" },
  { id: "pell", name: "Pell" },
];

export interface ArriveResult {
  outcome: TickOutcome;
  /** True when we greeted them without spending a host invocation. */
  cached: boolean;
  first: boolean;
}

const greetKey = (id: string) => `greeting:${id}`;

/**
 * What the cast would have to say to this visitor, as a cheap string.
 *
 * Deliberately NOT the log's high-water mark. A visitor's own arrival and
 * departure are events too, so plain maxSeq() changes every time they walk out
 * of the door -- which made every return look like the ward had moved and
 * defeated the whole point. What counts is whether the CAST did anything: the
 * last event with a character in it. Their own standing is folded in so that a
 * side they took themselves also invalidates the greeting.
 */
function fingerprint(ctx: TickContext, fanId: string): string {
  const events = ctx.repo.allEvents();
  let lastCastEvent = "";
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.actors.some((a) => !a.startsWith("fan:"))) {
      lastCastEvent = events[i]!.event_id;
      break;
    }
  }
  const stance = Object.entries(ctx.repo.getStance(fanId))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${Math.round(v)}`)
    .join(",");
  return `${lastCastEvent}|${stance}`;
}

interface StoredGreeting {
  fp: string;
  behaviors: RenderedBehavior[];
}

/** Record what the cast said, so an unchanged return can replay it for free. */
function remember(ctx: TickContext, fanId: string, behaviors: RenderedBehavior[]): void {
  if (!behaviors.length) return;
  const stored: StoredGreeting = { fp: fingerprint(ctx, fanId), behaviors };
  ctx.repo.setMeta(greetKey(fanId), JSON.stringify(stored));
}

function recall(ctx: TickContext, fanId: string): StoredGreeting | null {
  const raw = ctx.repo.getMeta(greetKey(fanId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredGreeting;
  } catch {
    return null;
  }
}

/**
 * Wrap a surface so we can see what the cast actually said without changing
 * how anything downstream works.
 */
function recording(ctx: TickContext): { ctx: TickContext; seen: RenderedBehavior[] } {
  const seen: RenderedBehavior[] = [];
  const inner = ctx.surface;
  if (!inner) return { ctx, seen };

  // Everything delegates; only present() is observed on the way past.
  const proxy: SurfaceAdapter = {
    ...inner,
    name: inner.name,
    present: (b: RenderedBehavior) => {
      seen.push(b);
      return inner.present(b);
    },
  };
  return { ctx: { ...ctx, surface: proxy }, seen };
}

/**
 * NOBODY WAITS ON A MODEL.
 *
 * The measured latency of a live Mind is 40-166 s, median ~75 s. That is fine
 * for deciding what a district does over the next four hours and unusable for
 * somebody standing in the doorway. The architecture already separates the two
 * -- the host decides beats, the character runtime renders them locally and for
 * free -- but `visitorArrive` used to await the host anyway, which put the
 * whole latency budget in front of a human on their first visit and on any
 * return to a ward that had moved.
 *
 * With `immediate`, arrival is served from canon in single-digit milliseconds
 * and the host call runs behind it. Whatever the Mind decides lands on a later
 * beat, which is also how the fiction works: people react in world time, not
 * in chat time.
 *
 * The greeter is whoever is most disposed towards this visitor, and the line
 * they say is the same locally-rendered fallback the runtime already uses when
 * the host returns nothing usable. No new authoring, no new prose path.
 */
function greetNow(ctx: TickContext, who: VisitorIdentity): RenderedBehavior | undefined {
  const { repo } = ctx;
  const cast = repo.getCharacters();
  if (!cast.length) return undefined;

  const stance = repo.getStance(who.id);
  const greeter =
    cast
      .filter((c) => (stance[c.character_id] ?? 0) > 0)
      .sort((a, b) => (stance[b.character_id] ?? 0) - (stance[a.character_id] ?? 0))[0] ?? cast[0]!;

  return performDirective(repo, {
    actor: greeter.character_id,
    action: "greet_visitor",
    target: `fan:${who.id}`,
    // No `speech`: that is the host's job, and its absence is exactly what
    // makes the runtime fall back to a canon-grounded opener. `npm run
    // authorship` counts these honestly rather than crediting them to a Mind.
    dialogue_intent: "notices them come in and marks it",
    canon_deltas: [],
    arc_id: null,
    significance_hint: 0.2,
  });
}

/**
 * Somebody walks in. First visit onboards; a return is only worth an
 * invocation if the ward has moved since they left.
 *
 * `immediate` is opt-in rather than the default because the tick loop, the
 * patrol and the tests all want the host's answer before they continue -- they
 * are measuring it. Only a live human needs the door opened before the model
 * has finished thinking, so only the live surfaces ask for it.
 */
export async function visitorArrive(
  ctx: TickContext,
  who: VisitorIdentity,
  opts: { immediate?: boolean } = {},
): Promise<ArriveResult> {
  const { repo } = ctx;
  const first = !repo.visitorExists(who.id);
  repo.setPresence(who.id, true);

  const stale = !first && recall(ctx, who.id)?.fp !== fingerprint(ctx, who.id);

  if (opts.immediate && (first || stale)) {
    /**
     * Start the host call but do NOT await it. Both entry points run
     * synchronously up to their own first `await` -- registering the visitor
     * and appending the arrival event -- so by the time this expression
     * returns a promise, canon already has the arrival on the record. That is
     * load-bearing, not incidental: the session row below depends on it.
     */
    const rec = recording(ctx);
    const pending = first
      ? onboardVisitor(rec.ctx, who.id, who.name)
      : visitorAction(rec.ctx, who.id, "returned to the ward after days away");
    pending
      // Cache what the host eventually said, not what we said while waiting for
      // it. Otherwise the next unchanged return replays the thin local opener
      // instead of the beat the Mind actually wrote.
      .then(() => remember(ctx, who.id, rec.seen))
      .catch((e) => log.warn(`background greeting for ${who.name} failed: ${(e as Error).message}`));

    const arrival = repo
      .recentEvents(8)
      .filter((e) => e.type === "visitor_arrived" && e.actors.includes(`fan:${who.id}`))
      .at(-1);
    repo.openSession(who.id, arrival?.event_id ?? "", false);

    const now = greetNow(ctx, who);
    if (now) await ctx.surface?.present(now);

    return {
      outcome: { status: "applied", applied: [], repaired: false, hostLatencyMs: 0 },
      cached: false,
      first,
    };
  }

  if (first) {
    const rec = recording(ctx);
    const outcome = await onboardVisitor(rec.ctx, who.id, who.name);
    remember(ctx, who.id, rec.seen);
    repo.openSession(who.id, arrivalEventId(outcome), false);
    return { outcome, cached: false, first: true };
  }

  const stored = recall(ctx, who.id);
  if (stored && stored.fp === fingerprint(ctx, who.id)) {
    // Nothing has happened since they left. Say the same thing, for free.
    // This is the HOLLOW RETURN, and the session records it as such: it is the
    // f1 fatigue term and the thing T4 predicts the rate of in advance.
    const cachedArrival = repo.appendEvent({
      source: "visitor",
      actors: [`fan:${who.id}`],
      type: "visitor_arrived",
      payload: { summary: `${who.name} came back. Nothing had changed since they left.` },
      significance_hint: 0.05,
    });
    repo.openSession(who.id, cachedArrival.event_id, true);
    for (const b of stored.behaviors) await ctx.surface?.present(b);
    log.info(`${who.name} returned to an unchanged ward -- replayed, no invocation spent`);
    return {
      outcome: { status: "applied", applied: [], repaired: false, hostLatencyMs: 0 },
      cached: true,
      first: false,
    };
  }

  const rec = recording(ctx);
  const outcome = await visitorAction(rec.ctx, who.id, "returned to the ward after days away");
  remember(ctx, who.id, rec.seen);
  repo.openSession(who.id, arrivalEventId(outcome), false);
  return { outcome, cached: false, first: false };
}

/** Somebody does something consequential. Always worth an invocation. */
export async function visitorDoes(
  ctx: TickContext,
  who: VisitorIdentity,
  what: string,
): Promise<TickOutcome> {
  const rec = recording(ctx);
  const outcome = await visitorAction(rec.ctx, who.id, what);
  // Their standing just moved, so the stored greeting is stale by definition.
  ctx.repo.setMeta(greetKey(who.id), "");
  return outcome;
}

/**
 * The id of the arrival that opened a session. A skipped tick has no applied
 * directives, so the session still opens -- the visit happened even if the host
 * did not answer -- just without an anchor event.
 */
function arrivalEventId(outcome: TickOutcome): string {
  return outcome.status === "applied" ? (outcome.applied[0]?.event.event_id ?? "") : "";
}

/** Somebody leaves. Free. */
export function visitorLeaves(ctx: TickContext, who: VisitorIdentity): void {
  ctx.repo.setPresence(who.id, false);
  ctx.repo.closeSession(who.id);
  ctx.repo.appendEvent({
    source: "visitor",
    actors: [`fan:${who.id}`],
    type: "visitor_departed",
    payload: { summary: `${who.name} left the ward.` },
    significance_hint: 0.2,
  });
}
