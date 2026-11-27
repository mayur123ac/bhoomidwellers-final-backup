-- Soft-delete support for lead_reminders.
--
-- deleted_at: when the reminder was soft-deleted (NULL = not deleted).
-- deleted_by: the user who deleted it (matches existing INTEGER FK pattern).
--
-- The DELETE handler also sets status = 'cancelled' so the cron processor's
-- existing WHERE status = 'pending' filter naturally excludes deleted rows
-- without requiring changes to reminder.service.ts.

ALTER TABLE lead_reminders
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id);
