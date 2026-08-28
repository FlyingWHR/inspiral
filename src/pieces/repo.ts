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
import type { Extension, Piece, PieceWithLineage, WaitingForYou } from "./contract.js";

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** better-sqlite3 handle. CanonRepo owns it; we borrow it for piece tables. */
const db = (repo: CanonRepo): {
  prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown };
} => (repo as unknown as { db: ReturnType<typeof db> }).db;

function rowToPiece(r: Record<string, unknown>): Piece {
  return {
    piece_id: String(r.piece_id),
    title: String(r.title),
    brief: String(r.brief ?? ""),
    status: r.status === "closed" ? "closed" : "open",
    generation: Number(r.generation ?? 0),
    contributors: JSON.parse(String(r.contributors ?? "[]")) as string[],
    created_ts: String(r.created_ts),
    updated_ts: String(r.updated_ts),
  };
}

/** An extension, read back out of the event that recorded it. */
function eventToExtension(e: WorldEvent): Extension {
  const p = e.payload as Record<string, unknown>;
  return {
    event_id: e.event_id,
    piece_id: String(p.piece_id ?? ""),
    parent_event_id: String(p.parent_event_id ?? ""),
    fan_id: String(p.fan_id ?? ""),
    body: String(p.body ?? ""),
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
  input: { title: string; brief: string; piece_id?: string },
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
  db(repo)
    .prepare(
      `INSERT INTO pieces (piece_id, title, brief, status, generation, contributors,
                           seed_event_id, created_ts, updated_ts)
       VALUES (?, ?, ?, 'open', 0, '[]', ?, ?, ?)`,
    )
    .run(id, input.title, input.brief, seed.event_id, now, now);

  return {
    piece_id: id, title: input.title, brief: input.brief, status: "open",
    generation: 0, contributors: [], created_ts: now, updated_ts: now,
  };
}

export function getPiece(repo: CanonRepo, pieceId: string): Piece | undefined {
  const r = db(repo).prepare("SELECT * FROM pieces WHERE piece_id = ?").get(pieceId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToPiece(r) : undefined;
}

export function listPieces(repo: CanonRepo, status: "open" | "closed" | "all" = "open"): Piece[] {
  const rows =
    status === "all"
      ? db(repo).prepare("SELECT * FROM pieces ORDER BY updated_ts DESC").all()
      : db(repo).prepare("SELECT * FROM pieces WHERE status = ? ORDER BY updated_ts DESC").all(status);
  return (rows as Record<string, unknown>[]).map(rowToPiece);
}

export function seedEventId(repo: CanonRepo, pieceId: string): string | undefined {
  const r = db(repo).prepare("SELECT seed_event_id FROM pieces WHERE piece_id = ?").get(pieceId) as
    | { seed_event_id: string }
    | undefined;
  return r?.seed_event_id;
}

export class ExtendError extends Error {
  constructor(
    message: string,
    readonly code: "no_piece" | "closed" | "no_parent" | "wrong_piece" | "too_short" | "too_long",
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
      ...(input.changed ? { changed: input.changed } : {}),
    },
    significance_hint: 0.7,
  });

  const contributors = piece.contributors.includes(input.fan_id)
    ? piece.contributors
    : [...piece.contributors, input.fan_id];
  const now = repo.now();
  db(repo)
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
    extension: eventToExtension(event),
    piece: { ...piece, generation: piece.generation + 1, contributors, updated_ts: now },
    notifies: notifies && notifies !== input.fan_id ? notifies : null,
  };
}

/** The piece and everything done to it, oldest first. */
export function lineage(repo: CanonRepo, pieceId: string): PieceWithLineage | undefined {
  const piece = getPiece(repo, pieceId);
  if (!piece) return undefined;
  const extensions = repo
    .eventsInvolving(`piece:${pieceId}`, 500)
    .filter((e) => e.type === "piece_extended")
    .map(eventToExtension)
    .sort((a, b) => a.ts.localeCompare(b.ts));
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
export function waitingFor(
  repo: CanonRepo,
  fanId: string,
  permalink: (eventId: string) => string,
  limit = 20,
): WaitingForYou {
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
    const x = eventToExtension(e);
    if (x.fan_id === fanId) continue; // your own work is not news to you
    if (!mine.has(x.parent_event_id)) continue;

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
