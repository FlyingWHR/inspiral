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
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import { VoxelWorld } from "./voxel/chunk.js";
import { BLOCKS, colorOf, nameOf } from "./voxel/blocks.js";
import { generateScene, clearPlaces } from "./scene/generate.js";
import { getArchetype } from "./scene/archetypes.js";
import { ChunkMesher } from "./chunkmesh.js";
import { Player, PALETTE } from "./player.js";
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(ARCH.sky ?? 0x8fb3d9);
scene.fog = new THREE.Fog(ARCH.sky ?? 0x8fb3d9, 60, 190);

const camera = new THREE.PerspectiveCamera(74, 1, 0.08, 400);
const labels = new CSS2DRenderer({ element: document.getElementById("labels") });

const sun = new THREE.DirectionalLight(0xffe9cf, 3.1);
sun.position.set(-60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 3;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.06;
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 220;
scene.add(sun, sun.target);
// A roof blocks the sun, so an enclosed scene needs its own fill or it reads
// as a cave. Lanterns are set dressing; this is what makes the room legible.
const INDOOR = Boolean(ARCH.indoor);
scene.add(new THREE.HemisphereLight(0xbcd6ef, 0x50432f, INDOOR ? 0.7 : 1.35));
scene.add(new THREE.AmbientLight(INDOOR ? 0xffe4c4 : 0x8593a8, INDOOR ? 0.85 : 0.34));
if (INDOOR) {
  const fill = new THREE.PointLight(0xffdba8, 55, 55, 2);
  fill.position.set(0, 18, 0);
  scene.add(fill);
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
composer.addPass(new OutputPass());

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
generateScene(world, ARCH.id, { seed: 1 });
clearPlaces(world, ARCH.id);

const voxelMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.94, metalness: 0,
});
const mesher = new ChunkMesher(world, scene, voxelMaterial);
mesher.queueDirty();

const player = new Player(world, camera, canvas, { onEdit });
player.spawnAt(ARCH.spawn.x, ARCH.spawn.z, [0, 0]); // walk in facing the middle
scene.add(player.highlight);

// --- hotbar ------------------------------------------------------------------

const bar = document.getElementById("bar");
PALETTE.forEach((id, i) => {
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
  clockEl.textContent = `${++said} beats · ${hostName} host${hostName === "mock" ? " · no api key" : ""}`;
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
      if (m.you) { me = m.you; note(`You are ${me.name}.`); }
      if (!said) clockEl.textContent = `${hostName} host${hostName === "mock" ? " · no api key" : ""}`;
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
  }
}

// --- loop --------------------------------------------------------------------

function frame(dt) {
  player.update(dt);
  paintBar();
  stepActors(dt);
  mesher.update(2);
  deconflictPlates();
  // keep the shadow frustum around the player instead of the whole ward
  sun.position.set(camera.position.x - 60, 90, camera.position.z + 40);
  sun.target.position.set(camera.position.x, 0, camera.position.z);
  sun.target.updateMatrixWorld();
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
