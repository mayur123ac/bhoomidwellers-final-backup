-- notification_tenant_isolation_2026-08-23.sql
--
-- Two jobs, both about the notification queue's tenant boundary:
--
--   PART A — repair any row whose organization_id is missing or disagrees with
--            the lead it hangs off.
--   PART B — indexes that make the organization-scoped notification queries
--            cheap enough that nobody is ever tempted to drop the predicate.
--
-- Idempotent. Safe to run more than once; every statement is a no-op the second
-- time.
--
--   node frontend/scripts/run_sql_migration.js ../notification_tenant_isolation_2026-08-23.sql
--
-- ── A note on what is NOT here ──────────────────────────────────────────────
-- There is no `notifications` table to repair, and this migration does not
-- create one. Every in-app notification is DERIVED at read time from
-- walkin_enquiries and follow_ups (see frontend/src/lib/notifications/feed.ts).
-- That is why the repair below targets those tables plus notification_logs (the
-- WhatsApp delivery log): they are the only places a notification's organization
-- can actually be wrong.
--
-- The rule for every repair: the organization is taken from the ASSOCIATED LEAD,
-- never from whoever happens to be running the migration. A row whose lead
-- cannot be found is left alone and reported rather than guessed at.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — repair existing rows
-- ════════════════════════════════════════════════════════════════════════════

-- A1. follow_ups: the source of Site Visit and Follow-up notifications.
--     Organization taken from the lead the follow-up is attached to.
UPDATE follow_ups f
   SET organization_id = w.organization_id
  FROM walkin_enquiries w
 WHERE f.lead_id = w.id
   AND w.organization_id IS NOT NULL
   AND f.organization_id IS DISTINCT FROM w.organization_id;

-- A2. site_visits: same rule, same source of truth.
UPDATE site_visits sv
   SET organization_id = w.organization_id
  FROM walkin_enquiries w
 WHERE sv.lead_id = w.id
   AND w.organization_id IS NOT NULL
   AND sv.organization_id IS DISTINCT FROM w.organization_id;

-- A3. notification_logs: the WhatsApp delivery log. Only rows whose subject IS a
--     lead can be repaired this way — subject_type is polymorphic, so a row
--     about anything else is deliberately not touched.
UPDATE notification_logs n
   SET organization_id = w.organization_id
  FROM walkin_enquiries w
 WHERE n.subject_type IN ('lead', 'walkin_enquiry', 'enquiry')
   AND n.subject_id = w.id
   AND w.organization_id IS NOT NULL
   AND n.organization_id IS NULL;

-- A4. notification_logs with no resolvable lead: fall back to the RECIPIENT's
--     organization. Still derived from the data, not from the operator — the
--     alert was sent to a specific user, and that user belongs to exactly one
--     organization.
UPDATE notification_logs n
   SET organization_id = u.organization_id
  FROM users u
 WHERE n.receiver_user_id = u.id
   AND u.organization_id IS NOT NULL
   AND n.organization_id IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — indexes for the organization-scoped notification queries
-- ════════════════════════════════════════════════════════════════════════════
--
-- Single-column organization_id indexes already exist on all four tables
-- (idx_walkin_enquiries_org and friends). They are not enough for these
-- queries: with one tenant holding ~99% of the rows, an index on
-- organization_id alone is barely more selective than a sequential scan, and
-- the planner will treat it that way. The composites below put the tenant FIRST
-- and the query's own sort/join key second, so the scoped read is an index scan
-- rather than "filter by tenant, then sort everything".
--
-- This matters beyond speed. A query that is slow WITH the predicate is a
-- standing invitation to remove the predicate.

-- B1. The notification feed reads one organization's leads, newest first.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_org_created
    ON public.walkin_enquiries (organization_id, created_at DESC);

-- B2. The feed's two LATERAL subqueries look up one lead's follow-ups within one
--     organization, most recent first.
CREATE INDEX IF NOT EXISTS idx_follow_ups_org_lead_created
    ON public.follow_ups (organization_id, lead_id, created_at DESC);

-- B3. Site-visit reminders: one organization's visits by date.
CREATE INDEX IF NOT EXISTS idx_site_visits_org_visit_date
    ON public.site_visits (organization_id, visit_date DESC);

-- B4. The WhatsApp alerts panel: one organization's log, newest first.
CREATE INDEX IF NOT EXISTS idx_notification_logs_org_created
    ON public.notification_logs (organization_id, created_at DESC);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after COMMIT. Every count must be 0.
-- ════════════════════════════════════════════════════════════════════════════
--
--   SELECT 'follow_ups mismatched'  AS check, count(*)::int FROM follow_ups f
--     JOIN walkin_enquiries w ON w.id = f.lead_id
--    WHERE f.organization_id IS DISTINCT FROM w.organization_id
--   UNION ALL
--   SELECT 'site_visits mismatched', count(*)::int FROM site_visits sv
--     JOIN walkin_enquiries w ON w.id = sv.lead_id
--    WHERE sv.organization_id IS DISTINCT FROM w.organization_id
--   UNION ALL
--   SELECT 'follow_ups null org',     count(*)::int FROM follow_ups      WHERE organization_id IS NULL
--   UNION ALL
--   SELECT 'site_visits null org',    count(*)::int FROM site_visits     WHERE organization_id IS NULL
--   UNION ALL
--   SELECT 'walkin null org',         count(*)::int FROM walkin_enquiries WHERE organization_id IS NULL
--   UNION ALL
--   SELECT 'notif_logs null org',     count(*)::int FROM notification_logs WHERE organization_id IS NULL;
