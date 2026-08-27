# Inspiral

**Mints living inhabitants into any 3D world — NPCs with canon, grudges, and
memory of you.**

Three rival faction leaders live in a small district. Every few hours a world
tick fires; each acts on current canon — confronts a rival, posts a notice,
snubs someone. Actions become events, events update canon, canon drives the next
tick. The district accumulates real history with zero visitors.

The payoff is the return visit. A visitor takes a side on day 2 and leaves. Four
days of history happen without them. On day 6 they come back and an NPC greets
them as an ally and complains, accurately, about what a rival did while they were
gone — citing the event id, which the demo then verifies against the log.

## Build What Creators Need Next

The jam's brief, answered in its own terms.

**Discoverability.** A world is a reason to be found. Every beat the cast plays
is a clip draft with a permalink and a citation attached (`npm run clips`) --
not "post more", but *the property generating its own posts, sourced*. An IP
owner's back catalogue becomes a place people can walk into and talk about.

**Engagement.** The unit is not a session, it is a grudge. A visitor takes a
side and the world remembers it while they are gone; when they come back an NPC
brings it up and cites the event id. That is a reason to return that does not
depend on a notification, and it works for two fans at once with separate
memories.

**Workflow efficiency.** Handles in, living cast out, in about a minute and one
model call (`npm run onboard`). The owner keeps an approval gate before any of
it becomes canon, a daily digest of what their world did (`npm run digest`),
and clip drafts they can post or bin. Nothing publishes itself. Cost scales
with narrative decisions, not with cast size -- three characters and thirty
cost the same.

The rest of this README is how those three are built.

---

## Commands

Everything runs with **no API key, no account, no network, no build step**.
Node 22+ (developed on 24.19.0).

```bash
npm install          # once
npm test             # 305 tests, headless, no engine, no key
```

**The world, three ways.** Same canon, same tick loop, same cast — the surface
is the only difference.

```bash
npm run demo         # the whole loop in your terminal, ~2s, exits 0
npm run world        # the three.js ward     -> http://localhost:8787
npm run voxel        # the voxel ward, first person, diggable -> :8788
npm run chat         # the same world as TEXT; attaches to a running world
```

**An IP in, a living cast out.** Builds a world from an existing property and
keeps it fed from the owner's feed.

```bash
npm run onboard -- --fixture tradeclash --reset      # handles in, cast out
npm run ingest  -- --fixture tradeclash --tick \
  --post "Okuma raised the strait toll a second time." \
  --actors okuma,ferrox --arc arc_strait_toll        # posted -> quoted -> cited
npm run digest  -- --fixture tradeclash              # the showrunner's note
npm run clips   -- --fixture tradeclash --write      # drafts, never posted
```

**The one thing that needs a Mind.** Everything else in this repo runs with the
host switched off; this does not.

```bash
INSPIRAL_HOST=minds npm run prove   # 0 arcs without a Mind -> 2 with one
```

Onboards the same un-hinted source twice, with and without a Mind, and prints
both bibles side by side. The compiler reads hashtags; it cannot decide what a
body of work is *about*. Arcs are what the tick loop escalates, so zero arcs is
a cast that exists and a world that does not run.

**The one that never stops.** Real elapsed history, on disk.

```bash
npm run clock         # tick the real ward, forever
npm run clock:status  # how much history has actually accumulated
```

See [SETUP.md](SETUP.md) to run it, [RUNBOOK.md](RUNBOOK.md) for the demo shot
list, and [docs/IP-PIPELINE.md](docs/IP-PIPELINE.md) for the inbound/outbound
layer.

---

## The evidence a judge asks for

Three commands, in the order the questions usually come:

```bash
npm run prove        # what stops working without a Mind: 0 arcs -> 2, live
npm run authorship   # what share of the rendered dialogue the model wrote
npm run platform     # what we actually use of the Minds platform, read live
```

`prove` onboards the same un-hinted source twice, once with the host switched
off and once against a live Mind, and prints the two bibles side by side. It is
the only thing here that a Mind is strictly required for, which is why it is the
headline. `authorship` prints the host-written share of rendered lines.
`platform` reads identity, balance, usage by day, spend by tool, equipped apps,
circle and conversation lanes straight from the Builder API — it runs without a
key and says so rather than failing.

## Looking at it, and measuring it

A world that scores 3/10 on UX does not need opinions, it needs numbers.

```
npm run shots        # render all eight scene archetypes to docs/screens/looks
npm run pixelstats -- docs/screens    # read the histograms back
npm run platform     # what we actually use of the Minds platform, live
```

