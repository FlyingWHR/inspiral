/**
 * How much real history exists.
 *
 *   npm run clock:status
 *
 * Read-only. Safe to run while the clock is ticking.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { CanonRepo } from "../src/canon/repo.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("silent");

const argv = process.argv.slice(2);
const i = argv.indexOf("--db");
const DB = resolve(i === -1 || !argv[i + 1] ? "./data/canon.db" : argv[i + 1]!);

if (!existsSync(DB)) {
  console.error(`\n  No world at ${DB}.  Start one with:  npm run clock\n`);
  process.exit(1);
}

const repo = CanonRepo.open(DB);
const events = repo.allEvents();
const started = repo.getMeta("clock_started_at");
const first = events[0]?.ts;
const last = events.at(-1)?.ts;

const hours = (a?: string, b?: string) =>
  a && b ? (Date.parse(b) - Date.parse(a)) / 3_600_000 : 0;

const wall = hours(started ?? first, new Date().toISOString());
const spanned = hours(first, last);
const visitors = repo.listVisitors();
const byType = new Map<string, number>();
for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);

const lockPath = DB + ".clock.lock";
let running = false;
if (existsSync(lockPath)) {
  try {
    process.kill(Number(readFileSync(lockPath, "utf8").trim()), 0);
    running = true;
  } catch {
    running = false;
  }
}

const backupDir = join(dirname(DB), "backups");
const backups = existsSync(backupDir)
  ? readdirSync(backupDir).filter((f) => f.endsWith(".db")).length
  : 0;

/**
 * A held lock proves a process exists. It does not prove the world is moving --
 * a laptop that slept through the night leaves the pid alive and the log
 * silent, and this used to report RUNNING right through it. The evidence this
 * whole project rests on is elapsed history, so a clock that has gone quiet has
 * to say so loudly enough to notice before filming it.
 */
const cadenceMin = Number(repo.getMeta("clock_every_min") ?? 180);
const silentH = last ? (Date.now() - Date.parse(last)) / 3_600_000 : Infinity;
const overdue = silentH > (cadenceMin / 60) * 2;
const state = !running
  ? "not running"
  : overdue
    ? `STALE — process alive, but nothing logged for ${silentH.toFixed(1)} h ` +
      `(cadence ${cadenceMin} min)`
    : "RUNNING";

const pad = (s: string) => s.padEnd(15);
console.log("");
console.log("  TALLOW WARD — accumulated history");
console.log("  " + "─".repeat(52));
console.log(`  ${pad("clock")}${state}`);
if (running && overdue) {
  console.log(`  ${pad("")}↳ the pid holds the lock; the machine most likely slept.`);
  console.log(`  ${pad("")}  Restart it before trusting or filming this world.`);
}
console.log(`  ${pad("database")}${DB}  (${(statSync(DB).size / 1024).toFixed(0)} KB)`);
console.log(`  ${pad("started")}${started ?? "unknown (pre-dates the clock)"}`);
console.log(`  ${pad("days elapsed")}${(wall / 24).toFixed(2)}   (${wall.toFixed(1)} h of real time)`);
console.log(`  ${pad("log spans")}${(spanned / 24).toFixed(2)} days   ${first ?? "-"} .. ${last ?? "-"}`);
console.log(`  ${pad("ticks")}${repo.getMeta("tick_no") ?? 0}`);
console.log(`  ${pad("events")}${events.length}`);
/**
 * Which host authored this history is NOT recorded per event -- the schema
 * predates the question and migrating the one file in this repo that cannot be
 * regenerated is not worth the answer. What is recorded, on Minds' side, is the
 * cognition spend per day: `npm run platform` prints it, and it lines up with
 * this window. Point at both rather than claiming either.
 */
console.log(`  ${pad("host now")}${loadConfig().host}   (per-day spend: npm run platform)`);
console.log(`  ${pad("characters")}${repo.getCharacters().length}`);
console.log(`  ${pad("visitors")}${visitors.length}${visitors.length ? "  (" + visitors.join(", ") + ")" : ""}`);
console.log(`  ${pad("backups")}${backups}`);
console.log("");
console.log("  events by type");
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${t}`);
}
console.log("");

repo.close();
