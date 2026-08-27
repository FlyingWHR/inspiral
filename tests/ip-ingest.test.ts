import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { MockHostRuntime } from "../src/host/mock.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { performDirective } from "../src/runtime/character.js";
import { compileDigest, renderDigest } from "../src/canon/digest.js";
import { runTick } from "../src/tick/runTick.js";
import { WorldEvent } from "../src/types/events.js";
import type { Directive } from "../src/types/directive.js";
import { createSource, normalizeItem } from "../src/ip/source.js";
import { ingestOnce, itemToEvent, KIND_EVENT_TYPE } from "../src/ip/ingest.js";
import { dropPost, fixtureSandbox, tradeClashWorld } from "./ip-helpers.js";

const CAST = ["cindra", "ferrox", "okuma"];

const POST = `item_id: tc_post_099
ts: 2026-01-18T12:00:00.000Z
actors: ferrox, cindra
arc_id: arc_tariff_spiral
significance: 0.9

Ferrox announced the grain duty would rise again in spring and read the tonnage out loud, twice, so the record would have it.
`;
const POST_TEXT = "Ferrox announced the grain duty would rise again in spring";

/** Seed Trade Clash minus the newest item, then drop that item back in as news. */
async function worldWithDroppedPost() {
  const root = fixtureSandbox();
  const w = await tradeClashWorld(root);
  dropPost(root, "tradeclash-fiction", "tc_post_099", POST);
  const source = createSource("fixture:tradeclash-fiction", root);
  w.repo.setMeta("ingest_cursor", "2026-01-17T00:00:00.000Z");
  const r = await ingestOnce(w.repo, source);
  return { ...w, source, root, result: r, eventId: r.ingested[0]!.event_id };
}

describe("normalisation onto the frozen event schema", () => {
  it("maps raw kinds onto the existing closed vocabulary", () => {
    expect(KIND_EVENT_TYPE.post).toBe("notice_posted");
    expect(KIND_EVENT_TYPE.video).toBe("notice_posted");
    expect(KIND_EVENT_TYPE.pinned).toBe("notice_posted");
    expect(KIND_EVENT_TYPE.comment).toBe("rumor_spread");
    expect(KIND_EVENT_TYPE.match).toBe("confrontation");
    // A profile is bible material, not news.
    expect(KIND_EVENT_TYPE.profile).toBeNull();
  });

  it("produces events that satisfy the frozen schema", () => {
    const item = normalizeItem(
      { kind: "match", ts: "2026-01-20T00:00:00.000Z", text: "Ironbelt 3, Sunbelt 2", actors: ["ferrox", "cindra"] },
      "m1",
      "tradeclash-fiction",
    );
    const e = itemToEvent(item, CAST)!;
    expect(() => WorldEvent.parse({ ...e, event_id: "evt_x", ts: e.ts })).not.toThrow();
    expect(e.source).toBe("ingest");
    expect(e.type).toBe("confrontation");
    expect(e.actors).toEqual(["ferrox", "cindra"]);
    expect(e.payload.item_id).toBe("m1");
  });

  it("drops actors who are not in the cast, and never invents one", () => {
    const item = normalizeItem({ text: "x", actors: ["ferrox", "nobody"] }, "i", "h");
    expect(itemToEvent(item, CAST)!.actors).toEqual(["ferrox"]);
  });

  it("attributes an unattributed item to the first voice in the cast", () => {
    const item = normalizeItem({ text: "x" }, "i", "h");
    expect(itemToEvent(item, CAST)!.actors).toEqual(["cindra"]);
    expect(itemToEvent(item, [])).toBeUndefined();
  });
});

