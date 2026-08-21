#!/usr/bin/env node
/**
 * HUE AND CHROMA, which pixelstats cannot see.
 *
 *   node tools/visual/huestats.mjs docs/screens/looks
 *   node tools/visual/huestats.mjs docs/screens/looks --region=full
 *
 * pixelstats answers "is this frame correctly exposed". Every frame we ship
 * passes it, and a colour study still found the frames unattractive. Its
 * diagnosis was that the failure is not in VALUE at all -- it is that the whole
 * palette collapsed into one narrow band of hue, because every material name in
 * the fantasy-village vocabulary (oak, dirt, sandstone, thatch, clay, plaster)
 * lands between hue 20 and 80.
 *
 * This measures that. It is a REIMPLEMENTATION, not the study's own script,
 * which was not available on this machine -- so absolute numbers may differ
 * from theirs and the definitions below are the ones actually used here:
 *
 *   valueSpread   OKLab L at p95 minus L at p05. How much of the tonal range
 *                 the frame actually occupies.
 *   massSep       mean L of the pixels above the median minus mean L of those
 *                 below it. Whether the frame has distinct light and dark
 *                 masses or one grey mush.
 *   arc95/arc100  the NARROWEST arc, in degrees, containing 95% / 100% of the
 *                 frame's chroma-weighted hue mass. This is the headline: a
 *                 small number means every coloured thing on screen is the
 *                 same colour.
 *   chroma>0.11   the share of pixels carrying real colour rather than tinted
 *                 grey. OKLCh chroma, where ~0.11 is a modest but present hue.
 *
 * Colour maths is OKLab (Björn Ottosson), because hue distance in OKLab
 * corresponds to perceived hue distance and in HSV it does not.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? "docs/screens";
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const REGION = flag("region", "center");
const CHROMA_FLOOR = Number(flag("chroma", "0.11"));
/**
 * Hue is meaningless on a near-grey pixel: its angle is rounding noise. Gate
 * the hue histogram above this or a frame with no colour at all reports a WIDE
 * arc -- which reads as healthy variety and is the exact opposite of the truth.
 */
const ARC_FLOOR = Number(flag("arcfloor", "0.03"));

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** linear sRGB -> OKLab. */
function oklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/**
 * Narrowest arc containing `frac` of the weighted mass in a 360-bin circular
 * histogram. Brute force over every start bin: 360x360 is nothing, and the
 * clever version is where off-by-one errors live.
 */
function narrowestArc(hist, frac) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return 360;
  const need = total * frac;
  let best = 360;
  for (let start = 0; start < 360; start++) {
    let acc = 0;
    for (let w = 1; w <= 360; w++) {
      acc += hist[(start + w - 1) % 360];
      if (acc >= need) {
        if (w < best) best = w;
        break;
      }
    }
  }
  return best;
}

function analyse(file) {
  const png = PNG.sync.read(readFileSync(file));
  const { width: W, height: H, data } = png;

  // The HUD is a large, deliberately desaturated overlay -- dark panels and
  // white text. Left in, it drags every chroma number toward zero and the
  // measurement stops being about the world. `center` samples the middle of
  // the frame, which is world in every shot we take.
  const [x0, x1, y0, y1] =
    REGION === "full"
      ? [0, W, 0, H]
      : [Math.floor(W * 0.22), Math.floor(W * 0.78), Math.floor(H * 0.2), Math.floor(H * 0.8)];

  const Ls = [];
  const hueHist = new Float64Array(360);
  let above = 0, n = 0, chromaSum = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (W * y + x) << 2;
      const r = srgbToLinear(data[i] / 255);
      const g = srgbToLinear(data[i + 1] / 255);
      const b = srgbToLinear(data[i + 2] / 255);
      const [L, A, B] = oklab(r, g, b);
      const C = Math.hypot(A, B);
      Ls.push(L);
      chromaSum += C;
      if (C > CHROMA_FLOOR) above++;
      // Weight the hue histogram BY CHROMA: a near-grey pixel has a hue but no
      // opinion, and counting it equally would smear the distribution flat and
      // hide exactly the collapse we are looking for.
      if (C > ARC_FLOOR) {
        let h = (Math.atan2(B, A) * 180) / Math.PI;
        if (h < 0) h += 360;
        hueHist[Math.min(359, Math.floor(h))] += C;
      }
      n++;
    }
  }

  Ls.sort((a, b) => a - b);
  const q = (p) => Ls[Math.min(Ls.length - 1, Math.floor(Ls.length * p))];
  const med = q(0.5);
  let hiSum = 0, hiN = 0, loSum = 0, loN = 0;
  for (const L of Ls) (L > med ? ((hiSum += L), hiN++) : ((loSum += L), loN++));

  // Dominant hue = the chroma-weighted circular mean, reported so the arc has
  // a centre and not just a width.
  let sx = 0, sy = 0;
  for (let h = 0; h < 360; h++) {
    const rad = ((h + 0.5) * Math.PI) / 180;
    sx += hueHist[h] * Math.cos(rad);
    sy += hueHist[h] * Math.sin(rad);
  }
  let domHue = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (domHue < 0) domHue += 360;

  return {
    name: basename(file, ".png"),
    valueSpread: q(0.95) - q(0.05),
    massSep: (hiN ? hiSum / hiN : 0) - (loN ? loSum / loN : 0),
    arc95: narrowestArc(hueHist, 0.95),
    arc100: narrowestArc(hueHist, 0.999),
    aboveChroma: (above / n) * 100,
    meanChroma: chromaSum / n,
    domHue,
  };
}

const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith(".png")).sort().map((f) => join(target, f))
  : [target];

console.log(`  region=${REGION}  chromaFloor=${CHROMA_FLOOR}  arcFloor=${ARC_FLOOR}`);
console.log(
  "  " +
    "shot".padEnd(26) +
    "valSpread  massSep   arc95  arc100  chroma>f   meanC   domHue",
);
console.log("  " + "-".repeat(84));
for (const f of files) {
  if (!existsSync(f)) continue;
  const r = analyse(resolve(f));
  console.log(
    "  " +
      r.name.padEnd(26) +
      r.valueSpread.toFixed(3).padStart(8) +
      r.massSep.toFixed(3).padStart(9) +
      `${r.arc95}°`.padStart(8) +
      `${r.arc100}°`.padStart(8) +
      `${r.aboveChroma.toFixed(1)}%`.padStart(10) +
      r.meanChroma.toFixed(4).padStart(9) +
      `${r.domHue.toFixed(0)}°`.padStart(9),
  );
}
console.log("");
