import { describe, expect, it } from "vitest";
import { rankSignificance, evidenceScore, HINT_BAND } from "../src/canon/significance.js";

/**
 * SCHEMA.md and types/events.ts both promised canon re-ranks significance on
 * read so a host cannot flatter its way into permanent memory. For a long time
 * no such re-ranking existed and every read site used the raw hint. These tests
 * are the guarantee, so the document and the code cannot drift apart again.
 */
const ev = (over: Record<string, unknown> = {}) =>
  ({ type: "rumor_spread", actors: ["a"], significance_hint: 0.5, ...over }) as never;

describe("canon re-ranks significance on read", () => {
  it("caps a host that marks its own trivial beat as a landmark", () => {
    const flattered = rankSignificance(ev({ type: "rumor_spread", significance_hint: 0.99 }));
    const real = rankSignificance(ev({ type: "alliance_broken", actors: ["a", "b"], significance_hint: 0.5 }));
    expect(flattered).toBeLessThan(real);
  });

  it("never lets the hint move the score more than the band", () => {
    for (const hint of [0, 0.25, 0.5, 0.75, 1]) {
      const e = ev({ significance_hint: hint });
      const gap = Math.abs(rankSignificance(e) - evidenceScore(e));
      expect(gap).toBeLessThanOrEqual(HINT_BAND + 1e-9);
    }
  });

  it("still lets an honest hint matter within that band", () => {
    const low = rankSignificance(ev({ significance_hint: 0.0 }));
    const high = rankSignificance(ev({ significance_hint: 1.0 }));
    expect(high).toBeGreaterThan(low);
  });

  it("rewards uptake: an event other beats cite outranks one nobody mentions", () => {
    const ignored = rankSignificance(ev({}), { citedBy: 0 });
    const cited = rankSignificance(ev({}), { citedBy: 3 });
    expect(cited).toBeGreaterThan(ignored);
  });

  it("saturates uptake so one anecdote cannot dominate forever", () => {
    const a = rankSignificance(ev({}), { citedBy: 4 });
    const b = rankSignificance(ev({}), { citedBy: 40 });
    expect(b - a).toBeLessThan(0.05);
  });

  it("counts a two-party event above a solo one, all else equal", () => {
    expect(evidenceScore(ev({ actors: ["a", "b"] }))).toBeGreaterThan(evidenceScore(ev({ actors: ["a"] })));
  });

  it("treats bookkeeping as bookkeeping however it is labelled", () => {
    expect(rankSignificance(ev({ type: "tick_skipped", significance_hint: 1 }))).toBeLessThan(0.3);
    expect(rankSignificance(ev({ type: "directive_rejected", significance_hint: 1 }))).toBeLessThan(0.3);
  });

  it("stays inside 0.05..0.95 for every combination", () => {
    for (const type of ["alliance_broken", "tick_skipped", "visitor_pledged", "unknown_type"]) {
      for (const hint of [0, 0.5, 1]) {
        for (const citedBy of [0, 10]) {
          const v = rankSignificance(ev({ type, significance_hint: hint }), { citedBy, changedState: true });
          expect(v).toBeGreaterThanOrEqual(0.05);
          expect(v).toBeLessThanOrEqual(0.95);
        }
      }
    }
  });
});

describe("provenance is evidence the host does not control", () => {
  const base = { type: "notice_posted", actors: ["a", "b"], significance_hint: 0.5 } as never;

  it("ranks a beat from the owner's real feed above the same beat invented", () => {
    const invented = rankSignificance({ ...(base as object), source: "tick" } as never);
    const real = rankSignificance({ ...(base as object), source: "ingest" } as never);
    expect(real).toBeGreaterThan(invented);
  });

  it("treats day-zero seed canon as scaffolding, not as something that happened", () => {
    const seeded = rankSignificance({ ...(base as object), source: "seed" } as never);
    const happened = rankSignificance({ ...(base as object), source: "tick" } as never);
    expect(seeded).toBeLessThan(happened);
  });
});

/**
 * DEFECT 1 REGRESSION GUARD.
 *
 * The evidence model was correct and completely disconnected: all seven call
 * sites passed a single argument, so `citedBy` defaulted to 0 and
 * `changedState` to false everywhere. Measured against the live log, a genuine
 * confrontation scored 0.830 context-less and 0.850 with effect and two
 * citations -- a 0.02 spread between "this mattered" and "nothing is known
 * about this". These assert the spread is now worth having.
 */
describe("context is supplied, not defaulted", () => {
  const confrontation = {
    type: "confrontation", actors: ["a", "b"], significance_hint: 0.5, source: "tick",
  } as never;

  it("separates a cited, effective event from an inert one by a usable margin", () => {
    const inert = rankSignificance(confrontation);
    const mattered = rankSignificance(confrontation, { citedBy: 2, changedState: true });
    expect(mattered - inert).toBeGreaterThan(0.12);
  });

  it("a hold cannot outrank a real confrontation however it is hinted", () => {
    const flatteredHold = rankSignificance({
      type: "arc_advanced", actors: ["a"], significance_hint: 0.85,
      payload: { action: "hold" },
    } as never);
    expect(flatteredHold).toBeLessThan(rankSignificance(confrontation));
    // 31 of 80 holds in the live log cleared the 0.45 clip bar before this.
    expect(flatteredHold).toBeLessThan(0.45);
  });

  it("a hold that somehow gets cited still stays out of the clip drafts", () => {
    const cited = rankSignificance(
      { type: "arc_advanced", actors: ["a"], significance_hint: 0.85, payload: { action: "hold" } } as never,
      { citedBy: 3, changedState: true },
    );
    expect(cited).toBeLessThan(0.45);
  });
});
