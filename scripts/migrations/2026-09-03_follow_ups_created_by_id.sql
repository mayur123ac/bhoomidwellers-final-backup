-- 2026-09-03: Add created_by_id to follow_ups
--
-- Every follow_ups row stores only created_by_name (a VARCHAR).  When a user
-- is renamed the name-based join breaks silently — follow-ups cannot be
-- attributed to the employee any more.  This migration adds an integer FK
-- alongside the name, matching the pattern already used by lead_reminders.
--
-- The column is NULLABLE because:
--   1. System-generated rows (Bolna webhook, reminder cron) have no human user.
--   2. Legacy rows pre-dating this migration need a backfill (see below).
--
-- The backfill UPDATE matches existing rows to users by name within the same
-- org.  Rows whose created_by_name doesn't match any current user remain NULL.

-- ── 1. Add column ───────────────────────────────────────────────────────────

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- ── 2. Backfill from name match ─────────────────────────────────────────────
--
-- Uses a lateral subquery so that each follow_up finds its best match within
-- the same organization.  LIMIT 1 + ORDER BY id handles the (unlikely) case
-- of two users with the same name in the same org.

UPDATE follow_ups f
   SET created_by_id = u.id
  FROM users u
 WHERE u.name = f.created_by_name
   AND u.organization_id = f.organization_id
   AND f.created_by_id IS NULL;

-- ── 3. Index for performance queries ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_follow_ups_created_by_id
  ON follow_ups(created_by_id)
  WHERE created_by_id IS NOT NULL;
