/**
 * The ward, rendered. Everything below is glue over three.js scaffolding --
 * GLTFLoader, AnimationMixer, PCFSoft shadows, GTAO, CSS2DRenderer, Orbit
 * controls. No geometry is authored here: buildings are stacked from Kenney
 * kit pieces by measured bounding box, characters are rigged GLBs.
 *
 * This file never decides what happens. It receives beats over a WebSocket
 * and stages them. Canon lives on the other end of the socket.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

const KIT = "/assets/castle/";
const CHARS = "/assets/characters/";
const BODY = {
  vance: "character-female-b.glb",
  okonkwo: "character-male-c.glb",
  quill: "character-female-e.glb",
  _visitor: "character-male-a.glb",
};
// Minted characters are unknown at build time, so they draw from a spare pool,
// picked by a hash of the id: stable across reloads, and two newcomers do not
// turn up wearing the same body.
const SPARE = [
  "character-female-a.glb", "character-male-b.glb",
  "character-female-c.glb", "character-male-d.glb",
];
function bodyFor(id, kind) {
  if (BODY[id]) return BODY[id];
  if (kind === "visitor") return BODY._visitor;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SPARE[h % SPARE.length];
}
const PERSON_HEIGHT = 1.7;
const KIT_SCALE = 2.3;
const WALK_SPEED = 2.6;

// Three buildings, each stacked from kit pieces. Order is bottom to top.
const BUILDINGS = [
  { at: [-9.6, -4.6], yaw: 0.35, parts: ["tower-square-base", "tower-square-mid-windows", "tower-square-top-roof-high"] },
  { at: [9.6, -4.6], yaw: -0.35, parts: ["tower-square-base", "tower-square-mid-door", "tower-square-roof"] },
  { at: [0, 10.6], yaw: Math.PI, parts: ["tower-hexagon-base", "tower-hexagon-mid", "tower-hexagon-roof"] },
];
const W = 2.3; // one kit piece is 1 unit wide, scaled by KIT_SCALE
const DRESSING = [
  ["tree-small", -12.5, 9.5, 0], ["tree-large", 12.5, 10.5, 1.1], ["tree-small", 15, 3, .4],
  ["rocks-small", -14, 5, .8], ["rocks-small", 13.5, -12, 2.2], ["rocks-small", 16, 9, 1.4],
  ["tree-small", -15.5, -9, 2.0], ["tree-large", 15.5, -8, .2],
  ["wall-pillar", -W * 1.5, -14, 0], ["wall-pillar", W * 1.5, -14, 0],
  ["flag", -9.6, -2.2, 0], ["flag", 9.6, -2.2, 0], ["flag", 1.9, 8.6, Math.PI],
  // the ward wall: contiguous, with a gate-width gap on the plaza axis
  ...[2.5, 3.5, 4.5, 5.5, 6.5].flatMap((i) => [
    ["wall", -W * i, -14, 0], ["wall", W * i, -14, 0],
  ]),
  ...[-3, -2, -1, 0, 1, 2, 3].flatMap((i) => [
    ["wall-narrow-wood-fence", -16.5, W * i, Math.PI / 2],
    ["wall-narrow-wood-fence", 16.5, W * i, Math.PI / 2],
  ]),
];


// --- scene ------------------------------------------------------------------

const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a4250);
scene.fog = new THREE.Fog(0x3a4250, 46, 110);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
camera.position.set(-7.5, 17.5, 25);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.2, 1.5);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.12;
controls.minDistance = 8;
controls.maxDistance = 62;

const labels = new CSS2DRenderer({ element: document.getElementById("labels") });

// Soft shadows plus AO is the whole art direction. No voxels, no density.
const sun = new THREE.DirectionalLight(0xffe9cf, 3.4);
sun.position.set(-14, 24, 19);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0007;
sun.shadow.normalBias = 0.03;
const cam = sun.shadow.camera;
cam.left = -32; cam.right = 32; cam.top = 32; cam.bottom = -32; cam.far = 90;
scene.add(sun, new THREE.HemisphereLight(0x9fb6d4, 0x3a3026, 1.55));
scene.add(new THREE.AmbientLight(0x6b7488, 0.45));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(150, 150),
  new THREE.MeshStandardMaterial({ color: 0x6e6455, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const plaza = new THREE.Mesh(
  new THREE.CircleGeometry(9.5, 48),
  new THREE.MeshStandardMaterial({ color: 0x827761, roughness: .95 }),
);
plaza.rotation.x = -Math.PI / 2;
plaza.position.y = 0.012;
plaza.receiveShadow = true;
scene.add(plaza);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
let gtao = null;
if (!location.search.includes("ao=0")) {
  try {
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  } catch (e) {
    console.warn("GTAO unavailable, running without AO:", e);
  }
}
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  labels.setSize(w, h);
  gtao?.setSize(w, h);
}
addEventListener("resize", resize);
resize();

// --- assets -----------------------------------------------------------------

const loader = new GLTFLoader();
const cache = new Map();
const load = (url) =>
  cache.get(url) ?? cache.set(url, loader.loadAsync(url)).get(url);

function dressShadows(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Kenney's atlas is authored flat; a little roughness stops the plastic look.
    if (o.material) { o.material.roughness = 0.82; o.material.metalness = 0.0; }
  });
}
const sizeOf = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

/** Stack kit pieces bottom-to-top using their measured heights. */
async function stack(parts, x, z, yaw) {
  const group = new THREE.Group();
  let y = 0;
  for (const name of parts) {
    const piece = (await load(KIT + name + ".glb")).scene.clone(true);
    piece.position.y = y;
    group.add(piece);
    y += sizeOf(piece).y - 0.02; // overlap a hair so seams do not show
  }
  group.scale.setScalar(KIT_SCALE);
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  dressShadows(group);
  scene.add(group);
  return group;
}