`pixelstats` and `contactsheet` are vendored from
[thrixel/build-world](https://github.com/thrixel/build-world) under Apache-2.0
(see `tools/visual/`). We evaluated the rest of that project — Thrixel's
text-to-3D asset generation — and did not adopt it: it needs an account and,
by the vendor's own README, a paid plan for a real build, and the licence
position on shipping generated assets in a jam submission could not be
established. The measurement half was free, and it paid for itself in one run
by proving that a "visual improvement" we had already shipped was blowing 20.6%
of its pixels to white.

**Two colour-space notes, both of which cost real time to find.**

three.js converts sRGB hex for you: `new THREE.Color('#775541')` already lands
in the linear working space, and calling `.convertSRGBToLinear()` on top makes
everything muddy. We do not do that anywhere, and the one `colorSpace`
assignment in the codebase is on a CanvasTexture, where it is required.

The mirror-image mistake is the one that actually bit us. The voxel mesher was
writing sRGB bytes **straight into three's vertex-colour attribute**, which is
read as linear — converting zero times where the documented trap is converting
twice. `0x77` entered as linear 0.467 and left the display transform near sRGB
0.71: every block lighter than authored and about half as saturated. It hid an
entire colour system, and it means any visual judgement made before the fix was
measured through the wrong transform. One `srgbToLinear` in `mesher.js` moved
chroma P99.5 from 0.100 to 0.130 and arc95 from 53 to 296 degrees.

**The value ladder is absolute.** Block colours are not tinted, blended or
derived from anything that came before — each block is assigned a SLOT and takes
that slot's OKLab lightness (VOID 0.19 / DARK 0.32 / MID 0.48 / LIGHT 0.64 /
HIGH 0.80). BACKDROP is the sky and is the one value the ladder deliberately
leaves free. The ladder only reaches the *frame* if the darkest and lightest
tiers actually appear, so the face-shading ramp bottoms out at 0.30 to put VOID
under every overhang, and the interiors carry a lit cornice so HIGH is in shot.

**One visual family, both surfaces.** The voxel worlds take the colour system by
assigning block slots. The ward could not — it is built from Kenney kit GLBs and
every piece samples one shared 512x512 palette atlas, so tinting materials does
nothing. The atlas itself is remapped at load instead: every colour in it is
measured in OKLab, matched to the nearest tier of the ladder, and replaced by
the slot that owns that tier. The kit's value structure survives; its hue does
not. Without this the film had two visual families and a design panel notices
that immediately without being able to say why.

The cast is the exception, on purpose: character colours are the one thing the
system holds byte-identical across all five palettes, so they are never
re-skinned to whichever world they are standing in.

**Per-archetype visual identity.** Eight look profiles in
`web-voxel/scene/looks.js`, one per scene archetype, each with its own exposure,
sky, sun, hemisphere, ambient, fog, practicals and colour grade. Both the ward
and the voxel world read the same profiles. A tavern is warm, dim and firelit;
a council chamber is cold, hard and lit from a window you cannot reach; a studio
is flat, bright and artificial. Same code, same generator — the difference is
data, which is the "it learns your IP" claim made visible in one frame.

Two shaders do the work, both small and both commented with why they exist: a
gradient sky dome (`skydome.js`) that replaced three's physical `Sky`, because a
physical sky is genuinely brighter than anything under it and cannot be
art-directed, only surrendered to; and a lift/gamma/gain/saturation/vignette
grade (`grade.js`) that runs after tone mapping, which is where `gain` under 1.0
stops the brightest thing in frame reaching 255.

**Themed build palettes.** The hotbar is the archetype's, not one global list —
tavern hands you plank, timber and lantern, a council chamber hands you stone —
so anything a visitor builds is on-theme by construction. Each archetype also
carries a one-line brief with no score and no completion state attached. The
reward is that the cast reacts to what you put down, and that reaction now
announces itself in the feed instead of vanishing into a socket.

---

## What this repo is and is not

The 3D engine is still an open question, so **there is no engine code here and
none should be added until that is decided.** What is worth freezing before
writing engine code is the canon schema and the directive spec, and that is what
this delivers.

- **[SCHEMA.md](SCHEMA.md) is the deliverable.** Read and sign off on that first.
- The rest is a working implementation proving the schema survives contact with
  a real loop, a failing host, and a returning visitor.

---

## Architecture

