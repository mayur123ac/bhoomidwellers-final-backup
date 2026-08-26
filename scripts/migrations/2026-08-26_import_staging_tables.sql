-- 2026-08-26  Import staging infrastructure
-- ================================================================
--
-- Adds three tables that support bulk-import of leads (and eventually
-- other entities) via Excel/CSV upload:
--
--   import_jobs   — one row per uploaded file; tracks overall progress
--                   and status through the upload > parse > review >
--                   commit > (optional rollback) lifecycle.
--
--   import_rows   — one row per spreadsheet row; holds the raw and
--                   normalised data, validation outcome, and the
--                   proposed / final action (create, update, skip …).
--
--   import_errors — granular error/warning log per row per field,
--                   used to build the review UI and the downloadable
--                   error report.
--
-- Also adds import_job_id to walkin_enquiries so committed rows can be
-- traced back to their import job (and bulk-rolled-back if needed).
--
-- Safe to re-run (all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ================================================================


-- ── 1. import_jobs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_jobs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  uploaded_by_id        INTEGER       NOT NULL,
  uploaded_by_name      VARCHAR(255)  NOT NULL,
  filename              VARCHAR(500)  NOT NULL,
  file_hash             VARCHAR(64),
  file_size_bytes       INTEGER,
  import_type           VARCHAR(50)   NOT NULL DEFAULT 'leads',
  target_entity         VARCHAR(50)   NOT NULL DEFAULT 'walkin_enquiries',
  status                VARCHAR(30)   NOT NULL DEFAULT 'uploaded'
                        CHECK (status IN (
                          'uploaded','parsing','parsed','ready_for_review',
                          'committing','completed','failed','cancelled',
                          'rolling_back','rolled_back'
                        )),
  total_rows            INTEGER       NOT NULL DEFAULT 0,
  valid_rows            INTEGER       NOT NULL DEFAULT 0,
  invalid_rows          INTEGER       NOT NULL DEFAULT 0,
  created_rows          INTEGER       NOT NULL DEFAULT 0,
  updated_rows          INTEGER       NOT NULL DEFAULT 0,
  skipped_rows          INTEGER       NOT NULL DEFAULT 0,
  failed_rows           INTEGER       NOT NULL DEFAULT 0,
  sheet_name            VARCHAR(255),
  column_mapping        JSONB,
  assigned_to           VARCHAR(255),
  overseeing_site_head  VARCHAR(255),
  error_summary         TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  rolled_back_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_org
  ON import_jobs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status
  ON import_jobs (status)
  WHERE status NOT IN ('completed','cancelled','rolled_back');


-- ── 2. import_rows ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_rows (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id         UUID          NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  organization_id       UUID          NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_row_number     INTEGER       NOT NULL,
  source_sheet          VARCHAR(255),
  raw_data              JSONB         NOT NULL,
  normalized_data       JSONB,
  validation_status     VARCHAR(20)   NOT NULL DEFAULT 'pending'
                        CHECK (validation_status IN ('pending','valid','invalid')),
  proposed_action       VARCHAR(20)   NOT NULL DEFAULT 'create'
                        CHECK (proposed_action IN ('create','update','skip','manual_review','error')),
  final_action          VARCHAR(20)
                        CHECK (final_action IN ('created','updated','skipped','failed','rolled_back')),
  matched_record_id     INTEGER,
  target_record_id      INTEGER,
  warnings              JSONB         DEFAULT '[]'::jsonb,
  errors                JSONB         DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_rows_job
  ON import_rows (import_job_id, source_row_number);

CREATE INDEX IF NOT EXISTS idx_import_rows_job_status
  ON import_rows (import_job_id, validation_status);

CREATE INDEX IF NOT EXISTS idx_import_rows_target
  ON import_rows (target_record_id)
  WHERE target_record_id IS NOT NULL;


-- ── 3. import_errors ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_errors (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id         UUID          NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  import_row_id         UUID          REFERENCES import_rows(id) ON DELETE CASCADE,
  organization_id       UUID          NOT NULL REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_row_number     INTEGER,
  source_field          VARCHAR(100),
  error_code            VARCHAR(50)   NOT NULL,
  error_message         TEXT          NOT NULL,
  severity              VARCHAR(20)   NOT NULL DEFAULT 'error'
                        CHECK (severity IN ('error','warning','info')),
  original_value        TEXT,
  normalized_value      TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_errors_job
  ON import_errors (import_job_id);

CREATE INDEX IF NOT EXISTS idx_import_errors_row
  ON import_errors (import_row_id)
  WHERE import_row_id IS NOT NULL;


-- ── 4. Backlink: walkin_enquiries.import_job_id ────────────────────────────────
-- Allows rollback by DELETE FROM walkin_enquiries WHERE import_job_id = $1,
-- and lets the UI show "imported via <job>" on each lead.

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS import_job_id UUID REFERENCES import_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_import_job
  ON walkin_enquiries (import_job_id)
  WHERE import_job_id IS NOT NULL;
