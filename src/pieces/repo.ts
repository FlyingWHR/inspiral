/**
 * PIECES, on top of canon.
 *
 * Deliberately a module over `CanonRepo` rather than more methods inside it.
 * `repo.ts` is already 800 lines and serves a different product; keeping the
 * piece queries here means the half of this repository that survives the pivot
 * stays legible, and the half that does not can be deleted without archaeology.
 *
 * Every write goes through `repo.appendEvent`. Nothing here writes to `events`
 * directly, so append-only, id allocation and the no-UPDATE/no-DELETE triggers
 * all still apply exactly as they do everywhere else.
 */

import type { CanonRepo } from "../canon/repo.js";
import type { WorldEvent } from "../types/events.js";
import type {
  Extension,
  MoveDiff,
  MoveValues,
  Piece,
  PieceWithLineage,
  Slot,
  WaitingForYou,
} from "./contract.js";
import { isHidden as hidden } from "./moderation.js";

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);


function rowToPiece(r: Record<string, unknown>): Piece {
  return {
    piece_id: String(r.piece_id),
    title: String(r.title),
    brief: String(r.brief ?? ""),
    status: r.status === "closed" ? "closed" : "open",
    generation: Number(r.generation ?? 0),
    contributors: JSON.parse(String(r.contributors ?? "[]")) as string[],
    location: String(r.location ?? ""),
    schema: JSON.parse(String(r.schema_json ?? "[]")) as Slot[],
    created_ts: String(r.created_ts),
    updated_ts: String(r.updated_ts),
  };
}

/**
 * An extension, read back out of the event that recorded it.
 *
 * `repo` is needed only for the display name, which lives on the visitor rather
 * than in the event: a name is mutable and the log is not, so denormalising it
 * into the payload would freeze whatever somebody was called the day they
 * posted.
 */
function eventToExtension(e: WorldEvent, repo?: CanonRepo): Extension {
  const p = e.payload as Record<string, unknown>;
  const fan = String(p.fan_id ?? "");
  return {
    event_id: e.event_id,
    piece_id: String(p.piece_id ?? ""),
    parent_event_id: String(p.parent_event_id ?? ""),
    fan_id: fan,
    display_name: repo?.getVisitor(fan)?.display_name || fan,
    body: String(p.body ?? ""),
    values: (p.values ?? {}) as MoveValues,
    ...(typeof p.changed === "string" && p.changed ? { changed: p.changed } : {}),
    ts: e.ts,
  };
}

/**
 * The creator starts something. The seed is an event like any other, so the
 * first visitor extends it exactly the way the tenth extends the ninth -- one
 * code path, no special case for an empty piece.
 */
export function seedPiece(
  repo: CanonRepo,
  input: {
    title: string;
    brief: string;
    piece_id?: string;
    location?: string;
    /** 2-4 slots, or none for a free-text piece. */
    schema?: Slot[];
  },
): Piece {
  const id = input.piece_id ?? (slug(input.title) || `piece_${Date.now().toString(36)}`);
  const seed = repo.appendEvent({
    source: "system",
    actors: [`piece:${id}`],
    type: "piece_seeded",
    payload: { summary: input.title, piece_id: id, brief: input.brief },
    significance_hint: 0.5,
  });

  const now = repo.now();
  repo.db
    .prepare(
      `INSERT INTO pieces (piece_id, title, brief, status, generation, contributors,
                           seed_event_id, location, schema_json, created_ts, updated_ts)
       VALUES (?, ?, ?, 'open', 0, '[]', ?, ?, ?, ?, ?)`,
    )
    .run(
      id, input.title, input.brief, seed.event_id, input.location ?? "",
      JSON.stringify(input.schema ?? []), now, now,
    );

  return {
    piece_id: id, title: input.title, brief: input.brief, status: "open",
    generation: 0, contributors: [], location: input.location ?? "",
    schema: input.schema ?? [], created_ts: now, updated_ts: now,
  };
}

/**
 * Put a piece somewhere. Separate from seeding because placement is the
 * SPACE's decision, not the creator's: a brief is written once and a room can
 * be rearranged any number of times without touching what the piece is.
 */
export function placePiece(repo: CanonRepo, pieceId: string, location: string): boolean {
  const r = repo.db
    .prepare("UPDATE pieces SET location = ?, updated_ts = ? WHERE piece_id = ?")
    .run(location.slice(0, 64), repo.now(), pieceId) as { changes?: number };
  return (r.changes ?? 0) > 0;
}

