-- 2026-10-19_email_trigger_config.sql
--
-- Email Configuration Center: per-trigger enabled/disabled state, custom
-- subject and body, and audit trail for admin edits.
--
-- CONTEXT:
--   The Admin → Settings → Email Configuration page lets administrators
--   independently enable/disable each transactional email trigger and
--   customise its subject and body. The configuration is enforced by
--   EmailService before every send.
--
-- SAFETY:
--   CREATE TABLE uses IF NOT EXISTS.
--   No destructive changes. No data modification.
--   Wrapped in a transaction — rolls back completely on any error.

BEGIN;

CREATE TABLE IF NOT EXISTS email_trigger_config (
  trigger_key       TEXT        PRIMARY KEY,
  display_name      TEXT        NOT NULL,
  category          TEXT        NOT NULL DEFAULT 'general',
  description       TEXT        NOT NULL DEFAULT '',
  recipient_desc    TEXT        NOT NULL DEFAULT '',
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  custom_subject    TEXT,
  custom_body       TEXT,
  default_subject   TEXT        NOT NULL DEFAULT '',
  default_body      TEXT        NOT NULL DEFAULT '',
  variables         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        INTEGER     REFERENCES users(id) ON DELETE SET NULL
);

-- Index for listing by category
CREATE INDEX IF NOT EXISTS idx_email_trigger_config_category
  ON email_trigger_config(category);

COMMIT;
