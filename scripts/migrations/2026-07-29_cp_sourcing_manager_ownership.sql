-- ⚠ SUPERSEDED — do not run. Use
--   2026-07-29_cp_sourcing_manager_ownership_CONSOLIDATED.sql
-- instead.
--
-- Kept only as the record of what was applied to the local database on
-- 2026-07-29. On a database that does NOT already carry the column, this file
-- creates the FK WITHOUT `ON DELETE SET NULL` (deleting a user would then be
-- blocked instead of unassigning the partner) and adds a second, redundant index
-- on assigned_sourcing_manager_id. The consolidated file fixes both and folds in
-- the 2026-07-28 prerequisites, so it is self-contained.
--
-- Sourcing Manager ownership on the Channel Partner master record.
--
-- Until now the assignment lived only on the enquiry (walkin_enquiries.
-- sourcing_manager_id, added 2026-07-28). That answers "who owns this lead",
-- not "who owns this partner" — a partner with five enquiries had five separate
-- assignments and no single owner, so the Sourcing Manager panel could only ever
-- list enquiries, never the partners themselves.
--
-- channel_partners.assigned_sourcing_manager_id is that single owner. It is
-- organizational only: nothing here restricts what a Sourcing Manager can read.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- assigned_sourcing_manager_id already exists on some databases (added ahead of
-- this migration); the IF NOT EXISTS keeps both states converging on the same shape.
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_id INT,
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_by VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'channel_partners'::regclass
      AND c.contype = 'f'
      AND a.attname = 'assigned_sourcing_manager_id'
  ) THEN
    ALTER TABLE channel_partners
      ADD CONSTRAINT fk_channel_partners_sourcing_manager
      FOREIGN KEY (assigned_sourcing_manager_id) REFERENCES users(id);
  END IF;
END $$;

-- The Sourcing Manager panel's primary query is "every partner assigned to me".
CREATE INDEX IF NOT EXISTS idx_channel_partners_assigned_sourcing_manager
  ON channel_partners(assigned_sourcing_manager_id);

-- ── cp_assignment_history ──────────────────────────────────────────────────
-- Declared by 2026-07-28_cp_assignment_workflow.sql, but absent on at least one
-- database where the rest of that migration had been applied. POST
-- /api/walkin_enquiries writes a history row inside the same transaction as the
-- enquiry insert, so where the table is missing every Channel Partner enquiry
-- fails outright. Repeated here so running this file is sufficient to fix that.
CREATE TABLE IF NOT EXISTS cp_assignment_history (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  previous_sourcing_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  new_sourcing_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name VARCHAR(255) NOT NULL,
  assigned_by_role VARCHAR(100),
  action VARCHAR(30) NOT NULL CHECK (action IN ('assigned', 'reassigned', 'cleared')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_lead
  ON cp_assignment_history(lead_id, assigned_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_new_manager
  ON cp_assignment_history(new_sourcing_manager_id, assigned_at DESC);

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Partners that already have enquiries carry an assignment on those enquiries.
-- The most recent one is taken as the partner's owner, so existing Channel
-- Partners appear on the right Sourcing Manager's panel from the first load
-- rather than the feature starting empty.
--
-- Only fills NULLs — an assignment set directly on the partner always wins.
WITH latest AS (
  SELECT DISTINCT ON (w.channel_partner_id)
         w.channel_partner_id,
         w.sourcing_manager_id,
         w.sourcing_manager_assigned_at,
         w.sourcing_manager_assigned_by
    FROM walkin_enquiries w
   WHERE w.channel_partner_id IS NOT NULL
     AND w.sourcing_manager_id IS NOT NULL
   ORDER BY w.channel_partner_id,
            w.sourcing_manager_assigned_at DESC NULLS LAST,
            w.id DESC
)
UPDATE channel_partners cp
   SET assigned_sourcing_manager_id = latest.sourcing_manager_id,
       assigned_sourcing_manager_at = COALESCE(latest.sourcing_manager_assigned_at, now()),
       assigned_sourcing_manager_by = COALESCE(
         NULLIF(latest.sourcing_manager_assigned_by, ''),
         'Backfilled from CP enquiry'
       )
  FROM latest
 WHERE cp.id = latest.channel_partner_id
   AND cp.assigned_sourcing_manager_id IS NULL;

COMMIT;
