-- 2026-10-18_hr_phase3_payroll.sql
--
-- Phase 3: Automated Payroll — monthly payroll periods, employee records,
-- adjustments, and payment tracking.
--
-- Depends on: users, organizations, employee_salary_history, employee_incentives
--
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE used throughout).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. payroll_periods — one row per organization per month
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payroll_periods (
  id                SERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  period_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  generated_at      TIMESTAMPTZ DEFAULT now(),
  generated_by      INTEGER REFERENCES users(id),
  submitted_at      TIMESTAMPTZ,
  submitted_by      INTEGER REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  approved_by       INTEGER REFERENCES users(id),
  rejected_at       TIMESTAMPTZ,
  rejected_by       INTEGER REFERENCES users(id),
  rejection_reason  TEXT,
  total_gross       NUMERIC(14,2) DEFAULT 0,
  total_deductions  NUMERIC(14,2) DEFAULT 0,
  total_net         NUMERIC(14,2) DEFAULT 0,
  employee_count    INTEGER DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT payroll_period_dates CHECK (period_end >= period_start)
);

-- One payroll period per org per month
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_periods_org_month
  ON payroll_periods (organization_id, period_year, period_month);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. payroll_records — one row per employee per period
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payroll_records (
  id                SERIAL PRIMARY KEY,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- Salary snapshot (from employee_salary_history at generation time)
  base_salary       NUMERIC(14,2) NOT NULL DEFAULT 0,
  salary_history_id INTEGER REFERENCES employee_salary_history(id),

  -- Calculated fields
  working_days      INTEGER NOT NULL DEFAULT 0,
  present_days      INTEGER NOT NULL DEFAULT 0,
  leave_days        INTEGER NOT NULL DEFAULT 0,
  holiday_days      INTEGER NOT NULL DEFAULT 0,
  week_off_days     INTEGER NOT NULL DEFAULT 0,
  absent_days       INTEGER NOT NULL DEFAULT 0,

  -- Amounts
  gross_salary      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_additions   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable       NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Incentive snapshot
  incentive_total   NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Status (follows period status but can have individual exceptions)
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'exception', 'submitted', 'approved', 'rejected')),
  exception_reason  TEXT,

  -- Approval snapshot (locked on approval)
  calculation_snapshot JSONB,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT payroll_record_net CHECK (net_payable = gross_salary + total_additions - total_deductions)
);

-- One record per employee per period
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_records_period_user
  ON payroll_records (payroll_period_id, user_id);

CREATE INDEX IF NOT EXISTS idx_payroll_records_org
  ON payroll_records (organization_id);

CREATE INDEX IF NOT EXISTS idx_payroll_records_user
  ON payroll_records (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. payroll_adjustments — itemized additions/deductions per record
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id                SERIAL PRIMARY KEY,
  payroll_record_id INTEGER NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('addition', 'deduction')),
  category          TEXT NOT NULL,
  description       TEXT,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  source            TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'incentive', 'system')),
  source_id         INTEGER,
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_record
  ON payroll_adjustments (payroll_record_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. payroll_payments — actual payment tracking (separate from approval)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payroll_payments (
  id                SERIAL PRIMARY KEY,
  payroll_record_id INTEGER NOT NULL REFERENCES payroll_records(id) ON DELETE RESTRICT,
  organization_id   UUID NOT NULL,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date      DATE NOT NULL,
  payment_reference TEXT,
  payment_method    TEXT,
  status            TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed', 'reversed')),
  reversal_reason   TEXT,
  reversed_at       TIMESTAMPTZ,
  reversed_by       INTEGER REFERENCES users(id),
  recorded_by       INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_record
  ON payroll_payments (payroll_record_id);

-- Prevent duplicate payment references within an org
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_payments_ref_unique
  ON payroll_payments (organization_id, payment_reference)
  WHERE payment_reference IS NOT NULL AND status = 'completed';

COMMIT;
