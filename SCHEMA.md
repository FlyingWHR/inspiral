# Inspiral — Canon Schema and Directive Spec

**Status: proposed, awaiting sign-off. Freeze this before writing engine code.**

This is the contract. Everything else in the repo is an implementation of it, and
everything built later — Luanti, Godot, Telegram, a second world, a different
host — has to hold to it. It is short on purpose. Read it once, argue with it,
then freeze it.

Two things are defined here:

1. **The event schema** — the only way anything is recorded.
2. **The directive spec** — the only way a host may change the world.

If both hold, an NPC can say "you sided with me on the fourth, and here is what
he did while you were gone" and be *provably* right rather than plausibly right.
That sentence is the product. Everything below exists to make it true.

---

## 0. The one rule

**Canon is the source of truth. The Minds platform is not.**

The host is a stateless opinion generator. It is handed a briefing and returns
directives. It stores nothing we depend on. Every durable fact — who hates whom,
what happened, who the visitor sided with — lives in a SQLite file we own, in
the schema below.

This is the sovereignty seam. It is the reason a platform outage is a skipped
tick rather than an amnesiac world, and the reason moving off Minds costs one
file (`src/host/minds.ts`) rather than a rewrite.

Two structural consequences, both enforced in code:

- The host never reads the database. It only ever sees a compiled digest.
- The host never writes to the database. It emits directives, which are
  validated against canon before a single row moves.

---

## 1. Event schema — FROZEN

Append-only. Rows are never updated and never deleted; SQLite triggers make
both a hard error, so this is a property of the database rather than a
convention people remember.

```jsonc
{
  "event_id":          "evt_mm8w2680_0001",   // sortable, unique
  "ts":                "2026-03-02T08:00:00.000Z",
  "source":            "tick",                 // seed|tick|visitor|system|host
  "actors":            ["vance", "okonkwo"],   // [0] is the initiator
  "type":              "confrontation",
  "payload":           { "summary": "..." },   // type-specific, small
  "significance_hint": 0.8                     // 0..1, ADVISORY ONLY
}
```

| Field | Rules |
|---|---|
| `event_id` | `evt_<base36 ms>_<counter>`. Lexicographic order = insertion order, so "what happened after X" is a string comparison. |
| `ts` | ISO-8601 UTC. **World** time, which in a demo runs faster than wall time. |
| `source` | Where it came from, not who acted. |
| `actors` | 1–8 entries. A character id, or a visitor as `fan:<id>`. **`actors[0]` is the initiator** — the whole grievance system depends on this. |
| `type` | Closed vocabulary (below). Not free text. |
| `payload` | Small object. `payload.summary` is the human-readable line used in digests and transcripts. |
| `significance_hint` | The host's own guess at how much this should matter later. **Advisory.** Canon re-ranks on read, so a host cannot flatter its way into permanent memory. |

### Event types

```
NPC-driven     confrontation, notice_posted, snub, tribute_offered,
               alliance_offered, alliance_formed, alliance_broken,
               sabotage, concession, rumor_spread
Arcs           arc_opened, arc_advanced, arc_resolved
Visitors       visitor_arrived, visitor_departed, visitor_pledged,
               visitor_spoke, visitor_recognized, visitor_gifted
System         tick_skipped, directive_rejected, world_created
```

**Sign-off question:** is anything missing that a 3D world will need in the next
ten days? Adding a type later is cheap; changing the five field names is not.

---

## 2. Canon state

Derived from the log. Exists so reads are fast, not because it is authoritative
— it can always be rebuilt by replay.

### 2.1 Character sheet

Stable identity. Only `mood` moves during play.

```jsonc
{
  "character_id": "vance",
  "name":  "Sera Vance",
  "faction": "The Ledger",
  "title": "Assessor of the Ledger",
  "brief": "One paragraph. The spine of who they are.",
  "goals":  ["Recover the Kiln Row debt in full and in public"],
  "taboos": ["Never raises her voice"],
  "voice":  { "register": "clipped, formal", "tics": ["states figures exactly"], "max_words": 24 },
  "mood": "cold",
  "home_location": "counting_house"
}
```

`taboos` are hard "this character would never" lines, enforced at render time.
`voice` is consumed by the character runtime, which costs no host invocations.

### 2.2 Relationship graph

**Directed, and asymmetric on purpose.** `A→B` is a different row from `B→A`.
Vance may find Okonkwo tiresome while Okonkwo considers her the author of his
ruin. That asymmetry is where the drama comes from; a symmetric graph produces
two characters agreeing about how much they disagree.

