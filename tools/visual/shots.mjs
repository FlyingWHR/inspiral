#!/usr/bin/env node
/**
 * Render every scene archetype and write one PNG each, so the look profiles can
 * be MEASURED instead of admired.
 *
 *   node tools/visual/shots.mjs --out=docs/screens/looks
 *   node tools/visual/shots.mjs --out=/tmp/x --only=tavern,studio
 *
 * Then:  node tools/visual/pixelstats.mjs docs/screens/looks
 *
 * This exists because of a specific, expensive mistake: a "visual improvement"
 * was shipped, screenshotted and reported as better when 20.6% of its pixels
 * were blown to white. Nobody looked at a histogram. Now the histogram is one
 * command and it runs on every archetype at once.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { LOOK_IDS } from "../../web-voxel/scene/looks.js";

const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const OUT = arg("out", "docs/screens/looks");
const ONLY = arg("only", "");
const PORT = Number(arg("port", "8799"));
const WIDTH = Number(arg("width", "1600"));
const HEIGHT = Number(arg("height", "900"));
/** Long enough for chunk meshing and the GLB characters to land. */
const SETTLE = Number(arg("settle", "4500"));

const scenes = ONLY ? ONLY.split(",").map((s) => s.trim()).filter(Boolean) : LOOK_IDS;

/**
 * A COMPOSED CAMERA PER ARCHETYPE.
 *
 * These used to shoot from the player's spawn, which is a gameplay position and
 * not a photograph. The measurable consequence was "NO ACCENT" on all eight
 * frames while the accent materials were sitting in the world a few metres out
 * of shot -- the hero frame from the same tavern, composed by hand, measured
 * 3.2% hot area against this camera's 1.4%.
 *
 * Interiors look down a diagonal from a corner: foreground furniture, cast in
 * the middle, the lit and accented wall behind. Exteriors sit high and off to
 * one side so the ground plane reads as a plane and the roofline as an edge
 * against the backdrop.
 *
 * `look` is [x, z]; yaw is derived with the surface's own convention.
 */
const CAMERAS = {
  tavern:          { pos: [-12.5, 15.2, -9.5], look: [7, 9],   pitch: -0.09 },
  council_chamber: { pos: [-12.0, 15.6, -10.0], look: [6, 8],  pitch: -0.10 },
  ballroom:        { pos: [-13.0, 15.6, -10.0], look: [7, 8],  pitch: -0.10 },
  studio:          { pos: [-11.0, 15.2, -9.0],  look: [6, 7],  pitch: -0.07 },
  training_hall:   { pos: [-12.0, 15.4, -10.0], look: [6, 8],  pitch: -0.09 },
  cafe:            { pos: [-10.5, 15.0, -8.5],  look: [5, 7],  pitch: -0.07 },
  market_plaza:    { pos: [22, 24, 26],  look: [0, 0], pitch: -0.42 },
  arena:           { pos: [24, 26, 28],  look: [0, 0], pitch: -0.45 },
};
const DEFAULT_CAM = { pos: [18, 22, 22], look: [0, 0], pitch: -0.40 };

/** Wait for the dev server to answer rather than sleeping a guessed interval. */
async function waitForServer(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function shoot(browser, scene) {
  const server = spawn(
    "node",
    ["--env-file-if-exists=.env", "--import", "tsx", "scripts/voxel.ts",
     "--port", String(PORT), "--scene", scene],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));

  try {
    if (!(await waitForServer(`http://localhost:${PORT}/`))) {
      console.error(`  ${scene}: server never came up\n${log.slice(-600)}`);
      return false;
    }
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(SETTLE);
  // The splash is hidden by `body.locked`, which real pointer lock sets. Headless
  // Chromium will not grant pointer lock, so every frame we measured had a dark
  // modal over it. Set the class directly instead of clicking.
  await page.evaluate(() => document.body.classList.add("locked"));
    await page.waitForTimeout(600);

    // A black frame usually means the module graph threw before first render;
    // say so loudly rather than writing a black PNG and calling it a look.
    if (errors.length) console.error(`  ${scene}: page errors -> ${errors[0].slice(0, 160)}`);

    const cam = CAMERAS[scene] ?? DEFAULT_CAM;
    await page.evaluate((C) => {
      const w = globalThis.__ward;
      // Move the body, not the camera: player.update() rewrites the camera from
      // body.position every frame and discards anything set directly.
      w.player.flying = true;
      w.player.body.position = C.pos;
      w.player.body.velocity = [0, 0, 0];
      w.player.yaw = Math.atan2(-(C.look[0] - C.pos[0]), -(C.look[1] - C.pos[2]));
      w.player.pitch = C.pitch;
    }, cam);
    await page.waitForTimeout(2600);

    await page.screenshot({ path: `${OUT}/${scene}.png` });
    await page.close();
    return true;
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 350));
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  // WebGL in headless Chromium needs a real GL path; SwiftShader is the one that
  // works everywhere and its output is deterministic, which matters when the
  // whole point is comparing numbers between runs.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let ok = 0;
for (const scene of scenes) {
  process.stdout.write(`  shooting ${scene} ... `);
  const good = await shoot(browser, scene);
  console.log(good ? "ok" : "FAILED");
  if (good) ok++;
}
await browser.close();
console.log(`\n${ok}/${scenes.length} written to ${OUT}`);
if (ok < scenes.length) process.exitCode = 1;
