/**
 * THE MIND'S STANDING ROLE IN A WORLD.
 *
 * Not a content processor that wakes when called. A post somebody holds: the
 * maître d' in a kitchen, the curator in a library, the chancellor's aide in a
 * trading bloc. Same mechanism, and the world names it.
 *
 * Four jobs, and only the fourth is new:
 *
 *   greet    who is this, have they been here before   (routeVisitor)
 *   route    where would their contribution land       (routeVisitor)
 *   narrate  what did this person change about that one (narrateChange)
 *   TELL     is any of this worth the creator's attention   <- here
 *
 * ---------------------------------------------------------------------------
 * THE JOB IS MOSTLY TO SAY NOTHING
 * ---------------------------------------------------------------------------
 *
 * A steward that reports every night is a cron job with a personality, and a
 * creator learns to ignore it inside a week. The value is entirely in the
 * filtering: it earns the right to interrupt by almost never doing it.
 *
 * So the Mind is asked a question with "nothing" as a first-class answer, and
 * the prompt says so. Everything below assumes silence is the normal outcome:
 * a round that reports nothing is a round that worked.
 *
 * It never invents. Every candidate handed to the Mind is a real row already
 * in canon -- it chooses among facts and writes one line about the one it
 * picked. It cannot introduce an event that did not happen, because it is
 * never asked for one.
 */

import type { CanonRepo } from "../canon/repo.js";
import type { HostRuntime } from "../host/HostRuntime.js";
import type { NotifyChannel } from "../notify/contract.js";
import { preferencesFor } from "../notify/dispatch.js";
import { creatorDigest } from "./digest.js";
import { extractJson } from "../directive/validate.js";
import { log } from "../log.js";

/** Who the Mind is here. The world names its own post. */
export interface Steward {
  name: string;
  role: string;
}

const DEFAULT_STEWARD: Steward = { name: "The Host", role: "host" };

export function stewardOf(repo: CanonRepo): Steward {
  return {
    name: repo.getMeta("steward_name") ?? DEFAULT_STEWARD.name,
    role: repo.getMeta("steward_role") ?? DEFAULT_STEWARD.role,
  };
}

export function setSteward(repo: CanonRepo, s: Steward): void {
  repo.setMeta("steward_name", s.name.slice(0, 60));
  repo.setMeta("steward_role", s.role.slice(0, 60));
}

/** Which fan id is the creator, and therefore who gets told. */
export const creatorOf = (repo: CanonRepo): string | null => repo.getMeta("creator_fan_id") ?? null;
export const setCreator = (repo: CanonRepo, fanId: string): void =>
  repo.setMeta("creator_fan_id", fanId);

export interface StewardReport {
  /** Null is the normal answer and the one to design for. */
  say: string | null;
  /** The event it is about, so the creator can open the thing itself. */
  about: string | null;
  /** Why nothing was said. Operational, not shown to anybody. */
  because: string;
}

const SAID_KEY = "steward_last_said_ts";
const SAID_ABOUT = "steward_last_about";

/**
 * One round. Read the world, decide whether to interrupt, and if so, say one
 * thing.
 *
 * `quietHours` is a floor on how often the creator can be spoken to at all,
 * checked before the Mind is asked -- so a busy world costs one invocation a
 * day rather than one per round.
 */
