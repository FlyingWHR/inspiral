#!/usr/bin/env node
/**
 * Reshoot the chat-surface still, legibly.
 *
 *   node tools/visual/chatshot.mjs --out=docs/screens
 *
 * The old `06-chat-surface-same-canon.png` measured L=21.6 with the shadows
 * crushed. That is unremarkable for a terminal and fatal for a projector: in a
 * bright room the whole frame goes to black and the one thing it exists to
 * prove -- the same event id, resolved on a second surface -- is invisible.
 *
 * This drives `npm run chat --solo`, captures its REAL output, strips the ANSI
 * and lays it out on a light page. Nothing is retyped or mocked up; the text on
 * screen is the text the process printed. The `✓ evt_...` receipts are picked
 * out because they are the point of the shot.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const OUT = arg("out", "docs/screens");
const TMP = arg("tmp", "/tmp");

mkdirSync(OUT, { recursive: true });

/**
 * Drive the solo chat surface through the round trip the film shows, with the
 * delays the world actually needs: the away leg has to span several ticks or
 * the returning greeting has nothing to cite.
 */
const script = [
  [1500, "/visit"],
  [4000, "/side backed Okonkwo against Vance in front of the whole ward"],
  [7500, "/leave"],
  [24000, "/visit"],
  [32000, "/quit"],
];

const out = await new Promise((resolve) => {
  const p = spawn("node", ["--env-file-if-exists=.env", "--import", "tsx", "scripts/chat.ts", "--solo"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, INSPIRAL_HOST: "mock", NO_COLOR: "1" },
  });
  let buf = "";
  p.stdout.on("data", (d) => (buf += d));
  p.stderr.on("data", (d) => (buf += d));
  for (const [at, cmd] of script) setTimeout(() => p.stdin.write(cmd + "\n"), at);
  p.on("close", () => resolve(buf));
  setTimeout(() => { try { p.kill(); } catch {} resolve(buf); }, 36000);
});

// eslint-disable-next-line no-control-regex
const clean = out.replace(/\[[0-9;]*m/g, "").split("\n").filter((l) => l.trim() !== "");
/**
 * Prefer a window that actually contains a receipt. The whole point of this
 * still is one event id resolved on a second surface, and the tail of the log
 * is not guaranteed to hold one.
 */
const lastCite = clean.map((l, i) => (/\bevt_/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
const end = lastCite === undefined ? clean.length : Math.min(clean.length, lastCite + 6);
const body = clean.slice(Math.max(0, end - 34), end);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#f4f1ea;}
  .wrap{padding:34px 40px;font:14px/1.62 ui-monospace,SFMono-Regular,Menlo,monospace;color:#2a2622;}
  h1{font:600 15px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;
     color:#7a6f60;margin:0 0 4px;}
  .sub{color:#9a8f7e;font-size:12px;margin:0 0 22px;}
  .line{white-space:pre-wrap;}
  .cite{color:#1d6b3f;font-weight:600;}
  .who{color:#a04a1e;font-weight:600;}
</style><div class="wrap">
<h1>npm run chat &mdash; the same world, as text</h1>
<p class="sub">Same canon, same cast, same event ids. No engine, no GPU.</p>
${body
  .map((l) => {
    const e = esc(l);
    if (/\bevt_/.test(l)) return `<div class="line cite">${e}</div>`;
    if (/^\s*[A-Z][A-Za-z' ]+ —/.test(l)) return `<div class="line who">${e}</div>`;
    return `<div class="line">${e}</div>`;
  })
  .join("\n")}
</div>`;

const page404 = `${TMP}/chatshot.html`;
writeFileSync(page404, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("file://" + page404, { waitUntil: "load" });
await page.screenshot({ path: `${OUT}/06-chat-surface-same-canon.png` });
await browser.close();

const cites = clean.filter((l) => /evt_/.test(l)).length;
console.log(`  06-chat-surface-same-canon  (${clean.length} lines captured, ${cites} carrying an event id)`);
if (cites === 0) {
  console.error("  WARNING: no event id in the capture -- the shot exists to show one.");
  process.exitCode = 1;
}
