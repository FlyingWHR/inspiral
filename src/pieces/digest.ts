/**
 * WHAT THE CREATOR READS INSTEAD OF EVERYTHING.
 *
 * A creator who has to read every contribution stops reading, and a creator who
 * stops reading is the failure mode that kills a piece -- not abuse, not spam.
 * So this is a triage list, ordered by what only the creator can fix.
 *
 * The item that matters is UNANSWERED CONTRIBUTIONS. Somebody made something,
 * put their name on it, and nothing happened. That person is the one most
 * likely to leave, the creator is the one who can stop it, and one extension
 * from them costs a minute. Everything else here is context for that list.
 *
 * ---------------------------------------------------------------------------
 * EVERY NUMBER COMES FROM THE LOG
 * ---------------------------------------------------------------------------
 *
 * Nothing is estimated, sampled or projected, and the Mind is never the source
 * of a count. It is handed the facts and asked to say them in a sentence; if it
 * is down, the facts stand alone and the digest is worth just as much minus a
 * paragraph. Same discipline as `narrateChange`: degrade to less, never to
 * something invented.
 *
 * And when nothing happened, it says nothing happened. The host is not even
 * asked -- an empty window is the one input from which a model will reliably
 * manufacture activity, so the guard is structural rather than a line in a
 * prompt telling it not to.
 */

import type { CanonRepo } from "../canon/repo.js";
import type { HostRuntime } from "../host/HostRuntime.js";
import { log } from "../log.js";
import type { Extension, Piece } from "./contract.js";
import { withoutHidden } from "./moderation.js";
import { lineage, listPieces } from "./repo.js";

const HOUR_MS = 3_600_000;

/** Hours, to one decimal. Whole hours lose everything that happened this morning. */
const hoursBetween = (fromIso: string, toIso: string): number =>
  Math.round(((Date.parse(toIso) - Date.parse(fromIso)) / HOUR_MS) * 10) / 10;

/** A piece that moved, and by how much. */
export interface MovedPiece {
  piece_id: string;
  title: string;
  /** Extensions inside the window. Counted, never estimated. */
  extensions: number;
  /** Distinct people who extended it inside the window. */
  contributors: string[];
  generation: number;
}

/** Somebody's first contribution, ever, landed in this window. */
export interface Newcomer {
  fan_id: string;
  display_name: string;
  piece_id: string;
  piece_title: string;
  event_id: string;
  body: string;
  ts: string;
}

/** A contribution nobody has built on. The actionable item. */
export interface Unanswered {
  event_id: string;
  piece_id: string;
  piece_title: string;
  fan_id: string;
  display_name: string;
  body: string;
  ts: string;
  /** How long they have been waiting. The reason this list is sorted. */
  waiting_hours: number;
}

/** An open piece nothing has happened to. */
export interface QuietPiece {
  piece_id: string;
  title: string;
  /** Last extension, or the moment it was seeded if it never had one. */
  last_ts: string;
  silent_hours: number;
  /** True when nobody has ever extended it. A different problem to going cold. */
  never_touched: boolean;
}

export interface CreatorDigest {
  hours: number;
  since: string;
  until: string;
  /**
   * No extensions in the window, no newcomers, nothing waiting on an answer.
   * The digest says so and stops. It does not go looking for something to
   * report and it does not ask the host for a paragraph about an empty log.
   */
  nothing_happened: boolean;
  moved: MovedPiece[];
  newcomers: Newcomer[];
  /**
   * NOT window-scoped, deliberately.
   *
   * Scoping this to the last 24 hours means a contribution that has been
   * ignored for three days silently drops off the list on the day it is most
   * urgent -- the digest would quietly forget the exact person it exists to
   * save. Oldest first: longest ignored is most likely to leave.
   */
  unanswered: Unanswered[];
  quiet: QuietPiece[];
  totals: {
    /** Extensions in the window. */
    extensions: number;
    /** Distinct people who extended anything in the window. */
    contributors: number;
    pieces_touched: number;
  };
  /** The Mind's paragraph. Absent when the host is unavailable, and that is fine. */
  summary?: string;
}

export interface DigestOptions {
  hours?: number;
  /** Longest lists a person will actually read. */
  maxUnanswered?: number;
  maxQuiet?: number;
}

/**
 * A piece plus the contributions still visible on it.
 *
 * Hidden work is dropped here rather than at render time, so a creator who has
 * just taken something down is never told to go and reply to it.
 */
function visibleExtensions(repo: CanonRepo, p: Piece): Extension[] {
  const l = lineage(repo, p.piece_id);
  return l ? withoutHidden(repo, l).extensions : [];
}

