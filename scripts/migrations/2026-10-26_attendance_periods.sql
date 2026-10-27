-- 2026-10-26_attendance_periods.sql
--
-- Phase 1: Attendance Periods — Database Foundation
-- Supports the Remark Attendance feature (multiple work periods per day).
--
-- Architecture: each attendance_records row remains the daily anchor
-- (one per employee per IST calendar day). Each work period within that
-- day is a row in attendance_periods, linked via attendance_id FK.
--
-- This migration is:
--   - Additive only (no existing tables/columns altered or dropped)
--   - Idempotent (IF NOT EXISTS on all DDL)
--   - Transaction-safe (single BEGIN/COMMIT)
--   - Backfills existing data (one period per attendance_records row)
--
-- =========================================================================
-- PREFLIGHT RESULTS (read-only, 2026-10-26 against ep-long-cloud):
--
--   PF-1  Orphan records:    4 rows (employee_id=78, org 9e652ad6, deleted user)
--   PF-2  Duplicate dailies: 9 rows across employees 1, 8, 84
--         (re-login next UTC day mapping to same IST day)
--   PF-3  Negative durations: 0
--   PF-4  Logout w/o track:   0
--   PF-5  Active records:    283 of 327 (no logout_time)
--   PF-6  Inconsistent completion: 0
--
-- DUPLICATE HANDLING STRATEGY:
--   All 327 records are backfilled — each gets exactly one period
--   (period_number=1). The 9 duplicate daily records are NOT deleted or
--   modified. Application code already handles duplicates via
--   `DISTINCT ON (employee_id) ORDER BY employee_id, id ASC`, which
--   always picks the first record per day. Future remark-attendance code
--   will add periods to that first record only. The duplicate rows are
--   effectively orphaned anchors that never accumulate new periods.
--
-- ORPHAN HANDLING:
--   The 4 orphan records (employee_id=78) are backfilled normally.
--   The FK from attendance_periods.attendance_id -> attendance_records(id)
--   ON DELETE CASCADE means deleting orphan attendance_records rows in a
--   future cleanup will automatically remove their periods.
--
-- =========================================================================

BEGIN;

