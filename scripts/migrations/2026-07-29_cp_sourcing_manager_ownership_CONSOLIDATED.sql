-- ═══════════════════════════════════════════════════════════════════════════
-- Channel Partner → Sourcing Manager ownership.  CONSOLIDATED, SELF-CONTAINED.
--
-- Everything the 2026-07-29 update needs, including the parts of
-- 2026-07-28_cp_assignment_workflow.sql it depends on. Run this ALONE on a
-- database that has never had either migration (e.g. Neon) — it is idempotent,
-- so it is equally safe on one that already has them.
--
-- Requires only that `users`, `channel_partners` and `walkin_enquiries` exist.
--
-- ── Two shape corrections vs. the original files ──────────────────────────
-- 1. FK on channel_partners.assigned_sourcing_manager_id is created ON DELETE
--    SET NULL. The local database already had it that way (constraint
--    `fk_cp_assigned_sourcing_manager`, added before this work); the
--    2026-07-29 file would have created a plain FK on a fresh database, so
--    deleting a user would have been blocked on one environment and silently
--    unassigned the partner on the other. SET NULL is the correct behaviour:
--    losing an employee must not make a partner undeletable.
-- 2. Only one index is created on that column. Local ended up with two
--    (`idx_cp_assigned_sourcing_manager_id` and
--    `idx_channel_partners_assigned_sourcing_manager`) covering identical
--    ground; the redundant one is dropped at the end.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. COLUMNS
-- ───────────────────────────────────────────────────────────────────────────

-- Office-visit profile fields (from 2026-07-28). Included so this script is
-- self-contained; no-ops where they already exist.
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS office_address        TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact_person  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gst_number            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pin_code              VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city                  VARCHAR(100);

-- The 2026-07-29 addition: the partner's single owning Sourcing Manager.
-- `_at` / `_by` are stamped server-side and only when the owner actually changes.
ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_id INT,
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_sourcing_manager_by VARCHAR(255);

-- Enquiry-level columns (from 2026-07-28). sourcing_manager_id here owns ONE
-- enquiry and is distinct from the partner-level owner above.
ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS channel_partner_id            INT,
  ADD COLUMN IF NOT EXISTS pin_code                      VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city                          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS preferred_location            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sourcing_manager_id           INT,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_by  VARCHAR(255);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. FOREIGN KEYS
-- Each guarded by a lookup on the COLUMN rather than the constraint name, so a
-- database that already has an equivalent FK under a different name (as local
-- does) is left alone instead of acquiring a second one.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'channel_partners'::regclass
      AND c.contype = 'f'
      AND a.attname = 'assigned_sourcing_manager_id'
  ) THEN
    ALTER TABLE channel_partners
      ADD CONSTRAINT fk_cp_assigned_sourcing_manager
      FOREIGN KEY (assigned_sourcing_manager_id)
      REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'channel_partner_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_channel_partner
      FOREIGN KEY (channel_partner_id) REFERENCES channel_partners(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'sourcing_manager_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_sourcing_manager
      FOREIGN KEY (sourcing_manager_id) REFERENCES users(id);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. AUDIT TABLE
-- Declared by 2026-07-28 but MISSING on the local database while the rest of
-- that migration had been applied. POST /api/walkin_enquiries inserts a row here
-- inside the same transaction as the enquiry, so where the table is absent every
-- Channel Partner enquiry fails outright. Verify this exists before going live.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cp_assignment_history (
  id                            SERIAL PRIMARY KEY,
  lead_id                       INTEGER NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  previous_sourcing_manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  new_sourcing_manager_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name              VARCHAR(255) NOT NULL,
  assigned_by_role              VARCHAR(100),
  action                        VARCHAR(30) NOT NULL
                                  CHECK (action IN ('assigned', 'reassigned', 'cleared')),
  assigned_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ───────────────────────────────────────────────────────────────────────────

-- "Every partner assigned to me" — the Sourcing Manager panel's primary query,
-- and the scope predicate forced into GET /api/channel-partners for that role.
CREATE INDEX IF NOT EXISTS idx_cp_assigned_sourcing_manager_id
  ON channel_partners(assigned_sourcing_manager_id);

-- Phone is the partner's identity: the dedup check on POST, the duplicate-phone
-- check behind the registration form, and findOrCreateChannelPartner all match on
-- the last 10 digits, so they must all hit this expression index.
CREATE INDEX IF NOT EXISTS idx_channel_partners_phone_norm
  ON channel_partners (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_channel_partner
  ON walkin_enquiries(channel_partner_id);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp_sourcing_manager
  ON walkin_enquiries(sourcing_manager_id)
  WHERE source IN ('CP', 'Channel Partner');

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_lead
  ON cp_assignment_history(lead_id, assigned_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_new_manager
  ON cp_assignment_history(new_sourcing_manager_id, assigned_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. BACKFILL — cp_assignment_history (from 2026-07-28)
-- One 'assigned' row per CP enquiry that already carries a Sourcing Manager but
-- has no history, so the audit trail does not start mid-story.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO cp_assignment_history (
  lead_id, previous_sourcing_manager_id, new_sourcing_manager_id,
  assigned_by_user_id, assigned_by_name, assigned_by_role, action, assigned_at
)
SELECT
  w.id,
  NULL,
  w.sourcing_manager_id,
  NULL,
  COALESCE(NULLIF(w.sourcing_manager_assigned_by, ''), 'System'),
  NULL,
  'assigned',
  COALESCE(w.sourcing_manager_assigned_at, w.created_at::timestamptz, now())
FROM walkin_enquiries w
WHERE w.source IN ('CP', 'Channel Partner')
  AND w.sourcing_manager_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cp_assignment_history h WHERE h.lead_id = w.id);

-- ───────────────────────────────────────────────────────────────────────────
-- 6. BACKFILL — partner ownership (2026-07-29)
-- A partner whose enquiries already name a manager inherits the most recent one,
-- so existing partners land on the right panel instead of the feature starting
-- empty. Fills NULLs only: an owner set directly on the partner always wins.
--
-- NOTE: this is a no-op wherever no CP enquiry has ever carried a
-- sourcing_manager_id — which was the case on the local database (all 54 CP
-- enquiries predate the feature). There, ownership must be set by hand: Admin →
-- Channel Partner Management → tick rows → Assign Sourcing Manager.
-- ───────────────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────────────
-- 7. CLEANUP — drop the duplicate index
-- Local acquired a second index on assigned_sourcing_manager_id when the
-- 2026-07-29 file created its own alongside the pre-existing one. Two identical
-- btrees cost write throughput and buy nothing.
-- ───────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_channel_partners_assigned_sourcing_manager;

COMMIT;
