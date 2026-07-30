-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  NEON — 2026-07-30 combined migration                                     ║
-- ║  Paste the whole file into the Neon SQL editor and run it once.           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Combines two migrations already applied to the local database:
--   2026-07-30_whatsapp_notification_logs.sql   (PART 1 below)
--   2026-07-30_performance_indexes.sql          (PART 2 below)
--
-- Those two files remain the canonical per-feature migrations. This one exists
-- only so the Neon side can be done in a single paste.
--
-- SAFE TO RUN MORE THAN ONCE. Every statement is guarded. Verified by running it
-- twice against a database that already had both migrations applied.
--
-- WHAT IT CHANGES
--   + creates ONE new table: notification_logs
--   + creates 16 indexes (7 on the new table, 9 on walkin_enquiries / follow_ups)
--   + creates 1 trigger on the new table
--   ~ replaces function set_updated_at() with a byte-identical body (no-op)
--   - drops ONE redundant index: idx_walkin_enquiries_cp
--
--   It does NOT add, rename, retype or drop a column on any existing table.
--   It does NOT read, modify or delete a single row of your data.
--
-- The only destructive statement is the DROP INDEX at the end of PART 2. It
-- removes a byte-for-byte duplicate of idx_walkin_enquiries_channel_partner,
-- which is left in place. To undo it:
--   CREATE INDEX idx_walkin_enquiries_cp ON walkin_enquiries (channel_partner_id);
--
-- ── If walkin_enquiries is already large on Neon ────────────────────────────
-- The CREATE INDEX statements in PART 2 take a brief write lock on the table.
-- At a few thousand rows this is milliseconds and you will not notice. If you
-- are running this against a table with hundreds of thousands of rows and cannot
-- take any write pause, see the note at the very bottom of this file.


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — notification_logs (WhatsApp notification queue)                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- A NEW table. Deliberately not whatsapp_logs, which cannot hold these rows:
-- its lead_id is NOT NULL (a partner registration has no lead), it has no
-- message_id / status / delivered_at columns, and api/monitoring/daily-stats
-- counts it GROUP BY sender_name to produce the per-employee "WhatsApp Sent
-- Today" figure — writing system notifications there would inflate a number
-- people actually read.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_logs (
  id               SERIAL PRIMARY KEY,
  channel          VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
  type             VARCHAR(60)  NOT NULL,
  receiver         VARCHAR(255),
  receiver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receiver_phone   VARCHAR(20),
  subject_type     VARCHAR(40),
  subject_id       INTEGER,
  template_name    VARCHAR(100),
  message_id       VARCHAR(128),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
  payload          JSONB,
  retry_count      INTEGER      NOT NULL DEFAULT 0,
  max_retries      INTEGER      NOT NULL DEFAULT 3,
  next_retry_at    TIMESTAMPTZ,
  locked_at        TIMESTAMPTZ,
  last_error       TEXT,
  last_error_code  VARCHAR(40),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ
);

