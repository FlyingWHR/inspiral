import { describe, expect, it } from "vitest";
import { VoxelWorld } from "../web-voxel/voxel/chunk.js";
import { ARCHETYPES, ARCHETYPE_IDS, DEFAULT_ARCHETYPE } from "../web-voxel/scene/archetypes.js";
import { generateScene, clearPlaces } from "../web-voxel/scene/generate.js";
import { findPath, standable, groundAt } from "../web-voxel/voxel/pathfind.js";
import { chooseScene, chooseSceneHeuristically, scoreScenes, describeScene } from "../src/ip/scene.js";
import { compileBible } from "../src/ip/bible.js";
import { createSource } from "../src/ip/source.js";
import type { IPBible } from "../src/ip/bible.js";

type Place = { x: number; z: number };
type Arch = { id: string; name: string; affords: string; places: Record<string, Place>;
              spawn: Place; build: unknown[] };
const LIB = ARCHETYPES as unknown as Record<string, Arch>;

function build(id: string): VoxelWorld {
  const w = new VoxelWorld();
  generateScene(w, id, { seed: 1 });
  clearPlaces(w, id);
  return w;
}

// ---------------------------------------------------------------------------
// Every scene has to be a place a body can actually exist in.
// ---------------------------------------------------------------------------

describe.each(ARCHETYPE_IDS)("the %s archetype", (id) => {
  const arch = LIB[id]!;

  it("generates a world with something in it", () => {
    const w = build(id);
    expect(w.voxelCount).toBeGreaterThan(1000);
    expect(w.chunkCount).toBeGreaterThan(0);
  });

  it("declares at least three named places for directives to target", () => {
    expect(Object.keys(arch.places).length).toBeGreaterThanOrEqual(3);
  });

  it("puts nobody inside a solid voxel", () => {
    const w = build(id);
    for (const [name, p] of Object.entries(arch.places)) {
      const floor = groundAt(w, p.x, p.z, 13, 24);
      expect(floor, `${id}.${name} has no floor`).not.toBeNull();
      // feet and headroom both clear
      expect(standable(w, p.x, floor!, p.z), `${id}.${name} is not standable`).toBe(true);
    }
  });

  it("spawns the player somewhere they can stand", () => {
    const w = build(id);
    const floor = groundAt(w, arch.spawn.x, arch.spawn.z, 13, 24);
    expect(floor, `${id} spawn has no floor`).not.toBeNull();
    expect(standable(w, arch.spawn.x, floor!, arch.spawn.z)).toBe(true);
  });

  it("lets an NPC walk from any named place to any other", () => {
    const w = build(id);
    const places = Object.entries(arch.places);
    const [fromName, from] = places[0]!;
    const fy = groundAt(w, from.x, from.z, 13, 24)!;
    for (const [toName, to] of places.slice(1)) {
      const path = findPath(w, [from.x, fy, from.z], [to.x, to.z], 4000);
      expect(path, `${id}: ${fromName} -> ${toName} is unreachable`).not.toBeNull();
      // and the route never passes through anything solid
      for (const c of path!) expect(w.solid(c[0]!, c[1]!, c[2]!)).toBe(false);
    }
  });

  it("is deterministic: same id, same seed, same world", () => {
    expect(build(id).voxelCount).toBe(build(id).voxelCount);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const bibleWith = (over: Partial<IPBible>): IPBible =>
  ({
    world_name: "Test", ip_handle: "test", summary: "", themes: [], audience_tone: "",
    characters: [{
      character_id: "a", name: "A", faction: "F", title: "", brief: "", goals: [], taboos: [],
      voice: { register: "plain", tics: [], max_words: 28 }, mood: "even", home_location: "here",
    }],
    relationships: [], arcs: [], lore: [], sources: [],
    tone: { world_id: "test", register: "plain", banned_phrases: [], forbidden_topics: [], max_line_words: 30 },
    ...over,
  }) as IPBible;

describe("choosing a scene", () => {
  it("is deterministic for the same bible", () => {
    const b = bibleWith({ themes: ["tariffs", "treaty"], summary: "The council votes on a toll." });
    const runs = new Set(Array.from({ length: 5 }, () => chooseSceneHeuristically(b).archetype));
    expect(runs.size).toBe(1);
  });

  it("matches whole words, not fragments inside other words", () => {
    // "barrels" contains "bar"; a cooper's workshop is not a tavern.
    const cooper = bibleWith({
      summary: "He restores barrels and workshop tools for the channel.",
      themes: ["restoration", "cooperage"],
    });
    expect(chooseSceneHeuristically(cooper).archetype).not.toBe("tavern");
  });

  it("falls back to the default when nothing points anywhere", () => {
    const blank = bibleWith({ summary: "zzz qqq", themes: [] });
    const choice = chooseSceneHeuristically(blank);
    expect(choice.archetype).toBe(DEFAULT_ARCHETYPE);
    expect(choice.chosen_by).toBe("default");
  });

  it("always returns an archetype that exists", () => {
    for (const summary of ["", "a gym and a ballroom and a stadium", "!!!", "council"]) {
      const c = chooseSceneHeuristically(bibleWith({ summary }));
      expect(ARCHETYPE_IDS).toContain(c.archetype);
    }
  });

  it("takes a valid host suggestion over the heuristic", () => {
    const b = bibleWith({ summary: "council treaty tariff" });
    const c = chooseScene(b, { archetype: "ballroom", reason: "the host had a view" });
    expect(c.archetype).toBe("ballroom");
    expect(c.chosen_by).toBe("host");
  });

  it("falls back when the host names an archetype that does not exist", () => {
    const b = bibleWith({ summary: "council treaty tariff chancellor" });
    const c = chooseScene(b, { archetype: "space_station", reason: "invented" });
    expect(c.archetype).toBe("council_chamber");
    expect(c.chosen_by).toBe("heuristic");
  });

  it.each([
    ["a malformed object", { nonsense: true }],
    ["a string", "tavern"],
    ["a number", 7],
    ["null", null],
    ["an array", ["tavern"]],
  ])("falls back on %s from the host", (_label, suggestion) => {
    const b = bibleWith({ summary: "gym sparring belt champion" });
    const c = chooseScene(b, suggestion);
    expect(ARCHETYPE_IDS).toContain(c.archetype);
    expect(c.chosen_by).not.toBe("host");
  });

  it("describes the choice in one line for the gate", () => {
    const line = describeScene(chooseSceneHeuristically(bibleWith({ summary: "tavern innkeeper" })));
    expect(line).toMatch(/Tavern/);
    expect(line.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// The fixtures must land somewhere defensible without being told to.
// ---------------------------------------------------------------------------

describe("the shipped fixtures pick sensible scenes", () => {
  const bibleFor = async (spec: string) => {
    const src = createSource(spec);
    const items = await src.fetch();
    const hints = src.hints ? await src.hints() : null;
    return compileBible(src.handle, items, hints ?? null);
  };

  it("puts Trade Clash in a room where procedure is the weapon", async () => {
    const choice = chooseSceneHeuristically(await bibleFor("tradeclash"));
    expect(["council_chamber", "market_plaza"]).toContain(choice.archetype);
    // and decisively, not on a tiebreak
    const ranked = scoreScenes(await bibleFor("tradeclash"));
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("puts a maker channel on a set, not in a pub", async () => {
    const bible = await bibleFor("creator");
    const choice = chooseSceneHeuristically(bible);
    expect(["studio", "cafe"]).toContain(choice.archetype);
    const ranked = scoreScenes(bible);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("gives a reason a person can read", async () => {
    const choice = chooseSceneHeuristically(await bibleFor("tradeclash"));
    expect(choice.reason).toMatch(/matched on/);
    expect(choice.reason.length).toBeGreaterThan(30);
  });
});