export async function creatorDigest(
  repo: CanonRepo,
  host: HostRuntime | undefined,
  opts: DigestOptions = {},
): Promise<CreatorDigest> {
  const hours = opts.hours ?? 24;
  const until = repo.now();
  const since = new Date(Date.parse(until) - hours * HOUR_MS).toISOString();

  /**
   * One pass over every piece, open and closed. Closed pieces are read for the
   * newcomer check only -- somebody's first contribution may well have been to
   * a piece that has since finished, and calling them a newcomer twice would be
   * a fabricated fact in a digest that is not allowed any.
   *
   * ponytail: O(pieces) lineage reads, each capped at 500 events by `lineage`.
   * Fine for a room; the upgrade is one grouped query over `piece_extended`.
   */
  const all = listPieces(repo, "all").map((piece) => ({
    piece,
    extensions: visibleExtensions(repo, piece),
  }));

  const inWindow = (x: Extension): boolean => x.ts >= since;

  // --- what moved -----------------------------------------------------------
  const moved: MovedPiece[] = [];
  for (const { piece, extensions } of all) {
    const recent = extensions.filter(inWindow);
    if (recent.length === 0) continue;
    moved.push({
      piece_id: piece.piece_id,
      title: piece.title,
      extensions: recent.length,
      contributors: [...new Set(recent.map((x) => x.fan_id))],
      generation: piece.generation,
    });
  }
  moved.sort((a, b) => b.extensions - a.extensions || a.title.localeCompare(b.title));

  // --- who is new -----------------------------------------------------------
  /** Everybody's earliest surviving contribution, across every piece. */
  const first = new Map<string, { x: Extension; piece: Piece }>();
  for (const { piece, extensions } of all) {
    for (const x of extensions) {
      const held = first.get(x.fan_id);
      if (!held || x.ts < held.x.ts) first.set(x.fan_id, { x, piece });
    }
  }
  const newcomers: Newcomer[] = [...first.values()]
    .filter(({ x }) => inWindow(x))
    .map(({ x, piece }) => ({
      fan_id: x.fan_id,
      display_name: x.display_name,
      piece_id: piece.piece_id,
      piece_title: piece.title,
      event_id: x.event_id,
      body: x.body,
      ts: x.ts,
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts));

  // --- nobody built on this -------------------------------------------------
  /**
   * A contribution is answered when something names it as a parent. Only OPEN
   * pieces count: on a closed piece there is nothing the creator could ask
   * anyone to do about it, and an action list with unactionable items on it
   * stops being read.
   */
  const unanswered: Unanswered[] = [];
  for (const { piece, extensions } of all) {
    if (piece.status !== "open") continue;
    const answered = new Set(extensions.map((x) => x.parent_event_id));
    for (const x of extensions) {
      if (answered.has(x.event_id)) continue;
      unanswered.push({
        event_id: x.event_id,
        piece_id: piece.piece_id,
        piece_title: piece.title,
        fan_id: x.fan_id,
        display_name: x.display_name,
        body: x.body,
        ts: x.ts,
        waiting_hours: hoursBetween(x.ts, until),
      });
    }
  }
  unanswered.sort((a, b) => a.ts.localeCompare(b.ts));
  const unansweredTop = unanswered.slice(0, opts.maxUnanswered ?? 10);

  // --- what has gone quiet --------------------------------------------------
  const quiet: QuietPiece[] = [];
  for (const { piece, extensions } of all) {
    if (piece.status !== "open") continue;
    const last = extensions.length ? extensions[extensions.length - 1]!.ts : piece.created_ts;
    if (last >= since) continue;
    quiet.push({
      piece_id: piece.piece_id,
      title: piece.title,
      last_ts: last,
      silent_hours: hoursBetween(last, until),
      never_touched: extensions.length === 0,
    });
  }
  quiet.sort((a, b) => b.silent_hours - a.silent_hours);

  const windowExtensions = moved.reduce((n, m) => n + m.extensions, 0);
  const digest: CreatorDigest = {
    hours,
    since,
    until,
    nothing_happened:
      windowExtensions === 0 && newcomers.length === 0 && unansweredTop.length === 0,
    moved,
    newcomers,
    unanswered: unansweredTop,
    quiet: quiet.slice(0, opts.maxQuiet ?? 5),
    totals: {
      extensions: windowExtensions,
      contributors: new Set(moved.flatMap((m) => m.contributors)).size,
      pieces_touched: moved.length,
    },
  };

  const summary = digest.nothing_happened ? undefined : await digestSummary(host, digest);
  if (summary) digest.summary = summary;
  return digest;
}

// ---------------------------------------------------------------------------
// THE PARAGRAPH
// ---------------------------------------------------------------------------

/**
 * The host is handed the facts and nothing else -- no log, no bodies beyond a
 * clause, no invitation to characterise a person. It is being asked to compress
 * a list a creator would otherwise skim, which is the one thing here it is
 * actually better at than a `for` loop.
 */
function summaryPrompt(d: CreatorDigest): string {
  const movedLines = d.moved.length
    ? d.moved.map((m) => `- "${m.title}": ${m.extensions} contribution(s) from ${m.contributors.length} person/people`).join("\n")
    : "- (nothing moved)";
  const newLines = d.newcomers.length
    ? d.newcomers.map((n) => `- ${n.display_name}, first ever contribution, on "${n.piece_title}"`).join("\n")
    : "- (nobody new)";
  const waitingLines = d.unanswered.length
    ? d.unanswered
        .map((u) => `- ${u.display_name} on "${u.piece_title}", waiting ${u.waiting_hours}h: "${u.body.slice(0, 120)}"`)
        .join("\n")
    : "- (nothing is waiting)";
  const quietLines = d.quiet.length
    ? d.quiet.map((q) => `- "${q.title}", silent ${q.silent_hours}h${q.never_touched ? ", never touched" : ""}`).join("\n")
    : "- (nothing has gone quiet)";

  return `You are writing the opening paragraph of a digest for the person who runs this place.
These are ALL the facts. There are no others.

WINDOW: the last ${d.hours} hours.

PIECES THAT MOVED
${movedLines}

FIRST-TIME CONTRIBUTORS
${newLines}

CONTRIBUTIONS NOBODY HAS BUILT ON
${waitingLines}

GONE QUIET
${quietLines}

Write at most three sentences.

RULES
- Use ONLY the facts above. Never invent a person, a piece, a number or an event.
- Lead with whoever has been waiting longest for somebody to build on their work.
- Name people and pieces. No "several contributors", no "engagement", no metrics talk.
- Never praise, never encourage, never congratulate. Report what is true.
- No greeting, no sign-off, no bullet points, no headings.

Return ONLY the paragraph.`;
}

/**
 * A paragraph, or nothing.
 *
 * Never throws and never invents. A dead, slow, over-budget or chatty host
 * costs the creator a paragraph, not the digest -- every count above was
 * already computed from the log before this was called.
 */
async function digestSummary(
  host: HostRuntime | undefined,
  d: CreatorDigest,
): Promise<string | undefined> {
  if (!host) return undefined;
  try {
    /**
     * Asked on the `narrate` lane, which is not quite right and is the closest
     * thing that exists. A lane carries its own history and `narrate` is full of
     * one-sentence, second-person change reports, so this prompt has to state
     * its own shape loudly. The proper fix is a `digest` kind in `HostCallKind`;
     * that file is the sovereignty seam and belongs to a different pass.
     */
    const res = await host.ask({ kind: "narrate", prompt: summaryPrompt(d) });
    if (!res.ok) {
      log.warn(`digest summary unavailable (${res.reason}); the counts stand without it`);
      return undefined;
    }
    return unwrap(res.text) || undefined;
  } catch (e) {
    log.warn(`digest summary threw, absorbed: ${(e as Error).message}`);
    return undefined;
  }
}

/** How much prose is a paragraph. Past this it is a report nobody reads. */
const SUMMARY_MAX = 600;

/**
 * Strip the packaging models put around an answer.
 *
 * Not `clean()` from `host.ts`, which is private there and -- more to the point
 * -- keeps only the FIRST SENTENCE, because a `changed` line is one sentence by
 * contract. Reusing it here would silently throw away two thirds of every
 * summary. Same lessons, different shape.
 */
function unwrap(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  t = t.replace(/^["'“]|["'”]$/g, "").trim();
  // A host that answered the wrong question. Structured output shown to a
  // reader as "what happened in your world" is worse than silence.
  if (/^[[{]/.test(t) || /"(actor|action|directives|dialogue_intent)"\s*:/.test(t)) return "";
  return t.slice(0, SUMMARY_MAX).trim();
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

/**
 * The text form. Same pair as `selectClips`/`renderClip`: the caller that wants
 * JSON takes the object, the caller that wants to read it takes this.
 */
export function renderDigest(d: CreatorDigest): string {
  const L: string[] = [];
  L.push(`YOUR PIECES — the last ${d.hours}h, to ${d.until}`);
  L.push("");

  if (d.summary) {
    L.push(d.summary);
    L.push("");
  }

  if (d.nothing_happened) {
    // The whole product refuses to manufacture a reason to come back. A digest
    // is the easiest place in it to break that rule, so it is stated plainly.
    L.push("Nothing happened. Nobody contributed and nobody is waiting on you.");
  } else {
    if (d.unanswered.length) {
      L.push(`NOBODY HAS BUILT ON THESE (${d.unanswered.length}) — this is the one to fix`);
      for (const u of d.unanswered) {
        L.push(`  ${u.display_name} on "${u.piece_title}", ${u.waiting_hours}h ago [${u.event_id}]`);
        L.push(`    "${u.body.slice(0, 140)}"`);
      }
      L.push("");
    }

    if (d.moved.length) {
      L.push("WHAT MOVED");
      for (const m of d.moved) {
        L.push(`  "${m.title}" — ${m.extensions} contribution(s) from ${m.contributors.join(", ")}`);
      }
      L.push("");
    }

    if (d.newcomers.length) {
      L.push("FIRST TIME HERE");
      for (const n of d.newcomers) L.push(`  ${n.display_name} — on "${n.piece_title}" [${n.event_id}]`);
      L.push("");
    }
  }

  if (d.quiet.length) {
    L.push("GONE QUIET");
    for (const q of d.quiet) {
      L.push(`  "${q.title}" — ${q.silent_hours}h${q.never_touched ? ", nobody has ever touched it" : ""}`);
    }
    L.push("");
  }

  L.push(
    `TALLY: ${d.totals.extensions} contribution(s) from ${d.totals.contributors} person/people ` +
      `across ${d.totals.pieces_touched} piece(s).`,
  );
  return L.join("\n");
}
