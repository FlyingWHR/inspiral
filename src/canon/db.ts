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

const SCHEMA_VERSION = 1;

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

  const row = db.pragma("user_version", { simple: true }) as number;
  if (row < SCHEMA_VERSION) {
    // Only one version so far. Future migrations slot in here.
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
