-- 2026-08-24 — move request-path DDL into a migration
--
-- Two API routes were issuing DDL on the live request path:
--
--   1. src/app/api/loan/route.ts        ALTER TABLE loan_updates ADD COLUMN ...
--      Guarded by a module flag, so it ran once per process — but that once was
--      the first loan save after every cold start, and ALTER TABLE takes an
--      ACCESS EXCLUSIVE lock that blocks concurrent readers of loan_updates.
--
--   2. src/app/api/revenue-intelligence/route.ts   7x CREATE INDEX IF NOT EXISTS
--      Unguarded: seven extra round trips on EVERY request to the revenue
--      dashboard. At ~84ms per Neon round trip that is ~0.6s of pure latency
--      added to a page that is already join-heavy.
--
-- Both are idempotent and already applied on production (ep-long-cloud,
-- verified read-only 2026-08-24: all 7 idx_rev_* indexes present,
-- loan_updates.previous_status and .new_status present). This file exists so a
-- fresh or lagging database can be brought to the same state without the
-- application performing DDL at runtime.
--
-- Safe to re-run.

-- ── 1. loan_updates audit columns ────────────────────────────────────────────
-- loan_updates is append-only: every POST inserts a new row, so the table is the
-- status history. These two columns record the transition each entry represents.
ALTER TABLE loan_updates
  ADD COLUMN IF NOT EXISTS previous_status TEXT,
  ADD COLUMN IF NOT EXISTS new_status TEXT;

-- ── 2. revenue-intelligence supporting indexes ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rev_booking_status_date
  ON booking_applications (booking_status, booking_date);
CREATE INDEX IF NOT EXISTS idx_rev_booking_created_at
  ON booking_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rev_financials_booking_id
  ON booking_financials (booking_id);
CREATE INDEX IF NOT EXISTS idx_rev_loan_booking_id
  ON booking_loan_details (booking_id);
CREATE INDEX IF NOT EXISTS idx_rev_loan_expected_disbursement
  ON booking_loan_details (expected_disbursement_date);
CREATE INDEX IF NOT EXISTS idx_rev_registration_booking_id
  ON booking_registration_details (booking_id);
CREATE INDEX IF NOT EXISTS idx_rev_registration_expected_date
  ON booking_registration_details (expected_registration_date);
