-- 2026-10-18_hr_profitability_production.sql
--
-- HR Profitability Dashboard: brokerage configuration, per-booking brokerage
-- tracking, employee resource expenses, and audit trail.
--
-- CONTEXT:
--   The Financial Overview in the HR panel queries these four tables:
--     booking_brokerage, project_brokerage_config, employee_resource_expenses,
--     brokerage_audit_log
--   Plus two new columns on the existing organization_settings table.
--   None of these exist in production yet → "relation does not exist" errors.
--
-- PREREQUISITES (verified present on ep-long-cloud):
--   organizations(id)        UUID PK
--   organization_settings    organization_id is UUID (confirmed by HR Phase 2 reconciliation)
--   users(id)                INTEGER PK
--   booking_applications(id) INTEGER PK, has organization_id UUID
--   payroll_records, payroll_periods (HR Phase 3, already applied)
--
-- SAFETY:
--   All CREATE TABLE use IF NOT EXISTS.
--   ALTER TABLE ADD COLUMN uses IF NOT EXISTS.
--   No destructive changes. No data modification. No fake data insertion.
--   Wrapped in a transaction — rolls back completely on any error.
--
-- INSTRUCTIONS FOR NEON SQL EDITOR:
--   1. Connect to ep-long-cloud (production)
--   2. Paste this entire file into the SQL Editor
--   3. Execute — it runs as a single transaction
--   4. Verify: SELECT table_name FROM information_schema.tables
--             WHERE table_name IN ('booking_brokerage','project_brokerage_config',
--                                  'employee_resource_expenses','brokerage_audit_log');
--      Should return 4 rows.
--   5. Verify columns: SELECT column_name FROM information_schema.columns
--             WHERE table_name = 'organization_settings'
--               AND column_name IN ('default_brokerage_rate','default_brokerage_method');
--      Should return 2 rows.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extend organization_settings with global brokerage defaults
-- ═══════════════════════════════════════════════════════════════════════════
-- These columns store the org-wide default brokerage rate applied to new
-- bookings when no project-specific or manual override is provided.
-- The CHECK constraint on default_brokerage_method is added separately
-- because ADD COLUMN IF NOT EXISTS + inline CHECK can conflict on re-run.

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS default_brokerage_rate    NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_brokerage_method  VARCHAR(20)  DEFAULT 'percentage';

-- Add CHECK constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_settings_default_brokerage_method_check'
  ) THEN
    ALTER TABLE organization_settings
      ADD CONSTRAINT organization_settings_default_brokerage_method_check
      CHECK (default_brokerage_method IN ('percentage', 'fixed'));
  END IF;
END$$;

-- Brokerage calculation basis: which booking financial field to use.
-- Valid bases:
--   agreement_value     (NUMERIC on booking_applications)
--   booking_amount      (NUMERIC on booking_applications)
--   ocr_amount          (NUMERIC on booking_financials)
--   disbursement_amount (NUMERIC on booking_loan_details)
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS brokerage_calculation_basis VARCHAR(30) DEFAULT 'agreement_value';

-- Drop old 2-value constraint if present, then create with all 4 values
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_settings_brokerage_calculation_basis_check'
  ) THEN
    ALTER TABLE organization_settings
      DROP CONSTRAINT organization_settings_brokerage_calculation_basis_check;
  END IF;

  ALTER TABLE organization_settings
    ADD CONSTRAINT organization_settings_brokerage_calculation_basis_check
    CHECK (brokerage_calculation_basis IN ('agreement_value', 'booking_amount', 'ocr_amount', 'disbursement_amount'));
END$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Project-level brokerage overrides
-- ═══════════════════════════════════════════════════════════════════════════
-- Allows admins to set a different brokerage rate for specific projects.
-- Takes precedence over the global default.
-- UNIQUE constraint on (organization_id, project_name) enables upsert.

