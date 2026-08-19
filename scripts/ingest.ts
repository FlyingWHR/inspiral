/**
 * Pull the owner's feed into the world.
 *
 *   npm run ingest -- --fixture tradeclash --once
 *   npm run ingest -- --fixture tradeclash --once --tick   # and prove they react
 *   npm run ingest -- --fixture tradeclash --watch --interval 60
 *
 * Zero host invocations. The tick that follows costs one, as it always does.
 */

import { CanonRepo } from "../src/canon/repo.js";
import { loadConfig } from "../src/config.js";
import { createHostRuntime } from "../src/host/index.js";
import { createSource } from "../src/ip/source.js";
import { ingestOnce, ingestLoop } from "../src/ip/ingest.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { ConsoleSurface } from "../src/runtime/surface.js";
import { describeEvent } from "../src/types/events.js";
import { systemClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (n: string) => argv.includes(`--${n}`);

setLogLevel(has("verbose") ? "info" : "warn");

const fixture = arg("fixture");
const spec = arg("source") ?? (fixture ? `fixture:${fixture}` : undefined);
if (!spec) {
  console.error("usage: npm run ingest -- --fixture <name> [--once|--watch] [--tick]");
  process.exit(2);
}
const dbPath = arg("db") ?? `./data/${(fixture ?? spec).replace(/[^a-z0-9]+/gi, "_")}.db`;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const source = createSource(spec!);
  const repo = CanonRepo.open(dbPath, systemClock);

  if (repo.getMeta("seeded") !== "1") {
    console.error(`${dbPath} has no world in it. Run: npm run onboard -- --fixture ${fixture ?? spec}`);
    repo.close();
    process.exit(2);
  }

  const report = (r: Awaited<ReturnType<typeof ingestOnce>>): void => {
    console.log(`ingested ${r.ingested.length}, skipped ${r.skipped} (cursor ${r.cursor ?? "-"})`);
    for (const e of r.ingested) console.log(`  [${e.event_id}] ${describeEvent(e)}`);
  };

  if (has("watch")) {
    const intervalMs = Number(arg("interval") ?? 60) * 1000;
    console.log(`watching ${source.name} every ${intervalMs / 1000}s. Ctrl-C to stop.`);
    const loop = ingestLoop(repo, source, { intervalMs, onBatch: report });
    const stop = () => {
      loop.stop();
      repo.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    setInterval(() => {}, 1 << 30);
    return;
  }

  const r = await ingestOnce(repo, source);
  report(r);

  if (has("tick")) {
    const host = createHostRuntime(cfg);
    await host.init();
    const ctx: TickContext = {
      repo,
      host,
      surface: new ConsoleSurface((id) => repo.getCharacter(id)?.name ?? id),
      dailyBudget: cfg.dailyHostBudget,
    };
    console.log(`\n--- tick ---`);
    const o = await runTick(ctx);
    if (o.status !== "applied") console.log(`  (${o.status})`);
    await host.close();
  }

  repo.close();
}

main().catch((e) => {
  console.error(`ingest failed: ${(e as Error).message}`);
  process.exit(1);
});
