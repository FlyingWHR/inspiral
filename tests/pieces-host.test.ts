import { describe, expect, it } from "vitest";
import { narrateChange, routeVisitor } from "../src/pieces/host.js";
import type { HostRequest, HostResponse, HostRuntime } from "../src/host/HostRuntime.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("silent");

/** A host that says whatever the test tells it to. */
class Says implements HostRuntime {
  readonly name = "says";
  lastKind: HostRequest["kind"] | null = null;
  constructor(private readonly reply: string | { fail: true }) {}
  async init(): Promise<void> {}
  async ask(req: HostRequest): Promise<HostResponse> {
    this.lastKind = req.kind;
    if (typeof this.reply !== "string") {
      return { ok: false, reason: "error", message: "down", latencyMs: 1 };
    }
    return { ok: true, text: this.reply, latencyMs: 1 };
  }
  async budgetRemaining(): Promise<number | undefined> { return undefined; }
  async close(): Promise<void> {}
}

const NARRATE = {
  piece_title: "Five Ingredients",
  parent_body: "Start with the fennel, reduce it slowly.",
  parent_author: "Ada",
  child_body: "Kept the fennel, but cut it with vinegar instead of reducing.",
  child_author: "Maya",
};

describe("narrate -- the sentence is the product", () => {
  it("returns the sentence, and asks on its own lane", async () => {
    const h = new Says("Maya kept your fennel base and cut it with acid instead of reducing it.");
    expect(await narrateChange(h, NARRATE)).toContain("fennel");
    // Prose must not be asked for in a lane full of JSON directives.
    expect(h.lastKind).toBe("narrate");
  });

  it("strips the packaging models put around an answer", async () => {
    const cases: [string, string][] = [
      ['"Maya kept your base and swapped the acid."', "Maya kept your base and swapped the acid."],
      ["```\nMaya kept your base and swapped the acid.\n```", "Maya kept your base and swapped the acid."],
      ["Sure, here it is: Maya kept your base and swapped the acid.", "Maya kept your base and swapped the acid."],
      ["Maya kept your base and swapped the acid. Great work!", "Maya kept your base and swapped the acid."],
    ];
    for (const [raw, want] of cases) {
      expect(await narrateChange(new Says(raw), NARRATE)).toBe(want);
    }
  });

  it("truncates rather than returning a paragraph", async () => {
    const long = `${"Maya changed a great many things ".repeat(30)}.`;
    const got = (await narrateChange(new Says(long), NARRATE))!;
    expect(got.length).toBeLessThanOrEqual(240);
  });

  it("returns nothing when the host is down, absent, or empty", async () => {
    expect(await narrateChange(new Says({ fail: true }), NARRATE)).toBeUndefined();
    expect(await narrateChange(undefined, NARRATE)).toBeUndefined();
    expect(await narrateChange(new Says("   "), NARRATE)).toBeUndefined();
  });
});

const PIECES = [
  { piece_id: "busy", title: "Busy", brief: "b", generation: 9, last_ts: "2026-03-01" },
  { piece_id: "thin", title: "Thin", brief: "t", generation: 1, last_ts: "2026-03-01" },
];

describe("route", () => {
  it("takes the host's choice when it names a real piece", async () => {
    const h = new Says('{"piece_id":"busy","because":"You will have something to say here."}');
    const r = await routeVisitor(h, { fan_id: "ada", history: [], pieces: PIECES });
    expect(r!.piece_id).toBe("busy");
    expect(h.lastKind).toBe("route");
  });

  it("refuses a piece that does not exist and falls back to the thinnest", async () => {
    const h = new Says('{"piece_id":"invented","because":"trust me"}');
    const r = await routeVisitor(h, { fan_id: "ada", history: [], pieces: PIECES });
    // Same referential discipline as the directive validator.
    expect(r!.piece_id).toBe("thin");
  });

  it("falls back to the thinnest piece with no host at all", async () => {
    const r = await routeVisitor(undefined, { fan_id: "ada", history: [], pieces: PIECES });
    expect(r!.piece_id).toBe("thin");
  });

  it("returns nothing when there is nothing open", async () => {
    expect(await routeVisitor(undefined, { fan_id: "ada", history: [], pieces: [] })).toBeUndefined();
  });
});
