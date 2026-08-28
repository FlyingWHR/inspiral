/**
 * DOES THE SENTENCE LAND?
 *
 *   npm run pieces                 # deterministic, no key, no network
 *   INSPIRAL_HOST=minds npm run pieces
 *
 * The entire product is one line of text: what somebody changed about your
 * work. If that line is bland the feature is dead, and it will die the way the
 * previous version died -- fluently, plausibly, and without anybody noticing,
 * because each individual sentence reads fine on its own.
 *
 * So this exists to put the sentence on screen next to the two texts that
 * produced it, on real prose, against a live Mind. It is a judgement tool, not
 * a test: no assertion can tell you whether a sentence is worth reading.
 *
 * Runs entirely in memory. It never touches a world on disk.
 */

import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { seedPiece, extendPiece, lineage, waitingFor } from "../src/pieces/repo.js";
import { narrateChange } from "../src/pieces/host.js";
import { setLogLevel } from "../src/log.js";

const B = "\x1b[1m";
const D = "\x1b[2m";
const Y = "\x1b[33m";
const R = "\x1b[0m";

/**
 * Real prose, deliberately. A model will produce something plausible from
 * anything; the question is whether it can find the specific thing that
 * changed, and that only shows up when the two texts genuinely differ in a
 * way worth naming.
 */
const PIECE = {
  title: "Five Ingredients",
  brief: "Take five ordinary things and make one dish worth arguing about. Say what you would do and why.",
};

const TAKES: { fan: string; name: string; body: string }[] = [
  {
    fan: "ada",
    name: "Ada",
    body:
      "Fennel, butter, lemon, salt, stale bread. Braise the fennel in the butter for an hour until it collapses, " +
      "then tear the bread in and let it drink the liquid. The lemon goes in at the very end, off the heat, " +
      "or it turns metallic. It should taste sweet before it tastes of anything else.",
  },
  {
    fan: "maya",
    name: "Maya",
    body:
      "I kept the fennel and the bread but I would not braise it. Shave it raw on a mandoline, salt it hard, " +
      "and leave it twenty minutes until it weeps. Toast the bread in the butter instead. The lemon goes on " +
      "at the table. You lose the sweetness and you get the crunch back, which I think is the better trade.",
  },
  {
    fan: "tomas",
    name: "Tomas",
    body:
      "Both of you are throwing away the fronds. Blend them with the lemon and the butter into a green sauce " +
      "and spoon it over whichever version you made. Same five things, one more step, and the dish stops " +
      "being beige.",
  },
];

async function main(): Promise<void> {
  setLogLevel("warn");
  const repo = CanonRepo.open(":memory:", new VirtualClock("2026-03-01T09:00:00.000Z"));
  const host = await startHostRuntime(loadConfig());

  const piece = seedPiece(repo, PIECE);
  let parent = lineage(repo, piece.piece_id)!.seed_event_id;
  let parentBody = PIECE.brief;
  let parentAuthor = "the brief";

  console.log("");
  console.log(`  ${B}${PIECE.title}${R}   ${D}host: ${host.name}${R}`);
  console.log(`  ${D}${PIECE.brief}${R}`);
  console.log("");

  for (const take of TAKES) {
    // The sentence is written BEFORE the extension is stored, so the work and
    // the narration land together. A failed narration still stores the work.
    const changed = await narrateChange(host, {
      piece_title: PIECE.title,
      parent_body: parentBody,
      parent_author: parentAuthor,
      child_body: take.body,
      child_author: take.name,
    });

    const r = extendPiece(repo, {
      piece_id: piece.piece_id,
      parent_event_id: parent,
      fan_id: take.fan,
      body: take.body,
      changed,
      display_name: take.name,
    });

    console.log(`  ${B}${take.name}${R}`);
    console.log(`  ${D}${take.body.replace(/\s+/g, " ").slice(0, 150)}…${R}`);
    console.log(
      `  ${Y}↳ ${changed ?? "(no sentence -- host unavailable; the work still stands)"}${R}`,
    );
    console.log(`  ${D}  notifies: ${r.notifies ?? "nobody (this built on the brief)"}${R}`);
    console.log("");

    parent = r.extension.event_id;
    parentBody = take.body;
    parentAuthor = take.name;
  }

  console.log(`  ${D}${"─".repeat(70)}${R}`);
  console.log(`  ${B}WHAT ADA SEES WHEN SHE COMES BACK${R}`);
  console.log(`  ${D}${"─".repeat(70)}${R}`);
  const waiting = waitingFor(repo, "ada", (id) => `/e/${id}`);
  if (waiting.items.length === 0) {
    console.log(`  ${D}Nothing. Which is the honest answer, and what it should say.${R}`);
  }
  for (const w of waiting.items) {
    console.log(`  ${D}you wrote:${R}   ${w.your_body.replace(/\s+/g, " ").slice(0, 90)}…`);
    console.log(`  ${B}${w.their_display_name}${R} ${D}changed it:${R}`);
    console.log(`  ${Y}${w.changed ?? "(no sentence)"}${R}`);
    console.log("");
  }

  console.log(`${D}  Does each yellow line name one thing KEPT and one thing CHANGED, in${R}`);
  console.log(`${D}  the writers' own nouns? "Built on your idea" means it does not work.${R}`);
  console.log("");

  await host.close();
  repo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
