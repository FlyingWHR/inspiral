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
 *
 * Two cheap tricks carry most of the look, and neither costs a texture:
 *  - Faces are shaded by which way they point. A lit top, mid-tone sides and a
 *    dark underside is what stops a voxel world reading as flat coloured soup.
 *  - Each merged quad gets a small deterministic tint offset, so a long wall is
 *    a run of slightly different panels instead of one poster-paint rectangle.
 */

/** Directional shading: +Y, -Y, +X/-X, +Z/-Z. */
/**
 * The face ramp, widened deliberately.
 *
 * The palette guarantees the MATERIALS span 0.61 of OKLab L. It only guarantees
 * the FRAME does if the darkest and lightest tiers actually appear, and the
 * study is explicit that VOID has to show up -- under eaves, in doorways, in
 * the gaps between blocks. The old ramp bottomed out at 0.5, which lifts a MID
 * wall to roughly L 0.34: nowhere near VOID at 0.19.
 *
 * At 0.30 a downward face of a MID block lands around L 0.19, which is the VOID
 * tier arriving for free on every overhang in the world. Top faces stay at 1.0
 * so lit planes reach HIGH.
 */
const FACE_LIGHT = { px: 0.85, nx: 0.62, py: 0.93, ny: 0.3, pz: 0.78, nz: 0.54 };
// py is 0.93, not 1.0. With NoToneMapping there is no highlight roll-off, so a
// top face at full multiplier under a light gain above 1 simply clips: the
// voxel aerial, which is mostly sunlit top faces, measured 3-4.8% blown against
// a 0.5% floor at both framings tried. Trimming the top of the ramp costs a
// little HIGH and buys back the headroom that tone mapping used to provide.

/** Stable per-quad jitter in [-1,1] from its position, so it never shimmers. */
function jitter(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

import { CHUNK } from "./chunk.js";
import { colorOf, isSolid } from "./blocks.js";

/** sRGB transfer function; matches three's SRGBToLinear. */
const srgbToLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : ((c + 0.055) / 1.055) ** 2.4);

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
          // A chunk owns the faces of ITS OWN voxels and no others. Without
          // this, the two chunks either side of a border both emit the face
          // between them and the pair z-fights -- which reads as vertical
          // striping across every chunk seam.
          const aInside = x[d] >= 0;
          const bInside = x[d] < DIMS[d] - 1;
          if (sa === sb) mask[n] = 0;
          else if (sa) mask[n] = aInside ? a : 0;
          else mask[n] = bInside ? -b : 0;
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
          const axis = d === 0 ? "x" : d === 1 ? "y" : "z";
          const shade = FACE_LIGHT[(flip ? "n" : "p") + axis];
          // ±5% per quad. Enough to break up a flat wall, not enough to read
          // as noise.
          const tint = shade * (1 + jitter(p0[0], p0[1], p0[2]) * 0.05);
          /**
           * CONVERT TO LINEAR before writing the vertex colour.
           *
           * three reads the `color` attribute as already being in the linear
           * working space, so putting an sRGB byte straight in skips the
           * transfer function: 0x77 enters as linear 0.467 and leaves the
           * display transform at roughly sRGB 0.71. Everything renders lighter
           * and, because the curve compresses the gaps between channels,
           * measurably less saturated.
           *
           * This is the sibling of the trap the colour study warns about. It
           * warns against converting TWICE; this path converted zero times, and
           * it was halving the palette's chroma before a single post pass ran.
           * The tell was mean chroma 0.025 against an authored architectural
           * mean near 0.05 with every effect disabled.
           *
           * Face shading multiplies in linear space, which is where it belongs.
           */
          const r = srgbToLinear(((hex >> 16) & 255) / 255) * tint;
          const g = srgbToLinear(((hex >> 8) & 255) / 255) * tint;
          const bl = srgbToLinear((hex & 255) / 255) * tint;
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
