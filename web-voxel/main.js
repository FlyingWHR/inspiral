/**
 * The voxel ward. Same simulation, same beat protocol, same canon -- a third
 * surface, where the world is real voxel data the player can dig and build.
 *
 * The renderer knows nothing about drama and the simulation knows nothing about
 * voxels. Beats arrive over the socket and get staged; player edits go back the
 * other way as intents and become canon events.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import { VoxelWorld } from "./voxel/chunk.js";
import { BLOCKS, BLOCK_NAMES, setBlockColors, colorOf, nameOf } from "./voxel/blocks.js";
import { generateScene, clearPlaces } from "./scene/generate.js";
import { getArchetype } from "./scene/archetypes.js";
import { getLook } from "./scene/looks.js";
import { createSkyDome, applySkyLook } from "./scene/skydome.js";
import { GradeShader, applyGrade } from "./scene/grade.js";
import { getDirection } from "./scene/direction.js";
import { blockColorsFor, backdropFor, voidFor, slotsFor } from "./scene/palette.js";
import { voxelMaterial, makeDust, driftDust, makeShaft } from "./scene/stylise.js";
import { ChunkMesher } from "./chunkmesh.js";
import { Player } from "./player.js";
import { paletteFor } from "./scene/palettes.js";
import { findPath, standable, groundAt } from "./voxel/pathfind.js";

const CHARS = "/assets/characters/";
const BODY = {
  vance: "character-female-b.glb",
  okonkwo: "character-male-c.glb",
  quill: "character-female-e.glb",
  _visitor: "character-male-a.glb",
};
const SPARE = ["character-female-a.glb", "character-male-b.glb",
               "character-female-c.glb", "character-male-d.glb"];
const PERSON_H = 1.8;
const WALK_SPEED = 2.4;

// Which scene this world opens in is decided at onboard time and served here.
// This has to happen before ANYTHING reads ARCH -- the lighting and the sky do.
const SCENE = await fetch("/scene.json")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const ARCH = getArchetype(SCENE?.archetype);
const PLACES = SCENE?.places ?? ARCH.places;

// --- scene -------------------------------------------------------------------

const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/**
 * THE LOOK. Everything about how this world is lit, coloured and graded comes
 * from one profile chosen by archetype -- see scene/looks.js. A tavern and a
 * council chamber run identical code and do not look remotely alike, which is
 * the point: it is the "it learns your IP" claim made visible in one frame.
 *
 * `?look=tavern` forces a profile regardless of scene, for shooting comparisons.
 */
const QS = new URLSearchParams(location.search);
const LOOK = getLook(QS.get("look") ?? ARCH.id);
/**
 * The art direction, on top of the look. The look says what the light is doing
 * in this room; the direction says what kind of picture we are making at all.
 */
const DIR = getDirection(QS.get("dir"));
/**
 * `?fx=0` renders the palette raw: no dust, no shaft, no bloom, no depth of
 * field, no grade. Used to answer "is the palette reaching the frame, or is the
 * post stack eating it" without guessing which pass is responsible.
 */
const FX = QS.get("fx") !== "0";
const BACKDROP_FOG = backdropFor(ARCH.id);
/**
 * LIGHT GAIN, and why it exists.
 *
 * Every intensity in looks.js was tuned while the mesher was writing sRGB bytes
 * into a linear vertex-colour attribute, i.e. against surfaces that were
 * rendering roughly half a stop too bright. Fixing that conversion was correct
 * and immediately cost the top of the value ladder: frame spread fell from
 * 0.413 to 0.302 and the brightest mass centre from 0.69 to 0.59.
 *
 * So the intensities are re-scaled once, here, rather than re-tuned eight times
 * in the profiles. With NoToneMapping there is no exposure control to reach
 * for -- toneMappingExposure is only consulted by a tone-mapping function -- so
 * the light itself has to carry it.
 *
 * 2.6 was chosen by sweep, not by eye. It is the largest value that still
 * clears the exposure floor: at 2.6 the tavern hero measures 0.277% blown, at
 * 3.1 it measures 0.638% and fails the under-0.5% bar for another 0.037 of
 * value spread. Not worth it.
 */
