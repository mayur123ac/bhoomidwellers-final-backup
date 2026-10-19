-- 2026-10-19_creative_studio_gallery.sql
--
-- Creative Studio: gallery table for saved AI-generated images.
--
-- SAFETY:
--   CREATE TABLE uses IF NOT EXISTS.
--   No destructive changes. No data modification.
--   Wrapped in a transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS creative_studio_gallery (
  id              SERIAL      PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  r2_key          TEXT        NOT NULL,
  prompt          TEXT        NOT NULL DEFAULT '',
  mode            TEXT        NOT NULL DEFAULT 'generate',
  template_id     TEXT,
  size            TEXT        NOT NULL DEFAULT '1024x1024',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_creative_studio_gallery_org
  ON creative_studio_gallery(organization_id, created_at DESC);

COMMIT;
