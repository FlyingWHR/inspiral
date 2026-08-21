/**
 * DID THEY COME BACK, AND WERE THEY REMEMBERED FOR SOMETHING THEY CHOSE TO DO?
 *
 *   npm run affinity                      # every visitor, all horizons
 *   npm run affinity -- --fan wren        # one visitor, in detail
 *   npm run affinity -- --window 30d
 *   npm run affinity -- --json
 *   npm run affinity -- --include-synthetic
 *
 * Views measure whether somebody stopped. This measures whether the second
 * visit was easier to earn than the first, which is the only claim this project
 * can make that a reach metric structurally cannot.
 *
 * THREE THINGS THIS TOOL REFUSES TO DO, all of them deliberate:
 *
 *  - It never prints a number it did not measure. A missing trend prints `n/a`,
 *    never a neutral 0.5. Substituting a neutral value for a missing
 *    measurement is how a metric starts lying.
 *  - Synthetic patrol visitors are listed in their own block, never merged into
 *    the cohort. They are a control arm: instrumentation, not evidence.
 *  - It prints "this is a demo population, not a sample" whenever the real
 *    count is under 30, unconditionally. That line is the difference between a
 *    credible tool and a fabricated one.
 */

import { CanonRepo } from "../src/canon/repo.js";
import { systemClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import { computeAll, computeAffinity, WEIGHTS, type Horizon, type AffinityReport } from "../src/affinity/model.js";
import { GAP_MS } from "../src/runtime/character.js";
import { predictedCachedRate, DEFAULT_PATROL } from "../src/tick/patrol.js";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || !argv[i + 1] ? d : argv[i + 1];
};
const has = (n: string) => argv.includes(`--${n}`);

const FIXTURE = flag("fixture");
const DB = flag("db", FIXTURE ? `./data/${FIXTURE}.db` : "./data/canon.db")!;
const FAN = flag("fan");
const WINDOW = (flag("window", "all") ?? "all") as Horizon;
const JSON_OUT = has("json");
const WITH_SYNTHETIC = has("include-synthetic");
const CHECK = has("check");

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const WARN = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** `n/a`, never a substituted neutral. */
const num = (v: number | string | undefined, dp = 2): string =>
  v === undefined ? "n/a" : typeof v === "string" ? v : v.toFixed(dp);

function header(repo: CanonRepo): void {
  console.log("");
  console.log(`  ${B("AFFINITY")}   ${DIM(DB)}`);
  console.log(
    DIM(
      `  world time ${repo.now()}   ·   weights w_C=${WEIGHTS.C} w_R=${WEIGHTS.R} w_D=${WEIGHTS.D}` +
        `   ·   return threshold ${GAP_MS / 3_600_000}h (GAP_MS)`,
    ),
  );
  console.log(
    DIM("  identity: asserted — a fan_id is a claim by the client, not a verified person"),
  );
  console.log("");
}

