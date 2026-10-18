-- 2026-10-18_hr_phase3_individual_approval.sql
--
-- Adds individual record-level submission and approval columns to payroll_records.
-- The status column and its CHECK constraint already support 'submitted', 'approved',
-- 'rejected' — only the actor/timestamp metadata is missing.
--
-- Idempotent: all operations use IF NOT EXISTS or conditional checks.

BEGIN;

-- Submission tracking
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS submitted_by  INTEGER REFERENCES users(id);

-- Approval tracking
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS approved_by   INTEGER REFERENCES users(id);

-- Rejection tracking
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS rejected_by   INTEGER REFERENCES users(id);
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Index for Admin approval inbox: submitted records across org
CREATE INDEX IF NOT EXISTS idx_payroll_records_pending_approval
  ON payroll_records (organization_id, status)
  WHERE status = 'submitted';

COMMIT;