```
                      ┌──────────────────────────────────────┐
                      │  CANON  (SQLite, ours, authoritative) │
                      │  append-only event log + state        │
                      └──────────────────────────────────────┘
                            │                        ▲
                    compile digest            validated deltas
                            ▼                        │
                      ┌──────────┐            ┌─────────────┐
                      │  DIGEST  │            │  VALIDATOR  │
                      └──────────┘            └─────────────┘
                            │                        ▲
                            ▼                        │
        ╌╌╌╌╌╌╌╌╌╌╌ HostRuntime ╌╌╌╌ SOVEREIGNTY SEAM ╌╌╌╌╌╌╌╌╌╌╌
                            │                        │
                      ┌─────────────────────────────────┐
                      │  ONE MIND  (or the mock host)   │
                      │  returns directives, holds none │
                      └─────────────────────────────────┘

        directives ──► CHARACTER RUNTIME (stateless, local, free)
                                  │
                                  ▼
                          SURFACE ADAPTER  ──►  Luanti / Godot / Telegram
                                                     (not built)
```

### One Mind, three projections

Inspiral uses **exactly one Mind**. All three faction leaders are server-side
projections of it.

An earlier draft of this README said the platform forbids mind-to-mind Circles
and that the design was forced. **That was wrong, and it was worth finding out.**
The client's README is careful — "not documented for builders today ... if the
platform later supports Mind platform emails, the client passes them through;
verify with `result` and `getCircle()`" — so we verified. Adding one Mind's
platform email (`getMind(id).email`, e.g. `john.carmack@hellominds.ai`) to
another Mind's circle returns `action: "mind_added"` and the member shows up in
`getCircle()` with `isSteward: false`. Removal returns `deactivated`. It works
today, undocumented.

So one Mind is a **choice**, and here is the actual argument for it.

*Cost.* A cast is not a committee. Ask three Minds what they do and you pay three
invocations for one beat, and the bill scales with cast size — a thirty-character
IP would be ten times the price of a three-character one for the same story. Ask
one Mind *"what does this district do next"* and it returns up to four directives
naming whichever characters act, for one invocation, at any cast size.

*Coherence.* A grudge is a fact about two people. Split the two across separate
Minds with separate context and the grudge has no single owner — you get two
plausible half-memories and a continuity bug the audience notices before you do.
One showrunner holding the whole district is how television does it, and canon
is the show bible it writes into.

A future version with a real budget could plausibly give a **principal** cast
member its own Mind and keep the showrunner for everyone else. That is the
interesting version of the idea. It is not an eight-day change.

Four conversation aliases are lanes on that single Mind, not separate agents:
`tick`, `onboard`, `fan-events`, `qc`.

### Cost

**Invocations scale with narrative decisions. Never with cast size. Never with
visitor traffic.**

| Costs an invocation | Does not |
|---|---|
| A world tick | Rendering any dialogue |
| A visitor's first contact | Adding a fourth faction leader |
| A visitor doing something consequential | A thousand visitors watching |
| One repair after a rejected directive | Any read of canon |

Capped by `INSPIRAL_DAILY_HOST_BUDGET` (default 12/day). Past the cap the
scheduler stops calling out and the world runs on its last directives.

Every line of dialogue in the demo cost zero invocations: the character runtime
is stateless local code, not an agent.

### The sovereignty seam

Everything above `HostRuntime` is ours. Everything below it is a rented opinion.
The host never reads the database and never writes to it — it receives a
compiled digest and returns directives that are validated against canon before
anything moves.

**Swap cost is one file.** To move off Minds, write one class implementing
`HostRuntime` and add a case to the switch in `src/host/index.ts`. Nothing else
in the codebase imports a vendor SDK.

---

## Why the callback is true and not merely plausible

The thing that makes this feel alive is an NPC saying "while you were away, he
did *this*" and being right. That is not achieved by asking the model nicely.

1. The host proposes only the **intent** — "greet them as one of ours, then tell
   them what the rival did".
2. The character runtime queries canon for a grievance, under constraints:
   - the rival must be someone this character actually dislikes (affinity < 0)
   - the rival must be `actors[0]` — the initiator, not merely present
   - this character must have been involved, so they could have witnessed it
   - the event type must be something you can hold against someone
     (you cannot complain that a rival *backed down*)
   - it must fall after the visitor's previous visit
3. The rendered line carries the `event_id`. The demo then looks every citation
   up in the log and prints the day it happened.

The host supplies the intent. Canon supplies the fact. Nothing is improvised,
and a wrong citation is a test failure rather than a bad vibe.

