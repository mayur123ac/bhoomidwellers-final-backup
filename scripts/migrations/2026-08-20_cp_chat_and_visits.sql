-- 2026-08-20_cp_chat_and_visits.sql
--
-- Database foundation for the Channel Partner Chat / CP Visit module.
--
-- Creates exactly two tables:
--   cp_visits          — one row per Sourcing Manager visit to a CP (append-only history)
--   cp_chat_messages   — the CP-level WhatsApp-style CRM conversation
--
-- Why not follow_ups: follow_ups is lead-scoped (lead_id NOT NULL, FK to
-- walkin_enquiries). A CP conversation exists independently of any lead, so it
-- cannot live there. follow_ups is left completely untouched by this migration.
--
-- Type choices were read off the live schema, not guessed:
--   organizations.id     uuid    DEFAULT gen_random_uuid()
--   channel_partners.id  integer (channel_partners_id_seq)
--   users.id             integer (users_id_seq)
-- and the org FK convention in use across the 90-table multi-tenant schema is
--   REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- (see cp_commissions_organization_id_fkey, cp_assignment_history_organization_id_fkey).
--
-- Additive only. Nothing existing is created, altered, dropped or backfilled.
-- Idempotent: safe to re-run. Transactional. Rollback block at the bottom.

BEGIN;

