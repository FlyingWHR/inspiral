import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATROL, PATROL_PROFILES, drawGapMs, predictedCachedRate,
} from "../src/tick/patrol.js";

/**
 * The patrol is a control arm. These tests guard the properties that make it
 * one: memoryless gaps, distinct profiles, synthetic ids that cannot collide
 * with a real or demo visitor, and a cached-greeting rate predicted in advance.
 */
describe("the patrol is a control arm, not a treatment arm", () => {
  it("never uses an id a real or demo visitor could hold", () => {
    // demo.ts hardcodes wren; the visitor pool holds wren/ash/juno/pell. The
    // first patrol wrote to two of those and merged the histories.
    const forbidden = new Set(["wren", "ash", "juno", "pell"]);
    for (const p of PATROL_PROFILES) {
      expect(forbidden.has(p.id)).toBe(false);
      expect(p.id.startsWith("sim_")).toBe(true);
    }
  });

  it("offers contrasting behaviours rather than one curve", () => {
    const targets = new Set(PATROL_PROFILES.map((p) => p.target));
    expect(targets.size).toBeGreaterThanOrEqual(3);
    expect(PATROL_PROFILES.some((p) => p.pledgeChance === 0)).toBe(true);
    expect(PATROL_PROFILES.some((p) => p.pledgeChance > 0.5)).toBe(true);
  });

  it("draws memoryless gaps with the configured mean", () => {
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) sum += drawGapMs(DEFAULT_PATROL) / 3_600_000;
    const mean = sum / N;
    // Floor and cap bias the mean slightly upward; 6h +/- 1h is the honest bar.
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(7.5);
  });

  it("respects the floor and the cap on every draw", () => {
    for (const u of [0, 1e-9, 0.5, 1 - 1e-9, 1]) {
      const h = drawGapMs(DEFAULT_PATROL, () => u) / 3_600_000;
      expect(h).toBeGreaterThanOrEqual(DEFAULT_PATROL.floorMinutes / 60 - 1e-6);
      expect(h).toBeLessThanOrEqual(DEFAULT_PATROL.capHours + 1e-6);
    }
  });

  it("gaps are not a fixed interval, which would make trend zero by construction", () => {
    const seen = new Set(Array.from({ length: 500 }, () => drawGapMs(DEFAULT_PATROL)));
    expect(seen.size).toBeGreaterThan(100);
  });

  /**
   * T4 in the spec. The value matters less than the fact that it was computed
   * before any data existed -- that is what makes the observed rate diagnostic
   * rather than a post-hoc description.
   */
  it("predicts the cached-greeting rate the spec derived", () => {
    expect(predictedCachedRate(6, 3)).toBeCloseTo(0.2131, 4);
  });

  it("agrees with a Monte-Carlo of the same quantity", () => {
    const T = 3, meanGap = 6;
    let hit = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) {
      const gap = -Math.log(1 - Math.random()) * meanGap;
      if (Math.random() * T > gap) hit++;
    }
    expect(hit / N).toBeCloseTo(predictedCachedRate(meanGap, T), 2);
  });

  it("a shorter mean gap means MORE cached greetings", () => {
    // Return sooner and fewer ticks fall inside the gap, so the world is more
    // often unchanged and the stored greeting is replayed. 2h -> 0.48,
    // 12h -> 0.12. (This assertion was written backwards first time; the
    // direction is worth stating explicitly because it is not obvious.)
    expect(predictedCachedRate(2, 3)).toBeGreaterThan(predictedCachedRate(12, 3));
    expect(predictedCachedRate(2, 3)).toBeCloseTo(0.4820, 3);
    expect(predictedCachedRate(12, 3)).toBeCloseTo(0.1152, 3);
  });
});