```jsonc
{
  "from_id": "okonkwo",
  "to_id": "vance",
  "affinity": -35,        // -100 hatred .. +100 devotion
  "trust": 10,            //    0 none   .. 100 total
  "tension": 60,          //    0 calm   .. 100 about to break
  "note": "She took my father's tools and wrote it down as a line item.",
  "last_event_id": "evt_...",   // the event that last moved this edge
  "updated_ts": "..."
}
```

`last_event_id` is what lets a character explain *why* they feel something and
point at the receipt.

### 2.3 Arc

A running storyline. Open arcs are what the next tick is asked to advance.

```jsonc
{
  "arc_id": "arc_kiln_debt",
  "title": "The Kiln Row Debt",
  "status": "open",              // open | escalating | resolved | dormant
  "participants": ["vance", "okonkwo"],
  "stage": 1,                    // monotonic, only moves forward
  "tension": 55,
  "summary": "Running prose, rewritten as the arc advances.",
  "resolution": null
}
```

An arc crossing tension 70 becomes `escalating`, and the digest says so.

### 2.4 Tone rules

World-level style constraints, applied to every rendered line. Not requested
politely of the host — enforced locally after the fact.

```jsonc
{
  "world_id": "default",
  "register": "Grimy municipal fantasy. Dry, specific, unsentimental.",
  "banned_phrases": ["as you know", "greetings, traveler"],
  "forbidden_topics": ["modern technology", "game mechanics"],
  "max_line_words": 32
}
```

### 2.5 Visitor record

```jsonc
{
  "fan_id": "wren",
  "first_seen": "2026-03-03T08:00:00.000Z",
  "last_seen":  "2026-03-07T09:00:00.000Z",
  "display_name": "Wren",
  "present": true,
  "interactions": [
    { "event_id": "evt_...", "ts": "...", "character_id": "okonkwo",
      "kind": "recruit_visitor", "detail": "..." }
  ],
  "stance": { "okonkwo": 34, "vance": -24, "quill": 5 },
  "notable_moments": [
    { "event_id": "evt_...", "ts": "...", "weight": 0.95,
      "summary": "They took Okonkwo's side in public when it cost them something.",
      "witnesses": ["okonkwo"] }
  ]
}
```

Three things worth arguing about before this freezes:

- **`stance` is per character, not global.** Taking a side must cost you
  something with someone. A single "reputation" number cannot express that.
- **`notable_moments.witnesses`** — only characters who were present may recall
  a moment. An NPC citing something they did not see is the failure mode that
  makes the whole illusion collapse, so it is a data constraint, not a prompt.
- **`present`** — existence is not presence. A visitor who left is remembered
  but cannot be greeted; the digest only ever lists people who are actually here.

---

## 3. Directive spec — FROZEN

What the host returns. Nothing else is accepted.

```jsonc
{
  "directives": [
    {
      "actor": "vance",                  // must be an existing character
      "action": "confront",              // closed vocabulary
      "target": "okonkwo",               // character | fan:<id> | location | null
      "dialogue_intent": "states the shortfall out loud, and does not soften it",
      "arc_id": "arc_kiln_debt",         // or null
      "significance_hint": 0.8,
      "canon_deltas": [ /* see below */ ]
    }
  ],
  "note": "optional, logged, never applied"
}
```

### The important design decision

**`dialogue_intent` is intent, not dialogue.** The host decides *what happens*;
the character runtime decides *how it sounds*.

That split is doing three jobs at once:

1. One Mind can project three characters without their voices bleeding
   together, because it is never asked to be three characters — it is asked
   what the district does next.
2. The same directive drives Luanti, Godot or Telegram from a single decision.
3. Rendering is local, stateless and free, so dialogue does not consume
   metered cognition.

### Actions

```
confront, post_notice, snub, offer_tribute, offer_alliance, accept_alliance,
break_alliance, sabotage, concede, spread_rumor, greet_visitor,
recruit_visitor, hold
```

`hold` is a real move — a quiet tick is a valid tick — and may still carry
canon deltas.

### Canon deltas — the only way to change the world

A host cannot write arbitrary state. It may request one of exactly seven
operations, within hard limits.

