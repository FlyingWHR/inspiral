/**
 * First-person player: pointer-lock mouse look, WASD against the voxel grid,
 * gravity and jump from the shared physics core, and the block editing that is
 * the entire point of the exercise.
 */
import * as THREE from "three";
import { Body, step } from "./voxel/physics.js";
import { raycast } from "./voxel/raycast.js";
import { AIR, BLOCKS, isSolid } from "./voxel/blocks.js";

const EYE = 1.62;      // Minecraft-ish: 1.8 tall, eyes just below the top
const SPEED = 5.6;
const SPRINT = 9.0;
const JUMP = 9.2;
const REACH = 6;

export class Player {
  constructor(world, camera, dom, { onEdit } = {}) {
    this.world = world;
    this.camera = camera;
    this.dom = dom;
    this.onEdit = onEdit;
    this.body = new Body([0, 0, 0], [0.6, 1.8, 0.6]);
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this.held = BLOCKS.findIndex((b) => b.name === "plank");
    this.flying = false;

    this.highlight = this.makeHighlight();
    this.bind();
  }

  makeHighlight() {
    const g = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(g),
      new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.55 }),
    );
    edges.visible = false;
    edges.matrixAutoUpdate = false;
    return edges;
  }

  /** Drop in at a column, looking at `lookAt` (defaults to the world origin). */
  spawnAt(x, z, lookAt = [0, 0]) {
    const y = this.world.heightAt(x, z) ?? 16;
    this.body.position = [x + 0.5, y + 1, z + 0.5];
    this.body.velocity = [0, 0, 0];
    this.yaw = Math.atan2(-(lookAt[0] - x), -(lookAt[1] - z));
    this.pitch = -0.08;
  }

  bind() {
    const canvas = this.dom;
    canvas.addEventListener("click", () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle("locked", this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.001;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "KeyF") this.flying = !this.flying;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) this.held = this.paletteAt(n - 1);
      if (this.locked && ["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    canvas.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button === 0) this.break_();
      else if (e.button === 2) this.place();
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Palette is every solid block except the ones the terrain uses as filler. */
  paletteAt(i) {
    const pal = PALETTE;
    return pal[Math.min(i, pal.length - 1)];
  }

  aim() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return raycast(
      (x, y, z) => this.world.get(x, y, z),
      [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      [dir.x, dir.y, dir.z],
      REACH,
    );
  }

  break_() {
    const hit = this.aim();
    if (!hit) return;
    const [x, y, z] = hit.voxel;
    const was = this.world.get(x, y, z);
    const touched = this.world.set(x, y, z, AIR);
    this.onEdit?.({ kind: "break", x, y, z, block: was, touched });
  }

  place() {
    const hit = this.aim();
    if (!hit) return;
    const [x, y, z] = hit.voxel;
    const [nx, ny, nz] = hit.normal;
    const px = x + nx, py = y + ny, pz = z + nz;
    if (isSolid(this.world.get(px, py, pz))) return;

    // Refuse to entomb the player in their own block.
    const b = this.body.aabb;
    const overlapsMe =
      px + 1 > b.min[0] && px < b.max[0] &&
      py + 1 > b.min[1] && py < b.max[1] &&
      pz + 1 > b.min[2] && pz < b.max[2];
    if (overlapsMe) return;

    const touched = this.world.set(px, py, pz, this.held);
    this.onEdit?.({ kind: "place", x: px, y: py, z: pz, block: this.held, touched });
  }

  update(dt) {
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    let fwd = 0, strafe = 0;
    if (this.keys.has("KeyW")) fwd += 1;
    if (this.keys.has("KeyS")) fwd -= 1;
    if (this.keys.has("KeyD")) strafe += 1;
    if (this.keys.has("KeyA")) strafe -= 1;
    const mag = Math.hypot(fwd, strafe) || 1;
    const speed = this.keys.has("ShiftLeft") ? SPRINT : SPEED;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const vx = ((-sin * fwd) + (cos * strafe)) / mag * speed;
    const vz = ((-cos * fwd) - (sin * strafe)) / mag * speed;

    this.body.velocity[0] = vx;
    this.body.velocity[2] = vz;

    if (this.flying) {
      this.body.velocity[1] = this.keys.has("Space") ? 7 : this.keys.has("ControlLeft") ? -7 : 0;
      step((x, y, z) => this.world.solid(x, y, z), this.body, dt, 0);
    } else {
      if (this.keys.has("Space") && this.body.onGround) this.body.velocity[1] = JUMP;
      step((x, y, z) => this.world.solid(x, y, z), this.body, dt);
    }

    const [px, py, pz] = this.body.position;
    this.camera.position.set(px, py + EYE, pz);

    const hit = this.aim();
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.voxel[0] + 0.5, hit.voxel[1] + 0.5, hit.voxel[2] + 0.5);
      this.highlight.updateMatrix();
    } else {
      this.highlight.visible = false;
    }
    return hit;
  }
}

/** The blocks offered on the hotbar, in order. */
export const PALETTE = [
  BLOCKS.findIndex((b) => b.name === "plank"),
  BLOCKS.findIndex((b) => b.name === "stone"),
  BLOCKS.findIndex((b) => b.name === "cobble"),
  BLOCKS.findIndex((b) => b.name === "brick"),
  BLOCKS.findIndex((b) => b.name === "plaster"),
  BLOCKS.findIndex((b) => b.name === "timber"),
  BLOCKS.findIndex((b) => b.name === "roof"),
  BLOCKS.findIndex((b) => b.name === "glass"),
  BLOCKS.findIndex((b) => b.name === "lantern"),
];
