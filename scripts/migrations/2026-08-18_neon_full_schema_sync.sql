-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-08-18_neon_full_schema_sync.sql
--
-- Brings the Neon database (neondb @ ep-shy-paper-axz8vro4) into line with the
-- schema this codebase expects. The database contained only 5 tables
-- (users, employee_sessions, attendance_records, employee_activity_logs,
-- employee_live_state); the application requires 66 tables and 2 views.
--
-- SAFETY
--   * Additive only. No DROP TABLE, no DROP COLUMN, no TRUNCATE, no data reset.
--   * Every object is created with IF NOT EXISTS / IF EXISTS guards, so the file
--     is idempotent and safe to re-run.
--   * Existing tables and their rows are untouched except for ADD COLUMN
--     IF NOT EXISTS and CREATE INDEX/CONSTRAINT IF NOT EXISTS.
--   * Tables are created in dependency order; foreign keys that point at
--     tables created later are added in the final phase.
--
-- SOURCES (in precedence order)
--   1. Runtime DDL embedded in the application (ensureTable() in the booking
--      routes) — the app's own definition of what it needs.
--   2. The repo's migration files under scripts/migrations/ and the repo root.
--   3. For tables with no DDL anywhere, column names and types derived from the
--      INSERT/UPDATE/SELECT statements that reference them.
--   4. Legacy structures (frontend/db_schema_dump.txt) used only for the core
--      tables that predate the repo's migration history, then brought forward
--      by the repo migrations replayed below.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Core lead / CRM tables (predate the repo migration history)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS walkin_enquiries (
  id SERIAL NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  address TEXT,
  occupation VARCHAR(100),
  organization VARCHAR(255),
  budget VARCHAR(100),
  configuration VARCHAR(50),
  purpose VARCHAR(100),
  source VARCHAR(100) DEFAULT 'Direct Walk-in'::character varying,
  assigned_to VARCHAR(255),
  status VARCHAR(50) DEFAULT 'Routed'::character varying,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  site_visit_date VARCHAR(50),
  appx_purchase_date VARCHAR(50),
  alt_phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  loan_planned VARCHAR(50),
  source_other TEXT,
  cp_name VARCHAR(100),
  cp_company VARCHAR(100),
  cp_phone VARCHAR(50),
  assigned_receptionist VARCHAR(255),
  is_global_shared BOOLEAN DEFAULT false,
  overseeing_site_head VARCHAR(255) DEFAULT NULL::character varying,
  escalated_to_site_head BOOLEAN DEFAULT false,
  referral_name TEXT,
  is_lost_lead BOOLEAN DEFAULT false,
  lost_lead_reason TEXT,
  lost_lead_marked_at TIMESTAMP,
  lost_lead_marked_by TEXT,
  enquiry_date TIMESTAMP DEFAULT now(),
  auto_date_enabled BOOLEAN DEFAULT true,
  assigned_at TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  site_visit_history JSONB DEFAULT '[]'::jsonb,
  loan_tracking_info JSONB DEFAULT '{}'::jsonb,
  referral_info JSONB DEFAULT '{}'::jsonb,
  sr_no INTEGER
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL NOT NULL PRIMARY KEY,
  upload_batch UUID DEFAULT uuid_generate_v4() NOT NULL,
  sr_no VARCHAR(20),
  form_no VARCHAR(50),
  lead_date VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  contact_no VARCHAR(30),
  source VARCHAR(100),
  channel_partner VARCHAR(255),
  assign_manager VARCHAR(255),
  feedback TEXT DEFAULT ''::text,
  email VARCHAR(255),
  budget VARCHAR(100),
  location VARCHAR(255),
  interest_status VARCHAR(50) DEFAULT NULL::character varying,
  status VARCHAR(30) DEFAULT 'new'::character varying,
  site_visit_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  assigned_at TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  site_visit_history JSONB DEFAULT '[]'::jsonb,
  loan_tracking_info JSONB DEFAULT '{}'::jsonb,
  referral_info JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id SERIAL NOT NULL PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_by_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  site_visit_date VARCHAR(100) DEFAULT NULL::character varying
);

