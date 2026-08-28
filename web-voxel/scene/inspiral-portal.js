/**
 * INSPIRAL PORTAL — the hero animation, as a drop-in custom element.
 *
 *   <script type="module" src="/inspiral-portal.js"></script>
 *   <inspiral-portal depth="12" seed="8.8" speed="1"></inspiral-portal>
 *
 * The element fills its container; give the container a size. One <canvas>,
 * no dependencies, no WebGL.
 *
 * HOW IT WORKS, so it is safe to tune. The spiral is not drawn per frame.
 * On first paint each portal bakes LN offscreen canvases -- one soft annular
 * shell each, containing two log-spiral arms (one acid, one violet) stroked
 * three times: wide glow, body, bright core. Per frame the element only
 * composites those shells with additive blending, each rotating at its own
 * angular speed, so the inner shells shear past the outer ones and the two
 * fluids fold without ever mixing. That is four drawImage calls per portal per
 * frame; a page with a dozen of them stays at full frame rate.
 *
 * The bake is cached on (radius, depth, seed, colours). Changing `depth` at
 * runtime rebakes once, which is what a piece gaining a generation should do.
 *
 * DEPTH IS THE ONLY CONTENT INPUT. It is the generation count of the piece:
 * `wind` below turns it into how many times the arms wrap. A one-generation
 * piece is one lazy turn you can see through; twelve is a dense body legible
 * across a room. Never render the number itself.
 */

export const PIECE_COLORS = { violet: '#B14CFF', acid: '#C8FF2E' };

