/**
 * Turns dirty chunks into three.js meshes. Remeshing is spread across frames so
 * a 52-chunk ward does not block the first paint, and an edit only ever costs
 * the chunks it actually touched.
 */
import * as THREE from "three";
import { CHUNK } from "./voxel/chunk.js";
import { meshChunk } from "./voxel/mesher.js";

export class ChunkMesher {
  constructor(world, scene, material) {
    this.world = world;
    this.scene = scene;
    this.material = material;
    /** @type {Map<string, THREE.Mesh>} */
    this.meshes = new Map();
    this.queue = [];
  }

  /** Queue every chunk that currently needs geometry. */
  queueDirty() {
    for (const [key, c] of this.world.chunks) {
      if (c.dirty && !this.queue.includes(key)) this.queue.push(key);
    }
    // Nearest-first would be nicer; ward-sized worlds do not need it.
    return this.queue.length;
  }

  queueChunks(chunks) {
    for (const c of chunks) {
      const key = `${c.cx},${c.cy},${c.cz}`;
      if (!this.queue.includes(key)) this.queue.unshift(key); // edits jump the line
    }
  }

  /** Build up to `budget` chunks. Returns how many remain. */
  update(budget = 2) {
    for (let i = 0; i < budget && this.queue.length; i++) {
      this.build(this.queue.shift());
    }
    return this.queue.length;
  }

  build(key) {
    const c = this.world.chunks.get(key);
    if (!c) return;
    c.dirty = false;

    const old = this.meshes.get(key);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      this.meshes.delete(key);
    }
    if (c.count === 0) return;

    const sample = (x, y, z) => this.world.get(x, y, z);
    const g = meshChunk(sample, c.cx * CHUNK, c.cy * CHUNK, c.cz * CHUNK);
    if (g.quads === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  get triangleCount() {
    let n = 0;
    for (const m of this.meshes.values()) n += m.geometry.index.count / 3;
    return n;
  }
}