const GAIN = Number(QS.get("gain") ?? "2.6");
/**
 * How much of the light budget the COOL FILL gets, against the warm key.
 *
 * Warm key plus cool fill is the structure the palette is written for, but the
 * two are complementary, so an over-strong fill cancels chroma instead of
 * counterpointing it: at full strength the frame gained hue variety (arc95 46
 * -> 271 degrees) and lost both value and accent (spread 0.491 -> 0.370, hot
 * area 5.2% -> 1.0%). The fill has to be present and subordinate.
 */
const FILL = Number(QS.get("fill") ?? "1.0");
/**
 * How far the fill is pulled toward white. The cool counterpoint belongs in the
 * GEOMETRY -- glazing, backdrop, accentCool glass -- not in the fill light,
 * which mixes complementary with the warm key and turns both to mud.
 */
const FILL_WHITE = Number(QS.get("fillwhite") ?? "0.7");

/**
 * Take the slot's HUE, not its brightness. A palette slot is a surface colour;
 * a light's colour also carries how much energy it delivers, and Emberlight's
 * backdrop is #1d2d4c at L=0.30 -- used directly as a hemisphere light it made
 * the room darker than the version with no cool fill at all (frame spread fell
 * to 0.354). Scaling the brightest channel up to near-full keeps the night-blue
 * hue and restores the power.
 */
const litHue = (hex, top = 0.92) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const k = (255 * top) / Math.max(r, g, b, 1);
  const c = (v) => Math.min(255, Math.round(v * k));
  return (c(r) << 16) | (c(g) << 8) | c(b);
};

/**
 * NO TONE MAPPING BY DEFAULT, which reverses an earlier decision.
 *
 * ACES desaturates and rolls off highlights. That was right when a physical sky
 * was blowing the frame out; it is wrong against an authored flat-colour
 * palette, because it pulls every block away from the hex it was authored as.
 * The study says try NoToneMapping first and only add HDR headroom back if the
 * emissives need it. `?tone=aces` puts it back for comparison.
 */
renderer.toneMapping =
  QS.get("tone") === "aces" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
renderer.toneMappingExposure = LOOK.exposure;

const scene = new THREE.Scene();
// FogExp2, and the colour comes from the look rather than from the sky, so an
// interior can have close brown air while an outdoor scene has pale blue depth.
// Fog toward the backdrop, not toward a hand-picked colour: anything else puts
// a third value between the scene and the sky and softens the silhouette edge
// the roofline is supposed to make.
scene.fog = new THREE.FogExp2(BACKDROP_FOG, LOOK.fog.density);

const camera = new THREE.PerspectiveCamera(74, 1, 0.08, 400);
const labels = new CSS2DRenderer({ element: document.getElementById("labels") });

// Sun direction from the profile's own elevation/azimuth. Interiors keep a sun
// because a shaft through a window is what makes a room feel like it has an
// outside; they just turn its intensity and its visible disc down.
const sunDir = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - LOOK.sun.elevation),
  THREE.MathUtils.degToRad(LOOK.sun.azimuth),
);

const skydome = createSkyDome(320);
/**
 * The sky is the palette's BACKDROP -- the one slot the ladder deliberately
 * leaves free, because it has to be chosen against the lit top planes rather
 * than fixed in advance. The dome's underside takes VOID so the horizon falls
 * away into the darkest tier instead of into a second sky.
 */
const BACKDROP = backdropFor(ARCH.id);
const VOIDC = voidFor(ARCH.id);
applySkyLook(
  skydome,
  { ...LOOK.sky, zenith: BACKDROP, horizon: BACKDROP, ground: VOIDC },
  sunDir,
);
scene.add(skydome);

