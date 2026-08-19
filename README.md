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

## Three commands

```bash
npm install          # once. Node 22+ required (developed on 24.19.0)

npm test             # 56 tests, headless, no engine, no key
npm run demo         # the whole loop in your terminal, ~2 seconds, exits 0
npm run world        # the 3D ward -> http://localhost:8787
npm run voxel        # the VOXEL ward, first person -> http://localhost:8788
```

No API key. No account. No network. No build step, no bundler. See
[SETUP.md](SETUP.md), and [RUNBOOK.md](RUNBOOK.md) for the 60-second demo shot
list.

A fourth command proves the point of the architecture — with `npm run world`
already running, open another terminal:

```bash
npm run chat         # the SAME world, same canon, same cast, rendered as text
```

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

The Builder API has **no mind-to-mind Circles** (the Circles endpoints take human
emails), and the free tier is **3 Minds**. So Inspiral uses **exactly one Mind**.
All three faction leaders are server-side projections of it.

This is not a simplification of a multi-agent design. Three agents conversing is
not something the platform does — and if it were, invocations would scale with
cast size, which is the wrong cost curve. Instead the Mind is asked *"what does
this district do next"* and returns up to four directives naming whichever
characters act.

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
scripts/         demo.ts, world.ts, chat.ts, tick.ts, canon.ts
web/             index.html, main.js, assets/        ← CC0 kit, no build step
tests/           validator.test.ts, tick.test.ts, mint.test.ts   ← 56 tests
docs/research/   voxel engine + high-density framework survey (background reading)
```

Append-only is enforced by SQLite triggers: `UPDATE` and `DELETE` on `events`
raise. It is a property of the database, not a convention.

---

## Assumptions about the Minds platform

Flagged because I made these calls without being able to ask. Everything in this
section is still **pending the API key** — see "Placeholder" below.

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

## Surfaces

The simulation is not the world; the world is a display. Three surfaces
implement one `SurfaceAdapter` (`src/runtime/surface.ts`):

| Surface          | File                          | What it is                                        |
| ---------------- | ----------------------------- | ------------------------------------------------- |
| `ConsoleSurface` | `src/runtime/surface.ts`      | stdout. What `npm run demo` uses.                 |
| `WebSurface`     | `src/runtime/webSurface.ts`   | three.js in a browser. What `npm run world` uses. |
| `ChatSurface`    | `src/runtime/chatSurface.ts`  | a terminal. What `npm run chat` uses.             |
| `VoxelSurface`   | `src/runtime/voxelSurface.ts` | a diggable voxel world in first person. `npm run voxel`. |
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

To switch tomorrow: put `MINDS_BUILDER_API_KEY=...` in `.env`, set
`INSPIRAL_HOST=minds`, and change nothing else. If the key is missing or empty
the adapter logs a warning and falls back to the mock rather than crashing, so a
half-configured environment still runs the demo.

Nothing downstream of the seam knows a vendor exists: the validator, canon, tick
loop, character runtime and all three surfaces are host-agnostic and unchanged
by the swap.

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
