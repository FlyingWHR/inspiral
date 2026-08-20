# Screens

Every frame here is the running application, captured by driving its real UI.
Nothing is mocked up, staged or composited. All of it is reproducible:

```bash
npm run shots:ward     # 01-05, clicked through the actual interface
npm run shots:voxel    # 07-09
npm run shots          # the eight archetype looks
npm run pixelstats -- docs/screens
```

## The ward (`npm run world`)

| File | What it shows |
| ---- | ------------- |
| `01-ward-establishing.png` | The set. Plaza, three towers, ward wall, market stalls, treeline — assembled at runtime from Kenney CC0 kit pieces, under the `market_plaza` look profile. The three seeded characters stand at their buildings. |
| `02-characters-speaking.png` | A beat, staged. The tick loop chose who acts and what they do; the surface only put it on screen. |
| `03-citation-resolved.png` | **The money shot.** Wren took Okonkwo's side in public, left, and the world ran fifteen beats without them. On return Okonkwo says *"You took my side in public when it cost you something to do it"* — second person, because canon records the moment in the third and the speaker converts it — and the bubble prints the receipt: `✓ evt_mmeltkw0_001i`, resolved live against the append-only log. |
| `04-mint-paste-a-sheet.png` | The mint panel: paste a character sheet as text. Keys are optional; a bare paragraph works. |
| `05-minted-npc-in-world.png` | Halric Vaas, Wharfmaster, seconds after being minted — standing in the plaza with his own body, alongside the seeded cast and the visitor. |
| `06-chat-surface-same-canon.png` | `npm run chat` attached to the **same running world**: same cast, same visitor, same event id with the same resolved receipt. Two surfaces, one canon. |

## The voxel ward (`npm run voxel`)

| File | What it shows |
| ---- | ------------- |
| `07-voxel-ward-aerial.png` | The whole ward as voxels — three buildings, crenellated wall, cobble plaza, the worn path in from the gate. ~100k voxels, ~9k triangles after greedy meshing. Faces are shaded by orientation and each merged quad is tinted slightly differently, which is what stops it reading as flat coloured soup, and it costs no textures. |
| `08-voxel-first-person.png` | Eye level, with the themed build palette in the hotbar and the archetype's build brief bottom-left. |
| `09-voxel-dig-and-build.png` | A player edit going in. Everything visible is real voxel data, and the edit travels the same path a click does — into canon, where the cast can cite it. |

## Per-archetype looks (`npm run shots`)

Eight archetypes, one look profile each: its own exposure, sky, sun, hemisphere,
ambient, fog, practicals and colour grade. Same generator, same code path.
**The tavern-against-council-chamber cut is the strongest visual argument in the
project** — it shows one system producing genuinely different worlds rather than
one ward relit.

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

## Technical audit (21 Aug 2026)

Measured with `npm run pixelstats`. Raw numbers in `AUDIT.txt`. This grades the
FRAME, not the content — a shot can show exactly the right thing and still be
technically weak. Thresholds are the tool's: blown% over ~0.5% reads as glare,
crush% over ~10% means shadow detail is gone, saturation over 25 reads as
cartoon, and a scene where every region shares one BR sign is lit by one lamp.

An audit of the previous set failed nearly all of it — the ward shots ran
33.5–36.1% saturation with a negative BR in every region, and the voxel shots
sat at L=149–160 with no darks at all. Every one has been re-captured.

| Shot | L | sat% | blown% | crush% | previously |
| ---- | - | ---- | ------ | ------ | ---------- |
| `01-ward-establishing` | 99.5 | 18.9 | 0 | 0 | sat 34.2 |
| `02-characters-speaking` | 99.4 | 18.9 | 0 | 0 | sat 36.1 |
| `03-citation-resolved` | 98.2 | 18.9 | 0 | 0 | sat 34.5 |
| `04-mint-paste-a-sheet` | 92.6 | 19.1 | 0 | 0 | sat 33.7 |
| `05-minted-npc-in-world` | 99.4 | 18.9 | 0 | 0 | sat 33.5 |
| `07-voxel-ward-aerial` | 143 | 10.7 | 0.021 | 0 | L=156.5, p1=45, flat sky |
| `08-voxel-first-person` | 135.7 | 18.8 | 0.021 | 0 | L=160.5 |
| `09-voxel-dig-and-build` | 139.6 | 13.9 | 0.021 | 0.02 | L=149.3 |

`10` and `11` are gone — the eight measured `looks/` frames supersede them.

`06-chat-surface-same-canon` measures L=21.6 and is kept anyway. It is a
terminal capture and a terminal is dark by nature; the thresholds above are
calibrated for rendered frames. The risk there is a bright projector, not tone —
reshoot it with a light terminal theme if the room demands it.

`12-before-visual-pass` and `13-after-visual-pass` are kept **only** as the
record of a regression. `13` was shipped and described as an improvement while
20.6% of its pixels were blown to white and its sky was a featureless slab at
L=251.8. Neither belongs in the film. They are the reason this tooling exists.

### How 03 got its receipt back

Three attempts at timing the money shot with a fixed delay produced, in order:
the right beat with no receipt, an empty plaza because the bubble had already
faded, and an unrelated character spreading a rumour. The world does not wait
for the screenshotter. The capture now blocks on `.cite` — the element that
renders the resolved event id — and takes the frame when the receipt is actually
on screen.

## Honest notes

- The camera in 02, 03 and 05 is the default opening view; only 07 and 09 place
  the player deliberately, and they do it by moving the player body through the
  surface's own controller, not by teleporting the camera.
- The voxel ward is flat-shaded with no textures. Deliberate — a texture
  pipeline was out of scope — so it reads as early-Minecraft rather than
  Teardown. Face shading, per-quad tint and the look profiles do the work.
- The tavern is the one profile above the 25% saturation ceiling, at 34.3. That
  is intentional — it is the warmest room in the set — but it is the first thing
  to pull back if a judge calls the palette cartoonish.
- Terrain still terraces where the ground rises steeply.
- With the mock host the dialogue is rule-based and repeats over long runs.
  Against a live Mind the lines are written by the model; `npm run authorship`
  prints the ratio.
