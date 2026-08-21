-- ---------------------------------------------------------------------------
-- INSPIRAL — AFFINITY MEASUREMENT TABLES (schema version 2)
--
-- Paste the CREATE statements below into the `DDL` template literal in
-- src/canon/db.ts, then bump SCHEMA_VERSION from 1 to 2.
--
-- Every statement is IF NOT EXISTS, so existing databases upgrade in place
-- with no migration step and no data loss. The two ALTER TABLE statements at
-- the bottom are the exception and need the guarded helper described there.
--
-- WHAT THIS DOES NOT TOUCH, and therefore does not violate the SCHEMA.md §6
-- freeze:
--   * the five event fields
--   * actors[0] as the initiator
--   * the directive shape
--   * the seven delta ops
--   * canon's authority over the host
--
-- Everything here is a DERIVED PROJECTION. All four tables can be rebuilt by
-- replaying the event log, and none of them is authoritative. That is the same
-- status SCHEMA.md §2 gives `characters`, `relationships` and `arcs`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. recall_citations — THE REWARD LEDGER
--
-- Every time the world cited a receipt at a visitor, and whether it held up.
--
-- Today `RenderedBehavior.cites[]` is computed in src/runtime/character.ts
-- (lines 402, 420, 445), printed by ConsoleSurface, and then garbage
-- collected. That array is the single fact distinguishing this project from
-- every other LLM-NPC demo, and nothing persists it.
--
-- Written by: dispatch() in src/tick/runTick.ts:63-86, inside the existing
-- try/catch so a bookkeeping failure can never take down a tick.
--
--   resolved          1 if cited_event_id exists in events. MUST always be 1.
--                     Any 0 is an existential failure -- see anti-metric #6.
--   visitor_initiated 1 if the cited event has a fan: actor. This is the gate
--                     that separates "the world remembers what you did" from
--                     "the world recites its own plot at you".
--   kind              which of the three citation sources produced it, so a
--                     regression in one source is visible rather than diluted.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 2. visitor_sessions — SESSIONISED PRESENCE
--
-- Derived from visitor_arrived / visitor_departed events. Exists because
-- `visitor_interactions` counts interactions, not visits -- note that
-- digest.ts already labels `v.interactions.length` as `visits`, which is
-- misleading and is one reason this table is separate rather than computed
-- inline.
--
-- Written by: visitorArrive() and visitorLeaves() in src/tick/visitors.ts.
--
--   ended_ts         NULL means unterminated. Today that is the common case:
--                    visitor_departed only fires from visitorLeaves() (:169)
--                    and demo.ts:202, so a browser close leaves a session
--                    open forever. Fix by calling visitorLeaves on socket
--                    close in webSurface / voxelSurface.
--   referrer_event_id  parsed from ?e=<event_id> on a clip link. This is the
--                    ONLY thing that would make "Stop" measurable; without it
--                    there is no denominator and no attribution.
--   greeting_cached  1 when visitors.ts:130 replayed a stored greeting. This
--                    is the hollow-recognition flag. The cached branch writes
--                    a visitor_arrived event with significance_hint 0.05,
--                    while onboardVisitor writes 0.4, so <= 0.05 already
--                    identifies it in the log today.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 3. event_effects — REALISED STATE MOVEMENT
--
-- What an event ACTUALLY moved, after clamping. This is the basis of computed
-- significance (spec §3.7) and the only way to see world saturation.
--
-- repo.adjustRelationship clamps to canon ranges on write, so a requested
-- affinity -25 against a relationship already at -79 moves 21 points and
-- silently discards 4. Nothing records the discard. In data/canon.db as of
-- 21 Aug 2026, vance<->okonkwo is pinned at affinity -79/-81, trust 0/0,
-- tension 100/100 in both directions: every further delta on that edge is
-- absorbed entirely and the log cannot tell you.
--
-- Written by: applyDelta() in src/directive/apply.ts, accumulating per event.
--
--   rel_movement     sum of |realised delta| across affinity, trust, tension
--   stance_movement  same for visitor_stance, via adjustStance's return value
--   arc_transition   opened | escalated | resolved | advanced | none
--                    NOT the stage counter. A bare stage advance scores 0.10
--                    in sig(); a resolution scores 1.00. This is what stops
--                    the 77 arc_advanced rows currently in canon.db from
--                    looking like 77 significant events -- ACTION_EVENT_TYPE
--                    maps `hold` to arc_advanced (types/directive.ts:48).
--   irreversible     0..1. Some things cannot be walked back.
--   clamped          how much requested movement the clamps absorbed.
--                    Anti-metric #8. Expect this to breach on first read.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 4. clip_drafts — WHAT WAS DRAFTED, AND WHETHER IT WENT OUT
--
-- writeClips() currently writes a markdown file and forgets. Without a record
-- of the window there is no way to enforce a role quota across runs, because
-- there is no way to know what the window already contains.
--
-- Written by: selectClips() / writeClips() in src/ip/outbound.ts.
--
--   published   set by the owner, not by the system. Nothing here posts
--               anything; that property is deliberate and must survive.
-- ---------------------------------------------------------------------------
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
-- 5. visitors: synthetic + profile columns
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so these cannot go in the idempotent
-- DDL block. Run them from the SCHEMA_VERSION 1 -> 2 migration branch in
-- openDb(), guarded:
--
--   const cols = db.prepare("PRAGMA table_info(visitors)").all() as {name:string}[];
--   const has  = (n: string) => cols.some(c => c.name === n);
--   if (!has("synthetic")) db.exec("ALTER TABLE visitors ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0");
--   if (!has("profile"))   db.exec("ALTER TABLE visitors ADD COLUMN profile TEXT");
--
-- WHY THIS MATTERS MORE THAN IT LOOKS: an untagged synthetic visitor is data
-- fabrication. Once tagged, every downstream consumer must respect it --
--   * npm run affinity : separate table, never merged into cohort stats
--   * selectClips      : synthetic visitors are EXCLUDED from the `community`
--                        role entirely. Handing an owner a clip draft about a
--                        bot is the pipeline manufacturing fake social proof.
--   * showrunnerNote   : label "(patrol)" or omit
--   * compileDigest    : INCLUDE them normally. The world must not know which
--                        of its visitors are synthetic; that is the point of a
--                        control arm. Only the reporting layer distinguishes.
--
-- Use fan_id values prefixed `sim_` as well, so raw sqlite3 inspection is
-- unambiguous. Do NOT reuse wren/ash/juno/pell -- demo.ts:61 hardcodes `wren`
-- and mixing demo history with patrol history makes both worthless.
-- ---------------------------------------------------------------------------
-- ALTER TABLE visitors ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE visitors ADD COLUMN profile   TEXT;


-- ---------------------------------------------------------------------------
-- REBUILD NOTE
--
-- All four tables are projections. If they drift, they can be dropped and
-- rebuilt from `events` -- with two exceptions worth knowing before you rely
-- on a rebuild:
--
--   * event_effects.clamped cannot be recovered by replay, because the
--     requested delta is not stored on the event (payload carries the
--     dialogue_intent and action, not the canon_deltas). Only forward capture
--     works. Events written before this table exists will never have a row.
--
--   * recall_citations cannot be recovered either -- `cites[]` is computed at
--     render time from state as it stood then, and re-rendering against
--     today's canon would produce different citations. The 128 events already
--     in canon.db will have no citation rows, ever. That is fine and should
--     be stated rather than backfilled with a guess.
--
-- Both are reasons to land these two tables early rather than late.
-- ---------------------------------------------------------------------------
