/**
 * THE CONTRACT. Freeze this before anything else is written against it.
 *
 * The product is one feeling: you come back and find the thing you made has
 * been changed by somebody else, with your name still on it. Not "an NPC
 * remembers you" -- everybody knows the machine has a database, and being
 * remembered by software is not moving. Somebody *using* your work is.
 *
 * That feeling has a shape wherever it works -- forks, stitches, remixes,
 * covers, samples -- and the shape is always the same: an artefact, a chain of
 * people who changed it, and attribution that survives the change.
 *
 * ---------------------------------------------------------------------------
 * ONE ACTION, NOT TWO
 * ---------------------------------------------------------------------------
 *
 * The obvious model is `contribute` (add to a piece) and `extend` (build on
 * someone's contribution). That was rejected. Two actions means two data
 * shapes, two validators, two UI paths, and -- worse -- an ambiguous case every
 * time somebody adds to a piece nobody has touched yet.
 *
 * Everything is an EXTENSION of something. The creator seeds a piece; the first
 * visitor extends the seed; the next extends either the seed or that visitor.
 * The lineage is a tree with one root and no special cases.
 *
 * What this buys, and it is the whole reason: **"somebody built on my thing"
 * becomes one exact query.** Find extensions whose parent's author is me. No
 * heuristics, no scoring, no "meaningfully related" judgement call. The
 * notification that carries the entire emotional payload is a join.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES WHERE
 * ---------------------------------------------------------------------------
 *
 * A Piece is a row (it has mutable current state: title, status, generation).
 * An Extension is an EVENT and never a row -- it is history, it is attribution,
 * and it must be as unfalsifiable as everything else in canon. The events table
 * already refuses UPDATE and DELETE at the database level, so a lineage cannot
 * be quietly rewritten to take somebody's name off their work.
 *
 * That is not a technicality. Attribution IS the product. If it can be edited,
 * the feeling it produces is worth nothing.
 */

/**
 * The thing people make together.
 *
 * Mapped to its own table rather than reusing `arcs`, despite `arcs` being a
 * near-exact structural match (title/status/participants/stage/summary/
 * resolution). Reuse would have saved a migration and cost permanent
 * confusion: a table named `arcs` holding pieces, with a dead `tension` column,
 * is what somebody decodes at 3am. `SCHEMA_VERSION` already has a migration
 * switch; this is fifteen lines of DDL through a door that is already open.
 */
export interface Piece {
  piece_id: string;
  /** What it is, in the creator's words. Shown at the top of the page. */
  title: string;
  /**
   * Why it exists and what a good extension looks like. Creator-authored, and
   * the single strongest lever on whether anybody contributes anything good --
   * a vague brief produces "nice!" and a sharp one produces work.
   */
  brief: string;
  /** `open` accepts extensions. `closed` is readable, finished, still cited. */
  status: "open" | "closed";
  /**
   * How many extensions deep the piece is. Not a score and never shown as one:
   * a leaderboard turns contribution into farming, which is the failure mode
   * every remix community eventually has to undo.
   */
  generation: number;
  /** Everyone who has extended it, in order of first appearance. */
  contributors: string[];
  /**
   * Where it stands, as an OPAQUE canon location -- "test_kitchen", never a
   * coordinate. Same discipline as a character's home_location: the surface
   * turns a name into a spot on a ground plane, and nothing above the seam
   * learns what a coordinate is. Empty when the space has not placed it.
   *
   * This is what lets a frontend put pieces somewhere without the backend
   * having an opinion about geometry.
   */
  location: string;
  created_ts: string;
  updated_ts: string;
}

/**
 * One person changing the piece. This is an event, not a row.
 *
 * `parent_event_id` is the spine. It points at the extension being built on --
 * or at the piece's seed event for the first one. Following it back to the root
 * is the lineage, and the person who authored your parent is the person who
 * feels something when you post.
 */
export interface Extension {
  event_id: string;
  piece_id: string;
  /** The seed event, or another extension. Never null: everything builds on something. */
  parent_event_id: string;
  /** Who did it. A durable visitor id -- asserted, not authenticated. */
  fan_id: string;
  /**
   * What to call them on screen.
   *
   * Added after the UI showed the omission was backwards: the piece page --
   * the PUBLIC, shareable artefact -- could only print "wren", while the
   * private return screen got a real name. Attribution is the product, so the
   * page a stranger sees is the last place to render somebody as a database
   * key. Falls back to the id when a visitor never gave a name.
   */
  display_name: string;
  /** What they actually wrote or made. The work itself. */
  body: string;
  /**
   * ONE SENTENCE ON WHAT THIS CHANGED, written by the Mind.
   *
   * This is the product. Not "Maya extended your contribution" -- that is a
   * database row read aloud. What has to land is:
   *
   *   "Maya didn't agree with your reduction. She cut it with acid instead,
   *    and kept your base."
   *
   * Everything else in this file is storage for that sentence. If it comes back
   * bland the feature is dead, and it will fail exactly the way five days of
   * identically-worded confrontations failed: fluent, plausible, and inert.
   *
   * Absent when the host is unavailable. The extension still stands -- losing
   * the narration must never lose the work.
   */
  changed?: string;
  ts: string;
}

