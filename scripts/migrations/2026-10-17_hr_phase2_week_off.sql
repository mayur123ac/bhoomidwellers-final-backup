-- 2026-10-17_hr_phase2_week_off.sql
--
-- Phase 2, Migration 3: Employee weekly-off schedules.
--
-- Per-employee, effective-dated. No default Sunday seeding.
-- When no rows exist for an employee, the system shows "Not configured".
--
-- Additive only. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS employee_week_off_pattern (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT weekoff_dates_valid CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Only one active pattern per employee per day-of-week
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekoff_active
  ON employee_week_off_pattern(user_id, organization_id, day_of_week)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_weekoff_lookup
  ON employee_week_off_pattern(user_id, organization_id)
  WHERE effective_to IS NULL;

COMMIT;
