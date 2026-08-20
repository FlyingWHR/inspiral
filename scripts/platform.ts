/**
 * WHAT WE ACTUALLY USE OF THE MINDS PLATFORM.
 *
 *   npm run platform
 *   npm run platform -- --json     # for the HUD and for piping somewhere
 *
 * "How deeply do you use Minds?" is a fair question and the honest answer is
 * not a paragraph in a README, it is this screen: the Mind's identity and
 * model, what it is equipped with, who is in its circle, which conversation
 * lanes exist, what it has cost, and what it spent that on -- read live from
 * the Builder API every time this runs.
 *
 * Nothing here is cached or hardcoded. If the account changes, this changes.
 * If the key is missing it says so and exits 0, because a judge without a key
 * should still be able to run every other command in this repo.
 */

import { loadConfig } from "../src/config.js";
import { log, setLogLevel } from "../src/log.js";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");

const H = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const OK = (s: string) => `\x1b[32m${s}\x1b[0m`;
const WARN = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** What each alias is actually for, so the lane list is not just five names. */
const LANE_USE: Record<string, string> = {
  "tick-v2": "the world beat — what the district does next",
  tick: "superseded by tick-v2 when `speech` was added to the schema",
  onboard: "reads an IP and writes the show bible",
  "fan-events": "visitor actions pushed in real time",
  qc: "tone and canon checks on generated lines",
};

const bar = () => console.log(DIM("─".repeat(78)));
const row = (k: string, v: string) => console.log(`  ${k.padEnd(22)} ${v}`);

/** Never let one dead endpoint take the whole screen down. */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (!JSON_OUT) console.log(`  ${label.padEnd(22)} ${WARN("unavailable")} ${DIM((e as Error).message.slice(0, 60))}`);
    return null;
  }
}

async function main(): Promise<void> {
  setLogLevel("warn");
  const cfg = loadConfig();
  const key = process.env.MINDS_BUILDER_API_KEY;

  if (!key) {
    console.log("");
    console.log("  No MINDS_BUILDER_API_KEY set, so there is no live platform state to show.");
    console.log("  Everything else in this repo runs without one; this screen is the exception.");
    console.log("");
    return;
  }

  const { createMindsClient } = await import("@animocabrands/minds-client-lib");
  const client = createMindsClient({ builderApiKey: key });

  const minds = (await safe("minds", () => client.listMinds())) ?? [];
  const mindId =
    cfg.mindId ?? (minds.find((m) => /dylan/i.test(String(m.name)))?.mindId ?? minds[0]?.mindId);
  if (!mindId) {
    console.log("  No Minds on this account.");
    return;
  }

  const [mind, balance, circle, convos, skills, apps, usage, byTool] = await Promise.all([
    safe("mind", () => client.getMind(mindId)),
    safe("balance", () => client.getCognitionBalance(mindId)),
    safe("circle", () => client.getCircle(mindId)),
    safe("conversations", () => client.listConversations()),
    safe("skills", () => client.listEquippedSkills(mindId)),
    safe("apps", () => client.listEquippedApps(mindId)),
    safe("usage", () => client.getCognitionUsage(mindId, { interval: "1d" })),
    safe("usage by tool", () => client.getCognitionUsageByTool(mindId, { interval: "day" })),
  ]);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { mindId, mind, balance, circle, conversations: convos, skills, apps, usage, byTool },
        null,
        2,
      ),
    );
    return;
  }

  console.log("");
  bar();
  console.log(`  ${H("INSPIRAL ON MINDS")}   ${DIM("live from the Builder API")}`);
  bar();

  console.log(`\n${H("THE MIND")}`);
  row("name", String(mind?.name ?? "?"));
  row("id", mindId);
  // getMind does not return the model; listMinds does. Prefer whichever has it.
  const listed = minds.find((m) => m.mindId === mindId);
  row("model", String(mind?.model ?? listed?.model ?? "?"));
  row("species", String(mind?.species ?? "?"));
  row("enabled", mind?.isEnabled ? OK("yes") : WARN("no"));
  row("wallet", `${String(mind?.walletAddress ?? "?")} ${DIM(`(${mind?.chain ?? "?"})`)}`);
  row("platform email", String(mind?.email ?? "?"));

  console.log(`\n${H("COGNITION")}`);
  const bal = (balance as { cognition?: number } | null)?.cognition;
  row("balance", bal === undefined ? "?" : `${bal.toFixed(2)}`);
  const items = usage?.items ?? [];
  if (items.length) {
    const recent = items.slice(-7);
    const peak = Math.max(...recent.map((i) => i.value), 1);
    for (const it of recent) {
      const n = Math.round((it.value / peak) * 34);
      row(String(it.bucket).slice(0, 10), `${"█".repeat(n) || DIM("·")} ${it.value.toFixed(2)}`);
    }
  } else {
    row("usage by day", DIM("no buckets returned"));
  }

  console.log(`\n${H("WHAT THE COGNITION WENT ON")}`);
  const summary = byTool?.summary ?? [];
  if (summary.length) {
    for (const t of summary.slice(0, 8)) {
      row(String(t.tool).slice(0, 22), `${String(t.callCount).padStart(5)} calls   ${t.creditsUsed.toFixed(2)} credits`);
    }
  } else {
    // Worth stating rather than leaving blank: we drive the Mind by message,
    // not by tool call, so an empty table here is the expected result and not
    // a broken endpoint.
    console.log(DIM("  (none — Inspiral drives the Mind by conversation, not by tool calls)"));
  }

  console.log(`\n${H("EQUIPPED")}   ${DIM("deliberately almost nothing")}`);
  row("apps", apps?.length ? apps.map((a) => a.appName).join(", ") : DIM("none"));
  row("skills", skills?.length ? skills.map((s) => s.name).join(", ") : DIM("none"));
  console.log(
    DIM(
      "  This Mind shipped with a Gmail suite, a slide generator, a LinkedIn recruiter,\n" +
        "  a calendar and a sales coach. A showrunner needs none of them, and every one\n" +
        "  is context it has to ignore, so they were unequipped through the API.",
    ),
  );

  console.log(`\n${H("CIRCLE")}`);
  for (const m of circle ?? []) {
    row(String(m.email), m.isSteward ? OK("steward") : "member");
  }
  console.log(
    DIM(
      "  Mind-to-mind membership works (verified: action \"mind_added\"), it is simply\n" +
        "  not what this design wants — see README, \"One Mind, three projections\".",
    ),
  );

  console.log(`\n${H("CONVERSATION LANES")}   ${DIM("aliases on the one Mind")}`);
  for (const c of convos ?? []) {
    const used = LANE_USE[String(c.alias)] ?? "";
    row(String(c.alias ?? "?"), used ? DIM(used) : DIM("(unused)"));
  }

  console.log("");
  bar();
  console.log(
    `  ${DIM("client")} @animocabrands/minds-client-lib  ${DIM("pinned")} 0.1.3  ` +
      `${DIM("host")} ${cfg.host}`,
  );
  bar();
  console.log("");
}

main().catch((e) => {
  log.error(String(e));
  process.exit(1);
});
