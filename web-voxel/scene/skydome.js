/**
 * THE SKY, WRITTEN BY HAND.
 *
 * We used three's physical `Sky` before this. It is a beautiful piece of work
 * and it was the single worst thing in our frames: a Rayleigh sky is genuinely,
 * physically far brighter than any surface under it, so once tone mapping had
 * room for the sky the ground sat at L=55, and once it had room for the ground
 * the sky clipped. Measured on the frame we shipped: 20.6% of pixels above 250,
 * the upper third at L=251.8 with an edge score of 0.03. A white slab.
 *
 * You cannot art-direct a physical sky. You can only expose for it. So this is
 * a three-stop gradient we control absolutely -- zenith, horizon, ground -- with
 * an optional sun disc and a haze band near the horizon. Every colour comes from
 * the archetype's look profile, which is what lets a tavern have a black-brown
 * ceiling and a market plaza have a blue sky out of the same code path.
 *
 * It is also just cheaper: one unlit sphere, no scattering integral.
 */

import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Direction from the centre of the dome, in world space. Normalising in the
    // fragment shader instead of here keeps the gradient smooth on a low-poly
    // sphere -- interpolating a normalised vector shortens it between vertices.
    vDir = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform vec3  uGround;
  uniform vec3  uSunTint;
  uniform vec3  uSunDir;
  uniform float uSunSize;
  uniform float uHaze;

  void main() {
    vec3  dir = normalize(vDir);
    float h   = dir.y;

    // Above the horizon: horizon -> zenith. The pow() keeps the interesting part
    // of the gradient near the horizon where the eye actually looks, instead of
    // spreading it evenly over a dome that is mostly overhead.
    vec3 up   = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    // Below it: horizon -> ground, much faster, because the ground plane covers
    // most of it anyway and a slow fade there reads as a bug.
    vec3 down = mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.35));
    vec3 col  = h > 0.0 ? up : down;

    // A soft band of haze pinned to the horizon line. This is what sells depth
    // on an outdoor scene and what makes an interior dome read as "air", not
    // "wall". exp() rather than smoothstep so it never has a visible edge.
    col = mix(col, uHorizon, uHaze * exp(-abs(h) * 7.0));

    // The sun. uSunSize of 0 removes it entirely, which is how every interior
    // profile turns it off without a branch in the JS.
    if (uSunSize > 0.0) {
      float d = max(dot(dir, normalize(uSunDir)), 0.0);
      // Tight core plus a wide, weak bloom-ish falloff. Deliberately capped well
      // under 1.0: an unclipped sun disc is exactly the blown highlight this
      // whole file exists to avoid.
      float core = pow(d, 1.0 / max(uSunSize, 0.001));
      float glow = pow(d, 6.0) * 0.28;
      col += uSunTint * (core * 0.55 + glow);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Build the dome. Returns the Mesh; call `applySkyLook` to (re)colour it.
 *
 * `renderOrder`/`depthWrite:false` and a BackSide sphere is the standard way to
 * make a skybox that never occludes anything and never gets fogged.
 */
export function createSkyDome(radius = 900) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    // The dome must not take the scene's fog, or the horizon gets fogged toward
    // the fog colour and the gradient we just wrote disappears into flat grey.
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x6f9fd0) },
      uHorizon: { value: new THREE.Color(0xbcd3e8) },
      uGround: { value: new THREE.Color(0x6b6257) },
      uSunTint: { value: new THREE.Color(0xfff2d6) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunSize: { value: 0.05 },
      uHaze: { value: 0.35 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "skydome";
  return mesh;
}

/** Push a look's `sky` block plus the sun direction into the dome's uniforms. */
export function applySkyLook(dome, sky, sunDir) {
  const u = dome.material.uniforms;
  u.uZenith.value.setHex(sky.zenith);
  u.uHorizon.value.setHex(sky.horizon);
  u.uGround.value.setHex(sky.ground);
  u.uSunTint.value.setHex(sky.sunTint);
  u.uSunSize.value = sky.sunSize;
  u.uHaze.value = sky.haze;
  if (sunDir) u.uSunDir.value.copy(sunDir);
}
