-- Phase 4A: HR Connect — employee-to-HR private request system
-- Run against Neon (ep-long-cloud) after review.

BEGIN;

-- ── hr_requests ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_requests (
  id              SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  requester_id    INTEGER NOT NULL REFERENCES users(id),
  assigned_hr_id  INTEGER REFERENCES users(id),

  category        TEXT NOT NULL CHECK (category IN (
    'leave', 'salary', 'attendance', 'documents', 'policy', 'grievance', 'other'
  )),
  subject         TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'in_progress', 'awaiting_employee', 'resolved', 'closed'
  )),

  resolved_at     TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_requests_org
  ON hr_requests (organization_id);
CREATE INDEX IF NOT EXISTS idx_hr_requests_requester
  ON hr_requests (organization_id, requester_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_requests_status
  ON hr_requests (organization_id, status, created_at DESC);

-- ── hr_request_messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_request_messages (
  id              SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  request_id      INTEGER NOT NULL REFERENCES hr_requests(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  attachment_key  TEXT,           -- R2 object key, nullable
  attachment_name TEXT,           -- original filename
  is_internal     BOOLEAN NOT NULL DEFAULT FALSE,  -- HR-only internal notes
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_request_messages_request
  ON hr_request_messages (request_id, created_at ASC);

COMMIT;
