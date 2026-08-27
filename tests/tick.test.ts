import { describe, expect, it } from "vitest";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { TickScheduler } from "../src/tick/scheduler.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { HOUR_MS } from "../src/clock.js";
import type { HostRequest, HostResponse, HostRuntime } from "../src/host/HostRuntime.js";
import { freshWorld } from "./helpers.js";
import { compileDigest } from "../src/canon/digest.js";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { VirtualClock } from "../src/clock.js";

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

/**
 * The digest is what the host is billed for, so what goes in it is a cost
 * decision as much as a correctness one. Shipping the whole relationship mesh
 * made prompt size grow faster than the cast (5.3x cast -> 7.38x bytes) and put
 * a hard ceiling on how large an IP this could hold.
 */
describe("the digest carries only the edges in play", () => {
  it("drops edges between characters nothing is happening to", () => {
    const { repo } = freshWorld();
    const cast = repo.getCharacters().map((c) => c.character_id);

    // A fourth character nobody is interacting with, fully connected.
    repo.upsertCharacter({
      character_id: "bystander", name: "Bystander", faction: "None", title: "",
      brief: "", goals: [], taboos: [],
      voice: { register: "plain", tics: [], max_words: 28 },
      mood: "even", home_location: "district",
    });
    for (const c of cast) {
      repo.upsertRelationship({ from_id: "bystander", to_id: c, affinity: 0, trust: 50, tension: 0, note: "", last_event_id: null });
      repo.upsertRelationship({ from_id: c, to_id: "bystander", affinity: 0, trust: 50, tension: 0, note: "", last_event_id: null });
    }

    const all = repo.getRelationships().length;
    const d = compileDigest(repo, { tickNo: 1, sinceSeq: 0, dailyBudget: 12 });

    expect(d.relationships.length).toBeLessThan(all);
    expect(d.relationships.some((r) => r.from === "bystander" || r.to === "bystander")).toBe(false);
    repo.close();
  });

  it("falls back to the whole mesh rather than sending the host nothing", () => {
    const { repo } = freshWorld();
    // Nothing in play: no open arcs, no log to speak of, no visitors.
    for (const a of repo.getArcs("open")) repo.upsertArc({ ...a, status: "resolved" });
    for (const a of repo.getArcs("escalating")) repo.upsertArc({ ...a, status: "resolved" });

    const d = compileDigest(repo, { tickNo: 1, sinceSeq: 999_999, dailyBudget: 12 });
    expect(d.relationships.length).toBeGreaterThan(0);
    repo.close();
  });
});

/**
 * Opening a persisted world twice used to kill every warm-up tick.
 *
 * Event ids are `evt_<ms base36>_<counter>` and both halves repeat: the counter
 * is per-process and starts at zero, and under a VirtualClock the timestamps
 * are a pure function of the seed. `runTick` absorbed the UNIQUE violation
 * exactly as designed, so the world stopped moving and said nothing about why.
 */
describe("a persisted world survives being opened twice", () => {
  it("appends rather than colliding on a regenerated event id", () => {
    const db = join(tmpdir(), `inspiral-collide-${process.pid}.db`);
    rmSync(db, { force: true });

    const run = (): number => {
      const repo = CanonRepo.open(db, new VirtualClock("2026-03-01T09:00:00.000Z"));
      seedWorld(repo);
      for (let i = 0; i < 5; i++) {
        repo.appendEvent({
          source: "system", actors: ["x"], type: "notice_posted",
          payload: { summary: `n${i}` }, significance_hint: 0.5,
        });
      }
      const n = repo.allEvents().length;
      repo.close();
      return n;
    };

    const first = run();
    const second = run(); // same clock, same seed, same ids proposed
    expect(second).toBe(first + 5);
    rmSync(db, { force: true });
  });
});
