# Trade Clash fixture — INVENTED. Replace before you show this to anyone.

Nobody on this repo has access to real Trade Clash data. Everything in
`items.json` and `hints.json` is plausible fiction written to exercise the
pipeline, and it is isolated to those two files on purpose: swapping in real
data is an edit, not a refactor.

Run it:

```bash
npm run onboard -- --fixture tradeclash
```

## What you must replace

### `hints.json` — the bible material

`hints.json` is what a Mind is *supposed* to extract from `items.json`. It ships
pre-extracted so the demo runs with no API key. Every field here is a claim
about your IP and every one of them is currently made up.

| Field | What it must become |
|---|---|
| `world_name`, `summary` | The real pitch line for Trade Clash. |
| `characters[]` | The **real bloc leaders**. `character_id` is permanent — it appears in every event, every citation and every relationship row, so pick it once. `brief`, `goals`, `taboos` and `voice` are what the character runtime renders dialogue from; thin ones produce thin NPCs. |
| `relationships[]` | The real standing between blocs. **Directed**: `ferrox -> cindra` is not `cindra -> ferrox`, and the asymmetry is where the drama comes from. Numbers are `affinity -100..100`, `trust 0..100`, `tension 0..100`. |
| `arcs[]` | The storylines actually running in your current season. |
| `tone` | Your real register and your real banned phrases. |
| `themes`, `audience_tone` | How your audience talks about the game. |

Delete `hints.json` entirely and onboarding still works — it falls back to
deriving everything from `items.json`, which produces one character and a thin
world. That fallback is what a real, un-hinted social account gets today.

### `items.json` — the feed and the match stream

| Field | What it must become |
|---|---|
| `item_id` | A stable id from your system. Ingestion dedupes on it; if it changes between polls the item is ingested twice. |
| `kind` | `profile` \| `pinned` \| `post` \| `video` \| `comment` \| `match`. See the mapping table below. |
| `ts` | Real publish time, ISO-8601. Ordering and the ingest cursor both depend on it. |
| `text` | The real post body or match report. This is what NPCs quote, so it is worth writing well. |
| `url` | Real permalink. It ends up in the clip drafts. |
| `actors` | **Required for anything you want the cast to react to.** `character_id`s, `actors[0]` is the initiator. An item with no `actors` is logged against the first character in the cast. |
| `arc_id` | Which storyline this belongs to. Threading a match onto an arc is what gets the tick loop to *act* on it rather than merely list it. |
| `significance` | 0..1. Omit and it is derived from `metrics`. |
| `impact` | Optional `{affinity, trust, tension}` — how much this moves `actors[1]`'s view of `actors[0]`. Omit and it is a `+12` tension nudge, nothing else. |

### How a match becomes an event

`kind: "match"` maps onto the existing `confrontation` event type. There is no
`match` event type and there should not be — the cast can only reason about
actions it already knows how to hold against someone. Two blocs met and one of
them lost; that is a confrontation, and the loser's relationship to the winner
moves.

Full mapping in `src/ip/ingest.ts` (`KIND_EVENT_TYPE`).

## Dropping a post in live

Any `*.md` file in this directory is one item. The easy way, and what the demo
uses:

```bash
npm run ingest -- --fixture tradeclash --tick \
  --post "Okuma raised the strait toll a second time, on twelve hours' notice, and published the schedule after the convoys had already sailed." \
  --actors okuma,ferrox --arc arc_strait_toll
```

That writes `drop_<timestamp>.md` here and ingests it. Within one tick Ferrox
confronts Okuma, quotes the post, and cites its event id.

By hand, the same thing:

```
item_id: tc_post_099
ts: 2026-01-18T09:00:00.000Z
actors: okuma, ferrox
arc_id: arc_strait_toll
significance: 0.9

Okuma raised the strait toll a second time, on twelve hours' notice, and
published the schedule after the convoys had already sailed.
```

`actors[0]` is whoever did the thing; `actors[1]` is whoever has to live with
it, and is the one who reacts on the next tick. Point `arc_id` at an open
storyline or the tick loop will list the news rather than act on it.

Dropped files are gitignored. Delete them between takes, or re-run `onboard`
with `--reset`.
