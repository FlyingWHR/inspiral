/**
 * THE COLOUR SYSTEM. Hex values generated from docs/art/palettes.ts --
 * do not hand-edit them here; regenerate if the study is revised.
 *
 * Five palettes, one system: a shared value ladder, fourteen fixed roles, and
 * character colours held byte-identical across all five so the cast reads the
 * same in every world.
 *
 * WHY THIS REPLACES OUR BLOCK COLOURS OUTRIGHT rather than blending with them.
 * Ours had collapsed: nine of twelve materials sat between hue 40 and 89, and
 * the highest chroma anything reached was 0.1158 -- so no material was CAPABLE
 * of being a focal point. The study's own diagnose.py, run on four of our real
 * frames, returned "NO ACCENT" on all four and "VALUE. Masses are crowded" on
 * two. The ladder below is ABSOLUTE: nothing is derived from, blended with, or
 * relative to the old colours. Assign a block to a slot and its L becomes the
 * ladder's L.
 *
 *   VOID 0.19   DARK 0.32   MID 0.48   LIGHT 0.64   HIGH 0.80   BACKDROP free
 *
 * BACKDROP is the one value the ladder deliberately does not fix, because it is
 * the sky and has to be decided against the lit top planes of the actual scene.
 */

export const VALUE_LADDER = { VOID: 0.19, DARK: 0.32, MID: 0.48, LIGHT: 0.64, HIGH: 0.8, BACKDROP: null };

/** Byte-identical in every palette, on purpose: the cast must read in all of them. */
export const CHARACTER = {
  chrDeep: 0x3a1819,
  chrCloth: 0x902d5a,
  chrSkin: 0xa86753,
  chrTrim: 0x00b5b5,
  chrLight: 0xc3d4dd,
};

export const PALETTES = {
  /** A low room lit by one fire, with the cold blue night pressing at the windows. */
  emberlightTavern: {
    void: 0x170e25,
    groundA: 0x432c28,
    groundB: 0x412638,
    structA: 0x775541,
    structB: 0x4d6053,
    structC: 0x4d586d,
    fieldA: 0xaa845c,
    fieldB: 0xa67e75,
    highA: 0xdab884,
    highB: 0xa3bed9,
    backdrop: 0x1d2d4c,
    accentHot: 0xd75a21,
    accentCool: 0x00629e,
    emissive: 0xffda7d,
  },
  /** A cold stone chamber where the only warmth is institutional: candle, gold, and the red of office. */
  cinderCouncil: {
    void: 0x0c1325,
    groundA: 0x273442,
    groundB: 0x342c40,
    structA: 0x51606d,
    structB: 0x4d5f5f,
    structC: 0x704e47,
    fieldA: 0x7c8f9d,
    fieldB: 0x8e897a,
    highA: 0xafc1cd,
    highB: 0xccb79a,
    backdrop: 0xe5f1f7,
    accentHot: 0xa93622,
    accentCool: 0x007f94,
    emissive: 0xffcc69,
  },
  /** Midday. Bleached stone, hard blue shadow, and cloth doing all the shouting. */
  saffronMarket: {
    void: 0x0e132d,
    groundA: 0x29354d,
    groundB: 0x4c2623,
    structA: 0x7b533f,
    structB: 0x44634c,
    structC: 0x385b7e,
    fieldA: 0xa28c63,
    fieldB: 0x6b9a71,
    highA: 0xd0c093,
    highB: 0x98c6d9,
    backdrop: 0x60aedf,
    accentHot: 0xe25500,
    accentCool: 0x00736b,
    emissive: 0xfae8a3,
  },
  /** Wet stone, low fog, and a rose sun that has not cleared the roofline yet. */
  saltHarbourDawn: {
    void: 0x0a1326,
    groundA: 0x243543,
    groundB: 0x392a3d,
    structA: 0x515f71,
    structB: 0x4b605a,
    structC: 0x724d4b,
    fieldA: 0x818ca6,
    fieldB: 0x96809c,
    highA: 0xdfb3a0,
    highB: 0xa9bdd4,
    backdrop: 0x9694b6,
    accentHot: 0xf75d57,
    accentCool: 0x007492,
    emissive: 0xffcd94,
  },
  /** Last blue light under a canopy, with one lamp doing the work of a sun. */
  thornwoodNightfall: {
    void: 0x0e1129,
    groundA: 0x1f2f44,
    groundB: 0x063428,
    structA: 0x42536e,
    structB: 0x345944,
    structC: 0x534662,
    fieldA: 0x5d7f9b,
    fieldB: 0x588366,
    highA: 0x77adc9,
    highB: 0x98a886,
    backdrop: 0x5d6499,
    accentHot: 0xd16e00,
    accentCool: 0x00818c,
    emissive: 0xffdca1,
  },
};

