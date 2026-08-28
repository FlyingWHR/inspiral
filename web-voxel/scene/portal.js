/**
 * PIECES IN THE VOXEL WORLD.
 *
 * A piece is the only object in a world that is not made of blocks and not
 * lit by the world's rig. It is light entering from somewhere else, so it is
 * additive, unfogged, billboarded, and it casts a small violet spill onto the
 * ladder colours around it.
 *
 * WHY THE PIECE COLOURS ARE NOT IN palette.js. The colour study fixed a real
 * defect -- nine of twelve materials between hue 40 and 89, diagnose.py
 * returning "NO ACCENT" on four frames -- and the fix was a ladder where
 * saturation is a currency spent in one or two slots per world. Violet and
 * acid at full chroma are far outside that budget. Putting them in the ladder
 * would hand every wall permission to shout again and would make the palette
 * measurements meaningless. They live here instead, they are never a block
 * colour, and `blockColorsFor()` never returns them. Rule R3's carve-out for
 * BACKDROP is the precedent: some colours are not materials.
 *
 * The canvases come from ./inspiral-portal.js so the browser hero and the
 * in-world piece are the same artwork, not two drifting copies of it.
 *
 * That module lives in web-voxel/scene because this directory is already the
 * shared one: webSurface serves it at /shared/, and the look profiles, sky
 * dome and grade shader are here for the same reason. The web surface loads
 * the portal from /shared/ too, so there is exactly one copy of the bake.
 */

import * as THREE from "three";
import { bakePortalLayers, PIECE_COLORS } from "./inspiral-portal.js";

export { PIECE_COLORS };

/**
 * Build a piece.
 *
 * @param {object}  opts
 * @param {number}  opts.depth   Generation count from the pieces repo. The only
 *                               content input: it sets how tightly the arms wrap.
 * @param {number}  opts.seed    Stable per piece (hash the piece id) so a piece
 *                               looks the same on every visit.
 * @param {number}  opts.size    World units across.
 * @param {boolean} opts.settling  True for a few hours after a new generation
 *                               lands: the outer shell reads brighter, which is
 *                               how a returning author notices before being told.
 * @returns {THREE.Group} with `update(t, camera)` attached.
 */
export function createPiece({ depth = 6, seed = 0, size = 3.2, settling = false } = {}) {
  const layers = bakePortalLayers({ radius: 160, depth, seed });
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(size, size);
  const shells = [];

  layers.forEach((L, i) => {
    const tex = new THREE.CanvasTexture(L.cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.center.set(0.5, 0.5);
    const outermost = i === layers.length - 1;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Unfogged on purpose: fogging a piece makes it read as scenery at range,
      // and the whole point is that you can see one across a ward.
      fog: false,
      opacity: L.alpha * (settling && outermost ? 1.45 : 1),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10 + i;
    group.add(mesh);
    shells.push({ tex, om: L.om });
  });

  const light = new THREE.PointLight(PIECE_COLORS.violet, 9, 18, 2);
  group.add(light);

  group.userData.isPiece = true;
  group.update = (t, camera) => {
    if (camera) group.lookAt(camera.position);
    for (const s of shells) s.tex.rotation = -t * s.om;
    light.intensity = 9 * (0.85 + 0.15 * Math.sin(t * 1.7 + seed));
  };

  return group;
}

/** Stable seed from a piece id, so a piece is the same object every visit. */
export function seedFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 1000) / 100;
}
