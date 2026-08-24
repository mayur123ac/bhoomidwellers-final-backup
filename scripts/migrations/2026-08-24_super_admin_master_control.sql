-- 2026-08-24_super_admin_master_control.sql
--
-- Two Super Admin capabilities, one migration. They are independent features and
-- share nothing but this file; see the section banners.
--
--   node scripts/run_sql_migration.js 2026-08-24_super_admin_master_control.sql
--
-- Idempotent. Every statement is a no-op the second time.
--
-- ── What this migration does NOT create ─────────────────────────────────────
-- No users table, no organizations table, no sessions table, no notifications
-- table, no roles table. All five already exist and are reused as they are:
--
--   users                 the directory AND the identity store (there is no
--                         separate employees table; every FK points here).
--   organizations         the tenant, UUID keyed, with a `status` column that
--                         already defaults to 'active'.
--   employee_sessions     the login-session record the login route writes and
--                         the attendance heartbeat updates.
--   crm_updates /
--   crm_update_reads      the System Updates feed and its PER-USER read
--                         tracking. Both predate this work; the read table is
--                         already keyed (user_id, update_id), which is exactly
--                         the model the brief asks for, so it is untouched.
--
-- Only columns are added.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — SYSTEM UPDATES
--
-- crm_updates gains a publication lifecycle. Before this it had no status: a row
-- existed and was therefore visible to everyone, so "draft" was not expressible
-- and "unpublish" could only be a DELETE — which destroys the historical record
-- the brief explicitly wants kept.
-- ════════════════════════════════════════════════════════════════════════════

-- A1. Publication state. DEFAULT 'published' is deliberate: the seven rows that
--     already exist are live in every user's System Updates modal today, and a
--     migration must not silently retract them.
ALTER TABLE crm_updates
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published';

-- A2. Audience. One value today ('all_users'), as specified. It is a column
--     rather than an assumption so a role-scoped audience can be added later
--     without another migration to the feed query — see lib/crmUpdates.ts,
--     where the audience predicate already exists in SQL.
ALTER TABLE crm_updates
  ADD COLUMN IF NOT EXISTS audience_type VARCHAR(40) NOT NULL DEFAULT 'all_users';

-- A3. Publication provenance. `published_by` and `created_by_user_id` are real
--     FKs to users, unlike the pre-existing `created_by`, which is a free-text
--     VARCHAR holding a display name. That column is kept and still written, so
--     nothing that reads it breaks; the FKs are what make "who published this"
--     answerable after a rename.
--
--     ON DELETE SET NULL, not CASCADE: deleting a person must never delete the
--     announcement they published.
ALTER TABLE crm_updates
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
ALTER TABLE crm_updates
  ADD COLUMN IF NOT EXISTS published_by INTEGER;
ALTER TABLE crm_updates
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE crm_updates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_updates_created_by_user_fk'
  ) THEN
    ALTER TABLE crm_updates
      ADD CONSTRAINT crm_updates_created_by_user_fk
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_updates_published_by_fk'
  ) THEN
    ALTER TABLE crm_updates
      ADD CONSTRAINT crm_updates_published_by_fk
      FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  -- Only two states exist. A CHECK rather than an enum so adding a third
  -- ('scheduled', say) is an ALTER of one constraint and not a type migration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_updates_status_check'
  ) THEN
    ALTER TABLE crm_updates
      ADD CONSTRAINT crm_updates_status_check
      CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

-- A4. Backfill. The pre-existing rows were published the moment they were
--     created, because there was no other state they could have been in.
UPDATE crm_updates
   SET published_at = created_at
 WHERE status = 'published' AND published_at IS NULL;

UPDATE crm_updates
   SET updated_at = COALESCE(updated_at, created_at, now())
 WHERE updated_at IS NULL;

-- A5. The feed query is `status = 'published' ORDER BY published_at DESC`, run
--     on every dashboard load by every signed-in user.
CREATE INDEX IF NOT EXISTS idx_crm_updates_published
  ON crm_updates (status, published_at DESC);

-- A6. crm_update_reads is keyed (user_id, update_id), which serves the per-user
--     lookup. The reverse direction — "who has read update 12" — has no index,
--     and the unread-count query joins from the update side.
CREATE INDEX IF NOT EXISTS idx_crm_update_reads_update
  ON crm_update_reads (update_id);


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — SESSION REVOCATION
--
-- ── Why a new column and not a new sessions table ───────────────────────────
-- Authentication in this CRM is a STATELESS signed cookie (lib/sessionCookie.ts):
-- an HMAC-SHA256 payload carrying `iat` and `exp`, with no server-side row to
-- delete. Revocation is therefore already expressed as a comparison, not a
-- deletion: lib/serverAuth.ts refuses any session whose `iat` predates
-- `users.password_changed_at`. That is the established mechanism and it works.
--
-- What it could not do is revoke sessions WITHOUT changing the password, which
-- is exactly what a Super Admin force-logout is. So this adds a second
-- timestamp on the same user row and the same comparison reads the later of the
-- two. No new session store, no session table to keep in sync, no second auth
-- system — one more column and one more term in a comparison that already runs
-- on every gated request.
--
-- employee_sessions is NOT that store and is not being repurposed as one. It
-- records login sessions for attendance and the Live Activity panel; closing a
-- row there ends the tracked session and stops the heartbeat, but it has never
-- had the power to refuse a request. Force logout does both: closes the rows so
-- the panels agree, and stamps this column so the cookie actually stops working.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN users.sessions_revoked_at IS
  'Sessions issued before this moment are refused. Stamped by Super Admin force '
  'logout and by organization suspension. Compared against the signed cookie''s '
  '`iat` in lib/serverAuth.ts, alongside password_changed_at. Never returned to '
  'a client.';

-- The org-users panel asks "is this person logged in right now" per user, which
-- is an is_active + freshness lookup keyed by user.
CREATE INDEX IF NOT EXISTS idx_employee_sessions_user_active
  ON employee_sessions (user_id, is_active, last_heartbeat DESC);

COMMIT;
