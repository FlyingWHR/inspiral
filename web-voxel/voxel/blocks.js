/**
 * Block registry. Ids are bytes: 0 is air, everything else is solid unless
 * flagged otherwise. Colour is per-block and lands in the mesh as a vertex
 * attribute -- no texture atlas, no UV bookkeeping, and it matches the flat
 * kit-bashed look the ward already has.
 */

export const AIR = 0;

/** @type {{name:string,color:number,solid:boolean}[]} indexed by block id */
export const BLOCKS = [
  { name: "air", color: 0x000000, solid: false },
  { name: "grass", color: 0x74994b, solid: true },
  { name: "dirt", color: 0x7a5c3c, solid: true },
  { name: "stone", color: 0x8e8a80, solid: true },
  { name: "cobble", color: 0x7d7568, solid: true },
  { name: "plaster", color: 0xd8c9a8, solid: true },
  { name: "timber", color: 0x6d4a2f, solid: true },
  { name: "roof", color: 0x5a5ea8, solid: true },
  { name: "sand", color: 0xc4b184, solid: true },
  { name: "plank", color: 0xb08152, solid: true },
  { name: "brick", color: 0xa4614a, solid: true },
  { name: "glass", color: 0x9fd0e0, solid: true },
  { name: "lantern", color: 0xffd98a, solid: true },
];

export const BLOCK_IDS = Object.fromEntries(BLOCKS.map((b, i) => [b.name, i]));

/** The block names in table order, so the palette can build a parallel array. */
export const BLOCK_NAMES = BLOCKS.map((b) => b.name);

/**
 * Re-skin the block table from a palette.
 *
 * The colours above are the ORIGINALS and they are kept only as a fallback for
 * a caller that never sets a palette. They were measured as the source of the
 * hue collapse -- nine of twelve between hue 40 and 89, nothing above chroma
 * 0.1158 -- so nothing should be rendering them any more.
 *
 * `null` entries are left alone, which is how `air` keeps its place.
 */
export function setBlockColors(colors) {
  for (let i = 0; i < BLOCKS.length && i < colors.length; i++) {
    if (colors[i] !== null && colors[i] !== undefined) BLOCKS[i].color = colors[i];
  }
}

export const isSolid = (id) => id !== AIR && (BLOCKS[id]?.solid ?? false);
export const colorOf = (id) => BLOCKS[id]?.color ?? 0xff00ff;
export const nameOf = (id) => BLOCKS[id]?.name ?? "unknown";
