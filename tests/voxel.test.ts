import { describe, expect, it } from "vitest";
// Pure voxel maths: no three.js, no engine, no DOM. The suite must stay
// runnable with nothing installed but the test runner.
import { VoxelWorld, CHUNK } from "../web-voxel/voxel/chunk.js";
import { meshChunk } from "../web-voxel/voxel/mesher.js";
import { raycast } from "../web-voxel/voxel/raycast.js";
import { Body, step, overlaps } from "../web-voxel/voxel/physics.js";
import { BLOCK_IDS, isSolid, AIR } from "../web-voxel/voxel/blocks.js";

const sampler = (w: VoxelWorld) => (x: number, y: number, z: number) => w.get(x, y, z);
const solidFn = (w: VoxelWorld) => (x: number, y: number, z: number) => w.solid(x, y, z);

describe("voxel storage", () => {
  it("stores and reads across chunk boundaries and negative coordinates", () => {
    const w = new VoxelWorld();
    w.set(0, 0, 0, 1);
    w.set(-1, -1, -1, 2);
    w.set(CHUNK + 3, 5, CHUNK + 3, 3);

    expect(w.get(0, 0, 0)).toBe(1);
    expect(w.get(-1, -1, -1)).toBe(2);
    expect(w.get(CHUNK + 3, 5, CHUNK + 3)).toBe(3);
    expect(w.chunkCount).toBe(3);
    expect(w.voxelCount).toBe(3);
  });

  it("reads unset space as air", () => {
    const w = new VoxelWorld();
    expect(w.get(9, 9, 9)).toBe(AIR);
    expect(w.solid(9, 9, 9)).toBe(false);
  });

  it("keeps the non-air count right when blocks are removed", () => {
    const w = new VoxelWorld();
    w.set(2, 2, 2, 1);
    w.set(2, 3, 2, 1);
    expect(w.voxelCount).toBe(2);
    w.set(2, 3, 2, AIR);
    expect(w.voxelCount).toBe(1);
  });

  it("marks the neighbouring chunk dirty when a border voxel changes", () => {
    const w = new VoxelWorld();
    w.getChunk(-1, 0, 0, true); // neighbour must exist to be notified
    const touched = w.set(0, 4, 4, 1); // x=0 is the low border of chunk 0
    expect(touched.length).toBe(2);
    expect(touched.some((c: { cx: number }) => c.cx === -1)).toBe(true);
  });

  it("finds the surface height", () => {
    const w = new VoxelWorld();
    w.set(4, 0, 4, 1);
    w.set(4, 7, 4, 1);
    expect(w.heightAt(4, 4)).toBe(7);
    expect(w.heightAt(5, 5)).toBeNull();
  });
});

