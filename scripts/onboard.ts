/**
 * HANDLES IN, LIVING CAST OUT.
 *
 *   npm run onboard -- --fixture tradeclash
 *   npm run onboard -- --fixture tradeclash --play 3      # and watch it run
 *   npm run onboard -- --fixture creator                  # no hints: thin world
 *   npm run onboard -- --source x:@someone                # fails loudly, on purpose
 *
 * Flags:
 *   --fixture <name>   a directory under ./fixtures (the default kind of source)
 *   --source <spec>    fixture:<name> | x:<handle> | youtube:<handle> | ...
 *   --db <path>        canon database (default: ./data/<fixture>.db)
 *   --reset            delete that database first
 *   --play <n>         run n ticks after seeding and print what the cast does
 *   --ask              force the interactive approval gate
 *   --reject           refuse at the gate, to prove nothing commits
 *   --no-host          skip the single host enrichment call
 */

import { rmSync } from "node:fs";
import { CanonRepo } from "../src/canon/repo.js";
import { loadConfig } from "../src/config.js";
import { createHostRuntime } from "../src/host/index.js";
import { createSource } from "../src/ip/source.js";
import { onboardIP } from "../src/ip/onboard.js";
import { createApprovalChannel } from "../src/approval/index.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { ConsoleSurface } from "../src/runtime/surface.js";
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
  console.error("usage: npm run onboard -- --fixture <name>   (see ./fixtures)");
  process.exit(2);
}

const dbPath = arg("db") ?? `./data/${(fixture ?? spec).replace(/[^a-z0-9]+/gi, "_")}.db`;
if (has("reset")) {
  for (const s of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${dbPath}${s}`);
    } catch {
      /* nothing to remove */
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const source = createSource(spec!);
  const repo = CanonRepo.open(dbPath, systemClock);
  const host = has("no-host") ? undefined : createHostRuntime(cfg);
  const approval = createApprovalChannel(process.env, {
    mode: has("reject") ? "reject" : has("ask") ? "ask" : undefined,
  });

  console.log(`\nreading ${source.name} ...`);
  if (host) await host.init();

  const result = await onboardIP({
    source,
    repo,
    approval,
    ...(host ? { host } : {}),
    editPath: `${dbPath}.draft.json`,
  });

  console.log("");
  console.log(`status:       ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
  console.log(`items read:   ${result.itemsRead}`);
  console.log(`host calls:   ${result.hostCalls}${result.enriched ? " (enrichment applied)" : result.hostCalls ? " (enrichment discarded, draft stands)" : ""}`);
  console.log(`cast:         ${result.bible.characters.map((c) => c.character_id).join(", ")}`);
  console.log(`database:     ${dbPath}`);

  if (result.status !== "seeded") {
    if (host) await host.close();
    repo.close();
    process.exit(result.status === "rejected" ? 1 : 0);
  }

  repo.setMeta("world_start", repo.now());

  const plays = Number(arg("play") ?? 0);
  if (plays > 0 && host) {
    const ctx: TickContext = {
      repo,
      host,
      surface: new ConsoleSurface((id) => repo.getCharacter(id)?.name ?? id),
      dailyBudget: cfg.dailyHostBudget,
    };
    for (let i = 1; i <= plays; i++) {
      console.log(`\n--- tick ${i} ---`);
      const o = await runTick(ctx);
      if (o.status !== "applied") console.log(`  (${o.status}: ${"reason" in o ? o.reason : ""})`);
    }
  }

  console.log(`\nnext: npm run ingest -- --fixture ${fixture ?? spec} --once --tick --db ${dbPath}`);
  if (host) await host.close();
  repo.close();
}

main().catch((e) => {
  console.error(`\nonboard failed: ${(e as Error).message}`);
  process.exit(1);
});