Same for memory of the visitor: `notable_moments` carry a `witnesses` list, and
a character may only recall moments they were present for.

---

## Failure behaviour

A world that has been accumulating history for six days must not lose it to
someone else's 500.

| Failure | Response |
|---|---|
| Host times out | Log `tick_skipped`, replay last directives **with deltas stripped** |
| Malformed JSON | Reject, re-prompt **once** with the specific errors, then skip |
| Host invents a character | Referential validation rejects it, same path |
| Fails again after repair | Skip the tick, log `directive_rejected` |
| A single delta throws | Drop that delta, keep the rest of the tick |
| Budget exhausted | Skip; world stays consistent |
| Anything else | Absorbed. `runTick` never throws. |

Replays strip deltas deliberately, so a host failing repeatedly cannot ratchet
relationships by failing.

---

## Layout

```
src/
  types/         events.ts, canon.ts, directive.ts   ← the frozen contracts
  canon/         db.ts, repo.ts, seed.ts, digest.ts  ← SQLite, the only writer
                 mint.ts         ← pasted text becomes an inhabitant
  directive/     validate.ts, apply.ts               ← two-stage validation
  host/          HostRuntime.ts  ← THE SEAM
                 mock.ts         ← default, deterministic, no network
                 minds.ts        ← real Builder API client (needs a key)
                 prompt.ts, index.ts
  runtime/       character.ts    ← stateless render workers
                 surface.ts      ← engine-facing boundary (no engine code)
                 webSurface.ts   ← three.js surface: http + websocket
                 chatSurface.ts  ← the same world as text
  tick/          runTick.ts, scheduler.ts
                 visitors.ts     ← many fans, cheap returns
scripts/         demo.ts, world.ts, voxel.ts, chat.ts,
                 clock.ts, clock-status.ts, tick.ts, canon.ts
web/             index.html, main.js, assets/        ← CC0 kit, no build step
web-voxel/       voxel/ (storage, meshing, raycast,
                 physics, pathfind), ward.js, main.js ← no renderer import
ops/             com.inspiral.clock.plist            ← optional always-on
tests/           validator.test.ts, tick.test.ts, mint.test.ts,
                 voxel.test.ts, visitors.test.ts    ← 305 tests
docs/research/   voxel engine + high-density framework survey (background reading)
```

Append-only is enforced by SQLite triggers: `UPDATE` and `DELETE` on `events`
raise. It is a property of the database, not a convention.

---

## Assumptions about the Minds platform

Flagged because I made these calls without being able to ask. Everything in this
section is still **pending the API key** — see "Placeholder" below.

**Pinned to `0.1.3` exactly, not `^0.1.3`.** Four versions have ever been
published, the first on 9 June 2026 and the latest on 21 July 2026, on a platform
still moving fast enough that a minor bump could change the wire format under a
demo. There is nothing to gain from floating and a jam to lose.

**The licence is `UNLICENSED` — "private alpha tooling".** We depend on it and
call it over the network, which is what it is for; we do not vendor it, fork it,
re-publish it, or include `node_modules` in anything submitted. A judge clones
the repo and runs `npm install`, which fetches it from npm under whatever terms
Animoca grants. Nothing here claims redistribution rights we do not have.

**The library does not read `.env`** — its README is explicit that your app or
the `minds` CLI handles that. This is not trivia: it is exactly the bug that had
our clock running mock-authored for a day while we believed it was live. Every
entry point in this repo therefore starts with
`node --env-file-if-exists=.env`, and shell variables still win over the file.

**The `api.build` host is fixed in the library**; the base URL is not
configurable. There is no staging endpoint to point at, so any live test is a
live test against the real account — which is why `INSPIRAL_HOST` defaults to
the deterministic stand-in and every test runs offline.

**Verified, not assumed:**

- `@animocabrands/minds-client-lib@0.1.3` exists on npm and its type definitions
  were read directly. `createMindsClient({builderApiKey})`,
  `ensureConversation(alias, mindId)`, `sendMessage({alias, messageText})`,
  `getLatestHistoryFingerprint(alias)`,
  `waitForReply({alias, timeoutMs, afterFingerprint, sentMessageText})`,
  `subscribeEvents({alias, onEvent, onError})`, `getCognitionBalance(mindId)`,
  `listMinds()` all match what `src/host/minds.ts` calls. Auth header is
  `X-Api-Key`; the env var the library documents is `MINDS_BUILDER_API_KEY`.
