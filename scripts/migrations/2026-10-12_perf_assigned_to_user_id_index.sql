-- Performance index: assigned_to_user_id for SM-scoped list queries.
--
--   node scripts/run_sql_migration.js 2026-10-12_perf_assigned_to_user_id_index.sql
--
-- Idempotent. Adds no columns, changes no data, alters no behaviour.
--
-- ── Why this is needed ───────────────────────────────────────────────────────
-- The Sales Manager dashboard now sends ?myLeads=1, which appends
--
--   AND assigned_to_user_id = $N
--
-- to the walkin_enquiries WHERE clause. Without an index, Postgres falls back
-- to a sequential scan of the entire table to satisfy that predicate.
--
-- With 511 leads and one organization that is still fast (~1 ms), but the scan
-- grows linearly. At 5,000 leads a seq scan costs ~10 ms; at 50,000 it costs
-- ~100 ms — before the round trip. The composite index below converts it to an
-- index scan touching only the SM's rows regardless of table size.
--
-- ── Index shape ──────────────────────────────────────────────────────────────
-- (organization_id, assigned_to_user_id, sr_no DESC NULLS LAST)
--
-- organization_id first so every multi-tenant query is selective from the start.
-- assigned_to_user_id second to satisfy the equality filter.
-- sr_no DESC NULLS LAST last so the ORDER BY is served from the index without
-- a separate sort step — matching the default ORDER BY in the list query.
--
-- Partial (WHERE assigned_to_user_id IS NOT NULL): unassigned / queued leads
-- have assigned_to_user_id = NULL and are never fetched by the myLeads filter,
-- so excluding them keeps the index small and the writes cheaper.
--
-- ── Also included ────────────────────────────────────────────────────────────
-- A composite (organization_id, sr_no DESC NULLS LAST) index for the unfiltered
-- list. The existing idx_walkin_enquiries_sr_no_desc covers (sr_no DESC NULLS
-- LAST) but forces Postgres to re-check organization_id as a heap filter after
-- the index scan. With one org today the extra check is negligible, but the
-- composite index becomes important the moment a second tenant is onboarded —
-- it makes the list query O(page_size) rather than O(all_leads_across_all_orgs).

BEGIN;

-- Index for ?myLeads=1 filtered queries (Sales Manager dashboard).
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_org_assigned_user_sr_no
  ON walkin_enquiries (organization_id, assigned_to_user_id, sr_no DESC NULLS LAST)
  WHERE assigned_to_user_id IS NOT NULL;

-- Index for the unfiltered list query (admin, receptionist, site-head panels).
-- Covers: WHERE organization_id = $1 ORDER BY sr_no DESC NULLS LAST LIMIT N.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_org_sr_no_desc
  ON walkin_enquiries (organization_id, sr_no DESC NULLS LAST);

COMMIT;

-- Update planner statistics so the new indexes are considered immediately.
ANALYZE walkin_enquiries;