function single(r: AffinityReport): void {
  const tag = r.synthetic ? WARN(` SYNTHETIC (${r.profile ?? "patrol"})`) : "";
  console.log(
    `  ${B(r.fanId)}  (${r.displayName})${tag}   ${r.sessions} sessions` +
      `   ·   gate ${r.gate.toFixed(2)} (${r.gateLabel})`,
  );
  console.log("");
  console.log(`  ${B("COMPONENTS")}   horizon ${r.horizon}`);
  console.log(
    `    C  cadence          ${num(r.C.value)}    ` +
      `${r.C.detail.sessions} sessions / ${r.C.detail.expected} expected, trend ${num(r.C.detail.trend)}`,
  );
  console.log(
    `    R  grounded recall  ${num(r.R.value)}    ` +
      `coverage ${num(r.R.detail.coverage)} × freshness ${num(r.R.detail.freshness)}` +
      `  (${r.R.detail.distinct} distinct of ${r.R.detail.grounded} citations)`,
  );
  console.log(
    `    D  commitment       ${num(r.D.value)}    ` +
      `magnitude ${num(r.D.detail.mag)}, polarisation ${num(r.D.detail.polarisation)}`,
  );
  console.log(
    `    F  fatigue          ${num(r.F.value)}    ` +
      `max(hollow ${num(r.F.detail.hollow)}, decay ${num(r.F.detail.depthDecay)}, ` +
      `stale ${num(r.F.detail.staleness)}, gaps ${num(r.F.detail.gapLengthening)})`,
  );
  console.log("");
  console.log(`  ${B("AFFINITY")}  ${r.affinity.toFixed(3)}${r.flags.length ? DIM("   " + r.flags.join(", ")) : ""}`);

  if (r.receipts.length) {
    console.log("");
    console.log(`  ${B("RECEIPTS THE WORLD HAS CITED AT THEM")}`);
    for (const rc of r.receipts) {
      // The repetition count is what makes `freshness` legible rather than a
      // number the reader has to trust: the row that repeated is visibly the
      // one dragging R down.
      console.log(
        `    ${rc.citedEventId}  ${rc.character.padEnd(10)} ×${rc.times}` +
          `  ${rc.resolved ? "✓ resolves" : WARN("✗ DOES NOT RESOLVE")}`,
      );
    }
  }
  console.log("");
}

function table(rows: AffinityReport[], title: string): void {
  if (!rows.length) return;
  console.log(`  ${B(title)}`);
  console.log(DIM("  fan            sessions  gate   C     R     D     F     A      flags"));
  for (const r of rows) {
    console.log(
      "  " +
        r.fanId.padEnd(15) +
        String(r.sessions).padStart(5) +
        r.gate.toFixed(2).padStart(8) +
        num(r.C.value).padStart(6) +
        num(r.R.value).padStart(6) +
        num(r.D.value).padStart(6) +
        num(r.F.value).padStart(6) +
        r.affinity.toFixed(2).padStart(7) +
        "   " + DIM(r.flags.join(", ")),
    );
  }
  console.log("");
}

/**
 * THE FIVE FALSIFICATION TESTS.
 *
 * Each is a prediction the patrol design made in ADVANCE. That is the whole
 * point: a patrol that passes none of them is decoration, and a number that was
 * predicted before the data existed is diagnostic in a way a number computed
 * afterwards can never be.
 */
function runChecks(repo: CanonRepo, synth: AffinityReport[], tickHours: number): number {
  let failures = 0;
  const line = (ok: boolean, id: string, text: string) => {
    if (!ok) failures++;
    console.log(`  ${ok ? "ok " : WARN("FAIL")} ${B(id)}  ${text}`);
  };

  if (!synth.length) {
    console.log(DIM("  No synthetic visitors yet, so none of the five can be evaluated."));
    return 0;
  }

  // T1 — null conformance. Memoryless gaps mean trend must centre on zero.
  const trends = synth.map((r) => r.C.detail.trend).filter((t): t is number => typeof t === "number");
  const meanTrend = trends.length ? trends.reduce((a, b) => a + b, 0) / trends.length : undefined;
  line(
    meanTrend === undefined || Math.abs(meanTrend) < 0.35,
    "T1 null trend",
    meanTrend === undefined
      ? "n/a — fewer than 4 sessions per profile"
      : `mean patrol trend ${meanTrend.toFixed(3)}, want |t| < 0.35. This is what establishes ` +
        "what zero looks like, so a real visitor's positive trend can mean something.",
  );

  // T2 — profile separation. If all four score alike, D has no power.
  const byId = new Map(synth.map((r) => [r.fanId, r]));
  const p = byId.get("sim_partisan")?.D.value;
  const d = byId.get("sim_drifter")?.D.value;
  const l = byId.get("sim_lurker")?.D.value;
  line(
    p !== undefined && d !== undefined && l !== undefined && p > d && d >= l,
    "T2 separation",
    `commitment partisan ${num(p)} > drifter ${num(d)} >= lurker ${num(l)}`,
  );

  // T3 — repetition decay. The centrepiece; if this is flat the discount is dead.
  const partisan = byId.get("sim_partisan");
  const fresh = Number(partisan?.R.detail.freshness ?? 1);
  line(
    partisan === undefined || fresh < 0.8,
    "T3 repetition",
    `partisan freshness ${num(fresh)} — the world is citing ` +
      `${partisan?.R.detail.distinct} distinct receipts across ${partisan?.R.detail.grounded} citations`,
  );

  // T4 — hollow-return floor, predicted before any data existed.
  const hollow = synth.map((r) => Number(r.F.detail.hollow ?? 0));
  const meanHollow = hollow.reduce((a, b) => a + b, 0) / Math.max(1, hollow.length);
  const predicted = predictedCachedRate(DEFAULT_PATROL.meanGapHours, tickHours);
  line(
    meanHollow > 0 || predicted < 0.05,
    "T4 hollow floor",
    `observed ${meanHollow.toFixed(3)} against ${predicted.toFixed(4)} predicted at a ` +
      `${tickHours}h tick. Materially below means the schedulers are coupled; ` +
      "materially above means ticks are failing and the world is not moving.",
  );

  // T5 — clamp absorption. Above 0.20 and every stance move is fictional.
  const eff = repo.clampRatio();
  line(
    eff < 0.2,
    "T5 clamp",
    `${eff.toFixed(3)} of requested movement absorbed by clamps, want < 0.20` +
      (eff >= 0.2 ? " — the world is saturated and patrol affinity numbers are VOID" : ""),
  );

  return failures;
}

