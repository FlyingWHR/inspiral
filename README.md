# Inspiral

**Worlds that remember the people who visit them — and can prove it.**

> ## ⚠️ This README describes the FIRST product, which did not work.
>
> The submission is **[SUBMISSION.md](SUBMISSION.md)** — a different thing built
> on the same canon. Section 3 of that page has the measurements that killed
> this one; they are still runnable (`npm run clock:status`).
>
> Kept, not deleted, because the second product is an argument this one lost.
> Everything below is true. The parts that survived — append-only canon, the
> host seam, the validator, the approval gate, identity, receipts — are what the
> new product is built on.

---

## The problem, measured in my own product

I build [Trade Clash](https://tradeclash.com): an autonomous-esports arena where
you build an AI war-agent, it fights a live RTS match, and an audience watches
and bets. Sixteen satirical bloc leaders. Here is eight days of its own
first-party analytics:

```
$ npm run problem

  sessions               1418
  picked a side          14      0.99%
  built an agent         13      0.92%
  seen again             1
```

Median session length is **0.0 seconds**. Fourteen people out of fourteen
hundred cared enough to pick a side, and the product had no idea any of them had
ever been there. Session ids are minted per visit and die with the tab, so
nothing in that system could tell a returning fan from a stranger, and it
greeted every one of them like a stranger.

That is not a Trade Clash bug. It is what a creator's world is by default: a
place with no memory, in a year when content generation costs nothing and the
only genuinely scarce thing left is a reason to come back to a specific place.

**You cannot generate elapsed history. You can only let it elapse.** That is the
one asset in the creator economy that appreciates instead of decaying, and it is
what this builds.

## What it does

Point it at an IP. It compiles a cast, opens a world, and runs that world on a
clock whether or not anybody is watching. Visitors take sides. The world
remembers, and when they come back an NPC brings it up — **citing the event id**,
which the demo then resolves against an append-only log.

The host proposes only the *intent*. Canon supplies the *fact*. A wrong citation
is a test failure, not a bad vibe.

## See all of it at once (`docker compose up`)

```bash
docker compose up --build
```

| | |
|---|---|
| <http://localhost:8790/w/tallow-ward> | the log — nine days of it, every line linkable |
| <http://localhost:8887> | the three.js ward |
| <http://localhost:8888> | the voxel ward, first person |

Node 22 in the image because that is the repo's floor and `better-sqlite3` v13
ships prebuilds for it, so nothing compiles at build time. `INSPIRAL_HOST=mock`
and no API key: no network, no credentials, no writes accepted.

**The host's `./data` is mounted read-only and copied on start.** A clock may be
mid-tick against those files, and a second writer on a SQLite world is how you
lose the one artefact here that cannot be regenerated. The entrypoint copies the
`-wal` sidecar too: these worlds run in WAL mode, so copying the `.db` alone
seeds a world tens of events short of the real one — present, plausible, and
quietly out of date.

## The memory layer (`npm run serve`)

A world you visit needs its own audience, and the numbers above are the argument
against it: memory is a retention feature, and you cannot retain people you
never acquired. So the same canon is also served as a **layer**, for a product
that already has traffic, stakes and recurring outcomes.

```bash
INSPIRAL_API_KEY=... npm run serve -- --db ./data/tradeclash.db
```

| | |
|---|---|
| `POST /v1/matches` | something happened — the webhook |
| `POST /v1/stakes` | somebody took a side — the retention hook |
| `GET /v1/rivalry?a=&b=` | what is between these two — the caster's question |
| `GET /v1/memory?fan=` | what is remembered about X — the return visit |
| `GET /w/<world>` and `/w/<world>/e/<id>` | the log, as a page — **public** |

Customer one is Trade Clash, and its contract was already written:
`IMatchFeed` gives `MatchId`, `BotIds` and `WinnerSide`, decided on the
authoritative sim tick. One finished match is one `confrontation` in canon, and
a season of them is a rivalry nobody had to author.

**The public pages matter more than they look.** Every citation this project has
ever produced was unshareable — clip drafts pointed at a permalink that did not
exist. A receipt nobody can open is not evidence, it is a claim with a hex
string after it.

Writes and personal memory need `X-Inspiral-Key` and **fail closed**: with no
key configured the public pages still serve and every authenticated route
answers 503. `match_id` is idempotent, because webhooks retry and a retried
match that moved the rivalry twice would silently inflate a grudge.

## Build What Creators Need Next

The jam's brief, in its own terms.

**Discoverability** — every beat the cast plays is a clip draft with a permalink
and a citation attached (`npm run clips`): the property generating its own
posts, sourced.

**Engagement** — the unit is not a session, it is a grudge, and it works for two
fans at once with separate memories.

**Workflow efficiency** — handles in, living cast out, in about a minute and one
model call (`npm run onboard`), behind an approval gate. Nothing publishes
itself.

---

## Commands

Everything runs with **no API key, no account, no network, no build step**.
Node 22+ (developed on 24.19.0).

```bash
npm install          # once
npm test             # the whole suite, headless, no engine, no key
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

**The one that never stops.** Real elapsed history, on disk.

```bash
npm run clock         # tick the real ward, forever
npm run clock:status  # how much history has actually accumulated
```

### The evidence a judge asks for

Six commands, in the order the questions usually come:

```bash
npm run problem      # is this a real problem?      1418 sessions, 14 sides, 1 return
npm run fixture      # is the IP real?              brand doc -> cast, mechanically
npm run prove        # what needs a Mind?           1 arc -> 6-8, live
npm run scale        # what does it cost at size?   cast x5.3 -> calls x1.00
npm run authorship   # who wrote the dialogue?      host-written share of rendered lines
npm run platform     # what of the Minds platform is used? read live, no key needed
```

`fixture` regenerates the cast from Trade Clash's own brand document, so the
provenance is a script rather than a promise.

`prove` is **the only thing here that a Mind is strictly required for**, which is
why it is the headline. It onboards the same un-hinted source twice, host off
and host live, and prints the two bibles side by side.

```bash
INSPIRAL_HOST=minds npm run prove   # 0 arcs without a Mind -> 2 with one
```

The compiler reads hashtags; it cannot decide what a body of work is *about*.
Arcs are what the tick loop escalates, so zero arcs is a cast that exists and a
world that does not run.

See [SETUP.md](SETUP.md) to run it, [RUNBOOK.md](RUNBOOK.md) for the demo shot
list, and [docs/IP-PIPELINE.md](docs/IP-PIPELINE.md) for the inbound/outbound
layer — source adapters, the IP bible, the approval gate, ingestion, the daily
digest and clip drafts, including which parts are fixture and which are real.

## Looking at it, and measuring it

A world that scores 3/10 on UX does not need opinions, it needs numbers.

```
npm run shots        # render all eight scene archetypes to docs/screens/looks
npm run pixelstats -- docs/screens    # read the histograms back
```

`pixelstats` and `contactsheet` are vendored from
[thrixel/build-world](https://github.com/thrixel/build-world) under Apache-2.0
(see `tools/visual/`). We rejected the rest of that project — Thrixel's
text-to-3D asset generation — because it needs an account and, by the vendor's
own README, a paid plan for a real build, and the licence position on shipping
generated assets in a jam submission could not be established. The measurement
half was free and paid for itself in one run, by proving that a "visual
improvement" we had already shipped was blowing 20.6% of its pixels to white.

**Two colour-space notes, both of which cost real time to find.**

three.js converts sRGB hex for you: `new THREE.Color('#775541')` already lands
in the linear working space, and calling `.convertSRGBToLinear()` on top makes
everything muddy. We do not do that anywhere, and the one `colorSpace`
assignment in the codebase is on a CanvasTexture, where it is required.

The mirror-image mistake is the one that bit us. The voxel mesher was writing
sRGB bytes **straight into three's vertex-colour attribute**, which is read as
linear — converting zero times where the documented trap is converting twice.
`0x77` entered as linear 0.467 and left the display transform near sRGB 0.71:
every block lighter than authored and about half as saturated. It hid an entire
colour system, and it means any visual judgement made before the fix was
measured through the wrong transform. One `srgbToLinear` in `mesher.js` moved
chroma P99.5 from 0.100 to 0.130 and arc95 from 53 to 296 degrees.

**The value ladder is absolute.** Block colours are not tinted, blended or
derived from anything that came before — each block is assigned a SLOT and takes
that slot's OKLab lightness (VOID 0.19 / DARK 0.32 / MID 0.48 / LIGHT 0.64 /
HIGH 0.80). BACKDROP is the sky and is the one value the ladder leaves free. The
ladder only reaches the *frame* if the darkest and lightest tiers actually
appear, so the face-shading ramp bottoms out at 0.30 to put VOID under every
overhang, and the interiors carry a lit cornice so HIGH is in shot.

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
sky, sun, hemisphere, ambient, fog, practicals and colour grade; the ward and
the voxel world read the same profiles. A tavern is warm, dim and firelit; a
council chamber is cold, hard and lit from a window you cannot reach; a studio
is flat, bright and artificial. Same code, same generator — the difference is
data, which is the "it learns your IP" claim made visible in one frame.

Two shaders do the work: a gradient sky dome (`skydome.js`) that replaced
three's physical `Sky`, because a physical sky is genuinely brighter than
anything under it and cannot be art-directed, only surrendered to; and a
lift/gamma/gain/saturation/vignette grade (`grade.js`) that runs after tone
mapping, which is where `gain` under 1.0 stops the brightest thing in frame
reaching 255.

**Themed build palettes.** The hotbar is the archetype's, not one global list —
tavern hands you plank, timber and lantern, a council chamber hands you stone —
so anything a visitor builds is on-theme by construction. Each archetype also
carries a one-line brief with no score and no completion state attached. The
reward is that the cast reacts to what you put down, in the feed.

---

## What this repo is and is not

The shipping 3D engine is still an open question, so nothing above the seam
knows about one. What was worth freezing first is the canon schema and the
directive spec: **[SCHEMA.md](SCHEMA.md) is the deliverable** — read and sign
off on that first. The rest is a working implementation proving the schema
survives contact with a real loop, a failing host, and a returning visitor.

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
and that the design was forced. **That was wrong.** Adding one Mind's platform
email (`getMind(id).email`, e.g. `john.carmack@hellominds.ai`) to another Mind's
circle returns `action: "mind_added"` and the member shows up in `getCircle()`
with `isSteward: false`. Removal returns `deactivated`. It works today,
undocumented.

So one Mind is a **choice**:

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

A future version with a real budget could give a **principal** cast member its
own Mind and keep the showrunner for everyone else. That is the interesting
version of the idea. It is not an eight-day change.

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

**Measured, not asserted.** `npm run scale` runs the identical tick loop over
both worlds and prints what actually moved:

```
world          cast  edges  ticks  calls  calls/tick   digest
Tallow Ward       3      6      8      8        1.00     5.1K
Trade Clash      16    240      8      8        1.00    14.0K

cast x5.3  ->  invocations x1.00     (the bill in calls)
           ->  prompt bytes x2.73    (the bill in tokens)
```

The second row is the interesting one, and it used to read **x7.38** — worse
than linear, because the relationship mesh is O(n²) and the digest shipped all
of it. 3 characters carry 6 edges, 16 carry 240, and at the bible's cap of 24
that is 552 edges in every prompt. This tool is what caught it.

The digest now sends only the edges **in play**: participants in an open arc,
anyone in the recent log, anyone a present visitor has a stance towards. The
mesh is still quadratic on disk; the host simply stops being billed for the part
of it nobody is acting on. Two tests in `tests/tick.test.ts` pin the filter and
the fallback — an empty relationship picture would be worse than a large one.

### Latency: nobody waits on a model

A live Mind answers in **40–166 s, median ~75 s**. That is the number that
decides whether any of this ships.

It is fine for the tick, and fine precisely because **the Mind is not in the
interaction loop**. It decides what a district does over the next four hours; a
75-second decision inside a 4-hour cadence is 0.5% of the window. Every line a
visitor actually reads is rendered locally, for free, in milliseconds.

The one place that was not true was arrival. `visitorArrive` awaited the host,
so a first visit — and any return to a ward that had moved — put the entire
latency budget in front of a human standing in the doorway. It no longer does:
arrival is served from canon immediately and the host call runs behind it, with
whatever the Mind decides landing on a later beat. That is also how the fiction
works, since characters react in world time rather than chat time.

Three tests in `tests/visitors.test.ts` hold the line, and the first one fails
the moment an `await` on the host creeps back into the arrival path. Against a
deliberately slowed 500 ms host, arrival returns in **4 ms** with a line already
on screen, and the invocation is still spent — deferred, not skipped.

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
                 voxel.test.ts, visitors.test.ts    ← the suite
docs/research/   voxel engine + high-density framework survey (background reading)
```

Append-only is enforced by SQLite triggers: `UPDATE` and `DELETE` on `events`
raise. It is a property of the database, not a convention.

---

## Assumptions about the Minds platform

Flagged because I made these calls without being able to ask.

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
the `minds` CLI handles that. This is exactly the bug that had our clock running
mock-authored for a day while we believed it was live. Every entry point in this
repo therefore starts with `node --env-file-if-exists=.env`, and shell variables
still win over the file.

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

**Still open:**

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
in-memory database. That is fine for a demo and worthless as evidence: elapsed
time cannot be compressed afterwards. So there is a process whose whole job is
to be boring for a week.

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
  clock          not running
  days elapsed   8.87   (212.9 h of real time)
  log spans      9.69 days   2026-08-18T14:47:18.388Z .. 2026-08-28T07:22:22.549Z
  ticks          96
  events         694
```

Stopped now, because it was spending cognition on a world the current product
does not use. The history stays on disk and `clock:status` still reads it.

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
tiers, props. Adding a scene is data, not engine code: the ward was already
generated from a layout definition and this is that same path with eight
definitions instead of one.

Every archetype declares **named places** (`the_bar`, `the_dais`, `kiln_row`)
which is what the directive system targets. Canon says the name; the surface
turns it into coordinates; nothing above the seam learns what a coordinate is.

### How the choice is made

The archetype rides along in the **existing** onboarding host call — no extra
invocation, because the budget is ~12/day and a scene choice is not worth one of
them. If the host says nothing usable, a keyword score over the bible picks one
deterministically: a wrong-but-reasoned tavern beats a coin-flip ballroom.

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

The simulation is not the world; the world is a display. Five implementations of
one `SurfaceAdapter` (`src/runtime/surface.ts`):

| Surface          | File                          | What it is                                        |
| ---------------- | ----------------------------- | ------------------------------------------------- |
| `ConsoleSurface` | `src/runtime/surface.ts`      | stdout. What `npm run demo` uses.                 |
| `WebSurface`     | `src/runtime/webSurface.ts`   | three.js in a browser. What `npm run world` uses. |
| `ChatSurface`    | `src/runtime/chatSurface.ts`  | a terminal. What `npm run chat` uses.             |
| `VoxelSurface`   | `src/runtime/voxelSurface.ts` | a diggable voxel world in first person. `npm run voxel`. |
| `MemorySurface`  | `src/runtime/surface.ts`      | collects instead of printing. What the tests use. |

Two browsers on one ward are two different fans. Each connection is handed an
identity (Wren, Ash, …) with its own standing and its own memory, shown in the
HUD. Coming back is free when the cast has done nothing since you left — the
greeting is replayed from canon rather than costing an invocation to be told the
same thing.

`npm run chat` attaches to the *same running world* as the browser over the same
socket and replays the *same beats* through the adapter. Two windows, one canon.
The text surface contains no 3D vocabulary at all — `moveTo` is a sentence, not
a translation — which is the actual test of whether the seam holds.

### The voxel ward (`npm run voxel`)

The surface that answers "can I actually play in it". The world is a real
chunked voxel grid, not a decorative cube field: 32³ chunks in typed arrays,
greedy meshing (124k voxels collapse to ~10k triangles), a DDA raycast for
aiming, and swept AABB collision. First person — WASD, mouse look under pointer
lock, gravity, jump, sprint, fly. Left click breaks, right click places, `1`–`9`
pick from a nine-block hotbar, and the affected chunk remeshes immediately.

The ward is *generated into the grid* from a layout definition, so every wall,
roof and cobble is diggable. The cast walks that terrain with A* over standable
surface cells: they route around a wall you build, and give up rather than walk
through one you have sealed them behind.

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
needs COOP/COEP headers to serve. And the scaffolding an engine sells you —
scene tree, entity system, game state — is the part Inspiral already owns in
TypeScript. What was needed was glTF loading, soft shadows, ambient occlusion,
animation blending, screen-space labels and a camera; three.js ships all of it
as addons. No renderer code was written: `GLTFLoader`, `AnimationMixer`,
`PCFSoftShadowMap`, `GTAOPass`, `CSS2DRenderer` and `OrbitControls` do the work.
three.js is served straight out of `node_modules` via an import map, so there is
no build step and the judge's URL is a plain static page.

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

## The Minds host

`HostRuntime` (`src/host/HostRuntime.ts`) is the seam. Two implementations, one
switch:

```ts
// src/host/index.ts -- THE ENTIRE SWAP COST
if (cfg.host === "minds") return new MindsHostRuntime({ builderApiKey: key, ... });
return new MockHostRuntime({ seed: cfg.seed });
```

- `MockHostRuntime` — **the default.** Rule-based, deterministic, instant, free,
  offline. Same seed, same history. Every screenshot and every test above ran
  against it.
- `MindsHostRuntime` — the real Builder API client. Verified live on 20 Aug 2026;
  see below.

To switch: put `MINDS_BUILDER_API_KEY=...` in `.env`, set `INSPIRAL_HOST=minds`,
and change nothing else. All thirteen entry points go through
`startHostRuntime()` and every one loads `.env` (`--env-file-if-exists`), so
`npm run demo`, `world`, `voxel`, `chat` and `tick` all pick up the key.
**Which runtime is live is printed in the terminal banner and shown in the
browser HUD**, so it is provable on camera rather than asserted.

Degradation is layered, because a half-configured environment must not kill a
demo: no key at all → mock; `INSPIRAL_HOST=minds` with an empty key → warn, use
mock; a key that is present but wrong → the adapter is constructed, the real API
rejects it, and `startHostRuntime` warns and falls back to mock. Only the mock
failing is treated as a real bug.

Nothing downstream of the seam talks to the host directly; everything reads
canon. That is what lets one Mind drive a three.js ward, a first-person voxel
world, a terminal and a headless demo at once, and why the next surface in
whatever engine needs no changes on the Mind's side.

### Verified against the live key (20 Aug 2026)

Auth, `humanId` (parsed straight from the JWT), Mind selection, conversations,
send/receive and the validator all work end to end. What that run taught us:

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

Onboarding enrichment against `fixtures/tradeclash` is the headline: a REAL
brand document from a shipping product, sixteen leaders, no goals and no arcs in
the source because brand documents do not contain them. The deterministic
compiler gets 1 stub arc out of it; the Mind returns **six to eight named
storylines** that cross-reference each other by bloc, plus real goals and an
authored premise. The count varies run to run because a live model is not
deterministic — two runs an hour apart gave 6 and 8, and the committed
transcript is the 8:
[docs/transcripts/prove-tradeclash.txt](docs/transcripts/prove-tradeclash.txt).
The earlier `creator` run (0 arcs → 2) is still in the repo and shows the same
thing on a thinner source.

### Still not done

| | |
| --- | --- |
| The accumulating history is mock-authored | The clock has been running since 19 Aug. Real elapsed time, real event ids, real relationship drift — rule-based prose. Restarting it against a live Mind is one command, but every hour that passes is an hour of the week that stays mock. |
| Clock on the live host | **Deliberately not switched.** Cost is fine (~2.6/invocation) but median 75s latency and the rejection-retry tail need a decision. |
| Social source adapters (`x:`, `youtube:`, …) | Deliberate stubs that **throw**, because no API access method has been chosen. A stub returning `[]` would let a broken integration look like a quiet one. Fixtures are the real, default path. |
| `fixtures/tradeclash` | Entirely invented placeholder content. Its README lists the exact fields to replace with the real game's. |
| Telegram approval | Real code, activates on `TELEGRAM_BOT_TOKEN` alone, tested against a fake transport. Needs a bot token, not a Minds key. |
| LLM-generated prose in the mock | Not coming. The mock is rule-based on purpose: deterministic, instant, free, so the loop can be tested without a host. |
| Networking, auth, persistence beyond SQLite, multi-world | Not built. |

---

## Next

1. Sign off on [SCHEMA.md](SCHEMA.md), or mark it up.
2. Decide the engine. Then write one `SurfaceAdapter`.
3. Wire the real Mind and check the items above.
