/**
 * ART DIRECTION, past exposure.
 *
 * `pixelstats` got the frames correctly exposed and they were still not nice to
 * look at, because a histogram measures whether an image is broken, not whether
 * it is good. Well-exposed is the floor. This file is the part that is supposed
 * to make someone stop scrolling.
 *
 * Four things do most of the work in a stylised interior, and none of them is
 * a better asset:
 *
 *   SHADING     A toon ramp reads as a decision. Default PBR on flat-coloured
 *               cubes reads as an untextured prototype, which is exactly what
 *               it is.
 *   LIGHT       Emissive sources that actually bloom. A lantern that is merely
 *               a yellow cube is a yellow cube; a lantern that spills light is
 *               the warmest thing in the room.
 *   AIR         Dust and shafts. An interior with nothing between the camera
 *               and the wall has no depth, whatever the fog density says.
 *   FOCUS       Depth of field, and a rim light to lift the cast off the set.
 *
 * Bloom is here despite having wrecked the frames once before. The failure then
 * was a physical sky far brighter than any sensible threshold, so bloom smeared
 * the sky across everything. That sky is gone, these rooms are interiors, and
 * the threshold below is set so only genuinely emissive blocks cross it. It is
 * measured like everything else -- if blown% climbs, the threshold is wrong.
 */

import * as THREE from "three";

/**
 * A stepped gradient map for MeshToonMaterial: the whole toon look in 4 pixels.
 * NearestFilter is not optional -- linear filtering smooths the steps back into
 * the gradient we are trying to get rid of.
 */
export function gradientMap(steps = 3) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The material the voxel chunks are drawn with.
 *
 * `toon` swaps the lighting model wholesale rather than patching the standard
 * one: MeshToonMaterial already supports vertexColors and a gradient map, and a
 * hand-rolled ramp injected into the standard shader is a lot of GLSL to end up
 * somewhere worse.
 */
export function voxelMaterial(dir) {
  if (dir.shading === "toon") {
    return new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: gradientMap(dir.toonSteps ?? 3),
    });
  }
  if (dir.shading === "flat") {
    // No specular, no roughness response: colour and shadow only. This is the
    // Monument Valley end of the range -- the surface stops pretending to be
    // a material and becomes a shape with a tone.
    return new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: dir.roughness ?? 0.94,
    metalness: 0,
  });
}

/**
 * Dust in the air, drifting.
 *
 * The single cheapest thing that turns an empty room into a place with air in
 * it. Additive points, no texture, seeded so a screenshot is reproducible.
 */
export function makeDust(count = 900, extent = 30, height = 8) {
  // Deterministic: Math.random would make every capture a different frame and
  // the whole measurement discipline depends on being able to re-shoot exactly.
  let seed = 20260821;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rand() - 0.5) * extent * 2;
    pos[i * 3 + 1] = 13 + rand() * height;
    pos[i * 3 + 2] = (rand() - 0.5) * extent * 2;
    phase[i] = rand() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xffd9a0,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = "dust";
  points.userData.phase = phase;
  points.userData.base = pos.slice();
  return points;
}

/** Drift the motes. Slow, and mostly upward, because that is what dust does. */
export function driftDust(points, t) {
  const p = points.geometry.attributes.position;
  const base = points.userData.base;
  const phase = points.userData.phase;
  for (let i = 0; i < phase.length; i++) {
    const ph = phase[i];
    p.array[i * 3] = base[i * 3] + Math.sin(t * 0.22 + ph) * 0.5;
    p.array[i * 3 + 1] = base[i * 3 + 1] + ((t * 0.09 + ph) % 2.2) - 1.1;
    p.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.17 + ph) * 0.5;
  }
  p.needsUpdate = true;
}

/**
 * A shaft of light from the window.
 *
 * Faked with a stack of additive quads rather than raymarched volumetrics: at
 * this fidelity nobody can tell, it costs nothing, and it is the difference
 * between "there is a window" and "there is light coming through the window".
 * `depthWrite:false` and a back-to-front stack keeps it from z-fighting itself.
 */
export function makeShaft({ from, to, width = 3.2, layers = 14, color = 0xffe6b8, opacity = 0.05 }) {
  const group = new THREE.Group();
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  for (let i = 0; i < layers; i++) {
    // Widen toward the far end: a shaft that stays parallel reads as a plank.
    const k = i / (layers - 1);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width * (1 + k * 0.9), len), mat);
    plane.position.copy(a).lerp(b, 0.5);
    plane.lookAt(b);
    plane.rotateY(Math.PI / 2);
    plane.rotateZ((i / layers) * Math.PI);
    group.add(plane);
  }
  group.name = "shaft";
  group.renderOrder = 900;
  return group;
}