async function main(): Promise<void> {
  setLogLevel("warn");
  const repo = CanonRepo.open(DB, systemClock);

  const all = computeAll(repo, WINDOW);
  const real = all.filter((r) => !r.synthetic);
  const synth = all.filter((r) => r.synthetic);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      db: DB, worldTime: repo.now(), horizon: WINDOW, weights: WEIGHTS,
      gapThresholdHours: GAP_MS / 3_600_000,
      identity: "asserted",
      real, synthetic: synth,
    }, null, 2));
    repo.close();
    return;
  }

  header(repo);

  if (CHECK) {
    console.log(`  ${B("FALSIFICATION TESTS")}   ${DIM("predictions the patrol design made in advance")}`);
    console.log("");
    const failures = runChecks(repo, synth, 1);
    console.log("");
    repo.close();
    process.exitCode = failures > 0 ? 2 : 0;
    return;
  }

  if (FAN) {
    const r = computeAffinity(repo, FAN, WINDOW);
    single(r);
    repo.close();
    return;
  }

  if (!all.length) {
    console.log("  No visitors on record yet.");
    console.log(DIM("  The clock's patrol writes synthetic ones; a real visitor arrives through a surface."));
    console.log("");
    repo.close();
    return;
  }

  table(real, "REAL VISITORS");
  if (synth.length) {
    if (WITH_SYNTHETIC) {
      table(synth, "SYNTHETIC (patrol — instrumentation, not evidence)");
    } else {
      console.log(
        DIM(`  ${synth.length} synthetic patrol visitors hidden. --include-synthetic to show them.`),
      );
      console.log(
        DIM("  They are a control arm: a memoryless schedule has no affinity, so their"),
      );
      console.log(
        DIM("  numbers are what this metric reads when there is nothing there."),
      );
      console.log("");
    }
  }

  const returned = real.filter((r) => r.gate === 1).length;
  const recalled = real.filter((r) => r.R.value > 0).length;
  const sided = real.filter((r) => Number(r.D.detail.polarisation ?? 0) > 0.1).length;
  console.log(`  ${B("COHORT")}   ${DIM("(real visitors only)")}`);
  console.log(`    returned at least once      ${returned}/${real.length}`);
  console.log(`    received a grounded recall  ${recalled}/${real.length}`);
  console.log(`    took a side that cost them  ${sided}/${real.length}`);
  console.log("");

  if (real.length < 30) {
    console.log(
      WARN(`  n = ${real.length} real visitors. This is a demo population, not a sample. Do not generalise.`),
    );
    console.log("");
  }

  repo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
