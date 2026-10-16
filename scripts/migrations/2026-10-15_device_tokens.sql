-- 2026-10-15 — Device token storage for mobile push notifications.
--
-- Each row is one device that a user has granted push permission on.
-- A user may have multiple devices; a device may only belong to one user
-- at a time (the UNIQUE on token enforces this, and upsert-on-register
-- re-assigns ownership on login as a different user).
--
-- organization_id scopes every query so a token registered under one
-- tenant is never used to deliver another tenant's notifications.

BEGIN;

CREATE TABLE IF NOT EXISTS device_tokens (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID       NOT NULL,
  -- The FCM registration token. Unique per physical device installation.
  token         TEXT         NOT NULL,
  -- "android" | "ios" | "web" — from Capacitor.getPlatform()
  platform      VARCHAR(16)  NOT NULL DEFAULT 'android',
  -- Human-readable label, e.g. "Samsung Galaxy S23 / Android 14"
  device_info   TEXT,
  -- Lifecycle timestamps
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Set when FCM returns InvalidRegistration or NotRegistered
  invalidated_at TIMESTAMPTZ,
  -- Prevent duplicates: one token = one row, regardless of user.
  -- On re-login as a different user, the upsert moves ownership.
  CONSTRAINT uq_device_tokens_token UNIQUE (token)
);

-- Fast lookup: "send push to this user in this org"
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_org
  ON device_tokens (user_id, organization_id)
  WHERE invalidated_at IS NULL;

-- Cleanup: find and reap invalidated tokens older than 30 days
CREATE INDEX IF NOT EXISTS idx_device_tokens_invalidated
  ON device_tokens (invalidated_at)
  WHERE invalidated_at IS NOT NULL;

COMMIT;
