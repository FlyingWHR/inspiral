-- ---------------------------------------------------------------------------
-- INSPIRAL — AFFINITY QUERIES
--
-- Every quantity in spec §3.3 (the affinity model) and §3.9 (anti-metrics),
-- as a named, parameterised query. Written for better-sqlite3, so bind
-- parameters are ?1, ?2, ... and JSON columns are read with the json1
-- functions already used elsewhere in the codebase (see repo.ts:159, which
-- uses json_each on events.actors).
--
-- Conventions:
--   ?1  fan_id (bare, no `fan:` prefix -- the events table stores actors as
--       'fan:<id>' but visitor_* tables store the bare id, so several queries
--       below have to bridge that. This is not a bug to fix during the jam;
--       it is a footgun to remember.)
--   ?2  horizon start, ISO-8601 UTC (world time)
--
-- All of these run against a SCHEMA_VERSION 2 database. The three marked
-- [WORKS TODAY] run against the current schema with no new tables.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- SECTION 1 — SESSIONS AND CADENCE  (C_H)
-- ===========================================================================

-- name: sessions_with_gaps
-- Sessions for one visitor, with the gap to the previous session in hours.
-- Feeds freq, trend, and f4 (gap_lengthening).
SELECT
  s.id,
  s.started_ts,
  s.ended_ts,
  s.greeting_cached,
  s.referrer_event_id,
  (julianday(s.started_ts) - julianday(
      LAG(s.started_ts) OVER (PARTITION BY s.fan_id ORDER BY s.started_ts)
  )) * 24.0 AS gap_hours,
  (julianday(COALESCE(s.ended_ts, s.started_ts)) - julianday(s.started_ts))
      * 86400.0 AS duration_seconds
FROM visitor_sessions s
WHERE s.fan_id = ?1
  AND s.started_ts >= ?2
ORDER BY s.started_ts ASC;


-- name: session_count_returning
-- Sessions that count as a RETURN: separated by at least GAP_MS (12h).
-- 12h is character.ts:81. Import the constant; do not hardcode 12 in TS.
-- The metric and the fiction must agree about what a return is.
WITH gapped AS (
  SELECT
    started_ts,
    (julianday(started_ts) - julianday(
        LAG(started_ts) OVER (ORDER BY started_ts)
    )) * 24.0 AS gap_hours
  FROM visitor_sessions
  WHERE fan_id = ?1 AND started_ts >= ?2
)
SELECT
  COUNT(*)                                                AS sessions,
  SUM(CASE WHEN gap_hours >= 12.0 THEN 1 ELSE 0 END)      AS returns
FROM gapped;


-- ===========================================================================
-- SECTION 2 — GROUNDED RECALL  (R_H)
--
-- R_H = coverage * freshness
--     coverage  = delivered / opportunities   -- did it recall at all
--     freshness = distinct  / grounded        -- was it the same thing again
--
-- freshness is the repetition discount and is the centrepiece of the design.
-- An NPC that cites the same heroic moment every visit converges to R -> 0.
-- ===========================================================================

-- name: recall_opportunities   [WORKS TODAY]
-- Every time an NPC was directed to greet or recruit this visitor.
-- Note the two accepted target spellings: directive.ts FanId normalises
-- `fan:wren` to `wren` for the delta, but payload.target is written raw from
-- the directive, so both forms appear in the log.
SELECT COUNT(*) AS opportunities
FROM events
WHERE json_extract(payload, '$.action') IN ('greet_visitor', 'recruit_visitor')
  AND json_extract(payload, '$.target') IN ('fan:' || ?1, ?1)
  AND ts >= ?2;


-- name: recall_delivered_grounded_distinct
-- The three numerators. `delivered` counts distinct performances that cited
-- anything; `grounded` counts citations that both resolve AND point at
-- something the visitor did; `distinct_receipts` is what freshness divides by.
SELECT
  COUNT(DISTINCT event_id)       AS delivered,
  COUNT(*)                       AS grounded,
  COUNT(DISTINCT cited_event_id) AS distinct_receipts
FROM recall_citations
WHERE fan_id = ?1
  AND ts >= ?2
  AND resolved = 1
  AND visitor_initiated = 1;


-- name: receipts_with_repetition
-- The RECEIPTS block in the single-visitor report. The `times_cited` column is
-- what makes freshness legible instead of a number the reader has to trust --
-- the row that repeated is visibly the one dragging R down.
SELECT
  rc.cited_event_id,
  rc.character_id,
  COUNT(*)                                   AS times_cited,
  MIN(rc.ts)                                 AS first_cited,
  MAX(rc.ts)                                 AS last_cited,
  rc.resolved,
  json_extract(e.payload, '$.summary')       AS summary
