/**
 * THE AFFINITY MODEL.
 *
 * Everyone else counts views. This counts whether somebody came back and was
 * remembered for something they chose to do. That is the one claim this project
 * can make that a reach metric structurally cannot, and canon has been
 * recording the evidence for it in a SQLite table with no instrument pointed
 * at it.
 *
 * Four components over a horizon, combined with weights that are DEFENSIBLE
 * RATHER THAN DERIVED -- there is no data to fit them to, and pretending
 * otherwise would be the same sin as `significance_hint`. The tool prints them
 * on every run so any number it produces is arguable.
 *
 *   A = G * (w_C*C + w_R*R + w_D*D) * (1 - F)
 *
 * The two design choices that carry the most weight:
 *
 * THE REPETITION DISCOUNT. Recall is `coverage * freshness`, where freshness is
 * distinct receipts over total citations. A character that cites the same
 * heroic moment every single visit converges to R = 0, because that is a
 * catchphrase, not a memory. It also means R can only be sustained by a world
 * that keeps generating NEW receipts, which is the incentive we want.
 *
 * FATIGUE IS A MAX, NOT A MEAN. Any single fatigue signal at 1.0 should zero
 * the score. Averaging lets three good signals hide one catastrophic one, which
 * is the exact failure mode this whole exercise is about.
 */

import type { CanonRepo } from "../canon/repo.js";
import { GAP_MS } from "../runtime/character.js";

export const WEIGHTS = { C: 0.4, R: 0.35, D: 0.25 } as const;

export type Horizon = "7d" | "30d" | "all";
const HORIZON_MS: Record<Horizon, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: Number.POSITIVE_INFINITY,
};

export interface Component {
  value: number;
  /** `undefined` means NOT MEASURED, which is never the same as zero. */
  detail: Record<string, number | string | undefined>;
}

