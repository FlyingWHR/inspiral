import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { parseSheet, mintFromText, mintCharacter } from "../src/canon/mint.js";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import { freshWorld } from "./helpers.js";

function ctxFor(): TickContext & { surface: MemorySurface; close: () => void } {
  const { repo, clock } = freshWorld();
  const surface = new MemorySurface();
  return {
    repo,
    host: new MockHostRuntime({ seed: 1 }),
    surface,
    clock,
    dailyBudget: 500,
    advanceMs: 4 * HOUR_MS,
    close: () => repo.close(),
  };
}

const SHEET = `
Name: Halric Vaas
Title: Wharfmaster
Faction: The Wet Quarter
Brief: Runs the river landing and decides which cargo rots. Keeps a ledger of
  favours that is longer than anyone's debt book.
Goals: Control what enters the ward, Be owed by everyone, Never be seen to need
Taboos: Never begs, Never speaks first
Register: clipped, riverside
Tics: counts under his breath
Home: wharf
`;

describe("minting a character from pasted text", () => {
  it("parses a Key: value sheet into a valid character", () => {
    const sheet = parseSheet(SHEET);

    expect(sheet.character_id).toBe("halric_vaas");
    expect(sheet.name).toBe("Halric Vaas");
    expect(sheet.faction).toBe("The Wet Quarter");
    expect(sheet.title).toBe("Wharfmaster");
    expect(sheet.brief).toContain("river landing");
    expect(sheet.goals.length).toBe(3);
    expect(sheet.taboos).toContain("Never begs");
    expect(sheet.voice.tics).toContain("counts under his breath");
    expect(sheet.home_location).toBe("wharf");
  });

  it("accepts a bare paragraph with no keys at all", () => {
    const sheet = parseSheet("A silent tanner who owes everyone and admits nothing.");

    expect(sheet.character_id).toBeTruthy();
    expect(sheet.brief).toContain("tanner");
    // Schema defaults fill everything the paste did not say.
    expect(sheet.faction).toBe("Unaligned");
    expect(sheet.voice.max_words).toBeGreaterThan(0);
  });

  it("never collides with an id already in canon", () => {
    const { repo } = freshWorld();
    const first = mintFromText(repo, "Name: Sera Vance");
    const second = mintFromText(repo, "Name: Sera Vance");

    expect(first.sheet.character_id).not.toBe(second.sheet.character_id);
    expect(repo.getCharacter(second.sheet.character_id)).toBeDefined();
    // The original three are untouched.
    expect(repo.getCharacter("vance")!.name).toBe("Sera Vance");
    repo.close();
  });

  it("writes the character, an append-only event, and edges both ways", () => {
    const { repo } = freshWorld();
    const castBefore = repo.getCharacters().length;

    const { sheet, eventId, edges } = mintFromText(repo, SHEET);

    expect(repo.characterExists(sheet.character_id)).toBe(true);
    expect(repo.getCharacters().length).toBe(castBefore + 1);
    expect(edges).toBe(castBefore * 2);

    const evt = repo.getEvent(eventId);
    expect(evt).toBeDefined();
    expect(evt!.type).toBe("character_minted");
    expect(evt!.actors).toContain(sheet.character_id);

    // An opinion in both directions, or the tick loop has nowhere to push.
    expect(repo.getRelationship(sheet.character_id, "vance")).toBeDefined();
    expect(repo.getRelationship("vance", sheet.character_id)).toBeDefined();
    repo.close();
  });

  it("reacts to canon that predates it: the newcomer acts within a few ticks", async () => {
    const ctx = ctxFor();
    // Give the ward a history the newcomer had no part in.
    for (let i = 0; i < 6; i++) await runTick(ctx);
    const historyBefore = ctx.repo.allEvents().length;

    const { sheet } = mintFromText(ctx.repo, SHEET);
    for (let i = 0; i < 8; i++) await runTick(ctx);

    const theirEvents = ctx.repo
      .allEvents()
      .slice(historyBefore)
      .filter((e) => e.actors.includes(sheet.character_id) && e.type !== "character_minted");

    expect(theirEvents.length).toBeGreaterThan(0);
    ctx.close();
  });

  it("is visible to the host: the newcomer appears in the digest", async () => {
    const ctx = ctxFor();
    const { sheet } = mintFromText(ctx.repo, SHEET);

    // The mock only ever names characters canon told it about, and the
    // validator rejects any actor it does not know -- so an applied directive
    // naming the newcomer proves the digest carried them.
    let named = false;
    for (let i = 0; i < 10 && !named; i++) {
      await runTick(ctx);
      named = ctx.repo
        .allEvents()
        .some((e) => e.actors.includes(sheet.character_id) && e.type !== "character_minted");
    }
    expect(named).toBe(true);
    ctx.close();
  });
});

