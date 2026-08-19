/**
 * Amanatides & Woo voxel traversal. Walks the grid cell by cell instead of
 * stepping a fixed distance, so it can never tunnel through a block and never
 * does redundant work inside one.
 *
 * Returns the block hit, the voxel it occupies, and the face normal -- which is
 * what "place a block against this face" needs.
 */

import { isSolid } from "./blocks.js";

/**
 * @param {(x:number,y:number,z:number)=>number} get
 * @returns {{block:number,voxel:number[],normal:number[],distance:number}|null}
 */
export function raycast(get, origin, direction, maxDistance = 8) {
  let [px, py, pz] = origin;
  const [dx, dy, dz] = direction;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  const nx = dx / len, ny = dy / len, nz = dz / len;

  let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  const stepX = Math.sign(nx), stepY = Math.sign(ny), stepZ = Math.sign(nz);

  // Distance along the ray to the next grid plane on each axis.
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / nx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / ny);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / nz);

  const boundary = (p, i, step) => (step > 0 ? i + 1 - p : p - i);
  let tMaxX = stepX === 0 ? Infinity : boundary(px, x, stepX) * tDeltaX;
  let tMaxY = stepY === 0 ? Infinity : boundary(py, y, stepY) * tDeltaY;
  let tMaxZ = stepZ === 0 ? Infinity : boundary(pz, z, stepZ) * tDeltaZ;

  let normal = [0, 0, 0];
  let t = 0;

  // The origin voxel counts: you can be standing inside what you are aiming at.
  if (isSolid(get(x, y, z))) {
    return { block: get(x, y, z), voxel: [x, y, z], normal, distance: 0 };
  }

  while (t <= maxDistance) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; normal = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal = [0, 0, -stepZ];
    }
    if (t > maxDistance) break;
    const b = get(x, y, z);
    if (isSolid(b)) return { block: b, voxel: [x, y, z], normal, distance: t };
  }
  return null;
}
