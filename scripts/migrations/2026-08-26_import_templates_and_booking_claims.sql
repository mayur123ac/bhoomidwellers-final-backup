-- Phase 2 of the Excel import architecture.
--
-- Two new tables:
--
--   import_templates
--     Saved column-mapping configurations per organization. When a user maps
--     Excel columns to CRM fields during an import, the mapping can be saved
--     as a named template so subsequent imports of the same format skip the
--     mapping step entirely. Each org may have one default template per
--     import_type (enforced by a partial unique index).
--
--   historical_booking_claims
--     Non-financial booking data extracted from Excel imports. These rows do
--     NOT create live booking_applications records; they exist purely for
--     reconciliation. An import row that says "booked on 15-Jun, 2L" lands
--     here so a human can later match it to a real booking or flag it as
--     unreconciled. The requires_reconciliation / reconciled_at pair drives
--     the reconciliation queue.
--
-- Also adds a template_id FK on import_jobs so each job can record which
-- saved template was used for its column mapping.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- ── import_templates ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_templates (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID          NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name                VARCHAR(255)  NOT NULL,
  import_type         VARCHAR(50)   NOT NULL DEFAULT 'leads',
  target_entity       VARCHAR(50)   NOT NULL DEFAULT 'walkin_enquiries',
  mappings            JSONB         NOT NULL DEFAULT '{}'::jsonb,
  ignored_columns     JSONB         DEFAULT '[]'::jsonb,
  value_mappings      JSONB         DEFAULT '{}'::jsonb,
  date_format         VARCHAR(30)   DEFAULT 'DD/MM/YYYY',
  is_default          BOOLEAN       NOT NULL DEFAULT false,
  version             INTEGER       NOT NULL DEFAULT 1,
  created_by_id       INTEGER,
  created_by_name     VARCHAR(255),
  updated_by_name     VARCHAR(255),
  status              VARCHAR(20)   NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive')),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Primary lookup: "all active templates for this org", with defaults first.
CREATE INDEX IF NOT EXISTS idx_import_templates_org
  ON import_templates (organization_id, status, is_default DESC);

-- Only one default template per org per import_type.
CREATE UNIQUE INDEX IF NOT EXISTS ux_import_templates_default
  ON import_templates (organization_id, import_type)
  WHERE is_default = true AND status = 'active';

-- ── historical_booking_claims ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS historical_booking_claims (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID          NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  lead_id                   INTEGER       REFERENCES walkin_enquiries(id) ON DELETE SET NULL,
  import_job_id             UUID          REFERENCES import_jobs(id) ON DELETE SET NULL,
  import_row_id             UUID          REFERENCES import_rows(id) ON DELETE SET NULL,
  claimed_booked            BOOLEAN       NOT NULL DEFAULT false,
  booking_date              DATE,
  booking_amount            NUMERIC(14,2),
  booking_amount_raw        TEXT,
  booking_reference         VARCHAR(100),
  source_row_number         INTEGER,
  source_filename           VARCHAR(500),
  requires_reconciliation   BOOLEAN       NOT NULL DEFAULT true,
  reconciled_at             TIMESTAMPTZ,
  reconciled_by             VARCHAR(255),
  reconciled_booking_id     INTEGER       REFERENCES booking_applications(id) ON DELETE SET NULL,
  notes                     TEXT,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Org-scoped timeline (dashboard, list views).
CREATE INDEX IF NOT EXISTS idx_hbc_org
  ON historical_booking_claims (organization_id, created_at DESC);

-- Lead detail panel: "booking claims linked to this lead".
CREATE INDEX IF NOT EXISTS idx_hbc_lead
  ON historical_booking_claims (lead_id) WHERE lead_id IS NOT NULL;

-- Import job detail: "booking claims from this import run".
CREATE INDEX IF NOT EXISTS idx_hbc_import_job
  ON historical_booking_claims (import_job_id) WHERE import_job_id IS NOT NULL;

-- Reconciliation queue: "unreconciled claims for this org".
CREATE INDEX IF NOT EXISTS idx_hbc_unreconciled
  ON historical_booking_claims (organization_id)
  WHERE requires_reconciliation = true AND reconciled_at IS NULL;

-- ── import_jobs.template_id ─────────────────────────────────────────────────
-- Track which saved template was used for a given import job.

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES import_templates(id) ON DELETE SET NULL;

COMMIT;
