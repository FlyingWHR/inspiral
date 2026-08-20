/**
 * WHO WROTE THE WORDS?
 *
 *   npm run authorship                    # against the deterministic stand-in
 *   INSPIRAL_HOST=minds npm run authorship  # against a live Mind
 *
 * A reviewer counted the rendered dialogue in this project and found that one
 * line in ten came from the model; the rest were canned openers in a table. On
 * the beat the whole pitch rests on it was zero. That is a fair reading of a
 * codebase that asked the host for an *intent* and then wrote the sentence
 * itself.
 *
 * So the number is now measured, printed, and checkable by anyone with the
 * repo. `speech` is the host's own dialogue and it is the default render path;
 * the canned openers are the fallback for a host that is unreachable or returns
 * nothing usable. Canon still appends the cited fact verbatim underneath,
 * because the receipt is the one thing a model must not be trusted to invent.
 */

import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { startHostRuntime } from "../src/host/index.js";
import { loadConfig } from "../src/config.js";
import { runTick, onboardVisitor, visitorAction, type TickContext } from "../src/tick/runTick.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { VirtualClock, HOUR_MS } from "../src/clock.js";
import type { RenderedBehavior } from "../src/runtime/character.js";
import { setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const num = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  const v = Number(argv[i + 1]);
  return i === -1 || !Number.isFinite(v) ? d : v;
};
const TICKS = num("ticks", 12);

function tally(bs: RenderedBehavior[]): { lines: number; host: number; pct: number } {
  let lines = 0, host = 0;
  for (const b of bs) {
    lines += b.lines.length;
    host += Math.min(b.hostLines ?? 0, b.lines.length);
  }
  return { lines, host, pct: lines ? Math.round((host / lines) * 100) : 0 };
}

async function main(): Promise<void> {
  setLogLevel("warn");
  const clock = new VirtualClock("2026-03-02T08:00:00.000Z");
  const repo = CanonRepo.open(":memory:", clock);
  seedWorld(repo);
  const surface = new MemorySurface();
  const host = await startHostRuntime(loadConfig());
  const ctx: TickContext = {
    repo, host, surface, clock, dailyBudget: 5000, advanceMs: 4 * HOUR_MS,
  };

  for (let i = 0; i < TICKS; i++) await runTick(ctx);
  const ambient = tally(surface.presented);

  await onboardVisitor(ctx, "wren", "Wren");
  clock.advance(3 * HOUR_MS);
  await visitorAction(ctx, "wren", "backed okonkwo against vance in front of the whole ward");
  repo.setPresence("wren", false);
  for (let i = 0; i < Math.max(6, TICKS); i++) await runTick(ctx);
  repo.setPresence("wren", true);

  const mark = surface.presented.length;
  await visitorAction(ctx, "wren", "returned to the ward after days away");
  const money = surface.presented.slice(mark);
  const m = tally(money);
  const all = tally(surface.presented);

  const row = (label: string, t: { lines: number; host: number; pct: number }) =>
    console.log(
      `  ${label.padEnd(22)} ${String(t.host).padStart(3)} / ${String(t.lines).padEnd(3)} lines ` +
        `written by the host   ${String(t.pct).padStart(3)}%`,
    );

  console.log("");
  console.log("  WHO WROTE THE DIALOGUE".padEnd(40) + `host: ${host.name}`);
  console.log("  " + "─".repeat(66));
  row("ambient ticks", ambient);
  row("the return visit", m);
  row("everything", all);
  console.log("  " + "─".repeat(66));
  console.log("  Lines the host did NOT write are either a canned fallback opener or a");
  console.log("  fact quoted verbatim out of canon with its event id attached.");
  console.log("");
  console.log("  the return visit, line by line:");
  for (const b of money) {
    for (let i = 0; i < b.lines.length; i++) {
      const who = i < (b.hostLines ?? 0) ? "HOST " : "canon";
      console.log(`    [${who}] ${b.lines[i]}`);
    }
    if (b.cites.length) console.log(`            └─ cites ${b.cites.join(", ")}`);
  }
  console.log("");

  await host.close();
  repo.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