export interface AffinityReport {
  fanId: string;
  displayName: string;
  synthetic: boolean;
  profile: string | null;
  horizon: Horizon;
  sessions: number;
  gate: number;
  gateLabel: string;
  C: Component;
  R: Component;
  D: Component;
  F: Component;
  affinity: number;
  flags: string[];
  receipts: { citedEventId: string; character: string; times: number; resolved: boolean }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Three-valued participation gate. Hard 0/1 throws away information at the
 * sample sizes this will actually run at, and the tool prints which applied.
 */
function participationGate(sessionTs: number[], signalCount: number): { g: number; label: string } {
  if (sessionTs.length >= 2) {
    const returned = sessionTs.some((t, i) => i > 0 && t - sessionTs[i - 1]! >= GAP_MS);
    if (returned) return { g: 1, label: "returned" };
  }
  if (signalCount > 0) return { g: 0.5, label: "engaged, not yet returned" };
  return { g: 0.15, label: "stopped, nothing more" };
}

export function computeAffinity(
  repo: CanonRepo,
  fanId: string,
  horizon: Horizon = "all",
): AffinityReport {
  const nowMs = Date.parse(repo.now());
  const cutoff = nowMs - HORIZON_MS[horizon];
  const inH = (ts: string) => Date.parse(ts) >= cutoff;

  const visitor = repo.allVisitors().find((v) => v.fan_id === fanId);
  const sessions = repo.sessionsFor(fanId).filter((s) => inH(s.started_ts));
  const sessionTs = sessions.map((s) => Date.parse(s.started_ts));
  const events = repo.allEvents().filter((e) => inH(e.ts));
  const mine = events.filter((e) => e.actors.some((a) => a === `fan:${fanId}`));

  // --- Signal: things the visitor CHOSE to do -------------------------------
  const signals = mine.filter((e) =>
    ["visitor_pledged", "visitor_spoke", "terrain_altered", "visitor_gifted"].includes(e.type),
  );

  const { g, label } = participationGate(sessionTs, signals.length);
  const flags: string[] = [];

  // --- C: cadence -----------------------------------------------------------
  const gaps: number[] = [];
  for (let i = 1; i < sessionTs.length; i++) gaps.push((sessionTs[i]! - sessionTs[i - 1]!) / 3_600_000);
  const worldDays = sessionTs.length
    ? Math.max(1, (nowMs - Math.min(...sessionTs)) / 86_400_000)
    : 1;
  const expected =
    horizon === "7d" ? 2 : horizon === "30d" ? 6 : Math.max(2, Math.floor(worldDays / 5));
  const freq = Math.min(1, sessions.length / expected);

  let trend: number | undefined;
  let C = freq;
  if (gaps.length >= 3) {
    const half = Math.floor(gaps.length / 2);
    const m1 = median(gaps.slice(0, half));
    const m2 = median(gaps.slice(half));
    trend = clamp((m1 - m2) / Math.max(m1, 1e-9), -1, 1);
    C = 0.7 * freq + 0.3 * (0.5 + 0.5 * trend);
  }

  // --- R: grounded recall, with the repetition discount ---------------------
  const opportunities = events.filter((e) => {
    const p = e.payload as { action?: string; target?: string };
    const isGreet = p.action === "greet_visitor" || p.action === "recruit_visitor";
    return isGreet && (p.target === `fan:${fanId}` || p.target === fanId);
  }).length;

  const recalls = repo.recallCitations().filter((r) => r.fan_id === fanId && inH(r.ts));
  const grounded = recalls.filter((r) => r.resolved === 1 && r.visitor_initiated === 1);
  const distinct = new Set(grounded.map((r) => r.cited_event_id)).size;
  const deliveredEvents = new Set(grounded.map((r) => r.event_id)).size;

  const coverage = opportunities > 0 ? Math.min(1, deliveredEvents / opportunities) : 0;
  const freshness = grounded.length > 0 ? distinct / grounded.length : 0;
  const R = coverage * freshness;

  if (opportunities === 0 && sessions.length >= 2) flags.push("no-recall");
  if (opportunities === 0 && sessions.length <= 1) flags.push("no-return-no-opportunity");

  // --- D: commitment as POLARISATION, not warmth ----------------------------
  // "Taking a side must cost you something with someone." A visitor at +30 with
  // everybody has been agreeable, not committed.
  const cast = repo.getCharacters();
  const stanceMap = repo.getStance(fanId); // Record<characterId, sentiment>
  // A character the visitor has no standing with is a character they have not
  // taken a side about, which is information -- so absent counts as 0.
  const s: number[] = cast.map((c) => stanceMap[c.character_id] ?? 0);
  const mag = s.length ? s.reduce((a, b) => a + Math.abs(b), 0) / s.length / 100 : 0;
  let D = mag;
  let pol: number | undefined;
  if (cast.length > 1) {
    pol = (Math.max(...s) - Math.min(...s)) / 200;
    D = 0.4 * mag + 0.6 * pol;
  } else {
    flags.push("single-character world");
  }

  // --- F: fatigue, adversarial by construction ------------------------------
  const returns = sessions.filter((_, i) => i > 0).length;
  const cachedReturns = sessions.filter((s2, i) => i > 0 && s2.greeting_cached === 1).length;
  const f1 = returns > 0 ? cachedReturns / returns : 0;

  let f2 = 0;
  let depthDecay: number | undefined;
  if (sessions.length >= 3) {
    const third = Math.max(1, Math.floor(sessions.length / 3));
    const early = sessionTs.slice(0, third);
    const late = sessionTs.slice(-third);
    const movementIn = (from: number, to: number) =>
      mine.filter((e) => {
        const t = Date.parse(e.ts);
        return t >= from && t <= to && e.type === "visitor_pledged";
      }).length;
    const a = movementIn(early[0]!, early[early.length - 1]! + GAP_MS);
    const b = movementIn(late[0]!, nowMs);
    f2 = clamp(1 - b / Math.max(1e-9, a), 0, 1);
    depthDecay = f2;
  }

  const f3 = 1 - freshness;
  const f4 = trend === undefined ? 0 : clamp(-trend, 0, 1);
  const F = Math.max(f1, f2, f3, f4);

  const weighted = WEIGHTS.C * C + WEIGHTS.R * R + WEIGHTS.D * D;
  const affinity = clamp(g * weighted * (1 - F), 0, 1);

  // Receipts, with the repetition count that makes `freshness` legible rather
  // than a number the reader has to take on trust.
  const counts = new Map<string, { n: number; character: string; resolved: boolean }>();
  for (const r of grounded) {
    const cur = counts.get(r.cited_event_id) ?? { n: 0, character: r.character_id, resolved: true };
    cur.n += 1;
    counts.set(r.cited_event_id, cur);
  }

  return {
    fanId,
    displayName: visitor?.display_name || fanId,
    synthetic: Boolean(visitor?.synthetic),
    profile: visitor?.profile ?? null,
    horizon,
    sessions: sessions.length,
    gate: g,
    gateLabel: label,
    C: { value: C, detail: { sessions: sessions.length, expected, freq, trend } },
    R: { value: R, detail: { opportunities, grounded: grounded.length, distinct, coverage, freshness } },
    D: { value: D, detail: { mag, polarisation: pol } },
    F: { value: F, detail: { hollow: f1, depthDecay, staleness: f3, gapLengthening: f4 } },
    affinity,
    flags,
    receipts: [...counts.entries()].map(([citedEventId, v]) => ({
      citedEventId,
      character: v.character,
      times: v.n,
      resolved: v.resolved,
    })).sort((a, b) => b.times - a.times),
  };
}

/** Every visitor, synthetic ones tagged so the caller can keep them separate. */
export function computeAll(repo: CanonRepo, horizon: Horizon = "all"): AffinityReport[] {
  return repo.allVisitors().map((v) => computeAffinity(repo, v.fan_id, horizon));
}
