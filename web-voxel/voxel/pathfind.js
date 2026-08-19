/**
 * A* over walkable voxel surface cells.
 *
 * A cell is standable when its own space and the one above are clear and the
 * voxel beneath is solid. Moves are the 8 compass directions with a step up or
 * down of one, which is what lets an NPC climb the plaza steps -- and what makes
 * them walk around a wall the player just built instead of through it.
 *
 * Deliberately capped: a bounded node budget and a bounded search radius, so a
 * player who walls someone in costs one cheap failed search, not a frame spike.
 */

import { isSolid } from "./blocks.js";

const STEP = 1; // how far up or down a single stride may go

/** Can a body stand with its feet in this cell? */
export function standable(world, x, y, z) {
  return (
    isSolid(world.get(x, y - 1, z)) &&
    !isSolid(world.get(x, y, z)) &&
    !isSolid(world.get(x, y + 1, z))
  );
}

/** Nearest standable y at this column, searching around a hint. */
export function groundAt(world, x, z, hintY, spread = 6) {
  for (let d = 0; d <= spread; d++) {
    if (standable(world, x, hintY + d, z)) return hintY + d;
    if (standable(world, x, hintY - d, z)) return hintY - d;
  }
  return null;
}

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * @param {import("./chunk.js").VoxelWorld} world
 * @param {number[]} from [x,y,z] feet position
 * @param {number[]} to   [x,z] destination column
 * @returns {number[][]|null} list of [x,y,z] cells, excluding the start
 */
export function findPath(world, from, to, maxNodes = 900) {
  const [sx, sy, sz] = from.map(Math.floor);
  const [tx, tz] = to.map(Math.floor);

  const startY = groundAt(world, sx, sz, sy) ?? sy;
  const goalY = groundAt(world, tx, tz, startY, 10);
  if (goalY === null) return null;

  const goal = key(tx, goalY, tz);
  const start = key(sx, startY, sz);
  if (start === goal) return [];

  const h = (x, y, z) => Math.hypot(x - tx, z - tz) + Math.abs(y - goalY) * 0.5;

  const open = [{ x: sx, y: startY, z: sz, g: 0, f: h(sx, startY, sz) }];
  const cameFrom = new Map();
  const gScore = new Map([[start, 0]]);
  const seen = new Set();
  let nodes = 0;

  while (open.length && nodes++ < maxNodes) {
    // Small frontier; a linear scan beats a heap here and is a tenth the code.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y, cur.z);
    if (ck === goal) return rebuild(cameFrom, ck);
    if (seen.has(ck)) continue;
    seen.add(ck);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cur.x + dx, nz = cur.z + dz;
        const ny = groundAt(world, nx, nz, cur.y, STEP);
        if (ny === null) continue;

        // No cutting diagonally through a corner gap.
        if (dx && dz) {
          if (groundAt(world, cur.x + dx, cur.z, cur.y, STEP) === null) continue;
          if (groundAt(world, cur.x, cur.z + dz, cur.y, STEP) === null) continue;
        }

        const nk = key(nx, ny, nz);
        if (seen.has(nk)) continue;
        const cost = (dx && dz ? 1.414 : 1) + Math.abs(ny - cur.y) * 0.6;
        const g = cur.g + cost;
        if (g >= (gScore.get(nk) ?? Infinity)) continue;
        gScore.set(nk, g);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz) });
      }
    }
  }
  return null; // walled in, too far, or out of budget
}

function rebuild(cameFrom, at) {
  const out = [];
  let cur = at;
  while (cur) {
    const [x, y, z] = cur.split(",").map(Number);
    out.push([x, y, z]);
    cur = cameFrom.get(cur);
  }
  out.reverse();
  out.shift(); // the start cell is where we already are
  return out;
}