export function getPiece(repo: CanonRepo, pieceId: string): Piece | undefined {
  const r = repo.db.prepare("SELECT * FROM pieces WHERE piece_id = ?").get(pieceId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToPiece(r) : undefined;
}

export function listPieces(repo: CanonRepo, status: "open" | "closed" | "all" = "open"): Piece[] {
  const rows =
    status === "all"
      ? repo.db.prepare("SELECT * FROM pieces ORDER BY updated_ts DESC").all()
      : repo.db.prepare("SELECT * FROM pieces WHERE status = ? ORDER BY updated_ts DESC").all(status);
  return (rows as Record<string, unknown>[]).map(rowToPiece);
}

export function seedEventId(repo: CanonRepo, pieceId: string): string | undefined {
  const r = repo.db.prepare("SELECT seed_event_id FROM pieces WHERE piece_id = ?").get(pieceId) as
    | { seed_event_id: string }
    | undefined;
  return r?.seed_event_id;
}

/**
 * Who wrote the thing being built on, if anybody did.
 *
 * Needed BEFORE the extension is written, because the sentence has to be
 * addressed to a person and there is no editing it in afterwards -- the log
 * refuses UPDATE by design. Returns null for the creator's seed, and that null
 * is load-bearing: a live run addressed to the seed produced "Ada kept your
 * five ordinary things", talking to the brief as though the brief were a
 * person. There is nobody to address, so there is nothing to say.
 */
export function parentAuthor(
  repo: CanonRepo,
  eventId: string,
): { fan_id: string; body: string; display_name: string } | null {
  const parent = repo.getEvent(eventId);
  if (!parent || parent.type !== "piece_extended") return null;
  const p = parent.payload as Record<string, unknown>;
  const fan = String(p.fan_id ?? "");
  if (!fan) return null;
  return {
    fan_id: fan,
    body: String(p.body ?? ""),
    display_name: repo.getVisitor(fan)?.display_name || fan,
  };
}

/**
 * What changed between two moves. Computed, never inferred.
 *
 * This is the single upgrade that makes the host's sentence trustworthy. It
 * used to be handed two paragraphs and asked to spot the difference, which is
 * a reading-comprehension task a model can quietly fail at while sounding
 * fluent. Now it is told "kept the fennel, changed braise to raw" and asked
 * only to write it well -- the fact is settled before the model sees it.
 *
 * Slots absent from either side are skipped rather than reported as changes:
 * a schema that gained a slot after somebody moved must not retroactively
 * accuse them of removing it.
 */
export function diffMoves(schema: Slot[], parent: MoveValues, child: MoveValues): MoveDiff {
  const out: MoveDiff = { kept: [], changed: [] };
  for (const slot of schema) {
    const from = parent[slot.key];
    const to = child[slot.key];
    if (from === undefined || to === undefined) continue;
    if (from === to) out.kept.push({ key: slot.key, label: slot.label, value: to });
    else out.changed.push({ key: slot.key, label: slot.label, from, to });
  }
  return out;
}

/** Human rendering of a diff, for a prompt or a page. */
export function describeDiff(d: MoveDiff): string {
  const kept = d.kept.map((k) => `${k.label}: ${k.value}`).join(", ");
  const changed = d.changed.map((c) => `${c.label}: ${c.from} -> ${c.to}`).join(", ");
  return [kept && `KEPT ${kept}`, changed && `CHANGED ${changed}`].filter(Boolean).join("\n");
}

export class ExtendError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_piece" | "closed" | "no_parent" | "wrong_piece"
      | "too_short" | "too_long"
      /** A move that does not fill the slots the piece declares. */
      | "bad_move"
      /** A move identical to the one it builds on. */
      | "no_change",
  ) {
    super(message);
    this.name = "ExtendError";
  }
}

/**
 * Somebody builds on somebody.
 *
 * `parent_event_id` is checked against this piece, not merely for existence.
 * Without that check an extension could chain to a parent in a different
 * lineage, and the "who does this notify" answer -- the one thing the whole
 * product turns on -- would quietly point at the wrong person.
 */