async function prop(name, x, z, yaw, scale = KIT_SCALE) {
  const o = (await load(KIT + name + ".glb")).scene.clone(true);
  o.position.set(x, 0, z);
  o.rotation.y = yaw;
  o.scale.setScalar(scale);
  dressShadows(o);
  scene.add(o);
}

// --- actors -----------------------------------------------------------------

const actors = new Map();

async function addActor({ id, name, kind, title }, at) {
  if (actors.has(id)) return actors.get(id);
  const file = bodyFor(id, kind);
  const gltf = await load(CHARS + file);
  const root = THREE.SkeletonUtils
    ? THREE.SkeletonUtils.clone(gltf.scene)
    : (await import("three/addons/utils/SkeletonUtils.js")).clone(gltf.scene);

  const fit = PERSON_HEIGHT / Math.max(sizeOf(root).y, 0.001);
  root.scale.setScalar(fit);
  root.position.set(at.x, 0, at.z);
  dressShadows(root);
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
  plateObj.position.y = (PERSON_HEIGHT + 0.3) / fit; // local units: undo the body scale
  root.add(plateObj);

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "bubble";
  const bubble = new CSS2DObject(bubbleEl);
  bubble.position.y = (PERSON_HEIGHT + 0.85) / fit;
  bubble.visible = false;
  root.add(bubble);

  const a = { id, name, root, mixer, clips, plate, bubbleEl, bubble, home: { ...at }, current: null };
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
 * Hold the world on the current line. Useful for filming: the citation is the
 * payoff and a viewer needs longer to read it than a live tick will allow.
 * Press P, or call __ward.pause() from a console.
 */
let paused = false;
const idle = () => new Promise((r) => setTimeout(r, 90));
const wait = async (ms) => {
  await new Promise((r) => setTimeout(r, ms));
  while (paused) await idle();
};
addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") setPaused(!paused);
});
function setPaused(v) {
  paused = v;
  statusEl.textContent = v ? "held" : "live";
  statusEl.className = v ? "dead" : "live";
}

function face(a, x, z) {
  const dx = x - a.root.position.x, dz = z - a.root.position.z;
  if (dx * dx + dz * dz > 1e-4) a.root.rotation.y = Math.atan2(dx, dz);
}

/** Walk to a point. Resolves when standing there. */
function walk(a, x, z) {
  return new Promise((done) => {
    face(a, x, z);
    play(a, "walk");
    a.walkTo = { x, z, done };
  });
}

