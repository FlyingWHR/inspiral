/**
 * THE VOXEL WARD -- first person, diggable, same simulation.
 *
 *   npm run voxel      then open http://localhost:8788
 *
 * Identical to `npm run world` except for one line: VoxelSurface instead of
 * WebSurface. Canon, directives, the tick loop, the validator, citations and
 * the mint flow are untouched and do not know the difference.
 *
 * Flags:
 *   --port N        http port (default 8788)
 *   --every N       seconds of wall time per world tick (default 9)
 *   --seed N        mock seed (default 1)
 *   --persist       write to ./data/voxel.db instead of memory
 *   --warm N        ticks to run before opening (default 16)
 */

import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld, CHARACTERS } from "../src/canon/seed.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { VoxelSurface } from "../src/runtime/voxelSurface.js";
import { NullSurface } from "../src/runtime/surface.js";
import { mintFromText } from "../src/canon/mint.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import { log } from "../src/log.js";

const argv = process.argv.slice(2);
const flag = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  const v = Number(argv[i + 1]);
  return i === -1 || !Number.isFinite(v) ? d : v;
};
const PORT = flag("port", 8788);
const EVERY = flag("every", 9) * 1000;
const SEED = flag("seed", 1);
const WARM = flag("warm", 16);
const DB = argv.includes("--persist") ? "./data/voxel.db" : ":memory:";

const VISITOR = { id: "wren", name: "Wren" };

async function main(): Promise<void> {
  const clock = new VirtualClock("2026-03-02T08:00:00.000Z");
  const repo = CanonRepo.open(DB, clock);
  seedWorld(repo);

  // THE SEAM. Mock unless INSPIRAL_HOST=minds and a key is present;
  // createHostRuntime falls back to mock rather than crashing if it is not.
  const host = await startHostRuntime({ ...loadConfig(), seed: SEED });

  const surface = new VoxelSurface({
    port: PORT,
    hostName: host.name,
    repo,
    visitorId: VISITOR.id,
    visitorName: VISITOR.name,
    resolveCite: (id) => {
      const e = repo.getEvent(id);
      if (!e) return undefined;
      const summary = e.payload?.summary;
      return { ts: e.ts, summary: typeof summary === "string" ? summary : e.type };
    },
    onIntent: async (intent) => {
      if (intent.kind === "arrive") {
        const returning = repo.visitorExists(VISITOR.id);
        surface.spawn({ id: VISITOR.id, name: VISITOR.name, kind: "visitor", home: "gate" });
        repo.setPresence(VISITOR.id, true);
        await (returning
          ? visitorAction(ctx, VISITOR.id, "returned to the ward after days away")
          : onboardVisitor(ctx, VISITOR.id, VISITOR.name));
      } else if (intent.kind === "act" && intent.text) {
        await visitorAction(ctx, VISITOR.id, intent.text);
      } else if (intent.kind === "leave") {
        repo.setPresence(VISITOR.id, false);
        surface.despawn(VISITOR.id);
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
    dailyBudget: 500,
    clock,
    advanceMs: 4 * HOUR_MS,
  };

  if (WARM > 0) {
    const warmCtx: TickContext = { ...ctx, surface: new NullSurface() };
    for (let i = 0; i < WARM; i++) await runTick(warmCtx);
    log.info(`warmed ${WARM} ticks -- ${repo.allEvents().length} events on the record`);
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
  console.log(`  Tallow Ward (voxel) is live:  ${surface.url}`);
  console.log(
    `  HOST RUNTIME: ${host.name.toUpperCase()}` +
      (host.name === "mock" ? "  (no key -- set INSPIRAL_HOST=minds in .env to switch)" : "  (live Mind)"),
  );
  console.log(`  one tick every ${EVERY / 1000}s   ctrl-c to stop`);
  console.log("");

  const timer = setInterval(() => void runTick(ctx), EVERY);
  const stop = async () => {
    clearInterval(timer);
    await surface.close();
    repo.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