// The key is the palette's emissive -- the fire indoors, the sun outdoors.
const sun = new THREE.DirectionalLight(litHue(slotsFor(ARCH.id).emissive), LOOK.sun.intensity * GAIN);
sun.position.copy(sunDir).multiplyScalar(110);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = LOOK.sun.shadowRadius;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.06;
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 260;
scene.add(sun, sun.target);

/**
 * LIGHT COLOUR COMES FROM THE PALETTE, NOT FROM THE LOOK.
 *
 * The look profiles keep intensity, angle and falloff -- how MUCH light, from
 * where. Hue is the palette's job, and letting both own it is what produced two
 * failed rounds: first the old orange ambient overwrote the new cool materials
 * and nothing changed, then neutralising every light to near-white removed the
 * cool fill and the room went back to a warm wash.
 *
 * Emberlight Tavern is specified as "warm key against cool night through
 * glazing". That is not a lighting accident to be recovered by eye; it is two
 * slots. The fill is BACKDROP -- literally the night sky leaking in -- and the
 * bounce off the floor is groundA. Both are already inside the palette's chroma
 * budget, so this cannot reintroduce the collapse.
 */
const toWhite = (hex, k) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const m = (c) => Math.round(c + (255 - c) * k);
  return (m(r) << 16) | (m(g) << 8) | m(b);
};
const fillSky = toWhite(litHue(backdropFor(ARCH.id)), FILL_WHITE);
const fillGround = litHue(slotsFor(ARCH.id).groundA, 0.55);
scene.add(new THREE.HemisphereLight(fillSky, fillGround, LOOK.hemi.intensity * GAIN * FILL));
scene.add(new THREE.AmbientLight(fillSky, LOOK.ambient.intensity * GAIN * FILL));

/**
 * Practicals: the fire in the tavern, the chandelier in the ballroom, the ring
 * light in the studio. A roof blocks the sun, so an enclosed scene without
 * these reads as a cave.
 *
 * The count is FIXED whether or not they flicker. three bakes the number of
 * visible lights into every material's shader permutation key, so a practical
 * that switches `visible` off recompiles the whole scene mid-frame. Flicker
 * drives INTENSITY and leaves visibility alone.
 */
let flickerT = 0;
const practicals = [];
if (LOOK.practicals) {
  const P = LOOK.practicals;
  for (const [x, y, z] of [[0, 15, 0], [-14, 9, -10], [14, 9, 10]]) {
    const l = new THREE.PointLight(litHue(slotsFor(ARCH.id).emissive), P.intensity * GAIN, P.distance, 2);
    l.position.set(x, y, z);
    l.userData.baseIntensity = P.intensity * GAIN;
    scene.add(l);
    practicals.push(l);
  }
}

/**
 * Rim light: a dim, cool light from behind the camera's subject. It costs one
 * directional light and it is what stops a character melting into the wall
 * behind them -- the cheapest legibility win available in a dark interior.
 */
if (DIR.rim) {
  const rim = new THREE.DirectionalLight(DIR.rim.color, DIR.rim.intensity);
  rim.position.copy(sunDir).multiplyScalar(-60).setY(28);
  scene.add(rim);
}

