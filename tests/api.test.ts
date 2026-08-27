import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryApi } from "../src/api/server.js";
import { CanonRepo } from "../src/canon/repo.js";
import { seedFrom } from "../src/canon/seed.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("silent");

const KEY = "test-key";
const PORT = 8791;
const base = `http://localhost:${PORT}`;
const sheet = (id: string, name: string) => ({
  character_id: id, name, faction: name, title: "", brief: "", goals: [], taboos: [],
  voice: { register: "plain", tics: [], max_words: 28 }, mood: "even", home_location: "arena",
});

let repo: CanonRepo;
let api: MemoryApi;

beforeAll(async () => {
  repo = CanonRepo.open(":memory:", new VirtualClock("2026-03-01T09:00:00.000Z"));
  seedFrom(repo, {
    world_name: "Trade Clash",
    characters: [sheet("alpha", "Alpha"), sheet("beta", "Beta")],
    relationships: [], arcs: [],
    tone: { world_id: "d", register: "", banned_phrases: [], forbidden_topics: [], max_line_words: 32 },
    history: [],
  });
  api = new MemoryApi({ repo, port: PORT, apiKey: KEY, publicUrl: base });
  await api.open();
});
afterAll(async () => { await api.close(); repo.close(); });

/** fetch().json() is `unknown`; these are tests, not a client library. */
const body = async (r: Response): Promise<any> => r.json();

const post = (path: string, body: unknown, key: string | null = KEY) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-inspiral-key": key } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, key: string | null = KEY) =>
  fetch(base + path, { headers: key ? { "x-inspiral-key": key } : {} });

describe("the memory layer", () => {
  it("refuses writes without the key", async () => {
    expect((await post("/v1/matches", {}, null)).status).toBe(401);
    expect((await post("/v1/matches", {}, "wrong")).status).toBe(401);
  });

  it("records a finished match and hands back a permalink", async () => {
    const r = await post("/v1/matches", {
      match_id: "m1", bot_a: "alpha", bot_b: "beta", winner_side: 0,
    });
    expect(r.status).toBe(201);
    const b = await body(r);
    expect(b.permalink).toContain("/e/");
    // Losing moves how the loser sees the winner.
    expect(repo.getRelationship("beta", "alpha")!.tension).toBeGreaterThan(0);
  });

  it("is idempotent on match_id, so a webhook retry cannot inflate a grudge", async () => {
    const before = repo.getRelationship("beta", "alpha")!.tension;
    const again = await post("/v1/matches", {
      match_id: "m1", bot_a: "alpha", bot_b: "beta", winner_side: 0,
    });
    expect(again.status).toBe(200);
    expect((await body(again)).status).toBe("already recorded");
    expect(repo.getRelationship("beta", "alpha")!.tension).toBe(before);
  });

  it("rejects an unknown bot rather than inventing one", async () => {
    const r = await post("/v1/matches", {
      match_id: "m2", bot_a: "alpha", bot_b: "nobody", winner_side: 0,
    });
    expect(r.status).toBe(422);
  });

  it("answers the caster's question with receipts that resolve", async () => {
    await post("/v1/matches", { match_id: "m3", bot_a: "alpha", bot_b: "beta", winner_side: 0 });
    const b = await body(await get("/v1/rivalry?a=alpha&b=beta"));
    expect(b.met).toBe(2);
    expect(b.record.alpha).toBe(2);
    expect(b.receipts.length).toBeGreaterThan(0);
    for (const r of b.receipts) expect(repo.getEvent(r.event_id)).toBeDefined();
  });

  it("remembers someone who took a side, and says the identity is asserted", async () => {
    expect((await post("/v1/stakes", { fan_id: "vi", bot_id: "alpha" })).status).toBe(201);
    const m = await body(await get("/v1/memory?fan=vi"));
    expect(m.stance.alpha).toBeGreaterThan(0);
    expect(m.remembers[0].who_saw_it).toContain("alpha");
    expect(m.identity).toBe("asserted");
  });

  it("404s a stranger rather than inventing a history", async () => {
    expect((await get("/v1/memory?fan=never")).status).toBe(404);
  });

  it("serves a public permalink for a real event, and 404s a fake one", async () => {
    const id = (await body(await get("/v1/rivalry?a=alpha&b=beta"))).receipts[0].event_id;
    const ok = await fetch(`${base}/w/trade-clash/e/${id}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain(id);
    expect((await fetch(`${base}/w/trade-clash/e/evt_nope`)).status).toBe(404);
  });

  it("serves the timeline without a key -- a permalink nobody can open is not evidence", async () => {
    const r = await fetch(`${base}/w/trade-clash`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Trade Clash");
  });

  it("escapes canon before it reaches a page", async () => {
    repo.upsertCharacter(sheet("xss", "<script>alert(1)</script>"));
    const e = repo.appendEvent({
      source: "system", actors: ["xss"], type: "notice_posted",
      payload: { summary: "<img src=x onerror=alert(1)>" }, significance_hint: 0.5,
    });
    const body = await (await fetch(`${base}/w/trade-clash/e/${e.event_id}`)).text();
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img");
  });
});

/**
 * OWNERSHIP IS THE RETURN TRIGGER.
 *
 * "Does an NPC remember me" is flattery, and you cannot tell in advance whether
 * it will be any good. "What did the character I made do while I was gone" is
 * curiosity, and it is the reason someone opens the tab again.
 */
describe("characters you made", () => {
  it("records the owner in the log, not in a column", async () => {
    const { mintFromText } = await import("../src/canon/mint.js");
    const r = mintFromText(repo, "Name: Kestrel\nFaction: The Wharf\nBrief: Runs the night market.", {
      owner: "maker",
    });
    const evt = repo.getEvent(r.eventId)!;
    expect(evt.actors).toContain("fan:maker");
    expect(evt.actors).toContain(r.sheet.character_id);
  });

  it("hands back what they have been up to, with receipts", async () => {
    const b = await body(await get("/v1/mine?fan=maker"));
    expect(b.characters).toHaveLength(1);
    expect(b.characters[0].name).toBe("Kestrel");
    // Their own arrival is not news to the person who caused it.
    for (const e of b.characters[0].since_you_left) {
      expect(repo.getEvent(e.event_id)!.type).not.toBe("character_minted");
    }
  });

  it("does not hand somebody else's characters to a stranger", async () => {
    const b = await body(await get("/v1/mine?fan=notme"));
    expect(b.characters).toHaveLength(0);
  });

  it("still mints without an owner, for seeded and imported casts", async () => {
    const { mintFromText } = await import("../src/canon/mint.js");
    const r = mintFromText(repo, "Name: Nobody's Own\nBrief: Arrived unclaimed.");
    expect(repo.getEvent(r.eventId)!.actors.some((a) => a.startsWith("fan:"))).toBe(false);
  });
});
