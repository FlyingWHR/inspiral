/**
 * Scene primitives: the handful of shapes every archetype is built from.
 *
 * These are the parts the ward generator already had -- terrain, an enclosure,
 * a building shell, a raised platform, scattered props -- pulled out so a scene
 * can be a data definition instead of a function. Nothing here knows what a
 * tavern is; archetypes.js does.
 */

import { BLOCK_IDS as B, AIR } from "../voxel/blocks.js";

export const GROUND = 12;

/** Deterministic PRNG. No Math.random anywhere: scenes must be repeatable. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value noise: smooth, seeded, good enough for gentle ground. */
export function makeNoise(seed) {
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

/**
 * Ground. `floorR` is the flat, walkable heart of the scene; beyond it the
 * land rolls. An indoor scene just has a bigger flat floor and a smaller world.
 */
export function terrain(world, opts) {
  const {
    seed = 1, radius = 40, floorR = 18,
    floor = B.cobble, surround = B.grass, sub = B.dirt, deep = B.stone,
    roll: rollAmount = 1,
  } = opts;
  const noise = makeNoise(seed);
  const damp = makeNoise(seed + 7717);

  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      const r = Math.hypot(x, z);
      const roll =
        ((noise(x / 26, z / 26) - 0.5) * 9 +
          (noise(x / 11, z / 11) - 0.5) * 3.4 +
          (noise(x / 4.5, z / 4.5) - 0.5) * 1.3) * rollAmount;
      const flatten = Math.min(1, Math.max(0, (r - floorR) / 14));
      const inside = r <= floorR;
      const top = inside ? GROUND : Math.round(GROUND + roll * flatten);

      let surface = floor;
      if (!inside) {
        const rise = top - GROUND;
        const wet = damp(x / 21, z / 21);
        surface = surround;
        if (rise <= -4 && wet > 0.62) surface = B.sand;
        else if (rise <= -3 && wet > 0.5) surface = B.dirt;
        else if (rise >= 4 && wet < 0.4) surface = B.stone;
        else if (wet < 0.22) surface = B.dirt;
      }
      for (let y = top; y > top - 4; y--) world.set(x, y, z, y === top ? surface : sub);
      for (let y = top - 4; y >= 0; y--) world.set(x, y, z, deep);
    }
  }
}

/** A ring wall with a gap on the -z axis, or four walls of a room. */
export function enclosure(world, opts) {
  const { kind = "ring", radius = 34, material = B.stone, height = 5,
          gate = 3, crenellate = true, w = 24, d = 18 } = opts;

  if (kind === "none") return;

  if (kind === "ring") {
    // Rasterise to a SET first: sampling angles hits each cell many times and
    // building straight from the loop makes every column stack on itself.
    const cells = new Map();
    for (let a = 0; a < 3600; a++) {
      const th = (a / 3600) * Math.PI * 2;
      const x = Math.round(Math.cos(th) * radius);
      const z = Math.round(Math.sin(th) * radius);
      if (z < 0 && Math.abs(x) <= gate) continue;
      cells.set(`${x},${z}`, [x, z]);
    }
    for (const [x, z] of cells.values()) {
      const base = (world.heightAt(x, z) ?? GROUND) + 1;
      for (let y = base; y < base + height; y++) world.set(x, y, z, material);
      if (crenellate && ((x + z) & 1) === 0) world.set(x, base + height, z, material);
    }
    return;
  }

  // kind === "room": four walls, a doorway on -z, and a flat roof.
  const x0 = -(w >> 1), x1 = w >> 1, z0 = -(d >> 1), z1 = d >> 1;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (!edge) continue;
      const doorway = z === z0 && Math.abs(x) <= gate;
      for (let y = GROUND + 1; y <= GROUND + height; y++) {
        if (doorway && y <= GROUND + 3) continue;
        world.set(x, y, z, material);
      }
    }
  }
  if (opts.roof !== false) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        world.set(x, GROUND + height + 1, z, opts.roofMaterial ?? material);
      }
    }
  }
}

