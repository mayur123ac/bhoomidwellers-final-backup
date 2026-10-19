-- 2026-10-18_profitability_brokerage.sql
--
-- HR Profitability Dashboard: brokerage config, booking brokerage tracking,
-- employee resource expenses, and audit trail.
--
-- Prerequisites: booking_applications, users, organization_settings must exist.
-- Safe to re-run: all CREATE statements use IF NOT EXISTS.

BEGIN;

-- ─── 1. Extend organization_settings with brokerage defaults ─────────────────

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS default_brokerage_rate    NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_brokerage_method  VARCHAR(20)  DEFAULT 'percentage'
    CHECK (default_brokerage_method IN ('percentage', 'fixed'));

-- ─── 2. Project-level brokerage overrides ────────────────────────────────────

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

-- ─── 3. Per-booking brokerage snapshot & tracking ────────────────────────────

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

-- ─── 4. Employee resource expenses ───────────────────────────────────────────

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

-- ─── 5. Brokerage audit log ──────────────────────────────────────────────────

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
