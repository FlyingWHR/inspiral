import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanonRepo } from "../src/canon/repo.js";
import { seedFrom } from "../src/canon/seed.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import { compileBible, bibleToWorldSpec, IPHints } from "../src/ip/bible.js";
import { createSource, type IPSource, type RawItem } from "../src/ip/source.js";
import { markIngested } from "../src/ip/ingest.js";

setLogLevel("silent");

/**
 * A throwaway copy of ./fixtures, so a test may drop files into it.
 * Markdown items are left behind on purpose: a stray hand-dropped post in the
 * real fixtures directory must not be able to change what these tests see.
 */
export function fixtureSandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "inspiral-fx-"));
  cpSync("fixtures", root, {
    recursive: true,
    filter: (src) => !src.endsWith(".md") || src.endsWith("README.md"),
  });
  return root;
}

/** Write one markdown item into a sandboxed fixture. This is "dropping a post". */
export function dropPost(root: string, fixture: string, name: string, content: string): void {
  writeFileSync(join(root, fixture, `${name}.md`), content);
}

/**
 * Trade Clash, seeded through the one real seed path, without the host or the
 * approval gate. Those are exercised separately in ip-onboard.test.ts.
 */
export async function tradeClashWorld(
  root: string,
  opts: { start?: string; exclude?: string[] } = {},
): Promise<{ repo: CanonRepo; clock: VirtualClock; source: IPSource; items: RawItem[] }> {
  const clock = new VirtualClock(opts.start ?? "2026-01-19T09:00:00.000Z");
  const repo = CanonRepo.open(":memory:", clock);
  const source = createSource("fixture:tradeclash-fiction", root);
  const all = await source.fetch();
  const exclude = new Set(opts.exclude ?? []);
  const items = all.filter((i) => !exclude.has(i.item_id));
  const hints = IPHints.parse(await source.hints!());
  seedFrom(repo, bibleToWorldSpec(compileBible("tradeclash-fiction", items, hints)));
  markIngested(repo, items);
  repo.setMeta("world_start", repo.now());
  return { repo, clock, source, items };
}