/**
 * BLOCK -> SLOT. This is the whole adoption: author against slot names, never
 * against colours, and a palette swap becomes one line.
 *
 * The tier each block lands in is a composition decision, not a naming one:
 *
 *  - grass/dirt are the GROUND PLANE, so they take the DARK tier. That felt
 *    wrong until measured -- ground reads dark in almost every game frame worth
 *    looking at, and putting it at MID is what flattens a scene.
 *  - roof takes highA, which is the sky/roof fix. Our roof was L=0.514 C=0.1158
 *    h=279 against a market sky at L=0.610 C=0.1150 h=253: 0.096 of value, 26
 *    degrees of hue and no chroma difference at all, on the most important
 *    silhouette edge in the frame. As highA against backdrop the roofline
 *    separates by roughly 0.19 L and by chroma as well as hue.
 *  - brick becomes accentHot and lantern becomes emissive. These are the only
 *    high-chroma slots and they are deliberately rare: hearths, chimney
 *    breasts, sconces. Rule R5 -- saturation is a currency, spend it in one
 *    place.
 */
export const BLOCK_SLOTS = {
  grass: "groundA",
  dirt: "groundB",
  // Wood takes the WARM mid and stone the cool one, not the other way round.
  // The first mapping had timber on structC, and since the tavern's whole floor
  // and every table is timber, the room came out with a blue-grey floor under
  // warm walls -- the palette's cool slot spread across the largest surface in
  // frame. Swapping them puts the cool mid where cobble and stone actually are:
  // hearth bases, paving, the odd wall.
  cobble: "structC",
  stone: "structB",
  timber: "structA",
  plaster: "fieldA",
  plank: "fieldB",
  sand: "highB",
  roof: "highA",
  brick: "accentHot",
  glass: "accentCool",
  lantern: "emissive",
};

/**
 * ARCHETYPE -> PALETTE. Three map directly onto the palettes they were written
 * for. The other five DERIVE: same palette, same ladder, but a slot permutation
 * so a different hue leads. Deriving rather than inventing is the point -- five
 * fresh palettes would be five chances to reintroduce the collapse.
 *
 * `swap` renames slots for that archetype only. It cannot change any value,
 * because both sides of every swap are in the same tier.
 */
export const ARCHETYPE_PALETTE = {
  tavern: { palette: "emberlightTavern" },
  council_chamber: { palette: "cinderCouncil" },
  market_plaza: { palette: "saffronMarket" },

  // Soft dawn light through glass; the gentlest room in the set.
  cafe: { palette: "saltHarbourDawn" },
  /**
   * Outdoor spectacle. Thornwood was the obvious literary fit -- dusk, canopy,
   * one lamp -- and it measured worst of the eight at 0.300 frame spread,
   * because it is the deliberately low-key palette whose ladder tops out at
   * L 0.72 and an open scene is mostly sky. Saffron's bright backdrop gives the
   * tiers something to be dark against. Thornwood Nightfall is therefore
   * currently unused, and that is on purpose: four palettes that fit beat five
   * with one forced.
   */
  arena: { palette: "saffronMarket", swap: { structA: "structC", structC: "structA" } },

  // Gold on violet rather than gold on brown: structC (violet-blue) leads and
  // the warm accent stays, so it is the tavern's ladder wearing evening dress.
  ballroom: { palette: "emberlightTavern", swap: { structA: "structC", structC: "structA", fieldA: "fieldB", fieldB: "fieldA" } },
  // Cinder Council's pale L=0.95 backdrop is already a cyclorama; leading with
  // the cool grey-green structB makes the room read as lit rather than daylit.
  studio: { palette: "cinderCouncil", swap: { structA: "structB", structB: "structA" } },
  // Bright and utilitarian: Saffron's green structB forward, warm wood back.
  training_hall: { palette: "saffronMarket", swap: { structA: "structB", structB: "structA", fieldA: "fieldB", fieldB: "fieldA" } },
};

export const DEFAULT_PALETTE_KEY = "emberlightTavern";

/** The resolved slot table for an archetype, swaps applied. */
export function slotsFor(archetypeId) {
  const spec = ARCHETYPE_PALETTE[archetypeId] ?? { palette: DEFAULT_PALETTE_KEY };
  const base = PALETTES[spec.palette] ?? PALETTES[DEFAULT_PALETTE_KEY];
  if (!spec.swap) return base;
  const out = { ...base };
  for (const [from, to] of Object.entries(spec.swap)) out[from] = base[to];
  return out;
}

/**
 * Colours for the block table, indexed the same way BLOCKS is.
 * `names` is the ordered block-name list so this stays in step with blocks.js
 * without importing it -- keeping this module free of imports is what lets
 * vitest read it without a WebGL context.
 */
export function blockColorsFor(archetypeId, names) {
  const slots = slotsFor(archetypeId);
  return names.map((n) => {
    const slot = BLOCK_SLOTS[n];
    return slot ? (slots[slot] ?? 0xff00ff) : null;
  });
}

/** The sky. BACKDROP is never a block colour -- rule R3's carve-out. */
export function backdropFor(archetypeId) {
  return slotsFor(archetypeId).backdrop;
}

/** The darkest tier, for fog, occlusion and the underside of the sky dome. */
export function voidFor(archetypeId) {
  return slotsFor(archetypeId).void;
}
