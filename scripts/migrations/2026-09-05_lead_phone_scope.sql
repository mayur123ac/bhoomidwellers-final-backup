-- 2026-09-05_lead_phone_scope.sql
--
-- Extends phone_number_access_policies to support the LEAD_PHONE scope.
-- This scope controls whether a role can see the full phone number of a
-- Lead/customer (walkin_enquiries.phone / alt_phone).
--
-- Authorization model for LEAD_PHONE differs from CP scopes:
--   Admin            → always full phone
--   Assigned employee → always full phone (ownership overrides policy)
--   Other employee    → role policy determines access
--
-- Idempotent — safe to re-run.

-- Step 1: Drop the old CHECK constraint (Postgres cannot ALTER a CHECK).
ALTER TABLE phone_number_access_policies
  DROP CONSTRAINT IF EXISTS phone_number_access_policies_scope_check;

-- Step 2: Re-add with LEAD_PHONE included.
ALTER TABLE phone_number_access_policies
  ADD CONSTRAINT phone_number_access_policies_scope_check
    CHECK (scope IN ('CP_ENQUIRY', 'CP_LINKED_LEAD', 'LEAD_PHONE'));

-- Step 3: Seed LEAD_PHONE rows for all existing organizations.
-- Default is true (full access) — preserves existing behavior before Admin
-- explicitly restricts a role.
INSERT INTO phone_number_access_policies
  (organization_id, scope, role, can_view_full_phone, updated_by)
SELECT
  o.id,
  'LEAD_PHONE',
  r.role,
  true,
  'migration'
FROM public.organizations o
CROSS JOIN (VALUES
  ('receptionist'),
  ('sales_manager'),
  ('site_head'),
  ('sourcing_manager')
) AS r(role)
ON CONFLICT (organization_id, scope, role) DO NOTHING;
