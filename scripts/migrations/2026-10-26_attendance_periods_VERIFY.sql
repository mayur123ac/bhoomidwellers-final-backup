-- 2026-10-26_attendance_periods_VERIFY.sql
--
-- Post-migration verification queries. Run these READ-ONLY after applying
-- the migration to confirm the backfill is correct and constraints hold.
-- Every query should return 0 rows or an expected count.

-- ── V-1: Row count parity ────────────────────────────────────────────────
-- attendance_periods should have exactly as many rows as attendance_records.
-- Expected: both counts equal (327 on production as of 2026-10-26).

SELECT
  (SELECT COUNT(*) FROM attendance_records)   AS attendance_records_count,
  (SELECT COUNT(*) FROM attendance_periods)   AS attendance_periods_count,
  (SELECT COUNT(*) FROM attendance_records) =
  (SELECT COUNT(*) FROM attendance_periods)   AS counts_match;


-- ── V-2: 1:1 backfill integrity ─────────────────────────────────────────
-- Every attendance_records row should have exactly one period.
-- Expected: 0 rows (no missing periods).

SELECT ar.id AS attendance_id, ar.employee_id
FROM attendance_records ar
LEFT JOIN attendance_periods ap ON ap.attendance_id = ar.id
WHERE ap.id IS NULL;


-- ── V-3: Organization ID consistency ─────────────────────────────────────
-- Period org_id must match parent. Expected: 0 rows.

SELECT ap.id, ap.attendance_id, ap.organization_id AS period_org,
       ar.organization_id AS parent_org
FROM attendance_periods ap
JOIN attendance_records ar ON ar.id = ap.attendance_id
WHERE ap.organization_id <> ar.organization_id;


-- ── V-4: Employee ID consistency ─────────────────────────────────────────
-- Period employee_id must match parent. Expected: 0 rows.

SELECT ap.id, ap.attendance_id, ap.employee_id AS period_emp,
       ar.employee_id AS parent_emp
FROM attendance_periods ap
JOIN attendance_records ar ON ar.id = ap.attendance_id
WHERE ap.employee_id <> ar.employee_id;


-- ── V-5: Duration accuracy — completed periods ──────────────────────────
-- Compare period duration_seconds against parent working_track.
-- Expected: 0 rows (all should match exactly).

SELECT ap.id, ap.attendance_id,
       ap.duration_seconds AS period_duration,
       ar.working_track    AS parent_track
FROM attendance_periods ap
JOIN attendance_records ar ON ar.id = ap.attendance_id
WHERE ar.working_track IS NOT NULL
  AND ap.duration_seconds IS DISTINCT FROM ar.working_track;


-- ── V-6: Timestamp accuracy — started_at ────────────────────────────────
-- Period started_at should equal submitted_at reinterpreted as UTC.
-- Expected: 0 rows.

SELECT ap.id, ap.attendance_id,
       ap.started_at                           AS period_started,
       ar.submitted_at AT TIME ZONE 'UTC'      AS expected_started
FROM attendance_periods ap
JOIN attendance_records ar ON ar.id = ap.attendance_id
WHERE ap.started_at <> (ar.submitted_at AT TIME ZONE 'UTC');


-- ── V-7: Timestamp accuracy — completed_at ──────────────────────────────
-- Period completed_at should equal logout_time (both TIMESTAMPTZ).
-- Expected: 0 rows.

SELECT ap.id, ap.attendance_id,
       ap.completed_at AS period_completed,
       ar.logout_time  AS parent_logout
FROM attendance_periods ap
JOIN attendance_records ar ON ar.id = ap.attendance_id
WHERE ap.completed_at IS DISTINCT FROM ar.logout_time;


-- ── V-8: Active periods have NULL duration ──────────────────────────────
-- Constraint check: no active period should have a non-NULL duration.
-- Expected: 0 rows.

SELECT id, attendance_id
FROM attendance_periods
WHERE completed_at IS NULL AND duration_seconds IS NOT NULL;


-- ── V-9: Completed periods have non-negative duration ───────────────────
-- Constraint check: completed periods must have duration >= 0.
-- Expected: 0 rows.

SELECT id, attendance_id, duration_seconds
FROM attendance_periods
WHERE completed_at IS NOT NULL
  AND (duration_seconds IS NULL OR duration_seconds < 0);


-- ── V-10: No duplicate active periods per attendance ─────────────────────
-- The partial unique index should prevent this, but verify.
-- Expected: 0 rows.

SELECT attendance_id, COUNT(*) AS active_count
FROM attendance_periods
WHERE completed_at IS NULL
GROUP BY attendance_id
HAVING COUNT(*) > 1;


-- ── V-11: Unique index existence ─────────────────────────────────────────
-- Confirm the critical indexes were created.

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'attendance_periods'
ORDER BY indexname;


-- ── V-12: Trigger existence ──────────────────────────────────────────────
-- Confirm the parent-validation trigger is active.

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'attendance_periods'::regclass
  AND tgname = 'trg_attendance_periods_validate_parent';


-- ── V-13: Known anomalies — duplicate daily records ──────────────────────
-- These 9 rows are expected duplicates (same employee, same IST day,
-- multiple attendance_records). Each got its own period. This query
-- lists them for documentation.

SELECT ar.employee_id,
       DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') AS ist_day,
       COUNT(*) AS records_on_day,
       array_agg(ar.id ORDER BY ar.id) AS record_ids
FROM attendance_records ar
GROUP BY ar.employee_id, DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata')
HAVING COUNT(*) > 1
ORDER BY ar.employee_id, ist_day;
