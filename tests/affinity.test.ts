import { describe, expect, it, beforeAll } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import { patrolVisit, PATROL_PROFILES } from "../src/tick/patrol.js";
import { runTick } from "../src/tick/runTick.js";
import { computeAffinity, computeAll, WEIGHTS } from "../src/affinity/model.js";
import type { AffinityReport } from "../src/affinity/model.js";

/**
 * The patrol is used here as a FIXTURE. Its four profiles have known,
 * contrasting behaviour, so they double as unit tests for whether the metric
 * discriminates at all -- which is the spec's T2 and T3.
 */
let reports: Record<string, AffinityReport>;

beforeAll(async () => {
  const clock = new VirtualClock("2026-07-01T08:00:00.000Z");
  const repo = CanonRepo.open(":memory:", clock);
  seedWorld(repo);
  const host = await startHostRuntime({ ...loadConfig(), host: "mock" });
  const ctx = {
    repo, host, surface: new MemorySurface(), clock,
    dailyBudget: 999999, advanceMs: 4 * HOUR_MS,
  };
  /**
   * SEEDED. `patrolVisit` defaults `rand` to Math.random, so an unpinned
   * fixture makes the profiles non-deterministic -- on some runs the drifter
   * pledges more often than the partisan and T2 fails for no reason at all.
   * The patrol is random BY DESIGN in production and must be pinned in a test.
   */
  let seed = 20260822;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (let round = 0; round < 8; round++) {
    for (const p of PATROL_PROFILES) {
      await patrolVisit(p, { ctx, rand });
      clock.advance(3 * HOUR_MS);
    }
    await runTick(ctx);
    clock.advance(14 * HOUR_MS);
  }
  reports = Object.fromEntries(computeAll(repo, "all").map((r) => [r.fanId, r]));
  await host.close();
  repo.close();
}, 120_000);

describe("the affinity model discriminates between behaviours", () => {
  it("T2 — profile separation: partisan > drifter > lurker on commitment", () => {
    expect(reports.sim_partisan!.D.value).toBeGreaterThan(reports.sim_drifter!.D.value);
    expect(reports.sim_drifter!.D.value).toBeGreaterThan(reports.sim_lurker!.D.value);
    expect(reports.sim_lurker!.D.value).toBeCloseTo(0, 2);
  });

  it("T3 — the repetition discount fires: a partisan's recall is docked for sameness", () => {
    const r = reports.sim_partisan!;
    // The world keeps citing the same pledge, so distinct << grounded.
    expect(Number(r.R.detail.distinct)).toBeLessThan(Number(r.R.detail.grounded));
    expect(Number(r.R.detail.freshness)).toBeLessThan(0.8);
    // And that is what holds R down, not coverage.
    expect(Number(r.R.detail.coverage)).toBeGreaterThan(Number(r.R.detail.freshness));
  });

  it("a lurker who never pledges earns no grounded recall", () => {
    expect(reports.sim_lurker!.R.value).toBe(0);
  });

  it("tags every patrol visitor synthetic, so nothing merges them into a cohort", () => {
    for (const p of PATROL_PROFILES) expect(reports[p.id]!.synthetic).toBe(true);
  });

  it("gates a returning visitor at 1.0 using the same threshold the fiction uses", () => {
    expect(reports.sim_partisan!.gate).toBe(1);
    expect(reports.sim_partisan!.gateLabel).toBe("returned");
  });

  it("reports undefined measurements as undefined, never as a neutral value", () => {
    // A single-session visitor has no gaps, so trend is not measurable. It must
    // come back undefined rather than 0.5 -- substituting a neutral value for a
    // missing measurement is how a metric starts lying.
    const clock = new VirtualClock("2026-07-01T08:00:00.000Z");
    const repo = CanonRepo.open(":memory:", clock);
    seedWorld(repo);
    repo.ensureVisitor("solo", "Solo");
    const r = computeAffinity(repo, "solo", "all");
    expect(r.C.detail.trend).toBeUndefined();
    expect(r.F.detail.depthDecay).toBeUndefined();
    repo.close();
  });

  it("keeps affinity inside 0..1 for every profile", () => {
    for (const r of Object.values(reports)) {
      expect(r.affinity).toBeGreaterThanOrEqual(0);
      expect(r.affinity).toBeLessThanOrEqual(1);
    }
  });

  it("publishes weights that sum to 1, so the score is a weighted mean", () => {
    expect(WEIGHTS.C + WEIGHTS.R + WEIGHTS.D).toBeCloseTo(1, 9);
  });

  it("fatigue is a max, so one catastrophic signal cannot be averaged away", () => {
    const r = reports.sim_lurker!;
    const parts = [r.F.detail.hollow, r.F.detail.staleness, r.F.detail.gapLengthening]
      .map((v) => Number(v ?? 0));
    expect(r.F.value).toBeCloseTo(Math.max(...parts), 6);
  });
});
