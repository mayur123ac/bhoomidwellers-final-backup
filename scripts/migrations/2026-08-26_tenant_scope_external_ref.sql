-- 2026-08-26  Tenant-scope the external_ref uniqueness constraint
-- ================================================================
--
-- BUG:  ux_enquiry_external_ref enforces global uniqueness on external_ref.
--       external_ref stores tenant-authored values (e.g. "Form No" from Excel
--       imports). Two organisations can legitimately use the same Form No
--       (both start at 1), so Org B's records get rejected as duplicates of
--       Org A's.
--
-- FIX:  Replace the global unique index with a tenant-scoped one:
--         UNIQUE (organization_id, external_ref) WHERE external_ref IS NOT NULL
--
-- The ON CONFLICT clause in bulkInsertLeads.ts is updated in the same commit
-- to reference the new composite index.
-- ================================================================

-- PRE-FLIGHT: check for collisions that would prevent the new index
-- SELECT organization_id, external_ref, count(*)
--   FROM walkin_enquiries
--  WHERE external_ref IS NOT NULL
--  GROUP BY organization_id, external_ref
-- HAVING count(*) > 1;

-- 1. Drop the old globally-unique index
DROP INDEX IF EXISTS ux_enquiry_external_ref;

-- 2. Create the new tenant-scoped unique index
CREATE UNIQUE INDEX ux_enquiry_org_external_ref
  ON walkin_enquiries (organization_id, external_ref)
  WHERE external_ref IS NOT NULL;
