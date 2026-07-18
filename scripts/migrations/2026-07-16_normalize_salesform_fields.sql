-- Migration: Normalize Sales Form fields into real columns on walkin_enquiries
-- Date: 2026-07-16
-- Purpose: Stop storing sales-form data only inside the concatenated follow_ups.message
--          string (regex-parsed on every 5s poll). These columns are written by the
--          /api/sales-form-submit endpoint going forward and backfilled from history
--          by scripts/backfill-salesform-fields.ts.

ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sales_budget TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS use_type TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS planning_purchase TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_planned_confirmed TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lead_interest_status TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS property_type TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS closing_date TIMESTAMPTZ;
