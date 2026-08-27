import type { CanonRepo } from "./repo.js";
import type { Arc, CharacterSheet, Relationship } from "../types/canon.js";
import { describeEvent, type WorldEvent } from "../types/events.js";

/**
 * The digest is the host's entire view of the world.
 *
 * It is deliberately small. The host is a stateless opinion generator handed a
 * briefing, not a process that accumulates context -- which is also why one
 * Mind can project three characters: it never has to hold three heads at once,
 * it just answers "what happens next in this district" from a fresh briefing
 * each time.
 *
 * Everything here is derived from canon. The host never reads the database.
 */

export interface DigestCharacter {
  id: string;
  name: string;
  faction: string;
  title: string;
  mood: string;
  goals: string[];
  taboos: string[];
}

export interface DigestRelationship {
  from: string;
  to: string;
  affinity: number;
  trust: number;
  tension: number;
  note: string;
}

export interface DigestVisitor {
  fan_id: string;
  display_name: string;
  first_seen: string;
  visits: number;
  stance: Record<string, number>;
  notable_moments: { event_id: string; ts: string; summary: string; witnesses: string[] }[];
}

export interface TickDigest {
  world: string;
  tick_no: number;
  now: string;
  since_seq: number;
  characters: DigestCharacter[];
  relationships: DigestRelationship[];
  open_arcs: Arc[];
  new_events: { event_id: string; ts: string; type: string; actors: string[]; summary: string }[];
  visitors: DigestVisitor[];
  tone: { register: string; banned_phrases: string[]; max_line_words: number };
  budget: { used_24h: number; limit: number };
}

const MAX_NEW_EVENTS = 25;

function toDigestCharacter(c: CharacterSheet): DigestCharacter {
  return {
    id: c.character_id,
    name: c.name,
    faction: c.faction,
    title: c.title,
    mood: c.mood,
    goals: c.goals,
    taboos: c.taboos,
  };
}

function toDigestRelationship(r: Relationship): DigestRelationship {
  return {
    from: r.from_id,
    to: r.to_id,
    affinity: Math.round(r.affinity),
    trust: Math.round(r.trust),
    tension: Math.round(r.tension),
    note: r.note,
  };
}

/**
 * Compile the briefing for the next tick.
 * `sinceSeq` is the log position the last tick consumed up to.
 */
/**
 * ONLY THE EDGES IN PLAY.
 *
 * The relationship mesh is O(n^2): 3 characters carry 6 edges, 16 carry 240,
 * and at the bible's cap of 24 it is 552. Shipping all of them made prompt size
 * grow FASTER than the cast -- `npm run scale` measured a 5.3x cast costing
 * 7.38x the bytes -- which is the one part of the cost story that was not flat
 * and the real ceiling on how large an IP this can hold.
 *
 * A tick does not need the whole mesh. It needs the edges between people who
 * are actually doing something: participants in an open arc, anyone who turned
 * up in the recent log, and anyone a present visitor has a stance towards.
 * Everything else is a number the host reads and cannot act on.
 *
 * Two guards, both deliberate. If nothing is in play -- a world seeded seconds
 * ago with no arcs and no history -- fall back to the whole mesh rather than
 * hand the host an empty relationship picture, which is worse than a large one.
 * And cap the result, highest tension first, so a pathological world cannot
 * blow the context regardless.
 */
const MAX_DIGEST_EDGES = 60;

function relationshipsInPlay(
  repo: CanonRepo,
  events: WorldEvent[],
  visitorIds: string[],
): Relationship[] {
  const all = repo.getRelationships();

  const inPlay = new Set<string>();
  for (const a of repo.openArcs()) for (const p of a.participants) inPlay.add(p);
  for (const e of events) for (const a of e.actors) if (!a.startsWith("fan:")) inPlay.add(a);
  for (const id of visitorIds) {
    for (const cid of Object.keys(repo.getVisitor(id)?.stance ?? {})) inPlay.add(cid);
  }

  const kept = all.filter((r) => inPlay.has(r.from_id) && inPlay.has(r.to_id));
  const chosen = kept.length > 0 ? kept : all;

  return chosen.length <= MAX_DIGEST_EDGES
    ? chosen
    : [...chosen].sort((a, b) => b.tension - a.tension).slice(0, MAX_DIGEST_EDGES);
}

