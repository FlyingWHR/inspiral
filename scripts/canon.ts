/**
 * Inspect the canon database.
 *
 *   npm run canon                 summary
 *   npm run canon -- --events 40  last N events
 *   npm run canon -- --digest     the exact briefing the host would receive
 *   npm run canon -- --visitor wren
 */

import { loadConfig } from "../src/config.js";
import { CanonRepo } from "../src/canon/repo.js";
import { compileDigest, renderDigest } from "../src/canon/digest.js";
import { describeEvent } from "../src/types/events.js";
import { systemClock } from "../src/clock.js";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const cfg = loadConfig();
const repo = CanonRepo.open(cfg.dbPath, systemClock);

if (argv.includes("--digest")) {
  console.log(
    renderDigest(
      compileDigest(repo, {
        tickNo: Number(repo.getMeta("tick_no") ?? "0") + 1,
        sinceSeq: Number(repo.getMeta("last_tick_seq") ?? "0"),
        dailyBudget: cfg.dailyHostBudget,
      }),
    ),
  );
  repo.close();
  process.exit(0);
}

const visitor = arg("visitor");
if (visitor) {
  const v = repo.getVisitor(visitor);
  if (!v) {
    console.log(`no visitor '${visitor}'`);
  } else {
    console.log(JSON.stringify(v, null, 2));
  }
  repo.close();
  process.exit(0);
}

const eventsFlag = arg("events");
if (eventsFlag !== undefined || argv.includes("--events")) {
  const n = Number(eventsFlag) || 25;
  for (const e of repo.recentEvents(n)) {
    console.log(`${e.ts}  [${e.event_id}]  ${e.type}`);
    console.log(`    ${describeEvent(e)}`);
  }
  repo.close();
  process.exit(0);
}

// Default: summary.
console.log(`world:        ${repo.getMeta("world_name") ?? "(unnamed)"}`);
console.log(`db:           ${cfg.dbPath}`);
console.log(`ticks:        ${repo.getMeta("tick_no") ?? 0}`);
console.log(`events:       ${repo.eventCount()}`);
console.log(`host calls:   ${repo.totalHostInvocations()}`);
console.log("");

console.log("CHARACTERS");
for (const c of repo.getCharacters()) {
  console.log(`  ${c.character_id.padEnd(10)} ${c.name} -- ${c.title} (${c.mood})`);
}

console.log("");
console.log("RELATIONSHIPS");
for (const r of repo.getRelationships()) {
  console.log(
    `  ${r.from_id.padEnd(10)} -> ${r.to_id.padEnd(10)} affinity ${String(Math.round(r.affinity)).padStart(4)}  trust ${String(Math.round(r.trust)).padStart(3)}  tension ${String(Math.round(r.tension)).padStart(3)}`,
  );
  if (r.note) console.log(`      "${r.note}"`);
}

console.log("");
console.log("ARCS");
for (const a of repo.getArcs()) {
  console.log(`  [${a.status}] ${a.arc_id} stage ${a.stage} tension ${Math.round(a.tension)} -- ${a.title}`);
}

const visitors = repo.listVisitors();
if (visitors.length) {
  console.log("");
  console.log("VISITORS");
  for (const id of visitors) {
    const v = repo.getVisitor(id)!;
    const stance = Object.entries(v.stance)
      .map(([k, n]) => `${k} ${n > 0 ? "+" : ""}${Math.round(n)}`)
      .join(", ");
    console.log(
      `  ${id.padEnd(10)} ${repo.isPresent(id) ? "here " : "away "} ${v.interactions.length} interactions  ${stance}`,
    );
  }
}

repo.close();
