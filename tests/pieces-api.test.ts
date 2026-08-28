import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import { PiecesApi } from "../src/pieces/api.js";
import { BODY_MAX, BODY_MIN } from "../src/pieces/contract.js";
import { seedPiece } from "../src/pieces/repo.js";

setLogLevel("silent");

const KEY = "test-key";

/**
 * Ports are shared with every other test file vitest runs in parallel, and with
 * whatever the developer left running. A hardcoded one fails as EADDRINUSE in
 * beforeAll, which reads as "the API is broken" and is not.
 */
async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

let base: string;
let shutBase: string;
let repo: CanonRepo;
let api: PiecesApi;
/** A second server with no key at all, to prove the thing fails closed. */
let shut: PiecesApi;

beforeAll(async () => {
  repo = CanonRepo.open(":memory:", new VirtualClock("2026-03-01T09:00:00.000Z"));
  repo.setMeta("world_name", "The Kitchen");

  const port = await freePort();
  const shutPort = await freePort();
  base = `http://localhost:${port}`;
  shutBase = `http://localhost:${shutPort}`;

  api = new PiecesApi({ repo, port, apiKey: KEY, publicUrl: base });
  shut = new PiecesApi({ repo, port: shutPort, publicUrl: shutBase });
  await api.open();
  await shut.open();
});
afterAll(async () => {
  await api.close();
  await shut.close();
  repo.close();
});

/** fetch().json() is `unknown`; these are tests, not a client library. */
const body = async (r: Response): Promise<any> => r.json();

const post = (path: string, b: unknown, key: string | null = KEY) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-inspiral-key": key } : {}) },
    body: JSON.stringify(b),
  });
const get = (path: string, key: string | null = KEY) =>
  fetch(base + path, { headers: key ? { "x-inspiral-key": key } : {} });

/** There is no create endpoint -- a piece is seeded by whoever runs the world. */
let counter = 0;
const seed = (title = "Five Ingredients") =>
  seedPiece(repo, { title, brief: "Make something good.", piece_id: `p${counter++}` });

/** The seed event is the parent of the first extension. Ask the API for it. */
const seedEvent = async (pieceId: string): Promise<string> =>
  (await body(await get(`/v1/pieces/${pieceId}`))).seed_event_id;

const extend = async (pieceId: string, parent: string, fan: string, text: string, name?: string) =>
  post(`/v1/pieces/${pieceId}/extend`, {
    fan_id: fan,
    parent_event_id: parent,
    body: text,
    ...(name ? { display_name: name } : {}),
  });