// Air. Dust first, then the shaft it hangs in.
const dust = FX && DIR.dust ? makeDust(DIR.dust.count) : null;
if (dust) {
  dust.material.opacity = DIR.dust.opacity;
  scene.add(dust);
}
if (FX && DIR.shaft && ARCH.indoor) {
  scene.add(
    makeShaft({
      from: [15, 19, 4],
      to: [-2, 13, -2],
      width: DIR.shaft.width,
      opacity: DIR.shaft.opacity,
      /**
       * COOL, deliberately, whatever the room's sun is.
       *
       * The shaft was taking the look's sun colour, which in a tavern is warm,
       * so the one element that exists to give the frame a second temperature
       * came out the same orange as everything else. Daylight through a window
       * is cold next to firelight; that contrast is the whole reason the window
       * is in the build list.
       */
      color: 0xbfd8ff,
    }),
  );
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
let gtao = null;
if (!location.search.includes("ao=0")) {
  try {
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.8;
    composer.addPass(gtao);
  } catch (e) { console.warn("GTAO off:", e); }
}
/**
 * Bloom, which wrecked the frames once before. That failure was a physical sky
 * brighter than any threshold, so bloom smeared it over everything; the sky is
 * a gradient dome now and these are interiors. The threshold is high enough
 * that only genuinely emissive blocks -- lanterns, the fire, bottles -- cross
 * it. If blown% climbs in pixelstats, this is the first thing to suspect.
 */
if (FX && DIR.bloom) {
  const b = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    DIR.bloom.strength, DIR.bloom.radius, DIR.bloom.threshold,
  );
  composer.addPass(b);
}
if (FX && DIR.dof) {
  composer.addPass(new BokehPass(scene, camera, {
    focus: DIR.dof.focus, aperture: DIR.dof.aperture, maxblur: DIR.dof.maxblur,
  }));
}
composer.addPass(new OutputPass());
// The grade runs AFTER OutputPass, i.e. after tone mapping and the colour-space
// conversion, so what it adjusts is what pixelstats measures.
const gradePass = new ShaderPass(GradeShader);
// The direction's grade wins where it speaks: a direction that did not also
// own the grade would be fighting the look profile for the same knobs.
applyGrade(gradePass, { ...LOOK.grade, ...(DIR.grade ?? {}) });
if (FX && !location.search.includes("grade=0")) composer.addPass(gradePass);

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h); labels.setSize(w, h);
  gtao?.setSize(w, h);
}
addEventListener("resize", resize);
resize();

// --- the world ---------------------------------------------------------------

const world = new VoxelWorld();
/**
 * RE-SKIN FIRST. The mesher bakes colours into vertex attributes, so the block
 * table has to carry the palette before a single chunk is built.
 */
setBlockColors(blockColorsFor(ARCH.id, BLOCK_NAMES));

generateScene(world, ARCH.id, { seed: 1 });
clearPlaces(world, ARCH.id);

const mesher = new ChunkMesher(world, scene, voxelMaterial(DIR));
mesher.queueDirty();

/**
 * The build palette is the archetype's, not one global list. Constraint as a
 * creativity aid: whatever a visitor puts down is on-theme by construction.
 */
const BUILD = paletteFor(ARCH.id);
const BUILD_BLOCKS = BUILD.blocks.map((n) => BLOCKS.findIndex((b) => b.name === n)).filter((i) => i > 0);
const player = new Player(world, camera, canvas, { onEdit, palette: BUILD_BLOCKS });
player.spawnAt(ARCH.spawn.x, ARCH.spawn.z, [0, 0]); // walk in facing the middle
scene.add(player.highlight);

// --- hotbar ------------------------------------------------------------------

const bar = document.getElementById("bar");
BUILD_BLOCKS.forEach((id, i) => {
  const el = document.createElement("div");
  el.className = "slot";
  el.style.background = "#" + colorOf(id).toString(16).padStart(6, "0");
  el.textContent = nameOf(id);
  el.dataset.id = String(id);
  bar.append(el);
});
function paintBar() {
  [...bar.children].forEach((el) =>
    el.classList.toggle("on", Number(el.dataset.id) === player.held));
}
paintBar();

// --- actors ------------------------------------------------------------------

const loader = new GLTFLoader();
const cache = new Map();
const load = (u) => cache.get(u) ?? cache.set(u, loader.loadAsync(u)).get(u);
const actors = new Map();
const sizeOf = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

function bodyFor(id, kind) {
  if (BODY[id]) return BODY[id];
  if (kind === "visitor") return BODY._visitor;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SPARE[h % SPARE.length];
}

/**
 * The floor at x,z -- the one a body can stand on, which in a roofed scene is
 * not the highest solid voxel. Standing the cast on the roof was exactly the
 * bug this avoids.
 */
