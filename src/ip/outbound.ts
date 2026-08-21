import { rankSignificance } from "../canon/significance.js";
import { roleOf, fillSlate, type ContentRole } from "./roles.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CanonRepo } from "../canon/repo.js";
import { describeEvent, type WorldEvent } from "../types/events.js";
import type { ApprovalChannel } from "../approval/index.js";

/**
 * OUTBOUND: what the owner gets back.
 *
 * Two things go out over the same ApprovalChannel the gate uses -- the daily
 * showrunner's note, and clip drafts.
 *
 * WHAT THIS DELIBERATELY IS NOT: it does not post anywhere. There is no
 * platform client in this file and no credential is read. The pitch says the
 * world's best moments "become clips you post back to feeds"; the honest
 * minimum of that is selection, drafting and a tracked link, with a human
 * pressing publish. Video is not built and is not stubbed.
 */

const NOISE = new Set(["tick_skipped", "directive_rejected", "world_created", "character_minted"]);

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "world";

export interface Clip {
  event_id: string;
  ts: string;
  /** One line, ready to post. */
  headline: string;
  /** Optional second line of context, from the arc this belongs to. */
  context?: string;
  link: string;
  significance: number;
}

export interface ClipOptions {
  limit?: number;
  /** Look back this many hours of WORLD time. */
  hours?: number;
  minSignificance?: number;
  /** Base URL for the tracked link. */
  baseUrl?: string;
  /** Goes into utm_source, so the owner can tell which feed a visitor came from. */
  platform?: string;
}

function trackedLink(repo: CanonRepo, e: WorldEvent, opts: ClipOptions): string {
  const base = opts.baseUrl ?? process.env.INSPIRAL_CLIP_BASE ?? "https://inspiral.world";
  const world = slug(repo.getMeta("world_name") ?? "world");
  const q = new URLSearchParams({
    e: e.event_id,
    utm_source: opts.platform ?? "manual",
    utm_medium: "clip",
    utm_campaign: world,
  });
  return `${base.replace(/\/+$/, "")}/w/${world}?${q.toString()}`;
}

/**
 * The moments worth showing someone who is not in the world yet.
 *
 * Ranked by significance, then recency. Deduped by arc so one runaway
 * storyline cannot take every slot -- a feed of five posts about the same
 * quarrel reads as a bug.
 */
/**
 * A visitor's real choice, and specifically NOT a patrol visitor's.
 *
 * Handing an owner a clip draft about a bot is the pipeline generating fake
 * social proof, which is the worst failure available to this project. The
 * synthetic tag is checked here rather than trusted to a naming convention.
 */
function realVisitorIn(e: { actors: string[] }, repo?: CanonRepo): boolean {
  const fan = e.actors.find((a) => a.startsWith("fan:"));
  if (!fan) return false;
  if (!repo) return true;
  return !repo.isSynthetic(fan.slice(4));
}

/** The role a clip would play, with synthetic visitors barred from `community`. */
function clipRole(repo: CanonRepo, e: { type: string; actors: string[]; payload: Record<string, unknown> }): ContentRole | null {
  const r = roleOf(e as never);
  if (r === "community" && !realVisitorIn(e, repo)) return null;
  return r;
}

