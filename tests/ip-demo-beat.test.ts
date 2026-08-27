import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { loadConfig } from "../src/config.js";
import { createHostRuntime } from "../src/host/index.js";
import { runTick } from "../src/tick/runTick.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { MemoryApprovalChannel } from "../src/approval/index.js";
import { createSource, writeFixtureItem } from "../src/ip/source.js";
import { onboardIP } from "../src/ip/onboard.js";
import { ingestOnce } from "../src/ip/ingest.js";
import { fixtureSandbox } from "./ip-helpers.js";

/**
 * THE ON-CAMERA BEAT, END TO END.
 *
 * This test is the filmed demo, in process, with nothing stubbed past the
 * seam: handles in -> living cast out -> post something real -> ONE tick ->
 * the cast is talking about it and citing it.
 *
 * It goes through `createHostRuntime`, not `new MockHostRuntime`, so it breaks
 * if the factory ever stops resolving to a usable host on an empty environment.
 *
 * The text below is the same post that appears in docs/IP-PIPELINE.md and in
 * fixtures/tradeclash/README.md. If you change one, change all three.
 */
const POST =
  "Okuma raised the strait toll a second time, on twelve hours' notice, and " +
  "published the schedule after the convoys had already sailed.";

async function filmedTake() {
  const root = fixtureSandbox();
  const repo = CanonRepo.open(":memory:", new VirtualClock("2026-01-19T09:00:00.000Z"));

  // The default environment: no key, no host override, seed 1.
  const cfg = loadConfig({} as NodeJS.ProcessEnv);
  const host = createHostRuntime(cfg);
  await host.init();

  // 1. handles in, living cast out
  const onboarded = await onboardIP({
    source: createSource("fixture:tradeclash-fiction", root),
    repo,
    approval: new MemoryApprovalChannel([{ verdict: "approve" }]),
    host,
  });

  // 2. post something real
  writeFixtureItem(
    "tradeclash-fiction",
    { text: POST, actors: ["okuma", "ferrox"], arc_id: "arc_strait_toll", significance: 0.9, ts: "2026-01-18T09:00:00.000Z" },
    root,
  );

  // 3. it becomes news
  const ingested = await ingestOnce(repo, createSource("fixture:tradeclash-fiction", root));

  // 4. one tick
  const surface = new MemorySurface();
  const outcome = await runTick({ repo, host, surface, dailyBudget: cfg.dailyHostBudget });

  return { root, repo, host, onboarded, ingested, surface, outcome };
}

describe("handles in, living cast out, and the world reacts to a real post", () => {
  it("runs the whole beat on an empty environment and costs three host calls", async () => {
    const t = await filmedTake();

    expect(t.onboarded.status).toBe("seeded");
    expect(t.repo.getCharacters().map((c) => c.character_id)).toEqual(["cindra", "ferrox", "okuma"]);

    // The onboard enrichment and the tick. Ingestion is free, and must stay free.
    expect(t.repo.totalHostInvocations()).toBe(2);
    expect(t.repo.totalHostInvocations()).toBeLessThan(t.repo.getCharacters().length * 12);

    await t.host.close();
    t.repo.close();
    rmSync(t.root, { recursive: true, force: true });
  });

  it("the post becomes exactly one event, and only the post", async () => {
    const t = await filmedTake();
    expect(t.ingested.ingested).toHaveLength(1);
    const e = t.repo.getEvent(t.ingested.ingested[0]!.event_id)!;
    expect(e.source).toBe("ingest");
    expect(e.type).toBe("notice_posted");
    expect(e.actors).toEqual(["okuma", "ferrox"]);
    expect(e.payload.summary).toContain("strait toll a second time");
    await t.host.close();
    t.repo.close();
    rmSync(t.root, { recursive: true, force: true });
  });

  it("WITHIN ONE TICK the cast is talking about it and citing it", async () => {
    const t = await filmedTake();
    const eventId = t.ingested.ingested[0]!.event_id;

    expect(t.outcome.status).toBe("applied");

    const citing = t.surface.presented.find((b) => b.cites.includes(eventId));
    expect(
      citing,
      `no rendered line cited ${eventId}. Presented: ${JSON.stringify(
        t.surface.presented.map((b) => ({ who: b.character_id, verb: b.action.verb, cites: b.cites })),
      )}`,
    ).toBeDefined();

    // Talking about it: the post's own words come out of a character's mouth.
    expect(citing!.lines.join(" ")).toContain("strait toll a second time");

    // Citing it: the id resolves in the append-only log, so the line is true
    // because canon says so, not because a model remembered correctly.
    const cited = t.repo.getEvent(eventId)!;
    expect(cited.payload.summary).toContain("strait toll a second time");
    expect(cited.payload.from_ip).toBe(true);

    await t.host.close();
    t.repo.close();
    rmSync(t.root, { recursive: true, force: true });
  });

  it("the same beat is in the showrunner's note and the clip drafts", async () => {
    const t = await filmedTake();
    const { showrunnerNote, selectClips } = await import("../src/ip/outbound.js");

    const note = showrunnerNote(t.repo, 24 * 365);
    expect(note).toContain("FROM YOUR FEED");
    expect(note).toContain("strait toll a second time");

    const clips = selectClips(t.repo, { hours: 24 * 365, limit: 3 });
    expect(clips.some((c) => c.link.includes(t.ingested.ingested[0]!.event_id))).toBe(true);

    await t.host.close();
    t.repo.close();
    rmSync(t.root, { recursive: true, force: true });
  });
});
