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
  /** Each entry builds on the one before it unless `branchFrom` says otherwise. */
  takes: { by: string; body: string; branchFrom?: number }[];
}

const KITCHEN: Seed[] = [
  {
    title: "Five Ingredients",
    brief:
      "Five ordinary things, one dish worth arguing about. Say what you would do and why. " +
      "Disagreeing with what is already here is the point, not a problem.",
    location: "test_kitchen",
    takes: [
      {
        by: "ada",
        body:
          "Fennel, butter, lemon, salt, stale bread. Braise the fennel in the butter for an hour " +
          "until it collapses, then tear the bread in and let it drink the liquid. Lemon at the " +
          "very end, off the heat, or it turns metallic. It should taste sweet before it tastes " +
          "of anything else.",
      },
      {
        by: "maya",
        body:
          "Kept the fennel and the bread, dropped the hour. Shave it raw on a mandoline, salt it " +
          "hard, leave it twenty minutes until it weeps. Toast the bread in the butter instead. " +
          "You lose the sweetness and you get the crunch back, which is the better trade.",
      },
      {
        by: "tomas",
        body:
          "You are both throwing away the fronds. Blend them with the lemon and the butter into a " +
          "green sauce and spoon it over whichever version you made. Same five things, one more " +
          "step, and the dish stops being beige.",
      },
      {
        // Branching off Ada rather than the newest: an argument is a tree.
        by: "wren",
        branchFrom: 0,
        body:
          "The hour is right, the bread is wrong. Braise it exactly as you said and serve it on " +
          "nothing — no bread, no starch, a bowl and a spoon. The dish is already sweet and soft; " +
          "adding something to soak it up is apologising for it.",
      },
    ],
  },
  {
    title: "The Thing You Ruined",
    brief:
      "One dish you got wrong, and what you would actually change — not 'more practice'. " +
      "Name the step. Somebody else will tell you it was a different step.",
    location: "test_kitchen",
    takes: [
      {
        by: "rook",
        body:
          "Carbonara, split every time for a year. I blamed the heat. It was the pan: I was using " +
          "the same one I had rendered the guanciale in, straight off the flame, and no amount of " +
          "care survives that much residual heat. Move it to a cold bowl and it never splits again.",
      },
      {
        by: "maya",
        body:
          "It was not the pan, it was the ratio. One whole egg to two yolks per person and it will " +
          "hold in a hot pan all day. You fixed it by removing heat because you had too much white " +
          "in there to survive any.",
      },
    ],
  },
  {
    title: "Salt, Fat, Acid — and What Is Missing",
    brief:
      "Take a dish that is technically correct and boring. Say which one it is short of, " +
      "and prove it with a single change. One ingredient, not a rewrite.",
    location: "the_pass",
    takes: [
      {
        by: "tomas",
        body:
          "Roast chicken, done properly, dry-brined, rested. Boring. It is short of acid and " +
          "nobody says so because the skin is good. Squeeze half a lemon into the resting juices " +
          "and pour that back over. One ingredient. It stops being a photograph of a chicken.",
      },
    ],
  },
  {
    title: "The Family Recipe, Corrected",
    brief:
      "Something handed down to you. Change exactly one thing and say what it is for. " +
      "You are allowed to be wrong about your own grandmother.",
    location: "the_pass",
    takes: [
      {
        by: "wren",
        body:
          "My grandmother's soda bread had a cross cut in the top so the fairies could get out. " +
          "The cross is not superstition, it is heat: without it the middle stays raw and the " +
          "crust goes hard. I cut it deeper than she did. Same reason, more of it.",
      },
      {
        by: "ada",
        body:
          "Deeper is the wrong axis. Cut it the same depth and turn the oven down forty degrees " +
          "for the last ten minutes. You are treating a timing problem as a geometry problem, " +
          "which is what everybody does with inherited recipes.",
      },
    ],
  },
  {
    title: "Feed the Kitchen for Nothing",
    brief:
      "Staff meal. Whatever is about to turn, no budget, twenty minutes, twelve people. " +
      "Say what you would actually cook, not what would photograph.",
    location: "staff_table",
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