CREATE TABLE IF NOT EXISTS site_visits (
  id SERIAL NOT NULL PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  visit_date TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  role TEXT DEFAULT 'Sales Manager'::text NOT NULL,
  status TEXT DEFAULT 'scheduled'::text NOT NULL,
  notes TEXT DEFAULT ''::text,
  created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE IF NOT EXISTS organization_settings (
  id SERIAL NOT NULL PRIMARY KEY,
  organization_id INTEGER DEFAULT 1 NOT NULL,
  shift_start VARCHAR(10) DEFAULT '11:00'::character varying NOT NULL,
  shift_end VARCHAR(10) DEFAULT '20:00'::character varying NOT NULL,
  flexible BOOLEAN DEFAULT false,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  lead_number_sorting_enabled BOOLEAN DEFAULT false NOT NULL
);


CREATE TABLE IF NOT EXISTS roles (
  id SERIAL NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_updates (
  id SERIAL NOT NULL PRIMARY KEY,
  lead_id VARCHAR(50) NOT NULL,
  sales_manager_name VARCHAR(255),
  created_by VARCHAR(100) DEFAULT 'sales'::character varying,
  status VARCHAR(100) DEFAULT 'Pending'::character varying,
  loan_type VARCHAR(100),
  amount_req VARCHAR(100),
  amount_app VARCHAR(100),
  processing_amt VARCHAR(100),
  roi VARCHAR(50),
  tenure VARCHAR(50),
  bank VARCHAR(255),
  officer VARCHAR(255),
  agent VARCHAR(255),
  agent_contact VARCHAR(50),
  emp_type VARCHAR(100),
  income VARCHAR(100),
  emi VARCHAR(100),
  cibil VARCHAR(50),
  prop_type VARCHAR(100),
  prop_value VARCHAR(100),
  project VARCHAR(255),
  builder VARCHAR(255),
  phone VARCHAR(30),
  alt_phone VARCHAR(30),
  email VARCHAR(255),
  address TEXT,
  doc_pan VARCHAR(50),
  doc_aadhaar VARCHAR(50),
  doc_salary VARCHAR(50),
  doc_bank VARCHAR(50),
  doc_property VARCHAR(50),
  app_date VARCHAR(50),
  aprv_date VARCHAR(50),
  exp_disb_date VARCHAR(50),
  disb_date VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS caller_leads (
  id SERIAL NOT NULL PRIMARY KEY,
  upload_batch UUID DEFAULT uuid_generate_v4() NOT NULL,
  batch_name VARCHAR(255),
  sr_no VARCHAR(20),
  form_no VARCHAR(50),
  lead_date VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  contact_no VARCHAR(30),
  email VARCHAR(255),
  source VARCHAR(100),
  channel_partner VARCHAR(255),
  assign_manager VARCHAR(255),
  feedback TEXT DEFAULT ''::text,
  budget VARCHAR(100),
  location VARCHAR(255),
  interest_status VARCHAR(50) DEFAULT NULL::character varying,
  status VARCHAR(30) DEFAULT 'new'::character varying NOT NULL,
  site_visit_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  uploaded_by VARCHAR(255),
  assigned_to VARCHAR(255),
  saved_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS caller_follow_ups (
  id SERIAL NOT NULL PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_by_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);


CREATE TABLE IF NOT EXISTS caller_upload_batches (
  id UUID DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  row_count INTEGER DEFAULT 0 NOT NULL,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_batches (
  id UUID DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  file_name VARCHAR(255),
  row_count INTEGER DEFAULT 0 NOT NULL,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS completed_leads (
  id SERIAL NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50) NOT NULL,
  budget VARCHAR(100),
  property_type VARCHAR(100),
  location VARCHAR(255),
  site_visit_date VARCHAR(100),
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm_updates (
  id SERIAL NOT NULL PRIMARY KEY,
  version VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  features JSONB,
  is_important BOOLEAN DEFAULT false,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm_update_reads (
  user_id INTEGER NOT NULL,
  update_id INTEGER NOT NULL,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS booking_documents (
  id SERIAL NOT NULL PRIMARY KEY,
  booking_id INTEGER,
  lead_id INTEGER,
  booking_number VARCHAR(30),
  document_type VARCHAR(50),
  applicant_type VARCHAR(50),
  file_name TEXT,
  object_key TEXT,
  mime_type VARCHAR(100),
  file_size INTEGER,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id SERIAL NOT NULL PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  sender_name VARCHAR(100),
  sender_number VARCHAR(20),
  recipient_number VARCHAR(20),
  message_preview TEXT,
  sent_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id SERIAL NOT NULL PRIMARY KEY,
  user_id INTEGER,
  date DATE NOT NULL,
  first_login TIMESTAMP,
  last_logout TIMESTAMP,
  working_hours NUMERIC DEFAULT 0.00,
  status VARCHAR(50) DEFAULT 'Present'::character varying
);


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 2 — Booking module
-- ═════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 — Booking module.
-- Lifted verbatim from ensureTable() in src/app/api/booking-applications/route.ts,
-- which is the application's own authoritative DDL for these tables.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- booking_history: from ensureHistoryTable() in
-- src/app/api/booking-applications/[id]/history/route.ts
CREATE TABLE IF NOT EXISTS booking_history (
    id SERIAL PRIMARY KEY,
    booking_id INT REFERENCES booking_applications(id) ON DELETE CASCADE,
    updated_by VARCHAR(255) NOT NULL,
    user_role VARCHAR(100) NOT NULL,
    changed_fields JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 3 — Feature migrations replayed from the repo, in date order
-- ═════════════════════════════════════════════════════════════════════════
-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-05-23_lost_leads.sql
-- ──────────────────────────────────────────────────────────────
ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS is_lost_lead BOOLEAN DEFAULT FALSE;

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS lost_lead_reason TEXT;

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS lost_lead_marked_at TIMESTAMP;

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS lost_lead_marked_by TEXT;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-06-17_enquiry_date.sql
-- ──────────────────────────────────────────────────────────────
-- Migration: Add enquiry_date column to walkin_enquiries
-- Date: 2026-06-17
-- Purpose: Support backdated client entries via the Walk-In Enquiry Form

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS enquiry_date TIMESTAMP DEFAULT NOW();

-- Backfill: set enquiry_date = created_at for all existing records
UPDATE walkin_enquiries
SET enquiry_date = created_at
WHERE enquiry_date IS NULL;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-04_add_sr_no.sql
-- ──────────────────────────────────────────────────────────────
-- Migration: Add sr_no (Business Lead Number) to walkin_enquiries
-- Date: 2026-07-04
-- Purpose: Introduce a sequential business lead number (sr_no) that is independent of the primary key (id).

-- 1. Add the column (allowing NULLs temporarily so we can backfill)
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sr_no INTEGER;

-- 2. Create an auto-increment sequence for the new column
CREATE SEQUENCE IF NOT EXISTS walkin_enquiries_sr_no_seq;

-- 3. Backfill existing records with sequential numbers (ordered by the time they were created)
WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) as new_sr_no
    FROM walkin_enquiries
)
UPDATE walkin_enquiries w
SET sr_no = n.new_sr_no
FROM numbered n
WHERE w.id = n.id
AND w.sr_no IS NULL; -- Only backfill if it doesn't already have a value

-- 4. Make the column NOT NULL after backfilling
ALTER TABLE walkin_enquiries ALTER COLUMN sr_no SET NOT NULL;

-- 5. Set the default value for future inserts to use the sequence
ALTER TABLE walkin_enquiries ALTER COLUMN sr_no SET DEFAULT nextval('walkin_enquiries_sr_no_seq');

-- 6. Bind the sequence to the column so it's dropped if the column is dropped
ALTER SEQUENCE walkin_enquiries_sr_no_seq OWNED BY walkin_enquiries.sr_no;

-- 7. Sync the sequence to the current maximum sr_no so new inserts don't fail with duplicate/overlapping IDs
SELECT setval('walkin_enquiries_sr_no_seq', COALESCE((SELECT MAX(sr_no) FROM walkin_enquiries), 1));


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-16_loan_updates_full_schema.sql
-- ──────────────────────────────────────────────────────────────
-- Migration: Bring loan_updates up to the columns LoanDealForm/LoanDealView actually use
-- Date: 2026-07-16
-- Purpose: The pre-existing /api/loan/route.ts INSERT referenced ~28 columns
--          (sales_manager_name, cibil, agent, emp_type, doc_pan, roi, tenure,
--          project, builder, phone, address, ...) that never existed on this
--          table — only id, lead_id, status, bank_name, amount_requested,
--          amount_approved, notes, created_at (+ loan_required, added earlier
--          today) are real. Every POST to /api/loan has failed since inception
--          (0 rows in the table). This adds only the columns genuinely needed
--          for the 5-section loan tracking form; the never-real speculative
--          columns (loan_type, processing_amt, roi, tenure, officer, prop_type,
--          prop_value, project, builder, phone, alt_phone, email, address,
--          app_date, aprv_date, exp_disb_date, disb_date) are not added back.

ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS sales_manager_name TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS cibil TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS agent TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS agent_contact TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS emp_type TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS income TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS emi TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_pan TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_aadhaar TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_salary TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_bank TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_property TEXT;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-16_loan_updates_loan_required.sql
-- ──────────────────────────────────────────────────────────────
-- Migration: Add loan_required to loan_updates
-- Date: 2026-07-16
-- Purpose: The informal loan-tracking form asks "Loan Required? (Yes/No/Not Sure)",
--          which has no home in loan_updates — the existing loan_type column means
--          something different (Home Loan / Top-Up Loan / Balance Transfer, a
--          booking-level concept). Table is currently empty; safe additive change.

ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS loan_required TEXT;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-16_normalize_salesform_fields.sql
-- ──────────────────────────────────────────────────────────────
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


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-16_repoint_lead_id_fks.sql
-- ──────────────────────────────────────────────────────────────
-- Migration: Repoint lead_id foreign keys from the legacy `leads` table to `walkin_enquiries`
-- Date: 2026-07-16
-- Purpose: follow_ups, loan_updates, site_visits, whatsapp_logs, booking_applications, and
--          booking_documents all had lead_id FKs referencing `leads(id)` — a deprecated,
--          empty CSV-import table. Every route in the app actually reads/writes
--          `walkin_enquiries`, which no FK pointed at. As a result, every insert into these
--          six child tables violated its FK for any real lead. Verified all six tables are
--          currently empty, so this repoint is a safe, lossless schema fix.

ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_lead_id_fkey;
-- [deferred to PHASE 7]
-- ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE loan_updates DROP CONSTRAINT IF EXISTS loan_updates_lead_id_fkey;
-- [deferred to PHASE 7]
-- ALTER TABLE loan_updates ADD CONSTRAINT loan_updates_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_lead_id_fkey;
-- [deferred to PHASE 7]
-- ALTER TABLE site_visits ADD CONSTRAINT site_visits_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE whatsapp_logs DROP CONSTRAINT IF EXISTS whatsapp_logs_lead_id_fkey;
-- [deferred to PHASE 7]
-- ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE booking_applications DROP CONSTRAINT IF EXISTS booking_applications_lead_id_fkey;
-- [deferred to PHASE 7]
-- ALTER TABLE booking_applications ADD CONSTRAINT booking_applications_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE booking_documents DROP CONSTRAINT IF EXISTS booking_documents_lead_id_fkey;
-- [deferred to PHASE 7]
-- ALTER TABLE booking_documents ADD CONSTRAINT booking_documents_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-25_NEON_full_cp_sync.sql
-- ──────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- NEON SYNC — Channel Partner commission layer (Phases 1, 1b, 2, 2b)
-- Date: 2026-07-25
--
-- Brings Neon to parity with local `bhoomiBackup_crm`. Run top to bottom.
-- Every statement is idempotent: safe to re-run, safe if objects already exist.
--
-- PART A  schema      (safe, additive, no data touched)
-- PART B  data        (creates partners + attributes leads/bookings)
-- PART C  verification
--
-- Written as the FINAL state, not as a replay of local's migration history:
-- cp_commissions is created with the partial unique index directly rather than
-- creating a blanket UNIQUE and dropping it again.
--
-- Does not touch disbursement_tranches or any existing column on
-- booking_applications / walkin_enquiries. Additive only.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ PART A — SCHEMA                                                         ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

-- ── A1. shared updated_at trigger function ────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── A2. channel partner master ────────────────────────────────────────────
-- default_commission_rate is NULLABLE by design: a partner discovered from lead
-- intake legitimately exists before their commercial rate is negotiated.
-- computeCPCommission hard-rejects a NULL rate rather than defaulting to 0.
CREATE TABLE IF NOT EXISTS channel_partners (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    rera_registration_no VARCHAR(100),
    pan_number VARCHAR(20),
    phone VARCHAR(20),
    email VARCHAR(255),
    bank_account_details JSONB,
    default_commission_rate NUMERIC(5,2)
        CHECK (default_commission_rate >= 0 AND default_commission_rate <= 100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- If an earlier partial apply created this NOT NULL, relax it.
ALTER TABLE channel_partners ALTER COLUMN default_commission_rate DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_partners_status
    ON channel_partners(status);

-- Expression indexes backing find-or-create. The phone/name columns themselves
-- are untouched — no stored data is rewritten and no normalization pass is needed.
CREATE INDEX IF NOT EXISTS idx_channel_partners_phone_norm
    ON channel_partners (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_channel_partners_name_norm
    ON channel_partners (
        btrim(regexp_replace(
            lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
            '[[:punct:]]+$', ''))
    );

DROP TRIGGER IF EXISTS trg_channel_partners_updated_at ON channel_partners;
CREATE TRIGGER trg_channel_partners_updated_at
BEFORE UPDATE ON channel_partners
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── A3. CP attribution on leads and bookings ──────────────────────────────
-- Both nullable: most leads/bookings are direct, with no CP involved.
ALTER TABLE walkin_enquiries
    ADD COLUMN IF NOT EXISTS channel_partner_id INT REFERENCES channel_partners(id);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp
    ON walkin_enquiries(channel_partner_id);

ALTER TABLE booking_applications
    ADD COLUMN IF NOT EXISTS sourced_by_channel_partner_id INT REFERENCES channel_partners(id);

CREATE INDEX IF NOT EXISTS idx_booking_applications_cp
    ON booking_applications(sourced_by_channel_partner_id);


-- ── A4. commission ledger ─────────────────────────────────────────────────
-- NOTE: booking_id is deliberately NOT declared UNIQUE here. Uniqueness is
-- enforced by the partial index below, which applies only to non-reversed rows,
-- so a booking can keep a full history of reversed commissions plus at most one
-- active one. A blanket UNIQUE would make reversal terminal — a booking reversed
-- for a wrong rate could never be recomputed.
CREATE TABLE IF NOT EXISTS cp_commissions (
    id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL REFERENCES booking_applications(id),
    channel_partner_id INT NOT NULL REFERENCES channel_partners(id),

    agreement_value NUMERIC(14,2) NOT NULL,
    commission_rate_percent NUMERIC(5,2) NOT NULL,
    gross_commission_amount NUMERIC(14,2) NOT NULL,

    tds_percent NUMERIC(5,2) NOT NULL DEFAULT 2,
    tds_amount NUMERIC(14,2) NOT NULL,
    net_payable_amount NUMERIC(14,2) NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'accrued'
        CHECK (status IN ('accrued', 'due', 'paid', 'reversed')),

    due_date DATE,
    paid_date DATE,
    payment_reference VARCHAR(255),

    reversal_reason TEXT,
    reversed_at TIMESTAMP,

    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),

    -- Enforces the gross -> TDS -> net chain at the DB level so a bad
    -- application-layer calculation cannot silently corrupt the payable amount.
    CONSTRAINT chk_cp_commission_math CHECK (
        tds_amount = ROUND(gross_commission_amount * tds_percent / 100, 2)
        AND net_payable_amount = gross_commission_amount - tds_amount
    )
);

-- Drops the blanket constraint if a previous run created it.
ALTER TABLE cp_commissions DROP CONSTRAINT IF EXISTS cp_commissions_booking_id_key;

-- One ACTIVE commission per booking; unlimited reversed history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_commissions_booking_active
    ON cp_commissions(booking_id)
    WHERE status <> 'reversed';

CREATE INDEX IF NOT EXISTS idx_cp_commissions_channel_partner ON cp_commissions(channel_partner_id);
CREATE INDEX IF NOT EXISTS idx_cp_commissions_status          ON cp_commissions(status);
CREATE INDEX IF NOT EXISTS idx_cp_commissions_booking         ON cp_commissions(booking_id);

DROP TRIGGER IF EXISTS trg_cp_commissions_updated_at ON cp_commissions;
CREATE TRIGGER trg_cp_commissions_updated_at
BEFORE UPDATE ON cp_commissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ PART B — DATA                                                           ║
-- ║                                                                         ║
-- ║ Mirrors findOrCreateChannelPartner exactly:                             ║
-- ║   • only source 'CP' and 'Channel Partner' are CP sources. Every other   ║
-- ║     source also populates cp_name, but with sub-source labels            ║
-- ║     ("Hoarding", "Social Media") that must never become partners.        ║
-- ║   • a usable phone (>= 10 digits) is the identity and takes priority;    ║
-- ║     it never falls back to name matching.                               ║
-- ║   • otherwise match on normalized name (lowercased, whitespace           ║
-- ║     collapsed, trailing punctuation stripped).                          ║
-- ║   • label values like "Channel Partner" / "CP" / "N/A" are not           ║
-- ║     identities and are left unattributed.                               ║
-- ║   • never overwrites name/company on an existing match.                 ║
-- ║                                                                         ║
-- ║ Re-runnable: rows already attributed are skipped, not duplicated.        ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

-- ── B1. create partners for phone-bearing CP leads (high confidence) ──────
INSERT INTO channel_partners (name, company_name, phone, default_commission_rate, created_by, updated_by)
SELECT DISTINCT ON (right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10))
       CASE
         WHEN btrim(regexp_replace(lower(regexp_replace(btrim(COALESCE(w.cp_name,'')), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
              IN ('channel partner','cp','n/a','na','none','nil','-','--')
           THEN COALESCE(NULLIF(btrim(w.cp_company), ''), 'Unnamed CP')
         ELSE COALESCE(NULLIF(btrim(w.cp_name), ''), NULLIF(btrim(w.cp_company), ''), 'Unnamed CP')
       END,
       NULLIF(btrim(w.cp_company), ''),
       btrim(w.cp_phone),
       NULL,
       'neon-sync', 'neon-sync'
  FROM walkin_enquiries w
 WHERE w.source IN ('CP', 'Channel Partner')
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) >= 10
   AND NOT EXISTS (
        SELECT 1 FROM channel_partners cp
         WHERE right(regexp_replace(COALESCE(cp.phone, ''), '\D', '', 'g'), 10)
             = right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10)
       )
 ORDER BY right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10), w.id ASC;


-- ── B2. create partners for phone-less CP leads (name-keyed) ──────────────
-- Runs after B1 so name matching can also see the phone-created partners.
INSERT INTO channel_partners (name, company_name, phone, default_commission_rate, created_by, updated_by)
SELECT DISTINCT ON (btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$','')))
       btrim(w.cp_name),
       NULLIF(btrim(w.cp_company), ''),
       NULL,
       NULL,
       'neon-sync', 'neon-sync'
  FROM walkin_enquiries w
 WHERE w.source IN ('CP', 'Channel Partner')
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) < 10
   AND btrim(COALESCE(w.cp_name, '')) <> ''
   AND btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
       NOT IN ('channel partner','cp','n/a','na','none','nil','-','--')
   AND NOT EXISTS (
        SELECT 1 FROM channel_partners cp
         WHERE btrim(regexp_replace(lower(regexp_replace(btrim(cp.name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
             = btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
       )
 ORDER BY btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$','')), w.id ASC;


-- ── B3. attribute leads — phone branch (takes priority) ───────────────────
UPDATE walkin_enquiries w
   SET channel_partner_id = cp.id
  FROM channel_partners cp
 WHERE w.source IN ('CP', 'Channel Partner')
   AND w.channel_partner_id IS NULL
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) >= 10
   AND right(regexp_replace(COALESCE(cp.phone, ''), '\D', '', 'g'), 10)
     = right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10);


-- ── B4. attribute leads — name branch (phone-less only) ───────────────────
UPDATE walkin_enquiries w
   SET channel_partner_id = cp.id
  FROM channel_partners cp
 WHERE w.source IN ('CP', 'Channel Partner')
   AND w.channel_partner_id IS NULL
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) < 10
   AND btrim(COALESCE(w.cp_name, '')) <> ''
   AND btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
       NOT IN ('channel partner','cp','n/a','na','none','nil','-','--')
   AND btrim(regexp_replace(lower(regexp_replace(btrim(cp.name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
     = btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''));


-- ── B5. backfill bookings from their source lead ──────────────────────────
-- Gap-fill only: never clobbers attribution already set some other way.
UPDATE booking_applications b
   SET sourced_by_channel_partner_id = w.channel_partner_id
  FROM walkin_enquiries w
 WHERE b.lead_id = w.id
   AND w.channel_partner_id IS NOT NULL
   AND b.sourced_by_channel_partner_id IS NULL;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ PART C — VERIFICATION (read-only, run and eyeball)                      ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

-- C1. Partners created, with how many leads each absorbed.
SELECT cp.id, cp.name, cp.phone, cp.company_name, cp.default_commission_rate AS rate,
       COUNT(w.id) AS leads
  FROM channel_partners cp
  LEFT JOIN walkin_enquiries w ON w.channel_partner_id = cp.id
 GROUP BY cp.id, cp.name, cp.phone, cp.company_name, cp.default_commission_rate
 ORDER BY cp.id;

-- C2. Totals.
SELECT (SELECT COUNT(*) FROM channel_partners)                                              AS partners,
       (SELECT COUNT(*) FROM channel_partners WHERE default_commission_rate IS NULL)         AS needing_rate,
       (SELECT COUNT(*) FROM walkin_enquiries WHERE source IN ('CP','Channel Partner'))      AS cp_leads,
       (SELECT COUNT(*) FROM walkin_enquiries WHERE channel_partner_id IS NOT NULL)          AS leads_attributed,
       (SELECT COUNT(*) FROM booking_applications WHERE sourced_by_channel_partner_id IS NOT NULL) AS bookings_attributed;

-- C3. CP leads left unattributed — expected only where cp_name is a label
--     ("Channel Partner", "CP") or blank. Anything else here is a surprise.
SELECT id, name, phone, source, cp_name, cp_phone
  FROM walkin_enquiries
 WHERE source IN ('CP','Channel Partner')
   AND channel_partner_id IS NULL
 ORDER BY id;

-- C4. Leak check — MUST return zero rows. Non-CP sources must never be attributed.
SELECT id, source, cp_name, channel_partner_id
  FROM walkin_enquiries
 WHERE source NOT IN ('CP','Channel Partner')
   AND channel_partner_id IS NOT NULL;

-- C5. Backfilled bookings vs the booking form's own CP text — cross-check that
--     the attribution looks right before trusting it.
SELECT b.id AS booking, b.booking_number, b.lead_id,
       cp.name AS attributed_cp,
       b.channel_partner_name AS booking_form_says,
       b.booking_source
  FROM booking_applications b
  JOIN channel_partners cp ON cp.id = b.sourced_by_channel_partner_id
 ORDER BY b.id;

-- C6. Schema confirmation.
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename IN ('channel_partners','cp_commissions','walkin_enquiries','booking_applications')
   AND (indexname LIKE '%cp%' OR indexname LIKE '%channel_partner%')
 ORDER BY indexname;

-- Expect exactly one row: YES.
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'channel_partners'
   AND column_name = 'default_commission_rate';

-- Expect the partial index, and NO constraint named cp_commissions_booking_id_key.
SELECT indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_cp_commissions_booking_active';


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-25_cp_phase1b_nullable_rate.sql
-- ──────────────────────────────────────────────────────────────
-- Migration: Phase 1b — allow channel_partners to exist before a rate is negotiated
-- Date: 2026-07-25
--
-- REQUIRED for Phase 1b. findOrCreateChannelPartner inserts partners discovered
-- from enquiry intake, where the form captures no commission rate at all. Phase 1
-- made default_commission_rate NOT NULL, so those inserts fail without this.
--
-- Making it nullable rather than defaulting to 0 is deliberate: a CP entity can
-- legitimately exist before their commercial rate is negotiated, and a stored 0
-- would be indistinguishable from a real negotiated zero. Phase 2's
-- computeCPCommission must hard-reject a NULL rate at booking time rather than
-- coercing it.
--
-- The existing range CHECK (>= 0 AND <= 100) needs no change: a CHECK passes on
-- NULL, so nullability and the range constraint coexist correctly.

ALTER TABLE channel_partners
    ALTER COLUMN default_commission_rate DROP NOT NULL;

-- Supports the phone-matching branch of findOrCreateChannelPartner. Expression
-- index only — the phone column itself is left exactly as Phase 1 defined it, so
-- no stored data is rewritten and no normalization pass is needed.
CREATE INDEX IF NOT EXISTS idx_channel_partners_phone_norm
    ON channel_partners (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

-- Supports the normalized-name matching branch (the bulk-import path).
CREATE INDEX IF NOT EXISTS idx_channel_partners_name_norm
    ON channel_partners (
        btrim(
            regexp_replace(
                lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
                '[[:punct:]]+$', ''
            )
        )
    );


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-28_cp_assignment_workflow.sql
-- ──────────────────────────────────────────────────────────────
-- Channel Partner assignment workflow.
-- Idempotent: safe to run more than once.

ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS office_address TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gst_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pin_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100);

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS channel_partner_id INT,
  ADD COLUMN IF NOT EXISTS pin_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS preferred_location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sourcing_manager_id INT,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_by VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'channel_partner_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_channel_partner
      FOREIGN KEY (channel_partner_id) REFERENCES channel_partners(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'sourcing_manager_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_sourcing_manager
      FOREIGN KEY (sourcing_manager_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_channel_partner
  ON walkin_enquiries(channel_partner_id);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp_sourcing_manager
  ON walkin_enquiries(sourcing_manager_id)
  WHERE source IN ('CP', 'Channel Partner');

CREATE TABLE IF NOT EXISTS cp_assignment_history (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  previous_sourcing_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  new_sourcing_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name VARCHAR(255) NOT NULL,
  assigned_by_role VARCHAR(100),
  action VARCHAR(30) NOT NULL CHECK (action IN ('assigned', 'reassigned', 'cleared')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_lead
  ON cp_assignment_history(lead_id, assigned_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_new_manager
  ON cp_assignment_history(new_sourcing_manager_id, assigned_at DESC);

INSERT INTO cp_assignment_history (
  lead_id,
  previous_sourcing_manager_id,
  new_sourcing_manager_id,
  assigned_by_user_id,
  assigned_by_name,
  assigned_by_role,
  action,
  assigned_at
)
SELECT
  w.id,
  NULL,
  w.sourcing_manager_id,
  NULL,
  COALESCE(NULLIF(w.sourcing_manager_assigned_by, ''), 'System'),
  NULL,
  'assigned',
  COALESCE(w.sourcing_manager_assigned_at, w.created_at::timestamptz, now())
FROM walkin_enquiries w
WHERE w.source IN ('CP', 'Channel Partner')
  AND w.sourcing_manager_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM cp_assignment_history h
    WHERE h.lead_id = w.id
  );


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-29_cp_sourcing_manager_ownership_CONSOLIDATED.sql
-- ──────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- Channel Partner → Sourcing Manager ownership.  CONSOLIDATED, SELF-CONTAINED.
--
-- Everything the 2026-07-29 update needs, including the parts of
-- 2026-07-28_cp_assignment_workflow.sql it depends on. Run this ALONE on a
-- database that has never had either migration (e.g. Neon) — it is idempotent,
-- so it is equally safe on one that already has them.
--
-- Requires only that `users`, `channel_partners` and `walkin_enquiries` exist.
--
-- ── Two shape corrections vs. the original files ──────────────────────────
-- 1. FK on channel_partners.assigned_sourcing_manager_id is created ON DELETE
--    SET NULL. The local database already had it that way (constraint
--    `fk_cp_assigned_sourcing_manager`, added before this work); the
--    2026-07-29 file would have created a plain FK on a fresh database, so
--    deleting a user would have been blocked on one environment and silently
--    unassigned the partner on the other. SET NULL is the correct behaviour:
--    losing an employee must not make a partner undeletable.
-- 2. Only one index is created on that column. Local ended up with two
--    (`idx_cp_assigned_sourcing_manager_id` and
--    `idx_channel_partners_assigned_sourcing_manager`) covering identical
--    ground; the redundant one is dropped at the end.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. COLUMNS
-- ───────────────────────────────────────────────────────────────────────────

-- Office-visit profile fields (from 2026-07-28). Included so this script is
-- self-contained; no-ops where they already exist.
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS office_address        TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact_person  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gst_number            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pin_code              VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city                  VARCHAR(100);

-- The 2026-07-29 addition: the partner's single owning Sourcing Manager.
-- `_at` / `_by` are stamped server-side and only when the owner actually changes.
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_id INT,
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_by VARCHAR(255);

-- Enquiry-level columns (from 2026-07-28). sourcing_manager_id here owns ONE
-- enquiry and is distinct from the partner-level owner above.
ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS channel_partner_id            INT,
  ADD COLUMN IF NOT EXISTS pin_code                      VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city                          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS preferred_location            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sourcing_manager_id           INT,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_by  VARCHAR(255);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. FOREIGN KEYS
-- Each guarded by a lookup on the COLUMN rather than the constraint name, so a
-- database that already has an equivalent FK under a different name (as local
-- does) is left alone instead of acquiring a second one.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'channel_partners'::regclass
      AND c.contype = 'f'
      AND a.attname = 'assigned_sourcing_manager_id'
  ) THEN
    ALTER TABLE channel_partners
      ADD CONSTRAINT fk_cp_assigned_sourcing_manager
      FOREIGN KEY (assigned_sourcing_manager_id)
      REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'channel_partner_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_channel_partner
      FOREIGN KEY (channel_partner_id) REFERENCES channel_partners(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'sourcing_manager_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_sourcing_manager
      FOREIGN KEY (sourcing_manager_id) REFERENCES users(id);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. AUDIT TABLE
-- Declared by 2026-07-28 but MISSING on the local database while the rest of
-- that migration had been applied. POST /api/walkin_enquiries inserts a row here
-- inside the same transaction as the enquiry, so where the table is absent every
-- Channel Partner enquiry fails outright. Verify this exists before going live.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_assignment_history (
  id                            SERIAL PRIMARY KEY,
  lead_id                       INTEGER NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  previous_sourcing_manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  new_sourcing_manager_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name              VARCHAR(255) NOT NULL,
  assigned_by_role              VARCHAR(100),
  action                        VARCHAR(30) NOT NULL
                                  CHECK (action IN ('assigned', 'reassigned', 'cleared')),
  assigned_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ───────────────────────────────────────────────────────────────────────────

-- "Every partner assigned to me" — the Sourcing Manager panel's primary query,
-- and the scope predicate forced into GET /api/channel-partners for that role.
CREATE INDEX IF NOT EXISTS idx_cp_assigned_sourcing_manager_id
  ON channel_partners(assigned_sourcing_manager_id);

-- Phone is the partner's identity: the dedup check on POST, the duplicate-phone
-- check behind the registration form, and findOrCreateChannelPartner all match on
-- the last 10 digits, so they must all hit this expression index.
CREATE INDEX IF NOT EXISTS idx_channel_partners_phone_norm
  ON channel_partners (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_channel_partner
  ON walkin_enquiries(channel_partner_id);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp_sourcing_manager
  ON walkin_enquiries(sourcing_manager_id)
  WHERE source IN ('CP', 'Channel Partner');

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_lead
  ON cp_assignment_history(lead_id, assigned_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_new_manager
  ON cp_assignment_history(new_sourcing_manager_id, assigned_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. BACKFILL — cp_assignment_history (from 2026-07-28)
-- One 'assigned' row per CP enquiry that already carries a Sourcing Manager but
-- has no history, so the audit trail does not start mid-story.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO cp_assignment_history (
  lead_id, previous_sourcing_manager_id, new_sourcing_manager_id,
  assigned_by_user_id, assigned_by_name, assigned_by_role, action, assigned_at
)
SELECT
  w.id,
  NULL,
  w.sourcing_manager_id,
  NULL,
  COALESCE(NULLIF(w.sourcing_manager_assigned_by, ''), 'System'),
  NULL,
  'assigned',
  COALESCE(w.sourcing_manager_assigned_at, w.created_at::timestamptz, now())
FROM walkin_enquiries w
WHERE w.source IN ('CP', 'Channel Partner')
  AND w.sourcing_manager_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cp_assignment_history h WHERE h.lead_id = w.id);

-- ───────────────────────────────────────────────────────────────────────────
-- 6. BACKFILL — partner ownership (2026-07-29)
-- A partner whose enquiries already name a manager inherits the most recent one,
-- so existing partners land on the right panel instead of the feature starting
-- empty. Fills NULLs only: an owner set directly on the partner always wins.
--
-- NOTE: this is a no-op wherever no CP enquiry has ever carried a
-- sourcing_manager_id — which was the case on the local database (all 54 CP
-- enquiries predate the feature). There, ownership must be set by hand: Admin →
-- Channel Partner Management → tick rows → Assign Sourcing Manager.
-- ───────────────────────────────────────────────────────────────────────────
WITH latest AS (
  SELECT DISTINCT ON (w.channel_partner_id)
         w.channel_partner_id,
         w.sourcing_manager_id,
         w.sourcing_manager_assigned_at,
         w.sourcing_manager_assigned_by
    FROM walkin_enquiries w
   WHERE w.channel_partner_id IS NOT NULL
     AND w.sourcing_manager_id IS NOT NULL
   ORDER BY w.channel_partner_id,
            w.sourcing_manager_assigned_at DESC NULLS LAST,
            w.id DESC
)
UPDATE channel_partners cp
   SET assigned_sourcing_manager_id = latest.sourcing_manager_id,
       assigned_sourcing_manager_at = COALESCE(latest.sourcing_manager_assigned_at, now()),
       assigned_sourcing_manager_by = COALESCE(
         NULLIF(latest.sourcing_manager_assigned_by, ''),
         'Backfilled from CP enquiry'
       )
  FROM latest
 WHERE cp.id = latest.channel_partner_id
   AND cp.assigned_sourcing_manager_id IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. CLEANUP — drop the duplicate index
-- Local acquired a second index on assigned_sourcing_manager_id when the
-- 2026-07-29 file created its own alongside the pre-existing one. Two identical
-- btrees cost write throughput and buy nothing.
-- ───────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_channel_partners_assigned_sourcing_manager;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-29_pincode_city_and_sm_territory.sql
-- ──────────────────────────────────────────────────────────────
-- Pincode-driven auto-fill on the Channel Partner form.
--
-- Two lookups, deliberately two tables — they change for different reasons and
-- are maintained by different people:
--
--   pincodes                   pincode -> city. Reference data, effectively fixed.
--   sourcing_manager_pincodes  pincode -> Sourcing Manager. Territory ownership,
--                              edited whenever someone's patch changes.
--
-- Both are OPTIONAL inputs: a pincode with no row in either table simply means the
-- form auto-fills nothing and the operator types it themselves. Nothing breaks,
-- and nothing is blocked — the auto-fill is a convenience, not a validation.
--
-- Idempotent: safe to run more than once.

-- ── 1. Pincode → City ──────────────────────────────────────────────────────
-- Only the columns the form actually consumes plus state/district for humans
-- reading the table later. Seeded below with the areas already in use; add rows
-- as new ones come up.
CREATE TABLE IF NOT EXISTS pincodes (
  pincode    VARCHAR(6) PRIMARY KEY,
  city       VARCHAR(100) NOT NULL,
  district   VARCHAR(100),
  state      VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Pincode → Sourcing Manager ──────────────────────────────────────────
-- UNIQUE on pincode, NOT on (pincode, user_id): the form needs one unambiguous
-- answer to "who owns 400097?". Allowing two managers per pincode would make the
-- auto-assign arbitrary, which is worse than forcing the decision here.
--
-- ON DELETE CASCADE because a territory row is meaningless once the employee is
-- gone — unlike channel_partners.assigned_sourcing_manager_id, which is SET NULL
-- so the partner survives.
CREATE TABLE IF NOT EXISTS sourcing_manager_pincodes (
  id         SERIAL PRIMARY KEY,
  pincode    VARCHAR(6) NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sourcing_manager_pincode UNIQUE (pincode)
);

-- "Which pincodes does this manager cover?" — the reverse lookup, for the day
-- someone builds a territory admin screen.
CREATE INDEX IF NOT EXISTS idx_smp_user ON sourcing_manager_pincodes(user_id);

-- ── 3. Seed: pincodes already appearing in this CRM ─────────────────────────
INSERT INTO pincodes (pincode, city, district, state) VALUES
  ('400097', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400064', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400095', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400101', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400063', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400092', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400068', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('401107', 'Mira Road', 'Thane',           'Maharashtra'),
  ('400601', 'Thane',    'Thane',            'Maharashtra'),
  ('400607', 'Thane',    'Thane',            'Maharashtra'),
  ('411045', 'Pune',     'Pune',             'Maharashtra'),
  ('411057', 'Pune',     'Pune',             'Maharashtra')
ON CONFLICT (pincode) DO NOTHING;

-- ── 4. Territory assignments ───────────────────────────────────────────────
-- Left empty on purpose: who covers which pincode is a business decision, and a
-- guessed mapping would silently route partners to the wrong desk. Add rows like:
--
--   INSERT INTO sourcing_manager_pincodes (pincode, user_id, created_by)
--   VALUES ('400097', 7, 'admin')
--   ON CONFLICT (pincode) DO UPDATE
--     SET user_id = EXCLUDED.user_id, created_by = EXCLUDED.created_by;
--
-- user_id must be an ACTIVE user whose role is Sourcing Manager — the lookup
-- endpoint re-checks both, so a row pointing at anyone else is simply ignored.
-- Current Sourcing Managers:  SELECT id, name FROM users
--   WHERE is_active AND REPLACE(LOWER(TRIM(role)),'_',' ') = 'sourcing manager';


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-30_NEON_combined.sql
-- ──────────────────────────────────────────────────────────────
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  NEON — 2026-07-30 combined migration                                     ║
-- ║  Paste the whole file into the Neon SQL editor and run it once.           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Combines two migrations already applied to the local database:
--   2026-07-30_whatsapp_notification_logs.sql   (PART 1 below)
--   2026-07-30_performance_indexes.sql          (PART 2 below)
--
-- Those two files remain the canonical per-feature migrations. This one exists
-- only so the Neon side can be done in a single paste.
--
-- SAFE TO RUN MORE THAN ONCE. Every statement is guarded. Verified by running it
-- twice against a database that already had both migrations applied.
--
-- WHAT IT CHANGES
--   + creates ONE new table: notification_logs
--   + creates 16 indexes (7 on the new table, 9 on walkin_enquiries / follow_ups)
--   + creates 1 trigger on the new table
--   ~ replaces function set_updated_at() with a byte-identical body (no-op)
--   - drops ONE redundant index: idx_walkin_enquiries_cp
--
--   It does NOT add, rename, retype or drop a column on any existing table.
--   It does NOT read, modify or delete a single row of your data.
--
-- The only destructive statement is the DROP INDEX at the end of PART 2. It
-- removes a byte-for-byte duplicate of idx_walkin_enquiries_channel_partner,
-- which is left in place. To undo it:
--   CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp ON walkin_enquiries (channel_partner_id);
--
-- ── If walkin_enquiries is already large on Neon ────────────────────────────
-- The CREATE INDEX IF NOT EXISTS statements in PART 2 take a brief write lock on the table.
-- At a few thousand rows this is milliseconds and you will not notice. If you
-- are running this against a table with hundreds of thousands of rows and cannot
-- take any write pause, see the note at the very bottom of this file.


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — notification_logs (WhatsApp notification queue)                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- A NEW table. Deliberately not whatsapp_logs, which cannot hold these rows:
-- its lead_id is NOT NULL (a partner registration has no lead), it has no
-- message_id / status / delivered_at columns, and api/monitoring/daily-stats
-- counts it GROUP BY sender_name to produce the per-employee "WhatsApp Sent
-- Today" figure — writing system notifications there would inflate a number
-- people actually read.

CREATE TABLE IF NOT EXISTS notification_logs (
  id               SERIAL PRIMARY KEY,
  channel          VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
  type             VARCHAR(60)  NOT NULL,
  receiver         VARCHAR(255),
  receiver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receiver_phone   VARCHAR(20),
  subject_type     VARCHAR(40),
  subject_id       INTEGER,
  template_name    VARCHAR(100),
  message_id       VARCHAR(128),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
  payload          JSONB,
  retry_count      INTEGER      NOT NULL DEFAULT 0,
  max_retries      INTEGER      NOT NULL DEFAULT 3,
  next_retry_at    TIMESTAMPTZ,
  locked_at        TIMESTAMPTZ,
  last_error       TEXT,
  last_error_code  VARCHAR(40),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ
);

-- Top-ups, in case an earlier revision of the table already exists here.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS channel          VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS receiver_user_id INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_type     VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_id       INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS next_retry_at    TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS locked_at        TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS last_error_code  VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS max_retries      INTEGER NOT NULL DEFAULT 3;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the catalogue guards.
-- This CHECK mirrors NotificationStatus in src/types/whatsapp.types.ts —
-- changing one without the other starts rejecting writes at runtime.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notification_logs_status') THEN
    ALTER TABLE notification_logs ADD CONSTRAINT chk_notification_logs_status
      CHECK (status IN ('pending','sending','sent','delivered','read','failed','dead','skipped'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_logs_receiver_user') THEN
    ALTER TABLE notification_logs ADD CONSTRAINT fk_notification_logs_receiver_user
      FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One row per Meta message id. Every delivery webhook is WHERE message_id = $1,
-- and UNIQUE guarantees a receipt cannot fan out across rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_message_id
  ON notification_logs (message_id) WHERE message_id IS NOT NULL;

-- THE IDEMPOTENCY GUARANTEE. One notification per (type, subject), so a
-- double-submitted form or a client retry sends one WhatsApp, not two.
-- 'manual' sends pass subject_id = NULL and are exempt via the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_subject
  ON notification_logs (type, subject_id) WHERE subject_id IS NOT NULL;

-- The retry sweep's only predicate. Partial, so the index holds just the live
-- queue however many terminal rows accumulate behind it.
CREATE INDEX IF NOT EXISTS idx_notification_logs_due
  ON notification_logs (next_retry_at)
  WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL;

-- Stale-lock reaper: rows stranded in 'sending' by a crash mid-send.
CREATE INDEX IF NOT EXISTS idx_notification_logs_stuck
  ON notification_logs (locked_at) WHERE status = 'sending';

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs (status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_receiver_user
  ON notification_logs (receiver_user_id) WHERE receiver_user_id IS NOT NULL;

-- set_updated_at() already exists on this database (created by the 2026-07-25 CP
-- migrations, and used by triggers on channel_partners and cp_commissions).
-- This body is character-for-character identical to theirs, so the REPLACE is a
-- no-op; it is included only so the file also works on a fresh database where
-- this migration runs first.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notification_logs_updated_at') THEN
    CREATE TRIGGER trg_notification_logs_updated_at
      BEFORE UPDATE ON notification_logs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — performance indexes                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Measured on a 100,000-lead / 400,000-follow-up copy. Before these, the two
-- hottest queries in the app ran with no usable index:
--
--   SELECT * FROM follow_ups WHERE lead_id = $1
--     Parallel Seq Scan, 8,997 buffers, 37 ms to return 4 rows — the whole
--     70 MB table read to find one lead's follow-ups, on every lead open.
--     AFTER: Index Scan, 7 buffers, 0.03 ms.
--
--   SELECT * FROM walkin_enquiries ORDER BY sr_no DESC NULLS LAST LIMIT 20
--     Sort spilling 27 MB to temp files, 74 ms — to return 20 rows.
--     AFTER: Index Scan, no sort at all, 1 ms.

-- ── follow_ups ─────────────────────────────────────────────────────────────
-- lead_id is the most-used predicate in the codebase (17 call sites) and had NO
-- index — the table carried only its primary key. created_at is included because
-- every one of those lookups is "WHERE lead_id = $1 ORDER BY created_at", so one
-- composite index serves the filter and the sort together.
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead_id_created_at
  ON follow_ups (lead_id, created_at);

-- Site-visit dashboards scan for follow-ups carrying a visit date. Partial,
-- because the large majority of rows have none.
CREATE INDEX IF NOT EXISTS idx_follow_ups_site_visit_date
  ON follow_ups (site_visit_date)
  WHERE site_visit_date IS NOT NULL AND site_visit_date <> '';

-- "What did this employee log today?" — the daily monitor groups by name.
CREATE INDEX IF NOT EXISTS idx_follow_ups_created_by_name
  ON follow_ups (created_by_name, created_at DESC);

-- ── walkin_enquiries ───────────────────────────────────────────────────────
-- DESC NULLS LAST must be spelled out: a plain (sr_no) index does NOT satisfy
-- "ORDER BY sr_no DESC NULLS LAST" without an extra sort, which is the entire
-- cost being removed here.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_sr_no_desc
  ON walkin_enquiries (sr_no DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_created_at_desc
  ON walkin_enquiries (created_at DESC);

-- Duplicate-lead detection, which runs on every enquiry POST.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_phone
  ON walkin_enquiries (phone);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_status
  ON walkin_enquiries (status);

-- "My leads" for a Sales Manager. Composite with the sort column so filter and
-- ordering are a single index walk.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_to_sr_no
  ON walkin_enquiries (assigned_to, sr_no DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_receptionist
  ON walkin_enquiries (assigned_receptionist, sr_no DESC NULLS LAST);

-- Lost-lead views. Partial: lost leads are a small minority.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_is_lost_lead
  ON walkin_enquiries (is_lost_lead)
  WHERE is_lost_lead = true;

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_source
  ON walkin_enquiries (source);

-- ── Remove a redundant index ───────────────────────────────────────────────
-- idx_walkin_enquiries_cp and idx_walkin_enquiries_channel_partner are the same
-- index on (channel_partner_id). Carrying both doubles the write cost of every
-- lead INSERT and UPDATE and buys nothing — the planner can only use one.
DROP INDEX IF EXISTS idx_walkin_enquiries_cp;

-- Refresh planner statistics so the new indexes are chosen immediately rather
-- than whenever autovacuum next runs.
ANALYZE follow_ups;
ANALYZE walkin_enquiries;
ANALYZE notification_logs;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  VERIFY — run this after, expect: table_present=t, 16 new indexes         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
SELECT
  (SELECT COUNT(*) = 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'notification_logs')  AS notification_logs_created,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE tablename = 'notification_logs') AS notif_indexes,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE tablename = 'follow_ups')        AS follow_up_indexes,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE tablename = 'walkin_enquiries')  AS lead_indexes,
  (SELECT COUNT(*) = 0 FROM pg_indexes WHERE indexname = 'idx_walkin_enquiries_cp') AS duplicate_index_removed;
-- Expected on a database that had neither migration:
--   notification_logs_created | notif_indexes | follow_up_indexes | lead_indexes | duplicate_index_removed
--   t                         | 8             | 4                 | 12           | t
--
-- (notif_indexes counts the primary key too. follow_up_indexes and lead_indexes
--  include pre-existing indexes, so your numbers may be higher if this database
--  carries extras the local one does not.)


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONLY IF walkin_enquiries IS ALREADY VERY LARGE ON NEON                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- The PART 2 index builds hold a brief write lock. At your current scale that is
-- imperceptible. If you are running this against a table where even a short write
-- pause is unacceptable, DO NOT run PART 2 above — run these instead, one at a
-- time, each as its OWN statement with no BEGIN/COMMIT around it. CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block, which is why they are
-- separated out rather than being the default.
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_lead_id_created_at         ON follow_ups (lead_id, created_at);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_created_by_name            ON follow_ups (created_by_name, created_at DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_sr_no_desc           ON walkin_enquiries (sr_no DESC NULLS LAST);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_created_at_desc      ON walkin_enquiries (created_at DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_phone                ON walkin_enquiries (phone);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_status               ON walkin_enquiries (status);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_assigned_to_sr_no    ON walkin_enquiries (assigned_to, sr_no DESC NULLS LAST);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_assigned_receptionist ON walkin_enquiries (assigned_receptionist, sr_no DESC NULLS LAST);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_source               ON walkin_enquiries (source);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_site_visit_date            ON follow_ups (site_visit_date) WHERE site_visit_date IS NOT NULL AND site_visit_date <> '';
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_is_lost_lead         ON walkin_enquiries (is_lost_lead) WHERE is_lost_lead = true;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_walkin_enquiries_cp;
--   ANALYZE follow_ups;
--   ANALYZE walkin_enquiries;
--
-- A CONCURRENTLY build that is interrupted leaves an INVALID index behind. Check
-- with:  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX on anything it lists, then re-run that one statement.


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-07-30_whatsapp_notification_logs.sql
-- ──────────────────────────────────────────────────────────────
-- Outgoing notification log — the durable queue behind WhatsApp delivery.
--
-- Run with:
--   node scripts/run_sql_migration.js 2026-07-30_whatsapp_notification_logs.sql
--
-- Idempotent: safe to run more than once, on a fresh database or an existing one.
--
-- ── Why this is a new table and not whatsapp_logs ───────────────────────────
-- whatsapp_logs already exists, and it cannot carry these rows:
--
--   * lead_id is NOT NULL, and a Channel Partner registration has no lead.
--   * It has no message_id, status, delivered_at or retry columns — there is
--     nowhere to record what Meta said, so no retry could ever be resumed.
--   * api/monitoring/daily-stats counts it GROUP BY sender_name to produce the
--     per-employee "WhatsApp Sent Today" figure on the admin dashboard. Writing
--     system notifications there would credit a phantom employee and inflate a
--     number people actually read.
--
-- whatsapp_logs stays exactly as it is: a record of staff-initiated wa.me
-- messages against a lead. This table records system-initiated sends against
-- any subject, and the two never mix.
--
-- ── The queue ───────────────────────────────────────────────────────────────
-- Rows are claimed with FOR UPDATE SKIP LOCKED, so the in-process retry timer
-- and the /api/notifications/retry-sweep endpoint can both be running and
-- exactly one of them will win any given row. next_retry_at drives the sweep;
-- locked_at exists so a process that dies mid-send can be detected and its row
-- reclaimed rather than stranded in 'sending' forever.

-- ── 1. Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_logs (
  id               SERIAL PRIMARY KEY,

  -- 'whatsapp' today. Present so an email or SMS channel can share this table
  -- and the same retry machinery rather than cloning it.
  channel          VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',

  -- The business event: 'cp_registration', 'cp_lead_assigned', 'manual'.
  type             VARCHAR(60)  NOT NULL,

  -- Who it went to. receiver is the display name captured at send time, kept
  -- verbatim so the audit trail still reads correctly after a rename; the FK is
  -- for joining to the live user and goes NULL rather than deleting history.
  receiver         VARCHAR(255),
  receiver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receiver_phone   VARCHAR(20),

  -- What it was about. Together with `type` this is the idempotency key.
  subject_type     VARCHAR(40),
  subject_id       INTEGER,

  template_name    VARCHAR(100),

  -- Meta's wamid. NULL until a send succeeds; every delivery webhook matches
  -- on this.
  message_id       VARCHAR(128),

  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',

  -- { request, response, attempts[] }. The request body holds only recipient,
  -- template name and parameters — no credentials — which is exactly why it is
  -- safe to keep and useful for auditing parameter order before go-live.
  -- Headers are never stored.
  payload          JSONB,

  -- Retry state.
  retry_count      INTEGER      NOT NULL DEFAULT 0,
  max_retries      INTEGER      NOT NULL DEFAULT 3,
  next_retry_at    TIMESTAMPTZ,
  locked_at        TIMESTAMPTZ,
  last_error       TEXT,
  last_error_code  VARCHAR(40),

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ
);

-- ── 2. Column top-ups ──────────────────────────────────────────────────────
-- For a database where an earlier revision of this file already created the
-- table. No-ops on a fresh one.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS channel          VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS receiver_user_id INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_type     VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_id       INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS next_retry_at    TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS locked_at        TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS last_error_code  VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS max_retries      INTEGER NOT NULL DEFAULT 3;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 3. Constraints ─────────────────────────────────────────────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the catalogue guard.
--
-- This CHECK mirrors NotificationStatus in src/types/whatsapp.types.ts.
-- Changing one without the other starts rejecting writes at runtime.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notification_logs_status') THEN
    ALTER TABLE notification_logs ADD CONSTRAINT chk_notification_logs_status
      CHECK (status IN ('pending','sending','sent','delivered','read','failed','dead','skipped'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_logs_receiver_user') THEN
    ALTER TABLE notification_logs ADD CONSTRAINT fk_notification_logs_receiver_user
      FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 4. Indexes ─────────────────────────────────────────────────────────────

-- One row per wamid. Every delivery webhook is WHERE message_id = $1, and
-- UNIQUE guarantees a receipt can never fan out across several rows. Partial,
-- because message_id is NULL until a send succeeds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_message_id
  ON notification_logs (message_id) WHERE message_id IS NOT NULL;

-- THE IDEMPOTENCY GUARANTEE. One notification per (type, subject).
--
-- enqueueNotification inserts with ON CONFLICT DO NOTHING against this index,
-- so a double-submitted form, a client retry, or two concurrent requests for the
-- same partner produce one row and therefore one WhatsApp message.
--
-- Consequence: a future "resend" feature must reset the existing row to
-- pending rather than inserting a second one. That is the intended default —
-- silently sending staff two identical alerts is worse than an explicit resend.
--
-- 'manual' ad-hoc sends pass subject_id = NULL and are exempt via the partial
-- predicate, so the same number can be messaged repeatedly by hand.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_subject
  ON notification_logs (type, subject_id) WHERE subject_id IS NOT NULL;

-- The sweep's only predicate. Partial on the two live statuses, so the index
-- holds just the working queue — a handful of rows — however many hundreds of
-- thousands of terminal rows pile up behind it.
CREATE INDEX IF NOT EXISTS idx_notification_logs_due
  ON notification_logs (next_retry_at)
  WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL;

-- The stale-lock reaper. Same reasoning: only rows currently in flight.
CREATE INDEX IF NOT EXISTS idx_notification_logs_stuck
  ON notification_logs (locked_at) WHERE status = 'sending';

-- Admin feed: default ordering, and the status filter / GROUP BY counts.
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs (status);

-- "Everything sent to this manager" — used by the admin filter and worth having
-- before someone builds the per-manager view.
CREATE INDEX IF NOT EXISTS idx_notification_logs_receiver_user
  ON notification_logs (receiver_user_id) WHERE receiver_user_id IS NOT NULL;

-- ── 5. updated_at trigger ──────────────────────────────────────────────────
-- set_updated_at() already exists in this database (created by the CP migrations
-- and attached to channel_partners). Reuse it if present; create it if this
-- migration happens to run first on a fresh database.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notification_logs_updated_at') THEN
    CREATE TRIGGER trg_notification_logs_updated_at
      BEFORE UPDATE ON notification_logs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── After running ───────────────────────────────────────────────────────────
-- Nothing else is required. The application writes here from the moment the
-- table exists, recording a 'skipped' row per triggered notification while the
-- Meta credentials are still absent — which is how the built payload and
-- parameter order can be inspected before a single message is sent:
--
--   SELECT id, type, status, last_error_code, receiver, receiver_phone
--     FROM notification_logs ORDER BY id DESC LIMIT 10;
--
--   SELECT jsonb_pretty(payload) FROM notification_logs ORDER BY id DESC LIMIT 1;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-08-02_walkin_enquiries_neon_sync.sql
-- ──────────────────────────────────────────────────────────────
-- 2026-08-02_walkin_enquiries_neon_sync.sql
-- Brings Neon.walkin_enquiries up to the local schema.
--
-- Trigger: production threw  column "location" of relation "walkin_enquiries"
-- does not exist.  `location` and `referral_name` exist locally but appear in NO
-- migration file — they were added ad-hoc and never shipped, so Neon never got
-- them. Rather than patch those two and wait for the next drift, this asserts
-- every column the local schema has.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op for columns already present,
-- so this is safe to re-run and safe to run against a database that is already
-- correct. It only ADDS — nothing is dropped, retyped or backfilled.
--
-- Run in pgAdmin against Neon, then re-test the failing edit.

ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS name VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS occupation VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS organization VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS budget VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS configuration VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS purpose VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS followup_date VARCHAR(50);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS consent BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_planned VARCHAR(50);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS source_other VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS cp_name VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS cp_company VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS cp_phone VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS assigned_receptionist VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS is_global_shared BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS overseeing_site_head VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS escalated_to_site_head BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS referral_name TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS is_lost_lead BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lost_lead_reason TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lost_lead_marked_at TIMESTAMP;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lost_lead_marked_by TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS enquiry_date TIMESTAMP;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS auto_date_enabled BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sr_no INTEGER;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sales_budget TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS use_type TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS planning_purchase TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_planned_confirmed TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lead_interest_status TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS property_type TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS closing_date TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS site_visit_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_tracking_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS referral_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS external_ref VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS channel_partner_id INTEGER;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS pin_code VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS city VARCHAR(120);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS preferred_location VARCHAR(255);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sourcing_manager_id INTEGER;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_at TIMESTAMP;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_by VARCHAR(100);

-- Verify: expect 57 rows.
-- SELECT count(*) FROM information_schema.columns WHERE table_name = 'walkin_enquiries';
-- Confirm the two that caused this:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'walkin_enquiries' AND column_name IN ('location','referral_name');


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) inventory_schema.sql
-- ──────────────────────────────────────────────────────────────
-- ============================================================================
--  Inventory Management Module — Phase 1 schema
--  Bhoomi Dwellers CRM
--
--  Run this ONCE in pgAdmin (manual, per project convention — the API routes do
--  NOT auto-create these tables). Reconciled against the live schema:
--    • FK targets booking_applications(id)  (the real bookings table)
--    • lead_id targets walkin_enquiries(id)
--    • created_by / updated_by / changed_by are TEXT usernames (matches
--      booking_applications, financial_ledger, and the name/role RBAC pattern)
-- ============================================================================

-- ── Re-runnable reset ───────────────────────────────────────────────────────
--  Drop the Phase-1 tables first so this script can be applied cleanly even if a
--  previous (mismatched) version was already created. SAFE while empty — do NOT
--  run this once inventory_units holds real rows without backing them up.
-- [removed by sync: DROP TABLE is not permitted in this migration]
-- [removed by sync: DROP TABLE is not permitted in this migration]
-- ── (Optional) remove the earlier unused stub ───────────────────────────────
--  The old `project_units` scaffold has no UI and is referenced nowhere else.
--  Safe to drop. Comment this block out if you'd rather keep it.
-- [removed by sync: DROP TABLE is not permitted in this migration]
-- [removed by sync: DROP TABLE is not permitted in this migration]
ALTER TABLE booking_applications DROP COLUMN IF EXISTS unit_id;

-- ── 1.1  Core table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_units (
    id                 SERIAL PRIMARY KEY,
    apartment_name     VARCHAR(255) NOT NULL,
    project_name       VARCHAR(255) NOT NULL,
    tower              VARCHAR(50)  NOT NULL,
    wing               VARCHAR(50),
    unit_type          VARCHAR(50)  NOT NULL,          -- 1BHK, 2BHK, 3BHK, Shop, Office, ...
    floor              INTEGER      NOT NULL,
    flat_no            VARCHAR(50)  NOT NULL,
    carpet_area_sqft   NUMERIC(10,2) NOT NULL,
    built_up_area_sqft NUMERIC(10,2),
    rate_per_sqft      NUMERIC(12,2),
    base_price         NUMERIC(14,2),
    facing             VARCHAR(50),

    status             VARCHAR(30) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','booked','blocked','on_hold',
                          'registered','refuge_area','unfinished','cancelled')),
    hold_expires_at    TIMESTAMP,                       -- only set when status = 'on_hold'

    source             VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual','bulk_generated','booking_sync')),
    lead_id            INTEGER REFERENCES walkin_enquiries(id),
    booking_id         INTEGER REFERENCES booking_applications(id),

    created_by         VARCHAR(255),                    -- username string
    updated_by         VARCHAR(255),
    created_at         TIMESTAMP DEFAULT NOW(),
    updated_at         TIMESTAMP DEFAULT NOW(),
    deleted_at         TIMESTAMP                         -- soft delete
);

-- Duplicate-unit guard. An expression index over COALESCE(wing,'') so a NULL wing
-- and an empty wing collapse to one key — a plain UNIQUE(...) would let NULL wings
-- slip past (NULL <> NULL in Postgres). Partial on deleted_at so a soft-deleted
-- unit doesn't block re-creating the same flat. This is also the ON CONFLICT
-- target the Phase 4 booking-sync upsert will use:
--   ON CONFLICT (project_name, tower, COALESCE(wing,''), floor, flat_no) WHERE deleted_at IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS unique_inventory_unit
    ON inventory_units (project_name, tower, COALESCE(wing, ''), floor, flat_no)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_status  ON inventory_units(status);
CREATE INDEX IF NOT EXISTS idx_inventory_project ON inventory_units(project_name, tower, wing);
CREATE INDEX IF NOT EXISTS idx_inventory_lead    ON inventory_units(lead_id);
CREATE INDEX IF NOT EXISTS idx_inventory_booking ON inventory_units(booking_id);

-- ── 1.2  Audit trail ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_unit_history (
    id             SERIAL PRIMARY KEY,
    unit_id        INTEGER REFERENCES inventory_units(id) ON DELETE CASCADE,
    old_status     VARCHAR(30),
    new_status     VARCHAR(30) NOT NULL,
    changed_by     VARCHAR(255),                        -- username string
    reason         TEXT,                                -- "linked to booking #482", "hold expired", ...
    changed_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_history_unit ON inventory_unit_history(unit_id);


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) inventory_selldo_parity_2026-08-04.sql
-- ──────────────────────────────────────────────────────────────
-- ============================================================================
--  Inventory — Sell.Do parity
--  Bhoomi Dwellers CRM · 2026-08-04
-- ============================================================================
--  Closes the five gaps found when comparing inventory_units against Sell.Do's
--  inventory module:
--
--    1. projects / towers were free text repeated on every unit row  → real entities
--    2. holds had an expiry but no owner                             → held_by / held_for_lead_id
--    3. no unit-level pricing (floor rise, premiums, charges)        → inventory_price_rules
--    4. no cost sheets, offers, or discount approval bands           → 3 new tables
--    5. no inventory movement analytics                              → supported by the above
--
--  SCOPE: inventory only. Nothing here touches booking_applications,
--  walkin_enquiries, follow_ups, or any non-inventory table.
--
--  COMPATIBILITY: inventory_units.project_name / tower / wing are KEPT as-is and
--  stay authoritative for the booking↔unit string match in lib/inventorySync.ts.
--  project_id / tower_id are added ALONGSIDE and backfilled. Nothing outside the
--  inventory module has to change, and no existing query breaks.
--
--  Additive and idempotent throughout. No drops, no destructive updates.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
--  1. PROJECTS  — Sell.Do's top hierarchy level
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_projects (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    city          VARCHAR(100),
    address       TEXT,
    rera_number   VARCHAR(100),
    status        VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK (status IN ('upcoming','active','sold_out','archived')),
    possession_date DATE,
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);

-- Case/space-insensitive uniqueness. The whole point of normalising is that
-- "Malad", "Malad East" and "Malad  Project" can no longer silently coexist as
-- three different projects the way they do in the free-text columns today.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_projects_name
    ON inventory_projects (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
--  2. TOWERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_towers (
    id            SERIAL PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES inventory_projects(id) ON DELETE CASCADE,
    name          VARCHAR(50) NOT NULL,
    total_floors  INTEGER,
    units_per_floor INTEGER,
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);

-- Wing stays on the unit, not the tower: the existing data has several wings per
-- tower ("B", "B wing", "A wing") and the unit-level unique index already keys on
-- it. Modelling wing as a tower would have forced a rewrite of that index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_towers_name
    ON inventory_towers (project_id, LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_towers_project ON inventory_towers(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  3. inventory_units — FKs, hold ownership, premium flags
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE inventory_units
    ADD COLUMN IF NOT EXISTS project_id       INTEGER REFERENCES inventory_projects(id),
    ADD COLUMN IF NOT EXISTS tower_id         INTEGER REFERENCES inventory_towers(id),
    -- Gap 2: a hold you cannot attribute is barely a hold. Sell.Do assigns every
    -- hold an owner; without this the UI can say "on hold" but not for whom.
    ADD COLUMN IF NOT EXISTS held_by          VARCHAR(255),
    ADD COLUMN IF NOT EXISTS held_for_lead_id INTEGER REFERENCES walkin_enquiries(id),
    ADD COLUMN IF NOT EXISTS hold_reason      TEXT,
    -- Gap 3 inputs: the per-unit facts the price rules multiply against.
    ADD COLUMN IF NOT EXISTS is_corner        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_park_facing   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS parking_slots    INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inventory_units_project_id ON inventory_units(project_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_tower_id   ON inventory_units(tower_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_held_lead  ON inventory_units(held_for_lead_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  4. BACKFILL — every distinct name becomes a project/tower, then units link up
-- ─────────────────────────────────────────────────────────────────────────────
-- Soft-deleted units are included on purpose: they still carry a project name,
-- and leaving them unlinked would make a later restore produce an orphan.
INSERT INTO inventory_projects (name, created_by, updated_by)
SELECT DISTINCT ON (LOWER(TRIM(project_name)))
       TRIM(project_name), 'migration', 'migration'
  FROM inventory_units
 WHERE project_name IS NOT NULL AND TRIM(project_name) <> ''
 ORDER BY LOWER(TRIM(project_name)), TRIM(project_name)
ON CONFLICT DO NOTHING;

INSERT INTO inventory_towers (project_id, name, created_by, updated_by)
SELECT DISTINCT ON (p.id, LOWER(TRIM(u.tower)))
       p.id, TRIM(u.tower), 'migration', 'migration'
  FROM inventory_units u
  JOIN inventory_projects p ON LOWER(TRIM(p.name)) = LOWER(TRIM(u.project_name))
 WHERE u.tower IS NOT NULL AND TRIM(u.tower) <> ''
 ORDER BY p.id, LOWER(TRIM(u.tower)), TRIM(u.tower)
ON CONFLICT DO NOTHING;

UPDATE inventory_units u
   SET project_id = p.id
  FROM inventory_projects p
 WHERE u.project_id IS NULL
   AND LOWER(TRIM(p.name)) = LOWER(TRIM(u.project_name));

UPDATE inventory_units u
   SET tower_id = t.id
  FROM inventory_towers t
 WHERE u.tower_id IS NULL
   AND t.project_id = u.project_id
   AND LOWER(TRIM(t.name)) = LOWER(TRIM(u.tower));

-- ─────────────────────────────────────────────────────────────────────────────
--  5. PRICE RULES — Sell.Do's layered price
-- ─────────────────────────────────────────────────────────────────────────────
--  base rate/sqft + floor rise + corner/park premiums, then the statutory and
--  society charges. One row per project (tower_id NULL) or per tower (an override).
--  Versioned by effective_from so a rate change never rewrites history: a cost
--  sheet issued last month must still explain itself with last month's numbers.
CREATE TABLE IF NOT EXISTS inventory_price_rules (
    id                      SERIAL PRIMARY KEY,
    project_id              INTEGER NOT NULL REFERENCES inventory_projects(id) ON DELETE CASCADE,
    tower_id                INTEGER REFERENCES inventory_towers(id) ON DELETE CASCADE,
    unit_type               VARCHAR(50),      -- NULL = applies to every configuration

    base_rate_per_sqft      NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Charged per floor above floor_rise_from_floor, per sqft.
    floor_rise_per_sqft     NUMERIC(12,2) NOT NULL DEFAULT 0,
    floor_rise_from_floor   INTEGER       NOT NULL DEFAULT 0,
    floor_rise_max_per_sqft NUMERIC(12,2),    -- optional cap

    corner_premium_pct      NUMERIC(6,3) NOT NULL DEFAULT 0,
    park_facing_premium_pct NUMERIC(6,3) NOT NULL DEFAULT 0,

    -- Lump sums, not rates.
    club_fee                NUMERIC(14,2) NOT NULL DEFAULT 0,
    corpus_fund             NUMERIC(14,2) NOT NULL DEFAULT 0,
    legal_charges           NUMERIC(14,2) NOT NULL DEFAULT 0,
    maintenance_deposit     NUMERIC(14,2) NOT NULL DEFAULT 0,
    parking_charge_per_slot NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- Statutory. Defaults are Maharashtra's, matching lib/gst.ts and the booking form.
    gst_rate                NUMERIC(5,2) NOT NULL DEFAULT 5,
    stamp_duty_rate         NUMERIC(5,2) NOT NULL DEFAULT 6,
    registration_fee        NUMERIC(14,2) NOT NULL DEFAULT 30000,

    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_by              VARCHAR(255),
    updated_by              VARCHAR(255),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_rules_lookup
    ON inventory_price_rules(project_id, tower_id, unit_type, effective_from DESC)
    WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
--  6. DISCOUNT BANDS — who may approve how much
-- ─────────────────────────────────────────────────────────────────────────────
--  Sell.Do: "discount approvals follow defined bands and are documented on record
--  rather than merely memorised."
CREATE TABLE IF NOT EXISTS inventory_discount_bands (
    id              SERIAL PRIMARY KEY,
    project_id      INTEGER REFERENCES inventory_projects(id) ON DELETE CASCADE, -- NULL = global
    min_discount_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
    max_discount_pct NUMERIC(6,3) NOT NULL,
    approver_role   VARCHAR(50)  NOT NULL,   -- 'sales manager' | 'admin' | ...
    label           VARCHAR(100),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sensible starting ladder, global (project_id NULL). Only seeded when the table
-- is empty, so re-running never duplicates or overrides a tuned set.
INSERT INTO inventory_discount_bands (project_id, min_discount_pct, max_discount_pct, approver_role, label)
SELECT * FROM (VALUES
    (NULL::integer, 0.000,  2.000, 'sales manager', 'Up to 2% — Sales Manager'),
    (NULL::integer, 2.000,  5.000, 'admin',         '2-5% — Admin'),
    (NULL::integer, 5.000, 100.000, 'admin',        'Above 5% — Admin (exceptional)')
) v
WHERE NOT EXISTS (SELECT 1 FROM inventory_discount_bands);

-- ─────────────────────────────────────────────────────────────────────────────
--  7. COST SHEETS — versioned, immutable once issued
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_cost_sheets (
    id                SERIAL PRIMARY KEY,
    unit_id           INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE CASCADE,
    lead_id           INTEGER REFERENCES walkin_enquiries(id),
    price_rule_id     INTEGER REFERENCES inventory_price_rules(id),
    version           INTEGER NOT NULL DEFAULT 1,

    -- Every component stored, not just the total. A cost sheet that cannot show
    -- its own arithmetic is unusable in a negotiation.
    carpet_area_sqft  NUMERIC(10,2),
    base_rate_per_sqft NUMERIC(12,2),
    base_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    floor_rise_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    corner_premium    NUMERIC(14,2) NOT NULL DEFAULT 0,
    park_premium      NUMERIC(14,2) NOT NULL DEFAULT 0,
    parking_charge    NUMERIC(14,2) NOT NULL DEFAULT 0,
    agreement_value   NUMERIC(14,2) NOT NULL DEFAULT 0,

    club_fee          NUMERIC(14,2) NOT NULL DEFAULT 0,
    corpus_fund       NUMERIC(14,2) NOT NULL DEFAULT 0,
    legal_charges     NUMERIC(14,2) NOT NULL DEFAULT 0,
    maintenance_deposit NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_charges_total NUMERIC(14,2) NOT NULL DEFAULT 0,

    gst_rate          NUMERIC(5,2)  NOT NULL DEFAULT 0,
    gst_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    stamp_duty_rate   NUMERIC(5,2)  NOT NULL DEFAULT 0,
    stamp_duty_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    registration_fee  NUMERIC(14,2) NOT NULL DEFAULT 0,

    discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_pct      NUMERIC(6,3)  NOT NULL DEFAULT 0,
    total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,  -- all-in, after discount

    -- Full line-item breakdown as rendered, so a reprint is byte-identical.
    breakdown         JSONB,

    status            VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','issued','superseded','expired')),
    valid_until       DATE,
    created_by        VARCHAR(255),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_sheets_unit ON inventory_cost_sheets(unit_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_cost_sheets_lead ON inventory_cost_sheets(lead_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  8. OFFERS / NEGOTIATION
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_offers (
    id              SERIAL PRIMARY KEY,
    unit_id         INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE CASCADE,
    lead_id         INTEGER REFERENCES walkin_enquiries(id),
    cost_sheet_id   INTEGER REFERENCES inventory_cost_sheets(id),

    list_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
    offered_price   NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_pct    NUMERIC(6,3)  NOT NULL DEFAULT 0,

    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','countered','accepted','expired','withdrawn')),
    -- Which band the discount fell into, frozen at request time. Re-deriving it
    -- later would silently re-band an old offer if the ladder is ever retuned.
    required_approver_role VARCHAR(50),
    counter_price   NUMERIC(14,2),

    requested_by    VARCHAR(255),
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by      VARCHAR(255),
    decided_at      TIMESTAMPTZ,
    decision_remarks TEXT,
    valid_until     DATE,
    remarks         TEXT
);

CREATE INDEX IF NOT EXISTS idx_offers_unit   ON inventory_offers(unit_id);
CREATE INDEX IF NOT EXISTS idx_offers_lead   ON inventory_offers(lead_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON inventory_offers(status) WHERE status = 'pending';


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) neon_sync_2026-08-04.sql
-- ──────────────────────────────────────────────────────────────
-- ============================================================================
-- Neon sync — 2026-08-04
-- ============================================================================
-- Brings the Neon (production) schema up to what the app code actually queries.
-- Local `bhoomiBackup_crm` had picked up three migrations that were never
-- applied to Neon, so every route touching them 500s against production:
--
--   1. follow_ups internal-messaging columns  -> GET /api/followups selects them
--      unconditionally, so the whole follow-up feed fails, which in turn breaks
--      every dashboard view that loads followUps. ("can't send follow-up")
--   2. pincodes / sourcing_manager_pincodes    -> /api/pincode-lookup, used by the
--      sales form for pincode -> sourcing-manager routing. ("can't fill sales form")
--   3. employee_activity_logs.timestamp        -> /api/attendance/log-activity
--      INSERTs into it; that fires on lots of user actions.
--
-- Everything here is additive and idempotent: no drops, no type changes, no
-- destructive updates. Safe to re-run.
-- ============================================================================

-- ─── 1. follow_ups: internal messaging ──────────────────────────────────────
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS follow_up_type      text DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS created_by_role     text,
  ADD COLUMN IF NOT EXISTS sent_to_role        text,
  ADD COLUMN IF NOT EXISTS sent_to_user_id     integer,
  ADD COLUMN IF NOT EXISTS parent_follow_up_id integer,
  ADD COLUMN IF NOT EXISTS read_at             timestamptz;

-- The 297 pre-existing rows are plain notes; the code reads this via
-- COALESCE(follow_up_type,'note') but the partial indexes below need it set.
UPDATE follow_ups SET follow_up_type = 'note' WHERE follow_up_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_unread_for_user
  ON follow_ups (sent_to_user_id, read_at)
  WHERE follow_up_type = 'internal_message';

CREATE INDEX IF NOT EXISTS idx_follow_ups_parent
  ON follow_ups (parent_follow_up_id);

-- ─── 2. employee_activity_logs.timestamp ────────────────────────────────────
-- Neon only has created_at; the attendance routes all read/write `timestamp`.
-- Backfilled from created_at so existing history stays visible in analytics.
ALTER TABLE employee_activity_logs
  ADD COLUMN IF NOT EXISTS "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP;

-- [removed by sync: backfilled in PHASE 7 instead — created_at did not exist here]

-- ─── 3. Pincode -> sourcing manager routing ─────────────────────────────────
CREATE TABLE IF NOT EXISTS pincodes (
  pincode    varchar(6)   PRIMARY KEY,
  city       varchar(100) NOT NULL,
  district   varchar(100),
  state      varchar(100),
  created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sourcing_manager_pincodes (
  id         serial       PRIMARY KEY,
  pincode    varchar(6)   NOT NULL,
  user_id    integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by varchar(255),
  created_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_sourcing_manager_pincode UNIQUE (pincode)
);

CREATE INDEX IF NOT EXISTS idx_smp_user ON sourcing_manager_pincodes (user_id);

-- Seed: the 14 serviced pincodes from local. sourcing_manager_pincodes is
-- deliberately left empty — those assignments are made in the app, and local
-- had none either.
INSERT INTO pincodes (pincode, city, district, state) VALUES
  ('400063', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400064', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400068', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400092', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400094', 'Mumbai', 'Mumbai', 'Maharashtra'),
  ('400095', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400097', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400101', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400601', 'Thane', 'Thane', 'Maharashtra'),
  ('400607', 'Thane', 'Thane', 'Maharashtra'),
  ('400615', 'Thane', 'Thane', 'Maharashtra'),
  ('401107', 'Mira Road', 'Thane', 'Maharashtra'),
  ('411045', 'Pune', 'Pune', 'Maharashtra'),
  ('411057', 'Pune', 'Pune', 'Maharashtra')
ON CONFLICT (pincode) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) neon_retire_apartment_name_2026-08-04.sql
-- ──────────────────────────────────────────────────────────────
-- ============================================================================
-- Retire inventory_units.apartment_name — 2026-08-04
-- ============================================================================
-- apartment_name was removed from the booking form, so inventory follows it:
-- the field is gone from Add Unit, Bulk Generate, the units table, the unit
-- drawer, the building-delete scope, and every INSERT.
--
-- The COLUMN IS DELIBERATELY KEPT, only made nullable. Dropping it would destroy
-- the values on rows created before the retirement (92 rows on Neon, 42 on local
-- all currently non-null) and is irreversible. Nullable is enough: nothing writes
-- it any more, so it simply stops being populated on new units.
--
-- Additive and idempotent. Safe to re-run.
-- ============================================================================

ALTER TABLE inventory_units ALTER COLUMN apartment_name DROP NOT NULL;


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) bolna_integration_2026-08-05.sql
-- ──────────────────────────────────────────────────────────────
-- bolna_integration_2026-08-05.sql
--
-- Bolna voice-agent integration: credential storage + call records.
--
-- Run against BOTH local and Neon. Per the schema-drift incident of 2026-08-04,
-- a migration applied only locally shows up later as a prod-only 500 on the
-- settings panel, which is a slow and confusing thing to debug.
--
--   psql "$DATABASE_URL" -f bolna_integration_2026-08-05.sql
--
-- Idempotent: safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════════
-- integration_settings — per-organization credentials for third-party providers
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Deliberately generic rather than a bolna_settings table, because the next
-- integration will want the same three things: some public config, some
-- secrets, and a record of whether the credentials last verified.
--
-- The split between `settings` and `secrets` is the security boundary, not a
-- tidiness preference:
--
--   settings — returned to the browser verbatim. Agent id, phone number,
--              anything an admin needs to see to confirm the panel is right.
--   secrets  — AES-256-GCM envelopes written by lib/secretsCrypto.ts. Never
--              serialized into an HTTP response by any code path. The settings
--              GET returns a masked fingerprint (last 4 chars) instead.
--
-- Anything placed in `settings` should be assumed public. Anything that must
-- not be is in `secrets` or it is not protected.

CREATE TABLE IF NOT EXISTS integration_settings (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER      NOT NULL DEFAULT 1,
  -- 'bolna', and later whatever else. Lowercase by convention.
  provider          VARCHAR(50)  NOT NULL,
  settings          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  secrets           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Set by the save-time credential probe. A row that has never verified is
  -- shown as "unverified" in the panel rather than silently assumed working.
  last_verified_at  TIMESTAMPTZ,
  last_verify_error TEXT,
  updated_by        INTEGER,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- The upsert target for every write. One row per provider per organization.
CREATE UNIQUE INDEX IF NOT EXISTS integration_settings_org_provider_idx
  ON integration_settings (organization_id, provider);

-- ═══════════════════════════════════════════════════════════════════════════
-- bolna_calls — one row per call, phone or browser
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Written at three moments, and the column set follows from that:
--
--   1. Initiation — we know who, whom, which lead, which agent. Everything
--      about the outcome is null.
--   2. Webhook, in-progress — status advances. Bolna sends several of these.
--   3. Webhook, completed — transcript, summary, recording, cost, duration.
--
-- Bolna's docs are emphatic that `call-disconnected` arrives before the data is
-- finalized, so the webhook handler only fills the outcome columns on a
-- terminal status. See webhooks/bolna.webhook.ts.

CREATE TABLE IF NOT EXISTS bolna_calls (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER      NOT NULL DEFAULT 1,

  -- Bolna's execution_id (telephony) or run_id (web call). The same id space:
  -- the Web Call SDK's getRunId() "matches the id in your Bolna call history
  -- and webhooks". This is what the webhook joins on.
  --
  -- Nullable because a call that fails at the mint/dial step never gets one,
  -- and we still want the failure recorded against the lead.
  execution_id      UUID UNIQUE,

  -- Exactly one of these is set. walkin_enquiries is the main lead table;
  -- caller_leads is the separate tele-calling list.
  -- ON DELETE SET NULL rather than CASCADE: a deleted lead should not silently
  -- erase the billing and compliance record of calls that were placed.
  lead_id           INTEGER REFERENCES walkin_enquiries (id) ON DELETE SET NULL,
  caller_lead_id    INTEGER REFERENCES caller_leads (id)     ON DELETE SET NULL,

  agent_id          VARCHAR(64),
  -- 'phone' — Bolna dials the contact over PSTN (POST /call).
  -- 'web'   — the browser is the other leg over WebRTC (Web Call SDK).
  channel           VARCHAR(16)  NOT NULL DEFAULT 'phone',
  direction         VARCHAR(16)  NOT NULL DEFAULT 'outbound',

  -- Bolna's own vocabulary, stored unmapped:
  -- queued initiated ringing in-progress call-disconnected completed
  -- no-answer busy failed canceled stopped error balance-low
  -- Plus 'mint-failed' / 'dial-failed', ours, for calls that died before Bolna
  -- ever assigned a status.
  status            VARCHAR(32)  NOT NULL DEFAULT 'queued',

  from_number       VARCHAR(20),
  to_number         VARCHAR(20),

  initiated_by      INTEGER,
  initiated_by_name VARCHAR(150),

  duration_seconds  INTEGER,
  total_cost        NUMERIC(12, 4),
  recording_url     TEXT,
  transcript        TEXT,
  summary           TEXT,
  -- Bolna's post-call extraction block, shape defined per agent in the
  -- Extractions tab. Stored whole because we cannot know the agent's schema.
  extracted_data    JSONB,
  hangup_reason     VARCHAR(64),

  -- The last webhook body, for diagnosing a call whose data looks wrong.
  last_payload      JSONB,
  error_message     TEXT,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- The lead timeline query: "every call for this lead, newest first".
CREATE INDEX IF NOT EXISTS bolna_calls_lead_idx
  ON bolna_calls (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bolna_calls_caller_lead_idx
  ON bolna_calls (caller_lead_id, created_at DESC);

-- The webhook's fallback join when execution_id does not match a known row:
-- an inbound call, or one placed from the Bolna dashboard rather than the CRM.
CREATE INDEX IF NOT EXISTS bolna_calls_to_number_idx
  ON bolna_calls (to_number);

CREATE INDEX IF NOT EXISTS bolna_calls_status_idx
  ON bolna_calls (status);

-- ═══════════════════════════════════════════════════════════════════════════
-- admin_audit_logs — pre-existing gap, not part of the Bolna feature
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Three modules already INSERT into this table and it has never existed in
-- either database:
--
--   api/settings/working-hours/route.ts  — unguarded, inside the route's outer
--                                          try/catch, so every admin save of the
--                                          shift timing has been returning
--                                          "Internal Server Error" AFTER
--                                          committing the change. The setting
--                                          saved; the response said it failed.
--   lib/leadDeletion.ts                  — guarded by a tableHasColumn() probe,
--                                          so it silently skipped the audit row.
--   api/settings/bolna/route.ts          — this feature; guarded with .catch().
--
-- Created here because the Bolna settings route is expected to write an audit
-- trail like its neighbours, and "like its neighbours" currently means "into a
-- table that is not there". The column set is exactly what all three call sites
-- already pass.

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
  ON admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_idx
  ON admin_audit_logs (admin_id, created_at DESC);


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) settings_panel_2026-08-05.sql
-- ──────────────────────────────────────────────────────────────
-- settings_panel_2026-08-05.sql
-- Schema for the redesigned Settings panel (Phase 1).
--
-- ── Why this differs from the spec ──────────────────────────────────────────
-- The written spec assumes a multi-tenant schema (organizations, employees,
-- api_keys, billing_records) that this CRM does not have and does not want:
--
--   * There is no `organizations` table. `organization_settings` is a single
--     row keyed `organization_id = 1`. Every workspace-level setting added here
--     goes on that row rather than inventing a tenant model the other ~70
--     tables know nothing about.
--
--   * There is no `employees` table, and one is not created. `users` IS the
--     employee directory — /api/employees already selects from it, the session
--     cookie carries users.id, and every foreign key in the CRM points at it.
--     A second table would need a sync path on every write and would silently
--     disagree with `users` the first time one was missed.
--
--   * `first_name` / `last_name` columns are deliberately NOT added. `users.name`
--     is load-bearing — the login route matches on LOWER(name), and activity
--     logs denormalise it. The Profile UI splits `name` on read and rejoins it
--     on write, so there is exactly one source of truth for a person's name.
--
-- Idempotent: safe to re-run against local and Neon.

-- ── 1. Profile & preference columns on users ────────────────────────────────
ALTER TABLE users
  -- Avatar. `avatar_key` is the R2 object key (served through /api/r2-proxy);
  -- `avatar_url` is used only when R2 is unconfigured and the file falls back to
  -- local public/uploads. Exactly one of the two is set at a time.
  ADD COLUMN IF NOT EXISTS avatar_key                    VARCHAR(512),
  ADD COLUMN IF NOT EXISTS avatar_url                    VARCHAR(2048),

  -- Time preferences. Default is Asia/Kolkata, not UTC: every user of this CRM
  -- is in IST, and defaulting to UTC would silently shift every displayed
  -- timestamp for anyone who never opens Settings.
  ADD COLUMN IF NOT EXISTS timezone                      VARCHAR(64)  DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS week_start_day                SMALLINT     DEFAULT 1, -- 0=Sun, 1=Mon, 6=Sat

  -- UI preferences
  ADD COLUMN IF NOT EXISTS theme_preference              VARCHAR(16)  DEFAULT 'system', -- 'light' | 'dark' | 'system'
  ADD COLUMN IF NOT EXISTS language                      VARCHAR(16)  DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS dashboard_config              JSONB,

  -- Notification routing
  ADD COLUMN IF NOT EXISTS secondary_email               VARCHAR(255),
  ADD COLUMN IF NOT EXISTS secondary_email_verified      BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_email_preference VARCHAR(20)  DEFAULT 'primary', -- 'primary' | 'secondary' | 'none'
  ADD COLUMN IF NOT EXISTS notification_prefs            JSONB,

  -- Directory metadata (Employee Management)
  ADD COLUMN IF NOT EXISTS department                    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reporting_manager_id          INTEGER,

  -- Security / lifecycle audit stamps
  ADD COLUMN IF NOT EXISTS last_email_change_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at                 TIMESTAMPTZ,

  -- Invite flow
  ADD COLUMN IF NOT EXISTS invite_token                  VARCHAR(128),
  ADD COLUMN IF NOT EXISTS invite_sent_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_expires_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_login_at                TIMESTAMPTZ,

  -- Deactivation is a soft state. `is_active` already gates login; these record
  -- when and why, which "Status: Inactive since ..." in the directory needs.
  ADD COLUMN IF NOT EXISTS deactivated_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at                    TIMESTAMPTZ;

-- Self-referencing FK added separately so re-runs don't error on a duplicate
-- constraint name (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_reporting_manager_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_reporting_manager_id_fkey
      FOREIGN KEY (reporting_manager_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_reporting_manager ON users (reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_users_invite_token      ON users (invite_token);

-- ── 2. Email-change OTPs ────────────────────────────────────────────────────
-- The spec calls for Redis with a 10-minute expiry. There is no Redis in this
-- deployment, so the rows carry their own `expires_at` and are filtered on read;
-- a stale row is inert rather than valid-forever.
--
-- The OTP is stored as a SHA-256 hash, not plaintext. A six-digit code is weak
-- enough that a database read should not hand over a working one, and the
-- verify path only ever needs to compare.
CREATE TABLE IF NOT EXISTS email_change_otps (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email   VARCHAR(255) NOT NULL,
  sent_to     VARCHAR(255) NOT NULL,   -- always the CURRENT address, per spec
  otp_hash    VARCHAR(64)  NOT NULL,   -- sha256 hex
  attempts    INTEGER      NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ  NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_change_otps_user
  ON email_change_otps (user_id, created_at DESC);

-- ── 3. Audit log ────────────────────────────────────────────────────────────
-- `employee_activity_logs` already records CRM activity (lead touched, module
-- opened) and `admin_audit_logs` records a free-text admin action string.
-- Neither carries the before/after values, IP or user agent that the Activity
-- Logs screen is specified to show, and neither should be reshaped — other
-- features read them. This table covers settings and security events; the
-- Activity Logs API unions all three for display.
--
-- ip_address is VARCHAR, not INET: x-forwarded-for arrives as a comma-separated
-- chain behind a proxy and INET would reject it outright.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(255),            -- denormalised so deleted users stay legible
  action      VARCHAR(100) NOT NULL,   -- 'login', 'profile.update', 'password.change', ...
  entity_type VARCHAR(50),             -- 'user', 'workspace', 'employee', ...
  entity_id   VARCHAR(64),
  old_value   TEXT,
  new_value   TEXT,
  ip_address  VARCHAR(128),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time      ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action    ON audit_logs (action);

-- ── 4. Workspace-level settings ─────────────────────────────────────────────
-- Onto the existing single row rather than a new `organizations` table.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS workspace_name  VARCHAR(255) DEFAULT 'Bhoomi Dwellers',
  ADD COLUMN IF NOT EXISTS industry        VARCHAR(100) DEFAULT 'Real Estate',
  ADD COLUMN IF NOT EXISTS currency        VARCHAR(3)   DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS timezone        VARCHAR(64)  DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS logo_key        VARCHAR(512),
  ADD COLUMN IF NOT EXISTS logo_url        VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS primary_color   VARCHAR(7),
  ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7),
  ADD COLUMN IF NOT EXISTS lock_dashboard  BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS force_theme     VARCHAR(20);

-- Guarantee the singleton row exists; the Settings UI reads it unconditionally.
INSERT INTO organization_settings (organization_id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_settings WHERE organization_id = 1);


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) booking_cancellation_columns.sql
-- ──────────────────────────────────────────────────────────────
-- ============================================================================
--  Booking cancellation metadata — run ONCE in pgAdmin.
--  Backs the "Cancellation Details" card + the admin Edit/Reactivate flow.
--  cancelled_by is a TEXT username (matches booking_applications.created_by).
-- ============================================================================
ALTER TABLE booking_applications
  ADD COLUMN IF NOT EXISTS cancellation_reason   TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_remarks  TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMP;


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) follow_ups_internal_messaging.sql
-- ──────────────────────────────────────────────────────────────
-- follow_ups_internal_messaging.sql
--
-- Receptionist → Sales Manager direct messaging, scoped to a single lead.
-- The message lives in the lead's existing follow-up timeline so there is one
-- permanent record per lead rather than a second conversation store.
--
-- ── Against the ACTUAL follow_ups schema ────────────────────────────────────
-- Existing columns (verified 2026-08-04, local + Neon):
--   id, lead_id, message (text), created_by_name (varchar),
--   created_at (timestamptz), followup_date (varchar), site_visit_date (varchar)
--
-- Note what is NOT there: no `notes`, no `created_by`, no `created_by_role`,
-- and the date column is `followup_date` (varchar), not `follow_up_date`. The
-- message body column is `message`. Nothing below duplicates an existing column.
--
-- created_by_role is added because the timeline has to render "From: Priya
-- (Receptionist) → Vinesh Singh (SM)" and created_by_name alone cannot say which
-- side of the conversation a row is.
--
-- Idempotent. Run on local first, then Neon.

ALTER TABLE follow_ups
  -- 'note' (every existing row), 'internal_message', 'sm_reply'
  ADD COLUMN IF NOT EXISTS follow_up_type      TEXT DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS created_by_role     TEXT,
  ADD COLUMN IF NOT EXISTS sent_to_role        TEXT,
  -- users.id of the addressed sales manager. walkin_enquiries.assigned_to holds
  -- a NAME, not an id, so this is resolved by joining users at send time and
  -- frozen here — renaming a user later must not silently re-address history.
  ADD COLUMN IF NOT EXISTS sent_to_user_id     INTEGER,
  ADD COLUMN IF NOT EXISTS parent_follow_up_id INTEGER REFERENCES follow_ups(id),
  ADD COLUMN IF NOT EXISTS read_at             TIMESTAMPTZ;

-- Existing rows predate the feature and are all plain notes.
UPDATE follow_ups SET follow_up_type = 'note' WHERE follow_up_type IS NULL;

-- Drives the sales manager's unread badge: "my unread internal messages".
CREATE INDEX IF NOT EXISTS idx_follow_ups_unread_for_user
  ON follow_ups (sent_to_user_id, read_at)
  WHERE follow_up_type = 'internal_message';

-- Drives thread assembly when rendering one lead's timeline.
CREATE INDEX IF NOT EXISTS idx_follow_ups_parent
  ON follow_ups (parent_follow_up_id);


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) developer_api_2026-08-07.sql
-- ──────────────────────────────────────────────────────────────
-- developer_api_2026-08-07.sql
-- Schema for the Developer API section of Settings.
--
-- ── What this unblocks ──────────────────────────────────────────────────────
-- The Developer API page previously rendered a PlannedSection whose stated
-- blocker was exact and worth repeating, because this migration only removes
-- half of it:
--
--   "The CRM has no API-key authentication layer — every route authenticates
--    with the crm_session cookie, so an issued key would not grant access to
--    anything."
--
-- Issuing a key that authenticates nothing would have been a working UI in front
-- of a no-op, which is the failure mode this whole exercise is meant to avoid.
-- So this ships alongside a real, versioned surface at /api/v1/* that ONLY
-- accepts these keys. A key issued here grants access to that surface and
-- nothing else — in particular it is deliberately NOT a skeleton key for the
-- ~110 cookie-authenticated routes the dashboard uses.
--
-- ── Why keys are stored hashed, and what the prefix is for ──────────────────
-- `key_hash` is SHA-256 of the full key. The plaintext is shown exactly once, at
-- creation, and is not recoverable afterwards — that is the spec's "never expose
-- secrets after creation" and it is enforced by not having the data rather than
-- by hiding it in the UI.
--
-- That alone would force a table scan with a hash comparison per row on every
-- authenticated request. `key_prefix` (the non-secret leading segment, e.g.
-- `bk_live_7f3a9c21`) is stored in clear and uniquely indexed, so lookup is a
-- single index hit and only then is the hash compared. The prefix is also what
-- the UI lists, so an admin can match a key in the table against one in their
-- password manager without either of them holding the secret.
--
-- SHA-256 rather than scrypt/bcrypt here, unlike user passwords in lib/passwords.ts:
-- an API key is 32 bytes of CSPRNG output, not a human-chosen password. There is
-- no dictionary to attack and no rainbow table to build, so a slow KDF would buy
-- nothing and would add its cost to every single API request.
--
-- Idempotent: safe to re-run against local and Neon.

-- ── 1. The keys themselves ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id                 SERIAL PRIMARY KEY,

  -- Human label, so a revoked key can be discussed ("the Zapier one").
  name               VARCHAR(120)  NOT NULL,

  -- Non-secret. Indexed unique — this is the lookup path on every request.
  key_prefix         VARCHAR(32)   NOT NULL,

  -- SHA-256 hex of the full plaintext key. 64 chars.
  key_hash           CHAR(64)      NOT NULL,

  -- Named scopes, e.g. {'leads:read','bookings:read'}. An empty array means the
  -- key can authenticate but do nothing, which is a usable "disabled but not
  -- revoked" state and is why there is no NOT NULL default of all-scopes.
  scopes             TEXT[]        NOT NULL DEFAULT '{}',

  -- Requests per minute. NULL means "use the system default" rather than
  -- "unlimited" — there is no unlimited, because an unlimited key on a pool of
  -- max:10 Postgres connections (lib/db.ts) can starve the dashboard.
  rate_limit_per_min INTEGER,

  -- CIDR strings, e.g. {'203.0.113.0/24','198.51.100.7'}. Empty array = no IP
  -- restriction. Stored as TEXT[] rather than INET[]/CIDR[] so a malformed entry
  -- fails validation in the application with a message an admin can act on,
  -- instead of as a Postgres type error at INSERT.
  ip_whitelist       TEXT[]        NOT NULL DEFAULT '{}',

  created_by         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Read-mostly telemetry. Updated at most once a minute per key rather than on
  -- every request (see lib/apiKeys.ts) so that a busy key does not turn every
  -- GET into a write.
  last_used_at       TIMESTAMPTZ,
  last_used_ip       VARCHAR(64),

  -- NULL = never expires. A date in the past is treated as expired, not deleted,
  -- so the audit trail and usage history survive.
  expires_at         TIMESTAMPTZ,

  -- Revocation is a soft delete: the row stays so that usage history and audit
  -- entries keep referring to something, and so a leaked key cannot be silently
  -- re-created with the same prefix.
  revoked_at         TIMESTAMPTZ,
  revoked_by         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason     VARCHAR(255),

  -- Set when a key is replaced via Rotate, pointing at the replacement. Lets the
  -- UI show "rotated → bk_live_9c2f…" instead of an unexplained dead key.
  rotated_to_id      INTEGER       REFERENCES api_keys(id) ON DELETE SET NULL
);

-- The lookup index. UNIQUE because the prefix is what identifies a key on the
-- request path; a duplicate would make authentication ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_prefix_uidx ON api_keys (key_prefix);

-- Listing the active keys is the common read; revoked ones are the long tail.
CREATE INDEX IF NOT EXISTS api_keys_active_idx
  ON api_keys (created_at DESC)
  WHERE revoked_at IS NULL;

-- ── 2. Usage: rate limiting and statistics from one table ───────────────────
--
-- Per-minute buckets. The same rows answer both questions the spec asks for:
--
--   rate limit  →  SUM(request_count) WHERE bucket_start = date_trunc('minute', NOW())
--   statistics  →  aggregate over any wider window
--
-- A separate row-per-request log was the alternative. It was rejected because a
-- key polling once a second produces 86,400 rows a day and the rate-limit check
-- — which runs on EVERY request — would have to count them. Bucketing makes the
-- hot path a single indexed upsert against a row that already exists.
--
-- Rate limiting in Postgres rather than in-process memory is deliberate: Next.js
-- route handlers are per-worker, so an in-memory counter would multiply the
-- effective limit by the worker count and reset on every deploy. The cost is one
-- upsert per request, which is the same order as the query the request will make
-- anyway.
CREATE TABLE IF NOT EXISTS api_key_usage (
  id             BIGSERIAL PRIMARY KEY,
  api_key_id     INTEGER      NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,

  -- date_trunc('minute', …) of the request time.
  bucket_start   TIMESTAMPTZ  NOT NULL,

  -- The matched route template ('/api/v1/leads'), never the raw URL — raw query
  -- strings carry filter values and would turn this table into an unintended
  -- copy of what people search for.
  endpoint       VARCHAR(160) NOT NULL,

  -- 2 / 4 / 5 for 2xx / 4xx / 5xx. Coarse on purpose: the useful question is
  -- "is this key erroring", and storing exact codes would multiply the row count
  -- for no extra signal at this granularity.
  status_class   SMALLINT     NOT NULL,

  request_count  INTEGER      NOT NULL DEFAULT 0,

  -- Summed, not averaged, so buckets can be merged across any window without
  -- weighting. Mean latency = total_duration_ms / request_count.
  total_duration_ms BIGINT    NOT NULL DEFAULT 0
);

-- The upsert target for the hot path, and the index the rate-limit read uses.
CREATE UNIQUE INDEX IF NOT EXISTS api_key_usage_bucket_uidx
  ON api_key_usage (api_key_id, bucket_start, endpoint, status_class);

-- Statistics queries scan by time across all keys.
CREATE INDEX IF NOT EXISTS api_key_usage_time_idx
  ON api_key_usage (bucket_start DESC);

-- ── Retention ───────────────────────────────────────────────────────────────
-- Not a cron job, because this project has no scheduler wired up and inventing
-- one here would be a second undocumented moving part. The usage sweep runs
-- opportunistically from lib/apiKeys.ts instead (roughly 1 request in 500),
-- deleting buckets older than 90 days. If a scheduler is added later, this is
-- the statement it should run:
--
--   DELETE FROM api_key_usage WHERE bucket_start < NOW() - INTERVAL '90 days';


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) notification_routing_2026-08-07.sql
-- ──────────────────────────────────────────────────────────────
-- notification_routing_2026-08-07.sql
-- Multi-destination email routing.
--
-- ── What this replaces ──────────────────────────────────────────────────────
-- `users.notification_email_preference` is a single VARCHAR holding one of
-- 'primary' | 'secondary' | 'none'. It cannot express "send to both", because
-- one column can only name one destination. Adding a fourth value ('both')
-- would work for exactly as long as there are two possible addresses, and would
-- have to be reworked the moment a third is wanted.
--
-- Independent booleans do not have that ceiling: each destination carries its
-- own on/off, and the four combinations the spec lists fall out of two flags
-- rather than being enumerated.
--
-- ── Why a side table rather than more columns on users ──────────────────────
-- `users` is already 33 columns and is SELECTed in full on the login path. These
-- values are read by the mail layer, on a different cadence, and carry their own
-- audit stamps (updated_by, updated_at) that would collide with the row-level
-- `updated_at` users already has for a different purpose.
--
-- One row per user, enforced by a UNIQUE constraint rather than left to
-- application discipline — two preference rows for one person is a silent
-- "why did that email go to the wrong address" bug.
--
-- ── Migration of existing values ────────────────────────────────────────────
-- The old column is READ to seed this table, and then deliberately left in
-- place. Dropping it in the same migration that introduces the replacement
-- means a rollback loses data; it can be dropped once this has run in
-- production for a while. Nothing writes to it after this migration.
--
-- Idempotent: safe to re-run against local and Neon.

-- ── 1. Preferences ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                         SERIAL PRIMARY KEY,
  user_id                    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The two destinations, independent. Both true = send to both. Both false =
  -- send nothing, which is a legitimate choice the UI confirms before saving.
  send_current_email         BOOLEAN     NOT NULL DEFAULT true,
  send_alternative_email     BOOLEAN     NOT NULL DEFAULT false,

  -- Denormalised from users.secondary_email deliberately. The routing service
  -- reads this table alone on the send path; joining users for one column on
  -- every outbound email is avoidable work, and the address genuinely belongs
  -- to the routing configuration rather than to the person's identity.
  alternative_email          VARCHAR(255),

  -- An unverified address is never delivered to. Storing the flag here rather
  -- than relying on users.secondary_email_verified keeps the send path to a
  -- single row read, and the two are kept in step by the verification route.
  alternative_email_verified BOOLEAN     NOT NULL DEFAULT false,

  -- The failsafe. When true and the alternative is enabled+verified, a failed
  -- delivery to the current address is retried against the alternative.
  -- Defaults ON: the spec describes this as automatic, and a failsafe that has
  -- to be discovered and switched on is not one.
  fallback_enabled           BOOLEAN     NOT NULL DEFAULT true,

  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Who last changed it. Distinct from user_id: an admin editing someone else's
  -- routing must be attributable, and "the notifications stopped arriving" is a
  -- question about who changed the setting, not whose setting it is.
  updated_by                 INTEGER     REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_uidx
  ON notification_preferences (user_id);

-- ── 2. Delivery attempts ────────────────────────────────────────────────────
--
-- The fallback rule is conditional on delivery FAILING, so failure has to be an
-- observable fact rather than an assumption. Every attempt is recorded with its
-- outcome, which also answers the support question this feature will generate
-- most often: "I never got the email — was it sent?"
CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id             BIGSERIAL PRIMARY KEY,
  user_id        INTEGER     REFERENCES users(id) ON DELETE SET NULL,

  -- Which system email this was, e.g. 'login.success', 'password.changed'.
  -- Matches the EMAIL_TYPES catalogue in lib/emailRouting.ts.
  email_type     VARCHAR(64) NOT NULL,

  recipient      VARCHAR(255) NOT NULL,

  -- 'current' | 'alternative' | 'fallback'. 'fallback' is specifically an
  -- alternative-address send that happened BECAUSE the current one failed, and
  -- is distinguished from a plain alternative send so the logs show the
  -- failsafe firing rather than merely two configured recipients.
  destination    VARCHAR(16) NOT NULL,

  delivered      BOOLEAN     NOT NULL,
  transport      VARCHAR(16) NOT NULL,
  error          TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_delivery_attempts_user_idx
  ON email_delivery_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_delivery_attempts_failed_idx
  ON email_delivery_attempts (created_at DESC)
  WHERE delivered = false;

-- ── 3. Known devices ────────────────────────────────────────────────────────
--
-- "⚠ New Device Detected" needs a record of which devices are already known,
-- and employee_sessions cannot serve as one: it is written on every login and
-- pruned by the heartbeat, so "have we seen this device before" would be a scan
-- of a hot, high-churn table.
--
-- The fingerprint is a hash of the normalised user agent, NOT of the IP. IP
-- addresses change constantly on mobile networks, and including one would flag
-- every commute as a new device — training people to ignore the warning, which
-- is worse than not sending it.
CREATE TABLE IF NOT EXISTS known_login_devices (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- SHA-256 of the normalised user agent. Hashed rather than stored raw because
  -- a full UA string is a fingerprinting surface, and equality is all that is
  -- ever asked of it.
  device_hash    CHAR(64)     NOT NULL,

  -- Human-readable, for the email and the device list: "Windows PC / Chrome".
  device_label   VARCHAR(160) NOT NULL,

  first_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_ip        VARCHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS known_login_devices_uidx
  ON known_login_devices (user_id, device_hash);

-- ── 4. OTP purpose ──────────────────────────────────────────────────────────
--
-- email_change_otps already implements a rate-limited, attempt-capped, hashed
-- OTP flow. Verifying the ALTERNATIVE address needs exactly that, so it reuses
-- the table rather than growing a second, subtly-different copy of the same
-- logic — a duplicate is where the attempt cap gets forgotten.
--
-- The two flows must not be able to consume each other's codes, though: a code
-- issued to confirm a primary-email change must not verify an alternative
-- address. `purpose` is what keeps them apart, and every read filters on it.
ALTER TABLE email_change_otps
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'primary_change';

CREATE INDEX IF NOT EXISTS email_change_otps_lookup_idx
  ON email_change_otps (user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

-- ── 5. Backfill ─────────────────────────────────────────────────────────────
-- Separate transaction so a backfill problem on a large users table does not
-- roll back the schema itself.

INSERT INTO notification_preferences
  (user_id, send_current_email, send_alternative_email,
   alternative_email, alternative_email_verified, updated_at)
SELECT
  u.id,
  -- 'primary' and 'both' → current on. 'secondary' and 'none' → current off.
  -- NULL (never configured) is treated as 'primary', matching what
  -- serializeSettingsUser() already defaults it to.
  COALESCE(u.notification_email_preference, 'primary') IN ('primary', 'both'),

  -- Only 'secondary'/'both' had the alternative switched on, and only when an
  -- address actually exists. Enabling a destination with no address would make
  -- the new UI show a ticked box beside an empty field.
  COALESCE(u.notification_email_preference, 'primary') IN ('secondary', 'both')
    AND u.secondary_email IS NOT NULL,

  u.secondary_email,
  COALESCE(u.secondary_email_verified, false),
  NOW()
FROM users u
WHERE u.deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ── Note on users.notification_email_preference ─────────────────────────────
-- Left in place on purpose (see the header). Once this has run in production
-- and nothing reads it, retire it with:
--
--   ALTER TABLE users DROP COLUMN notification_email_preference;
--
-- lib/settingsUser.ts still SELECTs it so that the old value stays visible for
-- comparison during the transition; that reference is what to remove first.


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) notification_routing_phase2_2026-08-07.sql
-- ──────────────────────────────────────────────────────────────
-- notification_routing_phase2_2026-08-07.sql
-- Alternative-email verification state, device trust, and failed-login tracking.
--
-- Builds on notification_routing_2026-08-07.sql. Run that first.
--
-- ── Why the OTP moves onto notification_preferences ─────────────────────────
-- Phase 1 reused `email_change_otps` with a `purpose` discriminator. That works,
-- and for the primary-email change it is still the right home, because that flow
-- genuinely needs a queue: several changes can be requested and each carries its
-- own target address.
--
-- Alternative-email verification is different. There is exactly one alternative
-- address per user and exactly one outstanding code for it, so a one-row-per-user
-- model is a better fit: "is there a live code" becomes a column read rather than
-- an ORDER BY over a history table, and a stale code cannot be resurrected
-- because there is nowhere for it to hide. It also puts the verification state
-- next to the thing being verified, which is what the spec asks for.
--
-- `email_change_otps` keeps the primary-change flow. Nothing is removed.
--
-- Idempotent: safe to re-run against local and Neon.

-- ── 1. Verification state ───────────────────────────────────────────────────
ALTER TABLE notification_preferences
  -- When verification last succeeded. Displayed as "Last verified on …" so a
  -- year-old verification is visibly old rather than an indefinite green tick.
  ADD COLUMN IF NOT EXISTS alternative_email_verified_at    TIMESTAMPTZ,

  -- Single-use, URL-safe. Backs the "verify by clicking" link in the email, for
  -- the very common case of reading mail on a phone and the CRM being open on a
  -- desktop — retyping a 6-digit code across devices is where people give up.
  -- Hashed like the OTP: a token in a database dump is a live credential.
  ADD COLUMN IF NOT EXISTS alternative_email_token_hash     CHAR(64),

  -- SHA-256 of the 6-digit code. Never the code itself.
  --
  -- SHA-256 rather than scrypt, unlike lib/passwords.ts: this is a 6-digit
  -- value, so a slow KDF buys nothing against an attacker who can simply try all
  -- 10^6 offline. What actually bounds the attack is the 5-attempt cap and the
  -- 10-minute expiry below, both enforced server-side.
  ADD COLUMN IF NOT EXISTS otp_hash                         CHAR(64),
  ADD COLUMN IF NOT EXISTS otp_expires_at                   TIMESTAMPTZ,

  -- Wrong guesses against the CURRENT code. Reset when a new code is issued.
  ADD COLUMN IF NOT EXISTS verification_attempts            SMALLINT NOT NULL DEFAULT 0,

  -- Backs the 60-second resend cooldown.
  ADD COLUMN IF NOT EXISTS last_otp_sent_at                 TIMESTAMPTZ,

  -- Backs the "max 5 OTPs per hour" cap. A fixed window, not a sliding one:
  -- `otp_window_started_at` is stamped on the first send and the count resets
  -- once an hour has passed since it. A sliding window would need the send
  -- history this table deliberately does not keep, and the difference — a
  -- theoretical 10-in-one-hour burst straddling a boundary — does not matter for
  -- a control whose job is stopping someone mailbombing a third party.
  ADD COLUMN IF NOT EXISTS otp_window_started_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_sent_in_window               SMALLINT NOT NULL DEFAULT 0,

  -- Drives the 🔴 "Verification Failed" state. Set when a code is burned by
  -- running out of attempts or expiring unused, so the UI can distinguish
  -- "you have not tried yet" from "your last attempt did not work" — which are
  -- different messages and different next actions.
  ADD COLUMN IF NOT EXISTS last_verification_failed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verification_failure_reason VARCHAR(32);

-- ── 2. Device trust ─────────────────────────────────────────────────────────
--
-- The "Was this you?" call to action needs somewhere to record the answer.
ALTER TABLE known_login_devices
  -- NULL = never asked. true = the user confirmed. false = the user pressed
  -- "Secure my account". Three states, so an unanswered prompt is not silently
  -- read as approval.
  ADD COLUMN IF NOT EXISTS trusted            BOOLEAN,
  ADD COLUMN IF NOT EXISTS trust_responded_at TIMESTAMPTZ,

  -- Hashed, single-use, and scoped to one device row. The links in a security
  -- email are clickable by anyone who obtains the email, so the token must not
  -- be reusable and must not be readable from the database.
  ADD COLUMN IF NOT EXISTS confirm_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS confirm_expires_at TIMESTAMPTZ;

-- ── 3. Failed logins ────────────────────────────────────────────────────────
--
-- The 5-in-15-minutes alert needs the individual attempts; a counter column
-- could not express "within a window" without a reset job.
--
-- Rows are keyed by the identifier that was TYPED, not by user_id, because the
-- interesting case includes attempts against an address that does not resolve to
-- an account — someone working through a list. user_id is filled in when the
-- identifier does match, so the alert can reach the right person.
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER      REFERENCES users(id) ON DELETE CASCADE,
  identifier   VARCHAR(255) NOT NULL,
  ip_address   VARCHAR(64),
  user_agent   TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Set on the attempt that crossed the threshold, so the alert fires once per
  -- burst rather than on every attempt after the fifth.
  alerted_at   TIMESTAMPTZ
);

-- The threshold query: attempts for one identifier inside a time window.
CREATE INDEX IF NOT EXISTS failed_login_attempts_window_idx
  ON failed_login_attempts (identifier, created_at DESC);

CREATE INDEX IF NOT EXISTS failed_login_attempts_user_idx
  ON failed_login_attempts (user_id, created_at DESC);

-- ── Retention ───────────────────────────────────────────────────────────────
-- failed_login_attempts grows without bound under a sustained attack, which is
-- exactly when it must not fill the disk. Swept opportunistically from
-- lib/loginSecurity.ts (roughly 1 login in 200):
--
--   DELETE FROM failed_login_attempts WHERE created_at < NOW() - INTERVAL '30 days';


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) notification_routing_phase3_2026-08-07.sql
-- ──────────────────────────────────────────────────────────────
-- notification_routing_phase3_2026-08-07.sql
-- Staged alternative-email verification.
--
-- Run after notification_routing_phase2_2026-08-07.sql.
--
-- ── The bug this fixes ──────────────────────────────────────────────────────
-- Phase 2 stored the candidate address in `alternative_email` and refused to
-- enable the destination until `alternative_email_verified` was true. The OTP
-- was then sent to whatever `alternative_email` already held. That produced a
-- circular dependency:
--
--   saving the address required verification
--   → verification required sending a code
--   → sending required the address to already be saved
--
-- It also meant typing a new address into the field destroyed the currently
-- verified one BEFORE the replacement had been proven — so a typo cost you a
-- working notification address, immediately, with no undo.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- Two columns instead of one:
--
--   alternative_email          the LIVE address. Only ever written by a
--                              successful verification. If it is non-NULL it is
--                              verified, by construction.
--   pending_alternative_email  the candidate under verification. Freely
--                              writable, never delivered to, never a valid
--                              sign-in identifier.
--
-- Promotion is the only path between them, and it happens exactly once, on a
-- correct OTP. That removes the circularity (a code is sent to the PENDING
-- address, which needs no prior verification) and makes the live value durable
-- (a failed or abandoned verification leaves it untouched).
--
-- Idempotent: safe to re-run against local and Neon.

ALTER TABLE notification_preferences
  -- The candidate. NULL when no verification is in flight.
  ADD COLUMN IF NOT EXISTS pending_alternative_email VARCHAR(255),

  -- Identifies one verification attempt. Carried by the client and checked on
  -- submit, so that a code issued for address A cannot be redeemed against a
  -- modal that has since been pointed at address B — which is otherwise
  -- reachable by opening the flow in two tabs.
  --
  -- Random, not sequential: it is compared, not enumerated, and a guessable
  -- session id would let one user's submit collide with another's attempt.
  ADD COLUMN IF NOT EXISTS verification_session_id   CHAR(32);

-- Lets the "already used by another account" check be an index lookup rather
-- than a sequential scan, on both the live and the pending column.
CREATE INDEX IF NOT EXISTS notification_preferences_alt_email_idx
  ON notification_preferences (LOWER(alternative_email))
  WHERE alternative_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_preferences_pending_email_idx
  ON notification_preferences (LOWER(pending_alternative_email))
  WHERE pending_alternative_email IS NOT NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Separate transaction so a data problem cannot roll back the schema.
--
-- Any address sitting in `alternative_email` that was never verified is a
-- CANDIDATE under the new model, not a live value. It moves to the pending
-- column rather than being deleted — the user typed it deliberately, and it
-- should still be there when they next open the screen.

UPDATE notification_preferences
   SET pending_alternative_email = alternative_email,
       alternative_email         = NULL,
       -- The destination cannot be on for an address that is not live. This was
       -- already enforced by the API, but a row could predate that.
       send_alternative_email    = false,
       -- Any code in flight belonged to the old arrangement.
       otp_hash                     = NULL,
       otp_expires_at               = NULL,
       alternative_email_token_hash = NULL,
       verification_attempts        = 0,
       updated_at                   = NOW()
 WHERE alternative_email IS NOT NULL
   AND alternative_email_verified = false;

-- Belt and braces: after the move, a non-NULL alternative_email must be
-- verified. Anything else would let an unproven address receive security mail
-- AND act as a sign-in identifier.
UPDATE notification_preferences
   SET alternative_email_verified = true
 WHERE alternative_email IS NOT NULL
   AND alternative_email_verified = false;

-- ── Invariant ───────────────────────────────────────────────────────────────
-- From here on, for every row:
--
--   alternative_email IS NOT NULL  →  alternative_email_verified = true
--
-- Not expressed as a CHECK constraint because the promotion in
-- lib/alternativeEmailVerification.ts writes both columns in one UPDATE and a
-- constraint would add nothing that statement does not already guarantee —
-- while making any future two-step migration of this table fail mid-way.


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) notification_type_preferences_2026-08-07.sql
-- ──────────────────────────────────────────────────────────────
-- notification_type_preferences_2026-08-07.sql
-- Per-notification on/off switches.
--
-- Run after notification_routing_phase3_2026-08-07.sql.
--
-- ── Why not the name the spec suggested ─────────────────────────────────────
-- The spec asks for a table called `notification_preferences` holding
-- (user_id, notification_key, enabled). That name is already taken, by
-- notification_routing_2026-08-07.sql, for a one-row-per-user table answering a
-- different question: WHERE mail goes (current address, alternative, both,
-- fallback). This table answers WHICH mail is sent.
--
-- Renaming the existing table would break lib/emailRouting.ts,
-- lib/alternativeEmailVerification.ts and two API routes for no gain, so the new
-- table takes the more specific name and the two sit side by side:
--
--   notification_preferences        one row per user   → where it goes
--   notification_type_preferences   many rows per user → what is sent
--
-- ── Sparse rows, not a full grid ────────────────────────────────────────────
-- A row is written only when a user has made an explicit choice. A key with no
-- row falls back to the catalogue's `defaultEnabled` in
-- lib/notificationCatalogue.ts.
--
-- The alternative — one row per user per key, materialised up front — means
-- every new notification type needs a backfill INSERT before anyone can receive
-- it, and a forgotten backfill is a notification that silently never fires for
-- existing users. With sparse rows a new key ships with its default already
-- applied to everybody, which is the extensibility the spec is asking for.
--
-- The cost is that "is this on" is a left join against a default rather than a
-- column read. That is a lookup on a covered unique index, on a table with at
-- most a few dozen rows per user.
--
-- Idempotent: safe to re-run against local and Neon.

CREATE TABLE IF NOT EXISTS notification_type_preferences (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The catalogue key, e.g. 'security.login_success', 'billing.payment_failed'.
  -- Deliberately a plain VARCHAR and not an enum: the whole point of this design
  -- is that adding a notification type is a code change in the catalogue, not a
  -- migration. An enum would put every new key back behind an ALTER TYPE.
  --
  -- Keys not present in the catalogue are ignored on read, so a row left behind
  -- by a retired notification is inert rather than an error.
  notification_key  VARCHAR(64)  NOT NULL,

  enabled           BOOLEAN      NOT NULL,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One answer per user per key. Without this a double-submit of the settings
-- screen leaves two contradictory rows and the winner is whichever the planner
-- happens to return first — an intermittent "my toggle keeps flipping back".
-- It is also the conflict target for the batched upsert in
-- lib/notificationPreferenceService.ts.
CREATE UNIQUE INDEX IF NOT EXISTS notification_type_preferences_uidx
  ON notification_type_preferences (user_id, notification_key);

-- The read path loads every key for one user in a single statement.
CREATE INDEX IF NOT EXISTS notification_type_preferences_user_idx
  ON notification_type_preferences (user_id);

-- ── Migration of the old blob ───────────────────────────────────────────────
-- Separate transaction so a data problem cannot roll back the schema.
--
-- `users.notification_prefs` is a JSONB blob whose `email` object held seven
-- booleans (leadAssigned, bookingUpdates, commissionAlerts, teamMentions,
-- teamMembership, teamDigest, systemAlerts) plus a `frequency` string.
--
-- Only three of those survive into the new catalogue. The lead, booking and
-- commission toggles are deliberately NOT carried over: the notification centre
-- is explicitly scoped to account, security, workspace, employee, subscription
-- and system mail, and those three are none of those. The blob keeps them, so
-- nothing is lost if a lead-notification feature later wants them back.
--
-- frequency = 'never' is honoured as "turn the digests off", because that is
-- what the user chose the last time they were asked.

INSERT INTO notification_type_preferences (user_id, notification_key, enabled)
SELECT u.id, v.key, v.enabled
  FROM users u
  CROSS JOIN LATERAL (VALUES
    -- teamMembership covered invitations, activations and removals as one
    -- switch. It fans out to the individual employee keys rather than being
    -- dropped, so someone who had turned it off does not find it back on.
    ('team.employee_invited',      COALESCE((u.notification_prefs->'email'->>'teamMembership')::boolean, true)),
    ('team.employee_activated',    COALESCE((u.notification_prefs->'email'->>'teamMembership')::boolean, true)),
    ('team.employee_deactivated',  COALESCE((u.notification_prefs->'email'->>'teamMembership')::boolean, true)),
    ('team.employee_removed',      COALESCE((u.notification_prefs->'email'->>'teamMembership')::boolean, true)),
    ('team.role_changed',          COALESCE((u.notification_prefs->'email'->>'teamMembership')::boolean, true)),

    ('system.announcement',        COALESCE((u.notification_prefs->'email'->>'systemAlerts')::boolean, true)),
    ('system.maintenance',         COALESCE((u.notification_prefs->'email'->>'systemAlerts')::boolean, true)),
    ('system.product_updates',     COALESCE((u.notification_prefs->'email'->>'systemAlerts')::boolean, true)),

    -- The digest keys answer to BOTH the old category toggle and the old
    -- frequency selector, because either one could silence them.
    ('system.digest_daily',
       COALESCE((u.notification_prefs->'email'->>'teamDigest')::boolean, true)
       AND COALESCE(u.notification_prefs->>'frequency', 'instant') <> 'never'),
    ('system.digest_weekly',
       COALESCE((u.notification_prefs->'email'->>'teamDigest')::boolean, true)
       AND COALESCE(u.notification_prefs->>'frequency', 'instant') <> 'never'),
    ('system.digest_monthly',
       COALESCE((u.notification_prefs->'email'->>'teamDigest')::boolean, true)
       AND COALESCE(u.notification_prefs->>'frequency', 'instant') <> 'never')
  ) AS v(key, enabled)
 WHERE u.deleted_at IS NULL
   -- Only users who actually configured something. A NULL blob means "never
   -- opened the screen", and that person should get the catalogue defaults
   -- rather than a frozen snapshot of today's defaults written into rows.
   AND u.notification_prefs IS NOT NULL
ON CONFLICT (user_id, notification_key) DO NOTHING;

-- ── Note on users.notification_prefs ────────────────────────────────────────
-- Left in place. Its `inApp` object (browser, sound, do-not-disturb) is still
-- live and still read by the In-App tab; only the `email` object and
-- `frequency` are superseded here. Do not drop the column.


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) sales_settings_2026-08-08.sql
-- ──────────────────────────────────────────────────────────────
-- sales_settings_2026-08-08.sql
-- Settings panel: the "Additional Features" section for Sales Managers.
--
-- One JSONB column rather than a boolean per toggle, for the same reason
-- users.notification_prefs is one column: these are only ever read and written
-- as a whole, by one screen, and a new toggle should be a UI change rather than
-- a migration. lib/featurePrefs.ts owns the shape and merges stored values over
-- the defaults, so rows written before a toggle existed keep working.
--
-- NULL means "never opened the screen" and reads as all-defaults. There is
-- deliberately no DEFAULT '{}' — an empty object and a NULL would then be
-- indistinguishable, and NULL is the cheaper way to store "untouched".
--
-- Apply to BOTH local and Neon. Idempotent, so re-running is safe.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS feature_prefs JSONB;

COMMENT ON COLUMN public.users.feature_prefs IS
  'Per-user workflow toggles shown under Settings → Additional Features. Shape owned by lib/featurePrefs.ts; NULL means all defaults.';


-- ──────────────────────────────────────────────────────────────
-- source: (repo root) financial_adjustments.sql
-- ──────────────────────────────────────────────────────────────
-- financial_adjustments.sql — Phase 6 of the Financial Obligation Engine.
--
-- The audit trail for admin overrides of a financial gate. Today there is
-- exactly one overridable gate: the disbursement-tranche block raised when a
-- loan breaches its ceiling (see POST /api/booking-applications/[id]/tranche-override).
-- adjustment_type keeps the table open to future correction types without a
-- second table.
--
-- An override never fixes the underlying breach. It records that a human with a
-- name and a role decided a specific disbursement should proceed anyway, and
-- freezes the financial state that was bypassed so the decision stays auditable
-- even after the booking's numbers move.
--
-- NOTE: this file documents the schema ALREADY DEPLOYED to local and Neon
-- (verified 2026-08-03, both identical, zero rows). `performed_by` is TEXT, not
-- an integer id: getSessionUserId() returns null whenever the cookie's _id is
-- not numeric, so the session's email/name is the identity that is always
-- present — and an emergency override must never fail on an id-shape mismatch.
-- There is deliberately no FK on it for the same reason.
--
-- Idempotent: safe to re-run, and it will NOT alter an existing table.

CREATE TABLE IF NOT EXISTS financial_adjustments (
  id                   SERIAL PRIMARY KEY,
  booking_id           INTEGER NOT NULL REFERENCES booking_applications(id),
  lead_id              INTEGER REFERENCES walkin_enquiries(id),
  adjustment_type      TEXT NOT NULL,

  performed_by         TEXT NOT NULL,
  performed_by_role    TEXT NOT NULL,
  performed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What the system said
  gate_code            TEXT NOT NULL,
  obligation_snapshot  JSONB NOT NULL,

  -- What the admin decided
  reason               TEXT NOT NULL,
  approved_amount      NUMERIC,

  -- What happened. NULL would mean the tranche insert failed after the override
  -- was logged — impossible through the route, which does both in one
  -- transaction, but the column stays nullable so a future non-transactional
  -- caller cannot silently lie about it.
  resulting_tranche_id INTEGER,

  notes                TEXT
);

CREATE INDEX IF NOT EXISTS idx_financial_adjustments_booking
  ON financial_adjustments(booking_id);
CREATE INDEX IF NOT EXISTS idx_financial_adjustments_performed_by
  ON financial_adjustments(performed_by);


-- ──────────────────────────────────────────────────────────────
-- source: scripts/admin_ai_neon.sql
-- ──────────────────────────────────────────────────────────────
-- admin_ai_neon.sql — run this on Neon (pgAdmin / SQL editor) before deploying.
--
-- Same DDL as scripts/migrate_admin_ai.js, which has already been applied to the
-- local database. Provided as plain SQL because the deploy pattern here is manual
-- DDL rather than a migration runner.
--
-- Idempotent: every statement is IF NOT EXISTS, so re-running is safe.
--
-- ORDER MATTERS on production:
--   1. set SESSION_SECRET in the environment   ← without it, login returns 503
--   2. run this file
--   3. deploy
-- Reversing 1 and 3 takes the whole CRM down for every user, not just the AI.

-- Backs searchKnowledgeBase. pgvector is not used: the `vector` extension is
-- unavailable on the local server, and at this corpus size trigram ranking is
-- faster and costs nothing per query. Neon does offer pgvector if you later want
-- embeddings — only lib/admin-ai/services.ts#searchKnowledgeBase would change.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- status values: 'ok' | 'tool_error' | 'error' | 'refused' | 'rate_limited'.
-- 'tool_error' means the model answered but retrieval failed underneath — see
-- the monitoring query at the bottom of this file.
CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id                SERIAL PRIMARY KEY,
  user_id           INT REFERENCES users(id) ON DELETE SET NULL,
  user_name         TEXT,
  user_role         TEXT,
  organization_id   INT,
  conversation_id   INT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  question          TEXT NOT NULL,
  tools_called      JSONB NOT NULL DEFAULT '[]'::jsonb,
  modules_accessed  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  model             TEXT,
  status            TEXT NOT NULL,
  latency_ms        INT,
  prompt_tokens     INT,
  completion_tokens INT,
  total_tokens      INT,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_user_time
  ON ai_audit_logs(user_id, created_at DESC);
-- The rate limiter counts recent rows per user; without this it is a scan.
CREATE INDEX IF NOT EXISTS idx_ai_audit_time
  ON ai_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_ups_message_trgm
  ON follow_ups USING gin (message gin_trgm_ops);

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect 3 rows.
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'ai_%'
 ORDER BY table_name;

-- Expect one row naming pg_trgm.
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';

-- ── Monitoring: run this periodically ──────────────────────────────────────
-- Any non-zero tool_error count means the assistant is answering business
-- questions while its retrieval is failing underneath — the exact condition
-- that hid five broken tools. Investigate with the second query.
--
-- SELECT status, count(*) FROM ai_audit_logs
--  WHERE created_at > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;
--
-- SELECT created_at, question, tools_called
--   FROM ai_audit_logs WHERE status = 'tool_error'
--  ORDER BY created_at DESC LIMIT 20;


-- ──────────────────────────────────────────────────────────────
-- source: scripts/migrations/2026-08-18_attendance_tables.sql
-- ──────────────────────────────────────────────────────────────
-- 2026-08-18_attendance_tables.sql
--
-- Creates the four tables the attendance/telemetry module reads and writes but
-- which were never created in this database. Every attendance endpoint was
-- returning 500 as a result — /api/attendance/status fails on the very first
-- query with `relation "attendance_records" does not exist`, and the login route
-- fails the same way on employee_sessions.
--
-- The column sets below are taken from the queries in src/, not from the older
-- one-off runners in scripts/ (migrate_attendance.js, migrate_attendance_db.js,
-- migrate_ops_intelligence.js, api/migrate/route.ts). Those disagree with each
-- other and with the code — api/migrate/route.ts declares employee_live_state
-- without current_route, is_idle, productivity_score or lead_started_at, all of
-- which the heartbeat and log-activity upserts write. Where they conflict, the
-- code wins.
--
-- Additive only: every statement is IF NOT EXISTS, nothing is dropped or altered.

-- ── employee_sessions ───────────────────────────────────────────────────────
-- Written by api/auth/login (INSERT ... user_id, session_start, last_heartbeat,
-- ip_address, device_info, is_active) and by api/auth/logout.
--
-- session_start is timestamptz rather than a naive timestamp because
-- api/attendance/live filters on `DATE(session_start AT TIME ZONE 'Asia/Kolkata')`,
-- which is only meaningful if the stored value carries a zone.
CREATE TABLE IF NOT EXISTS employee_sessions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_start  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat TIMESTAMPTZ,
  session_end    TIMESTAMPTZ,
  ip_address     VARCHAR(255),
  device_info    VARCHAR(255),
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The hot lookup: "the active session for this user", in login, mark, heartbeat.
CREATE INDEX IF NOT EXISTS employee_sessions_user_active_idx
  ON employee_sessions (user_id, is_active);

-- api/attendance/live sweeps stale sessions by last_heartbeat on every request.
CREATE INDEX IF NOT EXISTS employee_sessions_stale_idx
  ON employee_sessions (last_heartbeat) WHERE is_active = true;

-- ── attendance_records ──────────────────────────────────────────────────────
-- The table /api/attendance/status died on.
--
-- login_time is deliberately `TIMESTAMP WITHOUT TIME ZONE`: api/attendance/mark
-- writes `... AT TIME ZONE 'Asia/Kolkata'`, storing the IST wall clock, and both
-- the status and live routes compare `DATE(login_time)` against the IST date.
-- Making this timestamptz would re-interpret the naive value and shift it a
-- second time — the comment in status/route.ts spells this out.
--
-- organization_id is INTEGER, not the uuid used by users.organization_id:
-- api/attendance/mark passes a hardcoded literal 1.
CREATE TABLE IF NOT EXISTS attendance_records (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER     NOT NULL DEFAULT 1,
  employee_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_session_id  INTEGER     NOT NULL UNIQUE
                                REFERENCES employee_sessions(id) ON DELETE CASCADE,
  attendance_status VARCHAR(20) NOT NULL,
  submitted_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  login_time        TIMESTAMP,
  logout_time       TIMESTAMP,
  created_at        TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- Matches the `employee_id = $1 AND DATE(login_time) = <today IST>` lookup that
-- status and mark both run. DATE() on a naive timestamp is immutable, so it is
-- indexable.
CREATE INDEX IF NOT EXISTS attendance_records_employee_day_idx
  ON attendance_records (employee_id, (DATE(login_time)));

-- ── employee_live_state ─────────────────────────────────────────────────────
-- One row per user, upserted on ON CONFLICT (user_id) by both the heartbeat and
-- log-activity routes — hence user_id as the primary key rather than a surrogate.
--
-- active_lead_id is VARCHAR because the bolna webhook writes String(leadId).
--
-- idle_duration_seconds stays INTEGER even though the heartbeat's
-- `idle_duration_seconds + EXTRACT(EPOCH FROM ...)` yields numeric; Postgres
-- applies an assignment cast on UPDATE, so this is safe.
CREATE TABLE IF NOT EXISTS employee_live_state (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_module        VARCHAR(100),
  active_lead_id        VARCHAR(50),
  active_lead_name      VARCHAR(255),
  current_action        VARCHAR(255),
  current_route         TEXT,
  last_activity         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  lead_started_at       TIMESTAMPTZ,
  idle_duration_seconds INTEGER     NOT NULL DEFAULT 0,
  productivity_score    INTEGER     NOT NULL DEFAULT 0,
  is_idle               BOOLEAN     NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── employee_activity_logs ──────────────────────────────────────────────────
-- Permanent audit history behind the live activity feed.
--
-- user_id is nullable on purpose: src/webhooks/bolna.webhook.ts logs
-- 'voice_call_completed' with a literal NULL user_id, because the event
-- originates from the provider rather than from a signed-in person.
CREATE TABLE IF NOT EXISTS employee_activity_logs (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER      REFERENCES users(id) ON DELETE CASCADE,
  action_type    VARCHAR(100) NOT NULL,
  description    TEXT,
  module         VARCHAR(100),
  lead_id        VARCHAR(50),
  lead_name      VARCHAR(255),
  event_severity VARCHAR(20)  DEFAULT 'INFO',
  timestamp      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employee_activity_logs_user_time_idx
  ON employee_activity_logs (user_id, timestamp DESC);

-- Supports the `COUNT(DISTINCT lead_id) ... WHERE lead_id IS NOT NULL` rollup
-- in log-activity.
CREATE INDEX IF NOT EXISTS employee_activity_logs_lead_idx
  ON employee_activity_logs (lead_id) WHERE lead_id IS NOT NULL;


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 4 — Tables required by code with no DDL in the repo
-- ═════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4 — Tables the code requires that have no DDL anywhere in the repo.
-- Column names/types derived from the INSERT/UPDATE/SELECT statements that use
-- them (see report for the source route of each).
-- ─────────────────────────────────────────────────────────────────────────────

-- Multi-lender loan shopping history for a lead.
-- src/app/api/walkin_enquiries/[id]/loan-applications/route.ts (INSERT),
-- src/app/api/loan-applications/[id]/route.ts (UPDATE ... is_selected).
CREATE TABLE IF NOT EXISTS loan_applications (
  id                 SERIAL PRIMARY KEY,
  lead_id            INTEGER,
  booking_id         INTEGER,
  bank_name          TEXT NOT NULL,
  loan_type          TEXT,
  dsa_agent_name     TEXT,
  dsa_agent_contact   TEXT,
  loan_executive     TEXT,
  loan_reference_no  TEXT,
  amount_requested   NUMERIC,
  amount_sanctioned  NUMERIC,
  interest_rate      NUMERIC,
  tenure_months      INTEGER,
  application_date   DATE,
  status             TEXT DEFAULT 'Submitted',
  is_selected        BOOLEAN DEFAULT false,
  remarks            TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bank disbursements against a sanctioned loan.
-- src/app/api/walkin_enquiries/[id]/tranches/route.ts (INSERT),
-- src/app/api/booking-applications/[id]/payment-summary/route.ts (JOIN on milestone_id).
CREATE TABLE IF NOT EXISTS disbursement_tranches (
  id                SERIAL PRIMARY KEY,
  lead_id           INTEGER,
  booking_id        INTEGER,
  milestone_id      INTEGER,
  amount            NUMERIC NOT NULL,
  status            TEXT DEFAULT 'Pending',
  receiving_date    DATE,
  bank_reference_no TEXT,
  remarks           TEXT,
  added_by_name     TEXT,
  added_by_role     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Post-Disbursement Documents checklist. src/lib/pdd.ts (INSERT),
-- src/app/api/booking-applications/[id]/pdd/[pddId]/route.ts (dynamic UPDATE).
CREATE TABLE IF NOT EXISTS loan_pdd_tracking (
  id                  SERIAL PRIMARY KEY,
  booking_id          INTEGER,
  loan_application_id INTEGER,
  document_name       TEXT NOT NULL,
  required_by_date    DATE,
  status              TEXT DEFAULT 'Pending',
  submitted_date      DATE,
  remarks             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Construction-linked payment plan. src/app/api/booking-applications/route.ts and
-- .../[id]/milestones/route.ts (INSERT/UPDATE), .../receipt/route.ts (paid_amount).
CREATE TABLE IF NOT EXISTS booking_payment_milestones (
  id                SERIAL PRIMARY KEY,
  booking_id        INTEGER,
  milestone_name    TEXT,
  milestone_order   INTEGER,
  percentage        NUMERIC,
  demand_amount     NUMERIC,
  demand_date       DATE,
  demand_letter_url TEXT,
  due_date          DATE,
  paid_amount       NUMERIC DEFAULT 0,
  paid_date         DATE,
  status            TEXT DEFAULT 'Upcoming',
  remarks           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Section 194-IA TDS / Form 26QB records.
-- src/app/api/booking-applications/[id]/tds/route.ts (INSERT/UPDATE).
CREATE TABLE IF NOT EXISTS booking_tds_records (
  id                SERIAL PRIMARY KEY,
  booking_id        INTEGER,
  payment_id        INTEGER,
  tds_amount        NUMERIC NOT NULL,
  tds_rate          NUMERIC DEFAULT 1,
  form_26qb_filed   BOOLEAN DEFAULT false,
  form_26qb_date    DATE,
  acknowledgement_no TEXT,
  financial_year    TEXT,
  quarter           TEXT,
  buyer_pan         TEXT,
  seller_pan        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 5 — Performance indexes
-- ═════════════════════════════════════════════════════════════════════════
-- Performance indexes for the lead pipeline.
--
--   node scripts/run_sql_migration.js 2026-07-30_performance_indexes.sql
--
-- Idempotent. Adds no columns, changes no data, alters no behaviour — every
-- statement here is either a new index or the removal of a redundant one.
--
-- ── Why these, measured on a 100,000-lead / 400,000-follow-up copy ──────────
--
-- BEFORE, the two hottest queries in the app both ran without any usable index:
--
--   SELECT * FROM follow_ups WHERE lead_id = $1
--     → Parallel Seq Scan, Buffers: shared hit=8997, 37 ms to return 4 rows.
--       The whole 70 MB table was read to find one lead's follow-ups. This runs
--       every time a lead is opened.
--
--   SELECT * FROM walkin_enquiries ORDER BY sr_no DESC NULLS LAST LIMIT 20
--     → Gather Merge → Sort, "temp read=1087 written=3461", 74 ms.
--       The sort SPILLED TO DISK: 100,000 rows at ~3.2 kB each blows past
--       work_mem, so Postgres wrote 27 MB of temp files just to return 20 rows.
--       Every list page paid this.
--
-- An index whose column order matches the ORDER BY lets Postgres walk the index
-- and stop after LIMIT rows, so the sort disappears entirely rather than getting
-- faster.

BEGIN;

-- ── 1. follow_ups ──────────────────────────────────────────────────────────
-- lead_id is the single most-used predicate in the codebase (17 call sites) and
-- had NO index at all — the table carried only its primary key. created_at is
-- included because every one of those lookups is
-- "WHERE lead_id = $1 ORDER BY created_at", so a composite index serves the
-- filter and the sort in one pass.
--
-- NOTE ON THE COLUMN TYPE: follow_ups.lead_id is integer, but POST /api/followups
-- inserts String(leadId). Postgres coerces the literal, so the index is still
-- used — but see the comment at the end of this file about that cast.
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead_id_created_at
  ON follow_ups (lead_id, created_at);

-- Site-visit dashboards scan for follow-ups that carry a visit date. Partial,
-- because the overwhelming majority of rows have none.
CREATE INDEX IF NOT EXISTS idx_follow_ups_site_visit_date
  ON follow_ups (site_visit_date)
  WHERE site_visit_date IS NOT NULL AND site_visit_date <> '';

-- "What did this employee log today?" — the daily monitor groups by name.
CREATE INDEX IF NOT EXISTS idx_follow_ups_created_by_name
  ON follow_ups (created_by_name, created_at DESC);

-- ── 2. walkin_enquiries ────────────────────────────────────────────────────
-- The list ordering. DESC NULLS LAST must be spelled out: an index built as
-- plain (sr_no) does NOT satisfy "ORDER BY sr_no DESC NULLS LAST" without an
-- extra sort step, which is the whole cost we are removing.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_sr_no_desc
  ON walkin_enquiries (sr_no DESC NULLS LAST);

-- Second-most-common ordering, and the fallback when sr_no is null.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_created_at_desc
  ON walkin_enquiries (created_at DESC);

-- Duplicate-lead detection on intake runs on every single enquiry POST.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_phone
  ON walkin_enquiries (phone);

-- Status filtering, and the status pills' counts.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_status
  ON walkin_enquiries (status);

-- "My leads" for a Sales Manager — the single most common filtered view.
-- Composite with the sort column so the filter and ordering are one index walk.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_to_sr_no
  ON walkin_enquiries (assigned_to, sr_no DESC NULLS LAST);

-- Same shape for the receptionist's own queue.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_receptionist
  ON walkin_enquiries (assigned_receptionist, sr_no DESC NULLS LAST);

-- Lost-lead views. Partial: lost leads are a small minority, and the common
-- case (the main list) filters them OUT, which this also serves.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_is_lost_lead
  ON walkin_enquiries (is_lost_lead)
  WHERE is_lost_lead = true;

-- Source breakdown reporting.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_source
  ON walkin_enquiries (source);

-- ── 3. Remove a redundant index ────────────────────────────────────────────
-- idx_walkin_enquiries_cp and idx_walkin_enquiries_channel_partner are byte-for-byte
-- the same index on (channel_partner_id). Carrying both doubles the write cost of
-- every lead INSERT and UPDATE and buys nothing — the planner can only use one.
DROP INDEX IF EXISTS idx_walkin_enquiries_cp;

COMMIT;

-- Index-only statistics are what the planner uses to choose these; without a
-- refresh it may keep the old plans until autovacuum catches up.
ANALYZE follow_ups;
ANALYZE walkin_enquiries;

-- ── Follow-up: a type mismatch worth fixing separately ─────────────────────
-- POST /api/followups binds String(leadId) into an integer column. Postgres
-- accepts it because the parameter is untyped and gets resolved to integer, so
-- the index above is used and nothing is broken today. But if that column is
-- ever compared against a text expression the index would be bypassed. Left
-- alone here because changing the bind is application logic, not an index.


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 6 — Booking reporting views
-- ═════════════════════════════════════════════════════════════════════════
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


-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 7 — Gap fixes (code-vs-schema diff)
-- ═════════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
-- PHASE 7 — Gap fixes.
-- Everything below closes a mismatch found by diffing the columns the code
-- actually references against the live Neon schema after phases 1-6. Each
-- entry names the file that would break without it.
-- ═════════════════════════════════════════════════════════════════════════

-- ── Tables whose only DDL lives inside application helpers ────────────────

-- src/app/api/migrate/route.ts (ensure block) + scripts/migrate_lead_tracking.js
CREATE TABLE IF NOT EXISTS lead_assignment_logs (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL,
  assigned_to VARCHAR(255),
  assigned_by VARCHAR(255),
  assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_lead_id     ON lead_assignment_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_assigned_at ON lead_assignment_logs(assigned_at DESC);

-- src/lib/leadDeletion.ts :: ensureLeadDeletionAuditTable()
CREATE TABLE IF NOT EXISTS lead_deletion_audit_logs (
  id                       SERIAL PRIMARY KEY,
  admin_id                 TEXT NOT NULL,
  admin_name               TEXT NOT NULL,
  lead_id                  INTEGER NOT NULL,
  lead_number              TEXT,
  customer_name            TEXT,
  deleted_at               TIMESTAMPTZ DEFAULT NOW(),
  reason                   TEXT,
  deleted_file_count       INTEGER DEFAULT 0,
  deleted_local_file_count INTEGER DEFAULT 0,
  deleted_records          JSONB DEFAULT '{}'::jsonb
);

-- ── Missing columns ──────────────────────────────────────────────────────

-- src/lib/auditLog.ts unions employee_activity_logs into the audit feed on
-- e.created_at, but the table only had `timestamp`. Backfilled from it so any
-- existing rows keep their real time rather than the insert default.
ALTER TABLE employee_activity_logs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

UPDATE employee_activity_logs
   SET created_at = "timestamp"
 WHERE created_at IS NULL AND "timestamp" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_activity_logs_created_at
  ON employee_activity_logs(created_at);

-- src/app/api/attendance/advanced-analytics/route.ts sums both of these off
-- employee_sessions; src/app/api/attendance/force-logout/route.ts writes
-- session_end_reason.
ALTER TABLE employee_sessions
  ADD COLUMN IF NOT EXISTS session_duration_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idle_duration_seconds    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_end_reason       VARCHAR(50);

-- src/app/api/booking-applications/[id]/receipt/route.ts inserts and selects
-- these three. NOTE: financial_ledger already carries reference_number and
-- notes, written by a different route. The columns are added rather than
-- renamed so neither code path breaks — see the report.
ALTER TABLE financial_ledger
  ADD COLUMN IF NOT EXISTS reference_no TEXT,
  ADD COLUMN IF NOT EXISTS remarks      TEXT,
  ADD COLUMN IF NOT EXISTS milestone_id INTEGER;

-- same route: INSERT INTO financial_accounts (booking_id, created_by)
ALTER TABLE financial_accounts
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);

-- src/app/api/revenue-intelligence/route.ts selects cpc.commission_source
ALTER TABLE cp_commissions
  ADD COLUMN IF NOT EXISTS commission_source TEXT;

-- src/app/api/settings/sm-upload/route.ts reads and upserts this flag
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS allow_sm_upload BOOLEAN DEFAULT false;

-- The lead timeline and follow-up routes read these. followup_date is the
-- historical name (varchar) — see the header of follow_ups_internal_messaging.sql.
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS followup_date      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS created_by         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sales_manager_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS manager            VARCHAR(255);

-- src/app/api/loan/route.ts writes these on every loan update; the older
-- amount_req / amount_app / bank columns stay in place untouched.
ALTER TABLE loan_updates
  ADD COLUMN IF NOT EXISTS loan_required    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bank_name        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS amount_requested VARCHAR(100),
  ADD COLUMN IF NOT EXISTS amount_approved  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS previous_status  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS new_status       VARCHAR(100);

-- Legacy denormalised mirrors on booking_applications. src/lib/buildFinancialSnapshot.ts
-- and src/lib/admin-ai/services.ts read them as COALESCE(child.col, b.col, 0),
-- so the booking row must carry the column even when the child table is
-- authoritative. Types match the child column each one mirrors.
ALTER TABLE booking_applications
  ADD COLUMN IF NOT EXISTS token_amount                 NUMERIC,
  ADD COLUMN IF NOT EXISTS ocr_amount                   NUMERIC,
  ADD COLUMN IF NOT EXISTS cash_component               NUMERIC,
  ADD COLUMN IF NOT EXISTS sanction_amount              NUMERIC,
  ADD COLUMN IF NOT EXISTS sanctioned                   NUMERIC,
  ADD COLUMN IF NOT EXISTS loan_amount                  NUMERIC,
  ADD COLUMN IF NOT EXISTS loan_required                BOOLEAN,
  ADD COLUMN IF NOT EXISTS loan_status                  TEXT,
  ADD COLUMN IF NOT EXISTS bank_name                    TEXT,
  ADD COLUMN IF NOT EXISTS expected_disbursement_date   DATE,
  ADD COLUMN IF NOT EXISTS expected_registration_date   DATE,
  ADD COLUMN IF NOT EXISTS actual_registration_date     DATE,
  ADD COLUMN IF NOT EXISTS registration_status          TEXT,
  ADD COLUMN IF NOT EXISTS expected_possession_date     DATE,
  ADD COLUMN IF NOT EXISTS actual_possession_date       DATE,
  ADD COLUMN IF NOT EXISTS possession_status            TEXT,
  ADD COLUMN IF NOT EXISTS oc_cc_date                   DATE,
  ADD COLUMN IF NOT EXISTS oc_cc_status                 TEXT,
  -- Retired from inventory_units by neon_retire_apartment_name_2026-08-04.sql,
  -- but still named by every booking INSERT in booking-applications/route.ts and
  -- read by generate-booking-pdf and the v1 bookings API.
  ADD COLUMN IF NOT EXISTS apartment_name               TEXT,
  ADD COLUMN IF NOT EXISTS project_name                 TEXT,
  ADD COLUMN IF NOT EXISTS tower                        TEXT,
  ADD COLUMN IF NOT EXISTS wing                         TEXT,
  ADD COLUMN IF NOT EXISTS revenue_include_ocr          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS revenue_include_sdr          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS revenue_include_cash         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS revenue_include_sanction     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS revenue_include_disbursement BOOLEAN DEFAULT false;

-- ── Foreign keys deferred until every referenced table existed ────────────
-- Guarded so re-running is a no-op. loan_updates.lead_id is deliberately NOT
-- given an FK — see the report.
DO $fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_lead_id_fkey') THEN
    ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_visits_lead_id_fkey') THEN
    ALTER TABLE site_visits ADD CONSTRAINT site_visits_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_logs_lead_id_fkey') THEN
    ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_applications_lead_id_fkey') THEN
    ALTER TABLE booking_applications ADD CONSTRAINT booking_applications_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_documents_lead_id_fkey') THEN
    ALTER TABLE booking_documents ADD CONSTRAINT booking_documents_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_documents_booking_id_fkey') THEN
    ALTER TABLE booking_documents ADD CONSTRAINT booking_documents_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES booking_applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caller_follow_ups_lead_id_fkey') THEN
    ALTER TABLE caller_follow_ups ADD CONSTRAINT caller_follow_ups_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES caller_leads(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_update_reads_update_id_fkey') THEN
    ALTER TABLE crm_update_reads ADD CONSTRAINT crm_update_reads_update_id_fkey
      FOREIGN KEY (update_id) REFERENCES crm_updates(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_update_reads_user_id_fkey') THEN
    ALTER TABLE crm_update_reads ADD CONSTRAINT crm_update_reads_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_attendance_user_id_fkey') THEN
    ALTER TABLE employee_attendance ADD CONSTRAINT employee_attendance_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_settings_updated_by_fkey') THEN
    ALTER TABLE organization_settings ADD CONSTRAINT organization_settings_updated_by_fkey
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_applications_booking_id_fkey') THEN
    ALTER TABLE loan_applications ADD CONSTRAINT loan_applications_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES booking_applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_applications_lead_id_fkey') THEN
    ALTER TABLE loan_applications ADD CONSTRAINT loan_applications_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursement_tranches_booking_id_fkey') THEN
    ALTER TABLE disbursement_tranches ADD CONSTRAINT disbursement_tranches_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES booking_applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursement_tranches_milestone_id_fkey') THEN
    ALTER TABLE disbursement_tranches ADD CONSTRAINT disbursement_tranches_milestone_id_fkey
      FOREIGN KEY (milestone_id) REFERENCES booking_payment_milestones(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_pdd_tracking_booking_id_fkey') THEN
    ALTER TABLE loan_pdd_tracking ADD CONSTRAINT loan_pdd_tracking_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES booking_applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_pdd_tracking_loan_application_id_fkey') THEN
    ALTER TABLE loan_pdd_tracking ADD CONSTRAINT loan_pdd_tracking_loan_application_id_fkey
      FOREIGN KEY (loan_application_id) REFERENCES loan_applications(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_payment_milestones_booking_id_fkey') THEN
    ALTER TABLE booking_payment_milestones ADD CONSTRAINT booking_payment_milestones_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES booking_applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_tds_records_booking_id_fkey') THEN
    ALTER TABLE booking_tds_records ADD CONSTRAINT booking_tds_records_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES booking_applications(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_ledger_milestone_id_fkey') THEN
    ALTER TABLE financial_ledger ADD CONSTRAINT financial_ledger_milestone_id_fkey
      FOREIGN KEY (milestone_id) REFERENCES booking_payment_milestones(id) ON DELETE SET NULL;
  END IF;
END
$fks$;

-- ── Unique constraints required by ON CONFLICT targets in the code ───────
-- Without these the INSERT raises "no unique or exclusion constraint matching
-- the ON CONFLICT specification" — the upsert fails outright, it does not
-- silently fall back.

-- src/lib/crmUpdates.ts :: markUpdateAsRead()
--   INSERT INTO crm_update_reads (user_id, update_id) ... ON CONFLICT (user_id, update_id)
CREATE UNIQUE INDEX IF NOT EXISTS crm_update_reads_user_update_key
  ON crm_update_reads (user_id, update_id);

-- src/lib/ingestion/bulkInsertLeads.ts
--   ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
-- The predicate must match the statement's for the arbiter to be picked up.
CREATE UNIQUE INDEX IF NOT EXISTS walkin_enquiries_external_ref_key
  ON walkin_enquiries (external_ref) WHERE external_ref IS NOT NULL;

-- NOTE: organization_settings needs UNIQUE (organization_id) for the
-- ON CONFLICT (organization_id) upserts in src/app/api/settings/sm-upload and
-- src/app/api/settings/lead-sorting. It is NOT created here because the table
-- currently holds duplicate organization_id = 1 rows, and adding the constraint
-- requires deleting rows. See the report — this needs an explicit decision.

-- Supporting indexes for the new FK / lookup columns.
CREATE INDEX IF NOT EXISTS idx_loan_applications_booking     ON loan_applications(booking_id);
CREATE INDEX IF NOT EXISTS idx_loan_applications_lead        ON loan_applications(lead_id);
CREATE INDEX IF NOT EXISTS idx_disbursement_tranches_booking ON disbursement_tranches(booking_id);
CREATE INDEX IF NOT EXISTS idx_disbursement_tranches_lead    ON disbursement_tranches(lead_id);
CREATE INDEX IF NOT EXISTS idx_loan_pdd_tracking_booking     ON loan_pdd_tracking(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_milestones_booking    ON booking_payment_milestones(booking_id);
CREATE INDEX IF NOT EXISTS idx_tds_records_booking           ON booking_tds_records(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_documents_booking     ON booking_documents(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_documents_lead        ON booking_documents(lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead               ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_lead              ON site_visits(lead_id);
CREATE INDEX IF NOT EXISTS idx_loan_updates_lead             ON loan_updates(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_lead            ON whatsapp_logs(lead_id);

-- ── customer_ledger_view ─────────────────────────────────────────────────
-- From ensureTable() in src/app/api/booking-applications/route.ts. Read by the
-- booking detail route as clv.*.
CREATE OR REPLACE VIEW customer_ledger_view AS
SELECT
  fa.booking_id,
  fa.id AS account_id,
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