FROM recall_citations rc
LEFT JOIN events e ON e.event_id = rc.cited_event_id
WHERE rc.fan_id = ?1 AND rc.ts >= ?2
GROUP BY rc.cited_event_id, rc.character_id
ORDER BY times_cited DESC, last_cited DESC;


-- ===========================================================================
-- SECTION 3 — COMMITMENT DEPTH  (D_H)
--
-- D_H = 0.4*mag + 0.6*pol
--
-- Polarisation is weighted higher than magnitude on purpose. SCHEMA.md §2.5:
-- "Taking a side must cost you something with someone." A visitor at +30 with
-- all three characters has been agreeable, not committed.
--
-- IMPORTANT: characters with no visitor_stance row count as 0, not as absent.
-- A character the visitor has no standing with is a character they have not
-- taken a side about, and that is information. The LEFT JOIN below does this.
-- ===========================================================================

-- name: commitment   [WORKS TODAY]
SELECT
  AVG(ABS(COALESCE(vs.sentiment, 0))) / 100.0                            AS mag,
  (MAX(COALESCE(vs.sentiment, 0)) - MIN(COALESCE(vs.sentiment, 0)))
      / 200.0                                                            AS pol,
  COUNT(c.character_id)                                                  AS cast_size
FROM characters c
LEFT JOIN visitor_stance vs
       ON vs.character_id = c.character_id AND vs.fan_id = ?1;
-- Edge case: cast_size = 1 leaves pol undefined; set D_H = mag and flag
-- "single-character world" rather than dividing by a degenerate range.


-- name: stance_detail   [WORKS TODAY]
-- The per-character breakdown printed under the D component.
SELECT c.character_id, c.name, COALESCE(vs.sentiment, 0) AS sentiment, vs.updated_ts
FROM characters c
LEFT JOIN visitor_stance vs
       ON vs.character_id = c.character_id AND vs.fan_id = ?1
ORDER BY sentiment DESC;


-- ===========================================================================
-- SECTION 4 — LADDER OBSERVABLES
-- ===========================================================================

-- name: stop
-- Arrivals, and how many carried a referrer. `with_referrer` is 0 until the
-- surfaces parse ?e= from the connection URL -- until then, Stop has no
-- denominator and must not be proxied.
SELECT
  COUNT(*)                                                       AS arrivals,
  SUM(CASE WHEN s.referrer_event_id IS NOT NULL THEN 1 ELSE 0 END) AS with_referrer
FROM visitor_sessions s
WHERE s.fan_id = ?1 AND s.started_ts >= ?2;


-- name: hold
-- Only terminated sessions are counted. An unterminated session is not a
-- zero-length session and must not be averaged in as one.
SELECT
  SUM(CASE WHEN ended_ts IS NOT NULL THEN 1 ELSE 0 END)  AS terminated,
  COUNT(*)                                               AS total,
  AVG(CASE WHEN ended_ts IS NOT NULL
           THEN (julianday(ended_ts) - julianday(started_ts)) * 86400.0
      END)                                               AS mean_seconds
FROM visitor_sessions
WHERE fan_id = ?1 AND started_ts >= ?2;


-- name: signal   [WORKS TODAY]
-- Costly voluntary acts. visitor_spoke and visitor_gifted are in the frozen
-- vocabulary (types/events.ts) but nothing emits them today, so both are
-- structurally 0. terrain_altered is emitted only from voxelSurface.ts:188.
SELECT
  SUM(CASE WHEN type = 'visitor_pledged'  THEN 1 ELSE 0 END) AS pledges,
  SUM(CASE WHEN type = 'terrain_altered'  THEN 1 ELSE 0 END) AS terrain,
  SUM(CASE WHEN type = 'visitor_gifted'   THEN 1 ELSE 0 END) AS gifts,
  SUM(CASE WHEN type = 'visitor_spoke'    THEN 1 ELSE 0 END) AS spoke
FROM events
WHERE ts >= ?2
  AND EXISTS (SELECT 1 FROM json_each(events.actors)
              WHERE json_each.value = 'fan:' || ?1);


-- ===========================================================================
-- SECTION 5 — COMPUTED SIGNIFICANCE  (spec §3.7)
--
-- Replaces raw significance_hint at every read site. Not materialised into a
-- column on purpose: a stored significance is a significance someone will
-- eventually write to. Implement as a pure function in
-- src/canon/significance.ts over these two joins.
-- ===========================================================================

