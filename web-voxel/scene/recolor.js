/**
 * RE-SKIN THE KIT ATLAS ONTO THE VALUE LADDER.
 *
 * The voxel worlds took the colour system by assigning block slots. The ward
 * could not: it is built from Kenney kit GLBs, and every piece samples one
 * shared 512x512 palette atlas with 254 colours baked into it. Per-material
 * tinting does nothing when forty meshes share one texture.
 *
 * So the atlas itself gets remapped, once, at load. Every distinct colour in it
 * is measured in OKLab, matched to the nearest tier of the ladder, and replaced
 * by the palette slot that owns that tier. The kit's VALUE STRUCTURE survives
 * intact -- a Kenney roof is still darker than a Kenney wall -- while its hue is
 * replaced wholesale. That is the ladder being absolute, applied to geometry we
 * did not author.
 *
 * Why it matters: without this the film has two visual families. Shots 01-05 are
 * the ward in Kenney's primaries, shots 07-09 and the eight looks are the
 * colour system. A design panel notices that immediately and usually cannot say
 * why.
 */

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oklab(r8, g8, b8) {
  const r = srgbToLinear(r8 / 255), g = srgbToLinear(g8 / 255), b = srgbToLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C: Math.hypot(A, B), h };
}

/**
 * Tiers in ladder order. Each carries the slots that live at that value, so a
 * tier with three variants can keep three visually distinct materials distinct
 * instead of flattening them into one.
 */
const TIERS = [
  { L: 0.19, slots: ["void"] },
  { L: 0.32, slots: ["groundA", "groundB"] },
  { L: 0.48, slots: ["structA", "structB", "structC"] },
  { L: 0.64, slots: ["fieldA", "fieldB"] },
  { L: 0.8, slots: ["highA", "highB"] },
];

/**
 * Map one source colour to a palette hex.
 *
 * Saturated source colours are routed to the accents rather than to a tier: a
 * Kenney flag or awning is already doing the job accentHot exists for, and
 * flattening it into `fieldA` would throw away the one focal point the kit
 * gives us. The chroma gate is deliberately high so only genuinely saturated
 * swatches qualify -- rule R5, saturation is a currency.
 */
function mapColor(r, g, b, slots) {
  const { L, C, h } = oklab(r, g, b);

  if (C > 0.13) {
    if (L > 0.78 && h > 40 && h < 110) return slots.emissive;
    if (h < 100 || h > 330) return slots.accentHot;
    if (h > 170 && h < 290) return slots.accentCool;
  }

  let best = TIERS[0], bestD = Infinity;
  for (const t of TIERS) {
    const d = Math.abs(t.L - L);
    if (d < bestD) { bestD = d; best = t; }
  }
  // Within a tier, pick the variant from the SOURCE hue so materials that were
  // different in the kit stay different here. Deterministic, so the atlas is
  // byte-identical between runs and a re-shoot is comparable.
  const idx = Math.floor((h / 360) * best.slots.length) % best.slots.length;
  return slots[best.slots[idx]];
}

/**
 * Build a recoloured copy of an atlas image.
 *
 * `image` is anything drawable to a canvas (HTMLImageElement, ImageBitmap).
 * Returns a canvas ready to hand to THREE.CanvasTexture.
 */
export function recolorAtlas(image, slots) {
  const w = image.width, h = image.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, w, h);
  const d = px.data;

  // 254 distinct colours over 262144 pixels: cache by packed RGB and the whole
  // remap costs a few hundred conversions instead of a quarter of a million.
  const cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      out = mapColor(d[i], d[i + 1], d[i + 2], slots);
      cache.set(key, out);
    }
    d[i] = (out >> 16) & 255;
    d[i + 1] = (out >> 8) & 255;
    d[i + 2] = out & 255;
  }
  ctx.putImageData(px, 0, 0);
  return canvas;
}

/**
 * Procedural ground, drawn from palette slots instead of hand-picked hex.
 * Returns a canvas; the caller wraps it in a texture.
 */
export function groundCanvas(baseHex, speckHexes, size = 256) {
  const hex = (n) => "#" + n.toString(16).padStart(6, "0");
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = hex(baseHex);
  g.fillRect(0, 0, size, size);
  // Deterministic speckle: the same ground every load, so screenshots compare.
  let seed = 1337;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.globalAlpha = 0.5;
  for (let i = 0; i < size * 14; i++) {
    g.fillStyle = hex(speckHexes[Math.floor(rand() * speckHexes.length)]);
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  g.globalAlpha = 1;
  return c;
}
