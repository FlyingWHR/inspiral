# Inspiral — Creative Minds Jam #1

**Worlds that remember the people who visit them — and can prove it.**

Read this page. The [README](README.md) is the engineering record behind it.

---

## 1. The problem, measured in my own product

I build [Trade Clash](https://tradeclash.com): an autonomous-esports arena where
you build an AI war-agent, it fights a live RTS match, and an audience watches
and bets. Sixteen satirical bloc leaders, real players, real traffic.

Eight days of its own first-party analytics — `npm run problem`:

| | |
|---|---|
| sessions | **1,418** |
| picked a side | **14** (0.99%) |
| built an agent | 13 (0.92%) |
| seen again | **1** |

Fourteen people out of fourteen hundred cared enough to pick a side, and the
product had no idea any of them had ever been there. Session ids are minted per
visit and die with the tab, so the true return rate is not 1-in-1418 — it is
**unknown**, which is worse. Nothing in that system could tell a returning fan
from a stranger, so it greeted every one of them like a stranger.

That is not a Trade Clash bug. It is the default condition of a creator's world
in a year when generating content costs nothing. When supply is infinite and
free, content stops being the scarce good. **The scarce good is a reason to come
back to one specific place.**

You cannot generate elapsed history. You can only let it elapse. It is the one
asset in the creator economy that appreciates rather than decays.

## 2. What it does

Point it at an IP. It compiles a cast, opens a world, and runs that world on a
clock whether or not anyone is watching. Visitors take sides. The world
remembers — and when they come back, an NPC brings it up, **citing the event
id**, which then resolves against an append-only log.

**The host proposes only the intent. Canon supplies the fact.** A wrong citation
is a test failure, not a bad vibe. That is the invention, and it is what
separates this from a chatbot with a personality prompt.

## 3. Judge it in five commands

Everything below runs offline with no API key, except `prove`, which is the one
thing a Mind is strictly required for.

```bash
npm install && npm test        # 311 tests, ~2s, no key, no network
npm run problem                # is this a real problem?    1418 / 14 / 1
npm run prove                  # what needs a Mind?         1 arc -> 6-8, live
npm run scale                  # what does it cost at size? cast x5.3 -> calls x1.00
npm run clock:status           # history nobody watched accumulate
npm run demo                   # the whole loop, ~2s, exits 0
```

## 4. Against the criteria

**Minds integration.** One Mind runs the whole district as a showrunner; every
character is a projection of it. Four conversation lanes, live-verified use of
`listMinds`, conversations, fingerprint/`waitForReply`, `subscribeEvents`,
cognition balance and per-tool spend, Circles, and app/skill unequipping —
`npm run platform` reads all of it live. **231 LLM turns, ~996 cognition
credits, seven consecutive days.**

`npm run prove` is the honest test of integrality: onboard the same real brand
document twice, with the host off and against a live Mind. Without one, 1 stub
arc — a cast that exists and a world that does not run. With one, six to eight
named storylines that cross-reference each other by bloc.

**Creator-economy fit.** The IP is my own and the analytics are my own. Source →
bible → **owner approval gate** → seed → ingest → digest → clip drafts. Nothing
publishes itself; a rejection puts zero characters, zero arcs and zero events
into canon, and there is a test asserting it.

**Innovation.** Provable memory. Five constraints decide what an NPC may hold
against you, the rendered line carries the `event_id`, and the citation is
verified against the log. Plus one Mind for any cast size as an *economic*
argument, and a clock whose whole job is to be boring for a week.

**Execution.** 311 tests in ~2s, offline. Typecheck clean. Four surfaces on one
seam — terminal, three.js ward, first-person diggable voxel world, chat. Canon
is append-only, enforced by SQLite triggers rather than by convention. `runTick`
never throws.

**Viability.** Invocations scale with narrative decisions — never with cast size,
never with traffic — and `npm run scale` measures it rather than asserting it.
Latency is answered structurally: the Mind is not in the interaction loop, and
three tests fail the moment a human is made to wait on it.

## 5. What is not built, stated plainly

- **Social ingestion adapters throw.** No API access method has been chosen, so
  there is no auth, no rate-limit policy and no ToS position. A stub returning
  `[]` would make a broken integration look like a quiet account.
- **Telegram approval** is real code tested against a fake transport; the
  network hop is unproven.
- **The affinity metric reads n=0 real visitors.** It is measurement
  infrastructure for a claim, not the claim. Synthetic patrol visitors are
  labelled and excluded from every cohort number.
- **The relationship mesh is O(n²)** and the bible caps at 24 characters. The
  digest now ships only the edges in play, which took prompt growth from x7.38
  to x2.73 for a 5.3x cast, but a genuinely large IP is untested.
- **No engine integration.** `SurfaceAdapter` is the boundary; four
  implementations exist.

The full list, including everything still owed, is in the README.

## 6. Links

| | |
|---|---|
| Repo | https://github.com/FlyingWHR/inspiral |
| Video | *(see submission)* |
| The contract | [SCHEMA.md](SCHEMA.md) — canon schema + directive spec |
| Creator pipeline | [docs/IP-PIPELINE.md](docs/IP-PIPELINE.md) |
| Live Mind transcript | [docs/transcripts/prove-tradeclash.txt](docs/transcripts/prove-tradeclash.txt) |
| Run it | [SETUP.md](SETUP.md) |
