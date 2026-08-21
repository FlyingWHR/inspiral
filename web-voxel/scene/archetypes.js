/**
 * SCENE ARCHETYPES.
 *
 * A world should not be a random room. Where a cast stands is characterisation:
 * a tavern affords grudges and regulars, a council chamber affords procedure and
 * standing, an arena affords an audience picking sides. Onboarding chooses one
 * of these from the IP bible, so a geopolitical strategy game and a maker
 * channel do not both open into the same invented ward.
 *
 * Each archetype is DATA consumed by the primitives in ./primitives.js. There
 * is no new engine code here and none is needed: the ward was already generated
 * from a layout definition, and this is that same path with eight definitions
 * instead of one.
 *
 * `places` are the named locations the directive system can send someone to.
 * They are the archetype's contract with canon: canon says "kiln_row" or
 * "the_bar", the surface turns it into coordinates, and nothing above the seam
 * learns what a coordinate is.
 *
 * `affords` is the one line that justifies the choice on camera.
 */

import { BLOCK_IDS as B } from "../voxel/blocks.js";

/** Eight scenes chosen to span the kinds of IP that actually show up:
 *  a hangout, a civic square, a seat of power, a training hall, a society
 *  event, a spectacle, a broadcast set and a low-stakes lounge. Between them
 *  they cover feuds, politics, rivalry, status, fandom and creator formats. */
