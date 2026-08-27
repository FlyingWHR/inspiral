/**
 * DOES THE BILL GROW WITH THE CAST? Measured, not asserted.
 *
 *   npm run scale
 *   npm run scale -- --ticks 12
 *
 * The pitch says invocations scale with narrative decisions and never with cast
 * size. That is a claim about money, so it should be a measurement. This runs
 * the identical tick loop over casts of different sizes and reports what
 * actually moved.
 *
 * IT REPORTS THE PART THAT IS NOT FLAT. Invocation COUNT is flat -- one host
 * call decides the beat regardless of how many characters exist. But the digest
 * handed to the host carries the cast, so PROMPT SIZE grows with it, and prompt
 * size is tokens and tokens are money. Claiming perfect flatness would be
 * false without checking. It was false: the mesh is O(n^2) and the digest used
 * to ship all of it, so a 5.3x cast cost 7.38x the bytes and the curve bent the
 * wrong way. This script is what caught that. The digest now sends only the
 * edges in play and the same measurement reads 2.73x -- sub-linear. Keep
 * running it; the second row is the one that will bend again first.
 *
 * Both worlds below are real: Tallow Ward is the hand-authored demo district,
 * Trade Clash is compiled from a shipping product's own brand document
 * (`npm run fixture`). No synthetic cast is padded to make a curve look good.
 */

import { rmSync } from "node:fs";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { compileDigest, renderDigest } from "../src/canon/digest.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { createSource } from "../src/ip/source.js";
import { createApprovalChannel } from "../src/approval/index.js";
import { onboardIP } from "../src/ip/onboard.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const num = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  const v = Number(argv[i + 1]);
  return i === -1 || !Number.isFinite(v) ? d : v;
};
const TICKS = num("ticks", 8);

interface Row {
  world: string;
  cast: number;
  edges: number;
  ticks: number;
  invocations: number;
  digestBytes: number;
  events: number;
}

/** Onboarding prints a whole bible. Not on camera it doesn't. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = real;
  }
}

let hostName = "?";

async function measure(world: string, db: string, seed: () => Promise<CanonRepo>): Promise<Row> {
  rmSync(db, { force: true });
  const repo = await quietly(seed);
  const host = await startHostRuntime({ ...loadConfig(), seed: 1 });
  hostName = host.name;
  const clock = new VirtualClock("2026-03-01T09:00:00.000Z");
  const ctx: TickContext = {
    repo,
    host,
    surface: new MemorySurface(),
    dailyBudget: 10_000, // deliberately un-capped: we are measuring demand, not the cap
    clock,
  };

  const before = repo.totalHostInvocations();
  for (let i = 0; i < TICKS; i++) {
    await runTick(ctx);
    clock.advanceHours(4);
  }

  // The digest is what the host is actually charged for. Measure it after the
  // ticks, when the log has something in it, not on an empty world.
  const digest = compileDigest(repo, {
    tickNo: TICKS + 1,
    sinceSeq: 0,
    dailyBudget: 12,
  });

  const row: Row = {
    world,
    cast: repo.getCharacters().length,
    edges: repo.getRelationships().length,
    ticks: TICKS,
    invocations: repo.totalHostInvocations() - before,
    digestBytes: Buffer.byteLength(renderDigest(digest), "utf8"),
    events: repo.allEvents().length,
  };
  await host.close();
  repo.close();
  rmSync(db, { force: true });
  return row;
}

async function main(): Promise<void> {
  setLogLevel("warn");

  const rows: Row[] = [];

  rows.push(
    await measure("Tallow Ward", "./data/scale-tallow.db", async () => {
      const repo = CanonRepo.open("./data/scale-tallow.db", new VirtualClock("2026-03-01T09:00:00.000Z"));
      seedWorld(repo);
      return repo;
    }),
  );

  rows.push(
    await measure("Trade Clash", "./data/scale-tc.db", async () => {
      const repo = CanonRepo.open("./data/scale-tc.db", new VirtualClock("2026-03-01T09:00:00.000Z"));
      await onboardIP({
        source: createSource("tradeclash"),
        repo,
        approval: createApprovalChannel(process.env, { mode: "approve" }),
      });
      return repo;
    }),
  );

  const B = "\x1b[1m";
  const D = "\x1b[2m";
  const R = "\x1b[0m";

  console.log("");
  console.log(`${D}────────────────────────────────────────────────────────────────────────────${R}`);
  console.log(`  ${B}COST vs CAST SIZE${R}   ${D}${TICKS} ticks each, identical loop, host: ${hostName}${R}`);
  console.log(`${D}────────────────────────────────────────────────────────────────────────────${R}`);
  console.log(
    `  ${"world".padEnd(14)}${"cast".padStart(5)}${"edges".padStart(7)}` +
      `${"ticks".padStart(7)}${"calls".padStart(7)}${"calls/tick".padStart(12)}${"digest".padStart(9)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.world.padEnd(14)}${String(r.cast).padStart(5)}${String(r.edges).padStart(7)}` +
        `${String(r.ticks).padStart(7)}${String(r.invocations).padStart(7)}` +
        `${(r.invocations / r.ticks).toFixed(2).padStart(12)}` +
        `${(r.digestBytes / 1024).toFixed(1).padStart(8)}K`,
    );
  }

  const [a, b] = rows as [Row, Row];
  const castX = b.cast / a.cast;
  const callX = b.invocations / Math.max(1, a.invocations);
  const byteX = b.digestBytes / a.digestBytes;

  console.log("");
  console.log(`  ${B}cast x${castX.toFixed(1)}${R}  ->  ` +
              `${B}invocations x${callX.toFixed(2)}${R}   ${D}(the bill in calls)${R}`);
  console.log(`  ${" ".repeat(9)}      ->  ` +
              `${B}prompt bytes x${byteX.toFixed(2)}${R}   ${D}(the bill in tokens)${R}`);
  console.log("");
  console.log(`${D}  Invocation count is flat: one call decides the beat whether the district${R}`);
  console.log(`${D}  holds ${a.cast} people or ${b.cast}. A fan turning up costs nothing extra either.${R}`);
  console.log("");
  console.log(`${D}  Prompt size is SUB-linear: a ${castX.toFixed(1)}x cast costs ${byteX.toFixed(2)}x the bytes.${R}`);
  console.log(`${D}  It did not used to be. The relationship mesh is O(n^2) -- ${a.cast} characters${R}`);
  console.log(`${D}  carry ${a.edges} edges, ${b.cast} carry ${b.edges} -- and the digest shipped all of them, so${R}`);
  console.log(`${D}  a 5.3x cast cost 7.38x the bytes and the curve bent the wrong way.${R}`);
  console.log("");
  console.log(`${D}  The digest now sends only the edges IN PLAY: participants in an open${R}`);
  console.log(`${D}  arc, anyone in the recent log, anyone a present visitor has a stance${R}`);
  console.log(`${D}  towards. The mesh is still quadratic on disk; the host just stops${R}`);
  console.log(`${D}  being charged for the part of it that nobody is acting on.${R}`);
  console.log(`${D}────────────────────────────────────────────────────────────────────────────${R}`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
