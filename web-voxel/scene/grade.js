/**
 * THE GRADE: one post pass, four knobs, per archetype.
 *
 * Lighting decides what is bright. The grade decides what that brightness LOOKS
 * like, and it is the cheapest per-scene identity available -- the same room
 * graded cold-and-crushed versus warm-and-lifted reads as two different films.
 *
 * The knobs are lift/gamma/gain because that is the vocabulary colourists
 * actually use, and because `gain` is the specific control that fixes our
 * headline bug: pulling the top of the range down below 1.0 means the brightest
 * thing in frame stops short of 255 instead of clipping into a white slab.
 *
 * Applied AFTER tone mapping, deliberately. Grading before the tone curve means
 * every adjustment gets re-compressed by ACES and the numbers stop meaning
 * anything; grading after it is what you measure with pixelstats.
 */

import * as THREE from "three";

export const GradeShader = {
  name: "GradeShader",
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: 0.02 },
    uGamma: { value: 1.0 },
    uGain: { value: 0.98 },
    uSaturation: { value: 1.0 },
    uVignette: { value: 0.22 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uLift, uGamma, uGain, uSaturation, uVignette;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      // Lift/gamma/gain. Lift first so the gamma bend happens on the raised
      // floor -- doing it the other way round crushes the shadows you just
      // rescued. max() guards pow() against a negative base, which is a NaN.
      c = c * (1.0 - uLift) + uLift;
      c = pow(max(c, 0.0), vec3(1.0 / uGamma));
      c *= uGain;

      // Saturation around Rec.709 luma, so pushing colour does not also push
      // brightness. Values under 1 desaturate toward that luma.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSaturation);

      // Vignette. Not for mood -- it is what stops the eye wandering to the
      // corners of a procedurally generated world, where the seams are.
      vec2  d = vUv - 0.5;
      float v = 1.0 - uVignette * dot(d, d) * 2.6;
      c *= clamp(v, 0.0, 1.0);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

/** Push a look's `grade` block into a ShaderPass built from GradeShader. */
export function applyGrade(pass, grade) {
  const u = pass.uniforms;
  u.uLift.value = grade.lift;
  u.uGamma.value = grade.gamma;
  u.uGain.value = grade.gain;
  u.uSaturation.value = grade.saturation;
  u.uVignette.value = grade.vignette;
}
