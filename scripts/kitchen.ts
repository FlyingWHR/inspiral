/**
 * THE DEMO WORLD: a kitchen, already mid-argument.
 *
 *   npm run kitchen                      # build it
 *   npm run kitchen -- --reset           # rebuild from scratch
 *   INSPIRAL_HOST=minds npm run kitchen  # with the sentences written
 *   npm run pieces:serve -- --db ./data/kitchen.db
 *
 * A KITCHEN BECAUSE THE FORMAT FITS, not because food is charming. A recipe is
 * the most naturally extendable thing there is: everybody already understands
 * that you can keep somebody's base and change their acid, which is exactly the
 * shape of the sentence the host has to write. Disagreement is native --
 * "I would not braise that" is a normal thing to say and a hostile thing to
 * say about most other work. And the barrier is nothing: everyone has an
 * opinion about salt.
 *
 * NOT A REAL CHEF'S KITCHEN. It would have cost an affiliation claim in a
 * public repository and bought nothing: none of the mechanics need a famous
 * name, and a demo that leans on one is hiding a weak brief behind it.
 *
 * THE BRIEFS ARE THE PRODUCT. A vague one produces "nice!"; a sharp one
 * produces work. Each below names the thing to change and gives permission to
 * disagree, because the failure mode of every space like this is politeness.
 *
 * IT ARRIVES ALIVE. Seeding empty pieces would demo the empty-room problem
 * rather than the product -- nobody extends a blank page, and the whole loop
 * only exists once there is something to build on. So the world opens with
 * real lineages already in it, including one that disagrees with itself.
 */

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { extendPiece, lineage, seedPiece } from "../src/pieces/repo.js";
import { narrateChange } from "../src/pieces/host.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { systemClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import type { MoveValues, Slot } from "../src/pieces/contract.js";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const str = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || !argv[i + 1] ? d : argv[i + 1]!;
};
const DB = resolve(str("db", "./data/kitchen.db"));

/** Cooks with a point of view, so the arguments have somebody behind them. */
const COOKS: Record<string, string> = {
  ada: "Ada",
  maya: "Maya",
  tomas: "Tomas",
  wren: "Wren",
  rook: "Rook",
};

interface Seed {
  title: string;
  brief: string;
  location: string;
  /**
   * The palette. Options are the kitchen's, which is what makes this Ramsay's
   * test kitchen rather than a textarea with a chef's name over it.
   */
  schema: Slot[];
  /** Each entry builds on the one before it unless `branchFrom` says otherwise. */
  takes: { by: string; body: string; values: MoveValues; branchFrom?: number }[];
}

const slot = (key: string, label: string, options: string[], required = true): Slot => ({
  key, label, options, required,
});

const KITCHEN: Seed[] = [
  {
    title: "The Standing Dish",
    brief:
      "One vegetable, one method, one finish. Take the plate above you and change exactly " +
      "one of the three. Say why in a line. Do not add a fourth thing.",
    location: "test_kitchen",
    schema: [
      slot("main", "Main", ["fennel", "celeriac", "pumpkin", "chicory", "lamb neck"]),
      slot("method", "Method", ["braise", "raw", "roast", "grill", "cure"]),
      slot("finish", "Finish", ["brown butter", "anchovy", "yoghurt", "burnt honey", "nothing"]),
    ],
    takes: [
      { by: "ada", values: { main: "fennel", method: "braise", finish: "brown butter" },
        body: "Braised until it gives up. The butter is the whole point." },
      { by: "maya", values: { main: "fennel", method: "raw", finish: "brown butter" },
        body: "It was already sweet. Braising was hiding that." },
      { by: "tomas", values: { main: "fennel", method: "raw", finish: "burnt honey" },
        body: "Fennel wants something bitter, not nutty." },
      { by: "wren", branchFrom: 0, values: { main: "chicory", method: "braise", finish: "anchovy" },
        body: "Chicory can take the anchovy. Fennel just goes salty." },
    ],
  },
  {
    title: "The Thing You Ruined",
    brief:
      "A dish you got wrong. Name the step you would change, not 'more practice'. " +
      "Somebody will tell you it was a different step.",
    location: "test_kitchen",
    schema: [
      slot("dish", "Dish", ["carbonara", "risotto", "hollandaise", "roast chicken", "bread"]),
      slot("blame", "The step", ["heat", "timing", "ratio", "the pan", "resting"]),
    ],
    takes: [
      { by: "rook", values: { dish: "carbonara", blame: "the pan" },
        body: "Straight off the flame, so it scrambled. A cold bowl fixed a year of it." },
      { by: "maya", values: { dish: "carbonara", blame: "ratio" },
        body: "Too much white to survive any heat. You removed the heat instead." },
    ],
  },
  {
    title: "What Is It Short Of",
    brief:
      "A dish that is technically correct and boring. Pick what it lacks and the one " +
      "ingredient that proves it. One change, not a rewrite.",
    location: "the_pass",
    schema: [
      slot("dish", "Dish", ["roast chicken", "lentil soup", "mash", "tomato salad"]),
      slot("short", "Short of", ["acid", "salt", "fat", "bitterness", "texture"]),
      slot("fix", "One ingredient", ["lemon", "vinegar", "anchovy", "burnt butter", "raw onion"]),
    ],
    takes: [
      { by: "tomas", values: { dish: "roast chicken", short: "acid", fix: "lemon" },
        body: "Into the resting juices, not over the skin. It stops being a photograph." },
    ],
  },
  {
    title: "The Family Recipe, Corrected",
    brief:
      "Something handed down to you. Change exactly one thing and say what it is for. " +
      "You are allowed to be wrong about your own grandmother.",
    location: "the_pass",
    schema: [
      slot("dish", "Handed down", ["soda bread", "ragu", "trifle", "dumplings", "pickle"]),
      slot("change", "Changed", ["the heat", "the timing", "the cut", "an ingredient", "nothing"]),
    ],
    takes: [
      { by: "wren", values: { dish: "soda bread", change: "the cut" },
        body: "The cross is not superstition, it is heat. I cut it deeper." },
      { by: "ada", values: { dish: "soda bread", change: "the heat" },
        body: "Deeper is the wrong axis. Drop the oven forty degrees at the end." },
    ],
  },
  {
    title: "Feed the Kitchen for Nothing",
    brief:
      "Staff meal. Whatever is about to turn, no budget, twenty minutes, twelve people. " +
      "What you would actually cook, not what would photograph.",
    location: "staff_table",
    schema: [
      slot("base", "Base", ["rice", "bread", "potatoes", "pasta", "nothing"]),
      slot("about_to_turn", "About to turn", ["tomatoes", "cream", "greens", "bones", "cheese ends"]),
    ],
    takes: [],
  },
];

