/**
 * THE WHOLE THING, ON ONE PORT.
 *
 *   npm run pieces:serve
 *   INSPIRAL_HOST=minds INSPIRAL_API_KEY=dev npm run pieces:serve
 *
 * App, API, public piece pages and receipts from a single origin. That is a
 * product decision, not a deployment convenience: a static page has nowhere to
 * keep an API key, and a receipt link pointing at a second server on a second
 * port 404s for whoever follows it. One origin removes both problems without
 * inventing a token scheme for something that does not need one yet.
 *
 * With no INSPIRAL_HOST=minds this runs entirely offline -- every extension is
 * stored, and none of them get their sentence, which is exactly what a reader
 * sees when the Mind is down.
 */

import { resolve } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { PiecesApi } from "../src/pieces/api.js";
import { listPieces, seedPiece } from "../src/pieces/repo.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { systemClock } from "../src/clock.js";

const argv = process.argv.slice(2);
const str = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || !argv[i + 1] ? d : argv[i + 1]!;
};
const num = (n: string, d: number) => {
  const v = Number(str(n, ""));
  return Number.isFinite(v) && v > 0 ? v : d;
};

const DB = resolve(str("db", "./data/pieces.db"));
const PORT = num("port", 8795);

/**
 * Something to build on, on an empty world.
 *
 * A space with no pieces has no first step, and the brief matters more than the
 * title: it is the difference between an addition worth reading and "nice!".
 * Only written when the world is empty -- this never edits an existing space.
 */
const STARTERS = [
  {
    title: "Five Ingredients",
    brief:
      "Five ordinary things, one dish worth arguing about. Say what you would do and why. " +
      "Disagreeing with what is already here is the point, not a problem.",
  },
  {
    title: "Six Words",
    brief:
      "A whole story in six words. Take somebody else's and change one word, or write your " +
      "own and say what the change is for.",
  },
];

async function main(): Promise<void> {
  const repo = CanonRepo.open(DB, systemClock);
  const host = await startHostRuntime(loadConfig());
  const apiKey = process.env.INSPIRAL_API_KEY;

  /**
   * Name the space, because the name is in every permalink this server hands
   * out. Unnamed, the slug fell back to "the-world" and every receipt link read
   * like a placeholder -- on the one artefact that is meant to be shared.
   */
  if (!repo.getMeta("world_name")) repo.setMeta("world_name", str("name", "Pieces"));

  if (listPieces(repo, "all").length === 0) {
    for (const s of STARTERS) seedPiece(repo, s);
  }

  const api = new PiecesApi({
    repo,
    port: PORT,
    apiKey,
    host,
    publicUrl: process.env.INSPIRAL_PUBLIC_URL ?? `http://localhost:${PORT}`,
    webRoot: resolve("web-pieces"),
  });
  await api.open();

  const D = "\x1b[2m";
  const B = "\x1b[1m";
  const R = "\x1b[0m";
  const pieces = listPieces(repo, "open");
  console.log("");
  console.log(`  ${B}${api.url}${R}   ${D}host: ${host.name}${R}`);
  console.log(`  ${D}${DB}  ·  ${pieces.length} open piece(s)${R}`);
  console.log("");
  for (const p of pieces) {
    console.log(`  ${p.title}  ${D}${api.url}/w/pieces/p/${p.piece_id}${R}`);
  }
  console.log("");
  if (!apiKey) {
    console.log(`  ${D}No INSPIRAL_API_KEY: public pages only, every write closed.${R}`);
  }
  if (host.name !== "minds") {
    console.log(`  ${D}Deterministic host: work is stored, sentences are not written.${R}`);
    console.log(`  ${D}INSPIRAL_HOST=minds to see the thing the product is actually for.${R}`);
  }
  console.log("");

  const stop = async (): Promise<void> => {
    await api.close();
    await host.close();
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