-- Top-ups, in case an earlier revision of the table already exists here.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS channel          VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS receiver_user_id INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_type     VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_id       INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS next_retry_at    TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS locked_at        TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS last_error_code  VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS max_retries      INTEGER NOT NULL DEFAULT 3;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the catalogue guards.
-- This CHECK mirrors NotificationStatus in src/types/whatsapp.types.ts —
-- changing one without the other starts rejecting writes at runtime.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notification_logs_status') THEN
    ALTER TABLE notification_logs ADD CONSTRAINT chk_notification_logs_status
      CHECK (status IN ('pending','sending','sent','delivered','read','failed','dead','skipped'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_logs_receiver_user') THEN
    ALTER TABLE notification_logs ADD CONSTRAINT fk_notification_logs_receiver_user
      FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One row per Meta message id. Every delivery webhook is WHERE message_id = $1,
-- and UNIQUE guarantees a receipt cannot fan out across rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_message_id
  ON notification_logs (message_id) WHERE message_id IS NOT NULL;

-- THE IDEMPOTENCY GUARANTEE. One notification per (type, subject), so a
-- double-submitted form or a client retry sends one WhatsApp, not two.
-- 'manual' sends pass subject_id = NULL and are exempt via the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_subject
  ON notification_logs (type, subject_id) WHERE subject_id IS NOT NULL;

-- The retry sweep's only predicate. Partial, so the index holds just the live
-- queue however many terminal rows accumulate behind it.
CREATE INDEX IF NOT EXISTS idx_notification_logs_due
  ON notification_logs (next_retry_at)
  WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL;

-- Stale-lock reaper: rows stranded in 'sending' by a crash mid-send.
CREATE INDEX IF NOT EXISTS idx_notification_logs_stuck
  ON notification_logs (locked_at) WHERE status = 'sending';

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs (status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_receiver_user
  ON notification_logs (receiver_user_id) WHERE receiver_user_id IS NOT NULL;

-- set_updated_at() already exists on this database (created by the 2026-07-25 CP
-- migrations, and used by triggers on channel_partners and cp_commissions).
-- This body is character-for-character identical to theirs, so the REPLACE is a
-- no-op; it is included only so the file also works on a fresh database where
-- this migration runs first.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notification_logs_updated_at') THEN
    CREATE TRIGGER trg_notification_logs_updated_at
      BEFORE UPDATE ON notification_logs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMIT;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — performance indexes                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Measured on a 100,000-lead / 400,000-follow-up copy. Before these, the two
-- hottest queries in the app ran with no usable index:
--
--   SELECT * FROM follow_ups WHERE lead_id = $1
--     Parallel Seq Scan, 8,997 buffers, 37 ms to return 4 rows — the whole
--     70 MB table read to find one lead's follow-ups, on every lead open.
--     AFTER: Index Scan, 7 buffers, 0.03 ms.
--
--   SELECT * FROM walkin_enquiries ORDER BY sr_no DESC NULLS LAST LIMIT 20
--     Sort spilling 27 MB to temp files, 74 ms — to return 20 rows.
--     AFTER: Index Scan, no sort at all, 1 ms.

BEGIN;

-- ── follow_ups ─────────────────────────────────────────────────────────────
-- lead_id is the most-used predicate in the codebase (17 call sites) and had NO
-- index — the table carried only its primary key. created_at is included because
-- every one of those lookups is "WHERE lead_id = $1 ORDER BY created_at", so one
-- composite index serves the filter and the sort together.
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead_id_created_at
  ON follow_ups (lead_id, created_at);

-- Site-visit dashboards scan for follow-ups carrying a visit date. Partial,
-- because the large majority of rows have none.
CREATE INDEX IF NOT EXISTS idx_follow_ups_site_visit_date
  ON follow_ups (site_visit_date)
  WHERE site_visit_date IS NOT NULL AND site_visit_date <> '';

-- "What did this employee log today?" — the daily monitor groups by name.
CREATE INDEX IF NOT EXISTS idx_follow_ups_created_by_name
  ON follow_ups (created_by_name, created_at DESC);

-- ── walkin_enquiries ───────────────────────────────────────────────────────
-- DESC NULLS LAST must be spelled out: a plain (sr_no) index does NOT satisfy
-- "ORDER BY sr_no DESC NULLS LAST" without an extra sort, which is the entire
-- cost being removed here.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_sr_no_desc
  ON walkin_enquiries (sr_no DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_created_at_desc
  ON walkin_enquiries (created_at DESC);

-- Duplicate-lead detection, which runs on every enquiry POST.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_phone
  ON walkin_enquiries (phone);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_status
  ON walkin_enquiries (status);

-- "My leads" for a Sales Manager. Composite with the sort column so filter and
-- ordering are a single index walk.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_to_sr_no
  ON walkin_enquiries (assigned_to, sr_no DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_receptionist
  ON walkin_enquiries (assigned_receptionist, sr_no DESC NULLS LAST);

-- Lost-lead views. Partial: lost leads are a small minority.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_is_lost_lead
  ON walkin_enquiries (is_lost_lead)
  WHERE is_lost_lead = true;

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_source
  ON walkin_enquiries (source);

-- ── Remove a redundant index ───────────────────────────────────────────────
-- idx_walkin_enquiries_cp and idx_walkin_enquiries_channel_partner are the same
-- index on (channel_partner_id). Carrying both doubles the write cost of every
-- lead INSERT and UPDATE and buys nothing — the planner can only use one.
DROP INDEX IF EXISTS idx_walkin_enquiries_cp;

COMMIT;

-- Refresh planner statistics so the new indexes are chosen immediately rather
-- than whenever autovacuum next runs.
ANALYZE follow_ups;
ANALYZE walkin_enquiries;
ANALYZE notification_logs;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  VERIFY — run this after, expect: table_present=t, 16 new indexes         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
SELECT
  (SELECT COUNT(*) = 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'notification_logs')  AS notification_logs_created,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE tablename = 'notification_logs') AS notif_indexes,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE tablename = 'follow_ups')        AS follow_up_indexes,
  (SELECT COUNT(*)::int FROM pg_indexes WHERE tablename = 'walkin_enquiries')  AS lead_indexes,
  (SELECT COUNT(*) = 0 FROM pg_indexes WHERE indexname = 'idx_walkin_enquiries_cp') AS duplicate_index_removed;
-- Expected on a database that had neither migration:
--   notification_logs_created | notif_indexes | follow_up_indexes | lead_indexes | duplicate_index_removed
--   t                         | 8             | 4                 | 12           | t
--
-- (notif_indexes counts the primary key too. follow_up_indexes and lead_indexes
--  include pre-existing indexes, so your numbers may be higher if this database
--  carries extras the local one does not.)


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONLY IF walkin_enquiries IS ALREADY VERY LARGE ON NEON                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- The PART 2 index builds hold a brief write lock. At your current scale that is
-- imperceptible. If you are running this against a table where even a short write
-- pause is unacceptable, DO NOT run PART 2 above — run these instead, one at a
-- time, each as its OWN statement with no BEGIN/COMMIT around it. CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block, which is why they are
-- separated out rather than being the default.
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_lead_id_created_at         ON follow_ups (lead_id, created_at);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_created_by_name            ON follow_ups (created_by_name, created_at DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_sr_no_desc           ON walkin_enquiries (sr_no DESC NULLS LAST);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_created_at_desc      ON walkin_enquiries (created_at DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_phone                ON walkin_enquiries (phone);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_status               ON walkin_enquiries (status);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_assigned_to_sr_no    ON walkin_enquiries (assigned_to, sr_no DESC NULLS LAST);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_assigned_receptionist ON walkin_enquiries (assigned_receptionist, sr_no DESC NULLS LAST);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_source               ON walkin_enquiries (source);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_site_visit_date            ON follow_ups (site_visit_date) WHERE site_visit_date IS NOT NULL AND site_visit_date <> '';
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_walkin_enquiries_is_lost_lead         ON walkin_enquiries (is_lost_lead) WHERE is_lost_lead = true;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_walkin_enquiries_cp;
--   ANALYZE follow_ups;
--   ANALYZE walkin_enquiries;
--
-- A CONCURRENTLY build that is interrupted leaves an INVALID index behind. Check
-- with:  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX on anything it lists, then re-run that one statement.