export function extendPiece(
  repo: CanonRepo,
  input: {
    piece_id: string;
    parent_event_id: string;
    fan_id: string;
    body: string;
    /** What they picked. Validated against the piece's schema before storing. */
    values?: MoveValues | undefined;
    changed?: string | undefined;
    display_name?: string | undefined;
  },
): { extension: Extension; piece: Piece; notifies: string | null } {
  const piece = getPiece(repo, input.piece_id);
  if (!piece) throw new ExtendError(`no piece '${input.piece_id}'`, "no_piece");
  if (piece.status === "closed") throw new ExtendError("that piece is finished", "closed");

  const parent = repo.getEvent(input.parent_event_id);
  if (!parent) throw new ExtendError("nothing to build on", "no_parent");
  const parentPayload = parent.payload as Record<string, unknown>;
  const parentPiece =
    parent.type === "piece_seeded" ? String(parentPayload.piece_id) : String(parentPayload.piece_id ?? "");
  if (parentPiece !== input.piece_id) {
    throw new ExtendError("that parent belongs to a different piece", "wrong_piece");
  }

  /**
   * Only slots this piece declares, and only options it offers. A value the
   * schema does not know is dropped rather than stored: the whole point of a
   * finite palette is that the diff is computable, and one free-text value
   * smuggled in makes every later diff involving it a guess again.
   */
  const values: MoveValues = {};
  for (const slot of piece.schema) {
    const v = input.values?.[slot.key];
    if (typeof v === "string" && slot.options.includes(v)) values[slot.key] = v;
  }
  const missing = piece.schema.filter((s) => s.required && !values[s.key]);
  if (missing.length) {
    throw new ExtendError(`pick a ${missing.map((m) => m.label.toLowerCase()).join(" and a ")}`, "bad_move");
  }

  /**
   * A MOVE THAT CHANGES NOTHING IS NOT A MOVE, and this has to be refused
   * here rather than in the form.
   *
   * The palette already disables its own button, but a rule enforced only in
   * one client is not enforced: any API caller, and the world itself, could
   * post an identical move -- and it would notify the parent's author that
   * somebody built on their work when nobody had. That is the one thing this
   * product must never do, so it is checked where every caller passes.
   *
   * Only for slotted pieces. On free text an identical body is somebody
   * repeating themselves, which is rude rather than false.
   */
  if (piece.schema.length) {
    const before = (parent.payload as Record<string, unknown>).values as MoveValues | undefined;
    if (before && piece.schema.every((sl) => before[sl.key] === values[sl.key])) {
      throw new ExtendError("change one thing first -- this is what is already there", "no_change");
    }
  }

  repo.ensureVisitor(input.fan_id, input.display_name ?? "");

  const event = repo.appendEvent({
    source: "visitor",
    actors: [`fan:${input.fan_id}`, `piece:${input.piece_id}`],
    type: "piece_extended",
    payload: {
      summary: input.changed ?? `${input.fan_id} extended ${piece.title}.`,
      piece_id: input.piece_id,
      parent_event_id: input.parent_event_id,
      fan_id: input.fan_id,
      body: input.body,
      ...(Object.keys(values).length ? { values } : {}),
      ...(input.changed ? { changed: input.changed } : {}),
    },
    significance_hint: 0.7,
  });

  const contributors = piece.contributors.includes(input.fan_id)
    ? piece.contributors
    : [...piece.contributors, input.fan_id];
  const now = repo.now();
  repo.db
    .prepare(
      `UPDATE pieces SET generation = generation + 1, contributors = ?, updated_ts = ?
       WHERE piece_id = ?`,
    )
    .run(JSON.stringify(contributors), now, input.piece_id);

  /**
   * Whose work was built on. Null when extending the creator's seed -- nobody
   * is waiting on that, and inventing a recipient would be the first step
   * toward manufacturing the activity this product must never manufacture.
   */
  const notifies =
    parent.type === "piece_extended" ? String(parentPayload.fan_id ?? "") || null : null;

  if (notifies && notifies !== input.fan_id) {
    /**
     * Recorded against the person whose work changed, witnessed by whoever
     * changed it. `visitor_moments` already carries exactly this shape, which
     * is why there is no new table for the thing the product is about.
     */
    repo.addMoment(notifies, {
      event_id: event.event_id,
      ts: event.ts,
      summary: input.changed ?? `Somebody built on your work in ${piece.title}.`,
      weight: 0.8,
      witnesses: [input.fan_id],
    });
  }

  repo.addInteraction(input.fan_id, {
    event_id: event.event_id,
    ts: event.ts,
    character_id: null,
    kind: "extend",
    detail: piece.title,
  });

  return {
    extension: eventToExtension(event, repo),
    piece: { ...piece, generation: piece.generation + 1, contributors, updated_ts: now },
    notifies: notifies && notifies !== input.fan_id ? notifies : null,
  };
}

