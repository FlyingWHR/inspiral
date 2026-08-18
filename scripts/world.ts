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
import { seedWorld, CHARACTERS } from "../src/canon/seed.js";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { WebSurface, WARD_PLACES } from "../src/runtime/webSurface.js";
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

const VISITOR = { id: "wren", name: "Wren" };

async function main(): Promise<void> {
  const clock = new VirtualClock("2026-03-02T08:00:00.000Z");
  const repo = CanonRepo.open(DB, clock);
  seedWorld(repo);

  const host = new MockHostRuntime({ seed: SEED });
  await host.init();

  const surface = new WebSurface({
    port: PORT,
    onIntent: async (intent) => {
      if (intent.kind === "arrive") {
        surface.spawn({ id: VISITOR.id, name: VISITOR.name, kind: "visitor", home: "gate" });
        surface.moveTo(VISITOR.id, "plaza");
        repo.setPresence(VISITOR.id, true);
        await onboardVisitor(ctx, VISITOR.id, VISITOR.name);
      } else if (intent.kind === "act" && intent.text) {
        await visitorAction(ctx, VISITOR.id, intent.text);
      } else if (intent.kind === "leave") {
        repo.setPresence(VISITOR.id, false);
        repo.appendEvent({
          source: "visitor",
          actors: [`fan:${VISITOR.id}`],
          type: "visitor_departed",
          payload: { summary: `${VISITOR.name} left the ward.` },
          significance_hint: 0.2,
        });
        surface.despawn(VISITOR.id);
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
  for (const c of CHARACTERS) {
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
  console.log(`  host: ${host.name}   one tick every ${EVERY / 1000}s   ctrl-c to stop`);
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
