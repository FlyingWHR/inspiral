/**
 * THE CLOCK -- the ward's real, unattended life.
 *
 *   npm run clock            # foreground
 *   npm run clock:status     # how much history exists so far
 *
 * Every other entry point manufactures six world-days in two seconds against
 * an in-memory database. That is fine for a demo and worthless as evidence:
 * the whole pitch is that a district accumulates history whether or not anyone
 * is watching, and accumulated time is the one thing that cannot be
 * compressed after the fact. This process ticks the real ward, on disk, on
 * wall-clock time, and is meant to keep running for days.
 *
 * Design notes:
 * - Real time, not virtual. Events are stamped with the actual moment they
 *   happened, so the log is checkable against a calendar rather than a seed.
 * - Paced to the invocation budget. One tick is one host invocation; at the
 *   default 180 minutes that is 8 a day, leaving headroom under the ~12/day
 *   budget for visitors who turn up.
 * - Append-only and restart-safe. State lives entirely in the database, so
 *   stopping and starting loses nothing but the gap.
 * - Single writer. A lock file stops two clocks double-ticking the same world.
 *
 * Flags:
 *   --db PATH       database (default ./data/canon.db)
 *   --every N       minutes of wall time between ticks (default 180)
 *   --budget N      host invocations per 24h (default 12)
 *   --once          run a single tick and exit (for cron, or for testing)
 *   --no-backup     skip the boot backup
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { ConsoleSurface } from "../src/runtime/surface.js";
import { systemClock } from "../src/clock.js";
import { log } from "../src/log.js";

const argv = process.argv.slice(2);
const flag = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  const v = Number(argv[i + 1]);
  return i === -1 || !Number.isFinite(v) ? d : v;
};
const str = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || !argv[i + 1] ? d : argv[i + 1]!;
};

const DB = resolve(str("db", "./data/canon.db"));
const EVERY_MIN = flag("every", 180);
const BUDGET = flag("budget", 12);
const ONCE = argv.includes("--once");
const NO_BACKUP = argv.includes("--no-backup");

const STARTED_KEY = "clock_started_at";
const LOCK = DB + ".clock.lock";
const KEEP_BACKUPS = 12;

/**
 * Copy the database aside before touching it. Cheap insurance: this file is
 * the only artefact in the project that cannot be regenerated.
 */
function backup(): void {
  if (NO_BACKUP || !existsSync(DB)) return;
  const dir = join(dirname(DB), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `canon-${stamp}.db`);
  copyFileSync(DB, target);

  const old = readdirSync(dir)
    .filter((f) => f.startsWith("canon-") && f.endsWith(".db"))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) rmSync(join(dir, f), { force: true });
  log.info(`backup -> ${target} (${(statSync(target).size / 1024).toFixed(0)} KB)`);
}

/** One writer at a time, or the pacing and the budget both become fiction. */
function takeLock(): void {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8").trim());
    let alive = false;
    try {
      process.kill(pid, 0); // signal 0 tests for existence without signalling
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) {
      console.error(`\n  A clock is already running for this world (pid ${pid}).`);
      console.error(`  Stop it first, or remove ${LOCK} if that pid is stale.\n`);
      process.exit(1);
    }
    log.warn(`clearing stale lock from pid ${pid}`);
    rmSync(LOCK, { force: true });
  }
  writeFileSync(LOCK, String(process.pid));
}

const releaseLock = () => rmSync(LOCK, { force: true });

async function main(): Promise<void> {
  mkdirSync(dirname(DB), { recursive: true });
  backup();
  takeLock();

  const repo = CanonRepo.open(DB, systemClock);
  const created = seedWorld(repo);
  if (!repo.getMeta(STARTED_KEY)) repo.setMeta(STARTED_KEY, new Date().toISOString());

  const host = await startHostRuntime({ ...loadConfig(), seed: 1 });
  const ctx: TickContext = {
    repo,
    host,
    surface: new ConsoleSurface(),
    dailyBudget: BUDGET,
    // No clock override: real time already moved on its own between ticks.
  };

  const started = repo.getMeta(STARTED_KEY)!;
  console.log("");
  console.log("  ┌─ TALLOW WARD — THE CLOCK " + "─".repeat(34));
  console.log(`  │  db          ${DB}`);
  console.log(`  │  world       ${created ? "created just now" : "already existed"}`);
  console.log(`  │  running for ${elapsed(started)}`);
  console.log(`  │  events      ${repo.allEvents().length}`);
  console.log(`  │  HOST        ${host.name.toUpperCase()}`);
  console.log(`  │  cadence     one tick every ${EVERY_MIN} min` +
              `  (~${(1440 / EVERY_MIN).toFixed(1)}/day, budget ${BUDGET}/day)`);
  console.log("  └" + "─".repeat(59));
  console.log("");

  const tick = async () => {
    const out = await runTick(ctx);
    const n = repo.allEvents().length;
    log.info(`tick ${repo.getMeta("tick_no") ?? "?"} -> ${out.status}` +
             `${out.status === "skipped" ? ` (${out.reason})` : ""}  |  ${n} events on the record`);
  };

  await tick();
  if (ONCE) {
    repo.close();
    releaseLock();
    return;
  }

  const timer = setInterval(() => void tick(), EVERY_MIN * 60_000);
  const stop = () => {
    clearInterval(timer);
    repo.close();
    releaseLock();
    log.info("clock stopped. history is on disk.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", releaseLock);
}

export function elapsed(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

main().catch((e) => {
  releaseLock();
  console.error(e);
  process.exit(1);
});
