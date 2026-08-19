# RUNBOOK — the 60-second demo video

Everything below runs on the mock host. **No API key, no network, no build
step.** Same seed, same history, so you can rehearse a shot and get it again.

## The clock must already be running

The strongest thing in the submission is history nobody watched accumulate, and
it cannot be faked on the day. Check it days ahead, and again before you film:

```bash
npm run clock:status     # want: clock RUNNING, days elapsed climbing
```

If it says `not running`:

```bash
nohup npm run clock -- --every 180 --budget 12 > data/clock.log 2>&1 &
```

Never point a demo at `data/canon.db`. The demos are in-memory by design; the
clock's database is the one artefact in this repo that cannot be regenerated.

## Before you record

```bash
cd ~/ProjectW/Inspiral
npm install                 # once
npm test                    # 56 passing -- sanity check
```

Two terminals and a browser. Terminal A runs the world, terminal B runs the text
surface, the browser shows the ward.

**Which surface each shot uses.** There are two visual surfaces and they are
filmed on different ports. Shots 1–5 are the three.js ward, which is the older
and safer one. Shot 6 is the voxel ward and is the closing beat.

| Shot | Surface | Command | Port |
| ---- | ------- | ------- | ---- |
| 1 the pitch | terminal | `npm run demo` | — |
| 2 the ward | three.js | `npm run world` | 8787 |
| 3 the money shot | three.js | (same window) | 8787 |
| 4 mint on camera | three.js | (same window) | 8787 |
| 5 an IP walks in | terminal | `npm run onboard` | — |
| **5b what a Mind is for** | terminal | **`npm run prove`** | — |
| 6 post → reaction | terminal | `npm run ingest --post` | — |
| 7 second surface | terminal | `npm run chat` | attaches to 8787 |
| 8 closing beat | **voxel** | `npm run voxel` | **8788** |

All of them can run at once — different ports, different databases, no
conflict. Shots 5 and 6 use `./data/tradeclash.db`, which is separate from both
the ward demos and from the clock's `./data/canon.db`.

Useful controls while filming:

| Control | Effect |
| ------- | ------ |
| `P` | **Hold** the world on the current line. The status pill reads `held`. Use it on the citation. |
| drag | orbit the camera |
| scroll | zoom |

---

## Shot order

Eight beats in sixty seconds is tight. If you need room, the two that carry the
most weight are **3** (a character citing a real event id) and **6** (you post
something and the world quotes it back). Shot 7 is the cheapest to drop and
shot 4 is the next cheapest.


### Shot 1 — the pitch, in the terminal (0:00–0:08)

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

### Shot 2 — the ward exists (0:08–0:16)

Terminal A:

```bash
npm run world -- --every 6 --warm 24
```

Open <http://localhost:8787>. Orbit once. Three towers, three named NPCs in the
plaza, walking to each other and speaking.

`--warm 24` runs 24 ticks before the browser opens, so the ward already has four
days of grudges when the judge first sees it. Cold start is solved off-camera.

Say: *"This is the same simulation. The browser is just a display."*

### Shot 3 — the money shot: you are remembered (0:16–0:30)

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

### Shot 4 — mint a character on camera (0:30–0:36)

**Mint a character…** → the textarea is pre-filled with Halric Vaas. Edit the
name to something the audience picks, then **Mint into the ward**.

A fourth NPC walks in. Within two ticks he is acting against people whose
history predates him.

Say: *"Paste a character sheet, get an inhabitant. He inherits canon he was
never part of."*

### Shot 5 — an IP walks in and becomes a cast (0:36–0:42)

A clean terminal. This is a different world from the ward — nothing above is
disturbed.

```bash
npm run onboard -- --fixture tradeclash --reset
```

~3 seconds. Hold on the output: three named leaders with titles and factions,
two open storylines, existing lore that has become **citable day-zero events**,
and the tone rules. Then the gate line:

```
[gate] non-interactive: approved automatically.
status:       seeded      cast: ferrox, cindra, okuma
```

Hold on the scene line too — it is the difference between opening *a* world and
opening the *right* one:

```
scene:  The Council Chamber (heuristic) — procedure as a weapon: standing,
        precedent, and things minuted that cannot be unsaid
```

Say: *"That is a real IP's handles going in and a living cast coming out — and
it picked the room. A trade war belongs in a council chamber, not a tavern. The
owner approves all of it before any of it becomes canon."*

To show it in 3D, `npm run voxel -- --db ./data/tradeclash.db` opens that world
in its own chamber.

### Shot 5b — the answer to the hardest question (0:42–0:50)

**Film this one even if you cut something else.** The sharpest thing a judge can
ask is not "is this an LLM in a for-loop". It is: *your own repo runs with the
host switched off — show me one thing that needs a Mind.*

```bash
INSPIRAL_HOST=minds npm run prove
```

~60–90 seconds, one invocation. It onboards the same un-hinted source twice —
once with no host, once against a live Mind — and prints both bibles side by
side, ending on:

