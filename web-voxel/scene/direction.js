/**
 * FOUR ART DIRECTIONS, so the next visual decision is a choice rather than a
 * third guess.
 *
 * We have now guessed twice at what "attractive" means here and been wrong
 * twice. Rather than guess again, these are four coherent, named directions
 * rendered from the identical scene. Each one commits to a reference, and each
 * one changes shading, palette, atmosphere and focus together -- because that
 * is what art direction is, as opposed to turning a saturation slider.
 *
 *   npm run directions        # renders all four of the tavern, side by side
 *   ?dir=woodcut              # force one in the browser
 *
 * A direction is deliberately NOT a look profile. `looks.js` answers "what is
 * the light doing in this room"; this answers "what kind of picture are we
 * making at all". A direction applies on top of whichever look the archetype
 * chose, so picking one does not throw away the per-archetype identity.
 */

export const DIRECTIONS = {
  /**
   * HEARTH -- cosy low-poly, played straight.
   * Reference: A Short Hike, Lil Gator Game, the "cosy interior" corner of
   * low-poly. Soft, warm, believable light; no stylisation on the surface
   * itself. The safest of the four and the closest to what we have now, but
   * with air in the room and light that spills.
   */
  hearth: {
    label: "Hearth — cosy low-poly",
    reference: "A Short Hike, Lil Gator Game",
    shading: "standard",
    roughness: 0.92,
    bloom: { strength: 0.34, radius: 0.62, threshold: 0.9 },
    dust: { count: 900, opacity: 0.5 },
    shaft: { opacity: 0.05, width: 3.2 },
    dof: { focus: 12, aperture: 0.0009, maxblur: 0.0035 },
    rim: { color: 0x9fc4ff, intensity: 0.55 },
    grade: { saturation: 0.92, vignette: 0.4, lift: 0.05, gain: 1.06 },
  },

  /**
   * WOODCUT -- hard toon ramp, strong rim, near-monochrome with one warm accent.
   * Reference: Sable's ink lines, graphic-novel flatness.
   * The most obviously "designed" of the four. Three lighting steps, so every
   * surface is one of three tones and the silhouette does the work. Risky on
   * a voxel scene because cubes already have hard edges -- this either reads
   * as deliberate or as banding, and that is exactly what needs a human eye.
   */
  woodcut: {
    label: "Woodcut — hard toon, ink and one warm accent",
    reference: "Sable, graphic-novel flatness",
    shading: "toon",
    toonSteps: 3,
    bloom: { strength: 0.22, radius: 0.5, threshold: 0.92 },
    dust: { count: 420, opacity: 0.3 },
    shaft: { opacity: 0.035, width: 2.8 },
    dof: null,
    rim: { color: 0xbfd4ff, intensity: 1.15 },
    grade: { saturation: 0.62, vignette: 0.5, lift: 0.03, gain: 1.1 },
  },

  /**
   * LANTERN -- atmosphere first. Deep shadow, heavy air, the fire as the only
   * real light source and everything else falling away from it.
   * Reference: Teardown's volumetrics (see docs/research), candlelit interiors.
   * The most cinematic and the least legible: faces go dark, and a demo where
   * the judge cannot read a nameplate is a bad demo. Included because it is
   * the most beautiful of the four in a still, which is not the same thing.
   */
  lantern: {
    label: "Lantern — deep shadow, heavy air, firelight",
    reference: "Teardown volumetrics, candlelit interiors",
    shading: "standard",
    roughness: 0.96,
    bloom: { strength: 0.6, radius: 0.78, threshold: 0.84 },
    dust: { count: 1600, opacity: 0.72 },
    shaft: { opacity: 0.085, width: 3.6 },
    dof: { focus: 11, aperture: 0.0016, maxblur: 0.0055 },
    rim: { color: 0x7fa8ff, intensity: 0.75 },
    grade: { saturation: 0.86, vignette: 0.62, lift: 0.025, gain: 1.02 },
  },

  /**
   * GOUACHE -- flat colour, no specular, pastel, soft.
   * Reference: Monument Valley's flat planes and coloured shadow.
   * Lambert only, so surfaces have tone but no shine at all. The one direction
   * that stops the cubes pretending to be materials and lets them be shapes.
   * Reads as an illustration rather than a render, which suits a world made of
   * an IP's story more than a photoreal one does.
   */
  gouache: {
    label: "Gouache — flat colour, pastel, illustrative",
    reference: "Monument Valley",
    shading: "flat",
    bloom: { strength: 0.2, radius: 0.8, threshold: 0.93 },
    dust: { count: 300, opacity: 0.24 },
    shaft: { opacity: 0.055, width: 4.0 },
    dof: { focus: 13, aperture: 0.0007, maxblur: 0.003 },
    rim: { color: 0xffc9d6, intensity: 0.5 },
    grade: { saturation: 0.8, vignette: 0.26, lift: 0.09, gain: 1.0 },
  },
};

/** The one that ships unless someone chooses otherwise. */
export const DEFAULT_DIRECTION = "hearth";

export function getDirection(id) {
  return DIRECTIONS[id] ?? DIRECTIONS[DEFAULT_DIRECTION];
}

export const DIRECTION_IDS = Object.keys(DIRECTIONS);
