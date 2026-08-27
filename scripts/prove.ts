/**
 * PROVE IT: the one thing in this demo that a Mind is required for.
 *
 *   npm run prove
 *
 * The hard question a judge should ask is not "is this an LLM in a for-loop".
 * It is sharper than that: *this repo runs end to end with the host switched
 * off, so show me one thing that stops working without it.*
 *
 * This is that thing. It onboards the same un-hinted source twice -- once with
 * the host disabled, once against a live Mind -- and prints the two bibles side
 * by side. The deterministic compiler can extract hashtags and a name. It
 * cannot invent a storyline, because a storyline is a judgement about what the
 * material is ABOUT.
 *
 * Arcs are not decoration: the tick loop escalates arcs. Zero arcs is a world
 * with nothing to advance. That is the difference between a world that exists
 * and a world that runs.
 *
 * Use an UN-HINTED fixture. `tradeclash` ships a complete hints.json, so the
 * compiler already produces a full cast and enrichment has nothing to add --
 * it is the wrong fixture to prove this with, and quietly proves the opposite.
 *
 * Flags:
 *   --fixture NAME   source to onboard (default "creator", which has no hints)
 *   --keep           leave the two scratch databases on disk
 */

import { rmSync } from "node:fs";
import { CanonRepo } from "../src/canon/repo.js";
import { createSource } from "../src/ip/source.js";
import type { IPBible } from "../src/ip/bible.js";
import { onboardIP } from "../src/ip/onboard.js";
import { createApprovalChannel } from "../src/approval/index.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { systemClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || !argv[i + 1] ? d : argv[i + 1]!;
};
const FIXTURE = flag("fixture", "creator");
const KEEP = argv.includes("--keep");

const W = 52;
const bar = (c = "─") => c.repeat(W * 2 + 3);
const pair = (a: string, b: string) => {
  const A = wrap(a, W), B = wrap(b, W);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    console.log(`${(A[i] ?? "").padEnd(W)} │ ${B[i] ?? ""}`);
  }
};
function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  for (const para of String(s).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > w) { out.push(line.trim()); line = word; }
      else line += " " + word;
    }
    out.push(line.trim());
  }
  return out.filter((l, i, a) => l !== "" || i < a.length - 1);
}

/** Run something with stdout muted. The gate prints a full bible per onboard;
 *  this script exists to show ONE table and the noise buries it. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = real;
  }
}

async function main(): Promise<void> {
  setLogLevel("warn");
  const src = createSource(FIXTURE);
  const items = await src.fetch();
  const hints = src.hints ? await src.hints() : null;

  /**
   * The thing that spoils this comparison is not a hints file, it is a hints
   * file that already contains the NARRATIVE layer -- arcs, or goals per
   * character. A fixture may legitimately ship a cast and nothing else, which
   * is what a real brand document looks like (see fixtures/tradeclash), and
   * that is the most honest source to run this against: real IP in, and the
   * gap a Mind closes measured on it.
   */
  const h = hints as
    | { arcs?: unknown[]; characters?: { goals?: unknown[] }[] }
    | null;
  const preArced = (h?.arcs?.length ?? 0) > 0;
  const preGoaled = (h?.characters ?? []).some((c) => (c.goals?.length ?? 0) > 0);
  if (preArced || preGoaled) {
    console.log(
      `\n  WARNING: "${FIXTURE}" ships hints.json with ${preArced ? "arcs" : "per-character goals"}\n` +
        `  already filled in, so there is little left for a Mind to add and this\n` +
        `  comparison will look like a tie. Use a source whose hints stop at the cast.\n`,
    );
  }

  // ---- A: no host at all -----------------------------------------------
  const mockDb = `./data/prove-mock.db`;
  rmSync(mockDb, { force: true });
  const mockRepo = CanonRepo.open(mockDb, systemClock);
  const a = await quietly(() =>
    onboardIP({
      source: src,
      repo: mockRepo,
      approval: createApprovalChannel(process.env, { mode: "approve" }),
    }),
  );

  // ---- B: the same source, through a Mind -------------------------------
  const realDb = `./data/prove-minds.db`;
  rmSync(realDb, { force: true });
  const realRepo = CanonRepo.open(realDb, systemClock);
  const cfg = { ...loadConfig(), host: "minds" as const };
  const host = await startHostRuntime(cfg);
  const t0 = Date.now();
  const b = await quietly(() =>
    onboardIP({
      source: src,
      repo: realRepo,
      approval: createApprovalChannel(process.env, { mode: "approve" }),
      host,
    }),
  );
  const ms = Date.now() - t0;

  const A: IPBible = a.bible, B: IPBible = b.bible;
  const live = host.name === "minds";

  console.log("");
  console.log(bar("═"));
  console.log(`  WHAT A MIND IS FOR   —   source: ${src.name}${hints ? "  (hinted!)" : "  (no hints)"}`);
  console.log(bar("═"));
  console.log(`${"WITHOUT A MIND (deterministic compile)".padEnd(W)} │ ${live ? "WITH A MIND (live)" : "WITH A MIND (UNAVAILABLE — fell back)"}`);
  console.log(bar());

  const rows: [string, string, string][] = [
    ["premise", A.summary, B.summary],
    ["themes", A.themes.join(", "), B.themes.join(", ")],
    ["tone", A.audience_tone, B.audience_tone],
    ["goals", JSON.stringify(A.characters[0]?.goals ?? []), JSON.stringify(B.characters[0]?.goals ?? [])],
  ];
  for (const [label, l, r] of rows) {
    console.log(`\n${label.toUpperCase()}`);
    pair(l || "(nothing)", r || "(nothing)");
  }

  console.log(`\nSTORYLINES`);
  pair(
    A.arcs.length ? A.arcs.map((x) => `• ${x.title}`).join("\n") : "(none — nothing for the tick loop to advance)",
    B.arcs.length ? B.arcs.map((x) => `• ${x.title}\n  ${x.summary}`).join("\n") : "(none)",
  );

  console.log("");
  console.log(bar());
  console.log(
    `  ARCS:  ${String(A.arcs.length).padStart(2)}  without a Mind` +
      `      →      ${String(B.arcs.length).padStart(2)}  with one`,
  );
  console.log(
    `  Arcs are what the tick loop escalates. Zero arcs is a cast that exists\n` +
      `  and a world that does not run. The compiler can read hashtags; it cannot\n` +
      `  decide what a body of work is about.`,
  );
  console.log(bar());
  console.log(
    `  host: ${host.name}   invocations: ${b.hostCalls}   elapsed: ${(ms / 1000).toFixed(1)}s`,
  );
  if (!live) {
    console.log(
      `\n  NOTE: no live Mind was reachable, so the right-hand column is ALSO the\n` +
        `  deterministic compile. Set MINDS_BUILDER_API_KEY in .env and re-run with\n` +
        `  INSPIRAL_HOST=minds to see the real difference.`,
    );
  }
  console.log("");

  await host.close();
  mockRepo.close();
  realRepo.close();
  if (!KEEP) {
    rmSync(mockDb, { force: true });
    rmSync(realDb, { force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