-- ── cp_visits ───────────────────────────────────────────────────────────────
-- Every check-in is a NEW row. Nothing here is ever updated in place, which is
-- why there is no updated_at and why the user FK is RESTRICT rather than
-- SET NULL — a historical visit must keep its author.
--
-- Location is written only when the Sourcing Manager explicitly submits a
-- visit. There is no background tracking, so there is no need for a
-- (latitude, longitude) index — coordinates are read back per visit, never
-- searched across.
--
-- photo_key holds the R2 object key only. No binary ever lands in Postgres.
CREATE TABLE IF NOT EXISTS cp_visits (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL
    REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_partner_id        INTEGER     NOT NULL
    REFERENCES channel_partners(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  visited_by                INTEGER     NOT NULL
    REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  visit_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  person_met                TEXT,
  notes                     TEXT,
  latitude                  DECIMAL(10,7),
  longitude                 DECIMAL(10,7),
  location_name             TEXT,
  location_accuracy_meters  DECIMAL(10,2),
  photo_key                 TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "the visit history for this CP", the CP chat timeline query.
CREATE INDEX IF NOT EXISTS idx_cp_visits_org_cp_visit_at
  ON cp_visits (organization_id, channel_partner_id, visit_at DESC);

-- "what did this Sourcing Manager visit", the SM activity/report query.
CREATE INDEX IF NOT EXISTS idx_cp_visits_org_visited_by_visit_at
  ON cp_visits (organization_id, visited_by, visit_at DESC);

-- ── cp_chat_messages ────────────────────────────────────────────────────────
-- Belongs directly to a Channel Partner. Deliberately has NO lead_id: a CP
-- conversation is not lead-scoped.
--
-- customer_update / booking_update messages carry only the display text plus
-- whatever id the UI needs to resolve; the authoritative customer, lead and
-- booking records stay in walkin_enquiries / booking_applications and are
-- joined at render time. Nothing is duplicated here.
CREATE TABLE IF NOT EXISTS cp_chat_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL
    REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_partner_id  INTEGER     NOT NULL
    REFERENCES channel_partners(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sender_user_id      INTEGER     NOT NULL
    REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  message_type        TEXT        NOT NULL DEFAULT 'text',
  message_text        TEXT,
  -- Optional link to the visit this message reports. RESTRICT, not CASCADE:
  -- a visit that has been announced in the conversation must not be deletable
  -- out from under the message that references it.
  visit_id            UUID        NULL
    REFERENCES cp_visits(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  attachment_key      TEXT,
  attachment_name     TEXT,
  attachment_type     TEXT,
  attachment_size     INTEGER,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at           TIMESTAMPTZ NULL
);

-- Constraints are added separately so a re-run against a table that already
-- exists still converges (ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cp_chat_messages_message_type_check'
  ) THEN
    ALTER TABLE cp_chat_messages
      ADD CONSTRAINT cp_chat_messages_message_type_check
      CHECK (message_type IN ('text', 'visit', 'customer_update', 'booking_update', 'attachment'));
  END IF;
END $$;

-- The conversation query: one CP's thread, newest first.
CREATE INDEX IF NOT EXISTS idx_cp_chat_messages_org_cp_sent_at
  ON cp_chat_messages (organization_id, channel_partner_id, sent_at DESC);

-- "what has this user posted", for audit and per-user activity views.
CREATE INDEX IF NOT EXISTS idx_cp_chat_messages_org_sender_sent_at
  ON cp_chat_messages (organization_id, sender_user_id, sent_at DESC);

-- Resolving a visit back to the message(s) announcing it. Partial, because the
-- large majority of rows are plain text with visit_id NULL.
CREATE INDEX IF NOT EXISTS idx_cp_chat_messages_visit
  ON cp_chat_messages (visit_id) WHERE visit_id IS NOT NULL;

-- ── Tenant integrity ────────────────────────────────────────────────────────
-- organization_id must come from the authenticated session, never from client
-- input. That is an application rule, but the database enforces the invariant
-- it implies: a row may not point at a channel partner or a user belonging to a
-- different organization, and a message may not link a visit from another
-- organization or another CP.
--
-- This is done with a trigger rather than a composite FK because a composite FK
-- would require adding UNIQUE (organization_id, id) indexes to channel_partners
-- and users — i.e. altering existing tables, which this migration must not do.
-- The trigger lives entirely on the two new tables.
CREATE OR REPLACE FUNCTION cp_chat_assert_tenant() RETURNS TRIGGER AS $$
DECLARE
  cp_org   UUID;
  user_org UUID;
BEGIN
  SELECT organization_id INTO cp_org
    FROM channel_partners WHERE id = NEW.channel_partner_id;
  IF cp_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'cross-tenant write rejected: channel_partner % belongs to organization %, not %',
      NEW.channel_partner_id, cp_org, NEW.organization_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'cp_visits' THEN
    SELECT organization_id INTO user_org FROM users WHERE id = NEW.visited_by;
  ELSE
    SELECT organization_id INTO user_org FROM users WHERE id = NEW.sender_user_id;
  END IF;
  IF user_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'cross-tenant write rejected: user belongs to organization %, not %',
      user_org, NEW.organization_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The visit_id guard must be NESTED, not ANDed with the TG_TABLE_NAME test:
  -- plpgsql hands a whole boolean expression to the SQL executor, which resolves
  -- NEW.visit_id even when the table check is false — and cp_visits has no such
  -- field, so a flat `TG_TABLE_NAME = '...' AND NEW.visit_id IS NOT NULL` makes
  -- every cp_visits insert fail with `record "new" has no field "visit_id"`.
  IF TG_TABLE_NAME = 'cp_chat_messages' THEN
    IF NEW.visit_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM cp_visits v
         WHERE v.id = NEW.visit_id
           AND v.organization_id = NEW.organization_id
           AND v.channel_partner_id = NEW.channel_partner_id
      ) THEN
        RAISE EXCEPTION
          'visit % does not belong to organization % / channel partner %',
          NEW.visit_id, NEW.organization_id, NEW.channel_partner_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cp_visits_assert_tenant ON cp_visits;
CREATE TRIGGER cp_visits_assert_tenant
  BEFORE INSERT OR UPDATE ON cp_visits
  FOR EACH ROW EXECUTE FUNCTION cp_chat_assert_tenant();

DROP TRIGGER IF EXISTS cp_chat_messages_assert_tenant ON cp_chat_messages;
CREATE TRIGGER cp_chat_messages_assert_tenant
  BEFORE INSERT OR UPDATE ON cp_chat_messages
  FOR EACH ROW EXECUTE FUNCTION cp_chat_assert_tenant();

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Both tables are new, so the down-migration is a plain drop. Run only if the
-- module is being abandoned — this destroys visit history and CP conversations.
--
-- BEGIN;
--   DROP TRIGGER IF EXISTS cp_chat_messages_assert_tenant ON cp_chat_messages;
--   DROP TRIGGER IF EXISTS cp_visits_assert_tenant ON cp_visits;
--   DROP TABLE IF EXISTS cp_chat_messages;   -- must go first: FK to cp_visits
--   DROP TABLE IF EXISTS cp_visits;
--   DROP FUNCTION IF EXISTS cp_chat_assert_tenant();
-- COMMIT;
