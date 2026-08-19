import { describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { MockHostRuntime } from "../src/host/mock.js";
import { WorldEvent } from "../src/types/events.js";
import {
  CliApprovalChannel,
  MemoryApprovalChannel,
  createApprovalChannel,
  applyPatch,
} from "../src/approval/index.js";
import {
  FixtureSource,
  SourceNotImplementedError,
  createSource,
  normalizeItem,
} from "../src/ip/source.js";
import { compileBible, bibleToWorldSpec, extractThemes, IPHints } from "../src/ip/bible.js";
import { mergeEnrichment, onboardIP, loadBible } from "../src/ip/onboard.js";
import { fixtureSandbox } from "./ip-helpers.js";

const world = () => CanonRepo.open(":memory:", new VirtualClock("2026-01-19T09:00:00.000Z"));

describe("IPSource", () => {
  it("reads a fixture directory, oldest first", async () => {
    const items = await new FixtureSource("tradeclash").fetch();
    expect(items.length).toBeGreaterThan(4);
    expect(items[0]!.kind).toBe("profile");
    const ts = items.map((i) => Date.parse(i.ts));
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("honours `since`, which is how the poll loop avoids re-reading history", async () => {
    const src = new FixtureSource("tradeclash");
    const all = await src.fetch();
    const cut = all[2]!.ts;
    const after = await src.fetch({ since: cut });
    expect(after.every((i) => i.ts > cut)).toBe(true);
    expect(after.length).toBeLessThan(all.length);
  });

  it("reads a dropped markdown file with a key:value header", async () => {
    const root = fixtureSandbox();
    writeFileSync(
      join(root, "tradeclash", "drop.md"),
      "item_id: tc_drop\nts: 2026-01-18T09:00:00.000Z\nactors: ferrox, cindra\n\nThe duty rises again in spring.\n",
    );
    const items = await new FixtureSource("tradeclash", root).fetch();
    const dropped = items.find((i) => i.item_id === "tc_drop");
    expect(dropped).toBeDefined();
    expect(dropped!.actors).toEqual(["ferrox", "cindra"]);
    expect(dropped!.text).toBe("The duty rises again in spring.");
    rmSync(root, { recursive: true, force: true });
  });

  it("derives significance from engagement when the item does not state it", () => {
    const quiet = normalizeItem({ text: "x", metrics: { likes: 3 } }, "a", "h");
    const loud = normalizeItem({ text: "x", metrics: { likes: 90000, comments: 8000 } }, "b", "h");
    expect(loud.significance!).toBeGreaterThan(quiet.significance!);
    expect(loud.significance!).toBeLessThanOrEqual(0.95);
  });

  it("network sources fail loudly rather than looking like a quiet account", async () => {
    for (const spec of ["x:@someone", "youtube:@someone", "instagram:@someone", "tiktok:@someone"]) {
      const src = createSource(spec);
      await expect(src.fetch()).rejects.toBeInstanceOf(SourceNotImplementedError);
    }
  });

  it("a bare name is a fixture, because the fixture is the default", () => {
    expect(createSource("tradeclash").name).toBe("fixture:tradeclash");
    expect(createSource("fixture:creator").name).toBe("fixture:creator");
  });
});

describe("bible compiler", () => {
  it("uses hints when a fixture ships them", async () => {
    const src = new FixtureSource("tradeclash");
    const bible = compileBible("tradeclash", await src.fetch(), IPHints.parse(await src.hints!()));
    expect(bible.characters.map((c) => c.character_id).sort()).toEqual(["cindra", "ferrox", "okuma"]);
    expect(bible.arcs.map((a) => a.arc_id).sort()).toEqual(["arc_strait_toll", "arc_tariff_spiral"]);
    // Directed and asymmetric: that asymmetry is the engine.
    const fc = bible.relationships.find((r) => r.from_id === "ferrox" && r.to_id === "cindra")!;
    const cf = bible.relationships.find((r) => r.from_id === "cindra" && r.to_id === "ferrox")!;
    expect(fc.note).not.toBe(cf.note);
  });

  it("derives a usable world from raw items alone, with no hints", async () => {
    const items = await new FixtureSource("creator").fetch();
    const bible = compileBible("saltandsawdust", items, null);
    expect(bible.characters).toHaveLength(1);
    expect(bible.characters[0]!.character_id).toBe("saltandsawdust");
    expect(bible.themes).toContain("restoration");
    expect(bible.lore.length).toBeGreaterThan(0);
    expect(bible.sources.map((s) => s.item_id)).toContain("cr_002");
  });

  it("pulls themes out of hashtags first", () => {
    const mk = (text: string, id: string) => normalizeItem({ text }, id, "h");
    expect(extractThemes([mk("#tariffs and #blocs", "a"), mk("more #tariffs", "b")])[0]).toBe("tariffs");
  });

  it("turns lore into real, citable day-zero events", async () => {
    const src = new FixtureSource("tradeclash");
    const bible = compileBible("tradeclash", await src.fetch(), IPHints.parse(await src.hints!()));
    const spec = bibleToWorldSpec(bible);
    expect(spec.history[0]!.type).toBe("world_created");
    const lore = spec.history.slice(1);
    expect(lore.length).toBe(bible.lore.length);
    for (const e of lore) {
      expect(e.type).toBe("notice_posted");
      // Frozen schema or nothing.
      expect(() =>
        WorldEvent.parse({ ...e, event_id: "evt_x", ts: e.ts ?? "2026-01-01T00:00:00.000Z" }),
      ).not.toThrow();
    }
  });
});

describe("host enrichment", () => {
  const base = () =>
    compileBible("h", [normalizeItem({ text: "hello #thing", kind: "profile" }, "p", "h")], null);

  it("keeps the draft when the host returns something that is not a bible", () => {
    const draft = base();
    // This is exactly what MockHostRuntime returns: valid JSON, wrong document.
    const r = mergeEnrichment(draft, JSON.stringify({ directives: [{ actor: "x" }] }));
    expect(r.enriched).toBe(false);
    expect(r.bible).toEqual(draft);
  });

  it("keeps the draft when the host returns prose", () => {
    expect(mergeEnrichment(base(), "Sure! Here you go:").enriched).toBe(false);
  });

  it("merges the keys the host actually improved", () => {
    const r = mergeEnrichment(base(), '```json\n{"audience_tone":"wry and specific"}\n```');
    expect(r.enriched).toBe(true);
    expect(r.bible.audience_tone).toBe("wry and specific");
    expect(r.bible.characters).toHaveLength(1);
  });
});

describe("the approval gate", () => {
  it("auto-approves when there is no terminal to ask", async () => {
    const lines: string[] = [];
    const ch = new CliApprovalChannel({ mode: "approve", out: (s) => lines.push(s) });
    const d = await ch.review({ title: "t", body: "b", draft: {} });
    expect(d.verdict).toBe("approve");
    expect(lines.join("\n")).toContain("b");
  });

  it("falls back to the CLI when Telegram is half-configured", () => {
    expect(createApprovalChannel({ TELEGRAM_BOT_TOKEN: "x" } as NodeJS.ProcessEnv).name).toBe("cli");
    expect(createApprovalChannel({} as NodeJS.ProcessEnv).name).toBe("cli");
    expect(
      createApprovalChannel({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" } as NodeJS.ProcessEnv)
        .name,
    ).toBe("telegram");
  });

  it("patches shallowly", () => {
    expect(applyPatch({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });
});

describe("onboarding, end to end", () => {
  const opts = (repo: CanonRepo, approval: MemoryApprovalChannel) => ({
    source: createSource("fixture:tradeclash"),
    repo,
    approval,
    host: new MockHostRuntime({ seed: 1 }),
  });

  it("seeds a living world from a handle, for one host call", async () => {
    const repo = world();
    const approval = new MemoryApprovalChannel([{ verdict: "approve" }]);
    const r = await onboardIP(opts(repo, approval));

    expect(r.status).toBe("seeded");
    expect(r.hostCalls).toBe(1);
    expect(repo.totalHostInvocations()).toBe(1);
    expect(repo.getCharacters().map((c) => c.character_id)).toEqual(["cindra", "ferrox", "okuma"]);
    expect(repo.openArcs()).toHaveLength(2);
    expect(repo.getRelationships()).toHaveLength(6);
    expect(repo.getTone().banned_phrases).toContain("as you know");
    expect(repo.getMeta("world_name")).toBe("Trade Clash");
    expect(loadBible(repo)?.ip_handle).toBe("tradeclash");
    // The back catalogue is day-zero canon, so ingestion must not replay it.
    expect(repo.getMeta("ingest_cursor")).toBe("2026-01-16T18:00:00.000Z");
    repo.close();
  });

  it("the owner sees the draft before anything commits", async () => {
    const repo = world();
    const approval = new MemoryApprovalChannel([{ verdict: "approve" }]);
    await onboardIP(opts(repo, approval));
    expect(approval.reviewed).toHaveLength(1);
    expect(approval.reviewed[0]!.body).toContain("Chancellor Ferrox");
    expect(approval.reviewed[0]!.body).toContain("RELATIONSHIP GRAPH");
    repo.close();
  });

  it("NOTHING reaches canon when the owner says no", async () => {
    const repo = world();
    const approval = new MemoryApprovalChannel([{ verdict: "reject", reason: "wrong voice" }]);
    const r = await onboardIP(opts(repo, approval));

    expect(r.status).toBe("rejected");
    expect(r.reason).toBe("wrong voice");
    expect(repo.getMeta("seeded")).toBeUndefined();
    expect(repo.getCharacters()).toHaveLength(0);
    expect(repo.getArcs()).toHaveLength(0);
    expect(repo.eventCount()).toBe(0);
    repo.close();
  });

  it("an edit is applied before the world is written", async () => {
    const repo = world();
    const approval = new MemoryApprovalChannel([
      { verdict: "edit", patch: { world_name: "Trade Clash: Season Four" } },
    ]);
    const r = await onboardIP(opts(repo, approval));
    expect(r.status).toBe("seeded");
    expect(repo.getMeta("world_name")).toBe("Trade Clash: Season Four");
    repo.close();
  });

  it("an edit that does not validate is dropped, not half-applied", async () => {
    const repo = world();
    const approval = new MemoryApprovalChannel([{ verdict: "edit", patch: { characters: [] } }]);
    const r = await onboardIP(opts(repo, approval));
    expect(r.status).toBe("seeded");
    expect(repo.getCharacters()).toHaveLength(3);
    repo.close();
  });

  it("refuses to seed a second world over an existing one", async () => {
    const repo = world();
    await onboardIP(opts(repo, new MemoryApprovalChannel()));
    const again = await onboardIP(opts(repo, new MemoryApprovalChannel()));
    expect(again.status).toBe("already-seeded");
    expect(repo.getCharacters()).toHaveLength(3);
    repo.close();
  });

  it("works with no host at all", async () => {
    const repo = world();
    const r = await onboardIP({
      source: createSource("fixture:creator"),
      repo,
      approval: new MemoryApprovalChannel(),
    });
    expect(r.status).toBe("seeded");
    expect(r.hostCalls).toBe(0);
    expect(repo.getCharacters()).toHaveLength(1);
    repo.close();
  });
});
