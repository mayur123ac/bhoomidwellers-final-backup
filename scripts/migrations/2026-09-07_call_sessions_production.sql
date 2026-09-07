-- Production-readiness hardening for call_sessions.
--
-- 1. Unique constraint on recording_r2_key prevents double-upload at the DB level.
-- 2. Index on user_id speeds up ownership queries (every PATCH/upload/complete checks it).
-- 3. Index on (phone_number, started_at) for call-log dedup lookups.

-- Prevent two sessions from ever sharing the same R2 recording key.
-- NULL values are excluded (many sessions will never have a recording).
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_sessions_recording_unique
  ON call_sessions (recording_r2_key)
  WHERE recording_r2_key IS NOT NULL;

-- Ownership lookups: WHERE user_id = $x AND organization_id = $y
CREATE INDEX IF NOT EXISTS idx_call_sessions_user
  ON call_sessions (user_id, organization_id);

-- Call-log dedup: find recent sessions for the same phone number.
CREATE INDEX IF NOT EXISTS idx_call_sessions_phone_time
  ON call_sessions (phone_number, started_at DESC);
