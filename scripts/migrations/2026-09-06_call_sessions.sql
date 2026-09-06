-- call_sessions: tracks manual SIM calls placed via tel: links.
-- Separate from bolna_calls (which has Bolna-specific columns).
--
-- Status values:
--   initiated           session created, dialer about to open
--   calling             dialer opened (client-side transition)
--   completed           call finished, no recording workflow
--   cancelled           user dismissed the modal / never called
--   missed              call log shows missed/rejected/zero-duration
--   recording_pending   call completed, searching for recording
--   recording_detected  recording found, awaiting user confirmation
--   recording_attached  recording confirmed and uploaded
--   recording_unavailable  no recording found / user skipped
--   upload_failed       upload attempted but failed

CREATE TABLE IF NOT EXISTS call_sessions (
  id                SERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL,
  lead_id           INTEGER REFERENCES walkin_enquiries(id) ON DELETE SET NULL,
  caller_lead_id    INTEGER REFERENCES caller_leads(id) ON DELETE SET NULL,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  user_name         VARCHAR(255) NOT NULL,
  phone_number      VARCHAR(20) NOT NULL,
  status            VARCHAR(32) NOT NULL DEFAULT 'initiated',
  direction         VARCHAR(16) NOT NULL DEFAULT 'outbound',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  call_log_duration INTEGER,
  call_log_date     TIMESTAMPTZ,
  call_log_type     VARCHAR(32),
  recording_r2_key  TEXT,
  recording_size    BIGINT,
  recording_duration INTEGER,
  recording_mime    VARCHAR(64),
  follow_up_id      INTEGER REFERENCES follow_ups(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_lead ON call_sessions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_org ON call_sessions(organization_id);
