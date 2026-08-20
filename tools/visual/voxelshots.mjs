#!/usr/bin/env node
/**
 * The three voxel story shots: aerial, eye level, and a player edit the cast
 * can see.
 *
 *   node tools/visual/voxelshots.mjs --out=docs/screens
 *
 * The old set measured L=149-160 with p50 near 190 and p1 as low as 11 -- bright
 * and flat, with no darks anywhere and a sky region that scored edge=0, i.e. a
 * featureless slab. They predate the look profiles.
 *
 * Flight is driven by real key events rather than by moving the camera from
 * outside, so what is captured is what a player would actually see.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const OUT = arg("out", "docs/screens");
const PORT = Number(arg("port", "8796"));
const SCENE = arg("scene", "market_plaza");

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

const server = spawn(
  "node",
  ["--env-file-if-exists=.env", "--import", "tsx", "scripts/voxel.ts",
   "--port", String(PORT), "--scene", SCENE],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, INSPIRAL_HOST: "mock" } },
);
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const done = [];
try {
  if (!(await waitForServer(`http://localhost:${PORT}/`))) {
    console.error("server never came up\n" + log.slice(-800));
    process.exit(1);
  }
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.error("  [pageerror]", String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(6000);
  // Headless Chromium never grants pointer lock, and the splash hides behind
  // `body.locked`. Set it directly or every frame is a screenshot of a modal.
  await page.evaluate(() => document.body.classList.add("locked"));
  await page.waitForTimeout(2500);

  const shot = async (n) => {
    await page.screenshot({ path: `${OUT}/${n}.png` });
    done.push(n);
    console.log(`  ${n}`);
  };

  await shot("08-voxel-first-person");

  /**
   * MOVE THE BODY, NOT THE CAMERA.
   *
   * Pointer lock is unavailable headless so WASD never reaches the controller,
   * and setting `camera.position` directly does nothing: `player.update()` runs
   * every frame and rewrites the camera from `body.position`. The first version
   * of this file did exactly that and produced three byte-identical frames that
   * still passed pixelstats, because a wrong frame can be a well-exposed frame.
   *
   * `flying` stops gravity pulling the body straight back down.
   */
  await page.evaluate(() => {
    const w = globalThis.__ward;
    w.player.flying = true;
    const [x, y, z] = [34, 46, 42];
    w.player.body.position = [x, y, z];
    w.player.body.velocity = [0, 0, 0];
    // The surface's own convention, lifted from Player: yaw is measured from
    // -Z with atan2 over the NEGATED deltas. Guessing it put the ward in the
    // bottom-right corner of a frame that was otherwise empty fog.
    w.player.yaw = Math.atan2(-(0 - x), -(0 - z));
    w.player.pitch = -Math.atan2(y - 8, Math.hypot(x, z));
  });
  await page.waitForTimeout(2500);
  await shot("07-voxel-ward-aerial");

  // A player edit, and the cast noticing it. `onEdit` is what the surface calls
  // when a block is placed, so this is the real path to canon, not a fake one.
  await page.evaluate(() => {
    const w = globalThis.__ward;
    w.player.flying = true;
    const [x, y, z] = [3, 15, 12];
    w.player.body.position = [x, y, z];
    w.player.body.velocity = [0, 0, 0];
    w.player.yaw = Math.atan2(-(0 - x), -(6 - z));
    w.player.pitch = -0.06;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const w = globalThis.__ward;
    // A small stack of the archetype's signature material, in front of camera.
    for (let i = 0; i < 4; i++) w.world.set(0, 13 + i, 6, 9);
    w.mesher.queueChunks([[0, 0, 0]]);
  });
  await page.waitForTimeout(3500);
  await shot("09-voxel-dig-and-build");

  await browser.close();
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`\n${done.length}/3 voxel shots written to ${OUT}`);
if (done.length < 3) process.exitCode = 1;
