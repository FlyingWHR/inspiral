/**
 * TALLOW WARD, AS VOXELS.
 *
 * The set is generated into the grid from a layout definition rather than
 * placed as props, so every wall the player sees is real voxel data they can
 * dig through. Deterministic: same seed, same ward, so a demo can be rehearsed.
 *
 * Canon never learns any of this. It knows "kiln_row"; the coordinates live
 * here and nowhere above the surface seam.
 */

import { BLOCK_IDS as B, AIR } from "./voxel/blocks.js";

export const GROUND = 12; // base terrain height
export const PLAZA_R = 19;

/** Where canon's opaque location strings stand in the voxel world. */
export const WARD_PLACES = {
  // Standing spots on open plaza cobble, each in front of its building's door
  // -- not inside the shell, and not on top of the well in the middle.
  plaza: { x: 0, z: 9 },
  counting_house: { x: -13, z: -7 },
  kiln_row: { x: 13, z: -7 },
  almshouse: { x: 0, z: 15 },
  gate: { x: 0, z: -30 },
};

/** Three buildings. Each is a shell with a doorway facing the plaza. */
const BUILDINGS = [
  { at: [-22, -14], w: 11, d: 11, h: 7, wall: B.plaster, roof: B.roof, door: "south" },
  { at: [22, -14], w: 11, d: 11, h: 8, wall: B.brick, roof: B.roof, door: "south" },
  { at: [0, 24], w: 13, d: 11, h: 6, wall: B.plank, roof: B.roof, door: "north" },
];

/** Deterministic PRNG. No Math.random anywhere: the ward must be repeatable. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value noise: smooth, seeded, good enough for gentle ground. */
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Float32Array(256 * 256);
  for (let i = 0; i < perm.length; i++) perm[i] = rand();
  const at = (xi, zi) => perm[(((xi & 255) << 8) | (zi & 255)) >>> 0];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const tx = smooth(x - xi), tz = smooth(z - zi);
    const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

const dist = (x, z, cx, cz) => Math.hypot(x - cx, z - cz);

/**
 * Fill the world with the ward.
 * @param {import("./voxel/chunk.js").VoxelWorld} world
 */
export function generateWard(world, { seed = 1, radius = 44 } = {}) {
  const noise = makeNoise(seed);

  // --- terrain -------------------------------------------------------------
  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      const r = Math.hypot(x, z);
      // Gentle rolling ground, flattened to a level pad inside the plaza.
      const roll = (noise(x / 18, z / 18) - 0.5) * 6 + (noise(x / 7, z / 7) - 0.5) * 1.6;
      const flatten = Math.min(1, Math.max(0, (r - PLAZA_R) / 12));
      let top = Math.round(GROUND + roll * flatten);

      const inPlaza = r <= PLAZA_R;
      if (inPlaza) top = GROUND;

      for (let y = top; y > top - 4; y--) {
        world.set(x, y, z, y === top ? (inPlaza ? B.cobble : B.grass) : B.dirt);
      }
      for (let y = top - 4; y >= 0; y--) world.set(x, y, z, B.stone);
    }
  }

  // --- ward wall, with a gate on the plaza axis -----------------------------
  // Rasterise the circle to a SET of cells first. Sampling 3600 angles hits
  // each cell about fourteen times, and building straight from the loop made
  // every column measure its own height and stack another five blocks on top
  // of itself -- a seventy-block wall instead of a five-block one.
  const wallR = radius - 4;
  const wallCells = new Map();
  for (let a = 0; a < 3600; a++) {
    const th = (a / 3600) * Math.PI * 2;
    const x = Math.round(Math.cos(th) * wallR);
    const z = Math.round(Math.sin(th) * wallR);
    if (z < 0 && Math.abs(x) <= 3) continue; // gateway
    const k = `${x},${z}`;
    if (!wallCells.has(k)) wallCells.set(k, [x, z]);
  }
  for (const [x, z] of wallCells.values()) {
    const base = (world.heightAt(x, z) ?? GROUND) + 1;
    for (let y = base; y < base + 5; y++) world.set(x, y, z, B.stone);
    // Crenellations keyed off position, so they do not depend on visit order.
    if (((x + z) & 1) === 0) world.set(x, base + 5, z, B.stone);
  }

  // --- buildings ------------------------------------------------------------
  for (const b of BUILDINGS) building(world, b);

  // --- a well in the middle of the plaza, so the centre is not empty --------
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
      if (edge) {
        world.set(x, GROUND + 1, z, B.cobble);
        world.set(x, GROUND + 2, z, B.cobble);
      } else {
        world.set(x, GROUND, z, AIR);
        world.set(x, GROUND - 1, z, AIR);
      }
    }
  }
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let y = GROUND + 3; y <= GROUND + 5; y++) world.set(x, y, z, B.timber);
  }
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) world.set(x, GROUND + 6, z, B.plank);
  }

  return world;
}

/** One building: shell, floor, doorway, windows, pitched roof. */
function building(world, { at: [cx, cz], w, d, h, wall, roof, door }) {
  const x0 = cx - (w >> 1), x1 = cx + (w >> 1);
  const z0 = cz - (d >> 1), z1 = cz + (d >> 1);

  // Level the ground under it, so no building floats or half-buries itself.
  let base = -Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) base = Math.max(base, world.heightAt(x, z) ?? GROUND);
  }
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      for (let y = base; y > base - 5; y--) world.set(x, y, z, y === base ? B.cobble : B.dirt);
      for (let y = base + 1; y < base + h + 6; y++) world.set(x, y, z, AIR);
    }
  }

  const floor = base + 1;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) world.set(x, floor - 1, z, B.plank);
  }

  for (let y = floor; y < floor + h; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const onEdge = x === x0 || x === x1 || z === z0 || z === z1;
        if (onEdge) world.set(x, y, z, wall);
      }
    }
  }

  // Windows: a band of glass on every wall, skipping the corners.
  const wy = floor + 2;
  for (let x = x0 + 2; x <= x1 - 2; x += 3) {
    world.set(x, wy, z0, B.glass);
    world.set(x, wy, z1, B.glass);
  }
  for (let z = z0 + 2; z <= z1 - 2; z += 3) {
    world.set(x0, wy, z, B.glass);
    world.set(x1, wy, z, B.glass);
  }

  // Doorway on the side that faces the plaza.
  const dz = door === "south" ? z1 : z0;
  for (let y = floor; y < floor + 3; y++) {
    world.set(cx, y, dz, AIR);
    world.set(cx - 1, y, dz, AIR);
  }
  world.set(cx, floor + 3, dz, B.lantern);

  // Pitched roof: rings stepping inward and up.
  let rx0 = x0 - 1, rx1 = x1 + 1, rz0 = z0 - 1, rz1 = z1 + 1;
  let y = floor + h;
  while (rx0 <= rx1 && rz0 <= rz1) {
    for (let x = rx0; x <= rx1; x++) {
      for (let z = rz0; z <= rz1; z++) {
        if (x === rx0 || x === rx1 || z === rz0 || z === rz1) world.set(x, y, z, roof);
      }
    }
    rx0++; rx1--; rz0++; rz1--; y++;
  }
}