function groundY(x, z) {
  const stand = groundAt(world, Math.floor(x), Math.floor(z), 13, 24);
  if (stand !== null) return stand;
  const y = world.heightAt(Math.floor(x), Math.floor(z));
  return y === null ? 16 : y + 1;
}

async function addActor({ id, name, kind, title }, at) {
  if (actors.has(id)) return actors.get(id);
  const gltf = await load(CHARS + bodyFor(id, kind));
  const root = cloneSkinned(gltf.scene);
  const fit = PERSON_H / Math.max(sizeOf(root).y, 0.001);
  root.scale.setScalar(fit);
  root.position.set(at.x + 0.5, groundY(at.x, at.z), at.z + 0.5);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = mixer.clipAction(c);

  const plate = document.createElement("div");
  plate.className = "plate" + (kind === "visitor" ? " visitor" : "");
  plate.innerHTML = `<div class="nm"></div><div class="ti"></div>`;
  plate.querySelector(".nm").textContent = name;
  plate.querySelector(".ti").textContent = title ?? "";
  const plateObj = new CSS2DObject(plate);
  plateObj.position.y = (PERSON_H + 0.35) / fit;
  root.add(plateObj);

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "bubble";
  const bubble = new CSS2DObject(bubbleEl);
  bubble.position.y = (PERSON_H + 0.95) / fit;
  bubble.visible = false;
  root.add(bubble);

  const a = { id, name, root, mixer, clips, plate, bubbleEl, bubble,
              home: { ...at }, path: null, current: null };
  actors.set(id, a);
  play(a, "idle");
  return a;
}

function play(a, want, once = false) {
  const next = a.clips[want] ?? a.clips.idle;
  if (!next || next === a.current) return;
  next.reset();
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  next.clampWhenFinished = once;
  next.fadeIn(0.25).play();
  a.current?.fadeOut(0.25);
  a.current = next;
}

/**
 * Hold the world on the current line. The citation is the payoff and a live
 * tick does not leave a viewer long enough to read it. Press P, or call
 * __ward.pause() from a console.
 */
let paused = false;
const idle = () => new Promise((r) => setTimeout(r, 90));
const wait = async (ms) => {
  await new Promise((r) => setTimeout(r, ms));
  while (paused) await idle();
};
addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") paused = !paused;
});

function face(a, x, z) {
  const dx = x - a.root.position.x, dz = z - a.root.position.z;
  if (dx * dx + dz * dz > 1e-4) a.root.rotation.y = Math.atan2(dx, dz);
}

/**
 * Walk to a spot, routing around whatever the player has built or dug. A* runs
 * on the voxel surface; if there is genuinely no route it gives up rather than
 * walking through a wall.
 */
function walk(a, tx, tz) {
  return new Promise((done) => {
    a.dest = [Math.floor(tx), Math.floor(tz)];
    a.stuckFor = 0;
    if (!replan(a)) { play(a, "idle"); done(); return; }
    a.pathDone = done;
    play(a, "walk");
  });
}

/** Recompute the route from wherever they are standing now. */
function replan(a) {
  if (!a.dest) return false;
  const from = [
    Math.floor(a.root.position.x),
    Math.floor(a.root.position.y),
    Math.floor(a.root.position.z),
  ];
  const path = findPath(world, from, a.dest, 900);
  if (!path || path.length === 0) return false;
  a.path = path;
  return true;
}

/** Give up gracefully: stop, stand still, let the beat continue. */
function abandon(a) {
  a.path = null;
  a.dest = null;
  play(a, "idle");
  const done = a.pathDone;
  a.pathDone = null;
  done?.();
}

/**
 * Wall someone in mid-stride and they should notice. Called when the player
 * edits blocks, and periodically while walking in case they are wedged.
 */
function repathAll() {
  for (const a of actors.values()) {
    if (a.path) a.pathDirty = true;
  }
}

