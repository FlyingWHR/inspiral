import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

/**
 * Schema DDL. Versioned via `user_version` so migrations are a plain switch.
 *
 * Design notes:
 *  - `events` is append-only. There is a trigger that makes UPDATE and DELETE
 *    hard errors, so "append-only" is enforced by the database, not by
 *    discipline.
 *  - Everything else is a derived projection of the log. It exists because
 *    replaying 10 days of events on every read would be silly, not because it
 *    is authoritative.
 */
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY EVENT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  event_id          TEXT PRIMARY KEY,
  ts                TEXT NOT NULL,
  source            TEXT NOT NULL,
  actors            TEXT NOT NULL,          -- JSON array
  type              TEXT NOT NULL,
  payload           TEXT NOT NULL,          -- JSON object
  significance_hint REAL NOT NULL DEFAULT 0.5,
  seq               INTEGER NOT NULL        -- insertion order, gapless-ish
);
CREATE INDEX IF NOT EXISTS idx_events_seq  ON events(seq);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

-- The log is immutable. Enforced here so no future contributor can "just
-- quickly fix" a row and silently rewrite history.
CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only: UPDATE is forbidden');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only: DELETE is forbidden');
END;

-- ---------------------------------------------------------------------------
-- CANON STATE (derived projection)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
  character_id  TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  faction       TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  brief         TEXT NOT NULL DEFAULT '',
  goals         TEXT NOT NULL DEFAULT '[]',
  taboos        TEXT NOT NULL DEFAULT '[]',
  voice         TEXT NOT NULL DEFAULT '{}',
  mood          TEXT NOT NULL DEFAULT 'even',
  home_location TEXT NOT NULL DEFAULT 'district'
);