export const ARCHETYPES = {
  // -------------------------------------------------------------------------
  tavern: {
    id: "tavern",
    indoor: true,
    name: "The Tavern",
    affords:
      "regulars, long-running grudges, and gossip that travels faster than anyone intends",
    sky: 0x2a2622,
    spawn: { x: 0, z: -12 },
    build: [
      { op: "terrain", floorR: 20, floor: B.timber, surround: B.dirt, roll: 0.4 },
      { op: "enclosure", kind: "room", w: 30, d: 24, height: 6, material: B.plaster,
        roofMaterial: B.roof, gate: 2 },

      // --- the bar, along the back wall -----------------------------------
      { op: "prop", kind: "block", at: [0, 9], w: 15, d: 2, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [0, 11], w: 17, d: 1, h: 3, material: B.brick },
      // bottles on the back shelf: single emissive blocks at eye height, which
      // is what makes a bar read as a bar rather than as a long brown box
      { op: "prop", kind: "block", at: [-5, 11], w: 1, d: 1, h: 1, y: 3, material: B.glass },
      { op: "prop", kind: "block", at: [-3, 11], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [-1, 11], w: 1, d: 1, h: 1, y: 3, material: B.glass },
      { op: "prop", kind: "block", at: [2, 11], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [4, 11], w: 1, d: 1, h: 1, y: 3, material: B.glass },
      { op: "prop", kind: "block", at: [6, 11], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      // barrels behind the bar
      { op: "prop", kind: "block", at: [-8, 10], w: 2, d: 2, h: 2, material: B.timber },
      { op: "prop", kind: "block", at: [9, 10], w: 2, d: 2, h: 2, material: B.timber },

      // --- the hearth, the warmest seat in the room -----------------------
      { op: "prop", kind: "block", at: [-13, 8], w: 4, d: 4, h: 1, material: B.cobble },
      { op: "prop", kind: "block", at: [-13, 10], w: 5, d: 1, h: 5, material: B.brick },
      // the fire itself, and its glow. Emissive blocks, not a texture.
      { op: "prop", kind: "block", at: [-13, 8], w: 2, d: 1, h: 1, material: B.lantern },

      // --- ceiling beams --------------------------------------------------
      // A blank ceiling is half the frame doing nothing. Beams give the upper
      // half structure and catch the light from the lanterns below.
      { op: "prop", kind: "block", at: [0, -8], w: 29, d: 1, h: 1, y: 4, material: B.timber },
      { op: "prop", kind: "block", at: [0, -2], w: 29, d: 1, h: 1, y: 4, material: B.timber },
      { op: "prop", kind: "block", at: [0, 4], w: 29, d: 1, h: 1, y: 4, material: B.timber },

      // --- tables, benches and stools -------------------------------------
      { op: "prop", kind: "block", at: [-8, 0], w: 3, d: 3, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [-8, -3], w: 3, d: 1, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [-8, 3], w: 3, d: 1, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [8, 0], w: 3, d: 3, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [8, -3], w: 3, d: 1, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [8, 3], w: 3, d: 1, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [0, -7], w: 5, d: 2, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [-4, -7], w: 1, d: 1, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [4, -7], w: 1, d: 1, h: 1, material: B.plank },

      // --- light: sconces at head height, lanterns hung from the beams -----
      { op: "prop", kind: "block", at: [-14, 2], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [14, 2], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [-14, -6], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [14, -6], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [-6, -2], w: 1, d: 1, h: 1, y: 3, material: B.lantern },
      { op: "prop", kind: "block", at: [6, -2], w: 1, d: 1, h: 1, y: 3, material: B.lantern },

      // --- the window ------------------------------------------------------
      // One shaft of cold daylight in a warm room. It is the only cool thing in
      // frame, which is what stops the whole tavern reading as one orange wash,
      // and it gives the god-ray something to come from.
      // A BANK of windows, not a porthole.
      //
      // Emberlight Tavern is specified as a warm key against a cool night seen
      // through glazing, and the cool counterpoint is supposed to arrive as
      // glass and backdrop, not as tinted fill light. Trying to supply it with
      // a blue hemisphere instead cost value and cancelled the accent -- warm
      // and cool light are complementary and they mix to mud. With one small
      // window there was simply nothing cool in frame to counterpoint with.
      { op: "prop", kind: "block", at: [15, 6], w: 1, d: 5, h: 4, y: 1, material: B.glass },
      { op: "prop", kind: "block", at: [15, -2], w: 1, d: 5, h: 4, y: 1, material: B.glass },
      { op: "prop", kind: "block", at: [-15, 2], w: 1, d: 4, h: 4, y: 1, material: B.glass },
      /**
       * A LIT CORNICE. The HIGH tier has to appear or the frame truncates the
       * top of the ladder however good the palette is -- the five interiors all
       * measured under the 0.45 spread bar with plenty of VOID overhead and
       * nothing bright anywhere. A band of highB just under the ceiling is a
       * plausible piece of architecture that catches the practicals and puts
       * the top tier back in frame.
       */
      { op: "prop", kind: "block", at: [0, -11], w: 29, d: 1, h: 1, y: 4, material: B.sand },
      { op: "prop", kind: "block", at: [0, 11], w: 29, d: 1, h: 1, y: 4, material: B.sand },
      { op: "prop", kind: "block", at: [-14, 0], w: 1, d: 21, h: 1, y: 4, material: B.sand },
      { op: "prop", kind: "block", at: [14, 0], w: 1, d: 21, h: 1, y: 4, material: B.sand },
    ],
    places: {
      the_bar: { x: 0, z: 6 },
      the_hearth: { x: -9, z: 7 },
      corner_table: { x: 8, z: -2 },
      long_table: { x: -8, z: -2 },
      the_door: { x: 0, z: -10 },
    },
  },

  // -------------------------------------------------------------------------
  market_plaza: {
    id: "market_plaza",
    name: "The Market Plaza",
    affords:
      "civic factions, public confrontation, and quarrels conducted in front of witnesses",
    sky: 0x8fb3d9,
    spawn: { x: 0, z: -30 },
    build: [
      { op: "terrain", radius: 44, floorR: 19, floor: B.cobble, surround: B.grass },
      { op: "path", from: [0, -40], to: [0, -20], material: B.cobble },
      { op: "enclosure", kind: "ring", radius: 40, height: 5, material: B.stone },
      { op: "building", at: [-22, -14], w: 11, d: 11, h: 7, wall: B.plaster, roof: B.roof },
      { op: "building", at: [22, -14], w: 11, d: 11, h: 8, wall: B.brick, roof: B.roof },
      { op: "building", at: [0, 24], w: 13, d: 11, h: 6, wall: B.plank, roof: B.roof,
        door: "north" },
      { op: "well", at: [0, 0] },
      /**
       * THE ACCENT MASS. Rule R5: architecture chroma is capped low and the
       * warm accent is the only saturated thing in the room, so it has to be
       * big enough to READ. Every archetype but the tavern and the arena
       * measured "NO ACCENT" with a single small brick prop -- P99.5 chroma
       * under 0.13 and under 1% hot area. This is a deliberate banner-sized
       * mass on the wall the camera looks at.
       */
      { op: "prop", kind: "block", at: [-11, 9], w: 7, d: 1, h: 3, y: 2, material: B.brick },
      { op: "prop", kind: "block", at: [11, 9], w: 7, d: 1, h: 3, y: 2, material: B.brick },
      { op: "prop", kind: "block", at: [0, -13], w: 9, d: 1, h: 3, y: 2, material: B.brick },
    ],
    places: {
      plaza: { x: 0, z: 9 },
      counting_house: { x: -13, z: -7 },
      kiln_row: { x: 13, z: -7 },
      almshouse: { x: 0, z: 15 },
      gate: { x: 0, z: -30 },
    },
  },

  // -------------------------------------------------------------------------
  council_chamber: {
    id: "council_chamber",
    indoor: true,
    name: "The Council Chamber",
    affords:
      "procedure as a weapon: standing, precedent, and things minuted that cannot be unsaid",
    sky: 0x1e2430,
    spawn: { x: 0, z: -14 },
    build: [
      { op: "terrain", floorR: 22, floor: B.stone, surround: B.stone, roll: 0.2 },
      { op: "enclosure", kind: "room", w: 34, d: 28, height: 8, material: B.stone,
        roofMaterial: B.stone, gate: 2 },
      // the dais at the head of the room
      { op: "platform", at: [0, 10], w: 15, d: 5, h: 2, material: B.brick },
      { op: "prop", kind: "block", at: [0, 11], w: 5, d: 1, h: 2, material: B.timber },
      // the long table everyone argues across
      { op: "prop", kind: "block", at: [0, 0], w: 5, d: 15, h: 1, material: B.timber },
      { op: "prop", kind: "pillar", at: [-12, -8], h: 7, material: B.stone },
      { op: "prop", kind: "pillar", at: [12, -8], h: 7, material: B.stone },
      { op: "prop", kind: "pillar", at: [-12, 6], h: 7, material: B.stone },
      { op: "prop", kind: "pillar", at: [12, 6], h: 7, material: B.stone },
      { op: "prop", kind: "lamp", at: [-6, 10], h: 5 },
      { op: "prop", kind: "lamp", at: [6, 10], h: 5 },
      /**
       * THE ACCENT MASS. Rule R5: architecture chroma is capped low and the
       * warm accent is the only saturated thing in the room, so it has to be
       * big enough to READ. Every archetype but the tavern and the arena
       * measured "NO ACCENT" with a single small brick prop -- P99.5 chroma
       * under 0.13 and under 1% hot area. This is a deliberate banner-sized
       * mass on the wall the camera looks at.
       */
      { op: "prop", kind: "block", at: [0, 13], w: 13, d: 1, h: 5, y: 1, material: B.brick },
      { op: "prop", kind: "block", at: [-9, 13], w: 2, d: 1, h: 6, y: 1, material: B.brick },
      { op: "prop", kind: "block", at: [9, 13], w: 2, d: 1, h: 6, y: 1, material: B.brick },
      /**
       * A LIT CORNICE. The HIGH tier has to appear or the frame truncates the
       * top of the ladder however good the palette is -- the five interiors all
       * measured under the 0.45 spread bar with plenty of VOID overhead and
       * nothing bright anywhere. A band of highB just under the ceiling is a
       * plausible piece of architecture that catches the practicals and puts
       * the top tier back in frame.
       */
      { op: "prop", kind: "block", at: [0, -13], w: 33, d: 1, h: 1, y: 6, material: B.sand },
      { op: "prop", kind: "block", at: [0, 13], w: 33, d: 1, h: 1, y: 6, material: B.sand },
      { op: "prop", kind: "block", at: [-16, 0], w: 1, d: 25, h: 1, y: 6, material: B.sand },
      { op: "prop", kind: "block", at: [16, 0], w: 1, d: 25, h: 1, y: 6, material: B.sand },
    ],
    places: {
      the_dais: { x: 0, z: 7 },
      table_head: { x: -5, z: 4 },
      table_foot: { x: 5, z: -6 },
      the_gallery: { x: -12, z: -2 },
      the_doors: { x: 0, z: -12 },
    },
  },

  // -------------------------------------------------------------------------
  training_hall: {
    id: "training_hall",
    indoor: true,
    name: "The Training Hall",
    affords: "rivalry with a scoreboard: challenges taken up, form judged, ranks contested",
    sky: 0x35302a,
    spawn: { x: 0, z: -13 },
    build: [
      { op: "terrain", floorR: 20, floor: B.plank, surround: B.dirt, roll: 0.3 },
      { op: "enclosure", kind: "room", w: 30, d: 26, height: 7, material: B.plaster,
        roofMaterial: B.roof, gate: 2 },
      // the mat: raised, rimmed, unmistakably the place things get settled
      { op: "platform", at: [0, 2], w: 15, d: 15, h: 1, material: B.sand, rim: B.timber },
      { op: "prop", kind: "block", at: [-12, -8], w: 3, d: 2, h: 1, material: B.stone },
      { op: "prop", kind: "block", at: [12, -8], w: 3, d: 2, h: 1, material: B.stone },
      { op: "prop", kind: "block", at: [-12, 9], w: 3, d: 4, h: 1, material: B.timber },
      { op: "prop", kind: "lamp", at: [-10, 0], h: 5 },
      { op: "prop", kind: "lamp", at: [10, 0], h: 5 },
      /**
       * THE ACCENT MASS. Rule R5: architecture chroma is capped low and the
       * warm accent is the only saturated thing in the room, so it has to be
       * big enough to READ. Every archetype but the tavern and the arena
       * measured "NO ACCENT" with a single small brick prop -- P99.5 chroma
       * under 0.13 and under 1% hot area. This is a deliberate banner-sized
       * mass on the wall the camera looks at.
       */
      { op: "prop", kind: "block", at: [0, 12], w: 15, d: 1, h: 4, y: 2, material: B.brick },
      { op: "prop", kind: "block", at: [0, 0], w: 9, d: 7, h: 1, material: B.brick },
      /**
       * A LIT CORNICE. The HIGH tier has to appear or the frame truncates the
       * top of the ladder however good the palette is -- the five interiors all
       * measured under the 0.45 spread bar with plenty of VOID overhead and
       * nothing bright anywhere. A band of highB just under the ceiling is a
       * plausible piece of architecture that catches the practicals and puts
       * the top tier back in frame.
       */
      { op: "prop", kind: "block", at: [0, -12], w: 29, d: 1, h: 1, y: 5, material: B.sand },
      { op: "prop", kind: "block", at: [0, 12], w: 29, d: 1, h: 1, y: 5, material: B.sand },
      { op: "prop", kind: "block", at: [-14, 0], w: 1, d: 23, h: 1, y: 5, material: B.sand },
      { op: "prop", kind: "block", at: [14, 0], w: 1, d: 23, h: 1, y: 5, material: B.sand },
    ],
    places: {
      the_mat: { x: 0, z: 2 },
      the_weights: { x: -12, z: -6 },
      the_bench: { x: 12, z: -6 },
      the_rack: { x: -11, z: 9 },
      the_door: { x: 0, z: -11 },
    },
  },

  // -------------------------------------------------------------------------
  ballroom: {
    id: "ballroom",
    indoor: true,
    name: "The Ballroom",
    affords:
      "status read at a glance: who is introduced to whom, who is cut, and who is watching",
    sky: 0x241d2e,
    spawn: { x: 0, z: -16 },
    build: [
      { op: "terrain", floorR: 24, floor: B.plaster, surround: B.stone, roll: 0.2 },
      { op: "enclosure", kind: "room", w: 36, d: 30, height: 9, material: B.plaster,
        roofMaterial: B.roof, gate: 3 },
      // musicians' dais at the far end
      { op: "platform", at: [0, 12], w: 13, d: 4, h: 2, material: B.plank },
      { op: "prop", kind: "pillar", at: [-13, -9], h: 8, material: B.plaster },
      { op: "prop", kind: "pillar", at: [13, -9], h: 8, material: B.plaster },
      { op: "prop", kind: "pillar", at: [-13, 4], h: 8, material: B.plaster },
      { op: "prop", kind: "pillar", at: [13, 4], h: 8, material: B.plaster },
      { op: "prop", kind: "block", at: [-15, -2], w: 3, d: 5, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [15, -2], w: 3, d: 5, h: 1, material: B.timber },
      { op: "prop", kind: "lamp", at: [-6, 10], h: 6 },
      { op: "prop", kind: "lamp", at: [6, 10], h: 6 },
      /**
       * THE ACCENT MASS. Rule R5: architecture chroma is capped low and the
       * warm accent is the only saturated thing in the room, so it has to be
       * big enough to READ. Every archetype but the tavern and the arena
       * measured "NO ACCENT" with a single small brick prop -- P99.5 chroma
       * under 0.13 and under 1% hot area. This is a deliberate banner-sized
       * mass on the wall the camera looks at.
       */
      { op: "prop", kind: "block", at: [0, 14], w: 15, d: 1, h: 6, y: 1, material: B.brick },
      { op: "prop", kind: "block", at: [-11, 14], w: 2, d: 1, h: 7, y: 1, material: B.brick },
      { op: "prop", kind: "block", at: [11, 14], w: 2, d: 1, h: 7, y: 1, material: B.brick },
      /**
       * A LIT CORNICE. The HIGH tier has to appear or the frame truncates the
       * top of the ladder however good the palette is -- the five interiors all
       * measured under the 0.45 spread bar with plenty of VOID overhead and
       * nothing bright anywhere. A band of highB just under the ceiling is a
       * plausible piece of architecture that catches the practicals and puts
       * the top tier back in frame.
       */
      { op: "prop", kind: "block", at: [0, -14], w: 35, d: 1, h: 1, y: 7, material: B.sand },
      { op: "prop", kind: "block", at: [0, 14], w: 35, d: 1, h: 1, y: 7, material: B.sand },
      { op: "prop", kind: "block", at: [-17, 0], w: 1, d: 27, h: 1, y: 7, material: B.sand },
      { op: "prop", kind: "block", at: [17, 0], w: 1, d: 27, h: 1, y: 7, material: B.sand },
    ],
    places: {
      the_floor: { x: 0, z: 0 },
      the_dais: { x: 0, z: 8 },
      east_alcove: { x: 13, z: -2 },
      west_alcove: { x: -13, z: -2 },
      the_stair: { x: 0, z: -13 },
    },
  },

  // -------------------------------------------------------------------------
  arena: {
    id: "arena",
    name: "The Arena",
    affords: "spectacle with a crowd in it: sides taken loudly, reputations made and lost in public",
    sky: 0x9ab8d4,
    spawn: { x: 0, z: -26 },
    build: [
      { op: "terrain", radius: 40, floorR: 13, floor: B.sand, surround: B.grass, roll: 0.5 },
      { op: "tiers", inner: 14, rows: 5, material: B.stone },
      { op: "enclosure", kind: "ring", radius: 30, height: 4, material: B.brick,
        crenellate: false },
      { op: "prop", kind: "lamp", at: [-11, -11], h: 6 },
      { op: "prop", kind: "lamp", at: [11, -11], h: 6 },
      { op: "prop", kind: "lamp", at: [-11, 11], h: 6 },
      { op: "prop", kind: "lamp", at: [11, 11], h: 6 },
    ],
    places: {
      the_sand: { x: 0, z: 0 },
      north_gate: { x: 0, z: 11 },
      south_gate: { x: 0, z: -11 },
      east_stand: { x: 11, z: 0 },
      west_stand: { x: -11, z: 0 },
    },
  },

  // -------------------------------------------------------------------------
  studio: {
    id: "studio",
    indoor: true,
    name: "The Studio",
    affords:
      "an audience-facing set: formats, bits, guests, and the difference between on and off camera",
    sky: 0x1a1a20,
    spawn: { x: 0, z: -14 },
    build: [
      { op: "terrain", floorR: 20, floor: B.plaster, surround: B.stone, roll: 0.2 },
      { op: "enclosure", kind: "room", w: 30, d: 26, height: 7, material: B.stone,
        roofMaterial: B.stone, gate: 2 },
      // the desk, raised so it reads as the front of the room
      { op: "platform", at: [0, 8], w: 17, d: 7, h: 1, material: B.plank },
      { op: "prop", kind: "block", at: [0, 9], w: 9, d: 2, h: 1, material: B.brick },
      // audience benches facing it
      { op: "prop", kind: "block", at: [0, -3], w: 19, d: 1, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [0, -6], w: 19, d: 1, h: 2, material: B.timber },
      { op: "prop", kind: "lamp", at: [-9, 5], h: 6 },
      { op: "prop", kind: "lamp", at: [9, 5], h: 6 },
      { op: "prop", kind: "pillar", at: [-13, 11], h: 6, material: B.timber },
      { op: "prop", kind: "pillar", at: [13, 11], h: 6, material: B.timber },
      /**
       * THE ACCENT MASS. Rule R5: architecture chroma is capped low and the
       * warm accent is the only saturated thing in the room, so it has to be
       * big enough to READ. Every archetype but the tavern and the arena
       * measured "NO ACCENT" with a single small brick prop -- P99.5 chroma
       * under 0.13 and under 1% hot area. This is a deliberate banner-sized
       * mass on the wall the camera looks at.
       */
      { op: "prop", kind: "block", at: [0, 12], w: 17, d: 1, h: 5, y: 1, material: B.brick },
    ],
    places: {
      the_desk: { x: -3, z: 7 },
      guest_chair: { x: 4, z: 7 },
      the_audience: { x: 0, z: -1 },
      backstage: { x: -12, z: 10 },
      the_door: { x: 0, z: -11 },
    },
  },

  // -------------------------------------------------------------------------
  cafe: {
    id: "cafe",
    indoor: true,
    name: "The Café",
    affords: "low-stakes hours where people say the thing they would not say anywhere else",
    sky: 0x6f8296,
    spawn: { x: 0, z: -10 },
    build: [
      { op: "terrain", floorR: 16, floor: B.plank, surround: B.grass, roll: 0.3 },
      { op: "enclosure", kind: "room", w: 24, d: 20, height: 6, material: B.plaster,
        roofMaterial: B.roof, gate: 2 },
      { op: "prop", kind: "block", at: [0, 7], w: 11, d: 2, h: 1, material: B.brick },
      { op: "prop", kind: "block", at: [-7, 0], w: 3, d: 3, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [7, 0], w: 3, d: 3, h: 1, material: B.timber },
      { op: "prop", kind: "block", at: [0, -4], w: 3, d: 3, h: 1, material: B.timber },
      { op: "prop", kind: "lamp", at: [-9, 5], h: 4 },
      { op: "prop", kind: "lamp", at: [9, 5], h: 4 },
      /**
       * THE ACCENT MASS. Rule R5: architecture chroma is capped low and the
       * warm accent is the only saturated thing in the room, so it has to be
       * big enough to READ. Every archetype but the tavern and the arena
       * measured "NO ACCENT" with a single small brick prop -- P99.5 chroma
       * under 0.13 and under 1% hot area. This is a deliberate banner-sized
       * mass on the wall the camera looks at.
       */
      { op: "prop", kind: "block", at: [0, 9], w: 11, d: 1, h: 4, y: 1, material: B.brick },
      /**
       * A LIT CORNICE. The HIGH tier has to appear or the frame truncates the
       * top of the ladder however good the palette is -- the five interiors all
       * measured under the 0.45 spread bar with plenty of VOID overhead and
       * nothing bright anywhere. A band of highB just under the ceiling is a
       * plausible piece of architecture that catches the practicals and puts
       * the top tier back in frame.
       */
      { op: "prop", kind: "block", at: [0, -9], w: 23, d: 1, h: 1, y: 4, material: B.sand },
      { op: "prop", kind: "block", at: [0, 9], w: 23, d: 1, h: 1, y: 4, material: B.sand },
      { op: "prop", kind: "block", at: [-11, 0], w: 1, d: 17, h: 1, y: 4, material: B.sand },
      { op: "prop", kind: "block", at: [11, 0], w: 1, d: 17, h: 1, y: 4, material: B.sand },
    ],
    places: {
      the_counter: { x: 0, z: 4 },
      window_table: { x: 7, z: -2 },
      corner_table: { x: -7, z: -2 },
      the_door: { x: 0, z: -8 },
    },
  },
};

/** Stable list, so the schema enum and the docs cannot drift from the library. */
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

/** The one to fall back to when nothing else is defensible. */
export const DEFAULT_ARCHETYPE = "tavern";

export function getArchetype(id) {
  return ARCHETYPES[id] ?? ARCHETYPES[DEFAULT_ARCHETYPE];
}