```
  ARCS:   0  without a Mind      →       2  with one
```

Hold on that line. Then read one arc title aloud: *"Why the Barrels Stopped"*.

Say: *"The compiler can read hashtags. It cannot decide what a body of work is
about. Arcs are what the tick loop escalates — zero arcs is a cast that exists
and a world that doesn't run. That is the Mind's job, and nothing else in this
repo can do it."*

Use `creator`, not `tradeclash`: Trade Clash ships a complete `hints.json`, so
the compiler already produces a full cast and the comparison looks like a tie.
`npm run prove` defaults to the un-hinted source for exactly that reason.

### Shot 6 — you post something, the world reacts (0:50–0:56)

**The strongest beat in the film after the citation.** Same terminal:

```bash
npm run ingest -- --fixture tradeclash --tick \
  --post "Okuma raised the strait toll a second time, on twelve hours' notice, and published the schedule after the convoys had already sailed." \
  --actors okuma,ferrox --arc arc_strait_toll
```

One tick later a character reacts, **quoting the post verbatim and citing its
event id**:

```
posted -> fixtures/tradeclash/drop_20260819120539.md
ingested 1  [evt_mt01owv0_0001] Okuma raised the strait toll a second time...

--- tick ---
    Chancellor Ferrox [sabotage -> Director Okuma]
      "arranges for Director Okuma's week to become materially harder"
      "Okuma raised the strait toll a second time, on twelve hours' notice, ..."
      (cites evt_mt01owv0_0001)
```

Say: *"I posted that thirty seconds ago. It is canon now, and he is quoting it
back with the receipt."*

Optionally follow with the owner's daily note:

```bash
npm run digest -- --fixture tradeclash
```

**Between takes:** delete `fixtures/tradeclash/drop_*.md`, or re-run `onboard`
with `--reset`. Dropped posts are gitignored.

### Shot 7 — the engine is not the world (0:56–0:58)

Terminal B, with the world still running:

```bash
npm run chat
```

Same cast, same canon, same beats, as text — including the same `✓ evt_…`
citations. Put the terminal beside the browser.

Say: *"Same world, second surface, no engine. The simulation is not the
renderer — swapping the display costs one file."*

### Shot 8 — the closing beat: it is a world you can take apart (0:58–1:00)

Terminal C, before you start filming:

```bash
npm run voxel -- --every 10 --warm 20     # http://localhost:8788
```

Click **Click to enter** to take the pointer. Then it is Minecraft controls:
**WASD**, mouse look, **Space** jump, **Shift** sprint, **left click** break,
**right click** place, **1–9** pick a block, **F** fly, **Esc** to release the
pointer.

Walk from the gate up the worn path into the plaza, past the cast. Then walk to
the Ledger and chew a doorway through its wall. Put two planks back in the hole
so both verbs are on camera.

Say: *"Under it this is a real voxel grid — chunked storage, greedy meshing, the
lot. So you can take the world apart. And when you do, the almoner finds out."*

Cut to Terminal C as you dig. It prints:

```
terrain: Wren tore out 6 blocks and put up 2 at kiln row (evt_…)
```

Say: *"Same append-only log. The thing you did to the wall is now a thing they
can bring up."*

**If two of you are filming:** open `http://localhost:8788` in a second browser
window. The two windows are two different fans — one is Wren, the other is Ash —
with separate standing and separate memories. The HUD tells each of them who
they are.

---

## Fallbacks

| If | Do |
| -- | -- |
| The return greeting has no citation | The visitor left too recently. Leave, wait ~30s, come back. Citations need history to have happened while you were away. |
| Beats feel slow | `npm run world -- --every 3`. Beats queue and stage one at a time by design. |
| The browser tab was backgrounded and everything froze | `requestAnimationFrame` throttles in background tabs. Front the tab; it resumes. |
| You want a clean slate | Restart `npm run world` or `npm run voxel`. Both are in memory unless you pass `--persist`. |
| Which host is live? | The terminal banner says `HOST RUNTIME: MOCK` or `MINDS`, and the browser HUD says the same. It is never a guess. |
| An NPC is standing still in the voxel ward | You probably walled them in. They re-plan, and give up rather than walk through it. Dig the wall back out. |
| You want the same run twice | It already is: `--seed 1` is the default and is deterministic. |
| Port 8787 is taken | `npm run world -- --port 9000`, then `npm run chat -- --port 9000`. |
| No browser at all | `npm run chat -- --solo` runs a private world entirely in the terminal. |

## Flags worth knowing

```bash
npm run demo -- --days 10 --verbose     # longer, with every line of dialogue
npm run world -- --every 6 --warm 24    # tick cadence (s) and pre-run ticks
npm run world -- --persist              # write ./data/world.db instead of memory
npm run chat -- --solo                  # text surface, private world, no browser
npm run voxel -- --every 10 --warm 20   # voxel ward, tick cadence and pre-run
npm run clock:status                    # how much real history has accumulated
```