- The library is ESM-only and requires Node ≥22, which is why this repo is ESM
  and Node 22+.
- The Circles endpoints take human **emails** — consistent with your finding
  that there are no mind-to-mind Circles.

**Assumed — please correct:**

1. **The world.** Three faction leaders in "Tallow Ward": Vance (The Ledger),
   Okonkwo (Kiln Row), Quill (The Almshouse), with two day-zero arcs. Invented
   whole. Swap freely in `src/canon/seed.ts` — nothing else depends on it.
2. **Tick cadence** 4h, budget 12 invocations/day. Both config.
3. **Timeout** 180s, as specified. One repair attempt only.
4. **Movement clamps** ±25 affinity/trust, ±30 tension/stance per tick. Tuned so
   grudges take days rather than one bad exchange.
5. **A "day"** in the demo is 6 ticks. Production cadence is the same 4h.
6. **`significance_hint` is advisory.** The host's self-assessment does not
   determine what is remembered; canon re-ranks on read.
7. **Visitor stance does not decay.** Someone returning after six months is
   greeted as warmly as someone returning after a day. Probably wrong long-term.
8. **`better-sqlite3` v13** — v11 has no prebuilt binary for current Node 22
   ABIs and falls back to a source build. v13 ships prebuilds.

**Needs confirming before the real Mind is wired in:**

- **Does the Mind reliably return bare JSON?** The validator tolerates code
  fences and surrounding prose, and repairs once. If the Mind is chatty by
  default, its system prompt should be set to return JSON only.
- **What one invocation actually costs in cognition credits.** The budget is
  currently a call *count*, not a credit spend. `getCognitionBalance` is wired
  and `getCognitionUsageByTool` exists if the budget should track credits.
- **Whether `sendMessage` should carry `worldContext`.** The type definitions
  include optional `sceneId` and `worldContext` fields that the README does not
  document. Currently unused.
- **SSE.** `subscribeFanEvents` is implemented on the Minds adapter but nothing
  calls it. The tick loop is pull-based.
- **The `qc` lane is wired and unused.** Nothing currently checks whether the
  world has drifted out of tone.

---

## The clock

Every other entry point manufactures six world-days in two seconds against an
in-memory database. That is fine for a demo and worthless as evidence. The
pitch is that a district accumulates history whether or not anyone is watching,
and elapsed time is the one thing that cannot be compressed afterwards — so
there is a process whose whole job is to be boring for a week.

`npm run clock` ticks `data/canon.db` on **real wall-clock time**, so events
carry the actual moment they happened and the log is checkable against a
calendar rather than a seed.

| | |
| --- | --- |
| Cadence | one tick every 180 min ≈ 8/day, under the ~12/day invocation budget, leaving headroom for visitors |
| Storage | on disk, append-only, enforced by SQLite triggers |
| Restart | all state is in the database; stopping loses nothing but the gap |
| Safety | the file is copied to `data/backups/` on every boot (last 12 kept) |
| Concurrency | a lock file refuses a second clock, so pacing and budget stay honest |

```
$ npm run clock:status
  clock          RUNNING
  days elapsed   0.00   (0.0 h of real time)
  log spans      0.86 days
  ticks          3
  events         10
```

To keep it running across logout and reboot, install the LaunchAgent — it is
written but deliberately **not** installed, because it touches your login
session:

```bash
cp ops/com.inspiral.clock.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.inspiral.clock.plist
```

---

## Scenes

An IP should not open into a random room. Where a cast stands is
characterisation, so onboarding **chooses** one of eight scene archetypes from
the compiled bible and the world opens there.

| Archetype | Affords |
| --------- | ------- |
| `tavern` *(default)* | regulars, long-running grudges, gossip that travels |
| `market_plaza` | civic factions, public confrontation — **this is Tallow Ward** |
| `council_chamber` | procedure as a weapon: standing, precedent, the minuted record |
| `training_hall` | rivalry with a scoreboard: challenges, form, rank |
| `ballroom` | status read at a glance: who is introduced, who is cut |
| `arena` | spectacle with a crowd in it, sides taken loudly |
| `studio` | an audience-facing set: formats, guests, on and off camera |
| `cafe` | low-stakes hours where people say the unsayable |

Each is a **data definition** in `web-voxel/scene/archetypes.js` consumed by the
primitives in `scene/primitives.js` — terrain, enclosure, building, platform,
tiers, props. Adding a scene is data; there is no new engine code, because the
ward was already generated from a layout definition and this is that same path
with eight definitions instead of one.

