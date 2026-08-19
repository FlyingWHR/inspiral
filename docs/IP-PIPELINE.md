# The IP pipeline — inbound and outbound

> Point Inspiral at your accounts. It learns your IP and opens a world fans can
> walk into. You post something real, it's the talk of the world an hour later.
> The owner keeps an approval gate and a daily digest.

This document covers the layer above canon: where a world comes from, how the
owner's feed keeps feeding it, and what goes back out. The canon schema, the
directive spec, the tick loop and the surfaces are unchanged — see
[SCHEMA.md](../SCHEMA.md) and the main [README](../README.md).

---

## The one-command demo

```bash
npm run onboard -- --fixture tradeclash --reset --play 3
```

Handles in, living cast out: reads a source, compiles an IP bible, shows the
owner the draft, seeds a world through the existing seed path, then runs three
world ticks and prints what the cast does. ~3 seconds, no key, no network.

Then make it react to something you just posted:

```bash
cat > fixtures/tradeclash/drop.md <<'EOF'
item_id: tc_post_099
ts: 2026-01-18T09:00:00.000Z
actors: ferrox, cindra
arc_id: arc_tariff_spiral
significance: 0.9

Ferrox announced the grain duty would rise again in spring and read the
tonnage out loud, twice, so the record would have it.
EOF

npm run ingest -- --fixture tradeclash --once --tick
rm fixtures/tradeclash/drop.md
```

And what the owner gets back:

```bash
npm run digest -- --fixture tradeclash --hours 100000
npm run clips  -- --fixture tradeclash --hours 100000 --write
```

(`--hours` is a window of **world** time. The fixtures are dated January 2026,
so a small window will correctly report that nothing recent happened.)

---

## Shape

```
   IPSource                                            ApprovalChannel
  (fixture | x | youtube | ...)                        (cli | telegram)
        │                                                     ▲
        │ RawItem[]                                           │ draft
        ▼                                                     │
  ┌───────────────┐   compileBible    ┌──────────────┐  review │
  │  source pack  │ ────────────────► │  IP BIBLE    │ ────────┘
  └───────────────┘                   │   (draft)    │
        │                             └──────────────┘
        │ ONE host call                       │ approved
        │ (enrich; optional, discardable)     ▼
        │                              bibleToWorldSpec
        │                                     │
        │                                     ▼
        │                            seedFrom()  ◄── the ONE seed path
        │                                     │      (Tallow Ward uses it too)
        ▼                                     ▼
  ┌───────────────┐                  ╔══════════════════╗
  │  ingestOnce   │ ───────────────► ║   CANON  (SQLite) ║
  │  (0 host calls)│  events in the  ╚══════════════════╝
  └───────────────┘  frozen schema           │
                                             │ digest → tick → directives
                                             ▼
                                    ┌──────────────────┐
                                    │ showrunner's note│──► ApprovalChannel
                                    │ clip drafts      │──► ./data/clips/*.md
                                    └──────────────────┘
                                       nothing auto-posts
```

---

## 1. `IPSource` — the inbound seam

`src/ip/source.ts`. One interface: `fetch({since}) -> RawItem[]`, plus optional
`hints()`.

| Implementation | State |
|---|---|
| `FixtureSource` (`fixture:<name>`, or a bare name) | **Real and the default.** Reads `fixtures/<name>/items.json`, optional `hints.json`, and any `*.md` file as one item. |
| `x:`, `twitter:`, `youtube:`, `instagram:`, `tiktok:` | **Stubs.** `fetch()` throws `SourceNotImplementedError` with instructions. |

The stubs throw rather than returning `[]` on purpose: an integration that fails
silently is indistinguishable from a quiet account, which is the worst failure
this system could have. No social API access method has been decided, so there
is no auth code, no rate-limit policy and no ToS position in this repo.

A dropped `*.md` file is one item, with an optional `key: value` header ended by
a blank line — `item_id`, `ts`, `actors`, `arc_id`, `significance`, `url`, `kind`.
Everything after the blank line is the body. This is what "drop a post in" means
during a live demo.

## 2. Onboarding

`src/ip/onboard.ts`, `src/ip/bible.ts`.

1. `compileBible(handle, items, hints)` — **deterministic, zero host calls.**
   Themes from hashtags and word frequency, lore from the highest-engagement
   items, cast/graph/arcs/tone from `hints.json` when a fixture ships them.
2. **One** host call on the `onboard` alias, asked to enrich the draft. Anything
   unparseable, empty or shape-invalid is dropped and the draft stands. Against
   `MockHostRuntime` the enrichment is always discarded — which is the point:
   onboarding still produces a real world.
3. The approval gate.
4. `bibleToWorldSpec` → `seedFrom`. Lore becomes **real `notice_posted` events**
   in the log, not prose in a config file, so an NPC can cite the owner's actual
   pinned post by `event_id` on day 6.

`seedFrom` is now the only way day zero gets written. Tallow Ward is a
`WorldSpec` literal (`TALLOW_WARD`); an IP bible becomes one too.

