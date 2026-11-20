-- Deal Stage Audit: Drop unused indexes
-- Date: 2026-11-20
-- Audit: docs/audits/deal-stage-comprehensive-audit.md
--
-- These two indexes have ZERO scans in pg_stat_user_indexes since their creation.
-- All deal_stage_history queries filter by lead_id (via idx_dsh_lead_ordinal or
-- uq_dsh_lead_stage) and never by entered_at or organization_id alone.
--
-- Idempotent: IF EXISTS. Safe to re-run.

-- idx_dsh_lead_entered: (lead_id, entered_at)
-- No query uses ORDER BY entered_at; all history reads use ORDER BY stage_ordinal.
DROP INDEX IF EXISTS idx_dsh_lead_entered;

-- idx_dsh_org: (organization_id)
-- organization_id is always combined with lead_id in WHERE clauses;
-- a standalone org index never gets selected by the planner.
DROP INDEX IF EXISTS idx_dsh_org;
