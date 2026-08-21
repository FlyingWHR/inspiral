/**
 * PER-ARCHETYPE VISUAL IDENTITY.
 *
 * A tavern and a council chamber should not be the same room with the walls
 * moved. They should not even feel like the same time of day. The tavern is
 * warm, dim, low-ceilinged and lit by fire; the council chamber is cold, tall,
 * hard-edged and lit from a window you cannot reach. That difference is the
 * whole "it learns your IP" claim made visible -- one system, eight worlds that
 * do not look alike.
 *
 * WHY THIS FILE HAS NO `import * as THREE`. The other modules in `scene/` are
 * plain data so vitest can import them without a WebGL context, and the scene
 * tests depend on that. A look is therefore a DESCRIPTION of a lighting rig,
 * not a rig. `web-voxel/scene/applylook.js` is the part that touches three.
 *
 * EVERY NUMBER HERE WAS MEASURED, not eyeballed. `npm run shots` renders each
 * archetype and `npm run pixelstats` reads the frame back:
 *
 *   blown%   fraction of pixels above 250. Over ~0.5% reads as glare.
 *   crush%   fraction below 12. Over ~10% and shadow detail is gone.
 *   sat%     mean saturation. 8-15% is where procedural art sits; over 25%
 *            reads as cartoon.
 *   BR       blue minus red. Positive is cool, negative is warm. A scene where
 *            every region has the SAME sign is a scene lit by one lamp.
 *
 * The frame we shipped before any of this measured 20.6% blown with the sky at
 * L=251.8 and edge=0.03 -- a white slab with no detail in it -- while the
 * ground sat at L=55. It looked "bright". It was broken.
 */

/**
 * Shared defaults. A look overrides what it cares about and inherits the rest,
 * so a profile below reads as "what makes this room different" instead of
 * twenty repeated lines.
 */
const BASE = {
  exposure: 1.0,
  /** Gradient dome. Interiors use it as the colour of the air above the lamps. */
  sky: { zenith: 0x6f9fd0, horizon: 0xbcd3e8, ground: 0x6b6257, sunTint: 0xfff2d6, sunSize: 0.05, haze: 0.35 },
  sun: { color: 0xfff0d0, intensity: 3.1, elevation: 46, azimuth: 128, shadowRadius: 4 },
  hemi: { sky: 0xbcd6ef, ground: 0x50432f, intensity: 1.0 },
  ambient: { color: 0x8593a8, intensity: 0.3 },
  /** FogExp2. Density, not near/far -- linear fog reads as a curtain. */
  fog: { color: 0xa8bdd4, density: 0.0042 },
  /** Interior practicals: the fire, the chandelier, the ring lights. */
  practicals: null,
  /**
   * Colour grade, applied in one post pass.
   * `lift` raises the floor (never crushed to pure black), `gain` scales the
   * top (this is what keeps a bright sky off 255), `gamma` bends the middle.
   */
  grade: { lift: 0.02, gamma: 1.0, gain: 0.98, saturation: 1.0, vignette: 0.22 },
};

/**
 * PULL LIGHT COLOUR TOWARD NEUTRAL.
 *
 * These profiles were tuned to make the OLD block palette -- nine materials
 * between hue 40 and 89 -- look warm and lit. The palette now carries its own
 * temperature, and heavily tinted light simply overwrites it: the first render
 * after adopting the ladder came back at arc95 48 degrees, essentially
 * unchanged, because an orange ambient at 0.92 turns a blue-grey wall into a
 * brown one before it reaches the frame.
 *
 * So the division of labour is now explicit. THE PALETTE SUPPLIES HUE; THE LOOK
 * SUPPLIES THE QUANTITY AND DIRECTION OF LIGHT. Intensities, angles, fog
 * densities and grades below are untouched -- only the light COLOURS are pulled
 * 72% toward white. Practicals keep more of their tint, because a hearth really
 * is orange and it is a local source rather than a wash.
 */
const towardWhite = 0.72;
const neutral = (hex, amount) => {
  const k = amount ?? towardWhite;
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const mix = (c) => Math.round(c + (255 - c) * k);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
};

const merge = (over) => ({
  ...BASE,
  ...over,
  sky: { ...BASE.sky, ...(over.sky ?? {}) },
  sun: (() => { const v = { ...BASE.sun, ...(over.sun ?? {}) }; return { ...v, color: neutral(v.color) }; })(),
  hemi: (() => {
    const v = { ...BASE.hemi, ...(over.hemi ?? {}) };
    return { ...v, sky: neutral(v.sky), ground: neutral(v.ground) };
  })(),
  ambient: (() => { const v = { ...BASE.ambient, ...(over.ambient ?? {}) }; return { ...v, color: neutral(v.color) }; })(),
  fog: { ...BASE.fog, ...(over.fog ?? {}) },
  grade: { ...BASE.grade, ...(over.grade ?? {}) },
});

