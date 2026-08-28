# Pieces — API reference

Everything a frontend needs. One server, one origin.

```bash
INSPIRAL_HOST=minds INSPIRAL_API_KEY=dev npm run pieces:serve
# http://localhost:8795
```

Without `INSPIRAL_HOST=minds` everything works except the sentence — contributions
are stored, `changed` is absent. That is the real degraded path, not a stub.

---

## The one thing to design around

The product is a single feeling: **you come back and find the thing you made
has been changed by somebody else, with your name still on it.**

Everything below is storage and transport for one field: `changed`.

```
"Tomas kept your fennel and butter but changed your mandoline shave and
 butter toast into a green sauce from the discarded fronds with lemon,
 spooned over either version."
```

Written by the Mind. It always names one thing **kept** and one thing
**changed**, in the contributors' own words, addressed to the person waiting.

---

## Auth

`X-Inspiral-Key: <INSPIRAL_API_KEY>` on everything under `/v1`.

**Fails closed.** With no key configured on the server, `/v1` returns `503` and
the public pages still serve. Wrong or missing key on a configured server →
`401`.

Public, no key, deliberately — these are the shareable artefacts:

| | |
|---|---|
| `GET /w/<world>/p/<piece_id>` | a piece and its lineage, as a page |
| `GET /w/<world>/e/<event_id>` | one contribution, permanently addressable |

---

## Core objects

```ts
Piece {
  piece_id, title, brief,
  status: "open" | "closed",
  generation: number,      // DEPTH. never a score, never a ranking
  contributors: string[],  // fan ids, order of first appearance
  location: string,        // opaque: "test_kitchen", never a coordinate
  created_ts, updated_ts
}

Extension {
  event_id, piece_id,
  parent_event_id,         // what it builds on. the spine.
  fan_id, display_name,
  body,                    // the work itself
  changed?,                // THE SENTENCE. absent if the Mind was down.
  ts
}
```

**Everything is an extension of something.** The creator seeds a piece; the
first visitor extends the seed; the next extends either. One root, no special
cases — which is why "somebody built on my thing" is one exact query rather
than a heuristic.

---

## Endpoints

### Reading

| Method | Path | Returns |
|---|---|---|
| `GET` | `/v1/pieces` | `{ pieces: Piece[] }` — open only |
| `GET` | `/v1/pieces/:id` | `{ piece, seed_event_id, extensions[] }` — **oldest first** |
| `GET` | `/v1/space` | `{ world, pieces: (Piece & {here})[] }` — the whole room, one call |
| `GET` | `/v1/route?fan=` | `{ piece_id, because }` — where this person should start |
| `GET` | `/v1/waiting?fan=` | `{ fan_id, items[] }` — **the return screen** |

### Writing

| Method | Path | Body |
|---|---|---|
| `POST` | `/v1/pieces` | `{title, brief, location?}` → `201 {piece, page}` |
| `POST` | `/v1/pieces/:id/extend` | `{fan_id, parent_event_id, body, display_name?}` |
| `POST` | `/v1/pieces/:id/place` | `{location}` |
| `POST` | `/v1/seen` | `{fan_id}` — clears the return screen |
| `POST` | `/v1/pieces/:id/here` | `{fan_id, display_name?}` — presence heartbeat, re-POST every ~20s |
| `POST` | `/v1/pieces/:id/gone` | `{fan_id}` |

### Live — Server-Sent Events

`GET /v1/live` · `GET /v1/live?piece=<id>` — **public**, no key. The piece pages
are public, so their feed is too.

```js
new EventSource("/v1/live").onmessage = (e) => update(JSON.parse(e.data));
```

Data-only frames, no `event:` name — named events silently bypass `onmessage`.
Opens with `retry: 3000`, heartbeats every 25s, reconnects on its own.

```ts
{ type: "piece_seeded",   piece_id, title, ts }
{ type: "piece_extended", piece_id, event_id, fan_id, display_name,
                          generation, changed?, ts }
{ type: "presence",       piece_id, here: [{fan_id, display_name, since}], ts }
```

Presence fires **only when the room actually changes** — heartbeats are silent.
Anyone unheard-from for 60s is swept, so a closed tab does not haunt a piece.

### Creator

