/**
 * Fire the world tick against the persistent canon database.
 *
 *   npm run tick            one tick, now
 *   npm run tick -- --watch run the scheduler until interrupted
 *
 * Honours INSPIRAL_HOST, so this is the same entry point whether the host is
 * the mock or a real Mind.
 */

import { loadConfig } from "../src/config.js";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { createHostRuntime } from "../src/host/index.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { TickScheduler } from "../src/tick/scheduler.js";
import { ConsoleSurface } from "../src/runtime/surface.js";
import { systemClock } from "../src/clock.js";
import { log } from "../src/log.js";

const watch = process.argv.includes("--watch");

async function main(): Promise<void> {
  const cfg = loadConfig();
  const repo = CanonRepo.open(cfg.dbPath, systemClock);

  if (seedWorld(repo)) {
    repo.setMeta("world_start", repo.now());
    log.info("world seeded");
  }

  const host = createHostRuntime(cfg);
  try {
    await host.init();
  } catch (e) {
    log.error(`host init failed: ${(e as Error).message}`);
    repo.close();
    process.exit(1);
  }

  const surface = new ConsoleSurface((id) => repo.getCharacter(id)?.name ?? id);
  const ctx: TickContext = { repo, host, surface, dailyBudget: cfg.dailyHostBudget };

  const shutdown = async (): Promise<void> => {
    await host.close();
    repo.close();
  };

  if (watch) {
    const scheduler = new TickScheduler({
      ...ctx,
      intervalMinutes: cfg.tickMinutes,
      runOnStart: true,
      onOutcome: (o) => log.info(`tick -> ${o.status}`),
    });
    scheduler.start();
    log.info(`ticking every ${cfg.tickMinutes} minutes. Ctrl-C to stop.`);

    const stop = () => {
      scheduler.stop();
      void shutdown().then(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    // Keep the process alive; the scheduler's timer is unref'd.
    setInterval(() => {}, 1 << 30);
    return;
  }

  const outcome = await runTick(ctx);
  console.log(`tick -> ${outcome.status}`);
  if (outcome.status === "applied") {
    for (const a of outcome.applied) {
      console.log(`  ${a.directive.actor} ${a.directive.action} -> ${a.directive.target ?? "-"}`);
    }
  }
  await shutdown();
}

main().catch((e) => {
  console.error("tick failed:", e);
  process.exit(1);
});
