-- 2026-08-23_booking_schema_baseline.sql
--
-- The schema that api/booking-applications/route.ts used to create on EVERY
-- request, plus the indexes the booking read paths actually need.
--
--   node scripts/run_sql_migration.js 2026-08-23_booking_schema_baseline.sql
--
-- ── Why this file exists ────────────────────────────────────────────────────
-- `ensureTable()` ran 15 sequential DDL statements — 9 CREATE TABLE IF NOT
-- EXISTS, 5 ALTER TABLE ... ADD COLUMN IF NOT EXISTS, 1 CREATE OR REPLACE VIEW —
-- at the top of GET and POST /api/booking-applications. Every one of them was a
-- no-op after the first deploy, and every one of them cost a full round trip to
-- Neon ap-southeast-1.
--
-- Measured on production data (11 bookings):
--     round trip to Neon .................. 82 ms
--     SQL execution, full booking query ... 0.4 ms
--     15 sequential no-op statements ...... 1,320 ms
--     GET ?lead_id= (with ensureTable) .... 2,690 ms
--     GET /[id]   (same joins, no DDL) .... 190 ms
--
-- So the 3-4 second booking load was not the joins and not the views. It was
-- schema management executing on the request path, one blocking round trip at a
-- time. The ALTER TABLEs additionally take an ACCESS EXCLUSIVE lock on
-- booking_applications, and the CREATE OR REPLACE VIEW takes one on
-- customer_ledger_view — so concurrent booking reads were serialising behind
-- schema locks that changed nothing.
--
-- Every object below was verified to ALREADY EXIST in production before
-- ensureTable() was deleted (see the schema-presence check in the audit report).
-- This migration is therefore a no-op against the current database and exists so
-- the schema has a home in the migration system rather than in a hot code path.
-- It is fully idempotent and safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — tables and columns (verbatim from the deleted ensureTable())
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_applications (
  id                        SERIAL PRIMARY KEY,
  booking_number            VARCHAR(30) UNIQUE,
  lead_id                   INTEGER NOT NULL,
  primary_name              TEXT,
  primary_email             TEXT,
  primary_mobile            TEXT,
  primary_pan               TEXT,
  primary_aadhaar           TEXT,
  primary_aadhaar_front_url TEXT,
  primary_aadhaar_back_url  TEXT,
  primary_pan_url           TEXT,
  primary_occupation        TEXT,
  primary_nationality       TEXT DEFAULT 'Indian',
  joint_name                TEXT,
  joint_email               TEXT,
  joint_mobile              TEXT,
  joint_pan                 TEXT,
  joint_occupation          TEXT,
  joint_nationality         TEXT,
  joint_applicants          JSONB DEFAULT '[]',
  address                   TEXT,
  pin                       TEXT,
  state                     TEXT,
  country                   TEXT DEFAULT 'India',
  property_type             TEXT,
  floor_number              TEXT,
  flat_number               TEXT,
  carpet_area               TEXT,
  consideration_value       TEXT,
  consideration_value_words TEXT,
  parking_details           TEXT,
  payment_details           JSONB DEFAULT '[]',
  witness_name              TEXT,
  witness_aadhaar           TEXT,
  booking_source            TEXT DEFAULT 'Direct',
  direct_source             TEXT,
  channel_partner_name      TEXT,
  channel_partner_contact   TEXT,
  unit_cost                 TEXT,
  sdr                       TEXT,
  gst                       TEXT,
  declaration_accepted      BOOLEAN DEFAULT false,
  terms_accepted            BOOLEAN DEFAULT false,
  consent_accepted          BOOLEAN DEFAULT false,
  signature_data            TEXT,
  application_date          DATE DEFAULT CURRENT_DATE,
  booking_status            TEXT DEFAULT 'Pending',
  created_by                TEXT,
  created_role              TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE booking_applications
  ADD COLUMN IF NOT EXISTS booking_date DATE,
  ADD COLUMN IF NOT EXISTS agreement_value NUMERIC,
  ADD COLUMN IF NOT EXISTS booking_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS booking_remarks TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

CREATE TABLE IF NOT EXISTS booking_financials (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
  token_amount NUMERIC,
  ocr_amount NUMERIC,
  ocr_received_date DATE,
  sdr_amount NUMERIC,
  sdr_payment_date DATE,
  cash_component NUMERIC,
  cash_component_remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE booking_financials
  ADD COLUMN IF NOT EXISTS ocr_payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS ocr_remarks TEXT,
  ADD COLUMN IF NOT EXISTS sdr_status TEXT DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS sdr_remarks TEXT,
  ADD COLUMN IF NOT EXISTS cash_component_date DATE;

CREATE TABLE IF NOT EXISTS booking_loan_details (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
  loan_required BOOLEAN DEFAULT false,
  bank_name TEXT,
  loan_executive TEXT,
  loan_amount NUMERIC,
  sanction_amount NUMERIC,
  sanction_date DATE,
  loan_status TEXT DEFAULT 'Pending',
  expected_disbursement_date DATE,
  actual_disbursement_date DATE,
  expected_disbursement_amount NUMERIC,
  disbursement_amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE booking_loan_details
  ADD COLUMN IF NOT EXISTS loan_type TEXT,
  ADD COLUMN IF NOT EXISTS loan_reference_no TEXT,
  ADD COLUMN IF NOT EXISTS sanction_status TEXT DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS disbursement_status TEXT DEFAULT 'Pending';

CREATE TABLE IF NOT EXISTS booking_registration_details (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
  expected_registration_date DATE,
  actual_registration_date DATE,
  registration_number TEXT,
  registration_remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE booking_registration_details
  ADD COLUMN IF NOT EXISTS registration_status TEXT DEFAULT 'Pending';

-- Stamp duty / registration fee RATES. Mirrors booking_applications.gst_rate:
-- the rate is stored, the amount is derived from agreement_value x rate. The
-- 5 / 1 defaults are the Maharashtra figures the old hardcoded auto-calc used,
-- so backfilled rows keep their existing amounts.
ALTER TABLE booking_registration_details
  ADD COLUMN IF NOT EXISTS stamp_duty_rate NUMERIC DEFAULT 5,
  ADD COLUMN IF NOT EXISTS registration_fee_rate NUMERIC DEFAULT 1;

CREATE TABLE IF NOT EXISTS booking_custom_charges (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
  charge_name TEXT,
  amount NUMERIC,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_pipeline (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER UNIQUE REFERENCES booking_applications(id) ON DELETE CASCADE,
  current_stage TEXT DEFAULT 'Booking',
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_stage_history (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
  stage_name TEXT,
  employee_name TEXT,
  remarks TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id SERIAL PRIMARY KEY,
  booking_id INT UNIQUE REFERENCES booking_applications(id) ON DELETE CASCADE,
  account_type VARCHAR(50) DEFAULT 'customer_receivable',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS financial_ledger (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES financial_accounts(id) ON DELETE CASCADE,
  transaction_type VARCHAR(100),
  transaction_direction VARCHAR(20),
  amount NUMERIC,
  transaction_date TIMESTAMP,
  bank_name VARCHAR(255),
  payment_mode VARCHAR(100),
  reference_number VARCHAR(255),
  status VARCHAR(50),
  affects_revenue VARCHAR(10),
  received_from VARCHAR(100),
  transaction_source VARCHAR(100),
  notes TEXT,
  created_by VARCHAR(255),
  updated_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, transaction_type, transaction_source)
);

-- Was created by ensureHistoryTable() in [id]/route.ts and, separately, inline
-- at the top of [id]/history/route.ts on every history read.
CREATE TABLE IF NOT EXISTS booking_history (
  id SERIAL PRIMARY KEY,
  booking_id INT REFERENCES booking_applications(id) ON DELETE CASCADE,
  updated_by VARCHAR(255) NOT NULL,
  user_role VARCHAR(100) NOT NULL,
  changed_fields JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE VIEW customer_ledger_view AS
SELECT
  fa.booking_id,
  fa.id as account_id,
  ba.agreement_value::numeric AS agreement_value,
  COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received'), 0) AS gross_collection,
  COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received' AND fl.affects_revenue = 'YES'), 0) AS developer_revenue,
  COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received' AND fl.affects_revenue = 'NO'), 0) AS government_charges,
  COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'DEBIT' AND fl.transaction_type = 'refund' AND fl.status = 'Refunded'), 0) AS refunds,
  (
    COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received'), 0)
    -
    COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'DEBIT' AND fl.transaction_type = 'refund' AND fl.status = 'Refunded'), 0)
  ) AS net_collection,
  (
    ba.agreement_value::numeric
    -
    COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received' AND fl.affects_revenue = 'YES'), 0)
  ) AS outstanding_balance
FROM financial_accounts fa
JOIN booking_applications ba ON ba.id = fa.booking_id
LEFT JOIN financial_ledger fl ON fl.account_id = fa.id
GROUP BY fa.booking_id, fa.id, ba.agreement_value;

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — indexes the booking read paths actually use
-- ════════════════════════════════════════════════════════════════════════════
--
-- Chosen from the real query text, not guessed. Only the genuinely missing ones
-- are here; the audit found booking_financials, booking_loan_details and
-- booking_registration_details already carry a (booking_id) index
-- (idx_rev_*_booking_id), so those are deliberately NOT duplicated.

-- The list read: WHERE b.organization_id = $1 ORDER BY b.created_at DESC, b.id DESC.
-- idx_booking_applications_org (organization_id) and idx_rev_booking_created_at
-- (created_at DESC) both exist separately, so the planner had to choose one and
-- then sort. This composite matches the whole clause.
CREATE INDEX IF NOT EXISTS idx_booking_applications_org_created
    ON public.booking_applications (organization_id, created_at DESC, id DESC);

-- The per-lead read, which is how the UI actually fetches a booking:
-- WHERE b.organization_id = $1 AND b.lead_id = $2.
-- There was NO index on lead_id at all — every ?lead_id= lookup was a scan.
CREATE INDEX IF NOT EXISTS idx_booking_applications_org_lead
    ON public.booking_applications (organization_id, lead_id);

-- The custom-charges aggregation runs as a correlated subquery per booking row
-- (SELECT json_agg(...) FROM booking_custom_charges WHERE booking_id = b.id) and
-- booking_total_cost_view runs SUM(amount) over the same predicate. Only an
-- organization_id index existed, which does not serve either.
CREATE INDEX IF NOT EXISTS idx_booking_custom_charges_booking_id
    ON public.booking_custom_charges (booking_id);

-- customer_ledger_view: LEFT JOIN financial_ledger fl ON fl.account_id = fa.id,
-- then GROUP BY. account_id had no index — only the (account_id,
-- transaction_type, transaction_source) unique constraint, whose leading column
-- does serve this, but only for equality on account_id. Kept anyway? No: that
-- unique index IS usable for account_id lookups, so a second one would be
-- redundant. Deliberately omitted.

-- booking_total_cost_view's two correlated subqueries filter financial_ledger on
-- (status, transaction_direction, received_from) after joining by account_id, so
-- the existing unique index leads correctly and nothing further is justified.

-- Documents and milestones are read per booking by the lazy endpoints.
CREATE INDEX IF NOT EXISTS idx_booking_documents_booking_id
    ON public.booking_documents (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_payment_milestones_booking_id
    ON public.booking_payment_milestones (booking_id, milestone_order);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking_id
    ON public.booking_history (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_stage_history_booking_id
    ON public.booking_stage_history (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_tds_records_booking_id
    ON public.booking_tds_records (booking_id);

COMMIT;
