-- Site Location Management
-- Each organization can configure named site locations.
-- The organization name is auto-provisioned as the default (is_default = true).
-- Enquiries store a FK to the selected location.

-- 1. site_locations table
CREATE TABLE IF NOT EXISTS site_locations (
  id            SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One default per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_locations_org_default
  ON site_locations (organization_id)
  WHERE is_default = true;

-- No duplicate names within the same org (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_locations_org_name
  ON site_locations (organization_id, LOWER(TRIM(name)));

-- Fast lookup by org
CREATE INDEX IF NOT EXISTS idx_site_locations_org
  ON site_locations (organization_id);

-- 2. Add site_location_id FK to walkin_enquiries
ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS site_location_id INTEGER REFERENCES site_locations(id);

-- 3. Auto-provision a default location for every existing organization
INSERT INTO site_locations (organization_id, name, is_default)
SELECT id, name, true
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM site_locations sl
  WHERE sl.organization_id = organizations.id AND sl.is_default = true
);
