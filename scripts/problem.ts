/**
 * THE PROBLEM, MEASURED IN THE OWNER'S OWN PRODUCT.
 *
 *   npm run problem
 *   npm run problem -- --raw ../tradeclash-platform/analytics/events.jsonl
 *
 * Every retention pitch opens with a claim about why people don't come back.
 * This one opens with eight days of first-party analytics off a product that is
 * actually live, and the number is bad. That is the point: Inspiral is not
 * addressing a problem we imagined, it is addressing the one that showed up in
 * the log.
 *
 * With no `--raw` this reads the committed aggregate, which is counts only --
 * the raw file carries per-visit session ids and is deliberately not
 * redistributed. `--raw` recomputes from source so the aggregate is checkable
 * by anyone holding it rather than taken on trust.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const rawArg = argv.indexOf("--raw");
const AGG = resolve("fixtures/tradeclash/source/audience.json");

interface Agg {
  source: string;
  span: [string, string];
  span_days: number;
  sessions: number;
  events_total: number;
  sessions_that_picked_a_faction: number;
  sessions_that_built_an_agent: number;
  sessions_seen_again_after_12h: number;
  faction_picks: Record<string, number>;
}

/** Recompute from a raw events.jsonl. Same arithmetic that produced the aggregate. */
function fromRaw(path: string): Agg {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const sessions = new Map<string, { first: number; last: number }>();
  const picked = new Set<string>();
  const built = new Set<string>();
  const picks: Record<string, number> = {};
  let lo = Infinity;
  let hi = -Infinity;

  for (const line of lines) {
    let e: { t: number; sid: string; event?: string; props?: { faction?: string } };
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a truncated tail line is not a reason to refuse the other 1600
    }
    if (typeof e.t !== "number" || typeof e.sid !== "string") continue;
    const s = sessions.get(e.sid);
    if (s) {
      s.first = Math.min(s.first, e.t);
      s.last = Math.max(s.last, e.t);
    } else sessions.set(e.sid, { first: e.t, last: e.t });
    lo = Math.min(lo, e.t);
    hi = Math.max(hi, e.t);
    if (e.event === "faction_pick") {
      picked.add(e.sid);
      const f = e.props?.faction ?? "unknown";
      picks[f] = (picks[f] ?? 0) + 1;
    }
    if (e.event === "agent_built") built.add(e.sid);
  }

  const GAP_H = 12; // same return threshold the affinity model uses
  let seenAgain = 0;
  for (const s of sessions.values()) if ((s.last - s.first) / 3_600_000 > GAP_H) seenAgain++;

  return {
    source: path,
    span: [new Date(lo).toISOString(), new Date(hi).toISOString()],
    span_days: (hi - lo) / 86_400_000,
    sessions: sessions.size,
    events_total: lines.length,
    sessions_that_picked_a_faction: picked.size,
    sessions_that_built_an_agent: built.size,
    sessions_seen_again_after_12h: seenAgain,
    faction_picks: picks,
  };
}

const a: Agg = rawArg === -1 ? JSON.parse(readFileSync(AGG, "utf8")) : fromRaw(argv[rawArg + 1]!);
const pct = (n: number): string => `${((n / a.sessions) * 100).toFixed(2)}%`;

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";

console.log("");
console.log(`${D}──────────────────────────────────────────────────────────────────────${R}`);
console.log(`  ${B}THE PROBLEM${R}   ${D}Trade Clash, first-party analytics${R}`);
console.log(`${D}──────────────────────────────────────────────────────────────────────${R}`);
console.log(`  window                 ${a.span[0].slice(0, 10)} .. ${a.span[1].slice(0, 10)}   (${a.span_days.toFixed(1)} days)`);
console.log(`  source                 ${a.source}${rawArg === -1 ? `  ${D}(committed aggregate)${R}` : `  ${D}(recomputed from raw)${R}`}`);
console.log("");
console.log(`  ${B}sessions${R}               ${a.sessions}`);
console.log(`  picked a side          ${a.sessions_that_picked_a_faction}   ${D}${pct(a.sessions_that_picked_a_faction)}${R}`);
console.log(`  built an agent         ${a.sessions_that_built_an_agent}   ${D}${pct(a.sessions_that_built_an_agent)}${R}`);
console.log(`  ${B}seen again${R}             ${a.sessions_seen_again_after_12h}`);
console.log("");
console.log(`  ${B}Sixteen blocs. ${a.sessions} people showed up. ${a.sessions_that_picked_a_faction} picked a side.${R}`);
console.log(`  ${B}The world had nothing to remember them with.${R}`);
console.log("");
console.log(`${D}  READ THIS NUMBER HONESTLY. A session id here is minted per visit and does${R}`);
console.log(`${D}  not survive a browser restart, so "${a.sessions_seen_again_after_12h} seen again" is NOT a return rate --${R}`);
console.log(`${D}  the true one is unknown. That is the finding, not a caveat: the product${R}`);
console.log(`${D}  could not tell a returning visitor from a new one, so it treated every${R}`);
console.log(`${D}  one of these ${a.sessions} people as though they had never been there.${R}`);
console.log(`${D}  Inspiral's canon is the part that would have known.${R}`);
console.log(`${D}──────────────────────────────────────────────────────────────────────${R}`);
console.log("");