function stepWalks(dt) {
  for (const a of actors.values()) {
    if (!a.walkTo) continue;
    const p = a.root.position;
    const dx = a.walkTo.x - p.x, dz = a.walkTo.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.09) {
      const { done } = a.walkTo;
      a.walkTo = null;
      play(a, "idle");
      done();
      continue;
    }
    const s = Math.min(WALK_SPEED * dt, d);
    p.x += (dx / d) * s;
    p.z += (dz / d) * s;
  }
}

async function speak(a, lines, verb, detail) {
  a.bubbleEl.innerHTML = "";
  const v = document.createElement("span");
  v.className = "verb";
  v.textContent = verb.replace(/_/g, " ");
  a.bubbleEl.append(v);
  const body = document.createElement("span");
  a.bubbleEl.append(body);
  a.bubble.visible = true;
  a.bubbleEl.classList.add("on");

  for (const line of lines) {
    body.textContent = line;
    await wait(Math.min(4200, 1300 + line.length * 34));
  }
  // The complaint is checked against the append-only log, on screen, live.
  for (const d of detail ?? []) {
    const c = document.createElement("span");
    c.className = "cite" + (d.ok ? "" : " bad");
    c.textContent = `${d.ok ? "✓" : "✗"} ${d.id} — ${d.summary}`;
    a.bubbleEl.append(c);
  }
  if (detail?.length) await wait(5200);
  a.bubbleEl.classList.remove("on");
  await wait(200);
  a.bubble.visible = false;
}

// --- HUD --------------------------------------------------------------------

const feed = document.getElementById("feed");
const statusEl = document.getElementById("status");
const clockEl = document.getElementById("clock");

function note(text, cls = "") {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = text;
  feed.prepend(d);
  while (feed.children.length > 14) feed.lastChild.remove();
}

// --- beats ------------------------------------------------------------------

let places = {};
let beats = [];
let draining = false;
let said = 0;
let hostName = "mock";

function enqueue(b) {
  beats.push(b);
  if (!draining) void drain();
}

// Who is present is structural; what they said is chatter. Chatter can be
// dropped when the backlog runs away, presence never can -- losing one spawn
// leaves an NPC greeting somebody the viewer cannot see.
const STRUCTURAL = new Set(["spawn", "despawn", "move"]);

async function drain() {
  draining = true;
  while (beats.length) {
    if (beats.length > 9) {
      const chatter = beats.filter((b) => !STRUCTURAL.has(b.t));
      const drop = new Set(chatter.slice(0, Math.max(0, chatter.length - 6)));
      beats = beats.filter((b) => !drop.has(b)); // original order preserved
    }
    try { await stageBeat(beats.shift()); } catch (e) { console.warn(e); }
  }
  draining = false;
}

const GESTURE = {
  confront: "emote-no", snub: "emote-no", sabotage: "emote-no",
  break_alliance: "emote-no", spread_rumor: "interact-right",
  post_notice: "interact-right", offer_tribute: "emote-yes",
  concede: "emote-yes", greet_visitor: "emote-yes", recruit_visitor: "emote-yes",
};

async function stageBeat(b) {
  if (b.t === "spawn") {
    const a = await addActor(b.actor, b.at);
    note(`${b.actor.name} is in the ward.`);
    return a;
  }
  if (b.t === "despawn") {
    const a = actors.get(b.id);
    if (a) {
      scene.remove(a.root);
      a.plate.remove();
      a.bubbleEl.remove();
      actors.delete(b.id);
      note(`${a.name} left.`);
    }
    return;
  }
  if (b.t === "move") {
    const a = actors.get(b.id);
    if (a) await walk(a, b.at.x, b.at.z);
    return;
  }
  if (b.t === "notice") { note(`BOARD — ${b.text}`, "ev"); return; }
  if (b.t === "event") { note(b.summary, "ev"); return; }
  if (b.t !== "say") return;

  const a = actors.get(b.id);
  if (!a) return;
  const target = b.target ? actors.get(b.target) : null;

  clockEl.textContent = `${++said} beats · ${hostName} host${hostName === "mock" ? " · no api key" : ""}`;
  note(`${a.name} ${b.verb.replace(/_/g, " ")}${target ? " → " + target.name : ""}`);

  if (target) {
    // Stand a pace short of them, not inside them.
    const tp = target.root.position;
    const ap = a.root.position;
    const dx = ap.x - tp.x, dz = ap.z - tp.z;
    const d = Math.max(Math.hypot(dx, dz), 0.001);
    await walk(a, tp.x + (dx / d) * 1.9, tp.z + (dz / d) * 1.9);
    face(a, tp.x, tp.z);
    face(target, ap.x, ap.z);
  }

  play(a, GESTURE[b.verb] ?? "idle", true);
  if (b.lines?.length) await speak(a, b.lines, b.verb, b.citeDetail);
  else await wait(700);

  play(a, "idle");
  if (target) await walk(a, a.home.x, a.home.z);
}

