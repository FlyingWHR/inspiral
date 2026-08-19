/**
 * Chunked voxel storage. A flat Uint8Array per chunk, chunks in a Map keyed by
 * their coordinate. This is the actual world data structure -- geometry is
 * derived from it, never the other way round.
 */

import { AIR, isSolid } from "./blocks.js";

export const CHUNK = 32;
const VOL = CHUNK * CHUNK * CHUNK;

/** Floor-division that behaves for negatives, unlike (x / n | 0). */
const cdiv = (n) => Math.floor(n / CHUNK);
/** Positive modulo. */
const cmod = (n) => ((n % CHUNK) + CHUNK) % CHUNK;

export const chunkKey = (cx, cy, cz) => `${cx},${cy},${cz}`;

export class Chunk {
  constructor(cx, cy, cz) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.data = new Uint8Array(VOL);
    /** Set when the contents change; the mesher clears it. */
    this.dirty = true;
    /** Count of non-air voxels, so empty chunks can be skipped entirely. */
    this.count = 0;
  }

  static index(lx, ly, lz) {
    return lx + CHUNK * (ly + CHUNK * lz);
  }

  /** @returns {number} block id */
  getLocal(lx, ly, lz) {
    return /** @type {number} */ (this.data[Chunk.index(lx, ly, lz)]);
  }

  setLocal(lx, ly, lz, id) {
    const i = Chunk.index(lx, ly, lz);
    const prev = this.data[i];
    if (prev === id) return false;
    if (prev === AIR && id !== AIR) this.count++;
    else if (prev !== AIR && id === AIR) this.count--;
    this.data[i] = id;
    this.dirty = true;
    return true;
  }
}

export class VoxelWorld {
  constructor() {
    /** @type {Map<string, Chunk>} */
    this.chunks = new Map();
  }

  getChunk(cx, cy, cz, create = false) {
    const key = chunkKey(cx, cy, cz);
    let c = this.chunks.get(key);
    if (!c && create) {
      c = new Chunk(cx, cy, cz);
      this.chunks.set(key, c);
    }
    return c;
  }

  /**
   * World coords in, block id out. Missing chunks read as air.
   * @returns {number}
   */
  get(x, y, z) {
    const c = this.chunks.get(chunkKey(cdiv(x), cdiv(y), cdiv(z)));
    return c ? c.getLocal(cmod(x), cmod(y), cmod(z)) : AIR;
  }

  solid(x, y, z) {
    return isSolid(this.get(x, y, z));
  }

  /**
   * Write one voxel. Returns the chunks that now need remeshing -- the owning
   * chunk, plus any neighbour whose border face this voxel is visible across.
   * @returns {Chunk[]}
   */
  set(x, y, z, id) {
    const cx = cdiv(x), cy = cdiv(y), cz = cdiv(z);
    const chunk = this.getChunk(cx, cy, cz, true);
    if (!chunk.setLocal(cmod(x), cmod(y), cmod(z), id)) return [];

    const touched = [chunk];
    const lx = cmod(x), ly = cmod(y), lz = cmod(z);
    const nx = lx === 0 ? -1 : lx === CHUNK - 1 ? 1 : 0;
    const ny = ly === 0 ? -1 : ly === CHUNK - 1 ? 1 : 0;
    const nz = lz === 0 ? -1 : lz === CHUNK - 1 ? 1 : 0;
    for (const [dx, dy, dz] of [[nx, 0, 0], [0, ny, 0], [0, 0, nz]]) {
      if (!dx && !dy && !dz) continue;
      const n = this.getChunk(cx + dx, cy + dy, cz + dz, false);
      if (n && !touched.includes(n)) {
        n.dirty = true;
        touched.push(n);
      }
    }
    return touched;
  }

  /** Highest solid voxel at (x,z) at or below yMax, or null. */
  heightAt(x, z, yMax = 96) {
    for (let y = yMax; y >= -32; y--) if (this.solid(x, y, z)) return y;
    return null;
  }

  get chunkCount() {
    return this.chunks.size;
  }

  get voxelCount() {
    let n = 0;
    for (const c of this.chunks.values()) n += c.count;
    return n;
  }
}
