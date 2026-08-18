import { describe, expect, it } from "vitest";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { TickScheduler } from "../src/tick/scheduler.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { HOUR_MS } from "../src/clock.js";
import type { HostRequest, HostResponse, HostRuntime } from "../src/host/HostRuntime.js";
import { freshWorld } from "./helpers.js";

function ctxFor(
  host: HostRuntime,
  opts: { dailyBudget?: number } = {},
): TickContext & { surface: MemorySurface; close: () => void } {
  const { repo, clock } = freshWorld();
  const surface = new MemorySurface();
  return {
    repo,
    host,
    surface,
    clock,
    dailyBudget: opts.dailyBudget ?? 100,
    advanceMs: 4 * HOUR_MS,
    close: () => repo.close(),
  };
}

describe("the tick loop", () => {
  it("applies directives and writes events", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    const before = ctx.repo.eventCount();

    const outcome = await runTick(ctx);

    expect(outcome.status).toBe("applied");
    expect(ctx.repo.eventCount()).toBeGreaterThan(before);
    expect(ctx.surface.presented.length).toBeGreaterThan(0);
    ctx.close();
  });

  it("moves canon -- relationships actually change", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 3 }));
    const before = ctx.repo.getRelationships().map((r) => `${r.from_id}${r.to_id}${r.affinity}${r.tension}`);

    for (let i = 0; i < 4; i++) await runTick(ctx);

    const after = ctx.repo.getRelationships().map((r) => `${r.from_id}${r.to_id}${r.affinity}${r.tension}`);
    expect(after).not.toEqual(before);
    ctx.close();
  });

  it("advances world time", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    const t0 = ctx.repo.now();
    await runTick(ctx);
    expect(Date.parse(ctx.repo.now())).toBeGreaterThan(Date.parse(t0));
    ctx.close();
  });

  it("accumulates history with no visitor present at all", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 7 }));
    for (let i = 0; i < 12; i++) await runTick(ctx);

    expect(ctx.repo.listVisitors()).toHaveLength(0);
    // Seed writes 5; twelve ticks must have produced considerably more.
    expect(ctx.repo.eventCount()).toBeGreaterThan(15);
    ctx.close();
  });

  it("is deterministic for a given seed", async () => {
    const run = async (): Promise<string[]> => {
      const ctx = ctxFor(new MockHostRuntime({ seed: 42 }));
      for (let i = 0; i < 5; i++) await runTick(ctx);
      const summaries = ctx.repo.allEvents().map((e) => `${e.type}:${e.actors.join(",")}`);
      ctx.close();
      return summaries;
    };
    expect(await run()).toEqual(await run());
  });
});

describe("the tick loop degrades instead of crashing", () => {
  it("replays the last directives when the host times out", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1, failOn: { 2: "timeout" } }));

    const first = await runTick(ctx);
    expect(first.status).toBe("applied");

    const second = await runTick(ctx);
    expect(second.status).toBe("replayed");
    if (second.status === "replayed") expect(second.reason).toBe("timeout");

    // A skipped tick is recorded in the log, not swallowed.
    expect(ctx.repo.allEvents().some((e) => e.type === "tick_skipped")).toBe(true);
    ctx.close();
  });

  it("does not let a replay ratchet relationships", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1, failOn: { 2: "timeout", 3: "timeout" } }));
    await runTick(ctx);
    const afterFirst = ctx.repo.getRelationships().map((r) => r.affinity);
    await runTick(ctx);
    await runTick(ctx);
    const afterReplays = ctx.repo.getRelationships().map((r) => r.affinity);
    expect(afterReplays).toEqual(afterFirst);
    ctx.close();
  });

  it("re-prompts once on malformed JSON and accepts the repair", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1, failOn: { 1: "malformed" } }));

    const outcome = await runTick(ctx);

    expect(outcome.status).toBe("applied");
    if (outcome.status === "applied") expect(outcome.repaired).toBe(true);
    // The rejection is itself logged.
    expect(ctx.repo.allEvents().some((e) => e.type === "directive_rejected")).toBe(true);
    // Exactly two host calls: the original and one repair. Never two repairs.
    expect(ctx.repo.totalHostInvocations()).toBe(2);
    ctx.close();
  });

  it("re-prompts once when the host invents a character", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1, failOn: { 1: "bad-reference" } }));
    const outcome = await runTick(ctx);
    expect(outcome.status).toBe("applied");
    if (outcome.status === "applied") expect(outcome.repaired).toBe(true);
    // The invented character never reached canon.
    expect(ctx.repo.characterExists("lord_nonexistent")).toBe(false);
    ctx.close();
  });

  it("survives a host that only ever errors", async () => {
    const failOn: Record<number, "error"> = {};
    for (let i = 1; i <= 6; i++) failOn[i] = "error";
    const ctx = ctxFor(new MockHostRuntime({ seed: 1, failOn }));

    for (let i = 0; i < 6; i++) {
      const outcome = await runTick(ctx);
      expect(["replayed", "skipped"]).toContain(outcome.status);
    }
    // Still a consistent world.
    expect(ctx.repo.getCharacters()).toHaveLength(3);
    ctx.close();
  });

  it("never throws, even when the host throws", async () => {
    const exploding: HostRuntime = {
      name: "exploding",
      async init() {},
      async ask(): Promise<HostResponse> {
        throw new Error("kaboom");
      },
      async budgetRemaining() {
        return undefined;
      },
      async close() {},
    };
    const ctx = ctxFor(exploding);
    const outcome = await runTick(ctx);
    expect(outcome.status).toBe("skipped");
    ctx.close();
  });

  it("stops calling the host once the daily budget is spent", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }), { dailyBudget: 3 });

    for (let i = 0; i < 6; i++) await runTick(ctx);

    // Budget is enforced on a 24h window and ticks here are 4h apart, so all
    // six fall inside it. Never more than the cap.
    expect(ctx.repo.totalHostInvocations()).toBeLessThanOrEqual(3);
    ctx.close();
  });
});

