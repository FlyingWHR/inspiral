/**
 * THE SYNTHETIC VISITOR PATROL — a control arm, not a treatment arm.
 *
 * With zero visitor rows nothing downstream could be validated, so the clock
 * walks synthetic visitors through the world. That is the easy half. The hard
 * half is that a bot on a timer is the single easiest way to manufacture a
 * flattering curve, so this is built as INSTRUMENTATION and the difference has
 * to be visible in the data rather than in a caveat somebody forgets.
 *
 * The framing that makes it honest: a patrol with a known, memoryless schedule
 * supplies the NULL DISTRIBUTION. It is what the affinity metric reads when
 * there is no affinity there, because a Poisson process has none. If a real
 * visitor's curve is indistinguishable from the patrol's, the metric found
 * nothing. That is worth more than the data it generates.
 *
 * THE FIRST VERSION OF THIS GOT THREE THINGS WRONG and they are worth naming,
 * because each one silently invalidates a different number:
 *
 *  1. It wrote to `wren` and `ash` — the exact ids demo.ts hardcodes — with no
 *     synthetic flag. Every hour the clock ran, more demo and patrol history
 *     merged into the same rows. Ids are `sim_`-prefixed now and the tag is a
 *     column, so raw sqlite3 inspection is unambiguous.
 *  2. It fired on a fixed modulo of the tick counter. With constant gaps the
 *     cadence trend is identically zero BY CONSTRUCTION and the frequency term
 *     is a deterministic function of the crontab — the metric would have been
 *     measuring the scheduler. Gaps are drawn from an exponential now.
 *  3. It called `setPresence(false)` directly, so no `visitor_departed` event
 *     was ever written and sessions could not be closed. It goes through
 *     `visitorLeaves` now, which writes the event.
 */

import { visitorAction, type TickContext } from "./runTick.js";
import { visitorArrive, visitorLeaves } from "./visitors.js";
import { log } from "../log.js";

/**
 * Four contrasting behaviours, because one behaviour produces one curve and
 * one curve validates nothing. Each exists to falsify a specific claim about
 * the metric — see the falsification tests in the spec.
 */
export interface PatrolProfile {
  id: string;
  name: string;
  /** Chance of pledging on any given visit. A pledge costs an invocation. */
  pledgeChance: number;
  /** How the pledge target is chosen. */
  target: "fixed" | "rotating" | "highest-tension" | "none";
  validates: string;
}

export const PATROL_PROFILES: PatrolProfile[] = [
  {
    id: "sim_partisan",
    name: "Partisan (patrol)",
    pledgeChance: 0.5,
    target: "fixed",
    validates: "commitment depth, and the repetition discount -- its recall must DECLINE",
  },
  {
    id: "sim_drifter",
    name: "Drifter (patrol)",
    pledgeChance: 0.5,
    target: "rotating",
    validates: "whether the world reacts to inconsistency; depth should stay low",
  },
  {
    id: "sim_lurker",
    name: "Lurker (patrol)",
    pledgeChance: 0,
    target: "none",
    validates: "the arrive-and-leave path and the participation gates; recall must be 0",
  },
  {
    id: "sim_provoker",
    name: "Provoker (patrol)",
    pledgeChance: 0.6,
    target: "highest-tension",
    validates: "whether siding with the losing party changes recall; stresses findGrievance",
  },
];

export interface PatrolConfig {
  /** Mean gap between visits, in hours. Exponential, so memoryless. */
  meanGapHours: number;
  /** Never sooner than this, so a burst cannot starve the tick loop. */
  floorMinutes: number;
  /** Never later than this, so a long tail cannot stall the whole arm. */
  capHours: number;
  /** Host-costing patrol visits allowed per rolling day. */
  dailyInvocations: number;
  /** Total host budget per day, shared with the ticks. */
  totalDailyBudget: number;
}

export const DEFAULT_PATROL: PatrolConfig = {
  meanGapHours: 6,
  floorMinutes: 45,
  capHours: 60,
  dailyInvocations: 3,
  totalDailyBudget: 12,
};

/**
 * Exponential draw, floored and capped.
 *
 * Exponential because it is memoryless -- the maximum-entropy choice given only
 * a mean. Any structure the cadence metric then reports is either real or a
 * bug, and both are worth knowing. `rand` is injectable so a test can pin it.
 */
export function drawGapMs(cfg: PatrolConfig, rand: () => number = Math.random): number {
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rand()));
  const hours = -Math.log(1 - u) * cfg.meanGapHours;
  const floored = Math.max(cfg.floorMinutes / 60, Math.min(cfg.capHours, hours));
  return Math.round(floored * 3_600_000);
}

/**
 * The predicted cached-greeting rate, computed rather than observed.
 *
 * A return to an unchanged world replays a stored greeting and costs nothing.
 * For gaps drawn from Exp(lambda) against ticks at fixed interval T, treating
 * arrival phase as uniform, the chance a gap contains no tick is
 * `max(0, 1 - g/T)`, so the rate is the integral of that against the gap
 * density:
 *
 *   P = integral_0^T (1 - g/T) * lambda e^{-lambda g} dg
 *     = 1 - (1 - e^{-lambda T}) / (lambda T)
 *
 * At T = 3h and mean gap 6h (lambda T = 0.5) this is 0.21306, which is the
 * number the spec predicts. Worth doing the integral rather than trusting a
 * remembered closed form: the first version here evaluated to 0.1805 and would
 * have quietly moved the goalposts on the falsification test it exists to
 * support. The point of computing it BEFORE
 * the data exists is that the observed rate then becomes diagnostic: materially
 * below means the two schedulers are coupled, materially above means ticks are
 * failing and the world is not moving. It ignores stance-change invalidation,
 * which pushes the true rate slightly lower, so treat it as a ceiling.
 */