describe("greedy meshing", () => {
  it("emits six quads for one voxel", () => {
    const w = new VoxelWorld();
    w.set(5, 5, 5, BLOCK_IDS.stone);
    const m = meshChunk(sampler(w), 0, 0, 0);
    expect(m.quads).toBe(6);
    expect(m.indices.length / 3).toBe(12); // two triangles per quad
  });

  it("merges a 2x2x2 cube into six quads, not twenty-four", () => {
    const w = new VoxelWorld();
    for (let x = 4; x < 6; x++)
      for (let y = 4; y < 6; y++)
        for (let z = 4; z < 6; z++) w.set(x, y, z, BLOCK_IDS.stone);
    expect(meshChunk(sampler(w), 0, 0, 0).quads).toBe(6);
  });

  it("merges a flat 16x16 slab into six quads", () => {
    const w = new VoxelWorld();
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) w.set(x, 3, z, BLOCK_IDS.grass);
    expect(meshChunk(sampler(w), 0, 0, 0).quads).toBe(6);
  });

  it("emits nothing for a chunk with no exposed faces", () => {
    const w = new VoxelWorld();
    for (let x = -1; x <= CHUNK; x++)
      for (let y = -1; y <= CHUNK; y++)
        for (let z = -1; z <= CHUNK; z++) w.set(x, y, z, BLOCK_IDS.stone);
    expect(meshChunk(sampler(w), 0, 0, 0).quads).toBe(0);
  });

  it("does not merge across different block types", () => {
    const w = new VoxelWorld();
    for (let x = 0; x < 4; x++) w.set(x, 2, 0, x < 2 ? BLOCK_IDS.stone : BLOCK_IDS.timber);
    const m = meshChunk(sampler(w), 0, 0, 0);
    // top and bottom split in two by colour; the ends and sides stay whole
    expect(m.quads).toBeGreaterThan(6);
  });

  it("emits each boundary face exactly once, so chunk seams do not z-fight", () => {
    const w = new VoxelWorld();
    w.set(-1, 4, 4, BLOCK_IDS.stone); // sits on the seam between chunk -1 and 0
    const s = sampler(w);
    const owner = meshChunk(s, -CHUNK, 0, 0);
    const neighbour = meshChunk(s, 0, 0, 0);

    expect(owner.quads).toBe(6);       // the chunk that contains it draws it
    expect(neighbour.quads).toBe(0);   // the one next door draws nothing
    expect(owner.quads + neighbour.quads).toBe(6); // 7 would be a double-draw
  });

  it("produces all six axis normals for an isolated voxel", () => {
    const w = new VoxelWorld();
    w.set(1, 1, 1, BLOCK_IDS.stone);
    const m = meshChunk(sampler(w), 0, 0, 0);
    const seen = new Set<string>();
    for (let i = 0; i < m.normals.length; i += 3) {
      seen.add(`${m.normals[i]},${m.normals[i + 1]},${m.normals[i + 2]}`);
    }
    expect(seen.size).toBe(6);
  });
});

describe("raycasting the grid", () => {
  it("hits the first solid voxel and reports the face it entered through", () => {
    const w = new VoxelWorld();
    w.set(3, 1, 0, BLOCK_IDS.stone);
    const hit = raycast(sampler(w), [0.5, 1.5, 0.5], [1, 0, 0], 10);
    expect(hit).not.toBeNull();
    expect(hit!.voxel).toEqual([3, 1, 0]);
    expect(hit!.normal).toEqual([-1, 0, 0]); // entered through the -x face
    expect(hit!.distance).toBeCloseTo(2.5, 5);
  });

  it("returns null when nothing is in range", () => {
    const w = new VoxelWorld();
    w.set(0, 0, 0, BLOCK_IDS.stone);
    expect(raycast(sampler(w), [0.5, 8.5, 0.5], [0, 1, 0], 10)).toBeNull();
  });

  it("respects max distance", () => {
    const w = new VoxelWorld();
    w.set(9, 0, 0, BLOCK_IDS.stone);
    expect(raycast(sampler(w), [0.5, 0.5, 0.5], [1, 0, 0], 4)).toBeNull();
    expect(raycast(sampler(w), [0.5, 0.5, 0.5], [1, 0, 0], 20)).not.toBeNull();
  });
});

describe("bodies against the grid", () => {
  const floored = () => {
    const w = new VoxelWorld();
    for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) w.set(x, 0, z, BLOCK_IDS.grass);
    return w;
  };

  it("falls and lands flush on the floor", () => {
    const w = floored();
    const b = new Body([0.5, 6, 0.5]);
    for (let i = 0; i < 180; i++) step(solidFn(w), b, 1 / 60);
    expect(b.position[1]).toBeCloseTo(1, 2);
    expect(b.onGround).toBe(true);
    expect(overlaps(solidFn(w), b)).toBe(false);
  });

  it("stops against a wall instead of passing through it", () => {
    const w = floored();
    w.set(3, 1, 0, BLOCK_IDS.stone);
    w.set(3, 2, 0, BLOCK_IDS.stone);
    const b = new Body([0.5, 1, 0.5]);
    b.velocity[0] = 6;
    for (let i = 0; i < 90; i++) step(solidFn(w), b, 1 / 60);
    expect(b.position[0]).toBeLessThan(2.75); // flush against x=3
    expect(overlaps(solidFn(w), b)).toBe(false);
  });

  it("does not tunnel through the floor at high speed", () => {
    const w = floored();
    const b = new Body([0.5, 20, 0.5]);
    b.velocity[1] = -300;
    for (let i = 0; i < 120; i++) step(solidFn(w), b, 1 / 60);
    expect(b.position[1]).toBeCloseTo(1, 2);
    expect(overlaps(solidFn(w), b)).toBe(false);
  });
});

