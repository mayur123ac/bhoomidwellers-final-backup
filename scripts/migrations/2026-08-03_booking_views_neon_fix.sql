-- 2026-08-03_booking_views_neon_fix.sql
--
-- FIXES: booking form shows every lead / financial field as "—" in production,
-- while the same booking renders correctly on local.
--
-- CAUSE: `booking_total_cost_view` is READ by five files —
--   src/lib/bookingQuery.ts
--   src/app/api/booking-applications/route.ts
--   src/app/api/booking-applications/[id]/route.ts
--   src/app/api/booking-applications/[id]/payment-summary/route.ts
--   src/app/api/booking-applications/[id]/receipt/route.ts
-- and is CREATED by none of them. `ensureTable()` creates customer_ledger_view
-- but never this one, so it only exists where somebody made it by hand — local.
--
-- On Neon the view is absent, so `LEFT JOIN booking_total_cost_view tcv` makes
-- the whole SELECT fail with "relation does not exist". The route catches it,
-- returns 500, and the UI receives no booking at all — which is why EVERY field
-- (lead name, phone, token amount, OCR) renders "—" while Lead Number still
-- shows, because that falls back to a value the page already had.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE OR REPLACE VIEW. Safe to
-- re-run, safe on a database that is already correct. Adds and defines only —
-- nothing is dropped or backfilled.
--
-- Run in pgAdmin against Neon, then reload the booking page.

BEGIN;

-- ── 1. Columns the view and the booking query depend on ────────────────────
-- The view cannot be created if any of these are missing, so they come first.
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS gst_rate            NUMERIC;
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS gst_amount          NUMERIC;
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS gst_paid            NUMERIC;
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS gst_status          TEXT DEFAULT 'Pending';
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS legal_charges       NUMERIC;
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS maintenance_deposit NUMERIC;
ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS possession_charges  NUMERIC;

ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS stamp_duty_amount           NUMERIC;
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS stamp_duty_paid_date        DATE;
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS stamp_duty_status           TEXT DEFAULT 'Pending';
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS stamp_duty_payment_mode     TEXT;
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS stamp_duty_receipt_no       TEXT;
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS registration_fee_amount     NUMERIC;
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS registration_fee_paid_date  DATE;
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS registration_fee_status     TEXT DEFAULT 'Pending';
ALTER TABLE booking_registration_details ADD COLUMN IF NOT EXISTS registration_fee_payment_mode TEXT;

-- Selected by the booking query (l.*), so their absence breaks it too.
ALTER TABLE booking_loan_details ADD COLUMN IF NOT EXISTS interest_rate      NUMERIC;
ALTER TABLE booking_loan_details ADD COLUMN IF NOT EXISTS loan_tenure_months NUMERIC;
ALTER TABLE booking_loan_details ADD COLUMN IF NOT EXISTS emi_start_date     DATE;
ALTER TABLE booking_loan_details ADD COLUMN IF NOT EXISTS payment_type       TEXT DEFAULT 'Pre-EMI';
ALTER TABLE booking_loan_details ADD COLUMN IF NOT EXISTS pre_emi_amount     NUMERIC;
ALTER TABLE booking_loan_details ADD COLUMN IF NOT EXISTS emi_amount         NUMERIC;

-- ── 2. The missing view ────────────────────────────────────────────────────
-- Copied verbatim from the working local definition (pg_get_viewdef), so
-- production computes cost exactly as local does.
CREATE OR REPLACE VIEW booking_total_cost_view AS
SELECT b.id AS booking_id,
       b.agreement_value,
       COALESCE(b.gst_amount, 0::numeric) AS gst_amount,
       COALESCE(b.gst_paid,   0::numeric) AS gst_paid,
       COALESCE(r.stamp_duty_amount, f.sdr_amount, 0::numeric) AS stamp_duty,
       COALESCE(r.registration_fee_amount, 0::numeric)         AS registration_fee,
       COALESCE(b.legal_charges,       0::numeric) AS legal_charges,
       COALESCE(b.maintenance_deposit, 0::numeric) AS maintenance_deposit,
       COALESCE(b.possession_charges,  0::numeric) AS possession_charges,
       COALESCE((SELECT sum(cc.amount) FROM booking_custom_charges cc
                  WHERE cc.booking_id = b.id), 0::numeric) AS custom_charges_total,
       COALESCE(b.agreement_value, 0::numeric)
         + COALESCE(b.gst_amount, 0::numeric)
         + COALESCE(r.stamp_duty_amount, f.sdr_amount, 0::numeric)
         + COALESCE(r.registration_fee_amount, 0::numeric)
         + COALESCE(b.legal_charges, 0::numeric)
         + COALESCE(b.maintenance_deposit, 0::numeric)
         + COALESCE(b.possession_charges, 0::numeric)
         + COALESCE((SELECT sum(cc.amount) FROM booking_custom_charges cc
                      WHERE cc.booking_id = b.id), 0::numeric) AS total_cost_to_customer,
       COALESCE(b.agreement_value, 0::numeric)
         + COALESCE(b.gst_amount, 0::numeric)
         - COALESCE(l.sanction_amount, 0::numeric) AS required_own_contribution,
       COALESCE((SELECT sum(fl.amount)
                   FROM financial_ledger fl
                   JOIN financial_accounts fa ON fa.id = fl.account_id
                  WHERE fa.booking_id = b.id
                    AND fl.transaction_direction::text = 'CREDIT'
                    AND fl.status::text = 'Received'
                    AND fl.received_from::text = 'Customer'), 0::numeric) AS actual_own_contribution,
       COALESCE((SELECT sum(fl.amount)
                   FROM financial_ledger fl
                   JOIN financial_accounts fa ON fa.id = fl.account_id
                  WHERE fa.booking_id = b.id
                    AND fl.transaction_direction::text = 'CREDIT'
                    AND fl.status::text = 'Received'
                    AND fl.received_from::text = 'Bank'), 0::numeric) AS total_loan_disbursed
  FROM booking_applications b
  LEFT JOIN booking_financials           f ON f.booking_id = b.id
  LEFT JOIN booking_loan_details         l ON l.booking_id = b.id
  LEFT JOIN booking_registration_details r ON r.booking_id = b.id;

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- Expect BOTH views. If booking_total_cost_view is absent, the fix did not apply.
SELECT table_name FROM information_schema.views
 WHERE table_schema = 'public'
   AND table_name IN ('booking_total_cost_view', 'customer_ledger_view')
 ORDER BY 1;

-- Expect one row per booking, no error. This is the join that was failing.
-- SELECT booking_id, total_cost_to_customer FROM booking_total_cost_view LIMIT 5;