export function predictedCachedRate(meanGapHours: number, tickIntervalHours: number): number {
  const lt = tickIntervalHours / meanGapHours; // lambda * T
  return 1 - (1 - Math.exp(-lt)) / lt;
}

export interface PatrolDeps {
  ctx: TickContext;
  cfg?: PatrolConfig;
  rand?: () => number;
}

/**
 * One visit by one profile: arrive, maybe pledge, dwell, leave.
 *
 * Returns whether the visit spent a host invocation, so the caller can hold the
 * daily line. A budget-blocked visit still HAPPENS -- it just takes the free
 * path, and the free path is the point rather than a compromise: a return to an
 * unchanged world is exactly the hollow-return case the metric needs data on.
 */
export async function patrolVisit(
  profile: PatrolProfile,
  { ctx, cfg = DEFAULT_PATROL, rand = Math.random }: PatrolDeps,
): Promise<{ spentInvocation: boolean; pledged: boolean }> {
  const { repo } = ctx;
  repo.ensureVisitor(profile.id, profile.name, { profile: profile.id });

  /**
   * Go through `visitorArrive`, not `onboardVisitor` directly.
   *
   * The first version called onboardVisitor, which skipped the whole real
   * arrival path: no session row, and no cached-greeting branch. The result was
   * a patrol that generated stances and citations but reported zero sessions,
   * so cadence was structurally zero and the hollow-return rate -- the one
   * quantity T4 predicts in advance -- had nothing to count.
   */
  const arrival = await visitorArrive(ctx, { id: profile.id, name: profile.name });

  // The gate counts ALL invocations, patrol and tick alike, because starving
  // the ticks to feed the patrol would stop the world moving -- a self-inflicted
  // wound with days to the deadline.
  const used = repo.invocationsSince(24);
  const headroom = cfg.totalDailyBudget - used;
  const mayPledge =
    profile.pledgeChance > 0 && rand() < profile.pledgeChance && headroom > cfg.dailyInvocations;

  let pledged = false;
  if (mayPledge) {
    const target = pickTarget(profile, ctx, rand);
    if (target) {
      await visitorAction(ctx, profile.id, pledgeText(profile, target));
      pledged = true;
    }
  }

  visitorLeaves(ctx, { id: profile.id, name: profile.name });
  return { spentInvocation: pledged || !arrival.cached, pledged };
}

function pledgeText(profile: PatrolProfile, target: string): string {
  if (profile.target === "highest-tension") return `sided against ${target} while the ward watched`;
  return `backed ${target} in public when it cost something`;
}

/** Who this profile takes a side about, if anyone. */
function pickTarget(profile: PatrolProfile, ctx: TickContext, rand: () => number): string | null {
  const cast = ctx.repo.getCharacters();
  if (!cast.length) return null;
  if (profile.target === "fixed") return cast[0]!.name;
  if (profile.target === "rotating") return cast[Math.floor(rand() * cast.length)]!.name;
  if (profile.target === "highest-tension") {
    const rels = ctx.repo.getRelationships?.() ?? [];
    const worst = [...rels].sort((a, b) => (b.tension ?? 0) - (a.tension ?? 0))[0];
    if (worst) {
      const found = cast.find((c) => c.character_id === worst.to_id);
      if (found) return found.name;
    }
    return cast[cast.length - 1]!.name;
  }
  return null;
}

/**
 * Start the patrol. Each profile runs its OWN timer chain, re-armed with a
 * fresh draw after every visit.
 *
 * Independent timers matter more than it looks: triggering a visit from tick
 * completion, or phase-locking the two, would drive the hollow-return rate to
 * zero artificially and destroy the one falsification test that depends on the
 * schedules being independent.
 */
export function startPatrol(deps: PatrolDeps & { profiles?: PatrolProfile[] }): () => void {
  const cfg = deps.cfg ?? DEFAULT_PATROL;
  const rand = deps.rand ?? Math.random;
  const profiles = deps.profiles ?? PATROL_PROFILES;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;

  for (const profile of profiles) {
    const arm = () => {
      if (stopped) return;
      const wait = drawGapMs(cfg, rand);
      const t = setTimeout(() => {
        void (async () => {
          try {
            const r = await patrolVisit(profile, { ctx: deps.ctx, cfg, rand });
            log.info(
              `patrol ${profile.id} visited` +
                `${r.pledged ? " and took a side" : " (free path)"}`,
            );
          } catch (e) {
            // A patrol failure must never take the clock down with it.
            log.warn(`patrol ${profile.id} failed: ${(e as Error).message}`);
          }
          arm();
        })();
      }, wait);
      // Do not hold the process open on the patrol's account.
      t.unref?.();
      timers.push(t);
    };
    arm();
  }

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
  };
}
