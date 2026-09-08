-- Follow-up file attachments.
--
-- One follow-up can have multiple attachments (images, PDFs, documents).
-- Binary data lives in Cloudflare R2; this table stores metadata + the R2
-- object key only.
--
-- Follows the same conventions as booking_documents:
--   SERIAL id, organization_id UUID, object_key TEXT, presigned download.

CREATE TABLE IF NOT EXISTS follow_up_attachments (
  id              SERIAL       PRIMARY KEY,
  organization_id UUID         NOT NULL,
  follow_up_id    INTEGER      NOT NULL,
  uploaded_by     INTEGER,                          -- users.id
  file_name       TEXT         NOT NULL,
  mime_type       VARCHAR(255) NOT NULL,
  file_size       INTEGER      NOT NULL DEFAULT 0,  -- bytes
  r2_object_key   TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Lookup: "all attachments for this follow-up"
CREATE INDEX IF NOT EXISTS idx_fua_follow_up_id
  ON follow_up_attachments (follow_up_id);

-- Tenant isolation: every query must include organization_id
CREATE INDEX IF NOT EXISTS idx_fua_organization_id
  ON follow_up_attachments (organization_id);

-- Composite for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_fua_org_follow_up
  ON follow_up_attachments (organization_id, follow_up_id);
