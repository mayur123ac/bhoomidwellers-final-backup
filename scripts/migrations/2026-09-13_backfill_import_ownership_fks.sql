-- 2026-09-13_backfill_import_ownership_fks.sql
--
-- FIX-E: Backfill assigned_to_user_id and overseeing_site_head_user_id for
-- leads created by the staged import engine (lib/import/engine.ts) between
-- 2026-09-10 (when the FK columns were added) and 2026-09-13 (when FIX-C
-- patched engine.ts to write these columns at INSERT time).
--
-- ROOT CAUSE
--   The original 2026-09-10_ownership_user_id_migration.sql backfilled all
--   rows that existed at migration time. However engine.ts did not write the
--   three FK columns in its INSERT statement, so every lead created via the
--   staged import after that date had NULL assigned_to_user_id and
--   overseeing_site_head_user_id. FIX-C (applied 2026-09-13) closes that gap
--   going forward; this script repairs the rows already in the database.
--
-- SCOPE
--   Only rows where import_job_id IS NOT NULL are targeted. That column is set
--   exclusively by engine.ts, making it a precise filter for staged-import rows.
--   The bulk-import path (bulkInsertLeads.ts) always wrote assigned_to_user_id,
--   so those rows are unaffected.
--
--   assigned_receptionist_user_id is NOT backfilled here. The staged import
--   engine hardcodes assigned_receptionist = NULL for every lead it creates
--   (imports never have a capturing receptionist), so there is nothing to resolve.
--
-- NAME RESOLUTION
--   Uses the same strategy as the original migration:
--     - Case-insensitive, trim-safe name match within the same organization
--     - Active users (is_active = true) preferred over deactivated ones
--     - Lowest id breaks ties when duplicate display names exist
--     - Rows whose name resolves to no user stay NULL — not an error
--
-- SAFETY
--   * No DDL. No DROP. No column removal.
--   * Both UPDATEs are guarded by IS NULL, so re-running is safe.
--   * Runs inside a single transaction; any error rolls back the whole script.
--
-- PRE-RUN AUDIT (run these manually to understand the scope before applying)
-- ─────────────────────────────────────────────────────────────────────────────
-- -- How many staged-import rows need assigned_to_user_id backfilled?
-- SELECT COUNT(*) AS rows_to_backfill
-- FROM walkin_enquiries
-- WHERE import_job_id IS NOT NULL
--   AND assigned_to_user_id IS NULL
--   AND assigned_to IS NOT NULL
--   AND assigned_to <> '';
--
-- -- How many need overseeing_site_head_user_id backfilled?
-- SELECT COUNT(*) AS rows_to_backfill
-- FROM walkin_enquiries
-- WHERE import_job_id IS NOT NULL
--   AND overseeing_site_head_user_id IS NULL
--   AND overseeing_site_head IS NOT NULL
--   AND overseeing_site_head <> '';
--
-- -- Which assigned_to names appear in affected rows?
-- SELECT DISTINCT assigned_to, organization_id, COUNT(*) AS lead_count
-- FROM walkin_enquiries
-- WHERE import_job_id IS NOT NULL
--   AND assigned_to_user_id IS NULL
--   AND assigned_to IS NOT NULL
--   AND assigned_to <> ''
-- GROUP BY assigned_to, organization_id
-- ORDER BY organization_id, assigned_to;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Backfill assigned_to_user_id ─────────────────────────────────────────
-- Targeted at staged-import rows only (import_job_id IS NOT NULL).
-- The correlated subquery mirrors the lookup used in engine.ts FIX-C and in
-- the original 2026-09-10 migration.

UPDATE walkin_enquiries w
   SET assigned_to_user_id = (
     SELECT u.id
       FROM users u
      WHERE u.organization_id = w.organization_id
        AND LOWER(TRIM(u.name)) = LOWER(TRIM(w.assigned_to))
        AND u.deleted_at IS NULL
      ORDER BY u.is_active DESC, u.id ASC
      LIMIT 1
   )
 WHERE w.import_job_id IS NOT NULL
   AND w.assigned_to_user_id IS NULL
   AND w.assigned_to IS NOT NULL
   AND w.assigned_to <> '';

-- ─── 2. Backfill overseeing_site_head_user_id ────────────────────────────────

UPDATE walkin_enquiries w
   SET overseeing_site_head_user_id = (
     SELECT u.id
       FROM users u
      WHERE u.organization_id = w.organization_id
        AND LOWER(TRIM(u.name)) = LOWER(TRIM(w.overseeing_site_head))
        AND u.deleted_at IS NULL
      ORDER BY u.is_active DESC, u.id ASC
      LIMIT 1
   )
 WHERE w.import_job_id IS NOT NULL
   AND w.overseeing_site_head_user_id IS NULL
   AND w.overseeing_site_head IS NOT NULL
   AND w.overseeing_site_head <> '';

COMMIT;

-- POST-RUN VERIFICATION (run after applying to confirm the backfill landed)
-- ─────────────────────────────────────────────────────────────────────────────
-- -- Remaining NULL FK rows in staged-import leads (should be 0 for resolvable names):
-- SELECT
--   'assigned_to'             AS column_name,
--   COUNT(*)                  AS import_rows_with_name,
--   COUNT(assigned_to_user_id) AS resolved,
--   COUNT(*) - COUNT(assigned_to_user_id) AS still_null
-- FROM walkin_enquiries
-- WHERE import_job_id IS NOT NULL
--   AND assigned_to IS NOT NULL AND assigned_to <> ''
-- UNION ALL
-- SELECT
--   'overseeing_site_head',
--   COUNT(*),
--   COUNT(overseeing_site_head_user_id),
--   COUNT(*) - COUNT(overseeing_site_head_user_id)
-- FROM walkin_enquiries
-- WHERE import_job_id IS NOT NULL
--   AND overseeing_site_head IS NOT NULL AND overseeing_site_head <> '';
--
-- -- Names that still did not resolve (deleted employees, name drift):
-- SELECT DISTINCT assigned_to, organization_id
-- FROM walkin_enquiries
-- WHERE import_job_id IS NOT NULL
--   AND assigned_to IS NOT NULL
--   AND assigned_to <> ''
--   AND assigned_to_user_id IS NULL
-- ORDER BY organization_id, assigned_to;
-- ─────────────────────────────────────────────────────────────────────────────
