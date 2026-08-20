#!/usr/bin/env node
/**
 * Reshoot the ward's story shots by DRIVING the app, not by staging it.
 *
 *   node tools/visual/wardshots.mjs --out=docs/screens
 *
 * Every frame here is the running application reacting to real clicks: arrive,
 * take a side in public, leave, come back and get recognised, mint a character
 * from pasted text. Nothing is composited and nothing is mocked up.
 *
 * It exists because an audit of the old set found all five ward shots were
 * technically weak -- 33-36% saturation against a 25 ceiling, and a negative
 * blue-minus-red in every region, meaning one light temperature everywhere.
 * They were captured before the sky was replaced. Reshooting by hand invites
 * the same drift next time; this way the set is reproducible.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const OUT = arg("out", "docs/screens");
const PORT = Number(arg("port", "8795"));
const W = Number(arg("width", "1600"));
const H = Number(arg("height", "900"));

const waitForServer = async (url, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

mkdirSync(OUT, { recursive: true });

// `--every 1` keeps the world ticking fast enough that a beat lands between
// clicks; the demo cadence is far slower and would make this take an hour.
const server = spawn(
  "node",
  ["--env-file-if-exists=.env", "--import", "tsx", "scripts/world.ts",
   "--port", String(PORT), "--every", "2"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, INSPIRAL_HOST: "mock" } },
);
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const shots = [];
try {
  if (!(await waitForServer(`http://localhost:${PORT}/`))) {
    console.error("server never came up\n" + log.slice(-800));
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => console.error("  [pageerror]", String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    shots.push(name);
    console.log(`  ${name}`);
  };
  const click = async (sel) => {
    const el = await page.$(sel);
    if (!el) throw new Error(`no such control: ${sel}`);
    if (await el.isDisabled()) throw new Error(`control disabled: ${sel}`);
    await el.click();
  };
  const settle = (ms) => page.waitForTimeout(ms);

  // Assets are ~2 MB of GLB; the establishing shot is worthless without them.
  await settle(9000);
  await shot("01-ward-establishing");

  await click("#btn-arrive");
  await settle(7000);
  await shot("02-characters-speaking");

  // Take a side in public, leave, let the world run WITHOUT you, come back.
  // That round trip is the entire pitch, so it is worth the wall-clock -- and
  // the away leg has to be long enough to matter. At the demo cadence of one
  // tick every 2s, 30s away is fifteen beats the visitor was not present for.
  // The first version of this waited 9s, i.e. one tick, and the returning
  // greeting had nothing to cite: the shot came back without the receipt,
  // which is the one thing it exists to show.
  await click("#btn-side");
  await settle(6000);
  await click("#btn-leave");
  await settle(24000);
  await click("#btn-arrive");

  /**
   * DO NOT RACE AN AMBIENT WORLD.
   *
   * This is the money shot: a returning visitor recognised, and the claim
   * checked against the append-only log on screen, live. Three attempts at
   * timing it with a fixed delay produced, in order: the right beat with no
   * receipt, an empty plaza because the bubble had already faded, and a
   * completely unrelated character spreading a rumour. The world keeps moving
   * whatever the screenshotter is doing.
   *
   * So wait for the thing itself. `.cite` is the element that renders the
   * resolved event id; when one is on screen, the frame is worth taking.
   */
  await page.waitForSelector(".cite", { timeout: 90000 });
  await shot("03-citation-resolved");

  await click("#btn-mint");
  await settle(1200);
  await shot("04-mint-paste-a-sheet");

  await click("#mint-go");
  await settle(8000);
  await shot("05-minted-npc-in-world");

  await browser.close();
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`\n${shots.length}/5 ward shots written to ${OUT}`);
if (shots.length < 5) process.exitCode = 1;