export async function stewardRound(
  repo: CanonRepo,
  host: HostRuntime | undefined,
  channels: NotifyChannel[],
  opts: { hours?: number; quietHours?: number; now?: () => number } = {},
): Promise<StewardReport> {
  const now = opts.now ?? (() => Date.now());
  const quietH = opts.quietHours ?? 20;
  const creator = creatorOf(repo);
  if (!creator) return { say: null, about: null, because: "no creator on this world" };

  const last = repo.getMeta(SAID_KEY);
  if (last && now() - Date.parse(last) < quietH * 3_600_000) {
    return { say: null, about: null, because: "spoke recently" };
  }

  const digest = await creatorDigest(repo, undefined, { hours: opts.hours ?? 24 });
  if (digest.nothing_happened) {
    return { say: null, about: null, because: "nothing happened" };
  }

  /**
   * The candidates are facts, not prose. The Mind picks one and writes a line
   * about it; it is never handed an empty set and asked to find something,
   * which is the request that makes a model invent.
   */
  const candidates = [
    ...digest.unanswered.slice(0, 5).map((u) => ({
      kind: "unanswered",
      event_id: u.event_id,
      who: u.display_name || u.fan_id,
      piece: u.piece_title,
      hours: u.waiting_hours,
      body: u.body,
    })),
    ...digest.newcomers.slice(0, 3).map((n) => ({
      kind: "newcomer",
      event_id: n.event_id,
      who: n.display_name || n.fan_id,
      piece: n.piece_title,
      hours: 0,
      body: n.body,
    })),
  ];
  if (candidates.length === 0) {
    return { say: null, about: null, because: "nothing worth an interruption" };
  }

  const steward = stewardOf(repo);
  const report = await ask(host, steward, repo.getMeta("world_name") ?? "the world", candidates);
  if (!report || !report.say) {
    return { say: null, about: null, because: report ? "host said nothing" : "host unavailable" };
  }

  const pref = preferencesFor(repo, creator).find((p) => p.enabled);
  if (!pref) return { say: report.say, about: report.about, because: "creator has no address" };
  const channel = channels.find((c) => c.name === pref.channel);
  if (!channel) return { say: report.say, about: report.about, because: "no such channel" };

  try {
    await channel.send({
      fan_id: creator,
      address: pref.address,
      headline: `${steward.name}: one thing`,
      body: report.say,
      url: "",
      ids: [],
    });
    repo.setMeta(SAID_KEY, new Date(now()).toISOString());
    if (report.about) repo.setMeta(SAID_ABOUT, report.about);
    return { ...report, because: "sent" };
  } catch (e) {
    log.warn(`steward could not reach the creator: ${(e as Error).message}`);
    return { ...report, because: "delivery failed" };
  }
}

async function ask(
  host: HostRuntime | undefined,
  steward: Steward,
  world: string,
  candidates: { kind: string; event_id: string; who: string; piece: string; hours: number; body: string }[],
): Promise<{ say: string | null; about: string | null } | null> {
  if (!host) return null;

  const list = candidates
    .map(
      (c) =>
        `- [${c.event_id}] ${c.kind}: ${c.who} on "${c.piece}"` +
        (c.hours ? `, waiting ${Math.round(c.hours)}h` : "") +
        `\n  "${c.body.slice(0, 200)}"`,
    )
    .join("\n");

  const prompt = `You are the ${steward.role} of ${world}. You watch the place and you
decide, rarely, that something is worth the owner's attention.

Things that happened:
${list}

Is any of it worth interrupting them for?

MOSTLY THE ANSWER IS NO. You are not a daily report. An owner who hears from
you every day stops reading you, and then the one message that mattered is
missed too. Say something only if this would genuinely change what they do
today -- somebody good being ignored, a first contribution that deserves an
answer, an argument that needs them.

If you say something: one sentence, plain, naming the person and the piece.
No greeting, no summary of the day, no encouragement, no "just checking in".

Return ONE JSON object and nothing else:
{"say": "<one sentence, or null>", "about": "<the [event_id] it is about, or null>"}`;

  try {
    const res = await host.ask({ kind: "qc", prompt });
    if (!res.ok) return null;
    const json = extractJson(res.text);
    if (!json) return null;
    const p = JSON.parse(json) as { say?: unknown; about?: unknown };
    const say = typeof p.say === "string" && p.say.trim() ? p.say.trim().slice(0, 400) : null;
    const aboutRaw = typeof p.about === "string" ? p.about.trim() : "";
    // Referential, as everywhere: it may only point at an event it was shown.
    const about = candidates.some((c) => c.event_id === aboutRaw) ? aboutRaw : null;
    return { say, about };
  } catch (e) {
    log.warn(`steward round threw, absorbed: ${(e as Error).message}`);
    return null;
  }
}