/** A building shell with a doorway, windows and a pitched roof. */
export function building(world, { at: [cx, cz], w, d, h, wall, roof, door = "south" }) {
  const x0 = cx - (w >> 1), x1 = cx + (w >> 1);
  const z0 = cz - (d >> 1), z1 = cz + (d >> 1);

  let base = -Infinity;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) base = Math.max(base, world.heightAt(x, z) ?? GROUND);

  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      for (let y = base; y > base - 5; y--) world.set(x, y, z, y === base ? B.cobble : B.dirt);
      for (let y = base + 1; y < base + h + 6; y++) world.set(x, y, z, AIR);
    }
  }

  const floor = base + 1;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) world.set(x, floor - 1, z, B.plank);

  for (let y = floor; y < floor + h; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (x === x0 || x === x1 || z === z0 || z === z1) world.set(x, y, z, wall);
      }
    }
  }

  const wy = floor + 2;
  for (let x = x0 + 2; x <= x1 - 2; x += 3) {
    world.set(x, wy, z0, B.glass);
    world.set(x, wy, z1, B.glass);
  }
  for (let z = z0 + 2; z <= z1 - 2; z += 3) {
    world.set(x0, wy, z, B.glass);
    world.set(x1, wy, z, B.glass);
  }

  const dz = door === "south" ? z1 : z0;
  for (let y = floor; y < floor + 3; y++) {
    world.set(cx, y, dz, AIR);
    world.set(cx - 1, y, dz, AIR);
  }
  world.set(cx, floor + 3, dz, B.lantern);

  let rx0 = x0 - 1, rx1 = x1 + 1, rz0 = z0 - 1, rz1 = z1 + 1, y = floor + h;
  while (rx0 <= rx1 && rz0 <= rz1) {
    for (let x = rx0; x <= rx1; x++)
      for (let z = rz0; z <= rz1; z++)
        if (x === rx0 || x === rx1 || z === rz0 || z === rz1) world.set(x, y, z, roof);
    rx0++; rx1--; rz0++; rz1--; y++;
  }
}

/**
 * A raised slab: a dais, a stage, a mat, a ring. Walkable, one step up.
 *
 * `rim` puts CORNER POSTS on it, not a continuous edge. A continuous rim seals
 * the platform: you can step up onto it, but getting off is a two-block drop,
 * which is more than a stride, and the mat becomes a pen nobody can leave.
 */
export function platform(world, { at: [cx, cz], w, d, h = 1, material = B.plank, rim }) {
  const x0 = cx - (w >> 1), x1 = cx + (w >> 1);
  const z0 = cz - (d >> 1), z1 = cz + (d >> 1);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = GROUND + 1; y <= GROUND + h; y++) world.set(x, y, z, material);
    }
  }
  if (!rim) return;
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    for (let y = GROUND + h + 1; y <= GROUND + h + 2; y++) world.set(px, y, pz, rim);
  }
}

/** Concentric stepped seating around the middle. Spectators need somewhere. */
export function tiers(world, { inner = 14, rows = 4, material = B.stone, step = 1 }) {
  for (let row = 0; row < rows; row++) {
    const r = inner + row * 2;
    const h = GROUND + 1 + row * step;
    for (let a = 0; a < 2400; a++) {
      const th = (a / 2400) * Math.PI * 2;
      const x = Math.round(Math.cos(th) * r);
      const z = Math.round(Math.sin(th) * r);
      if (z < 0 && Math.abs(x) <= 3) continue; // keep the entrance clear
      for (let y = GROUND + 1; y <= h; y++) world.set(x, y, z, material);
    }
  }
}

/**
 * Small furniture: a counter, a table, a pillar, a lamp.
 *
 * `y` lifts the whole prop off the floor. Without it everything in a room has
 * to grow up from the floorboards, which means no ceiling beams, no shelf of
 * bottles, no sconce at head height -- and a room whose entire upper half is
 * blank plaster. That emptiness is most of why these interiors read as
 * unfinished rather than as low-poly.
 */
export function prop(world, { at: [x, z], kind, material = B.timber, h = 1, w = 1, d = 1, y: yOff = 0 }) {
  const base = GROUND + yOff;
  if (kind === "pillar") {
    for (let y = base + 1; y <= base + h; y++) world.set(x, y, z, material);
    return;
  }
  if (kind === "lamp") {
    for (let y = base + 1; y < base + h; y++) world.set(x, y, z, B.timber);
    world.set(x, base + h, z, B.lantern);
    return;
  }
  // "block": a counter, table or bench -- a slab of the given footprint.
  const x0 = x - (w >> 1), x1 = x + (w >> 1);
  const z0 = z - (d >> 1), z1 = z + (d >> 1);
  for (let xx = x0; xx <= x1; xx++)
    for (let zz = z0; zz <= z1; zz++)
      for (let y = base + 1; y <= base + h; y++) world.set(xx, y, zz, material);
}
