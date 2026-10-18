-- 2026-10-17_hr_phase2_employee_incentives.sql
--
-- Phase 2, Migration 4: Employee incentive/commission management.
--
-- HR-managed, manual entry by default. No automatic brokerage calculation.
-- No company brokerage formula. No rules engine in this migration.
-- Modeled after cp_commissions for structural consistency.
--
-- Additive only. Safe to re-run.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Employee incentive entries
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_incentives (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  booking_id      INTEGER REFERENCES booking_applications(id) ON DELETE SET NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category        TEXT NOT NULL DEFAULT 'incentive',
  description     TEXT,
  earning_date    DATE,
  earning_period  TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reversal_reason TEXT,
  reversed_at     TIMESTAMPTZ,
  reversed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_incentives_user
  ON employee_incentives(user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_emp_incentives_org_status
  ON employee_incentives(organization_id, status);

-- Prevent duplicate entries for same booking+employee (except reversed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_incentives_booking_dedup
  ON employee_incentives(user_id, organization_id, booking_id)
  WHERE booking_id IS NOT NULL AND status != 'reversed';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Incentive edit/adjustment history (immutable audit trail)
-- ═══════════════════════════════════════════════════════════════════════════
-- Every amount change, status change, or correction is recorded here.
-- The incentive record itself is updated; this table preserves the trail.

CREATE TABLE IF NOT EXISTS employee_incentive_history (
  id              SERIAL PRIMARY KEY,
  incentive_id    INTEGER NOT NULL REFERENCES employee_incentives(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  old_values      JSONB,
  new_values      JSONB,
  reason          TEXT,
  changed_by      INTEGER NOT NULL REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_history_record
  ON employee_incentive_history(incentive_id);

COMMIT;