function stepActors(dt) {
  for (const a of actors.values()) {
    a.mixer.update(dt);
    if (!a.path) continue;

    // The route was valid when it was planned; the player may have changed the
    // world since. Re-plan when told to, or when the next step has become solid.
    const next = a.path[0];
    const blocked = next && !standable(world, next[0], next[1], next[2]);
    if (a.pathDirty || blocked) {
      a.pathDirty = false;
      if (!replan(a)) { abandon(a); continue; }
    }

    // Making no headway for a couple of seconds means wedged, not slow.
    a.stuckFor = (a.stuckFor ?? 0) + dt;
    if (a.lastX === undefined) { a.lastX = a.root.position.x; a.lastZ = a.root.position.z; }
    if (Math.hypot(a.root.position.x - a.lastX, a.root.position.z - a.lastZ) > 0.25) {
      a.stuckFor = 0;
      a.lastX = a.root.position.x;
      a.lastZ = a.root.position.z;
    } else if (a.stuckFor > 2.5) {
      a.stuckFor = 0;
      if (!replan(a)) { abandon(a); continue; }
    }

    const node = a.path[0];
    const tx = node[0] + 0.5, ty = node[1], tz = node[2] + 0.5;
    const p = a.root.position;
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.16) {
      p.set(tx, ty, tz);
      a.path.shift();
      if (a.path.length === 0) {
        a.path = null;
        a.dest = null;
        play(a, "idle");
        a.pathDone?.();
        a.pathDone = null;
      }
      continue;
    }
    face(a, tx, tz);
    const s = Math.min(WALK_SPEED * dt, d);
    p.x += (dx / d) * s;
    p.z += (dz / d) * s;
    p.y += (ty - p.y) * Math.min(1, dt * 9); // ease up and down steps
  }
}

async function speak(a, lines, verb, detail) {
  a.bubbleEl.innerHTML = "";
  const v = document.createElement("span");
  v.className = "verb";
  // The name lives in the bubble while they speak, because the nameplate is
  // directly behind it and loses.
  v.textContent = `${a.name} — ${verb.replace(/_/g, " ")}`;
  a.bubbleEl.append(v);
  a.plate.classList.add("muted");
  const body = document.createElement("span");
  a.bubbleEl.append(body);
  a.bubble.visible = true;
  a.bubbleEl.classList.add("on");
  for (const line of lines) {
    body.textContent = line;
    await wait(Math.min(4200, 1300 + line.length * 34));
  }
  for (const d of detail ?? []) {
    const c = document.createElement("span");
    c.className = "cite" + (d.ok ? "" : " bad");
    c.textContent = `${d.ok ? "✓" : "✗"} ${d.id} — ${d.summary}`;
    a.bubbleEl.append(c);
  }
  if (detail?.length) await wait(5200);
  a.bubbleEl.classList.remove("on");
  a.plate.classList.remove("muted");
  await wait(200);
  a.bubble.visible = false;
}

// --- HUD ---------------------------------------------------------------------

document.querySelector("#hud h1").textContent = ARCH.name ?? "Tallow Ward";
document.title = `Inspiral — ${ARCH.name ?? "Tallow Ward"}`;
/**
 * The build brief. One line, no score, no completion state -- the point is to
 * turn a blank hotbar into a suggestion, and the only reward is that the cast
 * reacts to what you actually put down.
 */
document.getElementById("splash-brief").textContent = BUILD.prompt;
document.getElementById("brief").innerHTML =
  "<b>The ward could use</b>" + BUILD.prompt.replace(/[<>&]/g, "");
document.getElementById("splash-title").textContent = ARCH.name ?? "Tallow Ward";
document.getElementById("splash-affords").textContent =
  `${ARCH.affords}. Everything you can see is voxels — dig it out, build on it, ` +
  `and they will notice.`;

const feed = document.getElementById("feed");
const clockEl = document.getElementById("clock");
/**
 * CSS2D has no idea two labels are on top of each other. Project everyone to
 * screen space, walk them nearest-first, and hide any plate that would land on
 * one already drawn. Nearest wins, so the person you are looking at keeps their
 * name.
 */
