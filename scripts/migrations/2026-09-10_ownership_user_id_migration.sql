-- 2026-09-10_ownership_user_id_migration.sql
--
-- Adds integer FK columns alongside the three legacy VARCHAR name columns that
-- store lead ownership in walkin_enquiries:
--
--   assigned_to              → assigned_to_user_id
--   assigned_receptionist    → assigned_receptionist_user_id
--   overseeing_site_head     → overseeing_site_head_user_id
--
-- The legacy VARCHAR columns are kept throughout the transition so that old
-- code paths continue to work. The new FK columns are nullable and become the
-- authoritative ownership signal for all code updated after this migration.
--
-- BACKFILL STRATEGY
--   Name matching is case-insensitive + trim-safe to absorb the whitespace
--   drift that caused the original bug. When a name matches multiple users
--   within the same org (duplicate names) the ACTIVE user wins; ties go to
--   the lowest id. Rows whose name resolves to no user stay NULL — this is
--   NOT an error. It covers deleted employees, historical assignments before
--   the user table existed, and any remaining whitespace mismatch the trim
--   cannot absorb.
--
-- SAFETY
--   * Additive only. No DROP, no TRUNCATE, no column removal.
--   * Every statement is idempotent (ADD COLUMN IF NOT EXISTS,
--     CREATE INDEX IF NOT EXISTS). Safe to re-run.
--   * The backfill UPDATEs only touch rows where the _user_id column IS NULL,
--     so a re-run after a partial failure picks up where it left off.
--
-- PRE-MIGRATION AUDIT (run manually before applying)
-- ─────────────────────────────────────────────────────────────────────────────
-- -- How many leads are assigned to employees we can resolve?
-- SELECT
--   COUNT(*)                                       AS total_assigned,
--   COUNT(assigned_to_user_id)                     AS resolved,
--   COUNT(*) - COUNT(assigned_to_user_id)          AS unresolved,
--   ROUND(COUNT(assigned_to_user_id) * 100.0
--         / NULLIF(COUNT(*), 0), 1)                AS resolve_pct
-- FROM walkin_enquiries
-- WHERE assigned_to IS NOT NULL AND assigned_to <> '';
--
-- -- Names that did not resolve (candidates for name-cleanup):
-- SELECT DISTINCT assigned_to
-- FROM walkin_enquiries
-- WHERE assigned_to IS NOT NULL
--   AND assigned_to <> ''
--   AND assigned_to_user_id IS NULL
-- ORDER BY 1;
--
-- -- Duplicate names within one org (ambiguous mappings):
-- SELECT organization_id, LOWER(TRIM(name)) AS norm_name, COUNT(*) AS copies
-- FROM users
-- WHERE deleted_at IS NULL
-- GROUP BY organization_id, LOWER(TRIM(name))
-- HAVING COUNT(*) > 1;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Add the three new FK columns ─────────────────────────────────────────

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS assigned_receptionist_user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS overseeing_site_head_user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

-- ─── 2. Backfill assigned_to_user_id ─────────────────────────────────────────
-- Match assigned_to (name) → users.id within the same organization.
-- Active users win over deactivated ones; lowest id breaks ties.

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
 WHERE w.assigned_to IS NOT NULL
   AND w.assigned_to <> ''
   AND w.assigned_to_user_id IS NULL;

-- ─── 3. Backfill assigned_receptionist_user_id ───────────────────────────────

UPDATE walkin_enquiries w
   SET assigned_receptionist_user_id = (
     SELECT u.id
       FROM users u
      WHERE u.organization_id = w.organization_id
        AND LOWER(TRIM(u.name)) = LOWER(TRIM(w.assigned_receptionist))
        AND u.deleted_at IS NULL
      ORDER BY u.is_active DESC, u.id ASC
      LIMIT 1
   )
 WHERE w.assigned_receptionist IS NOT NULL
   AND w.assigned_receptionist <> ''
   AND w.assigned_receptionist_user_id IS NULL;

-- ─── 4. Backfill overseeing_site_head_user_id ───────────────────────────────

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
 WHERE w.overseeing_site_head IS NOT NULL
   AND w.overseeing_site_head <> ''
   AND w.overseeing_site_head_user_id IS NULL;

-- ─── 5. Indexes ───────────────────────────────────────────────────────────────
-- Partial indexes (WHERE IS NOT NULL) keep index size minimal: ~30-40% of rows
-- will have NULL here once the transition is done (rows with no assignment).

CREATE INDEX IF NOT EXISTS idx_walkin_assigned_to_user_id
  ON walkin_enquiries(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_walkin_assigned_receptionist_user_id
  ON walkin_enquiries(assigned_receptionist_user_id)
  WHERE assigned_receptionist_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_walkin_overseeing_site_head_user_id
  ON walkin_enquiries(overseeing_site_head_user_id)
  WHERE overseeing_site_head_user_id IS NOT NULL;

COMMIT;

-- POST-MIGRATION VERIFICATION (run after applying to confirm backfill quality)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT
--   'assigned_to'           AS column_name,
--   COUNT(*)                AS rows_with_name,
--   COUNT(assigned_to_user_id) AS resolved,
--   COUNT(*) - COUNT(assigned_to_user_id) AS unresolved
-- FROM walkin_enquiries WHERE assigned_to IS NOT NULL AND assigned_to <> ''
-- UNION ALL
-- SELECT
--   'assigned_receptionist',
--   COUNT(*), COUNT(assigned_receptionist_user_id),
--   COUNT(*) - COUNT(assigned_receptionist_user_id)
-- FROM walkin_enquiries WHERE assigned_receptionist IS NOT NULL AND assigned_receptionist <> ''
-- UNION ALL
-- SELECT
--   'overseeing_site_head',
--   COUNT(*), COUNT(overseeing_site_head_user_id),
--   COUNT(*) - COUNT(overseeing_site_head_user_id)
-- FROM walkin_enquiries WHERE overseeing_site_head IS NOT NULL AND overseeing_site_head <> '';