export function compileDigest(
  repo: CanonRepo,
  opts: { tickNo: number; sinceSeq: number; dailyBudget: number; visitorIds?: string[] },
): TickDigest {
  const now = repo.now();
  const since = new Date(Date.parse(now) - 24 * 3600_000).toISOString();

  const newEvents: WorldEvent[] = repo.eventsSinceSeq(opts.sinceSeq, MAX_NEW_EVENTS);
  // A brand new world has no "new" events past the seed, so fall back to the
  // tail of the log. The host must never be handed an empty briefing.
  const events = newEvents.length > 0 ? newEvents : repo.recentEvents(8);

  // Only visitors who are actually here. An NPC greeting someone who left four
  // days ago is the single most immersion-breaking thing this system could do.
  const visitorIds = opts.visitorIds ?? repo.listVisitors(true);
  const visitors: DigestVisitor[] = visitorIds.flatMap((id) => {
    const v = repo.getVisitor(id);
    if (!v) return [];
    return [
      {
        fan_id: v.fan_id,
        display_name: v.display_name,
        first_seen: v.first_seen,
        visits: v.interactions.length,
        stance: v.stance,
        notable_moments: repo.recallMoments(v.fan_id, undefined, 4).map((m) => ({
          event_id: m.event_id,
          ts: m.ts,
          summary: m.summary,
          witnesses: m.witnesses,
        })),
      },
    ];
  });

  const tone = repo.getTone();

  return {
    world: repo.getMeta("world_name") ?? "the district",
    tick_no: opts.tickNo,
    now,
    since_seq: opts.sinceSeq,
    characters: repo.getCharacters().map(toDigestCharacter),
    relationships: relationshipsInPlay(repo, events, visitorIds).map(toDigestRelationship),
    open_arcs: repo.openArcs(),
    new_events: events.map((e) => ({
      event_id: e.event_id,
      ts: e.ts,
      type: e.type,
      actors: e.actors,
      summary: describeEvent(e),
    })),
    visitors,
    tone: {
      register: tone.register,
      banned_phrases: tone.banned_phrases,
      max_line_words: tone.max_line_words,
    },
    budget: { used_24h: repo.hostInvocationsSince(since), limit: opts.dailyBudget },
  };
}

/** Compact human/host-readable rendering. This is what goes over the wire. */
export function renderDigest(d: TickDigest): string {
  const L: string[] = [];
  L.push(`WORLD: ${d.world}`);
  L.push(`TICK: ${d.tick_no}   WORLD TIME: ${d.now}`);
  L.push("");

  L.push("TONE");
  L.push(`  ${d.tone.register}`);
  if (d.tone.banned_phrases.length)
    L.push(`  Never write: ${d.tone.banned_phrases.join("; ")}`);
  L.push("");

  L.push("CAST (these ids and no others)");
  for (const c of d.characters) {
    L.push(`  ${c.id}  ${c.name} -- ${c.title}, ${c.faction}. Mood: ${c.mood}.`);
    if (c.goals.length) L.push(`      wants: ${c.goals.join(" | ")}`);
    if (c.taboos.length) L.push(`      never: ${c.taboos.join(" | ")}`);
  }
  L.push("");

  L.push("STANDING BETWEEN THEM (directed; A->B is not B->A)");
  for (const r of d.relationships) {
    L.push(
      `  ${r.from} -> ${r.to}  affinity ${r.affinity}, trust ${r.trust}, tension ${r.tension}` +
        (r.note ? `  "${r.note}"` : ""),
    );
  }
  L.push("");

  L.push("OPEN ARCS");
  if (d.open_arcs.length === 0) L.push("  (none -- you may open one)");
  for (const a of d.open_arcs) {
    L.push(
      `  ${a.arc_id} [${a.status}, stage ${a.stage}, tension ${Math.round(a.tension)}, between ${a.participants.join(" and ")}] ${a.title}`,
    );
    if (a.summary) L.push(`      ${a.summary}`);
  }
  L.push("");

  L.push("WHAT HAS HAPPENED SINCE YOU LAST ACTED");
  if (d.new_events.length === 0) L.push("  (nothing)");
  for (const e of d.new_events) {
    L.push(`  ${e.ts}  [${e.event_id}] ${e.summary}`);
  }
  L.push("");

  if (d.visitors.length > 0) {
    L.push("VISITORS ON RECORD");
    for (const v of d.visitors) {
      const stance = Object.entries(v.stance)
        .map(([k, n]) => `${k} ${n > 0 ? "+" : ""}${Math.round(n)}`)
        .join(", ");
      L.push(
        `  fan:${v.fan_id}${v.display_name ? ` (${v.display_name})` : ""} -- first seen ${v.first_seen}, ${v.visits} interactions`,
      );
      if (stance) L.push(`      standing: ${stance}`);
      for (const m of v.notable_moments) {
        L.push(`      remembers [${m.event_id}] ${m.summary}`);
      }
    }
    L.push("");
  }

  L.push(`COGNITION BUDGET: ${d.budget.used_24h}/${d.budget.limit} host calls in the last 24h.`);
  return L.join("\n");
}