Every archetype declares **named places** (`the_bar`, `the_dais`, `kiln_row`)
which is what the directive system targets. Canon says the name; the surface
turns it into coordinates; nothing above the seam learns what a coordinate is.

### How the choice is made

The archetype rides along in the **existing** onboarding host call — no extra
invocation, because the budget is ~12/day and a scene choice is not worth one of
them. If the host says nothing usable, a keyword score over the bible picks one
deterministically. It always produces something defensible, which matters more
than being clever: a wrong-but-reasoned tavern beats a coin-flip ballroom.

```
$ npm run onboard -- --fixture tradeclash --reset
scene:  The Council Chamber (heuristic) — procedure as a weapon: standing,
        precedent, and things minuted that cannot be unsaid — matched on
        chancellor, premier, duty
```

The choice is stored in canon (`scene_archetype`), so opening that world later
opens the right room:

```bash
npm run voxel -- --db ./data/tradeclash.db     # the Trade Clash council chamber
npm run voxel -- --scene tavern                # or force one
```

---

## Surfaces

The simulation is not the world; the world is a display. Three surfaces
implement one `SurfaceAdapter` (`src/runtime/surface.ts`):

| Surface          | File                          | What it is                                        |
| ---------------- | ----------------------------- | ------------------------------------------------- |
| `ConsoleSurface` | `src/runtime/surface.ts`      | stdout. What `npm run demo` uses.                 |
| `WebSurface`     | `src/runtime/webSurface.ts`   | three.js in a browser. What `npm run world` uses. |
| `ChatSurface`    | `src/runtime/chatSurface.ts`  | a terminal. What `npm run chat` uses.             |
| `VoxelSurface`   | `src/runtime/voxelSurface.ts` | a diggable voxel world in first person. `npm run voxel`. |

Two browsers on one ward are two different fans. Each connection is handed an
identity (Wren, Ash, …) with its own standing and its own memory; the HUD tells
each of them who they are. Coming back is free when the cast has done nothing
since you left — the greeting is replayed from canon rather than costing an
invocation to be told the same thing.
| `MemorySurface`  | `src/runtime/surface.ts`      | collects instead of printing. What the tests use. |

`npm run chat` attaches to the *same running world* as the browser over the same
socket and replays the *same beats* through the adapter. Two windows, one canon.
The text surface contains no 3D vocabulary at all — `moveTo` is a sentence, not
a translation — which is the actual test of whether the seam holds.

### The voxel ward (`npm run voxel`)

A fourth surface, and the one that answers "can I actually play in it". The
world is a real chunked voxel grid, not a decorative cube field: 32³ chunks in
typed arrays, greedy meshing (124k voxels collapse to ~10k triangles), a DDA
raycast for aiming, and swept AABB collision. First person — WASD, mouse look
under pointer lock, gravity, jump, sprint, fly. Left click breaks, right click
places, `1`–`9` pick from a nine-block hotbar, and the affected chunk remeshes
immediately.

The ward is *generated into the grid* from a layout definition, so every wall,
roof and cobble is diggable. The cast walks that terrain with A* over standable
surface cells, which means they route around a wall you build and give up rather
than walk through one you have sealed them behind.

**Digging is narratively load-bearing.** A burst of edits becomes ONE
`terrain_altered` event in the same append-only log everything else uses, blamed
on whichever character's patch it happened on, and it moves that relationship.
Tearing six blocks out of the almshouse is a thing that happened, and the cast
can cite it.

The voxel core (`web-voxel/voxel/`) imports no renderer at all, so the browser
loads it with no build step and the test suite imports the same files.

**Not attempted: Teardown-style rigid-body destruction.** That is voxels being
partitioned into connected components, each becoming a physics body with derived
mass and inertia, solved every frame. It is engineer-years, no open-source voxel
engine ships it alongside an entity system, and it is not what makes block
worlds fun to poke at. Grid destruction is.

### The engine

**three.js, not Godot.** Godot's web export needs a 133 MB editor plus 1.2 GB of
export templates before a triangle renders, ships a ~30 MB wasm payload, and
needs COOP/COEP headers to serve. More to the point, the scaffolding an engine
sells you — scene tree, entity system, game state — is the part Inspiral already
owns in TypeScript. What was actually needed from the engine was glTF loading,
soft shadows, ambient occlusion, animation blending, screen-space labels and a
camera, and three.js ships all of it as addons. No renderer code was written:
`GLTFLoader`, `AnimationMixer`, `PCFSoftShadowMap`, `GTAOPass`, `CSS2DRenderer`
and `OrbitControls` do the work. three.js is served straight out of
`node_modules` via an import map, so there is no build step and the judge's URL
is a plain static page.