describe("visitors", () => {
  it("records an arrival and gives the visitor standing", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));

    const outcome = await onboardVisitor(ctx, "wren", "Wren");

    expect(outcome.status).toBe("applied");
    expect(ctx.repo.visitorExists("wren")).toBe(true);
    const stance = ctx.repo.getStance("wren");
    expect(Object.keys(stance).length).toBeGreaterThan(0);
    ctx.close();
  });

  it("turns taking a side into asymmetric standing", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    await onboardVisitor(ctx, "wren", "Wren");
    ctx.clock!.advance(3 * HOUR_MS);

    await visitorAction(ctx, "wren", "backed okonkwo against vance in front of the whole ward");

    const stance = ctx.repo.getStance("wren");
    expect(stance.okonkwo!).toBeGreaterThan(0);
    expect(stance.vance!).toBeLessThan(0);
    ctx.close();
  });

  it("does not let the cast greet a visitor who has left", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    await onboardVisitor(ctx, "wren", "Wren");
    ctx.repo.setPresence("wren", false);

    const before = ctx.repo.allEvents().length;
    for (let i = 0; i < 6; i++) await runTick(ctx);

    const greetedWhileAway = ctx.repo
      .allEvents()
      .slice(before)
      .filter((e) => e.actors.includes("fan:wren"));
    expect(greetedWhileAway).toHaveLength(0);
    ctx.close();
  });

  it("remembers a returning visitor and cites a real event", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    await onboardVisitor(ctx, "wren", "Wren");
    ctx.clock!.advance(3 * HOUR_MS);
    await visitorAction(ctx, "wren", "backed okonkwo against vance in front of the whole ward");
    ctx.repo.setPresence("wren", false);

    // Days pass. The world keeps moving without them.
    for (let i = 0; i < 18; i++) await runTick(ctx);

    ctx.repo.setPresence("wren", true);
    const before = ctx.surface.presented.length;
    await visitorAction(ctx, "wren", "returned to the ward after days away");
    const behaviors = ctx.surface.presented.slice(before);

    const citing = behaviors.filter((b) => b.cites.length > 0);
    expect(citing.length).toBeGreaterThan(0);

    // EVERY citation must resolve to a real event that predates the greeting.
    const now = Date.parse(ctx.repo.now());
    for (const b of citing) {
      for (const id of b.cites) {
        const evt = ctx.repo.getEvent(id);
        expect(evt, `cited event ${id} must exist in the log`).toBeDefined();
        expect(Date.parse(evt!.ts)).toBeLessThanOrEqual(now);
      }
    }
    ctx.close();
  });
});

describe("the event log is append-only", () => {
  it("refuses UPDATE", () => {
    const { repo } = freshWorld();
    const id = repo.allEvents()[0]!.event_id;
    expect(() =>
      repo.db.prepare("UPDATE events SET type = 'forged' WHERE event_id = ?").run(id),
    ).toThrow(/append-only/);
    repo.close();
  });

  it("refuses DELETE", () => {
    const { repo } = freshWorld();
    const id = repo.allEvents()[0]!.event_id;
    expect(() => repo.db.prepare("DELETE FROM events WHERE event_id = ?").run(id)).toThrow(
      /append-only/,
    );
    repo.close();
  });
});

describe("the scheduler", () => {
  it("fires on manual trigger", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    const scheduler = new TickScheduler({ ...ctx, intervalMinutes: 240 });

    const outcome = await scheduler.trigger();

    expect(outcome?.status).toBe("applied");
    scheduler.stop();
    ctx.close();
  });

  it("computes the interval from minutes", () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1 }));
    const scheduler = new TickScheduler({ ...ctx, intervalMinutes: 240 });
    expect(scheduler.intervalMs).toBe(4 * 60 * 60 * 1000);
    scheduler.stop();
    ctx.close();
  });

  it("does not overlap ticks", async () => {
    const ctx = ctxFor(new MockHostRuntime({ seed: 1, latencyMs: 30 }));
    const scheduler = new TickScheduler({ ...ctx, intervalMinutes: 240 });

    const [a, b] = await Promise.all([scheduler.trigger(), scheduler.trigger()]);

    // One of the two is refused rather than queued.
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
    scheduler.stop();
    ctx.close();
  });
});