const _lp = new THREE.Vector3();
function deconflictPlates() {
  const shown = [];
  const ordered = [...actors.values()]
    .map((a) => {
      _lp.setFromMatrixPosition(a.root.matrixWorld);
      const d = camera.position.distanceTo(_lp);
      _lp.project(camera);
      return { a, d, x: (_lp.x * 0.5 + 0.5) * innerWidth, y: (-_lp.y * 0.5 + 0.5) * innerHeight, behind: _lp.z > 1 };
    })
    .sort((p, q) => p.d - q.d);

  for (const p of ordered) {
    const clash =
      p.behind ||
      shown.some((q) => Math.abs(q.x - p.x) < 108 && Math.abs(q.y - p.y) < 26);
    // Someone mid-speech always keeps their label: the bubble carries the name.
    p.a.plate.classList.toggle("hidden", clash && !p.a.bubble.visible);
    if (!clash) shown.push(p);
  }
}

function note(text, cls = "") {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = text;
  feed.prepend(d);
  while (feed.children.length > 12) feed.lastChild.remove();
}

// --- beats -------------------------------------------------------------------

let beats = [];
let draining = false;
let said = 0;
let hostName = "mock";
let cognition;  // live balance from the Builder API, when there is a key
let me = { id: "wren", name: "Wren" };   // replaced by the server on connect
const STRUCTURAL = new Set(["spawn", "despawn", "move"]);

function enqueue(b) { beats.push(b); if (!draining) void drain(); }

async function drain() {
  draining = true;
  while (beats.length) {
    if (beats.length > 9) {
      const chatter = beats.filter((b) => !STRUCTURAL.has(b.t));
      const drop = new Set(chatter.slice(0, Math.max(0, chatter.length - 6)));
      beats = beats.filter((b) => !drop.has(b));
    }
    try { await stage(beats.shift()); } catch (e) { console.warn(e); }
  }
  draining = false;
}

const GESTURE = {
  confront: "emote-no", snub: "emote-no", sabotage: "emote-no",
  break_alliance: "emote-no", spread_rumor: "interact-right",
  post_notice: "interact-right", offer_tribute: "emote-yes",
  concede: "emote-yes", greet_visitor: "emote-yes", recruit_visitor: "emote-yes",
};

async function stage(b) {
  if (b.t === "spawn") { await addActor(b.actor, b.at); note(`${b.actor.name} is here.`); return; }
  if (b.t === "despawn") {
    const a = actors.get(b.id);
    if (a) { scene.remove(a.root); a.plate.remove(); a.bubbleEl.remove(); actors.delete(b.id); note(`${a.name} left.`); }
    return;
  }
  if (b.t === "move") { const a = actors.get(b.id); if (a) await walk(a, b.at.x, b.at.z); return; }
  if (b.t === "notice") { note(`BOARD — ${b.text}`, "ev"); return; }
  if (b.t === "event") { note(b.summary, "ev"); return; }
  if (b.t !== "say") return;

  const a = actors.get(b.id);
  if (!a) return;
  const target = b.target ? actors.get(b.target) : null;
  // The cognition figure is the honest one: it is read from the Builder API at
  // startup, not a counter we keep ourselves.
  const cog = typeof cognition === "number" ? ` · ${cognition.toFixed(0)} cognition` : "";
  clockEl.textContent =
    `${++said} beats · ${hostName} host${hostName === "mock" ? " · no api key" : cog}`;
  note(`${a.name} ${b.verb.replace(/_/g, " ")}${target ? " → " + target.name : ""}`);
  // Narration goes to the feed, never into a bubble: a bubble is speech.
  if (b.stage) note(b.stage, "ev");

  if (target) {
    const tp = target.root.position;
    const ap = a.root.position;
    const dx = ap.x - tp.x, dz = ap.z - tp.z;
    const d = Math.max(Math.hypot(dx, dz), 0.001);
    await walk(a, tp.x + (dx / d) * 2.0, tp.z + (dz / d) * 2.0);
    face(a, tp.x, tp.z);
    face(target, ap.x, ap.z);
  }
  play(a, GESTURE[b.verb] ?? "idle", true);
  // No spoken words means no speech bubble. A snub is silent by definition and
  // used to "say" its own stage direction out loud.
  if (b.lines?.length) await speak(a, b.lines, b.verb, b.citeDetail);
  else await wait(1100);
  play(a, "idle");
  if (target) await walk(a, a.home.x, a.home.z);
}