export function selectClips(repo: CanonRepo, opts: ClipOptions = {}): Clip[] {
  const rc = repo.rankContexts();
  const limit = opts.limit ?? 3;
  const minSig = opts.minSignificance ?? 0.5;
  const cutoff = opts.hours
    ? Date.parse(repo.now()) - opts.hours * 3_600_000
    : Number.NEGATIVE_INFINITY;

  const candidates = repo
    .recentEvents(200)
    .filter((e) => !NOISE.has(e.type))
    // Re-ranked WITH CONTEXT. Passing no context left `citedBy` at 0 and
    // `changedState` at false for every event, which is the two ungameable
    // pillars of the evidence model never firing at all.
    .filter((e) => rankSignificance(e, rc.get(e.event_id)) >= minSig)
    .filter((e) => Date.parse(e.ts) >= cutoff)
    /**
     * Ranked on EVIDENCE, with the host's own opinion demoted to a tiebreak:
     * computed significance, then whether the world has actually cited it,
     * then whether a real (non-synthetic) visitor's real choice is in it, then
     * recency, and only then `significance_hint`.
     */
    .sort((a, b) => {
      const sa = rankSignificance(a, rc.get(a.event_id));
      const sb = rankSignificance(b, rc.get(b.event_id));
      if (sb !== sa) return sb - sa;
      const ca = rc.get(a.event_id)?.citedBy ?? 0;
      const cb = rc.get(b.event_id)?.citedBy ?? 0;
      if (cb !== ca) return cb - ca;
      const ra = realVisitorIn(a) ? 1 : 0;
      const rb = realVisitorIn(b) ? 1 : 0;
      if (rb !== ra) return rb - ra;
      const ta = Date.parse(a.ts);
      const tb = Date.parse(b.ts);
      if (tb !== ta) return tb - ta;
      return b.significance_hint - a.significance_hint;
    });

  /**
   * Dedupe by arc BEFORE the quota, not after.
   *
   * Doing it afterwards meant the quota could pick a clip and the arc filter
   * could then silently drop it, so the slate came back short and -- in the
   * case the demo-beat test caught -- the beat from the owner's own feed was
   * chosen and then discarded because an earlier pick shared its storyline.
   */
  const seenArcs = new Set<string>();
  const deduped = candidates.filter((e) => {
    const arcId = typeof e.payload.arc_id === "string" ? e.payload.arc_id : null;
    if (!arcId) return true;
    if (seenArcs.has(arcId)) return false;
    seenArcs.add(arcId);
    return true;
  });

  /**
   * A PORTFOLIO, NOT A RANKING. Asking every clip to be the best clip is the
   * mistake the whole attention frame is about, so the slate is filled against
   * a role quota over the window and only then by rank.
   */
  const slate = fillSlate(deduped, (e) => clipRole(repo, e), Math.max(limit, 1));

  const out: Clip[] = [];
  for (const e of slate) {
    if (out.length >= limit) break;
    const arcId = typeof e.payload.arc_id === "string" ? e.payload.arc_id : null;

    const arc = arcId ? repo.getArc(arcId) : undefined;
    const clip: Clip = {
      event_id: e.event_id,
      ts: e.ts,
      headline: describeEvent(e),
      link: trackedLink(repo, e, opts),
      significance: rankSignificance(e, rc.get(e.event_id)),
    };
    if (arc) clip.context = arc.title;
    out.push(clip);
  }
  /**
   * SELECTION is a portfolio; PRESENTATION is still a ranking. The quota
   * decides WHICH clips the owner gets so the slate is not six variations on
   * the loudest thing that happened, but they are handed over strongest-first
   * because that is the order a person reads a list in.
   */
  out.sort((a, b) => b.significance - a.significance || Date.parse(b.ts) - Date.parse(a.ts));

  return out;
}

/** Postable text. Short, no hashtags, no emoji: the owner adds their own voice. */
export function renderClip(repo: CanonRepo, c: Clip): string {
  const world = repo.getMeta("world_name") ?? "the world";
  const lines = [c.headline];
  if (c.context) lines.push(`(${c.context})`);
  lines.push(`— ${world}, ${dayLabel(repo, c.ts)}`);
  lines.push(c.link);
  return lines.join("\n");
}

function dayLabel(repo: CanonRepo, ts: string): string {
  const start = repo.getMeta("world_start");
  if (!start) return ts.slice(0, 10);
  const day = Math.floor((Date.parse(ts) - Date.parse(start)) / 86_400_000) + 1;
  return `day ${Math.max(1, day)}`;
}

/** A drafts file the owner can copy out of. Returns the path written. */
export function writeClips(repo: CanonRepo, clips: Clip[], path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const body = [
    `# Clip drafts — ${repo.getMeta("world_name") ?? "world"}`,
    ``,
    `Nothing here has been posted. Copy, edit, publish yourself.`,
    ``,
    ...clips.flatMap((c) => [`## ${c.headline.slice(0, 70)}`, ``, "```", renderClip(repo, c), "```", ``]),
  ].join("\n");
  writeFileSync(path, body);
  return path;
}