describe("ingestion", () => {
  it("writes new items and costs zero host invocations", async () => {
    const w = await worldWithDroppedPost();
    expect(w.result.ingested).toHaveLength(1);
    expect(w.repo.totalHostInvocations()).toBe(0);
    expect(w.repo.getEvent(w.eventId)!.payload.summary).toContain(POST_TEXT);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("is idempotent: polling again ingests nothing", async () => {
    const w = await worldWithDroppedPost();
    const before = w.repo.eventCount();
    const again = await ingestOnce(w.repo, w.source);
    expect(again.ingested).toHaveLength(0);
    expect(w.repo.eventCount()).toBe(before);
    expect(w.repo.getMeta("ingest_cursor")).toBe("2026-01-18T12:00:00.000Z");

    // Belt and braces: even with the cursor wound back, the per-item ledger
    // stops the same post becoming a second event.
    w.repo.setMeta("ingest_cursor", "2026-01-01T00:00:00.000Z");
    const rewound = await ingestOnce(w.repo, w.source);
    expect(rewound.ingested).toHaveLength(0);
    expect(rewound.skipped).toBeGreaterThan(0);
    expect(w.repo.eventCount()).toBe(before);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("moves the relationship the post is about, and points it at the post", async () => {
    const w = await worldWithDroppedPost();
    const rel = w.repo.getRelationship("cindra", "ferrox")!;
    expect(rel.note).toContain(POST_TEXT);
    expect(rel.last_event_id).toBe(w.eventId);
    expect(rel.tension).toBeGreaterThan(58); // the fixture's starting value
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("threads the post onto the arc it belongs to", async () => {
    const w = await worldWithDroppedPost();
    const arc = w.repo.getArc("arc_tariff_spiral")!;
    expect(arc.tension).toBeGreaterThan(66);
    expect(arc.summary).toContain(POST_TEXT);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("respects the cursor set at onboarding, so the back catalogue is not replayed", async () => {
    const root = fixtureSandbox();
    const w = await tradeClashWorld(root);
    w.repo.setMeta("ingest_cursor", "2026-01-16T18:00:00.000Z"); // newest fixture item
    const r = await ingestOnce(w.repo, createSource("fixture:tradeclash-fiction", root));
    expect(r.ingested).toHaveLength(0);
    w.repo.close();
    rmSync(root, { recursive: true, force: true });
  });
});

describe("THE CLAIM: drop a post, and within one tick the cast is talking about it", () => {
  it("the post is in the very next tick's briefing, by event id", async () => {
    const w = await worldWithDroppedPost();
    const digest = compileDigest(w.repo, { tickNo: 1, sinceSeq: 0, dailyBudget: 12 });
    const entry = digest.new_events.find((e) => e.event_id === w.eventId);
    expect(entry).toBeDefined();
    expect(entry!.summary).toContain(POST_TEXT);
    expect(renderDigest(digest)).toContain(w.eventId);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("a character acting on it quotes it and cites its event id", async () => {
    const w = await worldWithDroppedPost();
    // The tick loop's own choice of action is the host's business; this is the
    // render path it feeds, exercised directly so the assertion is about the
    // citation machinery and not about a lucky seed.
    const d: Directive = {
      actor: "cindra",
      action: "confront",
      target: "ferrox",
      dialogue_intent: "says the shortfall out loud",
      canon_deltas: [],
      arc_id: "arc_tariff_spiral",
      significance_hint: 0.7,
    };
    const b = performDirective(w.repo, d)!;
    expect(b.cites).toContain(w.eventId);
    expect(b.lines.join(" ")).toContain("grain duty");
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("one real tick advances the storyline the post landed in", async () => {
    const w = await worldWithDroppedPost();
    const before = w.repo.getArc("arc_tariff_spiral")!;
    const surface = new MemorySurface();
    const outcome = await runTick({
      repo: w.repo,
      host: new MockHostRuntime({ seed: 1 }),
      surface,
      dailyBudget: 12,
    });
    expect(outcome.status).toBe("applied");
    const after = w.repo.getArc("arc_tariff_spiral")!;
    expect(after.stage).toBe(before.stage + 1);
    expect(surface.presented.length).toBeGreaterThan(0);
    // Whoever acted, they acted in the storyline the post landed in.
    expect(
      surface.presented.some((b) => b.action.target === "ferrox" || b.action.target === "cindra"),
    ).toBe(true);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("a returning visitor is told about the post, and the citation is real", async () => {
    const w = await worldWithDroppedPost();
    // A visitor who took Cindra's side and has been away since yesterday.
    w.repo.ensureVisitor("wren", "Wren");
    w.repo.adjustStance("wren", "cindra", 28);
    w.repo.addInteraction("wren", {
      event_id: "evt_seed_visit",
      ts: "2026-01-18T00:00:00.000Z",
      character_id: "cindra",
      kind: "pledge",
      detail: "took the Compact's side",
    });

    const b = performDirective(w.repo, {
      actor: "cindra",
      action: "greet_visitor",
      target: "fan:wren",
      dialogue_intent: "welcome them back and tell them what he did",
      canon_deltas: [],
      arc_id: null,
      significance_hint: 0.6,
    })!;

    expect(b.cites).toContain(w.eventId);
    expect(b.lines.join(" ")).toContain("grain duty");
    // And the citation resolves in the log, which is what makes it true.
    expect(w.repo.getEvent(w.eventId)).toBeDefined();
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });
});