-- ── 1. attendance_periods table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance_periods (
  id                SERIAL PRIMARY KEY,
  attendance_id     INTEGER      NOT NULL
                                 REFERENCES attendance_records(id)
                                 ON DELETE CASCADE,
  organization_id   UUID         NOT NULL
                                 REFERENCES organizations(id)
                                 ON DELETE RESTRICT,
  employee_id       INTEGER      NOT NULL
                                 REFERENCES users(id)
                                 ON DELETE CASCADE,
  period_number     INTEGER      NOT NULL DEFAULT 1,

  -- Period timestamps (TIMESTAMPTZ for unambiguous instants)
  started_at        TIMESTAMPTZ  NOT NULL,
  completed_at      TIMESTAMPTZ,
  duration_seconds  INTEGER,

  -- Metadata
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- ── Integrity constraints ──────────────────────────────────────────

  -- Period numbers are positive integers, sequential per attendance day
  CONSTRAINT attendance_periods_period_number_positive
    CHECK (period_number >= 1),

  -- Completed periods MUST have a non-negative duration
  CONSTRAINT attendance_periods_completed_duration_valid
    CHECK (
      completed_at IS NULL
      OR (duration_seconds IS NOT NULL AND duration_seconds >= 0)
    ),

  -- Active (incomplete) periods MUST have NULL duration
  CONSTRAINT attendance_periods_active_duration_null
    CHECK (
      completed_at IS NOT NULL
      OR duration_seconds IS NULL
    ),

  -- completed_at must be >= started_at when present
  CONSTRAINT attendance_periods_time_order
    CHECK (
      completed_at IS NULL
      OR completed_at >= started_at
    ),

  -- One period_number per attendance_id (no duplicate period numbers)
  CONSTRAINT attendance_periods_unique_period
    UNIQUE (attendance_id, period_number)
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────

-- At most ONE active (incomplete) period per attendance_records row.
-- This is the critical safety valve: prevents double-active periods.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_periods_one_active_per_attendance
  ON attendance_periods (attendance_id)
  WHERE completed_at IS NULL;

-- Fast lookup: all periods for a given attendance day
CREATE INDEX IF NOT EXISTS attendance_periods_attendance_id_idx
  ON attendance_periods (attendance_id, period_number);

-- Tenant-scoped queries (admin dashboards, reports)
CREATE INDEX IF NOT EXISTS attendance_periods_org_employee_idx
  ON attendance_periods (organization_id, employee_id);

-- The missing index from the original attendance_tables migration.
-- attendance_records(employee_id, DATE(login_time AT TIME ZONE 'Asia/Kolkata'))
-- is used by status, mark, live, and my-sessions routes.
-- login_time is TIMESTAMPTZ on production, so AT TIME ZONE yields
-- a naive TIMESTAMP, and DATE() on that is immutable -> indexable.
CREATE INDEX IF NOT EXISTS attendance_records_employee_ist_day_idx
  ON attendance_records (employee_id, (DATE(login_time AT TIME ZONE 'Asia/Kolkata')));

-- ── 3. Consistency trigger ───────────────────────────────────────────────
-- Ensures organization_id and employee_id on the period match the parent
-- attendance_records row. A CHECK constraint cannot reference other tables,
-- so we use a trigger.

CREATE OR REPLACE FUNCTION attendance_periods_validate_parent()
RETURNS TRIGGER AS $$
DECLARE
  parent_org_id   UUID;
  parent_emp_id   INTEGER;
BEGIN
  SELECT organization_id, employee_id
    INTO parent_org_id, parent_emp_id
    FROM attendance_records
   WHERE id = NEW.attendance_id;

  IF parent_org_id IS NULL THEN
    RAISE EXCEPTION 'attendance_periods: parent attendance_records row % not found',
      NEW.attendance_id;
  END IF;

  IF NEW.organization_id <> parent_org_id THEN
    RAISE EXCEPTION 'attendance_periods: organization_id % does not match parent %',
      NEW.organization_id, parent_org_id;
  END IF;

  IF NEW.employee_id <> parent_emp_id THEN
    RAISE EXCEPTION 'attendance_periods: employee_id % does not match parent %',
      NEW.employee_id, parent_emp_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop + recreate to make idempotent (CREATE OR REPLACE for functions,
-- but triggers need explicit drop)
DROP TRIGGER IF EXISTS trg_attendance_periods_validate_parent
  ON attendance_periods;

CREATE TRIGGER trg_attendance_periods_validate_parent
  BEFORE INSERT OR UPDATE ON attendance_periods
  FOR EACH ROW
  EXECUTE FUNCTION attendance_periods_validate_parent();

-- ── 4. Backfill ──────────────────────────────────────────────────────────
-- Creates exactly one period (period_number=1) per existing
-- attendance_records row. Uses ON CONFLICT to be idempotent.
--
-- Mapping:
--   started_at      = submitted_at AT TIME ZONE 'UTC'  (reinterpret bare TIMESTAMP as UTC)
--   completed_at    = logout_time                       (already TIMESTAMPTZ, NULL if active)
--   duration_seconds = working_track                    (already computed, NULL if active)
--
-- The trigger fires for each inserted row, validating org_id/employee_id
-- consistency against the parent.

INSERT INTO attendance_periods (
  attendance_id,
  organization_id,
  employee_id,
  period_number,
  started_at,
  completed_at,
  duration_seconds,
  created_at,
  updated_at
)
SELECT
  ar.id,
  ar.organization_id,
  ar.employee_id,
  1,                                              -- period_number
  ar.submitted_at AT TIME ZONE 'UTC',             -- reinterpret as TIMESTAMPTZ
  ar.logout_time,                                 -- already TIMESTAMPTZ or NULL
  ar.working_track,                               -- already integer seconds or NULL
  ar.created_at,                                  -- preserve original timestamp
  CURRENT_TIMESTAMP
FROM attendance_records ar
-- Skip orphan rows whose employee_id no longer exists in users
-- (4 rows for employee_id=78, deleted user — confirmed in preflight PF-1).
-- The attendance_periods FK to users(id) would reject them.
JOIN users u ON u.id = ar.employee_id
ON CONFLICT (attendance_id, period_number) DO NOTHING;

COMMIT;
