# RUNBOOK — the 60-second demo video

Everything below runs on the mock host. **No API key, no network, no build
step.** Same seed, same history, so you can rehearse a shot and get it again.

## Before you record

```bash
cd ~/ProjectW/Inspiral
npm install                 # once
npm test                    # 56 passing -- sanity check
```

Two terminals and a browser. Terminal A runs the world, terminal B runs the text
surface, the browser shows the ward.

Useful controls while filming:

| Control | Effect |
| ------- | ------ |
| `P` | **Hold** the world on the current line. The status pill reads `held`. Use it on the citation. |
| drag | orbit the camera |
| scroll | zoom |

---

## Shot order

### Shot 1 — the pitch, in the terminal (0:00–0:12)

```bash
npm run demo
```

Six world days in about two seconds, exits 0. Let it run to the end and hold on
the **VERIFICATION** block:

```
  OK    Tomas Okonkwo cited evt_...
        day 2 · initiator: Tomas Okonkwo · type: visitor_recognized
  2 citation(s) resolved to real events in the append-only log.
```

Say: *"Three NPCs, six days of history, nobody watching. Every complaint they
make is checked against an append-only log."*

### Shot 2 — the ward exists (0:12–0:22)

Terminal A:

```bash
npm run world -- --every 6 --warm 24
```

Open <http://localhost:8787>. Orbit once. Three towers, three named NPCs in the
plaza, walking to each other and speaking.

`--warm 24` runs 24 ticks before the browser opens, so the ward already has four
days of grudges when the judge first sees it. Cold start is solved off-camera.

Say: *"This is the same simulation. The browser is just a display."*

### Shot 3 — the money shot: you are remembered (0:22–0:40)

In the browser, bottom right:

1. **Walk into the ward** → the cast greets a stranger.
2. **Back Okonkwo, in public** → Okonkwo claims you; Vance stops being polite.
3. **Leave** → the button becomes *Come back to the ward*.
4. Wait ~30 seconds of real time (≈ 5 world days of ticks).
5. **Come back to the ward.**

Okonkwo greets you as an ally, tells you what Vance did while you were gone, and
the bubble prints the receipts:

```
✓ evt_mmf2yv40_001l — Tomas Okonkwo made a claim on Wren: ...
✓ evt_mmeltkw0_001e — Sera Vance confronted Tomas Okonkwo: ...
```

**Press `P` here.** Hold on the green ticks for a full three seconds — this is
the single most important frame in the video.

Say: *"He is not improvising. Those are event ids, resolved live against the
log. The world remembered a choice you made five days ago."*

### Shot 4 — mint a character on camera (0:40–0:52)

**Mint a character…** → the textarea is pre-filled with Halric Vaas. Edit the
name to something the audience picks, then **Mint into the ward**.

A fourth NPC walks in. Within two ticks he is acting against people whose
history predates him.

Say: *"Paste a character sheet, get an inhabitant. He inherits canon he was
never part of."*

### Shot 5 — the engine is not the world (0:52–1:00)

Terminal B, with the world still running:

```bash
npm run chat
```

Same cast, same canon, same beats, as text — including the same `✓ evt_…`
citations. Put the terminal beside the browser.

Say: *"Same world, second surface, no engine. The simulation is not the
renderer — swapping the display costs one file."*

---

## Fallbacks

| If | Do |
| -- | -- |
| The return greeting has no citation | The visitor left too recently. Leave, wait ~30s, come back. Citations need history to have happened while you were away. |
| Beats feel slow | `npm run world -- --every 3`. Beats queue and stage one at a time by design. |
| The browser tab was backgrounded and everything froze | `requestAnimationFrame` throttles in background tabs. Front the tab; it resumes. |
| You want a clean slate | Restart `npm run world`. The world is in memory unless you pass `--persist`. |
| You want the same run twice | It already is: `--seed 1` is the default and is deterministic. |
| Port 8787 is taken | `npm run world -- --port 9000`, then `npm run chat -- --port 9000`. |
| No browser at all | `npm run chat -- --solo` runs a private world entirely in the terminal. |

## Flags worth knowing

```bash
npm run demo -- --days 10 --verbose     # longer, with every line of dialogue
npm run world -- --every 6 --warm 24    # tick cadence (s) and pre-run ticks
npm run world -- --persist              # write ./data/world.db instead of memory
npm run chat -- --solo                  # text surface, private world, no browser
```