-- name: significance_inputs
-- Everything sig(e) needs, per event, in one pass.
SELECT
  e.event_id,
  e.ts,
  e.type,
  json_extract(e.payload, '$.action')        AS action,
  e.significance_hint,
  COALESCE(ef.rel_movement, 0)               AS rel_movement,
  COALESCE(ef.stance_movement, 0)            AS stance_movement,
  COALESCE(ef.arc_transition, 'none')        AS arc_transition,
  COALESCE(ef.irreversible, 0)               AS irreversible,
  COALESCE(ef.clamped, 0)                    AS clamped,
  (ef.event_id IS NOT NULL)                  AS has_effects,
  (SELECT COUNT(*) FROM recall_citations rc
    WHERE rc.cited_event_id = e.event_id)    AS cite_count
FROM events e
LEFT JOIN event_effects ef ON ef.event_id = e.event_id
WHERE e.ts >= ?2
ORDER BY e.seq DESC;

--   sig(e) = clamp(
--       0.30 * min(1, rel_movement    / 60)
--     + 0.20 * min(1, stance_movement / 60)
--     + 0.25 * arc_transition_score          -- resolved 1.00, opened 0.60,
--                                            -- escalated 0.70, advanced 0.10
--     + 0.15 * irreversible
--     + 0.10 * min(1, cite_count / 3)        -- revealed significance
--   , 0, 1)
--
--   when has_effects = 0 (the 128 legacy events, world_fact, character_mood):
--     significance = 0.5 * significance_hint + 0.5 * 0.35
--   The pull toward 0.35 is deliberate shrinkage: an unverified host claim of
--   0.95 lands at 0.65, not 0.95. Optimism survives, discounted.