Nothing was hand-modelled. Buildings are stacked from Kenney CC0 kit pieces by
measured bounding box; the cast are rigged CC0 GLBs that ship 32 animation clips
each. See `web/assets/ATTRIBUTION.md`.

---

## Decisions for the world surface

Everything here was a judgement call, is isolated to one file, and is cheap to
reverse.

| # | Assumption | Where | If wrong |
| - | ---------- | ----- | -------- |
| 1 | **three.js over Godot 4**, for the reasons above. | `web/`, `src/runtime/webSurface.ts` | The seam is unchanged; another surface is one file. |
| 2 | **Asset licences.** Kenney packs are CC0, so no attribution is legally required. Recorded anyway. | `web/assets/ATTRIBUTION.md` | Swap the GLBs; the client measures pieces at runtime rather than hard-coding sizes. |
| 3 | **World layout.** A plaza with three towers is invented set dressing; canon only ever says `kiln_row`, not coordinates. | `WARD_PLACES` in `src/runtime/webSurface.ts` | One table. Nothing above the seam knows a coordinate exists. |
| 4 | **A minted character's home** ("wharf") is a location the ward has never heard of, so it is assigned a free spot on a ring around the plaza; a sheet with no home at all defaults to the plaza, and bodies that would overlap are nudged apart. | `WebSurface.point()` / `free()` | Add the name to `WARD_PLACES`. |
| 4b | **Minted bodies** are drawn from a spare pool of CC0 characters, picked by a hash of the character id — stable across reloads, distinct between newcomers. | `bodyFor()` in `web/main.js` | Add more GLBs to `SPARE`. |
| 5 | **Mint input format.** `Key: value` lines, forgiving; a bare paragraph becomes the brief and the schema fills the rest. | `src/canon/mint.ts` | The parser is ~60 lines and self-contained. |
| 6 | **Character voice** in the mock host is rule-based, not generated — deterministic, instant, free. It is a placeholder for a Mind. | `src/host/mock.ts` | Replaced wholesale by the Minds adapter. |
| 7 | **Telegram** is not wired, because it needs a bot token this repo does not have. `ChatSurface` takes a `write` callback; a bot is that callback pointed at `sendMessage`, with the existing `/visit /side /leave /mint` commands arriving as messages. | `src/runtime/chatSurface.ts` | ~30 lines in a new script; the surface itself does not change. |
| 8 | **Tick cadence** in the live world is wall-clock seconds, not the production 4 hours, so a demo is watchable. | `--every` in `scripts/world.ts` | A flag. |

---

## Placeholder: the Minds host

**Exactly one thing in this repo is a placeholder, and it is the only thing that
needs a key.** Everything else genuinely runs.

`HostRuntime` (`src/host/HostRuntime.ts`) is the seam. There are two
implementations and one switch:

```ts
// src/host/index.ts -- THE ENTIRE SWAP COST
if (cfg.host === "minds") return new MindsHostRuntime({ builderApiKey: key, ... });
return new MockHostRuntime({ seed: cfg.seed });
```

- `MockHostRuntime` — **the default.** Rule-based, deterministic, instant, free,
  offline. Same seed, same history. Every screenshot and every test above ran
  against it.
- `MindsHostRuntime` — written, typed against the real client library, wired to
  the same interface, **never exercised**, because there is no key yet.

To switch: put `MINDS_BUILDER_API_KEY=...` in `.env`, set `INSPIRAL_HOST=minds`,
and change nothing else. Every entry point loads `.env` (`--env-file-if-exists`)
and every one of them goes through `startHostRuntime()`, so `npm run demo`,
`world`, `voxel`, `chat` and `tick` all pick up the key. **Which runtime is
actually live is printed in the terminal banner and shown in the browser HUD**,
so it is provable on camera rather than asserted.

Degradation is layered, because a half-configured environment must not kill a
demo: no key at all → mock; `INSPIRAL_HOST=minds` with an empty key → warn, use
mock; a key that is present but wrong → the adapter is constructed, the real API
rejects it, and `startHostRuntime` warns and falls back to mock. Only the mock
failing is treated as a real bug.