| Method | Path | Returns |
|---|---|---|
| `GET` | `/v1/digest?hours=24` | structured digest; `&format=text` for the rendered note |
| `POST` | `/v1/pieces/:id/report` | `{fan_id, event_id, reason}` |
| `POST` | `/v1/pieces/:id/hide` | `{event_id, by?}` — the API key **is** creator authority |
| `GET` | `/v1/pieces/:id/reports` | what has been reported here |

The digest leads with **contributions nobody has built on yet** — an ignored
contribution is the thing most likely to lose a person, and the creator is the
one who can fix it. Not window-scoped: something ignored for three days must not
drop off the list on the day it matters most.

**Hiding is additive.** The log refuses `UPDATE` and `DELETE`, so a takedown is
a new event readers respect — attribution and history stay intact, visibility
becomes a read-time decision. Hidden work disappears from the lineage, the
public page, the permalink (404) and the return screen, all four.

**Rate limit:** 5 extensions per fan per hour → `429` with `retry_after`.
Checked before the write and before any host call.

### Notifications

| Method | Path | Body / query |
|---|---|---|
| `GET` | `/v1/notify/prefs?fan=` | current preferences |
| `POST` | `/v1/notify/prefs` | `{fan_id, channel, address, enabled?, quiet_minutes?}` |
| `DELETE` | `/v1/notify/prefs?fan=&channel=` | opt out |

Channels are chosen by env — `console` always, plus `telegram`
(`TELEGRAM_BOT_TOKEN`), `webhook` (`INSPIRAL_WEBHOOK_URL`), `file`
(`INSPIRAL_NOTIFY_FILE`). `address` is opaque: a chat id, a URL, an email.

**`channel` is a stored value.** It must match a channel's `name` exactly —
rename one and everybody who chose it silently stops receiving anything.

Behaviour, all enforced in one place and individually tested:

- fires **only** on a real person building on your real work
- **batches** — three people in ten minutes is one message
- quiet window per person; held items are held, never dropped
- opting out keeps items queued: add an address tomorrow, hear about today
- a takedown **suppresses** a queued ping before it leaves
- gives up after 5 attempts

The body carries **the sentence**. "You have 1 update" is a notification about
nothing, and it is how a product teaches people to ignore it.

Webhook addresses are user-supplied, so they are SSRF-guarded: http(s) only,
private and link-local ranges refused (`INSPIRAL_WEBHOOK_ALLOW_PRIVATE=1` to
lift), `redirect: "manual"` so a public URL cannot 302 into a metadata endpoint.

### The return screen — the most important response

```ts
items: [{
  piece_id, piece_title,
  your_event_id, your_body,        // what you left
  their_event_id, their_fan_id,
  their_display_name, their_body,  // what they did
  changed?,                        // the sentence — the payload
  ts, permalink
}]
```

Render in that order: **your thing → their thing → who they are → the
sentence.** The sentence gets the typographic weight.

**An empty `items` is a real answer.** Say nothing, calmly. Never fabricate a
count, never nag. A made-up "3 people are talking about you" is exactly what
makes this category feel cheap.

---

## Errors

Never `500` for a caller mistake.

| Code | When |
|---|---|
| `400` | body under 8 or over 1200 chars; brief too thin; missing field |
| `401` / `503` | bad key / no key configured |
| `404` | no such piece, no such parent |
| `409` | the piece is closed — the request was fine, the world moved |

---

## Design constraints, non-negotiable

- **No leaderboards, badges, streaks, like counts.** `generation` is depth, not
  score. Ranking contribution turns a remix community into a farm.
- **AI is always visibly AI.** It never poses as a participant.
- **Never manufacture activity.** Empty states stay empty.
- **Attribution is permanent** — enforced by database triggers that refuse
  `UPDATE` and `DELETE`. It should *feel* permanent.
- **`display_name` on the public page**, never `fan_id`. A stranger reading the
  shareable artefact should see a person, not a database key.
- The work is the interface. Chrome gets out of the way.

## Spatial notes

- `location` is an **opaque string**. The backend has no opinion about geometry;
  the frontend maps `"test_kitchen"` to wherever it likes. Empty = unplaced.
- `generation` is what to scale, stack or weather. A piece twelve deep should
  not look like one that is one deep — that is consequence made visible, and
  it is the one thing a list cannot do.
- `here` on `/v1/space` is how many people are at a piece right now.

## Identity

`fan_id` is **asserted, not authenticated** — a durable id the client supplies.
Clearing storage makes you a stranger; copying an id makes you that person.
Durable and never recycled beats what came before it, and it is still not a
login. A host product with real sign-in should pass its verified id through.
