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

Then post something real and watch the ward pick it up, within one tick:

```bash
npm run ingest -- --fixture tradeclash --tick \
  --post "Okuma raised the strait toll a second time, on twelve hours' notice, and published the schedule after the convoys had already sailed." \
  --actors okuma,ferrox --arc arc_strait_toll
```

```
posted -> fixtures/tradeclash/drop_20260819112321.md
ingested 1  [evt_mt006iec_0001] Okuma raised the strait toll a second time...

--- tick ---
    Chancellor Ferrox [confront -> Director Okuma]
      "Director Okuma."
      "says the thing out loud, in front of witnesses, and does not soften it"
      "Okuma raised the strait toll a second time, on twelve hours' notice, and
       published the schedule after the convoys had already sailed."
      (cites evt_mt006iec_0001)
```

`--post` writes the same markdown file a person would drop in by hand; it just
saves you a heredoc on camera. Dropped files are gitignored — delete them
between takes, or `--reset` the world.

Covered end to end by `tests/ip-demo-beat.test.ts`, which replays exactly this
sequence in process and asserts the quote, the citation, and that the cited id
resolves in the log.

And what the owner gets back:

```bash
npm run digest -- --fixture tradeclash
npm run clips  -- --fixture tradeclash --write
```

`--hours` is a window of **world** time and defaults to 24. A post made with
`--post` is stamped now, so it lands in the default window; the fixture's back
catalogue is dated January 2026, so widen the window (`--hours 100000`) if you
want to see that too.

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
| `TelegramApprovalChannel` | `TELEGRAM_BOT_TOKEN` is set. `TELEGRAM_CHAT_ID` is optional — with none, the chat is taken from whoever messaged the bot last, so the owner never looks their own id up. Bot API over plain `fetch`, no SDK, no webhook. **Wire format, decision mapping, chunking, chat discovery and timeout are covered against a fake API in `tests/ip-telegram.test.ts`; the network hop itself is unproven.** |

A Telegram review that times out returns **reject**: silence is not consent. A
reply containing a JSON object is an edit; any other reply is a rejection with
that text as the reason, because applying free-text prose to a bible safely is
not something this can do and pretending otherwise would be worse than saying no.

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

- **The on-camera beat is deterministic, not guaranteed.** The mock is a fixed
  rule engine, so the shipped sequence (default seed 1, the Trade Clash fixture,
  the strait-toll post) cites on the first tick every single run — that is what
  the test pins. Vary the seed and it lands 13 times in 20. Every miss has one
  cause: the mock's ladder picks `break_alliance`, which is not in the
  renderer's citing action list (`confront | snub | sabotage`) even though
  `alliance_broken` is already in its GRIEVABLE set. Adding it there is a
  one-line change in `src/runtime/character.ts` and would take this to 100%;
  that file belongs to the surface work, so it was not touched.
  (An earlier version also lost the citation to the mock's bystander directive
  overwriting the relationship edge mid-batch. Aiming the post at the
  okuma/ferrox arc removes that entirely — the bystander is then always the
  third character, and writes a different edge.)
- The Telegram channel has never touched the real api.telegram.org. Treat it
  like `MindsHostRuntime`: the seam is real and now the message shapes are
  tested, but the network hop is not proven.
- An edit at the gate is applied once and committed; there is no second review
  round. An edit that fails validation is dropped whole rather than half-applied.
- `hints.json` is doing work a real Mind would have to do on a real account. The
  gap between `fixtures/tradeclash` and `fixtures/creator` is exactly that work.