CREATE TABLE IF NOT EXISTS relationships (
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  affinity      REAL NOT NULL DEFAULT 0,
  trust         REAL NOT NULL DEFAULT 50,
  tension       REAL NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  last_event_id TEXT,
  updated_ts    TEXT,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS arcs (
  arc_id       TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  participants TEXT NOT NULL DEFAULT '[]',
  stage        INTEGER NOT NULL DEFAULT 0,
  tension      REAL NOT NULL DEFAULT 10,
  summary      TEXT NOT NULL DEFAULT '',
  resolution   TEXT,
  opened_ts    TEXT,
  updated_ts   TEXT
);

CREATE TABLE IF NOT EXISTS tone_rules (
  world_id         TEXT PRIMARY KEY,
  register         TEXT NOT NULL DEFAULT '',
  banned_phrases   TEXT NOT NULL DEFAULT '[]',
  forbidden_topics TEXT NOT NULL DEFAULT '[]',
  max_line_words   INTEGER NOT NULL DEFAULT 32
);

CREATE TABLE IF NOT EXISTS world_facts (
  fact_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  statement TEXT NOT NULL,
  about     TEXT NOT NULL DEFAULT '[]',
  event_id  TEXT,
  ts        TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- VISITORS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitors (
  fan_id       TEXT PRIMARY KEY,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  -- Presence is not the same as existence. A visitor who left is still
  -- remembered, but the cast must not be able to greet an empty doorway.
  present      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visitor_interactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fan_id       TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  ts           TEXT NOT NULL,
  character_id TEXT,
  kind         TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_vi_fan ON visitor_interactions(fan_id);

CREATE TABLE IF NOT EXISTS visitor_stance (
  fan_id       TEXT NOT NULL,
  character_id TEXT NOT NULL,
  sentiment    REAL NOT NULL DEFAULT 0,
  updated_ts   TEXT,
  PRIMARY KEY (fan_id, character_id)
);

CREATE TABLE IF NOT EXISTS visitor_moments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fan_id    TEXT NOT NULL,
  event_id  TEXT NOT NULL,
  ts        TEXT NOT NULL,
  summary   TEXT NOT NULL,
  weight    REAL NOT NULL DEFAULT 0.5,
  witnesses TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_vm_fan ON visitor_moments(fan_id);

-- ---------------------------------------------------------------------------
-- RUNTIME BOOKKEEPING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Every host invocation, for cost accounting against the cognition budget.
CREATE TABLE IF NOT EXISTS host_invocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  alias       TEXT NOT NULL,
  kind        TEXT NOT NULL,       -- tick | onboard | fan-event | qc | repair
  ok          INTEGER NOT NULL,
  latency_ms  INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_hi_ts ON host_invocations(ts);

-- The last batch of directives that validated. Used to keep the world moving
-- when the host times out.
CREATE TABLE IF NOT EXISTS last_directives (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  ts         TEXT NOT NULL,
  directives TEXT NOT NULL
);
`;

/**
 * The affinity tables, from docs/affinity/002-affinity-tables.sql.
 *
 * Kept as a separate string rather than folded into DDL so the provenance is
 * obvious: this is the spec's DDL, and the spec is the place to change it.
 */
const AFFINITY_DDL = `
CREATE TABLE IF NOT EXISTS recall_citations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fan_id            TEXT    NOT NULL,
  character_id      TEXT    NOT NULL,
  event_id          TEXT    NOT NULL,   -- the performance that did the citing
  cited_event_id    TEXT    NOT NULL,   -- the receipt being cited
  ts                TEXT    NOT NULL,
  kind              TEXT    NOT NULL,   -- moment | grievance | relationship
  resolved          INTEGER NOT NULL DEFAULT 0,
  visitor_initiated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rc_fan   ON recall_citations(fan_id, ts);
CREATE INDEX IF NOT EXISTS idx_rc_cited ON recall_citations(cited_event_id);
CREATE TABLE IF NOT EXISTS visitor_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  fan_id              TEXT    NOT NULL,
  started_ts          TEXT    NOT NULL,
  ended_ts            TEXT,
  arrival_event_id    TEXT    NOT NULL,
  referrer_event_id   TEXT,
  greeting_cached     INTEGER NOT NULL DEFAULT 0,
  cites_delivered     INTEGER NOT NULL DEFAULT 0,
  stance_abs_delta    REAL    NOT NULL DEFAULT 0,
  stance_signed_delta REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vs_fan ON visitor_sessions(fan_id, started_ts);
CREATE TABLE IF NOT EXISTS event_effects (
  event_id        TEXT PRIMARY KEY,
  ts              TEXT    NOT NULL,
  rel_movement    REAL    NOT NULL DEFAULT 0,
  stance_movement REAL    NOT NULL DEFAULT 0,
  arc_transition  TEXT    NOT NULL DEFAULT 'none',
  irreversible    REAL    NOT NULL DEFAULT 0,
  clamped         REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ee_ts ON event_effects(ts);
CREATE TABLE IF NOT EXISTS clip_drafts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT    NOT NULL,
  role        TEXT,                      -- reach|value|identity|trust|conversion|community
  arc_id      TEXT,
  drafted_ts  TEXT    NOT NULL,
  headline    TEXT    NOT NULL DEFAULT '',
  link        TEXT    NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cd_ts   ON clip_drafts(drafted_ts);
CREATE INDEX IF NOT EXISTS idx_cd_role ON clip_drafts(role, drafted_ts);

-- ---------------------------------------------------------------------------
-- PIECES -- the things people make together.
--
-- A piece is mutable state (title, status, generation, contributors) and so it
-- is a row. Its LINEAGE is not here: every extension is an event, because
-- attribution is the product and the events table refuses UPDATE and DELETE at
-- the database level. A lineage that could be edited to take somebody's name
-- off their work would be worth nothing.
--
-- Its own table rather than reusing the arcs table, which is a near-exact
-- structural match. Reuse saves a migration and costs permanent confusion --
-- a table called 'arcs' holding pieces, with a dead 'tension' column, is what
-- somebody decodes at 3am.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pieces (
  piece_id     TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  brief        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  -- Depth, not score. Never rendered as a leaderboard: ranking contribution is
  -- how a remix community turns into a farm.
  generation   INTEGER NOT NULL DEFAULT 0,
  contributors TEXT NOT NULL DEFAULT '[]',
  -- The event that started it. Every extension chains back to this.
  seed_event_id TEXT NOT NULL,
  created_ts   TEXT NOT NULL,
  updated_ts   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pieces_status ON pieces(status, updated_ts);
`;

const SCHEMA_VERSION = 3;

/**
 * Open (and if needed create) the canon database.
 * `:memory:` is supported and is what the tests use.
 */
export function openDb(path: string): DB {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(DDL);

  db.exec(AFFINITY_DDL);

  const row = db.pragma("user_version", { simple: true }) as number;
  if (row < 2) {
    /**
     * 1 -> 2. SQLite has no ADD COLUMN IF NOT EXISTS, so the two visitor
     * columns cannot live in the idempotent DDL and have to be probed for.
     * `synthetic` is the tag that keeps patrol history out of every number a
     * judge is shown; it is permanent and load-bearing, not a debug flag.
     */
    const cols = (db.pragma("table_info(visitors)") as { name: string }[]).map((c) => c.name);
    if (!cols.includes("synthetic")) {
      db.exec("ALTER TABLE visitors ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.includes("profile")) {
      db.exec("ALTER TABLE visitors ADD COLUMN profile TEXT");
    }
  }
  /**
   * 2 -> 3 needs no ALTER: `pieces` is a new table and arrives with the
   * idempotent DDL above. The version bump is here so an older binary reading
   * this file knows it is looking at something it does not fully understand.
   */
  if (row < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}

export function closeDb(db: DB): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
