-- 2026-10-17_hr_phase1_employee_profiles.sql
--
-- Phase 1 of the HR panel: employee profiles, employment history, salary
-- history, documents, compliance tasks, and company assets.
--
-- Additive only. Every statement is IF NOT EXISTS or guarded by DO $$.
-- Safe to rerun.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extend users table with HR profile columns
-- ═══════════════════════════════════════════════════════════════════════════
-- `department` and `reporting_manager_id` already exist (2026-08-18 sync).
-- Add the remaining HR fields.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS designation            VARCHAR(150),
  ADD COLUMN IF NOT EXISTS employee_code          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS date_of_birth          DATE,
  ADD COLUMN IF NOT EXISTS joining_date           DATE,
  ADD COLUMN IF NOT EXISTS employment_status      VARCHAR(30) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS employment_type        VARCHAR(30) DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS personal_phone         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS blood_group            VARCHAR(5),
  ADD COLUMN IF NOT EXISTS current_address         TEXT,
  ADD COLUMN IF NOT EXISTS permanent_address       TEXT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Employment history (previous employers)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_employment_history (
  id               SERIAL       PRIMARY KEY,
  user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  UUID         NOT NULL,
  company_name     VARCHAR(255) NOT NULL,
  designation      VARCHAR(150),
  employment_start DATE,
  employment_end   DATE,
  reason_for_leaving TEXT,
  previous_salary  NUMERIC(14,2),
  remarks          TEXT,
  created_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_history_user
  ON employee_employment_history (user_id, organization_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Salary history (effective-dated, never overwritten)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id              SERIAL       PRIMARY KEY,
  user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID         NOT NULL,
  base_salary     NUMERIC(14,2) NOT NULL,
  effective_from  DATE          NOT NULL,
  effective_to    DATE,
  revision_reason TEXT,
  created_by      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Only one active (effective_to IS NULL) salary per employee per org.
CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_active_unique
  ON employee_salary_history (user_id, organization_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_salary_user
  ON employee_salary_history (user_id, organization_id, effective_from DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Employee documents (metadata only; content in R2)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_documents (
  id                 SERIAL       PRIMARY KEY,
  user_id            INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id    UUID         NOT NULL,
  document_type      VARCHAR(50)  NOT NULL,
  file_name          TEXT         NOT NULL,
  r2_key             TEXT         NOT NULL,
  mime_type          VARCHAR(100),
  file_size          INTEGER,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  verified_by        INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  rejection_reason   TEXT,
  expiry_date        DATE,
  version            INTEGER      NOT NULL DEFAULT 1,
  superseded_by      INTEGER      REFERENCES employee_documents(id),
  uploaded_by        INTEGER      NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_user
  ON employee_documents (user_id, organization_id, document_type);

CREATE INDEX IF NOT EXISTS idx_emp_docs_verification
  ON employee_documents (organization_id, verification_status)
  WHERE verification_status IN ('pending', 'rejected');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. HR compliance tasks (missing-document deadlines)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_compliance_tasks (
  id              SERIAL       PRIMARY KEY,
  user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID         NOT NULL,
  document_type   VARCHAR(50)  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
  deadline        DATE,
  assigned_hr_id  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolved_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Idempotent: only one open task per employee per document type per org.
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_task_dedup
  ON hr_compliance_tasks (user_id, organization_id, document_type)
  WHERE status IN ('pending', 'overdue');

CREATE INDEX IF NOT EXISTS idx_compliance_tasks_org
  ON hr_compliance_tasks (organization_id, status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Company assets
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS company_assets (
  id              SERIAL        PRIMARY KEY,
  organization_id UUID          NOT NULL,
  asset_type      VARCHAR(50)   NOT NULL,
  asset_name      VARCHAR(255)  NOT NULL,
  serial_number   VARCHAR(100),
  make_model      VARCHAR(255),
  purchase_date   DATE,
  purchase_value  NUMERIC(14,2),
  current_condition VARCHAR(30) NOT NULL DEFAULT 'good',
  asset_status    VARCHAR(20)   NOT NULL DEFAULT 'available',
  remarks         TEXT,
  created_by      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_org
  ON company_assets (organization_id, asset_status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Employee asset assignments (issue/return history)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_asset_assignments (
  id              SERIAL       PRIMARY KEY,
  asset_id        INTEGER      NOT NULL REFERENCES company_assets(id) ON DELETE CASCADE,
  user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID         NOT NULL,
  assigned_date   DATE         NOT NULL DEFAULT CURRENT_DATE,
  expected_return DATE,
  returned_date   DATE,
  condition_on_return VARCHAR(30),
  remarks         TEXT,
  assigned_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  returned_to     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_assign_user
  ON employee_asset_assignments (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_asset_assign_asset
  ON employee_asset_assignments (asset_id)
  WHERE returned_date IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Mandatory document checklist configuration
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_mandatory_documents (
  id              SERIAL       PRIMARY KEY,
  organization_id UUID         NOT NULL,
  document_type   VARCHAR(50)  NOT NULL,
  label           VARCHAR(100) NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mandatory_docs_dedup
  ON hr_mandatory_documents (organization_id, document_type);

-- Seed default mandatory documents for existing organizations.
INSERT INTO hr_mandatory_documents (organization_id, document_type, label, sort_order)
SELECT o.id, dt.type, dt.label, dt.sort
FROM organizations o
CROSS JOIN (VALUES
  ('aadhaar',         'Aadhaar Card',                    1),
  ('pan',             'PAN Card',                        2),
  ('joining_letter',  'Joining Letter',                  3),
  ('experience_cert', 'Experience Certificate',          4),
  ('relieving_letter','Relieving Letter',                5)
) AS dt(type, label, sort)
ON CONFLICT (organization_id, document_type) DO NOTHING;

COMMIT;
