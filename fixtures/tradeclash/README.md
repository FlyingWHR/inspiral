# Trade Clash — REAL IP

This is not a placeholder. Trade Clash is a shipping product built by the same
person who wrote Inspiral: an autonomous-esports arena where you build an AI
war-agent, it fights a 1v1 RTS match on an OpenRA fork, and an audience watches
and bets on the result. *BUILD · CLASH · BET · OWN.*

Everything in `hints.json` and `items.json` is generated from that product's own
material by `npm run fixture`. Nothing here is hand-authored to make a demo
work, and re-running the converter over an edited source is how you update it.

```bash
npm run fixture                                   # source -> hints.json + items.json
npm run onboard -- --fixture tradeclash --reset   # 16 leaders, one world
npm run prove   -- --fixture tradeclash           # what a Mind adds to it
npm run problem                                   # why any of this is needed
```

## `source/IPdesign.csv` — the cast, verbatim

The live brand source from `~/ProjectW/TradeClash`, referenced by the product's
own broadcast caster for leader portraits. Sixteen blocs, one satirical
animal-headed leader each, with the region, the satire being aimed, an example
policy, a default emotion, a signature prop and an animation tell.

**What it does not contain, and what the fixture therefore does not claim:**
goals, taboos, relationships, arcs, or tone rules. A brand document is a cast
and a look. It is not a relationship matrix and it is not a season outline.

That absence is the most useful thing in this directory. It is what a real IP
owner actually hands you, and closing the gap between it and a world that can
run is the job `npm run prove` measures a Mind doing. Filling those fields in by
hand here would delete the finding and make the fixture a lie.

The satire targets public figures and states, which is the product's existing,
published editorial position — not something Inspiral invented for a demo.

## `source/audience.json` — the problem, measured

Aggregated first-party analytics from the product, 25 Jul – 2 Aug 2026. Counts
only: the raw export carries a session id per visit and is deliberately not
redistributed here.

**1,418 sessions. 14 picked a side. 13 built an agent. 1 session id seen again.**

Read that last number carefully, and see the caveat inside the file: session ids
are minted per visit and do not survive a browser restart, so the true return
rate is *unknown*, not 1-in-1418. That is the finding rather than a footnote.
The product could not tell a returning visitor from a new one, so it treated
every one of those people as though they had never been there before.

`npm run problem` prints it, and `npm run problem -- --raw <events.jsonl>`
recomputes it from source so the aggregate is checkable rather than trusted.

## Dropping a post in live

Any `*.md` file here is one item — the same path a real feed would take.

```bash
npm run ingest -- --fixture tradeclash --tick \
  --post "AmeriCorp raised the semiconductor tariff a second time, without notice." \
  --actors americorp,moonfactory --arc arc_trade_clash_1
```

`actors[0]` did the thing; `actors[1]` has to live with it and reacts on the
next tick. Point `--arc` at an open storyline or the tick loop will list the
news rather than act on it. Dropped files are gitignored.

## Why the tests do not use this fixture

They use `fixtures/tradeclash-fiction`, which is synthetic and frozen. Pipeline
tests should not break because an owner edited their brand document — a test
fixture wants stability, a demo fixture wants truth, and those are different
jobs. See that directory's README.
