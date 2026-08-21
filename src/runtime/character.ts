import { rankSignificance } from "../canon/significance.js";
import type { CanonRepo } from "../canon/repo.js";
import type { CharacterSheet, NotableMoment, Relationship, ToneRules } from "../types/canon.js";
import type { Directive } from "../types/directive.js";
import type { WorldEvent } from "../types/events.js";
import { fanId, isFanRef } from "../directive/validate.js";

/**
 * CHARACTER RUNTIME -- STATELESS.
 *
 *   directive + character sheet + canon slice  ->  rendered behavior
 *
 * There is no per-character process, no per-character memory, no per-character
 * agent. A worker is handed everything it needs and returns lines, actions and
 * post drafts. Ten thousand visitors talking at once is a scaling problem for
 * the machine this runs on, not for the cognition budget, because none of this
 * costs a host invocation.
 *
 * This is also where the return-visit payoff is made honest. When an NPC
 * complains about what a rival did, the complaint is looked up in the event log
 * and cited by event_id. The host proposes the intent; canon supplies the fact.
 */

/** Everything a worker needs. Assembled by `sliceFor`, never fetched inside. */
export interface CanonSlice {
  sheet: CharacterSheet;
  tone: ToneRules;
  /** This character's view of everyone else. */
  outgoing: Relationship[];
  /** How everyone else sees this character. */
  incoming: Relationship[];
  /** Recent events this character was part of, newest first. */
  recent: WorldEvent[];
  /** Present only for visitor-facing directives. */
  visitor?: {
    fan_id: string;
    display_name: string;
    stance: number;
    first_seen: string;
    moments: NotableMoment[];
    /** True on the visitor's very first appearance. */
    isNew: boolean;
    /** True when they have been away long enough for absence to be notable. */
    returning: boolean;
    /** How long they were gone, in hours. 0 when not returning. */
    awayHours: number;
  };
  /** A grievance this character can cite, if one exists. */
  grievance?: { event: WorldEvent; against: string; summary: string };
}

export interface RenderedBehavior {
  character_id: string;
  /**
   * SPOKEN WORDS ONLY. Whatever goes in here is put in quotation marks and
   * shown in a speech bubble, so nothing that is not literally said may be
   * added to it. Stage direction goes in `stage`.
   */
  lines: string[];
  /**
   * What they DO, as narration -- "makes the omission obvious enough that
   * everyone counts it". This used to be pushed into `lines` and rendered as
   * dialogue, so characters stood in the plaza reciting their own stage
   * directions. Surfaces must never quote it.
   */
  stage: string;
  /** Engine-agnostic action verb + target. The surface adapter maps this. */
  action: { verb: string; target: string | null; location: string };
  /** Text for a notice board, if this action posts one. */
  post_draft?: string;
  /** Event ids this performance references. Empty means it invented nothing. */
  cites: string[];
  /**
   * How many of `lines` the host actually wrote, versus fell back to a canned
   * opener. Reported by `npm run authorship` -- if this is ever zero across a
   * run, the model is decorative and the architecture is lying.
   */
  hostLines: number;
}

/** Minimum absence before a visitor counts as having been away. */
const GAP_MS = 12 * 3_600_000;

/**
 * Actions that name the history behind them.
 *
 * This used to be a bare `||` chain inline, and it had drifted out of step with
 * GRIEVABLE below: `alliance_broken` was already something a character could
 * hold against someone, but `break_alliance` was not on the citing list, so a
 * ladder that escalated to breaking an alliance produced a beat with no
 * receipt. Kept as a named set beside GRIEVABLE, with a test asserting every
 * member maps to a grievable event type, so the two cannot drift again.
 */
export const CITING_ACTIONS = new Set<string>([
  "confront",
  "snub",
  "sabotage",
  "break_alliance",
]);

/** Event types a character can legitimately hold against someone. */
export const GRIEVABLE = new Set<string>([
  "confrontation",
  "snub",
  "sabotage",
  "notice_posted",
  "rumor_spread",
  "alliance_broken",
]);

/**
 * Find something this character can legitimately complain about.
 *
 * Constraints that make the complaint TRUE rather than plausible:
 *   - the rival must be someone this character actually dislikes (affinity < 0)
 *   - the rival must be the INITIATOR of the event, not merely present
 *   - this character must have been involved, so they could have witnessed it
 *   - the event must be in the log, and it is returned with its id attached
 *
 * `since` narrows it to "what happened while you were away", which is the
 * version a returning visitor actually wants to hear.
 *
 * Ranked by significance first, recency second: the worst thing the rival did
 * beats the most recent trivial thing.
 */