CREATE TABLE IF NOT EXISTS project_brokerage_config (
  id                SERIAL       PRIMARY KEY,
  organization_id   UUID         NOT NULL,
  project_name      TEXT         NOT NULL,
  brokerage_rate    NUMERIC(7,4) NOT NULL CHECK (brokerage_rate >= 0),
  brokerage_method  VARCHAR(20)  NOT NULL DEFAULT 'percentage'
    CHECK (brokerage_method IN ('percentage', 'fixed')),
  effective_from    DATE         NOT NULL DEFAULT CURRENT_DATE,
  effective_to      DATE,
  notes             TEXT,
  created_by        INTEGER      REFERENCES users(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_project_brokerage_active
    UNIQUE (organization_id, project_name)
);

CREATE INDEX IF NOT EXISTS idx_project_brokerage_org
  ON project_brokerage_config (organization_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Per-booking brokerage snapshot & payment tracking
-- ═══════════════════════════════════════════════════════════════════════════
-- Each booking gets at most one brokerage record (enforced by UNIQUE).
-- Snapshots the agreement value and brokerage terms at creation time.
-- Tracks payment status: expected → partially_received → received.
-- The "source" field records which precedence level set the rate:
--   global_default, project_override, or manual_override.

CREATE TABLE IF NOT EXISTS booking_brokerage (
  id                      SERIAL        PRIMARY KEY,
  booking_id              INTEGER       NOT NULL REFERENCES booking_applications(id),
  organization_id         UUID          NOT NULL,
  -- Snapshot at creation time
  brokerage_method        VARCHAR(20)   NOT NULL DEFAULT 'percentage'
    CHECK (brokerage_method IN ('percentage', 'fixed')),
  brokerage_rate          NUMERIC(7,4)  NOT NULL CHECK (brokerage_rate >= 0),
  agreement_value_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0,
  brokerage_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Which financial field was used for calculation (historical snapshot)
  calculation_basis       VARCHAR(30)   NOT NULL DEFAULT 'agreement_value'
    CHECK (calculation_basis IN ('agreement_value', 'booking_amount', 'ocr_amount', 'disbursement_amount')),
  -- Source precedence
  source                  VARCHAR(30)   NOT NULL DEFAULT 'global_default'
    CHECK (source IN ('global_default', 'project_override', 'manual_override')),
  -- Payment tracking
  status                  VARCHAR(30)   NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'received', 'partially_received', 'pending', 'reversed')),
  received_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_date           DATE,
  reversal_reason         TEXT,
  notes                   TEXT,
  -- Audit
  created_by              INTEGER       REFERENCES users(id),
  updated_by              INTEGER       REFERENCES users(id),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_booking_brokerage
    UNIQUE (booking_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_brokerage_org
  ON booking_brokerage (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_brokerage_created
  ON booking_brokerage (organization_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Employee resource expenses
-- ═══════════════════════════════════════════════════════════════════════════
-- Tracks company-provided resources (phones, laptops, etc.) allocated to
-- employees. Supports one-time costs and monthly cost spreading.
-- The profitability API uses these to calculate total employee costs.

CREATE TABLE IF NOT EXISTS employee_resource_expenses (
  id                  SERIAL        PRIMARY KEY,
  user_id             INTEGER       NOT NULL REFERENCES users(id),
  organization_id     UUID          NOT NULL,
  expense_type        VARCHAR(30)   NOT NULL
    CHECK (expense_type IN ('phone', 'laptop', 'furniture', 'travel', 'software', 'other')),
  description         TEXT          NOT NULL,
  purchase_date       DATE          NOT NULL,
  purchase_cost       NUMERIC(14,2) NOT NULL CHECK (purchase_cost > 0),
  -- Allocation
  allocation_method   VARCHAR(20)   NOT NULL DEFAULT 'one_time'
    CHECK (allocation_method IN ('one_time', 'monthly')),
  allocation_months   INTEGER       DEFAULT 1 CHECK (allocation_months >= 1),
  monthly_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  allocation_start    DATE,
  allocation_end      DATE,
  -- Classification
  is_company_expense  BOOLEAN       NOT NULL DEFAULT true,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'written_off')),
  -- Audit
  created_by          INTEGER       REFERENCES users(id),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_expenses_org
  ON employee_resource_expenses (organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_resource_expenses_period
  ON employee_resource_expenses (organization_id, allocation_start, allocation_end);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Brokerage audit log
-- ═══════════════════════════════════════════════════════════════════════════
-- Immutable trail of all brokerage configuration and booking brokerage
-- changes. Every create, update, and delete is recorded with old/new JSONB.

CREATE TABLE IF NOT EXISTS brokerage_audit_log (
  id              SERIAL       PRIMARY KEY,
  organization_id UUID         NOT NULL,
  entity_type     VARCHAR(30)  NOT NULL
    CHECK (entity_type IN ('global_config', 'project_config', 'booking_brokerage')),
  entity_id       INTEGER,
  action          VARCHAR(30)  NOT NULL
    CHECK (action IN ('created', 'updated', 'deleted')),
  old_values      JSONB,
  new_values      JSONB,
  changed_by      INTEGER      REFERENCES users(id),
  changed_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brokerage_audit_org
  ON brokerage_audit_log (organization_id, changed_at DESC);

COMMIT;
