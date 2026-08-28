import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setLogLevel } from "../src/log.js";
import { LiveHub } from "../src/pieces/live.js";
import type { Piece } from "../src/pieces/contract.js";

setLogLevel("silent");

/**
 * The hub under test is swapped per test, but the http server is not: binding a
 * fresh port per test is slower and leaks a listener every time one fails.
 * `hub` is the mutable seam.
 */
let hub: LiveHub;
let server: Server;
let base: string;

/**
 * Presence expiry is measured in real seconds (see LiveHubOptions.now), so the
 * tests move a fake wall clock rather than sleeping. No fake timers: the sweep
 * we care about runs on read, and vi.useFakeTimers would also freeze the
 * socket machinery underneath fetch.
 */
let clock = 1_770_000_000_000;
const now = (): number => clock;

const makeHub = (opts: Partial<ConstructorParameters<typeof LiveHub>[0]> = {}): LiveHub => {
  hub?.close();
  hub = new LiveHub({ now, ...opts });
  return hub;
};

beforeAll(async () => {
  hub = new LiveHub({ now });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/v1/live") {
      return hub.subscribe(res, { piece: url.searchParams.get("piece") });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  // Every test must terminate: an open SSE response keeps server.close() from
  // ever calling back, and keeps the reader promises below pending forever.
  hub.close();
});

afterAll(async () => {
  hub.close();
  // `close()` alone waits on fetch's keep-alive sockets, which linger for
  // seconds after the response ends. The suite terminates either way; this
  // makes it terminate now.
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const timeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => {
      setTimeout(() => rej(new Error(`timed out waiting for ${what}`)), ms).unref();
    }),
  ]);

/** One SSE connection, read as text, abortable. */
async function stream(path = "/v1/live"): Promise<{
  res: Response;
  /** Read until the accumulated text satisfies `pred`, or fail loudly. */
  until(pred: (s: string) => boolean, what: string): Promise<string>;
  /** Resolves when the server hangs up. */
  ended(): Promise<boolean>;
  abort(): void;
}> {
  const ac = new AbortController();
  const res = await fetch(base + path, { signal: ac.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  return {
    res,
    abort: () => ac.abort(),
    until: (pred, what) =>
      timeout(
        (async () => {
          while (!pred(buf)) {
            const { value, done } = await reader.read();
            if (done) throw new Error(`stream closed before ${what}; got: ${buf}`);
            buf += dec.decode(value, { stream: true });
          }
          return buf;
        })(),
        2000,
        what,
      ),
    ended: () =>
      timeout(
        (async () => {
          for (;;) {
            const { done } = await reader.read();
            if (done) return true;
          }
        })(),
        2000,
        "the server to hang up",
      ),
  };
}

/** The JSON payloads out of an SSE text buffer, comments and retry line ignored. */
const events = (raw: string): Record<string, any>[] =>
  raw
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));

/** Poll a cheap synchronous condition. Sockets close on their own schedule. */
async function eventually(pred: () => boolean, what: string): Promise<void> {
  await timeout(
    (async () => {
      while (!pred()) await new Promise((r) => setTimeout(r, 10));
    })(),
    2000,
    what,
  );
}

const piece = (piece_id: string): Piece => ({
  piece_id,
  title: piece_id,
  brief: "Make something good.",
  status: "open",
  schema: [],
  generation: 0,
  contributors: [],
  location: "",
  created_ts: "2026-03-01T09:00:00.000Z",
  updated_ts: "2026-03-01T09:00:00.000Z",
});

describe("presence", () => {
  it("is distinct by fan_id -- the same person in two tabs is one person here", () => {
    makeHub();
    hub.join("p1", "ada", "Ada");
    hub.join("p1", "ada", "Ada"); // second tab
    hub.join("p1", "maya", "Maya");

    const p = hub.presence("p1");
    expect(p.piece_id).toBe("p1");
    expect(p.here.map((h) => h.fan_id)).toEqual(["ada", "maya"]);
    expect(hub.count("p1")).toBe(2);
    // A room nobody is in is empty, not undefined.
    expect(hub.presence("p2").here).toEqual([]);
  });

  it("keeps `since` across a heartbeat -- arriving twice is not arriving later", () => {
    makeHub();
    hub.join("p1", "ada", "Ada");
    const since = hub.presence("p1").here[0]!.since;
    clock += 30_000;
    hub.join("p1", "ada", "Ada");
    expect(hub.presence("p1").here[0]!.since).toBe(since);
  });

  it("falls back to the id when nobody gave a name", () => {
    makeHub();
    hub.join("p1", "wren");
    expect(hub.presence("p1").here[0]!.display_name).toBe("wren");
  });

  it("leaves, and leaving twice is not an error", () => {
    makeHub();
    hub.join("p1", "ada", "Ada");
    hub.join("p1", "maya", "Maya");
    expect(hub.leave("p1", "ada").here.map((h) => h.fan_id)).toEqual(["maya"]);
    expect(hub.leave("p1", "ada").here.map((h) => h.fan_id)).toEqual(["maya"]);
    expect(hub.leave("p1", "maya").here).toEqual([]);
    expect(hub.leave("nosuch", "ghost").here).toEqual([]);
  });

  it("expires a browser that closed without saying goodbye", () => {
    makeHub({ ttlMs: 60_000 });
    hub.join("p1", "ada", "Ada");
    clock += 30_000;
    hub.join("p1", "maya", "Maya"); // maya arrives halfway through ada's TTL
    expect(hub.count("p1")).toBe(2);

    clock += 31_000; // ada is 61s stale, maya is 31s
    expect(hub.presence("p1").here.map((h) => h.fan_id)).toEqual(["maya"]);

    clock += 60_000;
    expect(hub.count("p1")).toBe(0);
  });

  it("a heartbeat keeps you here; only silence removes you", () => {
    makeHub({ ttlMs: 60_000 });
    hub.join("p1", "ada", "Ada");
    for (let i = 0; i < 5; i++) {
      clock += 20_000;
      hub.join("p1", "ada", "Ada");
    }
    expect(hub.count("p1")).toBe(1); // 100s later, still here
  });

  it("counts heads for a space view without knowing what a space is", () => {
    makeHub();
    hub.join("p1", "ada", "Ada");
    hub.join("p1", "maya", "Maya");
    const view = hub.spaceView("The Kitchen", [piece("p1"), piece("p2")]);
    expect(view.world).toBe("The Kitchen");
    expect(view.pieces.map((p) => [p.piece_id, p.here])).toEqual([
      ["p1", 2],
      ["p2", 0],
    ]);
    // Still a Piece, not a stripped-down copy of one.
    expect(view.pieces[0]!.brief).toBe("Make something good.");
  });
});

