-- 2026-10-10_walk_in_sequential_queue.sql
--
-- Adds two columns to walkin_enquiries and a new queue table to support
-- sequential walk-in lead assignment for Sales Managers.
--
-- Business rule: when a receptionist assigns a walk-in enquiry to an SM and
-- that SM already has an unworked receptionist_submitted lead (no sales form yet),
-- the new enquiry is queued. Once the SM submits the sales form on their current
-- lead, the oldest queued enquiry is automatically assigned to them.

-- ── walkin_enquiries columns ─────────────────────────────────────────────────

-- True only for leads created by a receptionist and assigned to an SM/SSM/Site Head.
-- This discriminates the walk-in pipeline from all other lead creation paths.
ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS receptionist_submitted BOOLEAN NOT NULL DEFAULT false;

-- Set to NOW() on the FIRST qualifying sales-form submission (COALESCE keeps it
-- immutable thereafter). Used for idempotency: a second form submit must not
-- dequeue a second lead.
ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS sales_form_submitted_at TIMESTAMPTZ;

-- ── walk_in_assignment_queue ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS walk_in_assignment_queue (
  id                SERIAL      PRIMARY KEY,
  organization_id   UUID        NOT NULL,
  lead_id           INTEGER     NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  target_sm_user_id INTEGER     NOT NULL REFERENCES users(id),
  target_sm_name    TEXT        NOT NULL,
  queued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'assigned')),
  assigned_at       TIMESTAMPTZ,
  -- One queue slot per lead: prevents duplicate queue entries on retry.
  CONSTRAINT uq_walk_in_queue_lead UNIQUE (lead_id)
);

-- FIFO: oldest pending entry per org + SM is processed first.
CREATE INDEX IF NOT EXISTS idx_walk_in_queue_fifo
  ON walk_in_assignment_queue (organization_id, target_sm_user_id, queued_at ASC)
  WHERE status = 'pending';
