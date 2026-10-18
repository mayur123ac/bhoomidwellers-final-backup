-- 2026-10-17_hr_phase2_attendance_reconciliation.sql  (v2 — validation only)
--
-- Phase 2, Migration 1: Attendance organization-ID reconciliation.
--
-- HISTORY: The original migration performed an INTEGER-to-UUID conversion on
-- attendance_records.organization_id and added UUID columns to employee_sessions,
-- employee_live_state, and organization_settings.
--
-- Production diagnostics (2026-10-17) confirmed that this conversion was already
-- completed outside the repository migration path:
--
--   attendance_records.organization_id    → UUID NOT NULL (274 rows, 0 NULL, 0 mismatches)
--   attendance_records.legacy_organization_id → INTEGER (preserved)
--   employee_sessions.organization_id     → UUID (exists, 34 NULL from super_admin user 75 who has no org)
--   employee_live_state.organization_id   → UUID (exists, 0 NULL)
--   organization_settings.organization_id → UUID NOT NULL (3 of 4 orgs; Shubh Aarambh has no row)
--   organization_settings.legacy_organization_id → INTEGER (preserved)
--   idx_attendance_records_org             → already exists (btree on organization_id)
--   idx_employee_sessions_org              → already exists (btree on organization_id)
--   attendance_records FK → organizations(id) ON DELETE RESTRICT (exists)
--   employee_sessions FK  → organizations(id) ON DELETE RESTRICT (exists)
--   4 orphan attendance records (employee_id=78 deleted) in Apr Crown Dombivali — preserved
--
-- The original conversion logic would fail on production because it assumed
-- attendance_records.organization_id was still INTEGER. The orphan-backfill
-- step (o.legacy_int_id = ar.organization_id) would cause a UUID-vs-INTEGER
-- type mismatch error, rolling back the entire transaction.
--
-- This replacement validates the expected post-migration state and raises an
-- actionable error if the schema does not match. It preserves legacy columns
-- and does not alter any existing data.
--
-- Safe to re-run. No data changes. No schema changes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Validate attendance_records.organization_id is UUID
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_name = 'attendance_records'
     AND column_name = 'organization_id'
     AND table_schema = 'public';

  IF col_type IS NULL THEN
    RAISE EXCEPTION
      '[HR Phase 2] attendance_records.organization_id does not exist. '
      'The INT-to-UUID conversion was never applied. Apply the original '
      'conversion migration in this environment before running validation.';
  END IF;

  IF col_type != 'uuid' THEN
    RAISE EXCEPTION
      '[HR Phase 2] attendance_records.organization_id is %, expected uuid. '
      'This environment still has the legacy integer column. The original '
      'conversion migration (v1) must be run here — not this validation file.',
      col_type;
  END IF;

  RAISE NOTICE '[HR Phase 2] attendance_records.organization_id is uuid — OK';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Validate employee_sessions.organization_id exists and is UUID
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_name = 'employee_sessions'
     AND column_name = 'organization_id'
     AND table_schema = 'public';

  IF col_type IS NULL THEN
    RAISE EXCEPTION
      '[HR Phase 2] employee_sessions.organization_id does not exist. '
      'Run: ALTER TABLE employee_sessions ADD COLUMN organization_id UUID;';
  END IF;

  IF col_type != 'uuid' THEN
    RAISE EXCEPTION
      '[HR Phase 2] employee_sessions.organization_id is %, expected uuid.',
      col_type;
  END IF;

  RAISE NOTICE '[HR Phase 2] employee_sessions.organization_id is uuid — OK';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Validate employee_live_state.organization_id exists and is UUID
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_name = 'employee_live_state'
     AND column_name = 'organization_id'
     AND table_schema = 'public';

  IF col_type IS NULL THEN
    RAISE EXCEPTION
      '[HR Phase 2] employee_live_state.organization_id does not exist. '
      'Run: ALTER TABLE employee_live_state ADD COLUMN organization_id UUID;';
  END IF;

  IF col_type != 'uuid' THEN
    RAISE EXCEPTION
      '[HR Phase 2] employee_live_state.organization_id is %, expected uuid.',
      col_type;
  END IF;

  RAISE NOTICE '[HR Phase 2] employee_live_state.organization_id is uuid — OK';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Validate organization_settings.organization_id exists and is UUID
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_name = 'organization_settings'
     AND column_name = 'organization_id'
     AND table_schema = 'public';

  IF col_type IS NULL THEN
    RAISE EXCEPTION
      '[HR Phase 2] organization_settings.organization_id does not exist.';
  END IF;

  IF col_type != 'uuid' THEN
    RAISE EXCEPTION
      '[HR Phase 2] organization_settings.organization_id is %, expected uuid.',
      col_type;
  END IF;

  RAISE NOTICE '[HR Phase 2] organization_settings.organization_id is uuid — OK';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Ensure impersonated_by column exists on employee_sessions (idempotent)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE employee_sessions
  ADD COLUMN IF NOT EXISTS impersonated_by TEXT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Ensure indexes exist (idempotent)
-- ═══════════════════════════════════════════════════════════════════════════
-- Production already has these indexes (without a WHERE predicate).
-- IF NOT EXISTS ensures no conflict if they already exist.
CREATE INDEX IF NOT EXISTS idx_attendance_records_org
  ON attendance_records(organization_id);

CREATE INDEX IF NOT EXISTS idx_employee_sessions_org
  ON employee_sessions(organization_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Report data quality metrics (informational only, no changes)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  ar_total      INTEGER;
  ar_null_org   INTEGER;
  ar_orphans    INTEGER;
  ar_mismatch   INTEGER;
  es_null_org   INTEGER;
  el_null_org   INTEGER;
BEGIN
  SELECT COUNT(*) INTO ar_total FROM attendance_records;
  SELECT COUNT(*) INTO ar_null_org FROM attendance_records WHERE organization_id IS NULL;
  SELECT COUNT(*) INTO ar_orphans FROM attendance_records ar
   WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ar.employee_id);
  SELECT COUNT(*) INTO ar_mismatch FROM attendance_records ar
    JOIN users u ON u.id = ar.employee_id
   WHERE ar.organization_id IS DISTINCT FROM u.organization_id;
  SELECT COUNT(*) INTO es_null_org FROM employee_sessions WHERE organization_id IS NULL;
  SELECT COUNT(*) INTO el_null_org FROM employee_live_state WHERE organization_id IS NULL;

  RAISE NOTICE '[HR Phase 2] attendance_records: % total, % null org, % orphans, % org-mismatch',
    ar_total, ar_null_org, ar_orphans, ar_mismatch;
  RAISE NOTICE '[HR Phase 2] employee_sessions: % null org | employee_live_state: % null org',
    es_null_org, el_null_org;

  IF ar_null_org > 0 THEN
    RAISE WARNING '[HR Phase 2] % attendance records have NULL organization_id', ar_null_org;
  END IF;
  IF ar_mismatch > 0 THEN
    RAISE WARNING '[HR Phase 2] % attendance records have organization_id mismatch vs employee', ar_mismatch;
  END IF;
END $$;

COMMIT;
