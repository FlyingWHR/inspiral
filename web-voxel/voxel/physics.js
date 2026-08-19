/**
 * An axis-aligned body against the voxel grid.
 *
 * Movement is resolved one axis at a time: try the move, and if the body now
 * overlaps a solid voxel, snap it flush against that voxel and kill the
 * velocity on that axis only. Doing the axes separately is what lets you slide
 * along a wall instead of sticking to it, and it cannot tunnel as long as a
 * step is smaller than a voxel -- which `step()` enforces by substepping.
 */

const EPS = 1e-4;

export class Body {
  /** @param {number[]} size [width, height, depth] in voxels */
  constructor(position, size = [0.6, 1.8, 0.6]) {
    this.position = [...position]; // feet centre
    this.size = size;
    this.velocity = [0, 0, 0];
    this.onGround = false;
  }

  get aabb() {
    const [w, h, d] = this.size;
    const [x, y, z] = this.position;
    return {
      min: [x - w / 2, y, z - d / 2],
      max: [x + w / 2, y + h, z + d / 2],
    };
  }
}

/** Does the body's box overlap any solid voxel? */
export function overlaps(solid, body) {
  const { min, max } = body.aabb;
  for (let x = Math.floor(min[0]); x <= Math.floor(max[0] - EPS); x++) {
    for (let y = Math.floor(min[1]); y <= Math.floor(max[1] - EPS); y++) {
      for (let z = Math.floor(min[2]); z <= Math.floor(max[2] - EPS); z++) {
        if (solid(x, y, z)) return true;
      }
    }
  }
  return false;
}

/** Move on one axis and resolve. Returns true if it collided. */
function moveAxis(solid, body, axis, amount) {
  if (amount === 0) return false;
  body.position[axis] += amount;
  if (!overlaps(solid, body)) return false;

  // Back out to the last free position, flush against the blocking voxel.
  const dir = Math.sign(amount);
  const { min, max } = body.aabb;
  if (dir > 0) {
    const edge = axis === 1 ? max[1] : max[axis];
    body.position[axis] -= edge - Math.floor(edge) + EPS;
  } else {
    const edge = min[axis];
    body.position[axis] += Math.ceil(edge) - edge + EPS;
  }
  body.velocity[axis] = 0;
  return true;
}

/**
 * Advance a body. Gravity is applied here; `solid(x,y,z)` is the only thing
 * this needs to know about the world.
 */
export function step(solid, body, dt, gravity = -28) {
  body.velocity[1] += gravity * dt;

  // Never move more than half a voxel per substep, or a fast fall tunnels.
  const dist = Math.max(
    Math.abs(body.velocity[0]),
    Math.abs(body.velocity[1]),
    Math.abs(body.velocity[2]),
  ) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.45));
  const h = dt / steps;

  body.onGround = false;
  for (let i = 0; i < steps; i++) {
    moveAxis(solid, body, 0, body.velocity[0] * h);
    moveAxis(solid, body, 2, body.velocity[2] * h);
    const hitY = moveAxis(solid, body, 1, body.velocity[1] * h);
    if (hitY && body.velocity[1] <= 0) body.onGround = true;
  }
  return body;
}
