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
import type { RenderedBehavior } from "../runtime/character.js";
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
 * Somebody walks in. First visit onboards; a return is only worth an
 * invocation if the ward has moved since they left.
 */
export async function visitorArrive(
  ctx: TickContext,
  who: VisitorIdentity,
): Promise<ArriveResult> {
  const { repo } = ctx;
  const first = !repo.visitorExists(who.id);
  repo.setPresence(who.id, true);

  if (first) {
    const rec = recording(ctx);
    const outcome = await onboardVisitor(rec.ctx, who.id, who.name);
    remember(ctx, who.id, rec.seen);
    return { outcome, cached: false, first: true };
  }

  const stored = recall(ctx, who.id);
  if (stored && stored.fp === fingerprint(ctx, who.id)) {
    // Nothing has happened since they left. Say the same thing, for free.
    repo.appendEvent({
      source: "visitor",
      actors: [`fan:${who.id}`],
      type: "visitor_arrived",
      payload: { summary: `${who.name} came back. Nothing had changed since they left.` },
      significance_hint: 0.05,
    });
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

/** Somebody leaves. Free. */
export function visitorLeaves(ctx: TickContext, who: VisitorIdentity): void {
  ctx.repo.setPresence(who.id, false);
  ctx.repo.appendEvent({
    source: "visitor",
    actors: [`fan:${who.id}`],
    type: "visitor_departed",
    payload: { summary: `${who.name} left the ward.` },
    significance_hint: 0.2,
  });
}
