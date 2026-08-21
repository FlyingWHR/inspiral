#!/usr/bin/env python3
"""
diagnose.py  --  point this at a screenshot of your scene.

    python3 diagnose.py frame.png [more.png ...]

It answers one question: is "brown and cream" a HUE problem or a VALUE problem?
Those need opposite fixes, and doing the wrong one wastes a day.

Outputs four numbers and a verdict, plus <name>-diagnosis.png showing the frame
desaturated and posterised to three masses.

Note on metric 3: hue statistics are computed only over pixels with chroma >= 0.03.
Without that floor, near-neutral pixels (whose hue angles are quantisation noise)
dominate by count, cancel each other out, and make a collapsed frame read as
healthy. See the comment at the metric.
"""
import sys, math
import numpy as np
from PIL import Image

M1 = np.array([[0.4122214708,0.5363325363,0.0514459929],
               [0.2119034982,0.6806995451,0.1073969566],
               [0.0883024619,0.2817188376,0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850,-0.0040720468],
               [1.9779984951,-2.4285922050, 0.4505937099],
               [0.0259040371, 0.7827717662,-0.8086757660]])

def analyse(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((640, 640))
    a = np.asarray(im).astype(float)/255.0
    lin = np.where(a <= 0.04045, a/12.92, ((a+0.055)/1.055)**2.4)
    lms = np.cbrt(lin @ M1.T)
    lab = lms @ M2.T
    L, A, B = lab[...,0], lab[...,1], lab[...,2]
    C = np.hypot(A, B)
    Hdeg = (np.degrees(np.arctan2(B, A))) % 360

    # --- 1. VALUE SPREAD -----------------------------------------------------
    p5, p95 = np.percentile(L, 5), np.percentile(L, 95)
    spread = p95 - p5
    # --- 2. VALUE SEPARATION: 1-D k-means (k=4) on L; report the smallest gap
    #        between adjacent cluster centres. This is the real "mush" test:
    #        a frame can have a wide spread and STILL be mush if the mass
    #        centres are bunched. -------------------------------------------
    f = L.flatten()
    cen = np.percentile(f, [12, 37, 63, 88]).astype(float)
    for _ in range(60):
        idx = np.argmin(np.abs(f[:,None] - cen[None,:]), axis=1)
        new = np.array([f[idx==k].mean() if (idx==k).any() else cen[k] for k in range(4)])
        if np.allclose(new, cen, atol=1e-5): break
        cen = np.sort(new)
    gaps = np.diff(np.sort(cen))
    mingap = float(gaps.min())
    shares = [float((idx==k).mean()) for k in range(4)]
    # --- 3. HUE CONVERGENCE --------------------------------------------------
    #  CHROMA FLOOR. Near-neutral pixels have essentially arbitrary hue angles
    #  (8-bit quantisation puts them anywhere on the wheel at C ~ 0.002-0.01).
    #  There are usually a LOT of them, and because their hues are incoherent
    #  they sum to nearly nothing and drag the concentration measure DOWN --
    #  making a genuinely collapsed frame look healthy. Chroma weighting alone
    #  does not fix this. So we exclude anything below C_FLOOR outright.
    #  Reported alongside: what fraction of the frame survived the floor.
    C_FLOOR = 0.03
    Cf, Hf = C.flatten(), Hdeg.flatten()
    keep = Cf >= C_FLOOR
    coverage = float(keep.mean())
    w, hh = Cf[keep], np.radians(Hf[keep])
    if w.size == 0 or w.sum() < 1e-6:
        conc, meanhue, arc, arc95 = 0.0, 0.0, 0.0, 360.0
    else:
        vx, vy = (w*np.cos(hh)).sum(), (w*np.sin(hh)).sum()
        conc = math.hypot(vx, vy)/w.sum()          # 0 = hues cancel, 1 = single hue
        meanhue = math.degrees(math.atan2(vy, vx)) % 360
        d = np.abs((Hf[keep] - meanhue + 180) % 360 - 180)
        arc = w[d < 30].sum()/w.sum()              # share within +-30 deg of mean
        # arc95: the angular width, centred on the mean hue, holding 95% of the
        # surviving chroma. More interpretable than the +-30 share: it answers
        # "how wide is the wedge my colour actually lives in?"
        order = np.argsort(d)
        cw = np.cumsum(w[order])/w.sum()
        arc95 = 2.0*float(d[order][np.searchsorted(cw, 0.95)])
    # --- 4. CHROMA BUDGET ----------------------------------------------------
    meanC, p99C = C.mean(), np.percentile(C, 99.5)
    hot = (C > 0.11).mean()

    print(f"\n=== {path}")
    print(f" 1 value spread  (P95-P05 OKLab L) : {spread:.3f}   want > 0.45")
    print(f" 2 value separation (min gap between the 4 mass centres)")
    print(f"                                   : {mingap:.3f}   want > 0.060")
    print(f"   mass centres L = {', '.join(f'{c:.2f}' for c in np.sort(cen))}"
          f"   area share = {', '.join(f'{s*100:.0f}%' for s in shares)}")
    print( "   (k=4 on a deliberately 3-mass image will split one mass; read the")
    print( "    centres, not just the number. A tight pair at the TOP usually means")
    print( "    your sky and your lit roof planes are the same value.)")
    print(f" 3 hue convergence (chroma-weighted, C>={C_FLOOR:.2f}): {conc:.2f}   want < 0.55")
    print(f"   arc95 = {arc95:5.0f} deg  (wedge holding 95% of chroma)   want > 120 deg")
    print(f"   mean hue {meanhue:6.1f} deg   share within +-30 deg: {arc*100:.0f}%   want < 60%")
    print(f"   coverage above the chroma floor: {coverage*100:.1f}% of frame")
    if coverage < 0.05:
        print( "   !! under 5% of the frame clears C=0.03. The hue numbers above are")
        print( "      computed on a sliver of the image -- treat them as unreliable and")
        print( "      read metric 4 instead: this frame is essentially achromatic.")
    print(f" 4 chroma: mean {meanC:.3f}  P99.5 {p99C:.3f}  area above C=0.11: {hot*100:.1f}%")
    print(f"                                   want mean < 0.075, P99.5 > 0.13, hot area 1-6%")

    verdict = []
    if spread < 0.45 or mingap < 0.060:
        verdict.append("VALUE. Masses are crowded. Fix the value ladder first; "
                       "no hue change will help until this is fixed.")
    if (conc > 0.55 or arc > 0.60 or arc95 < 120) and (hot < 0.005 or p99C < 0.13):
        verdict.append(f"HUE. 95% of the frame's chroma sits in a {arc95:.0f}-deg wedge around "
                       f"{meanhue:.0f} deg, and there is no accent breaking out of it. "
                       f"Introduce a counter-temperature mass.")
    elif conc > 0.55 or arc > 0.60 or arc95 < 120:
        verdict.append(f"(note: hue is concentrated at {meanhue:.0f} deg, but the accent is "
                       f"carrying. Monochrome-by-design, not a fault.)")
    if meanC > 0.075:
        verdict.append("CHROMA SPREAD. Saturation is spread evenly instead of "
                       "concentrated. Desaturate the architecture, spend it on accents.")
    if hot < 0.005 or p99C < 0.13:
        verdict.append("NO ACCENT. Nothing in frame is saturated enough to be a focal point.")
    print(" ->", " | ".join(verdict) if verdict else "clean on all four measures.")

    g = np.clip(np.where(lin<=0.0031308, lin*12.92, 1.055*lin**(1/2.4)-0.055),0,1)
    Y = (lin*np.array([0.2126,0.7152,0.0722])).sum(-1)
    ys = np.clip(np.where(Y<=0.0031308, Y*12.92, 1.055*Y**(1/2.4)-0.055),0,1)*255
    t1,t2 = np.percentile(ys,34), np.percentile(ys,67)
    post = np.choose(np.digitize(ys,[t1,t2]), [40,130,225]).astype(np.uint8)
    out = Image.new("RGB",(im.width*3, im.height))
    out.paste(im,(0,0))
    out.paste(Image.fromarray(np.dstack([ys.astype(np.uint8)]*3)),(im.width,0))
    out.paste(Image.fromarray(np.dstack([post]*3)),(im.width*2,0))
    name = path.rsplit(".",1)[0] + "-diagnosis.png"
    out.save(name); print(f"    wrote {name}  (original | desaturated | 3 masses)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    for p in sys.argv[1:]:
        analyse(p)
