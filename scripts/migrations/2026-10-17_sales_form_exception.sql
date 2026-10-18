-- 2026-10-17 Sales Form Exception
--
-- Adds an admin-controlled per-employee flag that exempts a Sales Manager
-- from the "submit sales form before receiving the next walk-in lead"
-- requirement.  Default false = existing behaviour preserved.
--
-- Safe: ADD COLUMN IF NOT EXISTS + DEFAULT false; no data migration needed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sales_form_exception BOOLEAN NOT NULL DEFAULT false;