-- ===========================================================================
-- SECTION 6 — ANTI-METRICS  (spec §3.9)
--
-- npm run affinity --check computes all eight and exits 1 on any breach.
-- Two are already breached in data/canon.db as of 21 Aug 2026 (#5 and #7).
-- ===========================================================================

-- name: am1_hollow_return_rate
-- Threshold > 0.25 for real visitors.
-- (The significance_hint <= 0.05 trick works against today's schema, but the
--  visitors.synthetic filter does not, so this query needs the migration. To
--  run it today, drop the JOIN and the WHERE clause on v.synthetic.)
--
-- Compute the real and synthetic populations SEPARATELY. For a patrol on a
-- memoryless schedule ~0.21 is the PREDICTED and healthy value (spec §3.8,
-- test T4); for a real visitor the same number is a defect. Merging the two
-- populations makes both numbers meaningless.
--
-- The cached branch in visitors.ts:130 writes significance_hint 0.05;
-- onboardVisitor writes 0.4. So <= 0.05 identifies it uniquely, today, with
-- no new tables.
SELECT
  SUM(CASE WHEN e.significance_hint <= 0.05 THEN 1 ELSE 0 END)         AS hollow,
  COUNT(*)                                                             AS arrivals,
  CAST(SUM(CASE WHEN e.significance_hint <= 0.05 THEN 1 ELSE 0 END) AS REAL)
      / MAX(1, COUNT(*))                                               AS rate
FROM events e
JOIN visitors v ON ('fan:' || v.fan_id) IN (
       SELECT json_each.value FROM json_each(e.actors)
     )
WHERE e.type = 'visitor_arrived'
  AND v.synthetic = ?1;      -- 0 = real, 1 = patrol. Never both at once.


-- name: am2_citation_repetition
-- Threshold > 0.40. Per visitor: 1 - freshness.
SELECT
  fan_id,
  COUNT(*)                                                        AS grounded,
  COUNT(DISTINCT cited_event_id)                                  AS distinct_receipts,
  1.0 - (CAST(COUNT(DISTINCT cited_event_id) AS REAL) / MAX(1, COUNT(*))) AS repetition
FROM recall_citations
WHERE resolved = 1 AND visitor_initiated = 1 AND ts >= ?2
GROUP BY fan_id
ORDER BY repetition DESC;


-- name: am3_flattery_drift
-- (Needs the visitors.synthetic column. Drop the JOIN to run it today.)
-- Threshold > 0.80. Ratio of signed to absolute stance across the whole world.
-- A value of 1.00 means every stance move ever recorded was positive: nothing
-- anyone does costs them anything, and the world has no stakes.
--
-- Only spec §3.6(b) -- letting a character tell a supporter their support cost
-- something -- will ever move this off 1.00.
SELECT
  SUM(sentiment)                                                   AS signed_total,
  SUM(ABS(sentiment))                                              AS absolute_total,
  ABS(CAST(SUM(sentiment) AS REAL)) / MAX(1, SUM(ABS(sentiment)))  AS drift
FROM visitor_stance vs
JOIN visitors v ON v.fan_id = vs.fan_id
WHERE v.synthetic = 0;


-- name: am4_significance_inflation   [WORKS TODAY]
-- Threshold: mean > 0.65, or rising across buckets.
-- The host writes this number and every read site consumes it raw. Bucketing
-- by day shows whether it is trending up, which is the real tell.
SELECT
  substr(ts, 1, 10)      AS day,
  COUNT(*)               AS n,
  ROUND(AVG(significance_hint), 3) AS mean_hint
FROM events
WHERE source = 'tick'
GROUP BY day
ORDER BY day ASC;


-- name: am5_engagement_laundering
-- Threshold > 0.50.
-- source.ts:231-247 computes engagement = likes + 3*comments + views/1000,
-- then significance = min(0.95, 0.25 + log10(1+engagement)/8). Items with a
-- STATED significance bypass that formula; items without it do not.
--
-- This query needs ingest to record which branch was taken. Until it does,
-- report this anti-metric as "unmeasurable -- known live" rather than 0.
-- Reporting an unmeasured metric as passing is worse than reporting a breach.
SELECT
  SUM(CASE WHEN json_extract(payload, '$.significance_source') = 'engagement'
           THEN 1 ELSE 0 END)                                       AS laundered,
  COUNT(*)                                                          AS ingested
FROM events
WHERE source = 'ingest' AND ts >= ?2;


-- name: am6_unresolvable_citations
-- Threshold > 0. EXISTENTIAL. Every claim this project makes is false if this
-- is ever non-zero. The double-check against events is belt and braces: the
-- resolved flag is set at write time, this re-verifies it at read time.
SELECT COUNT(*) AS unresolvable
FROM recall_citations rc
WHERE rc.resolved = 0
   OR NOT EXISTS (SELECT 1 FROM events e WHERE e.event_id = rc.cited_event_id);


-- name: am7_arc_runaway   [WORKS TODAY]
-- Threshold: stage > 15 on an unresolved arc.
-- CURRENTLY BREACHED: arc_kiln_debt is at stage 26, tension 100, status
-- escalating. An arc that can never end is not a storyline.
SELECT arc_id, title, status, stage, tension, opened_ts, updated_ts
FROM arcs
WHERE status != 'resolved'
ORDER BY stage DESC;


-- name: am8_clamp_absorption
-- Threshold > 0.20. How much of the world's requested movement is being eaten
-- by the clamps. Expect this to breach on first measurement: vance<->okonkwo
-- is pinned at affinity -79/-81, trust 0/0, tension 100/100 in both
-- directions, so every further delta on that edge is absorbed entirely.
--
-- If this is high, all stance and relationship movement is fictional and every
-- affinity number computed over the same window is void. The tool should say
-- so rather than print them.
SELECT
  SUM(clamped)                                                      AS clamped,
  SUM(rel_movement + stance_movement)                               AS realised,
  CAST(SUM(clamped) AS REAL)
      / MAX(1e-9, SUM(clamped + rel_movement + stance_movement))    AS absorption
FROM event_effects
WHERE ts >= ?2;


-- ===========================================================================
-- SECTION 7 — CLIP SELECTION  (spec §3.5)
-- ===========================================================================

-- name: role_counts_in_window
-- What the rolling 7-day window already contains. Step 2 of the portfolio
-- fill algorithm. Without clip_drafts this is unknowable and the quota cannot
-- be enforced across runs.
SELECT role, COUNT(*) AS drafted
FROM clip_drafts
WHERE drafted_ts >= ?2
GROUP BY role;


-- name: clip_candidates
-- Ranked within role on EVIDENCE, not on the host's opinion.
-- significance_hint survives only as the final tiebreak.
--
-- Synthetic visitors are excluded from the community role by the
-- is_real_visitor_event flag below: an owner must never be handed a clip
-- draft about a bot.
SELECT
  e.event_id,
  e.ts,
  e.type,
  json_extract(e.payload, '$.action')  AS action,
  json_extract(e.payload, '$.arc_id')  AS arc_id,
  json_extract(e.payload, '$.summary') AS summary,
  json_extract(e.payload, '$.role')    AS declared_role,   -- advisory only
  e.significance_hint,
  COALESCE(ef.rel_movement, 0) + COALESCE(ef.stance_movement, 0) AS movement,
  COALESCE(ef.arc_transition, 'none')  AS arc_transition,
  (SELECT COUNT(*) FROM recall_citations rc
    WHERE rc.cited_event_id = e.event_id)                 AS cited_count,
  EXISTS (
    SELECT 1 FROM json_each(e.actors) je
    JOIN visitors v ON ('fan:' || v.fan_id) = je.value
    WHERE v.synthetic = 0
  )                                                       AS is_real_visitor_event,
  EXISTS (
    SELECT 1 FROM relationships r WHERE r.last_event_id = e.event_id
  )                                                       AS moved_a_relationship
FROM events e
LEFT JOIN event_effects ef ON ef.event_id = e.event_id
WHERE e.ts >= ?2
  AND e.type NOT IN ('tick_skipped','directive_rejected','world_created','character_minted')
  AND COALESCE(json_extract(e.payload, '$.action'), '') != 'hold'
ORDER BY
  cited_count           DESC,
  moved_a_relationship  DESC,
  is_real_visitor_event DESC,
  movement              DESC,
  e.ts                  DESC,
  e.significance_hint   DESC;   -- tiebreak only
-- The `action != 'hold'` filter is load-bearing: ACTION_EVENT_TYPE maps hold
-- to arc_advanced (types/directive.ts:48), and hold is ~60% of the current
-- log. Filtering on type alone would clip 77 events of nobody doing anything.


-- ===========================================================================
-- SECTION 8 — PATROL VALIDATION  (spec §3.8)
-- ===========================================================================

-- name: patrol_budget_used
-- Patrol visits that cost a host invocation, trailing 24h.
-- config.ts defaults dailyHostBudget to 12. clock.ts ticks every 180 min = 8
-- a day. So the patrol's entire allowance is ~4/day across ALL profiles, and
-- PATROL_DAILY_INVOCATIONS should be 3, leaving 1 for a real visitor.
--
-- If the cap is hit the patrol STILL VISITS -- it just takes the free cached
-- path, which is where the hollow-return data comes from. Free visits are the
-- point, not a compromise.
SELECT COUNT(*) AS used
FROM host_invocations
WHERE kind IN ('onboard', 'fan-event')
  AND ts >= datetime('now', '-1 day');


-- name: patrol_profile_summary
-- Feeds falsification tests T1 (null conformance on trend), T2 (profile
-- separation) and T3 (repetition decay). Run this against the patrol and
-- check the predictions BEFORE trusting any real visitor's curve.
--
--   T2 expects: D_H(partisan) > D_H(drifter) > D_H(lurker) ~ 0
--   T3 expects: R_H(partisan) at 8 visits ~ half its value at 4 visits.
--               If R stays flat or rises across 8+ visits, the repetition
--               discount is not working and the model is broken.
SELECT
  v.fan_id,
  v.profile,
  COUNT(DISTINCT s.id)                                         AS sessions,
  SUM(s.greeting_cached)                                       AS cached,
  CAST(SUM(s.greeting_cached) AS REAL) / MAX(1, COUNT(DISTINCT s.id)) AS cached_rate,
  (SELECT COUNT(*) FROM recall_citations rc
    WHERE rc.fan_id = v.fan_id AND rc.resolved = 1
      AND rc.visitor_initiated = 1)                            AS grounded,
  (SELECT COUNT(DISTINCT rc.cited_event_id) FROM recall_citations rc
    WHERE rc.fan_id = v.fan_id AND rc.resolved = 1
      AND rc.visitor_initiated = 1)                            AS distinct_receipts
FROM visitors v
LEFT JOIN visitor_sessions s ON s.fan_id = v.fan_id
WHERE v.synthetic = 1
GROUP BY v.fan_id, v.profile
ORDER BY v.profile;
-- T4 expects cached_rate ~ 0.21 for Exp(mean 6h) gaps against a 180-min tick:
--   P(cached) = integral_0^T (1 - g/T) * lambda*exp(-lambda*g) dg
--             = 0.21   for T = 3h, lambda = 1/6
-- Materially below 0.21 means the patrol and tick schedulers are coupled.
-- Materially above means ticks are failing and the world is not moving.
-- The estimate ignores stance-change invalidation, so treat 0.21 as a ceiling.
