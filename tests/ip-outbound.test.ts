import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick } from "../src/tick/runTick.js";
import { MemoryApprovalChannel } from "../src/approval/index.js";
import { createSource } from "../src/ip/source.js";
import { ingestOnce } from "../src/ip/ingest.js";
import {
  renderClip,
  selectClips,
  sendDailyDigest,
  showrunnerNote,
  writeClips,
} from "../src/ip/outbound.js";
import { dropPost, fixtureSandbox, tradeClashWorld } from "./ip-helpers.js";

const POST = `item_id: tc_post_099
ts: 2026-01-18T12:00:00.000Z
actors: ferrox, cindra
arc_id: arc_tariff_spiral
significance: 0.9

Ferrox announced the grain duty would rise again in spring and read the tonnage out loud, twice.
`;

async function livedInWorld() {
  const root = fixtureSandbox();
  const w = await tradeClashWorld(root);
  dropPost(root, "tradeclash-fiction", "tc_post_099", POST);
  w.repo.setMeta("ingest_cursor", "2026-01-17T00:00:00.000Z");
  await ingestOnce(w.repo, createSource("fixture:tradeclash-fiction", root));
  const host = new MockHostRuntime({ seed: 3 });
  for (let i = 0; i < 3; i++) await runTick({ repo: w.repo, host, dailyBudget: 99 });
  return { ...w, root };
}

describe("clip selection", () => {
  it("picks the biggest moments, one per storyline", async () => {
    const w = await livedInWorld();
    const clips = selectClips(w.repo, { limit: 3, minSignificance: 0.5 });
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(3);

    const sig = clips.map((c) => c.significance);
    expect([...sig].sort((a, b) => b - a)).toEqual(sig);

    const arcs = clips.map((c) => c.context).filter(Boolean);
    expect(new Set(arcs).size).toBe(arcs.length);

    // Housekeeping never becomes a clip.
    expect(clips.some((c) => c.headline.includes("did not resolve"))).toBe(false);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("every clip carries a tracked link back to the exact moment", async () => {
    const w = await livedInWorld();
    const [clip] = selectClips(w.repo, { limit: 1, platform: "x", baseUrl: "https://example.test" });
    expect(clip).toBeDefined();
    const url = new URL(clip!.link);
    expect(url.origin).toBe("https://example.test");
    /**
     * The shape the memory API actually serves, not a shape we wish it served.
     * These drifted once already: clips built `/w/<world>?e=<id>` while the
     * server route was `/w/<world>/e/<id>`, so every posted clip would have
     * 404'd and the receipt on it would have been decoration. Asserted against
     * the server's own route pattern so they cannot drift apart again.
     */
    const SERVER_ROUTE = /^\/w\/[^/]+\/e\/([A-Za-z0-9_]{1,64})$/;
    const m = SERVER_ROUTE.exec(url.pathname);
    expect(m, `${url.pathname} is not a route MemoryApi serves`).not.toBeNull();
    expect(m![1]).toBe(clip!.event_id);
    expect(url.searchParams.get("utm_source")).toBe("x");
    expect(url.searchParams.get("utm_medium")).toBe("clip");
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("renders and writes drafts, and says they are drafts", async () => {
    const w = await livedInWorld();
    const dir = mkdtempSync(join(tmpdir(), "clips-"));
    const path = writeClips(w.repo, selectClips(w.repo, { limit: 2 }), join(dir, "out.md"));
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Nothing here has been posted");
    expect(text).toContain("Trade Clash");
    expect(renderClip(w.repo, selectClips(w.repo, { limit: 1 })[0]!)).toContain("day ");
    rmSync(dir, { recursive: true, force: true });
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });
});

describe("the daily digest", () => {
  it("reports the world back to the owner, including what came off their feed", async () => {
    const w = await livedInWorld();
    const note = showrunnerNote(w.repo, 24 * 30);
    expect(note).toContain("SHOWRUNNER'S NOTE");
    expect(note).toContain("Trade Clash");
    expect(note).toContain("STORYLINES RUNNING");
    expect(note).toContain("FROM YOUR FEED");
    expect(note).toContain("grain duty");
    expect(note).toMatch(/COGNITION: \d+ host call/);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });

  it("says so plainly when nothing happened", async () => {
    const root = fixtureSandbox();
    const w = await tradeClashWorld(root, { start: "2027-06-01T09:00:00.000Z" });
    w.clock.advance(7 * 24 * 3_600_000); // a week in which no tick fired
    expect(showrunnerNote(w.repo, 24)).toContain("Nothing happened");
    w.repo.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("goes out over the approval channel and posts nowhere else", async () => {
    const w = await livedInWorld();
    const channel = new MemoryApprovalChannel();
    const { clips } = await sendDailyDigest(w.repo, channel, { hours: 24 * 30 });
    expect(channel.notices[0]).toContain("SHOWRUNNER'S NOTE");
    if (clips.length) expect(channel.notices[1]).toContain("nothing has been published");
    // The gate is for approvals; a digest must never ask for one.
    expect(channel.reviewed).toHaveLength(0);
    w.repo.close();
    rmSync(w.root, { recursive: true, force: true });
  });
});