// --- socket -----------------------------------------------------------------

let sock;
function connect() {
  sock = new WebSocket(`ws://${location.host}`);
  sock.onopen = () => { statusEl.textContent = "live"; statusEl.className = "live"; };
  sock.onclose = () => {
    statusEl.textContent = "reconnecting"; statusEl.className = "dead";
    setTimeout(connect, 1500);
  };
  sock.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "places") { places = m.places ?? places; return; }
    if (m.t === "hello") {
      hostName = m.host ?? hostName;
      places = m.places ?? {};
      // Until the first beat lands there is nothing to count, but the ward is
      // connected -- "connecting" would be a lie.
      if (!said) clockEl.textContent = `${hostName} host${hostName === "mock" ? " · no api key" : ""} · waiting for the next tick`;
      for (const a of m.actors) await addActor(a.actor, a.at);
      for (const b of m.recent.slice(-4)) enqueue(b);
      return;
    }
    enqueue(m);
  };
}
connect();

const send = (t, text) => sock?.readyState === 1 && sock.send(JSON.stringify({ t, text }));
const btn = (id) => document.getElementById(id);

let visited = false;

btn("btn-arrive").onclick = () => {
  send("arrive");
  visited = true;
  btn("btn-arrive").disabled = true;
  btn("btn-side").disabled = false;
  btn("btn-leave").disabled = false;
};
btn("btn-side").onclick = () => {
  send("act", "stood up in the plaza and backed okonkwo against vance in front of the whole ward");
  btn("btn-side").disabled = true;
};
btn("btn-leave").onclick = () => {
  send("leave");
  btn("btn-leave").disabled = true;
  btn("btn-side").disabled = true;
  btn("btn-arrive").disabled = false;
  // The ward keeps running while you are away; that is the point of coming back.
  btn("btn-arrive").textContent = "Come back to the ward";
};

const mintPanel = document.getElementById("mint");
btn("btn-mint").onclick = () => mintPanel.classList.toggle("open");
btn("mint-cancel").onclick = () => mintPanel.classList.remove("open");
btn("mint-go").onclick = () => {
  const text = document.getElementById("mint-text").value.trim();
  if (!text) return;
  send("mint", text);
  mintPanel.classList.remove("open");
  note("Minting…");
};

// --- build the set, then run ------------------------------------------------

await Promise.all([
  ...BUILDINGS.map((b) => stack(b.parts, b.at[0], b.at[1], b.yaw)),
  ...DRESSING.map(([n, x, z, r]) => prop(n, x, z, r)),
]);
note("The ward is standing. Waiting for the world to tick.");

/** One frame of world time. Split out so it can be stepped by hand in QA. */
function frame(dt) {
  for (const a of actors.values()) a.mixer.update(dt);
  stepWalks(dt);
  controls.update();
  composer.render();
  labels.render(scene, camera);
}

// Debug handle: lets a browser console (or an agent) drive and measure the
// scene without waiting on requestAnimationFrame.
globalThis.__ward = {
  scene, actors, camera, controls, THREE, frame,
  pause: () => setPaused(true),
  resume: () => setPaused(false),
  get paused() { return paused; },
};

const clockT = new THREE.Clock();
renderer.setAnimationLoop(() => frame(Math.min(clockT.getDelta(), 0.1)));
