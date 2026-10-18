-- 2026-10-17_hr_employee_code_unique.sql
--
-- Adds a per-organization uniqueness constraint on employee_code.
-- Codes are unique WITHIN each organization, not globally.
-- NULL values are excluded (employees without codes yet).
--
-- Safe to rerun (IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_code_org_unique
  ON users (organization_id, employee_code)
  WHERE employee_code IS NOT NULL;