export function defaultClipPath(repo: CanonRepo, dir = "./data/clips"): string {
  return join(dir, `${repo.now().slice(0, 10)}.md`);
}

// ---------------------------------------------------------------------------
// The daily digest
// ---------------------------------------------------------------------------

/**
 * The showrunner's note. What happened in your world since you last looked,
 * in the voice of someone who runs it rather than someone who monitors it.
 *
 * Reads canon only. Costs nothing.
 */
export function showrunnerNote(repo: CanonRepo, hours = 24): string {
  const rc = repo.rankContexts();
  const cutoff = Date.parse(repo.now()) - hours * 3_600_000;
  const events = repo.recentEvents(300).filter((e) => Date.parse(e.ts) >= cutoff);
  const world = repo.getMeta("world_name") ?? "the world";

  const L: string[] = [];
  L.push(`SHOWRUNNER'S NOTE — ${world}`);
  L.push(`the last ${hours}h of world time, to ${repo.now()}`);
  L.push("");

  if (events.length === 0) {
    L.push("Nothing happened. No tick fired and nobody came in.");
    return L.join("\n");
  }

  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  const ingested = events.filter((e) => e.source === "ingest");

  L.push("WHAT HAPPENED");
  const worth = events
    .filter((e) => !NOISE.has(e.type) && rankSignificance(e, rc.get(e.event_id)) >= 0.45)
    .sort((a, b) => rankSignificance(b, rc.get(b.event_id)) - rankSignificance(a, rc.get(a.event_id)))
    .slice(0, 6);
  if (worth.length === 0) L.push("  (a quiet window -- nothing anyone will bring up later)");
  for (const e of worth) L.push(`  [${e.event_id}] ${describeEvent(e)}`);
  L.push("");

  const arcs = repo.openArcs();
  if (arcs.length) {
    L.push("STORYLINES RUNNING");
    for (const a of arcs)
      L.push(`  ${a.title} — stage ${a.stage}, tension ${Math.round(a.tension)} (${a.participants.join(" vs ")})`);
    L.push("");
  }

  const visitors = repo.listVisitors(false);
  if (visitors.length) {
    L.push("VISITORS");
    for (const id of visitors.slice(0, 10)) {
      const v = repo.getVisitor(id);
      if (!v) continue;
      const seen = events.some((e) => e.actors.includes(`fan:${id}`));
      L.push(`  ${v.display_name || id} — ${v.interactions.length} interactions${seen ? ", here today" : ""}`);
    }
    L.push("");
  }

  if (ingested.length) {
    L.push(`FROM YOUR FEED (${ingested.length} item(s) became canon)`);
    for (const e of ingested.slice(0, 5)) L.push(`  ${describeEvent(e)}`);
    L.push("");
  }

  L.push(
    `TALLY: ${events.length} events — ` +
      [...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([t, n]) => `${t} ${n}`)
        .join(", "),
  );
  L.push(
    `COGNITION: ${repo.hostInvocationsSince(new Date(cutoff).toISOString())} host call(s) in this window.`,
  );
  return L.join("\n");
}

/** Digest + clip drafts, over whichever channel the owner configured. */
export async function sendDailyDigest(
  repo: CanonRepo,
  channel: ApprovalChannel,
  opts: ClipOptions & { hours?: number } = {},
): Promise<{ note: string; clips: Clip[] }> {
  const note = showrunnerNote(repo, opts.hours ?? 24);
  const clips = selectClips(repo, { hours: opts.hours ?? 24, ...opts });
  await channel.notify(note);
  if (clips.length) {
    await channel.notify(
      ["CLIPS WORTH POSTING (drafts — nothing has been published)", ""]
        .concat(clips.map((c) => renderClip(repo, c)).join("\n\n"))
        .join("\n"),
    );
  }
  return { note, clips };
}