async function main(): Promise<void> {
  setLogLevel("warn");
  if (flag("reset")) for (const s of ["", "-wal", "-shm"]) rmSync(DB + s, { force: true });

  const repo = CanonRepo.open(DB, systemClock);
  repo.setMeta("world_name", "The Kitchen");
  const host = await startHostRuntime(loadConfig());

  const B = "\x1b[1m";
  const D = "\x1b[2m";
  const Y = "\x1b[33m";
  const R = "\x1b[0m";
  let sentences = 0;

  for (const seed of KITCHEN) {
    const piece = seedPiece(repo, {
      title: seed.title,
      brief: seed.brief,
      location: seed.location,
      schema: seed.schema,
    });
    console.log(`\n  ${B}${seed.title}${R}  ${D}${seed.location}${R}`);

    const events: string[] = [lineage(repo, piece.piece_id)!.seed_event_id];
    const bodies: string[] = [seed.brief];
    const authors: string[] = ["the brief"];

    for (const take of seed.takes) {
      const at = take.branchFrom === undefined ? events.length - 1 : take.branchFrom + 1;
      const name = COOKS[take.by] ?? take.by;

      /**
       * Only narrate when somebody is waiting. Extending the brief has no
       * recipient, and a sentence addressed to nobody reads as one addressed
       * to the brief -- which is what it did the first time it ran.
       */
      const changed =
        at > 0
          ? await narrateChange(host, {
              piece_title: seed.title,
              parent_body: bodies[at]!,
              parent_author: authors[at]!,
              child_body: take.body,
              child_author: name,
            })
          : undefined;
      if (changed) sentences++;

      const r = extendPiece(repo, {
        piece_id: piece.piece_id,
        parent_event_id: events[at]!,
        fan_id: take.by,
        body: take.body,
        values: take.values,
        changed,
        display_name: name,
      });

      const on = take.branchFrom === undefined ? "" : `  ${D}(branching off ${authors[at]})${R}`;
      console.log(`    ${name}${on}`);
      if (changed) console.log(`      ${Y}${changed}${R}`);

      events.push(r.extension.event_id);
      bodies.push(take.body);
      authors.push(name);
    }
  }

  console.log("");
  console.log(`  ${B}The Kitchen${R} — ${KITCHEN.length} pieces, ${DB}`);
  console.log(`  ${D}${sentences} sentence(s) written by the host${R}`);
  if (host.name !== "minds") {
    console.log(`  ${D}Deterministic host: work is stored, sentences are not.${R}`);
    console.log(`  ${D}INSPIRAL_HOST=minds npm run kitchen -- --reset  writes them.${R}`);
  }
  console.log("");
  console.log(`  npm run pieces:serve -- --db ${DB}`);
  console.log("");

  await host.close();
  repo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