export function findGrievance(
  repo: CanonRepo,
  characterId: string,
  since?: string,
): { event: WorldEvent; against: string; summary: string } | undefined {
  const outgoing = repo
    .getRelationships()
    .filter((r) => r.from_id === characterId && r.affinity < 0)
    .sort((a, b) => a.affinity - b.affinity);
  if (outgoing.length === 0) return undefined;

  const rivals = new Map(outgoing.map((r, i) => [r.to_id, i]));
  const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;

  const candidates = repo
    .eventsInvolving(characterId, 60)
    .filter((e) => {
      if (e.actors[0] === undefined || !rivals.has(e.actors[0])) return false;
      if (!e.actors.includes(characterId)) return false;
      // Re-ranked on read (canon/significance.ts): the grievance a character
      // brings up has to be one the world agrees was significant.
      if (rankSignificance(e) < 0.4) return false;
      // You cannot complain about someone backing down. Only hostile acts.
      if (!GRIEVABLE.has(e.type)) return false;
      return Date.parse(e.ts) >= sinceMs;
    })
    .sort((a, b) => {
      const [ra, rb] = [rankSignificance(a), rankSignificance(b)];
      if (rb !== ra) return rb - ra;
      return Date.parse(b.ts) - Date.parse(a.ts);
    });

  // Nothing since the cutoff -- fall back to the whole history rather than
  // saying nothing at all.
  const best = candidates[0] ?? (since ? findGrievance(repo, characterId)?.event : undefined);
  if (!best) return undefined;

  const against = best.actors[0]!;
  const summary = typeof best.payload.summary === "string" ? best.payload.summary : best.type;
  return { event: best, against, summary };
}

