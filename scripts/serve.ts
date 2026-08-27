/**
 * THE MEMORY LAYER, RUNNING.
 *
 *   npm run serve
 *   npm run serve -- --db ./data/tradeclash.db --port 8790
 *
 * This is the product shape: a service a product with an audience calls when
 * something happens, and calls back when it needs to know what the world
 * remembers. It is deliberately not a world you visit.
 *
 * Set INSPIRAL_API_KEY to open the authenticated routes. Without it the public
 * permalink pages still serve and every write answers 503 -- an unauthenticated
 * write endpoint on a log whose entire value is that it can be trusted would be
 * worse than no endpoint at all.
 */

import { CanonRepo } from "../src/canon/repo.js";
import { MemoryApi } from "../src/api/server.js";
import { systemClock } from "../src/clock.js";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const str = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || !argv[i + 1] ? d : argv[i + 1]!;
};
const num = (n: string, d: number) => {
  const v = Number(str(n, ""));
  return Number.isFinite(v) && v > 0 ? v : d;
};

const DB = resolve(str("db", "./data/tradeclash.db"));
const PORT = num("port", 8790);

async function main(): Promise<void> {
  const repo = CanonRepo.open(DB, systemClock);
  const apiKey = process.env.INSPIRAL_API_KEY;
  const api = new MemoryApi({
    repo,
    port: PORT,
    apiKey,
    publicUrl: process.env.INSPIRAL_PUBLIC_URL ?? `http://localhost:${PORT}`,
  });
  await api.open();

  const world = repo.getMeta("world_name") ?? "the world";
  const slug = world.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  console.log("");
  console.log(`  ${world} — the log is at  ${api.url}/w/${slug}`);
  console.log(`  ${repo.allEvents().length} events, ${repo.getCharacters().length} in the cast`);
  console.log("");
  if (!apiKey) {
    console.log("  No INSPIRAL_API_KEY set: public pages only, writes closed.");
    console.log("  Set one to accept match results and stakes.");
    console.log("");
  } else {
    console.log("  POST /v1/matches   {match_id, bot_a, bot_b, winner_side}   X-Inspiral-Key");
    console.log("  POST /v1/stakes    {fan_id, bot_id}                        X-Inspiral-Key");
    console.log("  GET  /v1/rivalry?a=&b=                                     X-Inspiral-Key");
    console.log("  GET  /v1/memory?fan=                                       X-Inspiral-Key");
    console.log("");
  }

  const stop = async (): Promise<void> => {
    await api.close();
    repo.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