describe("a minted character is a full citizen", () => {
  it("can be cited by name in a later greeting", async () => {
    const ctx = ctxFor();
    const { sheet } = mintFromText(ctx.repo, SHEET);
    for (let i = 0; i < 10; i++) await runTick(ctx);

    await onboardVisitor(ctx, "wren", "Wren");
    ctx.clock!.advance(3 * HOUR_MS);
    await visitorAction(ctx, "wren", `backed ${sheet.name} against vance in front of the ward`);

    const stance = ctx.repo.getStance("wren");
    // Standing exists for the newcomer, i.e. canon treats them like the cast.
    expect(Object.keys(stance)).toContain(sheet.character_id);
    ctx.close();
  });
});

describe("canon survives the process", () => {
  it("keeps a visitor's side-taking after the database is closed and reopened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspiral-"));
    const file = join(dir, "canon.db");
    const clock = new VirtualClock("2026-03-02T08:00:00.000Z");

    const repo = CanonRepo.open(file, clock);
    seedWorld(repo);
    const ctx: TickContext = {
      repo,
      host: new MockHostRuntime({ seed: 1 }),
      surface: new MemorySurface(),
      clock,
      dailyBudget: 500,
      advanceMs: 4 * HOUR_MS,
    };

    await onboardVisitor(ctx, "wren", "Wren");
    clock.advance(3 * HOUR_MS);
    await visitorAction(ctx, "wren", "backed okonkwo against vance in front of the whole ward");
    const minted = mintFromText(repo, SHEET);
    const stanceBefore = repo.getStance("wren");
    const eventsBefore = repo.allEvents().length;
    repo.close();

    // A new process opens the same file.
    const reopened = CanonRepo.open(file, new VirtualClock("2026-03-09T08:00:00.000Z"));
    try {
      expect(reopened.getStance("wren")).toEqual(stanceBefore);
      expect(reopened.getStance("wren").okonkwo!).toBeGreaterThan(0);
      expect(reopened.getStance("wren").vance!).toBeLessThan(0);
      expect(reopened.allEvents().length).toBe(eventsBefore);
      expect(reopened.characterExists(minted.sheet.character_id)).toBe(true);
      expect(reopened.getEvent(minted.eventId)).toBeDefined();
    } finally {
      reopened.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a home-less sheet does not collide with the last one", () => {
  it("defaults home_location to the plaza rather than a shared placeholder", () => {
    const a = parseSheet("Name: Ossa Rell\nTitle: Ropewright");
    const b = parseSheet("Name: Halric Vaas\nTitle: Wharfmaster");

    // Both default, and the default is a real place -- not slug("")'s fallback,
    // which silently gave every home-less newcomer the same invented location.
    expect(a.home_location).toBe("plaza");
    expect(b.home_location).toBe("plaza");
  });

  it("keeps an explicit home", () => {
    expect(parseSheet("Name: X\nHome: The Wet Quarter").home_location).toBe("the_wet_quarter");
  });
});