describe("the live feed", () => {
  it("answers with SSE headers and opens the stream immediately", async () => {
    makeHub();
    const s = await stream();
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toContain("text/event-stream");
    expect(s.res.headers.get("cache-control")).toContain("no-cache");
    // A piece nobody is extending has no first event; the stream must still open.
    expect(await s.until((b) => b.includes(": open"), "the open comment")).toContain("retry:");
    s.abort();
  });

  it("delivers a published extension with everything a client needs to draw it", async () => {
    makeHub();
    const s = await stream();
    await s.until((b) => b.includes(": open"), "the open comment");

    hub.publish({
      type: "piece_extended",
      piece_id: "p1",
      event_id: "evt_1",
      fan_id: "maya",
      display_name: "Maya",
      generation: 2,
      changed: "Maya cut it with acid instead, and kept your base.",
    });

    const raw = await s.until((b) => b.includes("piece_extended"), "the extension");
    const e = events(raw).find((x) => x.type === "piece_extended")!;
    expect(e).toMatchObject({
      type: "piece_extended",
      piece_id: "p1",
      event_id: "evt_1",
      fan_id: "maya",
      display_name: "Maya",
      generation: 2,
      changed: "Maya cut it with acid instead, and kept your base.",
    });
    expect(e.ts).toBeTruthy(); // no refetch needed to know when
    s.abort();
  });

  it("tells subscribers when somebody arrives and when they go", async () => {
    makeHub();
    const s = await stream();
    await s.until((b) => b.includes(": open"), "the open comment");

    hub.join("p1", "ada", "Ada");
    hub.join("p1", "ada", "Ada"); // a heartbeat is not an arrival: no second event
    hub.leave("p1", "ada");
    hub.leave("p1", "ada"); // nor is leaving twice

    const raw = await s.until((b) => b.split("presence").length > 2, "both presence events");
    const seen = events(raw).filter((e) => e.type === "presence");
    expect(seen).toHaveLength(2);
    expect(seen[0]!.here.map((h: { fan_id: string }) => h.fan_id)).toEqual(["ada"]);
    expect(seen[1]!.here).toEqual([]);
    s.abort();
  });

  it("sends only the piece a client asked for", async () => {
    makeHub();
    const s = await stream("/v1/live?piece=p1");
    await s.until((b) => b.includes(": open"), "the open comment");

    hub.publish({ type: "piece_seeded", piece_id: "p2", title: "Not Yours" });
    hub.publish({ type: "piece_seeded", piece_id: "p1", title: "Five Ingredients" });

    const raw = await s.until((b) => b.includes("piece_seeded"), "the seed event");
    expect(events(raw).map((e) => e.piece_id)).toEqual(["p1"]);
    expect(raw).not.toContain("Not Yours");
    s.abort();
  });

  it("forgets a client that disconnects", async () => {
    makeHub();
    const s = await stream();
    await s.until((b) => b.includes(": open"), "the open comment");
    expect(hub.subscribers).toBe(1);

    s.abort();
    await eventually(() => hub.subscribers === 0, "the subscriber to be dropped");
    // And publishing into an empty hub is a no-op, not a write to a dead socket.
    expect(() => hub.publish({ type: "piece_seeded", piece_id: "p1", title: "x" })).not.toThrow();
  });

  it("caps concurrent subscribers and drops the oldest", async () => {
    makeHub({ maxClients: 2 });
    const first = await stream();
    await first.until((b) => b.includes(": open"), "the open comment");
    const second = await stream();
    await second.until((b) => b.includes(": open"), "the open comment");
    expect(hub.subscribers).toBe(2);

    const third = await stream();
    expect(await third.until((b) => b.includes(": open"), "the open comment")).toContain(": open");
    // The abandoned tab goes, not the person who just arrived.
    expect(await first.ended()).toBe(true);
    await eventually(() => hub.subscribers === 2, "the oldest client to be dropped");

    hub.publish({ type: "piece_seeded", piece_id: "p1", title: "Still Here" });
    expect(await third.until((b) => b.includes("Still Here"), "the newest client's event")).toBeTruthy();
    second.abort();
    third.abort();
  });

  it("hangs up on everybody when the hub closes", async () => {
    makeHub();
    const s = await stream();
    await s.until((b) => b.includes(": open"), "the open comment");
    hub.close();
    expect(await s.ended()).toBe(true);
    expect(hub.subscribers).toBe(0);
  });
});