/** A piece plus its full lineage, oldest first. What the piece page renders. */
export interface PieceWithLineage {
  piece: Piece;
  seed_event_id: string;
  extensions: Extension[];
}

/**
 * WHO IS HERE NOW.
 *
 * Deliberately NOT in canon. Presence is transient and the log is permanent:
 * writing "ada is looking at this" into an append-only history would bloat it
 * with noise nobody will ever cite, and the whole value of that log is that
 * every row in it is worth citing. Held in memory by the server, lost on
 * restart, and that is correct.
 */
export interface Presence {
  piece_id: string;
  /** Distinct people with the piece open right now. */
  here: { fan_id: string; display_name: string; since: string }[];
}

/**
 * What a frontend needs to draw a space, in one call.
 *
 * `generation` is depth and is what a spatial frontend should scale, stack or
 * weather -- a piece twelve deep should not look like one that is one deep.
 * It is still never a score and never a ranking.
 */
export interface SpaceView {
  world: string;
  pieces: (Piece & { here: number })[];
}

/**
 * THE RETURN SCREEN, and the only query that matters.
 *
 * Extensions of things this person made, that they have not seen yet. If this
 * list is empty the product has nothing to say and should say nothing rather
 * than manufacture a reason to come back -- a fabricated "3 people are talking
 * about you" is the exact move that makes these products feel cheap.
 */
export interface WaitingForYou {
  fan_id: string;
  /** Newest first. Each is somebody building on something you made. */
  items: {
    piece_id: string;
    piece_title: string;
    /** The thing of yours they built on. */
    your_event_id: string;
    your_body: string;
    /** What they did. */
    their_event_id: string;
    their_fan_id: string;
    their_display_name: string;
    their_body: string;
    /** The Mind's sentence. The payload. */
    changed?: string;
    ts: string;
    permalink: string;
  }[];
}

// ---------------------------------------------------------------------------
// WHAT THE HOST IS ASKED, AND WHAT IT MAY ANSWER
// ---------------------------------------------------------------------------

/**
 * ROUTE -- which piece to put in front of this visitor.
 *
 * Needs judgement, which is why it is a host call and not a sort. The right
 * answer is usually not the newest or the most active piece; it is the one this
 * person can add something to, and ideally one where somebody is waiting for a
 * response. A piece with one lonely extension needs a visitor more than a
 * piece with nine.
 */
export interface RouteRequest {
  fan_id: string;
  /** What they have done here before, if anything. */
  history: { piece_id: string; body: string; ts: string }[];
  /** Open pieces, with enough to choose between them. */
  pieces: { piece_id: string; title: string; brief: string; generation: number; last_ts: string }[];
}

export interface RouteResponse {
  piece_id: string;
  /** Shown to the visitor. Why this one, in one line, addressed to them. */
  because: string;
}

/**
 * NARRATE -- what changed, in one sentence.
 *
 * The host sees only the parent and the child. Deliberately: handed the whole
 * lineage it writes a summary of the piece, and a summary is not what the
 * person waiting wants. They want to know what THIS person did to THEIR thing.
 */
export interface NarrateRequest {
  piece_title: string;
  parent_body: string;
  parent_author: string;
  child_body: string;
  child_author: string;
}

export interface NarrateResponse {
  /** <= 240 chars. Truncated, never rejected -- see `prose()` in types/canon. */
  changed: string;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Public reads are public: a piece page is the shareable artefact and a link
 * nobody can open is not an artefact. Writes and anything personal need the
 * key, and fail closed when no key is configured.
 *
 *   GET  /v1/pieces                    open pieces
 *   GET  /v1/pieces/:id                piece + lineage
 *   POST /v1/pieces/:id/extend         { fan_id, parent_event_id, body }
 *   GET  /v1/waiting?fan=              the return screen
 *   GET  /v1/route?fan=                where should I start
 *   GET  /w/<room>/p/<piece_id>        public page          (no key)
 *   GET  /w/<room>/e/<event_id>        public receipt       (no key, exists)
 */
export interface ExtendRequest {
  fan_id: string;
  parent_event_id: string;
  body: string;
  display_name?: string;
}

export interface ExtendResponse {
  event_id: string;
  piece_id: string;
  generation: number;
  changed?: string;
  permalink: string;
  /** Who is going to see this in their return screen. Honest about the audience. */
  notifies: string | null;
}

/** Bodies are work, not chat. Long enough to say something, short enough to read. */
export const BODY_MAX = 1200;
export const BODY_MIN = 8;
export const CHANGED_MAX = 240;
