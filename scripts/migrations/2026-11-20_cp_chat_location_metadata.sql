-- 2026-11-20_cp_chat_location_metadata.sql
--
-- Adds location and capture metadata columns to cp_chat_messages.
-- These support the in-app camera capture feature: when a user takes a photo
-- through the chat camera, the browser captures GPS coordinates and a timestamp
-- that are stored alongside the attachment.
--
-- Additive only. No existing columns are altered or dropped. Idempotent.

BEGIN;

-- Location metadata for camera-captured photos
ALTER TABLE cp_chat_messages
  ADD COLUMN IF NOT EXISTS capture_latitude      DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS capture_longitude     DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS capture_accuracy      DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS capture_timestamp     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_device        TEXT,
  ADD COLUMN IF NOT EXISTS watermarked_key       TEXT;

-- Partial index for messages with location data (for map/timeline queries)
CREATE INDEX IF NOT EXISTS idx_cp_chat_messages_with_location
  ON cp_chat_messages (organization_id, channel_partner_id, sent_at DESC)
  WHERE capture_latitude IS NOT NULL;

COMMIT;
