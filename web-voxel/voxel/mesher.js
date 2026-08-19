/**
 * GREEDY MESHING.
 *
 * The naive approach emits two triangles per visible voxel face; a 32^3 chunk
 * of solid stone would be ~12k triangles of which all but the shell is wasted,
 * and even the shell is thousands of coplanar quads. Greedy meshing sweeps each
 * of the three axes, builds a mask of visible faces on every slice, and merges
 * runs of identical faces into the largest rectangles it can -- a flat wall
 * becomes one quad instead of hundreds.
 *
 * Faces merge only when block id AND facing match, so colours stay correct.
 * Ambient occlusion is deliberately NOT baked per-vertex here: it would have to
 * enter the merge key and would shatter every large quad. The renderer gets its
 * AO from the screen-space GTAO pass instead, which costs nothing per-vertex.
 */

import { CHUNK } from "./chunk.js";
import { colorOf, isSolid } from "./blocks.js";

const DIMS = [CHUNK, CHUNK, CHUNK];

/**
 * Build geometry arrays for one chunk.
 *
 * @param {(x:number,y:number,z:number)=>number} sample world-coord block lookup
 * @param {number} ox chunk origin in world coords
 * @returns {{positions:Float32Array,normals:Float32Array,colors:Float32Array,indices:Uint32Array,quads:number}}
 */
export function meshChunk(sample, ox, oy, oz) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let quads = 0;

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;

    const mask = new Int32Array(DIMS[u] * DIMS[v]);

    // Slices run from -1 so the face between this chunk and its neighbour on
    // the low side is considered too.
    for (x[d] = -1; x[d] < DIMS[d]; ) {
      let n = 0;
      for (x[v] = 0; x[v] < DIMS[v]; x[v]++) {
        for (x[u] = 0; x[u] < DIMS[u]; x[u]++, n++) {
          const a = sample(ox + x[0], oy + x[1], oz + x[2]);
          const b = sample(ox + x[0] + q[0], oy + x[1] + q[1], oz + x[2] + q[2]);
          const sa = isSolid(a);
          const sb = isSolid(b);
          // Positive id: face points +d. Negative: face points -d.
          mask[n] = sa === sb ? 0 : sa ? a : -b;
        }
      }

      x[d]++;
      n = 0;

      for (let j = 0; j < DIMS[v]; j++) {
        for (let i = 0; i < DIMS[u]; ) {
          const c = mask[n];
          if (c === 0) {
            i++;
            n++;
            continue;
          }

          // Grow width along u, then height along v, while the face is identical.
          let w = 1;
          while (i + w < DIMS[u] && mask[n + w] === c) w++;

          let h = 1;
          grow: while (j + h < DIMS[v]) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * DIMS[u]] !== c) break grow;
            }
            h++;
          }

          x[u] = i;
          x[v] = j;
          const du = [0, 0, 0];
          const dv = [0, 0, 0];
          du[u] = w;
          dv[v] = h;

          const flip = c < 0;
          const id = flip ? -c : c;
          const base = positions.length / 3;

          // Four corners of the merged rectangle, in world coords.
          const p0 = [ox + x[0], oy + x[1], oz + x[2]];
          const p1 = [p0[0] + du[0], p0[1] + du[1], p0[2] + du[2]];
          const p2 = [p0[0] + du[0] + dv[0], p0[1] + du[1] + dv[1], p0[2] + du[2] + dv[2]];
          const p3 = [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]];
          positions.push(...p0, ...p1, ...p2, ...p3);

          const nrm = [0, 0, 0];
          nrm[d] = flip ? -1 : 1;
          for (let k = 0; k < 4; k++) normals.push(...nrm);

          const hex = colorOf(id);
          const r = ((hex >> 16) & 255) / 255;
          const g = ((hex >> 8) & 255) / 255;
          const bl = (hex & 255) / 255;
          for (let k = 0; k < 4; k++) colors.push(r, g, bl);

          if (flip) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
          else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          quads++;

          // Zero the consumed region so it is not emitted twice.
          for (let l = 0; l < h; l++) {
            for (let k = 0; k < w; k++) mask[n + k + l * DIMS[u]] = 0;
          }

          i += w;
          n += w;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    quads,
  };
}
