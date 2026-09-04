-- 2026-09-03 — Banker Visits
-- Dedicated table for recording banker office visits. Separate from channel_partners
-- and walkin_enquiries — a banker visit is neither a CP registration nor a client lead.

CREATE TABLE IF NOT EXISTS banker_visits (
  id                        SERIAL PRIMARY KEY,
  organization_id           UUID NOT NULL REFERENCES organizations(id),
  banker_name               VARCHAR(255) NOT NULL,
  contact_number            VARCHAR(50)  NOT NULL,
  bank_name                 VARCHAR(255) NOT NULL,
  branch_name               VARCHAR(255) NOT NULL,
  designation               VARCHAR(255) NOT NULL,
  reporting_manager         VARCHAR(255),
  assigned_sales_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attended_by_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  attended_by_name          VARCHAR(255) NOT NULL,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banker_visits_org
  ON banker_visits(organization_id);
CREATE INDEX IF NOT EXISTS idx_banker_visits_sales_manager
  ON banker_visits(assigned_sales_manager_id);
CREATE INDEX IF NOT EXISTS idx_banker_visits_created
  ON banker_visits(created_at);
