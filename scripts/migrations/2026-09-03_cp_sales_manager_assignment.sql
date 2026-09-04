-- 2026-09-03 — CP Sales Manager assignment
-- Mirrors the existing assigned_sourcing_manager_* pattern on channel_partners.
-- A channel partner can optionally be assigned to a Sales Manager in addition to
-- (or instead of) a Sourcing Manager. Both assignments are independent and optional.

ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS assigned_sales_manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_sales_manager_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_sales_manager_by  VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_channel_partners_assigned_sales_manager
  ON channel_partners(assigned_sales_manager_id);
