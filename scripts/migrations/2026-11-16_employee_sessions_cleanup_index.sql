-- 2026-11-16_employee_sessions_cleanup_index.sql
--
-- The stale-session cleanup UPDATE runs on every admin page load:
--
--   UPDATE employee_sessions
--      SET is_active = false, session_end = last_heartbeat
--    WHERE is_active = true
--      AND organization_id = $1
--      AND last_heartbeat < NOW() - INTERVAL '5 minutes'
--
-- The existing employee_sessions_stale_idx covers (last_heartbeat) WHERE
-- is_active = true, but the planner still has to heap-filter by
-- organization_id. This composite partial index lets it do an index-only
-- scan for the cleanup predicate.
--
-- A second index covers the very common "most recent session for user on
-- date" DISTINCT ON subquery that appears in /attendance/live,
-- /hr/dashboard, and /attendance/my-sessions.

BEGIN;

-- Cleanup sweep: active sessions per org, ordered by heartbeat age.
CREATE INDEX IF NOT EXISTS idx_es_active_org_heartbeat
  ON employee_sessions (organization_id, last_heartbeat)
  WHERE is_active = true;

-- Session-by-date lookups: DISTINCT ON (user_id) ORDER BY session_start DESC
-- filtered by org. Covers the subqueries in live, hr/dashboard, my-sessions.
CREATE INDEX IF NOT EXISTS idx_es_org_start_user
  ON employee_sessions (organization_id, session_start DESC, user_id);

COMMIT;
