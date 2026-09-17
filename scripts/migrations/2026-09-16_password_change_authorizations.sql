-- 2026-09-16: Password-change authorization tokens.
--
-- After OTP verification, the server creates a short-lived, single-use
-- authorization that permits exactly one password change. Only the
-- HMAC-SHA256 hash of the token is stored; the raw token is returned to
-- the client once and never persisted.
--
-- This separates "proved email control" (OTP) from "permitted to change
-- password" (authorization), so the frontend cannot skip the OTP step by
-- declaring itself authorized.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS password_change_authorizations (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose         VARCHAR(64)  NOT NULL,
  token_hash      VARCHAR(64)  NOT NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,
  consumed_at     TIMESTAMPTZ,
  organization_id UUID,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pw_change_auth_lookup
  ON password_change_authorizations (user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;