Nothing downstream of the seam talks to the host directly -- the validator,
canon, tick loop, character runtime, the IP pipeline and all four surfaces read
canon instead. That is what lets one Mind drive a three.js ward, a first-person
voxel world, a terminal and a headless demo at once, and why the next surface
in whatever engine needs no changes on the Mind's side. All eleven entry points go through
`startHostRuntime()`.

### Verified against the live key (20 Aug 2026)

The key works. Auth, `humanId` (parsed straight from the JWT), Mind selection,
conversations, send/receive and the validator all work end to end. What that
run taught us:

| | |
| --- | --- |
| **Header** | The library sends `X-Api-Key`. The docs' `X-Access-Key` is `LEGACY_` in its own constants — our adapter was already right. |
| **Latency** | 40s–166s per call, median ~75s, against a 180s timeout. **This is the operational risk**, not correctness. A rejected directive costs a re-prompt, so one visitor action was measured at 363s. |
| **Response shape** | Wrapped in `<pre>…</pre>` HTML, never a markdown fence. `extractJson` handles it. |
| **Validator** | Real output survives **unmodified** — a real tick applied on the first try and cited a real event id. |
| **Cost** | ~2.6 cognition per invocation. Balance also accrues over time, so runway is not simple division. |
| **Two fans** | Genuinely diverge now: Wren `{okonkwo +22, vance −20}` vs Ash `{okonkwo −22, vance +20}`. The mock gave both the same. |

Two real bugs it exposed, both fixed: the adapter picked `minds[0]` blindly and
landed on an **overdrawn** Mind whose every reply was a top-up prompt (it now
prefers a funded Mind and says so loudly); and the prompt calls visitors
`fan:<id>` everywhere but required the bare id in `visitor_stance.fan_id`, so
**every visitor directive was rejected**. Both spellings are accepted now.

### What is waiting on the key

| | |
| --- | --- |
| ~~`MindsHostRuntime` has never completed a call~~ | **Done.** Verified 20 Aug — see the table above. |
| The accumulating history is mock-authored | The clock has been running since 19 Aug. Real elapsed time, real event ids, real relationship drift — rule-based prose. Restarting it against a live Mind is one command, but every hour that passes is an hour of the week that stays mock. |
| ~~Two fans taking opposite sides get identical standing~~ | **Done.** They diverge on the live host. |
| ~~Onboarding enrichment is discarded~~ | **Done, and it is the headline.** On the un-hinted `creator` fixture the mock produces 0 story arcs, empty goals and a metadata summary; the Mind produces 2 named arcs, real goals, and an authored premise and tone. That is "compiles your IP" becoming "learns your IP". Note the `tradeclash` fixture ships a complete `hints.json`, so enrichment has nothing to add there — it is the wrong fixture to demo this with. |
| ~~`budgetRemaining()` / cognition metering~~ | **Done.** Returns real numbers and now drives Mind selection. |
| Clock on the live host | **Deliberately not switched.** Cost is fine (~2.6/invocation) but median 75s latency and the rejection-retry tail need a decision — see below. |

### What is waiting on something other than the key

| | |
| --- | --- |
| Social source adapters (`x:`, `youtube:`, …) | Deliberate stubs that **throw**, because no API access method has been chosen. A stub returning `[]` would let a broken integration look like a quiet one. Fixtures are the real, default path. |
| `fixtures/tradeclash` | Entirely invented placeholder content. Its README lists the exact fields to replace with the real game's. |
| Telegram approval | Real code, activates on `TELEGRAM_BOT_TOKEN` alone, tested against a fake transport. Needs a bot token, not a Minds key. |

---

## What is deliberately not here

- Any engine integration. `SurfaceAdapter` is the boundary; console and
  in-memory implementations exist for the demo and tests.
- Any coordinates, meshes or scene graph. Locations are opaque strings.
- Networking, auth, persistence beyond SQLite, multi-world support.
- LLM-generated prose in the mock. The mock is rule-based on purpose: it is
  deterministic, instant, and free, so the loop can be tested without a host.

---

## Next

1. Sign off on [SCHEMA.md](SCHEMA.md), or mark it up.
2. Decide the engine. Then write one `SurfaceAdapter`.
3. Wire the real Mind and check the four items above.

---

## The IP pipeline

Everything above builds a world by hand. The inbound/outbound pipeline builds one
out of an existing IP and keeps it fed.

The commands are listed above. Source adapters, the IP bible, the creator approval gate, ingestion into the
existing event schema, the daily digest and the outbound clip drafts are all
documented in **[docs/IP-PIPELINE.md](docs/IP-PIPELINE.md)**, including which
parts are fixture and which are real.
