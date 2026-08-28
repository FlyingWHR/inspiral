# Inspiral — Creative Minds Jam #1

**Somebody built on your work. Here is exactly what they changed.**

A creator opens a space. People make things in it, build on each other's things,
and come back to find their work taken further by someone else — with their name
still on it.

```bash
git clone https://github.com/FlyingWHR/inspiral && cd inspiral && npm install
npm test                                    # the whole suite, ~3s, no key, no network
INSPIRAL_API_KEY=dev npm run pieces:serve   # the whole product on one port
```

---

## 1. The one thing this is

Everything here is storage and transport for a single sentence:

> **"Maya kept your fennel and stale bread but changed your hour-long braise
> into a raw mandoline shave and a butter toast."**

Real output from a live Mind, on real prose. It names one thing kept and one
thing changed, in the contributors' own words. `npm run pieces` prints it next
to the two texts that produced it, so you can judge it rather than take our word
for it.

**Not "an AI remembers you."** Everybody knows software has a database, and
being remembered by a machine is not moving. Somebody *using your work* is.

## 2. Why the Mind is not optional

Without it the product still runs — contributions stored, attributed, linked,
permanent. And the notification says *"Maya changed it"*, which is a database
row read aloud, and nobody comes back for that.

The Mind does two things:

| Needs judgement | Does not |
|---|---|
| **Narrate** — what did this person change about that person's work | "Three people responded" — that is SQL |
| **Route** — which piece is worth this person's time | Attribution, lineage, storage, delivery |

Both degrade to nothing rather than to something invented. A dead host costs a
sentence, never the work.

It runs on its **own conversation lane**, because a lane carries history the Mind
pattern-matches — asking for one line of prose in a lane full of JSON directives
comes back as JSON. We learned that the hard way earlier in this repo.

## 3. How we got here, honestly

This repo contains a product that did not work and the evidence that killed it.
Both are still in the history, because the second product is an argument the
first one lost.

**We built a world.** Autonomous NPCs, arcs, a clock ticking unattended for nine
days, verifiable citations. `npm run clock:status` still shows it, and
[README.md](README.md) describes it.

**Then we measured it.** Nine days of real Mind-authored history produced **one**
usable moment. 639 events, 45% of them literally duplicate text. The four most
dramatic beats across five days were the *same beat four times* — same character,
same door, same demand, worded differently each time. Tension pinned at 100,
trust at 0, arcs "escalating" at stage 91 toward nothing. **The world could not
change**, and good prose disguised it.

**Then we measured ourselves.** `npm run problem` reads eight days of
first-party analytics from Trade Clash, a game one of us actually ships:
**1,418 sessions. 14 people picked a side. One came back.** Session ids die with
the tab, so the true return rate is not 1-in-1418 — it is *unknown*, which is
worse. The product could not tell a returning person from a stranger.

So the answer was never a better world. It was: make the thing somebody left
behind matter, and tell them when it does.

## 4. Judge it in six commands

```bash
npm test                       # the suite, offline, no key
npm run pieces                 # the sentence, next to the texts that made it
npm run problem                # why this exists — real analytics, bad number
npm run pieces:serve           # app + API + live feed, one origin
npm run clock:status           # nine days of unattended history, still on disk
npm run platform               # what we use of the Minds platform, read live
```

## 5. Against the criteria

**Minds integration.** One Mind, its own lane, two jobs that need judgement and a
written account of what does not. Live-verified use of `listMinds`,
conversations, fingerprint/`waitForReply`, `subscribeEvents`, cognition balance
and per-tool spend, Circles, app/skill unequipping. **260 LLM turns, ~1,277
cognition credits, across nine days.**

**Creator-economy fit.** The problem is measured in our own shipping product,
not asserted. The creator's digest leads with *contributions nobody has built on
yet* — an ignored contribution is what loses a person, and the creator is the
one who can fix it.

**Innovation.** Everything is an extension of something, so *"somebody built on
my thing"* is one exact query rather than a heuristic. Attribution is enforced by
database triggers that refuse `UPDATE` and `DELETE` — a lineage cannot be
rewritten to take a name off somebody's work.

**Execution.** 494 tests in ~3s, offline. Typecheck clean. Append-only canon,
five documented migrations, fail-closed auth, SSRF-guarded webhooks, `VACUUM
INTO` backups, health checks, additive moderation across all four read paths.

**Viability.** Invocations scale with narrative decisions, never with traffic —
`npm run scale` measures it. Latency is answered structurally: the Mind is never
in the interaction loop, and tests fail if an `await` on it reaches a request
path.

## 6. What is not built, plainly

- **Identity is asserted, not authenticated.** A durable id the client supplies.
  Clear storage and you are a stranger; copy an id and you are that person. This
  is the last structural hole and we are not pretending otherwise.
- **The retention thesis is untested.** Durable ids make the A/B runnable — half
  of returning people get the sentence, half get a generic line — and it has not
  been run. Nobody knows whether this works, including us.
- **The frontend is a reference implementation.** A designer is building the real
  one against `docs/API.md`.
- **No 3D yet.** The backend half is done — pieces carry an opaque `location`,
  `generation` is depth, presence is live — but nothing renders it.
- **Ceilings**, both marked in code: `lineage()` caps at 500 events per piece;
  the digest is O(pieces) reads.

## 7. Links

| | |
|---|---|
| Repo | https://github.com/FlyingWHR/inspiral |
| API reference | [docs/API.md](docs/API.md) |
| The contract | [src/pieces/contract.ts](src/pieces/contract.ts) — read this first |
| Live Mind transcript | [docs/transcripts/prove-tradeclash.txt](docs/transcripts/prove-tradeclash.txt) |
| The world that did not work | [README.md](README.md) |