const TAU = Math.PI * 2;
const bakeCache = new Map();

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Soft radial dot, used only for the core bloom. */
function sprite(hex) {
  const key = 'sprite:' + hex;
  if (bakeCache.has(key)) return bakeCache.get(key);
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d');
  const [r, gr, b] = rgb(hex);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(${r},${gr},${b},1)`);
  grd.addColorStop(0.16, `rgba(${r},${gr},${b},0.72)`);
  grd.addColorStop(0.42, `rgba(${r},${gr},${b},0.3)`);
  grd.addColorStop(0.72, `rgba(${r},${gr},${b},0.07)`);
  grd.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  bakeCache.set(key, s);
  return s;
}

/**
 * Bake the shells. Exported because the three.js side needs the same canvases
 * as textures -- see web-voxel/scene/portal.js. Keep the two in step by
 * importing this, never by copying it.
 */
export function bakePortalLayers({ radius = 240, depth = 6, seed = 0, violet = PIECE_COLORS.violet, acid = PIECE_COLORS.acid } = {}) {
  const key = [Math.round(radius / 12), depth, seed, violet, acid].join('|');
  if (bakeCache.has(key)) return bakeCache.get(key);

  const S = Math.max(180, Math.min(560, Math.round(radius * 2)));
  const half = S / 2;
  const LN = 4;              // shells; more reads muddier, fewer reads striped
  const arms = 2;            // two fluids, one each
  const wind = 1.15 + depth * 0.13;
  // [lineWidth x half, alpha, blur x S] -- glow, body, core.
  const passes = [[0.15, 0.16, 0.05], [0.055, 0.4, 0.018], [0.02, 0.9, 0.006]];
  const list = [];

  for (let i = 0; i < LN; i++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    c.translate(half, half);
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    for (let m = 0; m < arms; m++) {
      for (let sub = -1; sub <= 1; sub += 2) {
        const ph = (m * TAU) / arms + sub * 0.22 + seed * 1.7 + i * 0.8;
        const path = [];
        for (let s = 0; s <= 80; s++) {
          const p = s / 80;
          const rr = 0.05 + 0.95 * Math.pow(p, 0.85);
          const ang = ph + wind * TAU * Math.pow(rr, 0.5)
            + 0.22 * Math.sin(p * 4.3 + seed + i) + sub * 0.12 * p;
          path.push(Math.cos(ang) * rr * half, Math.sin(ang) * rr * half);
        }
        c.strokeStyle = m % 2 === 0 ? acid : violet;
        for (const [lw, al, bl] of passes) {
          c.filter = `blur(${Math.max(0.6, S * bl).toFixed(1)}px)`;
          c.globalAlpha = al * (sub < 0 ? 1 : 0.7);
          c.lineWidth = half * lw;
          c.beginPath();
          c.moveTo(path[0], path[1]);
          for (let z = 2; z < path.length; z += 2) c.lineTo(path[z], path[z + 1]);
          c.stroke();
        }
      }
    }

    // Feathered annulus mask: this shell keeps only its own radial band, which
    // is what lets the shells rotate past each other without tearing.
    const r0 = i / LN, r1 = (i + 1) / LN, f = 0.55 / LN;
    c.filter = 'none';
    c.globalCompositeOperation = 'destination-in';
    c.globalAlpha = 1;
    const grd = c.createRadialGradient(0, 0, 0, 0, 0, half);
    const stops = [[0, 0], [Math.max(0.001, r0 - f), 0], [r0 + f * 0.4, 1],
      [Math.max(r0 + f * 0.5, r1 - f * 0.4), 1], [Math.min(1, r1 + f), 0], [1, 0]];
    let prev = -1;
    for (const [pos, a] of stops) {
      const pc = Math.min(1, Math.max(0, pos));
      if (pc <= prev) continue;
      prev = pc;
      grd.addColorStop(pc, `rgba(0,0,0,${a})`);
    }
    c.fillStyle = grd;
    c.fillRect(-half, -half, S, S);

    const mid = (r0 + r1) / 2;
    list.push({
      cv,
      // Inner shells turn faster. This differential is the whole fluid read.
      om: 0.12 + 0.62 * Math.pow(0.42 / (mid + 0.2), 1.15),
      alpha: 0.3 + 0.5 * Math.sin(Math.PI * Math.pow(mid, 0.55)),
    });
  }

  bakeCache.set(key, list);
  return list;
}

/** One shared rAF for every portal on the page. */
const live = new Set();
let raf = 0;
let t0 = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  const t = (now - t0) / 1000;
  for (const el of live) el._frame(t);
}
function join(el) {
  live.add(el);
  if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(loop); }
}
function leave(el) {
  live.delete(el);
  if (!live.size && raf) { cancelAnimationFrame(raf); raf = 0; }
}

export class InspiralPortal extends HTMLElement {
  static observedAttributes = ['depth', 'seed', 'speed', 'violet', 'acid'];

  connectedCallback() {
    if (!this.canvas) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = '<style>:host{display:block;line-height:0}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>';
      this.canvas = this.shadowRoot.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
    this.io = new IntersectionObserver((es) => { es[0].isIntersecting ? join(this) : leave(this); }, { rootMargin: '160px' });
    this.io.observe(this);
  }

  disconnectedCallback() {
    leave(this);
    if (this.io) this.io.disconnect();
  }

  attributeChangedCallback() { this._layers = null; }

  _frame(t) {
    const el = this.canvas;
    const w = this.clientWidth, h = this.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (el.width !== Math.round(w * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }

    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);

    const depth = +(this.getAttribute('depth') || 6);
    const seed = +(this.getAttribute('seed') || 0);
    const spd = +(this.getAttribute('speed') || 1);
    const violet = this.getAttribute('violet') || PIECE_COLORS.violet;
    const acid = this.getAttribute('acid') || PIECE_COLORS.acid;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.46;
    // Small portals get proportionally more light so a 76px index thumbnail
    // and a 700px hero read as the same material.
    const k = Math.pow(Math.min(1, 300 / R), 0.35);
    const layers = this._layers || (this._layers = bakePortalLayers({ radius: R, depth, seed, violet, acid }));

    g.save();
    g.beginPath();
    g.ellipse(cx, cy, R, R, 0, 0, TAU);
    g.clip();
    g.translate(cx, cy);
    g.globalCompositeOperation = 'lighter';
    for (const L of layers) {
      g.save();
      g.rotate(-t * spd * L.om);
      g.globalAlpha = L.alpha * k;
      g.drawImage(L.cv, -R, -R, R * 2, R * 2);
      g.restore();
    }
    const core = R * (0.3 + 0.02 * Math.sin(t * spd * 0.9 + seed));
    g.globalAlpha = 0.22 * k;
    g.drawImage(sprite(violet), -core, -core, core * 2, core * 2);
    g.globalAlpha = 0.09 * k;
    g.drawImage(sprite(acid), -core * 0.5, -core * 0.5, core, core);
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

if (!customElements.get('inspiral-portal')) customElements.define('inspiral-portal', InspiralPortal);
