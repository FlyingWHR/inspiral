import type { DB } from "./db.js";
import { openDb } from "./db.js";
import {
  type Arc,
  type ArcStatus,
  type CanonSnapshot,
  type CharacterSheet,
  type NotableMoment,
  type Relationship,
  type ToneRules,
  type VisitorInteraction,
  type VisitorRecord,
} from "../types/canon.js";
import { type NewWorldEvent, type WorldEvent, newEventId } from "../types/events.js";
import { type Clock, systemClock } from "../clock.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const j = (v: unknown) => JSON.stringify(v);
function pj<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * CanonRepo is the only thing in the system that writes to the database.
 * Nothing above it -- not the host adapter, not the tick loop -- holds a
 * connection. That is what makes the sovereignty seam a real boundary rather
 * than a diagram.
 */
export class CanonRepo {
  readonly db: DB;
  private clock: Clock;

  constructor(db: DB, clock: Clock = systemClock) {
    this.db = db;
    this.clock = clock;
  }

  static open(path: string, clock: Clock = systemClock): CanonRepo {
    return new CanonRepo(openDb(path), clock);
  }

  setClock(clock: Clock): void {
    this.clock = clock;
  }

  now(): string {
    return this.clock.now().toISOString();
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* noop */
    }
  }

  /** Run fn inside a transaction. Deltas are applied all-or-nothing. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // -------------------------------------------------------------------------
  // EVENT LOG (append-only)
  // -------------------------------------------------------------------------

  /**
   * An event id is `evt_<ms base36>_<counter>`, and BOTH halves repeat across
   * runs against a persisted world. The counter is per-process and starts at
   * zero; under a VirtualClock the timestamps are a pure function of the seed.
   * So opening the same database twice -- `npm run voxel --db ./data/x.db`, run
   * it, run it again -- regenerates byte-identical ids and every warm-up tick
   * died on the UNIQUE constraint. `runTick` absorbed the throw exactly as
   * designed, so the world simply stopped moving and said nothing about why.
   *
   * Resolved here rather than by making ids random, because reproducibility is
   * a property this project sells: same seed, same run, same ids. A collision
   * is rare and local, so bump the counter until the id is free and keep the
   * deterministic id in the overwhelmingly common case.
   */
  private freeEventId(ts: string, proposed: string): string {
    let id = proposed;
    for (let i = 0; i < 1000 && this.eventExists(id); i++) id = newEventId(new Date(ts));
    return id;
  }

  private eventExists(eventId: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(eventId) !== undefined
    );
  }

  appendEvent(e: NewWorldEvent): WorldEvent {
    const ts = e.ts ?? this.now();
    const event_id = e.event_id ?? this.freeEventId(ts, newEventId(new Date(ts)));
    const seqRow = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get() as {
      m: number;
    };
    const full: WorldEvent = {
      event_id,
      ts,
      source: e.source,
      actors: e.actors,
      type: e.type,
      payload: e.payload ?? {},
      significance_hint: e.significance_hint ?? 0.5,
    };
    this.db
      .prepare(
        `INSERT INTO events (event_id, ts, source, actors, type, payload, significance_hint, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.event_id,
        full.ts,
        full.source,
        j(full.actors),
        full.type,
        j(full.payload),
        full.significance_hint,
        seqRow.m + 1,
      );
    return full;
  }

  private rowToEvent(r: Record<string, unknown>): WorldEvent {
    return {
      event_id: String(r.event_id),
      ts: String(r.ts),
      source: r.source as WorldEvent["source"],
      actors: pj<string[]>(r.actors, []),
      type: r.type as WorldEvent["type"],
      payload: pj<Record<string, unknown>>(r.payload, {}),
      significance_hint: Number(r.significance_hint),
    };
  }

  getEvent(eventId: string): WorldEvent | undefined {
    const r = this.db.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowToEvent(r) : undefined;
  }

  /** Newest last. */
  allEvents(): WorldEvent[] {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY seq ASC").all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToEvent(r));
  }

  /** Events after a given seq marker, oldest first. */
  eventsSinceSeq(seq: number, limit = 200): WorldEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?")
      .all(seq, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  maxSeq(): number {
    const r = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get() as {
      m: number;
    };
    return r.m;
  }

  /** Most recent N events, oldest first. */
  recentEvents(limit = 20): WorldEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events ORDER BY seq DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.reverse().map((r) => this.rowToEvent(r));
  }

  /** Events an actor was involved in, newest first. */
  eventsInvolving(actor: string, limit = 20): WorldEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE EXISTS (SELECT 1 FROM json_each(events.actors) WHERE json_each.value = ?)
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(actor, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  eventCount(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
    return r.c;
  }

  // -------------------------------------------------------------------------
  // CHARACTERS
  // -------------------------------------------------------------------------

  upsertCharacter(c: CharacterSheet): void {
    this.db
      .prepare(
        `INSERT INTO characters (character_id, name, faction, title, brief, goals, taboos, voice, mood, home_location)
         VALUES (@character_id, @name, @faction, @title, @brief, @goals, @taboos, @voice, @mood, @home_location)
         ON CONFLICT(character_id) DO UPDATE SET
           name=excluded.name, faction=excluded.faction, title=excluded.title,
           brief=excluded.brief, goals=excluded.goals, taboos=excluded.taboos,
           voice=excluded.voice, mood=excluded.mood, home_location=excluded.home_location`,
      )
      .run({
        character_id: c.character_id,
        name: c.name,
        faction: c.faction,
        title: c.title,
        brief: c.brief,
        goals: j(c.goals),
        taboos: j(c.taboos),
        voice: j(c.voice),
        mood: c.mood,
        home_location: c.home_location,
      });
  }

  private rowToCharacter(r: Record<string, unknown>): CharacterSheet {
    return {
      character_id: String(r.character_id),
      name: String(r.name),
      faction: String(r.faction),
      title: String(r.title ?? ""),
      brief: String(r.brief ?? ""),
      goals: pj<string[]>(r.goals, []),
      taboos: pj<string[]>(r.taboos, []),
      voice: pj<CharacterSheet["voice"]>(r.voice, {
        register: "plain",
        tics: [],
        max_words: 28,
      }),
      mood: String(r.mood ?? "even"),
      home_location: String(r.home_location ?? "district"),
    };
  }

  getCharacter(id: string): CharacterSheet | undefined {
    const r = this.db.prepare("SELECT * FROM characters WHERE character_id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowToCharacter(r) : undefined;
  }

  getCharacters(): CharacterSheet[] {
    const rows = this.db
      .prepare("SELECT * FROM characters ORDER BY character_id")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToCharacter(r));
  }

  characterExists(id: string): boolean {
    const r = this.db
      .prepare("SELECT 1 AS x FROM characters WHERE character_id = ?")
      .get(id) as { x: number } | undefined;
    return !!r;
  }

  setMood(characterId: string, mood: string): void {
    this.db
      .prepare("UPDATE characters SET mood = ? WHERE character_id = ?")
      .run(mood, characterId);
  }

  // -------------------------------------------------------------------------
  // RELATIONSHIPS
  // -------------------------------------------------------------------------

  private rowToRelationship(r: Record<string, unknown>): Relationship {
    return {
      from_id: String(r.from_id),
      to_id: String(r.to_id),
      affinity: Number(r.affinity),
      trust: Number(r.trust),
      tension: Number(r.tension),
      note: String(r.note ?? ""),
      last_event_id: (r.last_event_id as string | null) ?? null,
      updated_ts: (r.updated_ts as string | undefined) ?? undefined,
    };
  }

  getRelationship(from: string, to: string): Relationship | undefined {
    const r = this.db
      .prepare("SELECT * FROM relationships WHERE from_id = ? AND to_id = ?")
      .get(from, to) as Record<string, unknown> | undefined;
    return r ? this.rowToRelationship(r) : undefined;
  }

  getRelationships(): Relationship[] {
    const rows = this.db
      .prepare("SELECT * FROM relationships ORDER BY from_id, to_id")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToRelationship(r));
  }

  upsertRelationship(rel: Relationship): void {
    this.db
      .prepare(
        `INSERT INTO relationships (from_id, to_id, affinity, trust, tension, note, last_event_id, updated_ts)
         VALUES (@from_id, @to_id, @affinity, @trust, @tension, @note, @last_event_id, @updated_ts)
         ON CONFLICT(from_id, to_id) DO UPDATE SET
           affinity=excluded.affinity, trust=excluded.trust, tension=excluded.tension,
           note=excluded.note, last_event_id=excluded.last_event_id, updated_ts=excluded.updated_ts`,
      )
      .run({
        from_id: rel.from_id,
        to_id: rel.to_id,
        affinity: rel.affinity,
        trust: rel.trust,
        tension: rel.tension,
        note: rel.note,
        last_event_id: rel.last_event_id,
        updated_ts: rel.updated_ts ?? this.now(),
      });
  }

  /** Apply a bounded delta. Values are clamped to canon ranges, always. */
  adjustRelationship(
    from: string,
    to: string,
    d: { affinity?: number; trust?: number; tension?: number; note?: string },
    eventId: string | null,
  ): Relationship {
    const cur =
      this.getRelationship(from, to) ??
      ({
        from_id: from,
        to_id: to,
        affinity: 0,
        trust: 50,
        tension: 0,
        note: "",
        last_event_id: null,
      } as Relationship);

    const next: Relationship = {
      ...cur,
      affinity: clamp(cur.affinity + (d.affinity ?? 0), -100, 100),
      trust: clamp(cur.trust + (d.trust ?? 0), 0, 100),
      tension: clamp(cur.tension + (d.tension ?? 0), 0, 100),
      note: d.note ?? cur.note,
      last_event_id: eventId ?? cur.last_event_id,
      updated_ts: this.now(),
    };
    this.upsertRelationship(next);
    return next;
  }

  // -------------------------------------------------------------------------
  // ARCS
  // -------------------------------------------------------------------------

  private rowToArc(r: Record<string, unknown>): Arc {
    return {
      arc_id: String(r.arc_id),
      title: String(r.title),
      status: r.status as ArcStatus,
      participants: pj<string[]>(r.participants, []),
      stage: Number(r.stage),
      tension: Number(r.tension),
      summary: String(r.summary ?? ""),
      resolution: (r.resolution as string | null) ?? null,
      opened_ts: (r.opened_ts as string | undefined) ?? undefined,
      updated_ts: (r.updated_ts as string | undefined) ?? undefined,
    };
  }

  upsertArc(a: Arc): void {
    this.db
      .prepare(
        `INSERT INTO arcs (arc_id, title, status, participants, stage, tension, summary, resolution, opened_ts, updated_ts)
         VALUES (@arc_id, @title, @status, @participants, @stage, @tension, @summary, @resolution, @opened_ts, @updated_ts)
         ON CONFLICT(arc_id) DO UPDATE SET
           title=excluded.title, status=excluded.status, participants=excluded.participants,
           stage=excluded.stage, tension=excluded.tension, summary=excluded.summary,
           resolution=excluded.resolution, updated_ts=excluded.updated_ts`,
      )
      .run({
        arc_id: a.arc_id,
        title: a.title,
        status: a.status,
        participants: j(a.participants),
        stage: a.stage,
        tension: a.tension,
        summary: a.summary,
        resolution: a.resolution,
        opened_ts: a.opened_ts ?? this.now(),
        updated_ts: this.now(),
      });
  }

  getArc(id: string): Arc | undefined {
    const r = this.db.prepare("SELECT * FROM arcs WHERE arc_id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowToArc(r) : undefined;
  }

  getArcs(status?: ArcStatus): Arc[] {
    const rows = (
      status
        ? this.db.prepare("SELECT * FROM arcs WHERE status = ? ORDER BY arc_id").all(status)
        : this.db.prepare("SELECT * FROM arcs ORDER BY arc_id").all()
    ) as Record<string, unknown>[];
    return rows.map((r) => this.rowToArc(r));
  }

  /** Arcs the next tick should be asked to advance. */
  openArcs(): Arc[] {
    const rows = this.db
      .prepare("SELECT * FROM arcs WHERE status IN ('open','escalating') ORDER BY tension DESC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToArc(r));
  }

  arcExists(id: string): boolean {
    const r = this.db.prepare("SELECT 1 AS x FROM arcs WHERE arc_id = ?").get(id) as
      | { x: number }
      | undefined;
    return !!r;
  }

  // -------------------------------------------------------------------------
  // TONE + FACTS
  // -------------------------------------------------------------------------

  setTone(t: ToneRules): void {
    this.db
      .prepare(
        `INSERT INTO tone_rules (world_id, register, banned_phrases, forbidden_topics, max_line_words)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(world_id) DO UPDATE SET
           register=excluded.register, banned_phrases=excluded.banned_phrases,
           forbidden_topics=excluded.forbidden_topics, max_line_words=excluded.max_line_words`,
      )
      .run(t.world_id, t.register, j(t.banned_phrases), j(t.forbidden_topics), t.max_line_words);
  }

  getTone(worldId = "default"): ToneRules {
    const r = this.db.prepare("SELECT * FROM tone_rules WHERE world_id = ?").get(worldId) as
      | Record<string, unknown>
      | undefined;
    if (!r) {
      return {
        world_id: worldId,
        register: "",
        banned_phrases: [],
        forbidden_topics: [],
        max_line_words: 32,
      };
    }
    return {
      world_id: String(r.world_id),
      register: String(r.register ?? ""),
      banned_phrases: pj<string[]>(r.banned_phrases, []),
      forbidden_topics: pj<string[]>(r.forbidden_topics, []),
      max_line_words: Number(r.max_line_words),
    };
  }

  addFact(statement: string, about: string[], eventId: string | null): void {
    this.db
      .prepare("INSERT INTO world_facts (statement, about, event_id, ts) VALUES (?, ?, ?, ?)")
      .run(statement, j(about), eventId, this.now());
  }

  getFacts(limit = 50): { statement: string; about: string[]; ts: string }[] {
    const rows = this.db
      .prepare("SELECT statement, about, ts FROM world_facts ORDER BY fact_id DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      statement: String(r.statement),
      about: pj<string[]>(r.about, []),
      ts: String(r.ts),
    }));
  }

  // -------------------------------------------------------------------------
  // VISITORS
  // -------------------------------------------------------------------------

  ensureVisitor(fanId: string, displayName = "", synthetic?: { profile: string }): void {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO visitors (fan_id, first_seen, last_seen, display_name, present, synthetic, profile)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(fan_id) DO UPDATE SET last_seen = excluded.last_seen, present = 1`,
      )
      .run(fanId, now, now, displayName, synthetic ? 1 : 0, synthetic?.profile ?? null);
  }

  /**
   * Open a visit. `visitor_interactions` counts interactions, not visits --
   * digest.ts even labels `interactions.length` as "visits", which is wrong --
   * so sessions are their own table.
   */
  openSession(fanId: string, arrivalEventId: string, greetingCached: boolean): void {
    this.db
      .prepare(
        `INSERT INTO visitor_sessions (fan_id, started_ts, arrival_event_id, greeting_cached)
         VALUES (?, ?, ?, ?)`,
      )
      .run(fanId, this.now(), arrivalEventId, greetingCached ? 1 : 0);
  }

  /** Close the most recent open visit, if there is one. */
  closeSession(fanId: string): void {
    this.db
      .prepare(
        `UPDATE visitor_sessions SET ended_ts = ?
          WHERE id = (SELECT id FROM visitor_sessions
                       WHERE fan_id = ? AND ended_ts IS NULL
                       ORDER BY started_ts DESC LIMIT 1)`,
      )
      .run(this.now(), fanId);
  }

  sessionsFor(fanId: string): {
    id: number; fan_id: string; started_ts: string; ended_ts: string | null;
    arrival_event_id: string; greeting_cached: number;
  }[] {
    return this.db
      .prepare("SELECT * FROM visitor_sessions WHERE fan_id = ? ORDER BY started_ts ASC")
      .all(fanId) as never;
  }

  allVisitors(): { fan_id: string; display_name: string; first_seen: string; synthetic: number; profile: string | null }[] {
    return this.db
      .prepare("SELECT fan_id, display_name, first_seen, synthetic, profile FROM visitors ORDER BY first_seen ASC")
      .all() as never;
  }

  /**
   * Record what an event ACTUALLY moved, after clamping.
   *
   * `adjustRelationship` clamps to canon ranges on write, so a requested -25
   * against a relationship already at -79 moves 21 points and silently discards
   * 4. Nothing recorded the discard, which meant "did this change anything" --
   * the EFFECT pillar of significance -- was unanswerable and `changedState`
   * was permanently false at every call site.
   */
  recordEffect(
    eventId: string,
    e: { rel?: number; stance?: number; clamped?: number; arcTransition?: string; irreversible?: number },
  ): void {
    this.db
      .prepare(
        `INSERT INTO event_effects (event_id, ts, rel_movement, stance_movement, arc_transition, irreversible, clamped)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           rel_movement    = rel_movement + excluded.rel_movement,
           stance_movement = stance_movement + excluded.stance_movement,
           clamped         = clamped + excluded.clamped,
           arc_transition  = CASE WHEN excluded.arc_transition <> 'none'
                                  THEN excluded.arc_transition ELSE arc_transition END`,
      )
      .run(eventId, this.now(), e.rel ?? 0, e.stance ?? 0, e.arcTransition ?? "none",
           e.irreversible ?? 0, e.clamped ?? 0);
  }

  /**
   * Record that a performance cited a prior event -- the UPTAKE signal. Other
   * beats, later, referring back is the part of significance a host can least
   * game, and it was the other permanently-dead term.
   */
  recordRecall(r: {
    fanId: string; characterId: string; eventId: string; citedEventId: string;
    kind: string; resolved: boolean; visitorInitiated: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO recall_citations
           (fan_id, character_id, event_id, cited_event_id, ts, kind, resolved, visitor_initiated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.fanId, r.characterId, r.eventId, r.citedEventId, this.now(), r.kind,
           r.resolved ? 1 : 0, r.visitorInitiated ? 1 : 0);
  }

  /**
   * How much requested state movement the clamps absorbed, 0..1.
   *
   * Anti-metric: above 0.20 the world has run out of range and every stance
   * move it appears to make is fictional. Expect this to breach on a world
   * whose relationships are already pinned at the extremes.
   */
  clampRatio(): number {
    const r = this.db
      .prepare("SELECT SUM(clamped) AS c, SUM(rel_movement + stance_movement) AS m FROM event_effects")
      .get() as { c: number | null; m: number | null };
    const clamped = r?.c ?? 0;
    const realised = r?.m ?? 0;
    const total = clamped + realised;
    return total > 0 ? clamped / total : 0;
  }

  /** Every recorded recall, newest first. */
  recallCitations(): {
    fan_id: string; character_id: string; event_id: string; cited_event_id: string;
    ts: string; kind: string; resolved: number; visitor_initiated: number;
  }[] {
    return this.db
      .prepare("SELECT * FROM recall_citations ORDER BY ts DESC")
      .all() as never;
  }

  /**
   * Evidence context for every event, in two queries rather than one per event.
   * Read sites pass this into `rankSignificance`; without it the EFFECT and
   * UPTAKE terms are structurally dead, and the measured spread between "this
   * mattered" and "nothing is known about this" was 0.02.
   */
  rankContexts(): Map<string, { citedBy: number; changedState: boolean }> {
    const out = new Map<string, { citedBy: number; changedState: boolean }>();
    for (const r of this.db
      .prepare("SELECT cited_event_id AS id, COUNT(*) AS n FROM recall_citations GROUP BY cited_event_id")
      .all() as { id: string; n: number }[]) {
      out.set(r.id, { citedBy: r.n, changedState: false });
    }
    for (const r of this.db
      .prepare("SELECT event_id AS id, rel_movement + stance_movement AS m FROM event_effects")
      .all() as { id: string; m: number }[]) {
      const cur = out.get(r.id) ?? { citedBy: 0, changedState: false };
      cur.changedState = r.m > 0;
      out.set(r.id, cur);
    }
    return out;
  }

  /**
   * Synthetic visitors, and only those. The patrol is a control arm: its rows
   * must never be merged into anything a judge is shown, so the tag lives in
   * the schema rather than in a naming convention somebody forgets.
   */
  isSynthetic(fanId: string): boolean {
    const r = this.db.prepare("SELECT synthetic FROM visitors WHERE fan_id = ?").get(fanId) as
      | { synthetic: number }
      | undefined;
    return Boolean(r?.synthetic);
  }

  syntheticFanIds(): string[] {
    return (this.db.prepare("SELECT fan_id FROM visitors WHERE synthetic = 1").all() as
      { fan_id: string }[]).map((r) => r.fan_id);
  }

  /** Host invocations in the trailing window, for the patrol's own budget gate. */
  invocationsSince(hours: number): number {
    const since = new Date(Date.parse(this.now()) - hours * 3_600_000).toISOString();
    const r = this.db
      .prepare("SELECT COUNT(*) AS c FROM host_invocations WHERE ts >= ?")
      .get(since) as { c: number };
    return r?.c ?? 0;
  }

  /** Mark a visitor as in the world or gone from it. */
  setPresence(fanId: string, present: boolean): void {
    this.db
      .prepare("UPDATE visitors SET present = ?, last_seen = ? WHERE fan_id = ?")
      .run(present ? 1 : 0, this.now(), fanId);
  }

  isPresent(fanId: string): boolean {
    const r = this.db.prepare("SELECT present FROM visitors WHERE fan_id = ?").get(fanId) as
      | { present: number }
      | undefined;
    return r?.present === 1;
  }

  visitorExists(fanId: string): boolean {
    const r = this.db.prepare("SELECT 1 AS x FROM visitors WHERE fan_id = ?").get(fanId) as
      | { x: number }
      | undefined;
    return !!r;
  }

  touchVisitor(fanId: string): void {
    this.db.prepare("UPDATE visitors SET last_seen = ? WHERE fan_id = ?").run(this.now(), fanId);
  }

  addInteraction(fanId: string, i: VisitorInteraction): void {
    this.db
      .prepare(
        `INSERT INTO visitor_interactions (fan_id, event_id, ts, character_id, kind, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(fanId, i.event_id, i.ts, i.character_id, i.kind, i.detail);
  }

  adjustStance(fanId: string, characterId: string, delta: number): number {
    const cur = this.db
      .prepare("SELECT sentiment FROM visitor_stance WHERE fan_id = ? AND character_id = ?")
      .get(fanId, characterId) as { sentiment: number } | undefined;
    const next = clamp((cur?.sentiment ?? 0) + delta, -100, 100);
    this.db
      .prepare(
        `INSERT INTO visitor_stance (fan_id, character_id, sentiment, updated_ts)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(fan_id, character_id) DO UPDATE SET
           sentiment = excluded.sentiment, updated_ts = excluded.updated_ts`,
      )
      .run(fanId, characterId, next, this.now());
    return next;
  }

  getStance(fanId: string): Record<string, number> {
    const rows = this.db
      .prepare("SELECT character_id, sentiment FROM visitor_stance WHERE fan_id = ?")
      .all(fanId) as { character_id: string; sentiment: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.character_id] = r.sentiment;
    return out;
  }

  addMoment(fanId: string, m: NotableMoment): void {
    this.db
      .prepare(
        `INSERT INTO visitor_moments (fan_id, event_id, ts, summary, weight, witnesses)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(fanId, m.event_id, m.ts, m.summary, m.weight, j(m.witnesses));
  }

  /**
   * What this NPC can bring up about this visitor, heaviest first.
   * `witness` filters to moments this character actually saw -- an NPC must
   * not cite something they were not present for.
   */
  recallMoments(fanId: string, witness?: string, limit = 5): NotableMoment[] {
    const rows = this.db
      .prepare("SELECT * FROM visitor_moments WHERE fan_id = ? ORDER BY weight DESC, id DESC")
      .all(fanId) as Record<string, unknown>[];
    const all: NotableMoment[] = rows.map((r) => ({
      event_id: String(r.event_id),
      ts: String(r.ts),
      summary: String(r.summary),
      weight: Number(r.weight),
      witnesses: pj<string[]>(r.witnesses, []),
    }));
    const filtered = witness
      ? all.filter((m) => m.witnesses.length === 0 || m.witnesses.includes(witness))
      : all;
    return filtered.slice(0, limit);
  }

  getVisitor(fanId: string): VisitorRecord | undefined {
    const v = this.db.prepare("SELECT * FROM visitors WHERE fan_id = ?").get(fanId) as
      | Record<string, unknown>
      | undefined;
    if (!v) return undefined;
    const interactions = (
      this.db
        .prepare("SELECT * FROM visitor_interactions WHERE fan_id = ? ORDER BY id ASC")
        .all(fanId) as Record<string, unknown>[]
    ).map((r) => ({
      event_id: String(r.event_id),
      ts: String(r.ts),
      character_id: (r.character_id as string | null) ?? null,
      kind: String(r.kind),
      detail: String(r.detail ?? ""),
    }));
    return {
      fan_id: String(v.fan_id),
      first_seen: String(v.first_seen),
      last_seen: String(v.last_seen),
      display_name: String(v.display_name ?? ""),
      interactions,
      stance: this.getStance(fanId),
      notable_moments: this.recallMoments(fanId, undefined, 100),
    };
  }

  /** All visitors ever, or only those currently in the world. */
  listVisitors(onlyPresent = false): string[] {
    const sql = onlyPresent
      ? "SELECT fan_id FROM visitors WHERE present = 1 ORDER BY first_seen"
      : "SELECT fan_id FROM visitors ORDER BY first_seen";
    const rows = this.db.prepare(sql).all() as { fan_id: string }[];
    return rows.map((r) => r.fan_id);
  }

  // -------------------------------------------------------------------------
  // META / BOOKKEEPING
  // -------------------------------------------------------------------------

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return r?.value;
  }

  recordHostInvocation(rec: {
    alias: string;
    kind: string;
    ok: boolean;
    latencyMs?: number;
    error?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO host_invocations (ts, alias, kind, ok, latency_ms, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now(),
        rec.alias,
        rec.kind,
        rec.ok ? 1 : 0,
        rec.latencyMs ?? null,
        rec.error ?? null,
      );
  }

  /** Host invocations in the trailing 24h of world time. Budget enforcement. */
  hostInvocationsSince(iso: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS c FROM host_invocations WHERE ts >= ?")
      .get(iso) as { c: number };
    return r.c;
  }

  totalHostInvocations(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS c FROM host_invocations").get() as { c: number };
    return r.c;
  }

  saveLastDirectives(directives: unknown): void {
    this.db
      .prepare(
        `INSERT INTO last_directives (id, ts, directives) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, directives = excluded.directives`,
      )
      .run(this.now(), j(directives));
  }

  loadLastDirectives<T = unknown>(): T | undefined {
    const r = this.db.prepare("SELECT directives FROM last_directives WHERE id = 1").get() as
      | { directives: string }
      | undefined;
    return r ? pj<T | undefined>(r.directives, undefined) : undefined;
  }

  // -------------------------------------------------------------------------
  // SNAPSHOT
  // -------------------------------------------------------------------------

  snapshot(): CanonSnapshot {
    return {
      characters: this.getCharacters(),
      relationships: this.getRelationships(),
      arcs: this.getArcs(),
      tone: this.getTone(),
    };
  }
}