describe("pieces over http", () => {
  it("fails closed: no key configured means no authenticated route answers", async () => {
    expect((await fetch(`${shutBase}/v1/pieces`)).status).toBe(503);
    expect((await fetch(`${shutBase}/v1/waiting?fan=ada`)).status).toBe(503);
    // Wrong key against a server that has one is a different answer.
    expect((await get("/v1/pieces", "wrong")).status).toBe(401);
    expect((await get("/v1/pieces", null)).status).toBe(401);
  });

  it("still serves the public page with no key configured -- that is the point of a link", async () => {
    const p = seed("Open To Anyone");
    const r = await fetch(`${shutBase}/w/the-kitchen/p/${p.piece_id}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Open To Anyone");
  });

  it("lists open pieces", async () => {
    const p = seed("Listed");
    const b = await body(await get("/v1/pieces"));
    expect(b.pieces.some((x: { piece_id: string }) => x.piece_id === p.piece_id)).toBe(true);
  });

  it("takes an extension and hands back a permalink that resolves", async () => {
    const p = seed();
    const r = await extend(p.piece_id, await seedEvent(p.piece_id), "ada", "Start with the fennel.");
    expect(r.status).toBe(201);
    const b = await body(r);
    expect(b.generation).toBe(1);
    expect(b.permalink).toContain(b.event_id);
    // Extending the creator's seed notifies nobody, and says so.
    expect(b.notifies).toBeNull();
    expect(repo.getEvent(b.event_id)).toBeDefined();
  });

  it("refuses a body too short to be work", async () => {
    const p = seed();
    const r = await extend(p.piece_id, await seedEvent(p.piece_id), "ada", "no");
    expect(r.status).toBe(400);
    expect((await body(r)).error).toContain(String(BODY_MIN));
    // Whitespace is not a contribution either.
    expect((await extend(p.piece_id, await seedEvent(p.piece_id), "ada", " ".repeat(40))).status).toBe(400);
  });

  it("refuses a body too long to read", async () => {
    const p = seed();
    const r = await extend(p.piece_id, await seedEvent(p.piece_id), "ada", "x".repeat(BODY_MAX + 1));
    expect(r.status).toBe(400);
    expect((await body(r)).error).toContain(String(BODY_MAX));
  });

  it("404s a piece that does not exist rather than 500ing on the caller", async () => {
    const p = seed();
    const parent = await seedEvent(p.piece_id);
    const r = await extend("nosuch", parent, "ada", "Start with the fennel.");
    expect(r.status).toBe(404);
    expect((await body(r)).code).toBe("no_piece");
    expect((await get("/v1/pieces/nosuch")).status).toBe(404);
  });

  it("refuses a parent from a different lineage -- the notification must not point at a stranger", async () => {
    const a = seed("Piece One");
    const b2 = seed("Piece Two");
    const first = await body(await extend(a.piece_id, await seedEvent(a.piece_id), "ada", "Start with the fennel."));
    const r = await extend(b2.piece_id, first.event_id, "maya", "Cut it with acid instead.");
    expect(r.status).toBe(400);
    expect((await body(r)).code).toBe("wrong_piece");
  });

  it("THE PRODUCT: after somebody builds on your work, it is waiting for you", async () => {
    const p = seed("Waiting Works");
    const mine = await body(await extend(p.piece_id, await seedEvent(p.piece_id), "ada", "Start with the fennel."));
    const theirs = await body(
      await extend(p.piece_id, mine.event_id, "maya", "Cut it with acid instead of reducing.", "Maya"),
    );
    expect(theirs.notifies).toBe("ada");

    const w = await body(await get("/v1/waiting?fan=ada"));
    expect(w.items).toHaveLength(1);
    expect(w.items[0].your_event_id).toBe(mine.event_id);
    expect(w.items[0].their_display_name).toBe("Maya");
    expect(w.items[0].their_body).toContain("acid");
    expect(w.items[0].permalink).toContain(theirs.event_id);
  });

  it("says nothing when nobody has built on you -- no invented reason to come back", async () => {
    const p = seed("Nobody Came");
    await extend(p.piece_id, await seedEvent(p.piece_id), "solo", "Start with the fennel.");
    expect((await body(await get("/v1/waiting?fan=solo"))).items).toEqual([]);
    // And a stranger gets an empty list, not a manufactured one.
    expect((await body(await get("/v1/waiting?fan=never-been-here"))).items).toEqual([]);
  });

  it("renders the lineage on a public page, oldest first, each line a receipt", async () => {
    const p = seed("Five Ingredients");
    const first = await body(await extend(p.piece_id, await seedEvent(p.piece_id), "ada", "Start with the fennel."));
    const second = await body(await extend(p.piece_id, first.event_id, "maya", "Cut it with acid instead.", "Maya"));

    const r = await fetch(`${base}/w/the-kitchen/p/${p.piece_id}`); // no key
    expect(r.status).toBe(200);
    const page = await r.text();
    expect(page).toContain("Five Ingredients");
    expect(page).toContain("Make something good.");
    expect(page).toContain("Maya");
    // Oldest first: the thing being built only reads forwards.
    expect(page.indexOf("fennel")).toBeLessThan(page.indexOf("acid"));
    // Every entry is checkable, not merely claimed.
    expect(page).toContain(`/w/the-kitchen/e/${first.event_id}`);
    expect(page).toContain(`/w/the-kitchen/e/${second.event_id}`);
    expect((await fetch(`${base}/w/the-kitchen/p/nosuch`)).status).toBe(404);

    // The JSON route owes the same order. Both extensions share a timestamp
    // under the VirtualClock, which is exactly when the naive sort gets it
    // backwards -- see `oldestFirst`.
    const full = await body(await get(`/v1/pieces/${p.piece_id}`));
    expect(full.extensions.map((x: { event_id: string }) => x.event_id)).toEqual([
      first.event_id,
      second.event_id,
    ]);
    expect(full.seed_event_id).toBeTruthy();
  });

  it("escapes canon before it reaches a page", async () => {
    const p = seedPiece(repo, {
      title: "<script>alert(1)</script>",
      brief: "<img src=x onerror=alert(1)>",
      piece_id: "xss",
    });
    await extend(p.piece_id, await seedEvent(p.piece_id), "ada", "<b>bold claim</b> about fennel");

    const page = await (await fetch(`${base}/w/the-kitchen/p/${p.piece_id}`)).text();
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain("<b>bold");
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain("&lt;img");
  });
});
