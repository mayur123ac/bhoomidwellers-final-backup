-- 2026-10-17_hr_phase2_leave_holidays.sql
--
-- Phase 2, Migration 2: Leave management and holiday structures.
--
-- HR-managed leave allocations and records. No default quotas are seeded.
-- Holiday management with soft-delete (is_active flag).
--
-- Additive only. Every statement is IF NOT EXISTS. Safe to re-run.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Organization holidays (soft-delete, tenant-scoped)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_holidays (
  id              SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  holiday_date    DATE NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'public',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deactivated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active holiday per org+date+name
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_holidays_dedup
  ON organization_holidays(organization_id, holiday_date, name)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_org_holidays_date_range
  ON organization_holidays(organization_id, holiday_date)
  WHERE is_active = true;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Employee leave allocations (per-employee, HR-managed)
-- ═══════════════════════════════════════════════════════════════════════════
-- No default quotas. HR configures each employee individually.
-- If HR sets 0, it stays 0 until HR changes it.

CREATE TABLE IF NOT EXISTS employee_leave_allocations (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  leave_type      TEXT NOT NULL,
  year            INTEGER NOT NULL,
  allocated       NUMERIC(4,1) NOT NULL DEFAULT 0,
  used            NUMERIC(4,1) NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, leave_type, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_alloc_user_year
  ON employee_leave_allocations(user_id, organization_id, year);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Employee leave records (actual leave entries, HR-entered)
-- ═══════════════════════════════════════════════════════════════════════════
-- No employee self-service. HR enters all leave records.
-- No half-day support. Days must be whole numbers >= 1.

CREATE TABLE IF NOT EXISTS employee_leave_records (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  leave_type      TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  days            INTEGER NOT NULL CHECK (days >= 1),
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'approved',
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_dates_valid CHECK (end_date >= start_date)
);

-- Prevent overlapping approved leave for same employee on same start_date
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_records_no_overlap
  ON employee_leave_records(user_id, organization_id, start_date)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_leave_records_user_range
  ON employee_leave_records(user_id, organization_id, start_date, end_date)
  WHERE status = 'approved';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Leave record edit history (audit trail for corrections)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_leave_record_history (
  id              SERIAL PRIMARY KEY,
  leave_record_id INTEGER NOT NULL REFERENCES employee_leave_records(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  old_values      JSONB,
  new_values      JSONB,
  reason          TEXT,
  changed_by      INTEGER NOT NULL REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_history_record
  ON employee_leave_record_history(leave_record_id);

COMMIT;
