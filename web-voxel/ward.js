/**
 * TALLOW WARD -- kept, as one archetype among several.
 *
 * The ward used to be the only world there was. It is now `market_plaza` in
 * scene/archetypes.js, and this file is the compatibility shim: same exports,
 * same geometry, same place names, so anything that imported it before still
 * works and `npm run voxel` opens on the ward by default.
 *
 * New code should use scene/generate.js and pick an archetype.
 */

import { ARCHETYPES } from "./scene/archetypes.js";
import { generateScene, clearPlaces } from "./scene/generate.js";
import { GROUND } from "./scene/primitives.js";

export { GROUND };
export const PLAZA_R = 19;

/** Canon's opaque location strings, as coordinates in the ward. */
export const WARD_PLACES = ARCHETYPES.market_plaza.places;

/** @param {import("./voxel/chunk.js").VoxelWorld} world */
export function generateWard(world, { seed = 1 } = {}) {
  generateScene(world, "market_plaza", { seed });
  clearPlaces(world, "market_plaza");
  return world;
}