describe("the block registry", () => {
  it("treats air as not solid and named blocks as solid", () => {
    expect(isSolid(AIR)).toBe(false);
    expect(isSolid(BLOCK_IDS.stone)).toBe(true);
    expect(isSolid(BLOCK_IDS.grass)).toBe(true);
  });
});

// --- the voxel surface writes player edits into canon ------------------------
// VoxelSurface only loads `ws` inside open(), so constructing one here pulls in
// no engine and no socket.
import { VoxelSurface } from "../src/runtime/voxelSurface.js";
import { freshWorld } from "./helpers.js";

describe("digging the world is a thing that happened", () => {
  const surfaceOn = (repo: ReturnType<typeof freshWorld>["repo"]) =>
    new VoxelSurface({ repo, visitorId: "wren", visitorName: "Wren", editBatchMs: 10_000 });

  it("writes one event for a burst of edits, not one per block", () => {
    const { repo } = freshWorld();
    const s = surfaceOn(repo);
    const before = repo.allEvents().length;

    for (let i = 0; i < 7; i++) {
      s.onEdit({ kind: "break", x: 17 + i, y: 14, z: -9, block: "brick" });
    }
    s.flushEdits();

    const fresh = repo.allEvents().slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.type).toBe("terrain_altered");
    expect(fresh[0]!.payload.broke).toBe(7);
    repo.close();
  });

  it("blames the character whose patch it happened on, and moves the relationship", () => {
    const { repo } = freshWorld();
    const s = surfaceOn(repo);
    const before = repo.getRelationship("okonkwo", "wren")?.affinity ?? 0;

    // kiln_row sits at x=13,z=-7 in the voxel ward
    for (let i = 0; i < 5; i++) s.onEdit({ kind: "break", x: 13, y: 14, z: -7, block: "brick" });
    s.flushEdits();

    const evt = repo.allEvents().at(-1)!;
    expect(evt.actors).toContain("okonkwo");
    expect(evt.actors).toContain("fan:wren");
    expect(String(evt.payload.summary)).toMatch(/kiln row/);
    // Tearing out his wall does not improve his opinion of you.
    expect(repo.getRelationship("okonkwo", "wren")!.affinity).toBeLessThan(before);
    repo.close();
  });

  it("leaves nobody to blame when it happens out in the open", () => {
    const { repo } = freshWorld();
    const s = surfaceOn(repo);
    s.onEdit({ kind: "place", x: 200, y: 20, z: 200, block: "plank" });
    s.flushEdits();

    const evt = repo.allEvents().at(-1)!;
    expect(evt.type).toBe("terrain_altered");
    expect(evt.actors).toEqual(["fan:wren"]);
    expect(String(evt.payload.summary)).toMatch(/out in the open/);
    repo.close();
  });

  it("is citable: the event resolves out of the append-only log", () => {
    const { repo } = freshWorld();
    const s = surfaceOn(repo);
    s.onEdit({ kind: "break", x: 13, y: 14, z: -7, block: "brick" });
    s.flushEdits();

    const id = repo.allEvents().at(-1)!.event_id;
    expect(repo.getEvent(id)).toBeDefined();
    repo.close();
  });
});
