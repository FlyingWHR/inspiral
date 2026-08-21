#!/usr/bin/env node
/**
 * Render the SAME frame under every art direction, so the choice can be made by
 * looking rather than by describing.
 *
 *   node tools/visual/directions.mjs --out=docs/screens/directions
 *   node tools/visual/directions.mjs --scene=tavern --only=hearth,lantern
 *
 * Identical camera, identical scene, identical seed. The only variable is the
 * direction, which is the point: anything else and the comparison is worthless.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { DIRECTION_IDS, DIRECTIONS } from "../../web-voxel/scene/direction.js";

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const OUT = arg("out", "docs/screens/directions");
const SCENE = arg("scene", "tavern");
const ONLY = arg("only", "");
const PORT = Number(arg("port", "8797"));

const dirs = ONLY ? ONLY.split(",").map((s) => s.trim()).filter(Boolean) : DIRECTION_IDS;

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

/**
 * The hero camera. Chosen, not defaulted.
 *
 * Diagonally across the room from the door corner toward the bar, high enough
 * to look slightly down. The first attempt sat at eye level in the middle of
 * the floor and produced the two classic mistakes at once: a ceiling beam
 * running dead across the frame at the horizon line, and the top third given
 * over to blank ceiling. Looking down the diagonal puts tables in the
 * foreground, the cast in the middle and the lit bar at the back -- three
 * depth layers instead of one wall.
 */
/**
 * Floor is y=13 and the ceiling beams sit at y=17, so the eye has to be between
 * them: at 16.6 the camera was level with a beam and the "room" was one brown
 * slab across the lens. 15.2 is standing eye height in this room.
 */
const HERO = { pos: [-12.5, 15.2, -9.5], look: [7, 9], pitch: -0.09 };

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

  for (const dir of dirs) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => { errs.push(String(e)); console.error(`  [${dir}] ${String(e).slice(0, 220)}`); });
    page.on("console", (m) => { if (m.type() === "error") console.error(`  [${dir}] ${m.text().slice(0, 200)}`); });
    await page.goto(`http://localhost:${PORT}/?dir=${dir}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(7000);
    await page.evaluate(() => document.body.classList.add("locked"));

    // Move the BODY: player.update() rewrites the camera from it every frame,
    // so setting camera.position directly is silently discarded.
    await page.evaluate((H) => {
      const w = globalThis.__ward;
      w.player.flying = true;
      w.player.body.position = H.pos;
      w.player.body.velocity = [0, 0, 0];
      w.player.yaw = Math.atan2(-(H.look[0] - H.pos[0]), -(H.look[1] - H.pos[2]));
      w.player.pitch = H.pitch;
    }, HERO);
    await page.waitForTimeout(3000);

    if (errs.length) console.error(`  ${dir}: ${errs[0].slice(0, 180)}`);
    await page.screenshot({ path: `${OUT}/${dir}.png` });
    await page.close();
    done.push(dir);
    console.log(`  ${dir.padEnd(9)} ${DIRECTIONS[dir]?.label ?? ""}`);
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`\n${done.length}/${dirs.length} directions written to ${OUT}`);
if (done.length < dirs.length) process.exitCode = 1;