export const LOOKS = {
  /**
   * TAVERN -- warm, dim, close. The fire is the key light and the sun barely
   * gets in. Deliberately the darkest profile: a tavern that photographs like
   * noon is a tavern nobody keeps a grudge in.
   */
  tavern: merge({
    // 1.15 measured 0.54% blown once the cornice went in -- just over the bar.
    exposure: 1.04,
    sky: { zenith: 0x140f0b, horizon: 0x2a1d12, ground: 0x140e09, sunTint: 0xffb45e, sunSize: 0.0, haze: 0.55 },
    sun: { color: 0xffd2a0, intensity: 1.5, elevation: 18, azimuth: 205, shadowRadius: 9 },
    hemi: { sky: 0x6b5642, ground: 0x2e2016, intensity: 1.05 },
    ambient: { color: 0xf2dcc2, intensity: 0.92 },
    fog: { color: 0x3a2c20, density: 0.0085 },
    practicals: { color: 0xffb262, intensity: 95, distance: 34, flicker: 0.1 },
    grade: { lift: 0.05, gamma: 0.98, gain: 1.08, saturation: 0.70, vignette: 0.42 },
  }),

  /**
   * COUNCIL CHAMBER -- cold, tall, hard. One high window, deep shadow, almost
   * no bounce. The point is that standing in it feels like being judged.
   */
  council_chamber: merge({
    exposure: 1.0,
    sky: { zenith: 0x0e1420, horizon: 0x2c3a4e, ground: 0x14181e, sunTint: 0xdfeaff, sunSize: 0.0, haze: 0.5 },
    sun: { color: 0xdcebff, intensity: 4.8, elevation: 68, azimuth: 95, shadowRadius: 2 },
    hemi: { sky: 0x7f93ad, ground: 0x2f343c, intensity: 1.2 },
    ambient: { color: 0x8fa0b8, intensity: 0.8 },
    fog: { color: 0x2b3542, density: 0.007 },
    practicals: { color: 0xcfe0ff, intensity: 60, distance: 38, flicker: 0 },
    grade: { lift: 0.055, gamma: 1.02, gain: 1.09, saturation: 0.84, vignette: 0.4 },
  }),

  /**
   * STUDIO -- flat, bright, artificial. Even key, almost no shadow, neutral
   * white. It should look LIT, not daylit: this is a room with a camera in it.
   */
  studio: merge({
    exposure: 1.0,
    sky: { zenith: 0x1a1c22, horizon: 0x2a2d35, ground: 0x1a1b1f, sunTint: 0xffffff, sunSize: 0.0, haze: 0.2 },
    sun: { color: 0xffffff, intensity: 2.0, elevation: 72, azimuth: 150, shadowRadius: 12 },
    hemi: { sky: 0xf2f5ff, ground: 0x9aa0ad, intensity: 1.7 },
    ambient: { color: 0xf6f8ff, intensity: 0.62 },
    fog: { color: 0x2b2e36, density: 0.004 },
    practicals: { color: 0xffffff, intensity: 26, distance: 30, flicker: 0 },
    grade: { lift: 0.035, gamma: 1.0, gain: 1.0, saturation: 0.92, vignette: 0.12 },
  }),

  /**
   * BALLROOM -- gold, soft, expensive. Chandelier warmth with a cool night
   * outside the windows, so the two temperatures meet in the middle of the room.
   */
  ballroom: merge({
    // Trimmed from 1.08; 0.82 still measured 0.887% blown.
    exposure: 0.66,
    sky: { zenith: 0x160f22, horizon: 0x2e2140, ground: 0x140e1c, sunTint: 0xffd9a0, sunSize: 0.0, haze: 0.45 },
    sun: { color: 0x9fb6ff, intensity: 1.1, elevation: 40, azimuth: 250, shadowRadius: 8 },
    hemi: { sky: 0x7e6c95, ground: 0x4a3628, intensity: 1.15 },
    ambient: { color: 0xf6e3c6, intensity: 0.85 },
    fog: { color: 0x40354c, density: 0.0068 },
    // The ballroom's remaining blown pixels were the chandeliers themselves, not
    // the room, so the trim belongs on the practicals rather than on exposure --
    // dropping exposure further would just make the room dark to fix a lamp.
    practicals: { color: 0xffd79a, intensity: 54, distance: 40, flicker: 0.02 },
    grade: { lift: 0.05, gamma: 1.0, gain: 1.05, saturation: 0.8, vignette: 0.36 },
  }),

  /**
   * TRAINING HALL -- utilitarian and unflattering. High cool fluorescents, flat
   * floor, nothing romantic. Slightly green because that is what strip lights do.
   */
  training_hall: merge({
    exposure: 1.0,
    sky: { zenith: 0x1e2220, horizon: 0x333b36, ground: 0x1c1f1d, sunTint: 0xeaf6ee, sunSize: 0.0, haze: 0.25 },
    sun: { color: 0xe8f4ec, intensity: 2.6, elevation: 80, azimuth: 120, shadowRadius: 7 },
    hemi: { sky: 0xd6e6dc, ground: 0x6b6a5c, intensity: 1.25 },
    ambient: { color: 0xdbe8de, intensity: 0.45 },
    fog: { color: 0x2c332e, density: 0.006 },
    practicals: { color: 0xdff0e4, intensity: 20, distance: 28, flicker: 0 },
    grade: { lift: 0.03, gamma: 1.02, gain: 1.03, saturation: 0.86, vignette: 0.2 },
  }),

  /**
   * CAFE -- soft daylight through glass. The gentlest profile: low contrast,
   * warm-but-not-orange, the light you would actually sit in for an hour.
   */
  cafe: merge({
    exposure: 1.05,
    sky: { zenith: 0x8fb0d8, horizon: 0xe4e2d8, ground: 0x8a8070, sunTint: 0xfff0d8, sunSize: 0.03, haze: 0.5 },
    sun: { color: 0xffeccf, intensity: 2.4, elevation: 34, azimuth: 165, shadowRadius: 8 },
    hemi: { sky: 0xcfe0f2, ground: 0x6e5c46, intensity: 1.15 },
    ambient: { color: 0xf0e2cc, intensity: 0.4 },
    fog: { color: 0x8f8a7e, density: 0.0075 },
    practicals: { color: 0xffd9a6, intensity: 14, distance: 24, flicker: 0 },
    grade: { lift: 0.04, gamma: 1.0, gain: 1.04, saturation: 0.92, vignette: 0.24 },
  }),

  /**
   * MARKET PLAZA -- open, mid-morning, the one unambiguously outdoor daylight
   * scene. This is the profile the old ward was reaching for and missing.
   */
  market_plaza: merge({
    // 0.52. Saffron Market is the brightest palette (backdrop L 0.72, highB
    // L 0.81) and this is the most open scene, so it is the one that clips
    // first with no tone-map roll-off. Earlier readings of "blown 0" for this
    // shot were a column-alignment bug in my own parsing, not a pass.
    exposure: 0.52,
    sky: { zenith: 0x4d86c6, horizon: 0xc8dcee, ground: 0x746255, sunTint: 0xfff4dc, sunSize: 0.045, haze: 0.42 },
    sun: { color: 0xfff1d2, intensity: 3.4, elevation: 42, azimuth: 128, shadowRadius: 4 },
    hemi: { sky: 0xa8c8ea, ground: 0x5c4d38, intensity: 1.05 },
    ambient: { color: 0x8ea2bd, intensity: 0.26 },
    fog: { color: 0xa9c0d6, density: 0.0055 },
    grade: { lift: 0.025, gamma: 1.02, gain: 0.97, saturation: 0.9, vignette: 0.26 },
  }),

  /**
   * ARENA -- overcast and cold, so the crowd reads as a mass rather than as
   * individuals and the floor is the brightest thing in frame.
   */
  arena: merge({
    // 0.58, not 0.95: with the accent banners and the bright Saffron backdrop
    // this scene measured 3.13% blown at the shared gain.
    exposure: 0.58,
    sky: { zenith: 0x6b7d92, horizon: 0xb9c6d2, ground: 0x6a6258, sunTint: 0xe8eef5, sunSize: 0.0, haze: 0.6 },
    sun: { color: 0xdfe8f2, intensity: 2.7, elevation: 60, azimuth: 140, shadowRadius: 10 },
    hemi: { sky: 0xb4c4d4, ground: 0x585044, intensity: 1.3 },
    ambient: { color: 0x93a1b0, intensity: 0.34 },
    fog: { color: 0x9dadbc, density: 0.0068 },
    grade: { lift: 0.03, gamma: 1.04, gain: 1.0, saturation: 0.84, vignette: 0.3 },
  }),
};

export const DEFAULT_LOOK = "market_plaza";

/** Never throw on an unknown archetype: a missing look must not blank a world. */
export function getLook(id) {
  return LOOKS[id] ?? LOOKS[DEFAULT_LOOK];
}

export const LOOK_IDS = Object.keys(LOOKS);