// --- socket ------------------------------------------------------------------

let sock;
function connect() {
  sock = new WebSocket(`ws://${location.host}`);
  sock.onopen = () => { if (!said) clockEl.textContent = "connected"; };
  sock.onclose = () => { clockEl.textContent = "reconnecting"; setTimeout(connect, 1500); };
  sock.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "hello") {
      hostName = m.host ?? hostName;
      if (typeof m.cognition === "number") cognition = m.cognition;
      if (m.you) { me = m.you; note(`You are ${me.name}.`); }
      if (!said)
        clockEl.textContent =
          `${hostName} host${hostName === "mock" ? " · no api key"
            : typeof cognition === "number" ? ` · ${cognition.toFixed(0)} cognition` : ""}`;
      for (const a of m.actors) await addActor(a.actor, a.at);
      for (const b of m.recent.slice(-3)) enqueue(b);
      return;
    }
    if (m.t === "places") return;
    enqueue(m);
  };
}
connect();

/** Player edits go to canon so the cast can react to them. */
function onEdit({ kind, x, y, z, block, touched }) {
  mesher.queueChunks(touched);
  repathAll(); // somebody may have just walled somebody else in
  if (sock?.readyState === 1) {
    sock.send(JSON.stringify({ t: "edit", edit: { kind, x, y, z, block: nameOf(block) } }));
    // Say it out loud in the feed. The whole claim of this surface is that the
    // cast NOTICES what you build, and a claim nobody can see happen is a claim
    // nobody believes -- the edit used to vanish into a socket in silence.
    note(kind === "place" ? `You placed ${nameOf(block)}. The ward is watching.`
                          : `You broke ${nameOf(block)}. Somebody saw that.`, "ev");
  }
}

// --- loop --------------------------------------------------------------------

function frame(dt) {
  player.update(dt);
  paintBar();
  stepActors(dt);
  mesher.update(2);
  deconflictPlates();
  // Keep the shadow frustum around the player instead of the whole ward, but
  // keep the DIRECTION the look asked for -- this used to hardcode an offset,
  // which quietly overrode every profile's sun angle every frame.
  // The dome is smaller than the far plane, so it has to travel with the eye.
  skydome.position.copy(camera.position);
  sun.position.copy(camera.position).addScaledVector(sunDir, 110);
  sun.target.position.set(camera.position.x, 0, camera.position.z);
  sun.target.updateMatrixWorld();

  // Firelight. Intensity only -- never `visible`, which would recompile every
  // material in the scene on the frame it changed.
  flickerT += dt;
  if (dust) driftDust(dust, flickerT);
  if (practicals.length && LOOK.practicals?.flicker) {
    for (let i = 0; i < practicals.length; i++) {
      const l = practicals[i];
      const w = Math.sin(flickerT * 7.3 + i * 2.1) * 0.6 + Math.sin(flickerT * 17.1 + i) * 0.4;
      l.intensity = l.userData.baseIntensity * (1 + w * LOOK.practicals.flicker);
    }
  }
  composer.render();
  labels.render(scene, camera);
}

globalThis.__ward = {
  scene, camera, world, actors, player, mesher, THREE, frame,
  pause: () => { paused = true; },
  resume: () => { paused = false; },
  get paused() { return paused; },
};

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.1)));
