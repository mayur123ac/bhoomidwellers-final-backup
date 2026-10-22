-- 2026-10-20 Inventory Unit Waitlist (Booking Pipeline)
--
-- Allows multiple leads to express interest in the same unit. When the active
-- booking is cancelled, the next waiting lead is automatically promoted to an
-- on_hold state, giving the assigned sales manager first right of refusal to
-- create a full booking through the normal form.
--
-- One active "waiting" entry per (unit, lead) pair. Historical entries
-- (promoted / withdrawn / expired) are preserved for the audit trail.

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_unit_waitlist (
  id             SERIAL       PRIMARY KEY,
  unit_id        INTEGER      NOT NULL REFERENCES inventory_units(id) ON DELETE CASCADE,
  lead_id        INTEGER      NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  position       INTEGER      NOT NULL DEFAULT 1,
  status         VARCHAR(20)  NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting', 'promoted', 'withdrawn', 'expired')),
  notes          TEXT,
  created_by     VARCHAR(255),
  promoted_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  organization_id INTEGER     NOT NULL
);

-- Only one active waiting entry per lead per unit per org.
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active_entry
  ON inventory_unit_waitlist (organization_id, unit_id, lead_id)
  WHERE status = 'waiting';

-- Fast lookup: "who is next in line for this unit?"
CREATE INDEX IF NOT EXISTS idx_waitlist_unit_waiting
  ON inventory_unit_waitlist (unit_id, position ASC)
  WHERE status = 'waiting';

-- Org-scoped listing
CREATE INDEX IF NOT EXISTS idx_waitlist_org
  ON inventory_unit_waitlist (organization_id);

-- Lead-scoped: "what units is this lead waiting for?"
CREATE INDEX IF NOT EXISTS idx_waitlist_lead
  ON inventory_unit_waitlist (lead_id)
  WHERE status = 'waiting';

COMMIT;
