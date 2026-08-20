/**
 * THEMED BUILD PALETTES: constraint as a creativity aid.
 *
 * The hotbar used to be the same nine blocks in every world, which is a bad
 * deal for the player twice over. It offers no direction -- a blank page with
 * twelve crayons -- and it lets anyone put a blue tile roof and a glass wall in
 * the middle of a firelit tavern, so the first thing a visitor builds is the
 * first thing that makes the world look worse.
 *
 * A palette per archetype fixes both at once. The tavern hands you plank,
 * timber and lantern; the council chamber hands you stone and banner-red brick.
 * Anything you build is on-theme by construction, which means it looks like it
 * belongs without anyone having to have taste. The restriction is the feature:
 * it is the difference between "here are all the colours" and "here is a set
 * that goes together".
 *
 * `prompt` is the other half. An empty world with a hotbar is a sandbox; a
 * world that says "the ward needs a notice board" is a brief. It is deliberately
 * ONE line and carries no scoring, no completion state and no reward -- the
 * reward is that the cast reacts to what you put down, which is the thing that
 * separates this from Minecraft.
 *
 * Pure data, no imports, so it can be tested without a browser.
 */

/**
 * Block names, most on-theme first -- slot 1 is the signature material of the
 * room, because slot 1 is what a player builds with before they read anything.
 * Names are validated against the block table by tests; a typo here would
 * silently hand the player an air block.
 */
export const PALETTES = {
  tavern: {
    blocks: ["plank", "timber", "lantern", "brick", "cobble", "plaster", "glass", "roof", "stone"],
    prompt: "Someone keeps starting fights by the door. Build a bench where they can be seen.",
  },
  council_chamber: {
    blocks: ["stone", "cobble", "brick", "plaster", "timber", "lantern", "glass", "plank", "roof"],
    prompt: "Notices go up and come down overnight. Build a board that cannot be reached from the floor.",
  },
  market_plaza: {
    blocks: ["cobble", "timber", "plank", "brick", "sand", "plaster", "lantern", "glass", "roof"],
    prompt: "The ward has nowhere to post a public notice. Build one where everyone passes.",
  },
  studio: {
    blocks: ["plaster", "plank", "glass", "lantern", "timber", "stone", "brick", "roof", "cobble"],
    prompt: "There is nowhere to sit that is not on camera. Build somewhere off-frame.",
  },
  ballroom: {
    blocks: ["plaster", "lantern", "glass", "timber", "plank", "brick", "stone", "roof", "cobble"],
    prompt: "Every conversation here is overheard. Build a corner that isn't.",
  },
  training_hall: {
    blocks: ["plank", "stone", "timber", "cobble", "plaster", "lantern", "brick", "glass", "roof"],
    prompt: "Challenges get disputed because nobody agrees where the line was. Build the line.",
  },
  cafe: {
    blocks: ["plank", "plaster", "glass", "timber", "lantern", "brick", "cobble", "stone", "roof"],
    prompt: "The regulars have no table of their own. Build one, somewhere with a view of the door.",
  },
  arena: {
    blocks: ["stone", "cobble", "timber", "sand", "plank", "brick", "lantern", "roof", "plaster"],
    prompt: "The crowd cannot see over each other. Build a stand for the ones at the back.",
  },
};

/** The palette every unknown archetype falls back to. Never throw here. */
export const DEFAULT_PALETTE = "market_plaza";

export function paletteFor(archetypeId) {
  return PALETTES[archetypeId] ?? PALETTES[DEFAULT_PALETTE];
}

export const PALETTE_IDS = Object.keys(PALETTES);