## 3. The approval gate

`src/approval/index.ts`. `review()` returns approve / reject / edit.

| Implementation | Activates when |
|---|---|
| `CliApprovalChannel` | Always available. Prompts on a TTY; **auto-approves when there is no TTY** so CI and the demo never hang. `--reject` proves the gate blocks. |
| `TelegramApprovalChannel` | `TELEGRAM_BOT_TOKEN` **and** `TELEGRAM_CHAT_ID` are both set. Written against the Bot API over plain `fetch`; **not exercised — nobody has run it against a real bot.** |

A half-configured Telegram (token, no chat id) warns and falls back to the CLI.
A Telegram review that times out returns **reject**: silence is not consent.

`onboardIP` calls `seedFrom` on exactly one code path, after the gate. The test
`NOTHING reaches canon when the owner says no` asserts zero characters, zero
arcs and zero events after a rejection.

## 4. Ingestion

`src/ip/ingest.ts`. Poll → normalise → append. **Zero host invocations**, by
design: a per-item Mind call would make cost scale with how often the owner
posts, which is the wrong curve.

Raw kinds map onto the existing closed event vocabulary. There is no
`social_post` event type and there must not be — the cast can only reason about
actions it already knows how to hold against someone.

| `RawItem.kind` | `EventType` | Why |
|---|---|---|
| `post`, `pinned`, `video` | `notice_posted` | It is on the world's board now. |
| `comment` | `rumor_spread` | It travelled without being said. |
| `match` | `confrontation` | Two blocs met and one of them lost. |
| `profile` | *(not an event)* | Bible material, not news. |

Dedupe is per `item_id` (a meta row), plus an `ingest_cursor` on `ts`.
Onboarding marks the whole back catalogue as already ingested, so the poll loop
cannot replay it as breaking news.

When an item names two cast members, `actors[1]`'s view of `actors[0]` moves —
tension by default, `impact` to say otherwise — with the post's text as the
relationship `note` and the ingest event as `last_event_id`. That is the hook
the character runtime already uses to quote and cite. If the item names an open
arc, the arc's tension and summary move too, which is what gets the tick loop to
*act* on the news rather than merely list it.

## 5. Daily digest, 6. Outbound clips

`src/ip/outbound.ts`. Both read canon only and cost nothing.

- `showrunnerNote(repo, hours)` — what happened, storylines running, visitors,
  what came off the owner's feed, a tally and the cognition spend.
- `selectClips(repo, opts)` — top moments by significance, one per storyline,
  each with a tracked link `.../w/<world>?e=<event_id>&utm_source=…&utm_medium=clip`.
  `writeClips` drops them in `./data/clips/<date>.md`.

**Nothing posts anywhere.** There is no platform client in this file and no
credential is read. Video is not built and is not stubbed.

## 7. Fixtures

| Fixture | What it is for |
|---|---|
| `fixtures/tradeclash` | The user's own game. **Entirely invented** — see its README for the exact fields to replace. Ships `hints.json`, so it produces a full three-hander with a directed graph and two live arcs. |
| `fixtures/creator` | An invented maker channel with **no `hints.json`**. Shows what onboarding produces from raw items alone: one character, themes from hashtags, thin. That is what a real un-hinted social handle gets today. |

---

## Cost

| Costs an invocation | Does not |
|---|---|
| One onboard (the enrichment pass) | Reading a source, however many items |
| A world tick, as before | Ingesting a post, a video, a match result |
| | Compiling the bible |
| | The daily digest |
| | Selecting and rendering clips |

Asserted in `tests/ip-onboard.test.ts` (`hostCalls === 1`) and
`tests/ip-ingest.test.ts` (`totalHostInvocations() === 0`).

---

## Known limits

- **Character-to-character citation is not guaranteed on the very next tick.**
  The render path cites `relationship.last_event_id`, and `MockHostRuntime`'s
  bystander directive writes the same edge later in the same batch, overwriting
  the ingest's note before anything is rendered. Measured across 20 mock seeds: the very
  next tick quotes and cites the post 6-8 times out of 20; run two or three
  ticks and it is near-certain. The **visitor-facing** citation is
  deterministic, because `findGrievance` reads the event log directly and cannot
  be clobbered. Both are covered by tests. The fix is one condition in the
  mock's bystander block (skip the delta when its target is the first
  directive's target) or one line in `renderBehavior` to fall back to
  `slice.grievance` for character-to-character lines — both files are owned by
  the surface/host work, so neither was touched here.
- The Telegram channel is written and typed but has never been run against a
  real bot. Treat it like `MindsHostRuntime`: the seam is real, the wire is not
  proven.
- An edit at the gate is applied once and committed; there is no second review
  round. An edit that fails validation is dropped whole rather than half-applied.
- `hints.json` is doing work a real Mind would have to do on a real account. The
  gap between `fixtures/tradeclash` and `fixtures/creator` is exactly that work.
