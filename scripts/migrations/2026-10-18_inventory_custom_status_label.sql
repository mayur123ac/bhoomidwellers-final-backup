-- 2026-10-18: Add custom_status_label to inventory_units.
-- This is a display-only label (e.g. "Investor", "Reserved", "Management")
-- that sits alongside the operational status column. The CHECK constraint
-- on status is NOT modified; custom labels do not affect availability,
-- booking sync, or hold expiry.

ALTER TABLE inventory_units
  ADD COLUMN IF NOT EXISTS custom_status_label VARCHAR(50) DEFAULT NULL;

-- Index for fast org-scoped label lookups (populate dropdown, filter)
CREATE INDEX IF NOT EXISTS idx_inventory_custom_label
  ON inventory_units (organization_id, custom_status_label)
  WHERE custom_status_label IS NOT NULL AND deleted_at IS NULL;
