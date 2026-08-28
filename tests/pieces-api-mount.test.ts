import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PiecesApi } from "../src/pieces/api.js";
import { CanonRepo } from "../src/canon/repo.js";
import { seedPiece, extendPiece, lineage } from "../src/pieces/repo.js";
import { setLogLevel } from "../src/log.js";
import { createServer } from "node:http";

setLogLevel("silent");

/**
 * THE MOUNTING LAYER, not the modules underneath it.
 *
 * digest, dispatch, health and route are each tested on their own. What was
 * untested is the wiring: which routes exist, what they return, and whether
 * auth is applied to the right ones. Every bug I have shipped in this file has
 * been a wiring bug -- a duplicate publish, a helper called instead of the
 * filtered one -- and none of them were visible from a module test.
 */
const KEY = "k";
let repo: CanonRepo;
let api: PiecesApi;
let base: string;

const freePort = async (): Promise<number> =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

beforeAll(async () => {
  repo = CanonRepo.open(":memory:");
  repo.setMeta("world_name", "Pieces");
  const p = seedPiece(repo, { title: "Five Ingredients", brief: "make something worth arguing about" });
  seedPiece(repo, { title: "Six Words", brief: "a whole story in six words please" });
  const seed = lineage(repo, p.piece_id)!.seed_event_id;
  const a = extendPiece(repo, {
    piece_id: p.piece_id, parent_event_id: seed, fan_id: "ada", display_name: "Ada",
    body: "braise the fennel until it collapses",
  });
  extendPiece(repo, {
    piece_id: p.piece_id, parent_event_id: a.extension.event_id, fan_id: "maya",
    display_name: "Maya", body: "shave it raw instead, keep the bread",
  });

  const port = await freePort();
  base = `http://localhost:${port}`;
  api = new PiecesApi({ repo, port, apiKey: KEY, publicUrl: base });
  await api.open();
});
afterAll(async () => { await api.close(); repo.close(); });

const get = (p: string, key: string | null = KEY) =>
  fetch(base + p, { headers: key ? { "x-inspiral-key": key } : {} });
const send = (p: string, method: string, body?: unknown, key: string | null = KEY) =>
  fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "x-inspiral-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const body = async (r: Response): Promise<any> => r.json();

describe("mounted routes", () => {
  it("/health is public and reports its checks", async () => {
    const r = await fetch(base + "/health"); // deliberately no key
    expect(r.status).toBe(200);
    const h = await body(r);
    expect(h.ok).toBe(true);
    expect(h.checks.db).toBe(true);
  });

  it("/v1/stats needs the key and counts what is really there", async () => {
    expect((await get("/v1/stats", null)).status).toBe(401);
    const s = await body(await get("/v1/stats"));
    expect(s.pieces.total).toBe(2);
    expect(s.pieces.extensions).toBe(2);
    expect(s.pieces.contributors).toBe(2);
    expect(s.db.schema_version).toBeGreaterThanOrEqual(5);
  });

  it("/v1/space returns every open piece with depth and presence", async () => {
    const s = await body(await get("/v1/space"));
    expect(s.world).toBe("Pieces");
    expect(s.pieces).toHaveLength(2);
    const five = s.pieces.find((p: any) => p.piece_id === "five_ingredients");
    expect(five.generation).toBe(2);
    expect(five.here).toBe(0);
  });

  it("/v1/route always answers, even with no host", async () => {
    const r = await body(await get("/v1/route?fan=newcomer"));
    // Falls back to the thinnest piece: a frontend must never handle "no suggestion".
    expect(r.piece_id).toBe("six_words");
    expect(typeof r.because).toBe("string");
  });

  it("/v1/place moves a piece, and 404s one that does not exist", async () => {
    const ok = await send("/v1/pieces/six_words/place", "POST", { location: "reading_room" });
    expect(ok.status).toBe(200);
    expect((await body(ok)).piece.location).toBe("reading_room");
    expect((await send("/v1/pieces/nope/place", "POST", { location: "x" })).status).toBe(404);
    expect((await send("/v1/pieces/six_words/place", "POST", {})).status).toBe(400);
  });

  it("/v1/seen clears the return screen and only for that person", async () => {
    expect((await body(await get("/v1/waiting?fan=ada"))).items).toHaveLength(1);
    expect((await send("/v1/seen", "POST", { fan_id: "ada" })).status).toBe(200);
    expect((await body(await get("/v1/waiting?fan=ada"))).items).toHaveLength(0);
    expect((await send("/v1/seen", "POST", {})).status).toBe(400);
  });

  it("/v1/notify/prefs round-trips, and DELETE opts out without deleting the row", async () => {
    await send("/v1/notify/prefs", "POST", {
      fan_id: "ada", channel: "console", address: "ada@x", quiet_minutes: 5,
    });
    let p = (await body(await get("/v1/notify/prefs?fan=ada"))).preferences;
    expect(p[0].address).toBe("ada@x");
    expect(p[0].enabled).toBe(true);

    await send("/v1/notify/prefs?fan=ada", "DELETE");
    p = (await body(await get("/v1/notify/prefs?fan=ada"))).preferences;
    // Opting out is a flag, not a deletion -- the address survives so turning
    // it back on does not mean typing it again.
    expect(p[0].enabled).toBe(false);
    expect(p[0].address).toBe("ada@x");

    expect((await send("/v1/notify/prefs", "POST", { fan_id: "x" })).status).toBe(400);
  });

  it("/v1/digest answers in both shapes and never invents activity", async () => {
    const j = await body(await get("/v1/digest?hours=24"));
    expect(Array.isArray(j.unanswered)).toBe(true);
    const t = await (await get("/v1/digest?hours=24&format=text")).text();
    expect(t.length).toBeGreaterThan(0);

    /**
     * `?hours=0` is a real window, not a missing parameter. It used to be
     * swallowed by `Number(x) || 24` and silently reported a whole day.
     */
    const zero = await body(await get("/v1/digest?hours=0"));
    expect(zero.hours).toBe(0);
    expect(zero.moved).toHaveLength(0); // nothing MOVED in a zero-length window

    /**
     * But unanswered work still shows, deliberately: something ignored for
     * three days would otherwise drop off the digest on the day it matters
     * most, and the digest would forget exactly the person it exists to save.
     */
    expect(zero.unanswered.length).toBeGreaterThan(0);
  });

  it("every authenticated route refuses a bad key", async () => {
    for (const p of ["/v1/stats", "/v1/space", "/v1/route?fan=a", "/v1/digest", "/v1/notify/prefs?fan=a"]) {
      expect((await get(p, "wrong")).status).toBe(401);
    }
  });
});
