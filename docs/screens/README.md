# Screens

Captured from a live `npm run world` on 19 Aug 2026 at 1600×900, mock host, no
API key. Nothing is mocked up or composited: every frame is the running app.

| File | What it shows |
| ---- | ------------- |
| `01-ward-establishing.png` | The set. Plaza, three towers, ward wall, trees — all assembled at runtime from Kenney CC0 kit pieces, lit with soft shadows and GTAO ambient occlusion. The three seeded characters stand at their buildings. |
| `02-characters-speaking.png` | Okonkwo has walked across the plaza to Sera Vance and is snubbing her, in a speech bubble, with nameplates. The tick loop chose that; the surface only staged it. |
| `03-citation-resolved.png` | **The money shot.** Wren (blue nameplate, the visitor) returns after days away. Okonkwo greets them as an ally and the bubble prints the receipt: `✓ evt_mmn6gow0_0037` resolved against the append-only log. The feed on the left shows Sera Vance snubbing Wren for having taken the other side. |
| `04-mint-paste-a-sheet.png` | The mint panel: paste a character sheet as text. Keys are optional; a bare paragraph works. |
| `05-minted-npc-in-world.png` | Halric Vaas, Wharfmaster, seconds after being minted — standing in the plaza with his own body, alongside the seeded cast and the visitor. |
| `06-chat-surface-same-canon.png` | `npm run chat` attached to the **same running world**: same cast including the minted Halric Vaas, same visitor, and the same event id `evt_mmn6gow0_0037` with the same resolved receipt. Two surfaces, one canon. Real terminal output, rendered to PNG for legibility. |

## Voxel ward (`npm run voxel`)

| File | What it shows |
| ---- | ------------- |
| `07-voxel-ward-aerial.png` | The whole ward as voxels: three buildings, crenellated wall, cobble plaza, the well, and the worn path in from the gate. 100k voxels, ~9k triangles after greedy meshing. Faces are shaded by which way they point and each merged quad is tinted slightly differently — that is what stops it reading as flat coloured soup, and it costs no textures. |
| `08-voxel-first-person.png` | Eye level. Sera Vance outside the Ledger, nameplate readable, the lit and shaded faces of the building clearly different. |
| `09-voxel-dig-and-build.png` | A doorway torn straight through the Ledger's wall, with a mismatched plank patch where blocks were put back. Everything visible is real voxel data. A burst of edits like this becomes one `terrain_altered` event in the same append-only log the cast cites. |

## Scene archetypes

| File | What it shows |
| ---- | ------------- |
| `10-scene-council-chamber.png` | Trade Clash, opened from its own database. Onboarding chose `council_chamber` from the bible — nothing hardcoded it — and the cast is Ferrox, Cindra and Okuma with their real titles, standing at the long table. |
| `11-scene-tavern.png` | The default archetype: bar along the back, tables, the cast mid-beat. What an IP with no strong signal gets. |

## Honest notes

- The camera in 02, 03 and 05 was moved from the default — the same drag/scroll
  a viewer does. The default opening view is 01.
- In 03 the speaker's own nameplate sits behind his speech bubble. Cosmetic.
- The ground is a flat untextured plane. It reads a little bare in 01.
- The dialogue is rule-based mock prose and repeats over long runs. That is the
  placeholder, not a rendering problem — see README > "Placeholder: the Minds
  host".
- The voxel ward is flat-shaded with no textures. That is deliberate — a texture
  pipeline was out of scope — so it reads as early-Minecraft rather than
  Teardown. Face shading and per-quad tint are doing all the work.
- Interior scenes are lit by a single point light and it leaves a visible
  hotspot on the ceiling. The rooms are also fairly monochrome — material
  contrast is doing all the work and there are no textures.
- Terrain still terraces where the ground rises steeply. Three octaves of noise
  made the contours ragged rather than concentric, which is most of the fix
  available without a smarter heightfield.

---

## Technical audit (21 Aug 2026)

Measured with `npm run pixelstats -- docs/screens`. Raw numbers in `AUDIT.txt`.
This grades the FRAME, not the content — a shot can show exactly the right thing
and still be technically weak. Thresholds are the tool's: blown% over ~0.5%
reads as glare, crush% over ~10% means shadow detail is gone, saturation over
25% reads as cartoon, and a scene where every region has the same BR sign is a
scene lit by a single lamp.

**Reshoot before submitting. Nearly the whole set predates the tonal fix.**

| Shot | Verdict |
| ---- | ------- |
| `13-after-visual-pass` | **Broken.** 20.567% blown, 5.11% crushed, p99=253, sky a flat slab at L=251.8/edge=0.03. Kept only as the record of the regression that led to this tooling. Never ship it. |
| `01`–`05` (ward) | **Weak.** Saturation 33.5–36.1 against a 25 ceiling, and BR is negative in every region (−22 to −70), i.e. one temperature everywhere. Shot 19 Aug on the pre-fix lighting. Superseded by `14`. |
| `06-chat-surface` | **Weak.** L=21.6, p50=16. A terminal render is meant to be dark, but this is near-black in a deck and will vanish on a projector. |
| `10`, `11` (scenes) | **Weak.** sat 28.2 / 34.0, single-temperature. Superseded by `looks/council_chamber.png` and `looks/tavern.png`. |
| `07`–`09` (voxel) | **Mediocre.** L=149–160 with p50≈190 and p1=11–45: bright, low-contrast, no darks. `07` has a flat sky slab (top edge=0). |
| `14-ward-tonal-fix` | **Good.** L=100.6, sat 19.0, blown 0%, crush 0%, cool sky over warm ground. |
| `looks/*` | **Good.** All eight under 0.2% blown, 0% crushed, L 85–139, and genuinely different from each other. |

## Per-archetype looks (`npm run shots`)

Eight archetypes, one look profile each — own exposure, sky, sun, hemisphere,
ambient, fog, practicals and grade. Same code path, same geometry generator.

| File | L | sat% | BR (top / mid) | Reads as |
| ---- | - | ---- | -------------- | -------- |
| `looks/studio.png` | 139 | 8.2 | +0.7 / −35 | flat, neutral, artificial |
| `looks/market_plaza.png` | 136 | 18.8 | +42.3 / −24 | open daylight, cool sky |
| `looks/arena.png` | 116 | 14.0 | +19.1 / −8 | overcast, cold, crowd-grey |
| `looks/ballroom.png` | 120 | 17.8 | −10.8 / −39 | gold, soft, night outside |
| `looks/training_hall.png` | 108 | 21.8 | +21.5 / −17 | cool strip light, utilitarian |
| `looks/cafe.png` | 107 | 20.1 | −5.2 / −32 | soft daylight through glass |
| `looks/tavern.png` | 96 | 34.3 | −32.2 / −61.5 | firelit, close, warm |
| `looks/council_chamber.png` | 85 | 18.4 | +16.6 / −0.7 | cold, hard, high window |

The tavern is still the one over the saturation ceiling. That is deliberate —
it is the warmest room in the set by design — but it is the profile to pull back
first if a judge calls the palette cartoonish.
