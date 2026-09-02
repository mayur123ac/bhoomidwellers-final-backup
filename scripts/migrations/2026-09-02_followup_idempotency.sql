-- Phase 4: Follow-up idempotency — client_message_id column + unique index
-- Prevents duplicate follow-ups when a client retries the same POST.

ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS client_message_id TEXT;

-- Partial unique index: only rows with a client_message_id are constrained.
-- Existing rows (NULL) are unaffected. Scoped to organization_id so the same
-- client id from two tenants cannot conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_ups_client_message_id
  ON follow_ups (organization_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
