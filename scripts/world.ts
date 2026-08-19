/**
 * THE LIVE WARD -- the same tick loop as the demo, rendered in a browser.
 *
 *   npm run world      then open http://localhost:8787
 *
 * Nothing about the simulation changes. This swaps ConsoleSurface for
 * WebSurface and runs the clock on a real timer so there is something to
 * watch. Still the mock host, still no API key, still no network calls.
 *
 * Flags:
 *   --port N        http port (default 8787)
 *   --every N       seconds of wall time per world tick (default 9)
 *   --seed N        mock seed (default 1)
 *   --persist       write to ./data/world.db instead of memory
 *   --warm N        run N ticks before opening, so the ward has a past (default 12)
 */

import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { WebSurface } from "../src/runtime/webSurface.js";
import { mintFromText } from "../src/canon/mint.js";
import { visitorArrive, visitorDoes, visitorLeaves } from "../src/tick/visitors.js";
import { NullSurface } from "../src/runtime/surface.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import { log } from "../src/log.js";

const argv = process.argv.slice(2);
const flag = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  const v = Number(argv[i + 1]);
  return i === -1 || !Number.isFinite(v) ? d : v;
};
const PORT = flag("port", 8787);
const EVERY = flag("every", 9) * 1000;
const SEED = flag("seed", 1);
const WARM = flag("warm", 12);
const DB = argv.includes("--persist") ? "./data/world.db" : ":memory:";


async function main(): Promise<void> {
  const clock = new VirtualClock("2026-03-02T08:00:00.000Z");
  const repo = CanonRepo.open(DB, clock);
  seedWorld(repo);

  // THE SEAM. Mock unless INSPIRAL_HOST=minds and a key is present;
  // startHostRuntime falls back to mock rather than crashing if it is not.
  const host = await startHostRuntime({ ...loadConfig(), seed: SEED });

  const surface = new WebSurface({
    port: PORT,
    hostName: host.name,
    // The surface shows citations resolved. Canon stays the only reader.
    resolveCite: (id) => {
      const e = repo.getEvent(id);
      if (!e) return undefined;
      const summary = e.payload?.summary;
      return { ts: e.ts, summary: typeof summary === "string" ? summary : e.type };
    },
    onIntent: async (intent) => {
      // Who this is comes from the connection, not a constant: two browsers on
      // the same ward are two different fans with separate memories.
      const who = intent.visitor ?? { id: "wren", name: "Wren" };

      if (intent.kind === "arrive") {
        surface.spawn({ id: who.id, name: who.name, kind: "visitor", home: "gate" });
        const { cached, first } = await visitorArrive(ctx, who);
        log.info(
          `${who.name} ${first ? "arrived" : "returned"}` +
            (cached ? " -- unchanged ward, replayed for free" : ""),
        );
      } else if (intent.kind === "act" && intent.text) {
        await visitorDoes(ctx, who, intent.text);
      } else if (intent.kind === "leave") {
        visitorLeaves(ctx, who);
        surface.despawn(who.id);
      } else if (intent.kind === "mint" && intent.text) {
        const { sheet } = mintFromText(repo, intent.text);
        surface.spawn({
          id: sheet.character_id,
          name: sheet.name,
          kind: "character",
          title: sheet.title,
          home: sheet.home_location,
        });
        await runTick(ctx);
      }
    },
  });

  const ctx: TickContext = {
    repo,
    host,
    surface,
    dailyBudget: 500, // the mock is free; a real host would keep the default 12
    clock,
    advanceMs: 4 * HOUR_MS,
  };

  // Cold start is solved before anyone connects: run the ward for a couple of
  // days against a surface that renders nothing, so the first thing a visitor
  // sees is a district with a grudge already in progress.
  if (WARM > 0) {
    const warmCtx: TickContext = { ...ctx, surface: new NullSurface() };
    for (let i = 0; i < WARM; i++) await runTick(warmCtx);
    log.info(`warmed ${WARM} ticks -- ${repo.allEvents().length} events already on the record`);
  }

  await surface.open();
  // The world's OWN cast, not the ward's. Opening an onboarded IP with
  // `--db` used to show Vance, Okonkwo and Quill standing in someone else's
  // world because this read a hardcoded constant.
  for (const c of repo.getCharacters()) {
    surface.spawn({
      id: c.character_id,
      name: c.name,
      kind: "character",
      title: c.title,
      home: c.home_location,
    });
  }

  console.log("");
  console.log(`  Tallow Ward is live:  ${surface.url}`);
  console.log(
    `  HOST RUNTIME: ${host.name.toUpperCase()}` +
      (host.name === "mock" ? "  (no key -- set INSPIRAL_HOST=minds in .env to switch)" : "  (live Mind)"),
  );
  console.log(`  one tick every ${EVERY / 1000}s   ctrl-c to stop`);
  console.log("");

  const timer = setInterval(() => {
    void runTick(ctx);
  }, EVERY);

  const stop = async () => {
    clearInterval(timer);
    await surface.close();
    repo.close?.();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