```jsonc
{"op":"relationship_delta","from_id":"a","to_id":"b","affinity":-10,"trust":-5,"tension":8,"note":"why"}
{"op":"arc_open","arc_id":"arc_x","title":"...","participants":["a","b"],"summary":"...","tension":20}
{"op":"arc_advance","arc_id":"arc_x","stage_delta":1,"tension":10,"summary":"..."}
{"op":"arc_resolve","arc_id":"arc_x","resolution":"how it ended"}
{"op":"visitor_stance","fan_id":"f1","character_id":"a","sentiment":15,"moment":"...","moment_weight":0.8}
{"op":"character_mood","character_id":"a","mood":"unrepentant"}
{"op":"world_fact","statement":"a durable fact","about":["a"]}
```

### Limits

| Limit | Value | Why |
|---|---|---|
| affinity / trust step | ±25 per tick | Grudges are earned slowly. A host cannot swing hatred to devotion in one move. |
| tension step | ±30 | Same. |
| visitor stance step | ±30 | One meeting cannot make someone family. |
| deltas per directive | 8 | Caps blast radius. |
| directives per tick | 4 | A tick is one narrative beat, not a season. |

All values are clamped to their canon ranges on write regardless of what
arrives, so a limit breach is degraded rather than trusted.

---

## 4. Validation — two stages

Both must pass before anything is written.

**Stage 1 — shape.** Zod. Is this the right JSON at all?

**Stage 2 — referential.** Does it point at things that exist?

- `actor` must be an existing character. The cast is fixed; the host may not
  invent people.
- `target` must be an existing character, an existing `fan:<id>`, or is treated
  as a location (allowed, warned).
- An actor may not target themselves.
- `greet_visitor` / `recruit_visitor` require a `fan:<id>` target.
- `arc_advance` / `arc_resolve` require an arc that exists and is not already
  resolved.
- `arc_open` must not collide with an existing arc.
- Relationship deltas must name two different, real characters.

Stage 2 is the one that earns its keep. A host will cheerfully invent a fourth
faction leader, resolve an arc that was never opened, or move a relationship
between two people one of whom it made up — and every one of those is
shape-valid JSON.

### Failure policy

| Failure | Response |
|---|---|
| Malformed JSON | Reject, re-prompt **once** with the specific errors, then skip. |
| Fails referential checks | Same. |
| Fails again after repair | Skip the tick. Log `directive_rejected`. |
| Host timeout (180s default) | Skip; replay last directives **with deltas stripped**. |
| Single delta throws | Drop that delta, keep the rest of the tick. |
| Anything else | Absorbed. The tick fails; the process does not. |

Replay strips deltas deliberately: a host failing repeatedly must not be able to
ratchet relationships by failing.

---

## 5. Cost model

**Host invocations scale with narrative decisions. Never with cast size. Never
with visitor traffic.**

| Costs an invocation | Does not |
|---|---|
| A world tick | Rendering dialogue |
| A visitor's first contact | Adding a fourth faction leader |
| A visitor doing something consequential | A thousand visitors watching |
| One repair attempt after a rejection | Any read of canon |

A fourth character costs zero additional invocations, because the tick asks
"what does this district do next" rather than polling each character.

Enforced by `INSPIRAL_DAILY_HOST_BUDGET` (default 12/day). Past the cap the
scheduler refuses to call out and the world runs on its last directives.

**Platform constraints this design is shaped by, already verified:**

- No mind-to-mind Circles on the Builder API. The Circles endpoints take
  human emails.
- Free tier is 3 Minds.

Hence: **exactly one Mind.** Three NPCs are server-side projections of it. Not a
simplification of a multi-agent design — the multi-agent design is not available,
and would have the wrong cost curve if it were.

---

## 6. What sign-off means

Freezing this means these will not change without a migration:

1. The five event fields.
2. `actors[0]` is the initiator.
3. Directive shape: `{actor, action, target, dialogue_intent, canon_deltas}`.
4. The seven delta ops.
5. Canon is authoritative; the host is stateless.

Things deliberately left open, because the engine is undecided:

- Locations are opaque strings. No coordinates, no scene graph.
- No engine-specific fields anywhere.
- `payload` is loose by design.

### Open questions worth a decision now

1. **Is the action vocabulary right for a 3D world?** It covers social moves.
   Physical ones — blocking a door, taking an object, following someone — are
   absent.
2. **Should visitor stance decay over time?** It currently does not. A visitor
   returning after six months is greeted as warmly as one returning after a day.
3. **Multi-world.** `tone_rules` is keyed by `world_id`; nothing else is. If
   module #1 must host two districts at once, that is a schema change.
4. **Who arbitrates contradictions?** The `qc` conversation alias is wired but
   unused. Nothing currently checks whether the world has drifted out of tone.
