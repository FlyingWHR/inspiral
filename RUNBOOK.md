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
npm test                    # 481 passing -- sanity check
```

Two terminals and a browser. Terminal A runs the world, terminal B runs the text
surface, the browser shows the ward.

**Which surface each shot uses.** There are two visual surfaces and they are
filmed on different ports. Shots 1–5 are the three.js ward, which is the older
and safer one. Shot 6 is the voxel ward and is the closing beat. Shot 7b is the
archetype cut — tavern against council chamber — and is the one to protect if
time runs short, because it is the only shot that proves the system generalises
rather than having been decorated once.

| Shot | Surface | Command | Port |
| ---- | ------- | ------- | ---- |
| **0 the problem** | terminal | **`npm run problem`** | — |
| 1 the pitch | terminal | `npm run demo` | — |
| 2 the ward | three.js | `npm run world` | 8787 |
| 3 the money shot | three.js | (same window) | 8787 |
| **3b what a Mind is for** | terminal | **`npm run prove -- --fixture tradeclash`** | — |
| 4 mint on camera | three.js | (same window) | 8787 |
| 5 an IP walks in | terminal | `npm run onboard -- --fixture tradeclash` | — |
| **5b what it costs at size** | terminal | **`npm run scale`** | — |
| 6 post → reaction | terminal | `npm run ingest --post` | — |
| 7 second surface | terminal | `npm run chat` | attaches to 8787 |
| 7b one system, eight worlds | voxel | `npm run shots` (stills) | — |
| 8 closing beat | voxel | `npm run voxel` | **8788** |

## THE RUBRIC CHANGED. CUT AGAINST THE NEW ONE.

The announcement said *creativity, technical execution, UX, innovative use of
agentic AI*. The panel's published criteria are **Minds Integration Depth,
Creator-Economy Problem Fit, Innovation & Creativity, Execution & Completeness,
Viability & Scalability** — two of those five are new, and **visual quality is
not on the list at all.**

That reprioritises this shot list. The colour system, the eight look profiles
and the voxel ward are good work that now buys a slice of one criterion. Film
them last and cut them first.

**Protect these three. Cut everything else before you cut them.**

1. **Shot 0, `npm run problem`** — *Creator-Economy Problem Fit.* Opening on
   your own product's analytics, with a bad number, is the single most credible
   thing in the film. Every other team will open on a demo. You open on
   evidence that the problem is real, in a product you actually ship.
2. **Shot 3b, `npm run prove`** — *Minds Integration Depth.* The only thing in
   the film that answers "what stops working without a Mind", live: the same
   **real brand document** onboarded twice, 1 arc against 6–8. Everything else
   here runs with the host switched off. This does not.
3. **Shot 3, the citation** — *Innovation.* An NPC naming what a rival did while
   you were away, with the event id resolving against the log.

**Shot 5b (`npm run scale`) is fourth** and is the whole Viability answer in one
frame — including the row that is *not* flat, which is why it reads as
measurement rather than salesmanship. Say the second number out loud.

Cut 4, 7, 7b and 8 before any of the above. Shot 8 is the most fun and is not
load-bearing for a single criterion on the new list.

## The three sentences the film has to land

1. *"This is my game. In eight days, 1,418 people showed up, 14 picked a side,
   and one came back — because the world had no way to know any of them had ever
   been there."*
2. *"Point Inspiral at the brand document and a Mind turns a cast into a season —
   one stub storyline becomes eight, and they reference each other."*
3. *"When you come back, it tells you what happened while you were gone, and
   cites the event id. A wrong citation is a test failure, not a bad vibe."*

**Do not say** that you can prove memory makes people return. n is zero, there
is no counterfactual arm, and identity is asserted rather than authenticated.
The defensible version is stronger anyway: *"We can show exactly what the world
remembered about a specific person and verify it was true. Whether that brings
them back is an experiment we can now run — and the tool to run it is the thing
we built."*

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

*A captured run of this is in `docs/transcripts/prove-creator.txt` if you want
to check the wording before you film it.*

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

### Shot 7b — one system, eight worlds (0:58–1:02)

**This is the strongest visual argument in the film and it costs four seconds.**
Cut between two frames:

```
docs/screens/looks/tavern.png          docs/screens/looks/council_chamber.png
```

Same generator, same code path, same three characters. The tavern is warm, dim and firelit; the council chamber is cold stone with the
red of office on the wall behind the dais. Measured: the tavern runs 3.3% of its
area at accent chroma against a 0.45-plus value spread, the council chamber sits
at arc95 327 degrees with a cool structure and one warm banner. Nothing was
relit by hand -- the archetype chose the palette, the palette chose the slots.
Nothing was relit by hand — the archetype chose the profile.

Say: *"Same engine, same cast, same code. The IP picked the room, and the room
picked the light. This is what 'it learns your IP' looks like in one frame."*

Regenerate all eight any time with `npm run shots`, and check them with
`npm run pixelstats -- docs/screens/looks`.

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


---

## The screenshot set

Every still in `docs/screens/` is reproducible and measured. Nothing in it
predates the colour system or the colour-space fix.

```bash
npm run shots:ward     # 01-05, driven through the real UI
npm run shots:chat     # 06, real chat output on a light page
npm run shots:voxel    # 07-09
npm run shots          # the eight archetype looks
npm run directions     # the four art directions of the tavern
npm run pixelstats -- docs/screens          # exposure
npm run huestats -- docs/screens            # hue and chroma
python3 docs/art/diagnose.py docs/screens/looks/*.png   # the study's own tool
```

The bar before a still goes in front of a design judge: **under 0.5% blown, no
crushed shadows**, and the colour system's own four measures as close to clean
as the scene allows.

`06-chat-surface-same-canon.png` is regenerated by `npm run shots:chat`, which
drives the real chat surface through the visit/side/leave/return round trip,
captures its actual output and lays it on a light page. It used to measure
L=21.6 with crushed shadows — fine for a terminal, invisible on a projector.
It now measures L=234 with the resolved `evt_` receipts picked out in green.
Nothing in it is retyped: the text on screen is the text the process printed.

`12-before-visual-pass.png` and `13-after-visual-pass.png` are kept **only** as
the record of a regression that was shipped and described as an improvement
while 20.6% of its pixels were blown to white. Neither belongs in the film.
