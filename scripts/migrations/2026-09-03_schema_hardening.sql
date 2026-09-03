-- 2026-09-03: Schema hardening — lifecycle gaps
--
-- Five fixes, each idempotent (safe to re-run).
--
-- 1. lead_assignment_logs: add organization_id (code already INSERTs/SELECTs it)
-- 2. site_visits: add created_by_id FK + completed_at timestamp
-- 3. booking_applications: add created_by_id FK
-- 4. Backfill created_by_id on site_visits and booking_applications
-- 5. walkin_enquiries.closing_date — column already exists, no DDL needed;
--    only the API code is changed to populate it on Closing transitions.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. lead_assignment_logs.organization_id
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The code has been writing this column since the transfer and PUT routes
-- were built, but the CREATE TABLE never included it.  Any database where
-- those INSERTs didn't silently fail already has the column (added manually);
-- IF NOT EXISTS makes this safe either way.

ALTER TABLE lead_assignment_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- Backfill from the lead's organization for any rows that predate the column.
UPDATE lead_assignment_logs lal
   SET organization_id = w.organization_id
  FROM walkin_enquiries w
 WHERE w.id = lal.lead_id
   AND lal.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_org
  ON lead_assignment_logs(organization_id)
  WHERE organization_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. site_visits: created_by_id + completed_at
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill created_by_id by matching created_by (name) to users within the
-- same organization.  Rows whose name doesn't match remain NULL.
UPDATE site_visits sv
   SET created_by_id = u.id
  FROM users u
 WHERE u.name = sv.created_by
   AND u.organization_id = sv.organization_id
   AND sv.created_by_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_visits_created_by_id
  ON site_visits(created_by_id)
  WHERE created_by_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. booking_applications: created_by_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE booking_applications
  ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Backfill created_by_id by matching created_by (name) to users within the
-- same organization.
UPDATE booking_applications ba
   SET created_by_id = u.id
  FROM users u
 WHERE u.name = ba.created_by
   AND u.organization_id = ba.organization_id
   AND ba.created_by_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_applications_created_by_id
  ON booking_applications(created_by_id)
  WHERE created_by_id IS NOT NULL;
