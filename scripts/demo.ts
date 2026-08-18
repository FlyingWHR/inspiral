/**
 * INSPIRAL DEMO -- the drama loop, end to end, with zero setup.
 *
 *   npm run demo
 *
 * Runs a world for six days against the deterministic mock host. Nobody is
 * watching for most of it, which is the point: the district accumulates real
 * history whether or not anyone visits.
 *
 * A visitor arrives on day 2 and takes a side. They leave. The world keeps
 * going without them. On day 6 they come back and an NPC greets them as an
 * ally and complains, accurately, about something a rival actually did while
 * they were away -- citing the event id, which the demo then verifies against
 * the log.
 *
 * Flags:
 *   --days N        how many days to run (default 6)
 *   --ticks N       ticks per day (default 6, i.e. every 4 hours)
 *   --seed N        mock seed; same seed, same history (default 1)
 *   --persist       write to ./data/demo.db instead of memory
 *   --reset         delete the persisted db first
 *   --verbose       print every line of dialogue on every tick
 */

import { rmSync } from "node:fs";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld, CHARACTERS } from "../src/canon/seed.js";
import { MockHostRuntime } from "../src/host/mock.js";
import {
  runTick,
  onboardVisitor,
  visitorAction,
  type TickContext,
  type TickOutcome,
} from "../src/tick/runTick.js";
import type { RenderedBehavior } from "../src/runtime/character.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import { describeEvent, type WorldEvent } from "../src/types/events.js";
import { setLogLevel } from "../src/log.js";

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string, dflt: number): number => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : dflt;
};
const has = (name: string) => argv.includes(`--${name}`);

const DAYS = flag("days", 6);
const TICKS_PER_DAY = flag("ticks", 6);
const SEED = flag("seed", 1);
const VERBOSE = has("verbose");
const PERSIST = has("persist");
const DB_PATH = PERSIST ? "./data/demo.db" : ":memory:";

const FAN_ID = "wren";
const FAN_NAME = "Wren";