/** The piece and everything done to it, oldest first. */
export function lineage(repo: CanonRepo, pieceId: string): PieceWithLineage | undefined {
  const piece = getPiece(repo, pieceId);
  if (!piece) return undefined;
  /**
   * Tie-break on event_id, and it is not cosmetic.
   *
   * `eventsInvolving` returns newest-first (ORDER BY seq DESC) and Array.sort
   * is stable, so sorting on `ts` alone leaves equal timestamps in the order
   * they arrived -- reversed. Under a VirtualClock every event in a test shares
   * a timestamp, so the whole lineage came back backwards: the argument read in
   * reverse, and whoever went second appearing to have gone first. Possible on
   * a real clock too, at millisecond resolution.
   *
   * `event_id` is `evt_<ms base36>_<counter>` and documented as monotonic and
   * sortable, so it settles ties in insertion order. Found by the HTTP layer's
   * page test, which is the only place the order was visible.
   */
  const extensions = repo
    .eventsInvolving(`piece:${pieceId}`, 500)
    .filter((e) => e.type === "piece_extended")
    .map((e) => eventToExtension(e, repo))
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.event_id.localeCompare(b.event_id));
  return { piece, seed_event_id: seedEventId(repo, pieceId) ?? "", extensions };
}

/**
 * THE RETURN SCREEN.
 *
 * Extensions whose parent was authored by this person. One join, no scoring and
 * no "meaningfully related" judgement -- that is the entire reason everything
 * is an extension of something rather than a mix of contributions and replies.
 *
 * An empty list is a real answer and must be returned as one. A product that
 * invents a reason to come back is the exact thing that makes this category
 * feel cheap.
 */
const seenKey = (fanId: string): string => `seen:${fanId}`;

/**
 * Mark everything up to now as read.
 *
 * A timestamp rather than a per-item flag: the question is only ever "what has
 * happened since I last looked", and one meta row answers it without a table
 * or a migration. It also degrades correctly -- a fan who never acknowledges
 * simply keeps seeing the list, which is annoying rather than wrong.
 */
export function markSeen(repo: CanonRepo, fanId: string, through?: string): void {
  repo.setMeta(seenKey(fanId), through ?? repo.now());
}

export function waitingFor(
  repo: CanonRepo,
  fanId: string,
  permalink: (eventId: string) => string,
  limit = 20,
): WaitingForYou {
  const seenThrough = repo.getMeta(seenKey(fanId));
  const mine = new Set(
    repo
      .eventsInvolving(`fan:${fanId}`, 500)
      .filter((e) => e.type === "piece_extended")
      .map((e) => e.event_id),
  );
  if (mine.size === 0) return { fan_id: fanId, items: [] };

  const items: WaitingForYou["items"] = [];
  for (const e of repo.recentEvents(500).slice().reverse()) {
    if (e.type !== "piece_extended") continue;
    const x = eventToExtension(e, repo);
    if (x.fan_id === fanId) continue; // your own work is not news to you
    if (!mine.has(x.parent_event_id)) continue;
    if (seenThrough && x.ts <= seenThrough) continue; // already read
    /**
     * A takedown has to reach the return screen too. Without this, work a
     * creator hid stayed invisible on the public page and kept arriving,
     * personally, in the notification of the one person guaranteed to read it
     * -- which is the worst possible place for moderation to leak.
     */
    if (hidden(repo, x.event_id)) continue;

    const parent = repo.getEvent(x.parent_event_id);
    const piece = getPiece(repo, x.piece_id);
    items.push({
      piece_id: x.piece_id,
      piece_title: piece?.title ?? x.piece_id,
      your_event_id: x.parent_event_id,
      your_body: String((parent?.payload as Record<string, unknown>)?.body ?? ""),
      their_event_id: x.event_id,
      their_fan_id: x.fan_id,
      their_display_name: repo.getVisitor(x.fan_id)?.display_name || x.fan_id,
      their_body: x.body,
      ...(x.changed ? { changed: x.changed } : {}),
      ts: x.ts,
      permalink: permalink(x.event_id),
    });
    if (items.length >= limit) break;
  }
  return { fan_id: fanId, items };
}
