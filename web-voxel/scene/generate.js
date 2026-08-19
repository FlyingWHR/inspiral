/**
 * Build a scene from an archetype definition.
 *
 * One dispatch table over the primitives. Adding an archetype is data; adding a
 * new KIND of shape is one case here. Deterministic: same archetype, same seed,
 * same world, so a demo can be rehearsed.
 */

import { BLOCK_IDS as B, AIR } from "../voxel/blocks.js";
import { getArchetype, DEFAULT_ARCHETYPE } from "./archetypes.js";
import {
  GROUND, terrain, enclosure, building, platform, tiers, prop, makeNoise,
} from "./primitives.js";

/** A worn track between two points, because everyone walks it. */
function path(world, { from, to, material = B.cobble, seed = 1 }) {
  const noise = makeNoise(seed + 41);
  const [x0, z0] = from, [x1, z1] = to;
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cz = Math.round(z0 + (z1 - z0) * t);
    const wobble = Math.round((noise(i / 9, 41) - 0.5) * 4);
    for (let d = -2; d <= 2; d++) {
      const x = cx + wobble + d;
      const y = world.heightAt(x, cz);
      if (y !== null) world.set(x, y, cz, Math.abs(d) === 2 ? B.dirt : material);
    }
  }
}

/** A small well: a rim, four posts and a roof. Not a shed. */
function well(world, { at: [cx, cz] }) {
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let z = cz - 1; z <= cz + 1; z++) {
      const rim = Math.abs(x - cx) === 1 || Math.abs(z - cz) === 1;
      if (rim) world.set(x, GROUND + 1, z, B.cobble);
      else for (let y = GROUND; y > GROUND - 4; y--) world.set(x, y, z, AIR);
    }
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    world.set(cx + dx, GROUND + 2, cz + dz, B.timber);
    world.set(cx + dx, GROUND + 3, cz + dz, B.timber);
  }
  for (let x = cx - 1; x <= cx + 1; x++)
    for (let z = cz - 1; z <= cz + 1; z++) world.set(x, GROUND + 4, z, B.plank);
  world.set(cx, GROUND + 3, cz, B.lantern);
}

const OPS = { terrain, enclosure, building, platform, tiers, prop, path, well };

/**
 * @param {import("../voxel/chunk.js").VoxelWorld} world
 * @param {string} archetypeId
 */
export function generateScene(world, archetypeId = DEFAULT_ARCHETYPE, { seed = 1 } = {}) {
  const arch = getArchetype(archetypeId);
  for (const step of arch.build) {
    const fn = OPS[step.op];
    if (!fn) continue; // an unknown op is a typo in data, not a crash
    fn(world, { seed, ...step });
  }
  return world;
}

/**
 * Make sure every named place can actually be stood on.
 *
 * Props get placed by hand and a table dropped on a doorway is exactly the kind
 * of mistake that only shows up when an NPC spawns inside it. This clears the
 * two voxels above each place and gives it a floor, so a bad coordinate costs a
 * scuffed table rather than a character embedded in furniture.
 */
export function clearPlaces(world, archetypeId = DEFAULT_ARCHETYPE) {
  const arch = getArchetype(archetypeId);
  for (const p of Object.values(arch.places)) {
    const y = world.heightAt(p.x, p.z) ?? GROUND;
    // stand on whatever the top surface is, with headroom above it
    world.set(p.x, y + 1, p.z, AIR);
    world.set(p.x, y + 2, p.z, AIR);
    if (!world.solid(p.x, y, p.z)) world.set(p.x, y, p.z, B.plank);
  }
  return world;
}

export { GROUND };