/** Assemble the slice. The only function here that touches the repo. */
export function sliceFor(repo: CanonRepo, d: Directive): CanonSlice | undefined {
  const sheet = repo.getCharacter(d.actor);
  if (!sheet) return undefined;

  const rels = repo.getRelationships();
  const slice: CanonSlice = {
    sheet,
    tone: repo.getTone(),
    outgoing: rels.filter((r) => r.from_id === d.actor),
    incoming: rels.filter((r) => r.to_id === d.actor),
    recent: repo.eventsInvolving(d.actor, 12),
  };

  let since: string | undefined;
  let returning = false;

  if (d.target && isFanRef(d.target)) {
    const v = repo.getVisitor(fanId(d.target));
    if (v) {
      const nowMs = Date.parse(repo.now());

      // "While you were away" means since their previous visit -- not since
      // the arrival that is happening right now. A gap of at least half a day
      // counts as having been away.
      const prior = v.interactions
        .map((i) => Date.parse(i.ts))
        .filter((t) => nowMs - t > GAP_MS)
        .sort((a, b) => b - a)[0];

      const awayHours = prior === undefined ? 0 : (nowMs - prior) / 3_600_000;
      returning = prior !== undefined;
      if (prior !== undefined) since = new Date(prior).toISOString();

      // Deltas are applied before rendering, so a moment written by THIS very
      // directive is already in canon. Exclude it: a character must not
      // reminisce about the sentence they are currently saying.
      const moments = repo
        .recallMoments(v.fan_id, d.actor, 8)
        .filter((m) => Date.parse(m.ts) < nowMs)
        .slice(0, 3);

      slice.visitor = {
        fan_id: v.fan_id,
        display_name: v.display_name,
        stance: v.stance[d.actor] ?? 0,
        first_seen: v.first_seen,
        moments,
        // New = nobody here has any memory of them yet.
        isNew: moments.length === 0 && !returning,
        returning,
        awayHours: Math.round(awayHours),
      };
    }
  }

  // A grievance is only aired at someone who has been away. Nobody recaps the
  // week to a person who was standing right there for it.
  if (!slice.visitor || returning) {
    const g = findGrievance(repo, d.actor, since);
    if (g) slice.grievance = g;
  }

  return slice;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

function capWords(s: string, max: number): string {
  const w = s.split(/\s+/);
  if (w.length <= max) return s;
  return w.slice(0, max).join(" ").replace(/[,;:]$/, "") + ".";
}

/** Tone rules are enforced here, not requested politely of the host. */
function toneCheck(line: string, tone: ToneRules, sheet: CharacterSheet): string {
  let out = line;
  for (const banned of tone.banned_phrases) {
    const re = new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, "");
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  const max = Math.min(tone.max_line_words, sheet.voice.max_words);
  return capWords(out, max);
}

/**
 * Canon summaries are written in the third person, because canon does not know
 * who will read them out. A character quoting a summary about themselves has to
 * shift it into first person or they sound like they are reading a report.
 */
function deThirdPerson(text: string, name: string): string {
  if (!name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${esc}'s\\b`, "g"), "my")
    .replace(new RegExp(`^${esc}\\b`), "I")
    .replace(new RegExp(`\\b${esc}\\b`, "g"), "me");
}

/**
 * Said TO the person it is about, so they are "you", not "they".
 *
 * A visitor's notable moment is recorded in the third person -- "They took my
 * side in public" -- because canon does not know who will read it later. Spoken
 * to that visitor's face it has to become second person, or the character is
 * talking about them as if they were not standing there. This shipped in the
 * money-shot screenshot.
 *
 * Only applied where the addressee IS the subject, so the plural pronouns are
 * unambiguously them.
 */
function toSecondPerson(text: string, visitorName: string): string {
  let out = text;
  if (visitorName) {
    const esc = visitorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}'s\\b`, "g"), "your");
    out = out.replace(new RegExp(`\\b${esc}\\b`, "g"), "you");
  }
  return out
    .replace(/^They\b/, "You")
    .replace(/\bthey\b/g, "you")
    .replace(/\bThey\b/g, "You")
    .replace(/\bthem\b/g, "you")
    .replace(/\btheir\b/g, "your")
    .replace(/\bthemselves\b/g, "yourself")
    // "you took" not "you takes": the verb has to follow the pronoun.
    .replace(/\byou was\b/g, "you were");
}

/** Per-character diction. Deliberately rule-based: it costs nothing to run. */
function inVoice(sheet: CharacterSheet, text: string): string {
  switch (sheet.character_id) {
    case "vance":
      return text.replace(/\bI think\b/g, "The account shows").replace(/!+/g, ".");
    case "okonkwo":
      return text;
    case "quill":
      return text.replace(/\.$/, ".");
    default:
      return text;
  }
}

/**
 * Relative time, the way a person would say it. Absolute day numbers read like
 * a changelog; "three days ago" reads like someone who was there.
 */
function agoPhrase(repo: CanonRepo, ts: string): string {
  const deltaMs = Date.parse(repo.now()) - Date.parse(ts);
  const hours = deltaMs / 3_600_000;
  if (hours < 12) return "earlier today";
  if (hours < 36) return "yesterday";
  const days = Math.round(hours / 24);
  return days === 1 ? "a day ago" : `${days} days ago`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const OPENERS: Record<string, (name: string) => string> = {
  confront: (n) => `${n}.`,
  post_notice: () => `Read it yourself.`,
  snub: () => ``,
  offer_tribute: (n) => `${n}. Take it, don't thank me.`,
  offer_alliance: (n) => `${n}. An arrangement, then.`,
  accept_alliance: (n) => `${n}. Agreed, and I'll hold you to it.`,
  break_alliance: (n) => `${n}. We're finished.`,
  sabotage: () => ``,
  concede: (n) => `${n}. You've made your point.`,
  spread_rumor: () => `You didn't hear it from me.`,
  greet_visitor: () => ``,
  recruit_visitor: () => ``,
  hold: () => ``,
};

/**
 * Render a directive into behavior. Pure: same inputs, same output.
 * `repo` is used only for day-numbering and is not mutated.
 */
export function renderBehavior(
  repo: CanonRepo,
  d: Directive,
  slice: CanonSlice,
): RenderedBehavior {
  const { sheet, tone } = slice;
  const cites: string[] = [];
  /** Narration collected on the way through. Never quoted. */
  const stageParts: string[] = [];
  /**
   * What the host actually wrote. This is the default source of dialogue; the
   * hardcoded openers below exist for when it is empty.
   */
  const hostSpeech = (d.speech ?? []).map((l) => l.trim()).filter(Boolean);
  const lines: string[] = [];

  const targetName = d.target
    ? isFanRef(d.target)
      ? slice.visitor?.display_name || "you"
      : (repo.getCharacter(d.target)?.name ?? d.target)
    : "";

  // --- visitor-facing: the return-visit payoff ---------------------------
  if (slice.visitor && (d.action === "greet_visitor" || d.action === "recruit_visitor")) {
    const v = slice.visitor;
    const ally = v.stance >= 20;
    const hostile = v.stance <= -20;

    // THE HOST WRITES THE GREETING. These canned lines are what a viewer sees
    // only when there is no host, or it returned nothing usable.
    if (hostSpeech.length) {
      lines.push(...hostSpeech);
    } else if (v.isNew) {
      lines.push(`You're new. Everyone here is something to someone.`);
    } else if (ally && v.returning) {
      lines.push(`${targetName}. Good. I was hoping it would be you.`);
    } else if (ally) {
      lines.push(`${targetName}. You picked a side in front of witnesses. I don't forget that.`);
    } else if (hostile && v.returning) {
      lines.push(`You. I know exactly whose side you're on.`);
    } else if (hostile) {
      lines.push(`I saw where you stood. Don't expect anything from me.`);
    } else {
      lines.push(`You've been here before.`);
    }

    // Recall a specific moment this character actually witnessed. Only worth
    // saying to someone who has been away.
    const moment = v.moments[0];
    if (moment && v.returning && (ally || hostile)) {
      // Framing is the host's job when it wrote the greeting; canon only
      // guarantees the fact and the id underneath it.
      const fact = toSecondPerson(deThirdPerson(moment.summary, sheet.name), targetName);
      lines.push(hostSpeech.length ? fact : `I haven't forgotten. ${agoPhrase(repo, moment.ts)}: ${fact}`);
      cites.push(moment.event_id);
    }

    // THE DEMO BEAT. An ally who has been away gets told, accurately, what the
    // rival did while they were gone -- pulled from the log, cited by id.
    if (ally && v.returning && slice.grievance) {
      const g = slice.grievance;
      const rivalName = repo.getCharacter(g.against)?.name ?? g.against;
      const awayDays = Math.round(v.awayHours / 24);
      const away =
        v.awayHours < 24 ? "a while" : awayDays === 1 ? "a day" : `${awayDays} days`;
      // Same split: the host may already have said the "you have been gone"
      // part in its own words. What canon insists on is the quoted fact.
      if (!hostSpeech.length) {
        lines.push(`You've been gone ${away}. ${rivalName} did not stop.`);
      }
      lines.push(`${agoPhrase(repo, g.event.ts)}: ${deThirdPerson(g.summary, sheet.name)}`);
      if (!hostSpeech.length) lines.push(`Ask anyone. It's on the record.`);
      cites.push(g.event.event_id);
    }
  } else {
    // --- character-to-character -----------------------------------------
    if (hostSpeech.length) {
      lines.push(...hostSpeech);
    } else {
      const opener = (OPENERS[d.action] ?? OPENERS.hold!)(targetName);
      if (opener) lines.push(opener);
    }
    // d.dialogue_intent is what they DO, not what they SAY. It goes to `stage`.

    // If this escalates against someone they already have history with, the
    // history gets named. Grudges that are never referenced aren't grudges.
    if (
      CITING_ACTIONS.has(d.action) &&
      d.target &&
      !isFanRef(d.target)
    ) {
      const rel = slice.outgoing.find((r) => r.to_id === d.target);
      // The note stays SPEECH: this is the character raising the matter, and
      // when the note came from an ingested post, quoting it verbatim is the
      // whole point of the post-reaction beat. Only `dialogue_intent` -- which
      // describes the action rather than any utterance -- is narration.
      if (rel?.note) lines.push(rel.note);
      if (rel?.last_event_id) cites.push(rel.last_event_id);
    }
  }

  const rendered = lines
    .filter((l) => l.trim() !== "")
    .map((l) => toneCheck(inVoice(sheet, l), tone, sheet));

  const behavior: RenderedBehavior = {
    character_id: sheet.character_id,
    lines: rendered,
    hostLines: hostSpeech.length,
    stage: [d.dialogue_intent, ...stageParts].filter((t) => t && t.trim()).join(" "),
    action: {
      verb: d.action,
      target: d.target,
      location: sheet.home_location,
    },
    cites,
  };

  if (d.action === "post_notice") {
    behavior.post_draft = toneCheck(
      `NOTICE. ${d.dialogue_intent} -- ${sheet.name}, ${sheet.title}.`,
      tone,
      { ...sheet, voice: { ...sheet.voice, max_words: 40 } },
    );
  }

  return behavior;
}

/** Convenience: slice + render in one call. Returns undefined for unknown actors. */
export function performDirective(repo: CanonRepo, d: Directive): RenderedBehavior | undefined {
  const slice = sliceFor(repo, d);
  if (!slice) return undefined;
  return renderBehavior(repo, d, slice);
}