if (has("reset") && PERSIST) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${DB_PATH}${suffix}`);
    } catch {
      /* nothing to remove */
    }
  }
}

setLogLevel(VERBOSE ? "info" : "warn");

// ---------------------------------------------------------------------------
// presentation helpers
// ---------------------------------------------------------------------------

const W = 78;
const rule = (ch = "-") => ch.repeat(W);
const head = (t: string) => {
  console.log("");
  console.log(rule("="));
  console.log(`  ${t}`);
  console.log(rule("="));
};
const sub = (t: string) => {
  console.log("");
  console.log(`  ${t}`);
  console.log(`  ${rule("-").slice(0, W - 2)}`);
};

let repo: CanonRepo;
const nameOf = (id: string): string => {
  if (id.startsWith("fan:")) return FAN_NAME;
  return repo?.getCharacter(id)?.name ?? id;
};

function dayOf(ts: string, startIso: string): number {
  return Math.floor((Date.parse(ts) - Date.parse(startIso)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const START = "2026-03-02T08:00:00.000Z";
  const clock = new VirtualClock(START);
  repo = CanonRepo.open(DB_PATH, clock);

  const created = seedWorld(repo);
  repo.setMeta("world_start", START);

  const host = new MockHostRuntime({ seed: SEED });
  await host.init();

  const surface = new MemorySurface();
  const ctx: TickContext = {
    repo,
    host,
    surface,
    dailyBudget: 64, // demo runs hot; production default is 12
    clock,
  };

  head("INSPIRAL -- Tallow Ward");
  console.log("");
  console.log(`  ${created ? "World created." : "World already existed."}  Host: ${host.name}  Seed: ${SEED}`);
  console.log(`  ${DAYS} days, ${TICKS_PER_DAY} ticks/day (every ${24 / TICKS_PER_DAY}h)`);
  console.log(`  Canon: ${DB_PATH === ":memory:" ? "in memory (nothing written to disk)" : DB_PATH}`);

  // --- day zero ------------------------------------------------------------
  sub("DAY ZERO -- they already dislike each other");
  for (const c of CHARACTERS) {
    console.log(`  ${c.name.padEnd(14)} ${c.title}, ${c.faction}`);
  }
  console.log("");
  for (const r of repo.getRelationships()) {
    const sign = r.affinity > 0 ? "+" : "";
    console.log(
      `  ${nameOf(r.from_id).padEnd(14)} -> ${nameOf(r.to_id).padEnd(14)} ` +
        `affinity ${(sign + Math.round(r.affinity)).padStart(4)}  tension ${String(Math.round(r.tension)).padStart(3)}`,
    );
  }
  console.log("");
  console.log("  Cold start is solved before the first tick: the world ships with a past.");

  const startRels = new Map(
    repo.getRelationships().map((r) => [`${r.from_id}->${r.to_id}`, { a: r.affinity, t: r.tension }]),
  );

  // --- the run -------------------------------------------------------------
  let visitorFirstVisitDay = 0;
  let pledgeDay = 0;
  let beforeReturn = 0;
  let returnBehaviors: RenderedBehavior[] = [];
  let returnOutcome: TickOutcome | undefined;
  const beats: { day: number; text: string }[] = [];

  for (let day = 1; day <= DAYS; day++) {
    // --- day 2: a visitor shows up and picks a side ------------------------
    if (day === 2) {
      sub(`DAY ${day} -- A VISITOR`);
      visitorFirstVisitDay = dayOf(clock.now().toISOString(), START);
      console.log(`  >> ${FAN_NAME} arrives in the ward.`);
      const before = surface.presented.length;
      await onboardVisitor(ctx, FAN_ID, FAN_NAME);
      for (const b of surface.presented.slice(before)) {
        console.log(`    ${nameOf(b.character_id).padEnd(14)} ${b.action.verb} -> ${FAN_NAME}`);
        for (const line of b.lines) console.log(`        "${line}"`);
      }

      clock.advance(3 * HOUR_MS);
      pledgeDay = dayOf(clock.now().toISOString(), START);
      console.log("");
      console.log(`  >> ${FAN_NAME} takes a side: backs Okonkwo against Vance, in public.`);
      const before2 = surface.presented.length;
      await visitorAction(
        ctx,
        FAN_ID,
        "stood up in the market and backed okonkwo against vance in front of the whole ward",
      );
      for (const b of surface.presented.slice(before2)) {
        console.log(`    ${nameOf(b.character_id).padEnd(14)} ${b.action.verb} -> ${FAN_NAME}`);
        for (const line of b.lines) console.log(`        "${line}"`);
      }

      const stance = repo.getStance(FAN_ID);
      console.log("");
      console.log(
        `    standing after taking a side: ` +
          Object.entries(stance)
            .map(([k, v]) => `${nameOf(k)} ${v > 0 ? "+" : ""}${Math.round(v)}`)
            .join(", "),
      );

      // They leave. The world does not pause for them.
      repo.appendEvent({
        source: "visitor",
        actors: [`fan:${FAN_ID}`],
        type: "visitor_departed",
        payload: { summary: `${FAN_NAME} left the ward.` },
        significance_hint: 0.2,
      });
      repo.setPresence(FAN_ID, false);
      console.log(`  >> ${FAN_NAME} leaves. Nobody will greet them again until they come back.`);
      beats.push({ day: pledgeDay, text: `${FAN_NAME} sided with Okonkwo` });
    }

    // --- the return visit --------------------------------------------------
    if (day === DAYS) {
      head(`DAY ${day} -- THE RETURN VISIT`);
      console.log("");
      console.log(
        `  ${FAN_NAME} has been gone since day ${pledgeDay}. Days of history happened without`,
      );
      console.log("  them, and none of it cost a visitor-facing invocation. They walk back in.");
      console.log("");

      repo.setPresence(FAN_ID, true);
      beforeReturn = surface.presented.length;
      returnOutcome = await visitorAction(ctx, FAN_ID, "returned to the ward after days away");
      returnBehaviors = surface.presented.slice(beforeReturn);

      for (const b of returnBehaviors) {
        console.log(`    ${nameOf(b.character_id)} [${b.action.verb}]`);
        for (const line of b.lines) console.log(`        "${line}"`);
        if (b.cites.length) console.log(`        cites: ${b.cites.join(", ")}`);
        console.log("");
      }
    }

    sub(`DAY ${day}`);

    for (let t = 0; t < TICKS_PER_DAY; t++) {
      const before = surface.presented.length;
      const outcome = await runTick({ ...ctx, advanceMs: (24 / TICKS_PER_DAY) * HOUR_MS });

      if (outcome.status === "applied") {
        for (const b of surface.presented.slice(before)) {
          const tgt = b.action.target ? ` -> ${nameOf(b.action.target)}` : "";
          console.log(`    ${nameOf(b.character_id).padEnd(14)} ${b.action.verb}${tgt}`);
          if (VERBOSE) for (const line of b.lines) console.log(`        "${line}"`);
        }
      } else if (outcome.status === "replayed") {
        console.log(`    (host unavailable: ${outcome.reason} -- ran on last directives)`);
      } else {
        console.log(`    (tick skipped: ${outcome.reason})`);
      }
    }

  }

  // --- verify the callback is real ----------------------------------------
  head("VERIFICATION -- is the complaint actually true?");
  console.log("");

  const citing = returnBehaviors.filter((b) => b.cites.length > 0);
  if (citing.length === 0) {
    console.log("  No citations were made on this return visit.");
  }

  let verified = 0;
  let failed = 0;
  for (const b of citing) {
    for (const id of b.cites) {
      const evt = repo.getEvent(id);
      if (!evt) {
        console.log(`  FAIL  ${nameOf(b.character_id)} cited ${id}, which is not in the log.`);
        failed++;
        continue;
      }
      const d = dayOf(evt.ts, START);
      const initiator = evt.actors[0] ?? "?";
      console.log(`  OK    ${nameOf(b.character_id)} cited ${id}`);
      console.log(`        day ${d}, ${evt.ts}`);
      console.log(`        initiator: ${nameOf(initiator)}   type: ${evt.type}`);
      console.log(`        "${describeEvent(evt)}"`);
      console.log("");
      verified++;
    }
  }

  console.log(`  ${verified} citation(s) resolved to real events in the append-only log.`);
  if (failed > 0) console.log(`  ${failed} citation(s) could NOT be resolved.`);
  console.log("");
  console.log("  The host proposed the intent. Canon supplied the fact. Nothing was improvised.");

  // --- accumulated history -------------------------------------------------
  head("ACCUMULATED HISTORY");
  console.log("");
  const events: WorldEvent[] = repo.allEvents();
  let lastDay = -1;
  for (const e of events) {
    const d = dayOf(e.ts, START);
    if (d !== lastDay) {
      console.log(`  ${d <= 0 ? "day 0 (seed)" : `day ${d}`}`);
      lastDay = d;
    }
    const marker = e.source === "visitor" ? ">>" : "  ";
    console.log(`   ${marker} [${e.event_id}] ${describeEvent(e).slice(0, 108)}`);
  }

  // --- drift ---------------------------------------------------------------
  head("WHAT SIX DAYS DID TO THEM");
  console.log("");
  console.log(
    `  ${"relationship".padEnd(32)} ${"affinity".padStart(18)}  ${"tension".padStart(16)}`,
  );
  console.log(`  ${rule("-").slice(0, W - 2)}`);
  for (const r of repo.getRelationships()) {
    const key = `${r.from_id}->${r.to_id}`;
    const start = startRels.get(key) ?? { a: 0, t: 0 };
    const label = `${nameOf(r.from_id)} -> ${nameOf(r.to_id)}`;
    const aStr = `${Math.round(start.a)} -> ${Math.round(r.affinity)}`;
    const tStr = `${Math.round(start.t)} -> ${Math.round(r.tension)}`;
    console.log(`  ${label.padEnd(32)} ${aStr.padStart(18)}  ${tStr.padStart(16)}`);
  }

  console.log("");
  console.log("  Open arcs:");
  for (const a of repo.getArcs()) {
    console.log(`    [${a.status}] stage ${a.stage}, tension ${Math.round(a.tension)} -- ${a.title}`);
    if (a.summary) console.log(`        ${a.summary.slice(0, 100)}`);
  }

  // --- cost ----------------------------------------------------------------
  head("COST");
  console.log("");
  const invocations = repo.totalHostInvocations();
  const totalTicks = DAYS * TICKS_PER_DAY;
  console.log(`  world days                 ${DAYS}`);
  console.log(`  world ticks                ${totalTicks}`);
  console.log(`  events in the log          ${repo.eventCount()}`);
  console.log(`  characters                 ${repo.getCharacters().length}`);
  console.log(`  visitors                   ${repo.listVisitors().length}`);
  console.log(`  HOST INVOCATIONS           ${invocations}`);
  console.log("");
  console.log("  Invocations scale with narrative decisions -- ticks, onboards, escalations.");
  console.log("  Not with cast size. Not with visitor traffic. Adding a fourth faction leader");
  console.log("  or a thousand visitors does not change this number.");
  console.log("");
  console.log(`  Every rendered line above cost zero invocations: the character runtime is`);
  console.log(`  stateless local code, not an agent.`);

  console.log("");
  console.log(rule("="));
  console.log(`  Same seed (--seed ${SEED}) reproduces this run exactly.`);
  console.log(rule("="));
  console.log("");

  await host.close();
  repo.close();

  if (failed > 0) process.exitCode = 1;
  if (verified === 0) {
    console.error("  NOTE: no citation was made on the return visit -- the payoff did not fire.");
    process.exitCode = 1;
  }
  if (returnOutcome && returnOutcome.status === "skipped") {
    console.error(`  NOTE: the return visit was skipped (${returnOutcome.reason}).`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
