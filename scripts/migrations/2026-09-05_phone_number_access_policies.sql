-- 2026-09-05_phone_number_access_policies.sql
--
-- Phone Number Access Control — server-side, field-level authorization.
--
-- Controls whether each employee role may see the full phone number for CP
-- records and CP-linked leads. Admin is an invariant (always full access) and
-- is deliberately NOT stored here.
--
-- Two scopes:
--   CP_ENQUIRY       channel_partners.phone in CP Enquiry views
--   CP_LINKED_LEAD   cp_phone / partner_phone on CP-sourced walkin_enquiries
--
-- Four roles (normalized, underscore-separated):
--   receptionist  sales_manager  site_head  sourcing_manager
--
-- Default: all ON (true), preserving existing CRM behavior.
-- Changing a row to false masks the phone server-side; the raw number never
-- reaches the unauthorized browser.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS phone_number_access_policies (
  id                  SERIAL PRIMARY KEY,
  organization_id     UUID        NOT NULL,
  scope               VARCHAR(50) NOT NULL
                        CHECK (scope IN ('CP_ENQUIRY', 'CP_LINKED_LEAD')),
  role                VARCHAR(50) NOT NULL
                        CHECK (role IN ('receptionist', 'sales_manager', 'site_head', 'sourcing_manager')),
  can_view_full_phone BOOLEAN     NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          VARCHAR(255),

  UNIQUE (organization_id, scope, role)
);

-- Per-request lookup index: one query per (org, scope, role) per API call.
CREATE INDEX IF NOT EXISTS idx_phone_access_policies_lookup
  ON phone_number_access_policies (organization_id, scope, role);

-- Seed existing organizations: insert all 8 policy rows (2 scopes × 4 roles)
-- with can_view_full_phone = true, so existing employees keep their current
-- access. ON CONFLICT DO NOTHING makes this re-runnable.
INSERT INTO phone_number_access_policies
  (organization_id, scope, role, can_view_full_phone, updated_by)
SELECT
  o.id                     AS organization_id,
  s.scope,
  r.role,
  true                     AS can_view_full_phone,
  'migration'              AS updated_by
FROM public.organizations o
CROSS JOIN (VALUES
  ('CP_ENQUIRY'),
  ('CP_LINKED_LEAD')
) AS s(scope)
CROSS JOIN (VALUES
  ('receptionist'),
  ('sales_manager'),
  ('site_head'),
  ('sourcing_manager')
) AS r(role)
ON CONFLICT (organization_id, scope, role) DO NOTHING;
