-- Migration: organization_followup_deletion_permissions
--
-- Stores which roles are permitted to delete individual follow-up notes,
-- on a per-organization basis.
--
-- Admin and Super Admin are always allowed in application code regardless
-- of the contents of this table (see lib/followUpDeletionPermissions.ts).
--
-- Default: admin only. Organizations with no row use the same default
-- (the application code returns ["admin"] when no row exists, matching
-- the ARRAY['admin'] column default).
--
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- Must be applied to ep-long-cloud (production Neon).

CREATE TABLE IF NOT EXISTS organization_followup_deletion_permissions (
  organization_id   UUID        PRIMARY KEY,
  delete_roles      TEXT[]      NOT NULL DEFAULT ARRAY['admin']::TEXT[],
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        INTEGER
);

-- Index on organization_id is covered by the PRIMARY KEY — no extra index needed.
