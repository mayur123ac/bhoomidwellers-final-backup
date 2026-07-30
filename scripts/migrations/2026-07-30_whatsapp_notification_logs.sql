-- Outgoing notification log — the durable queue behind WhatsApp delivery.
--
-- Run with:
--   node scripts/run_sql_migration.js 2026-07-30_whatsapp_notification_logs.sql
--
-- Idempotent: safe to run more than once, on a fresh database or an existing one.
--
-- ── Why this is a new table and not whatsapp_logs ───────────────────────────
-- whatsapp_logs already exists, and it cannot carry these rows:
--
--   * lead_id is NOT NULL, and a Channel Partner registration has no lead.
--   * It has no message_id, status, delivered_at or retry columns — there is
--     nowhere to record what Meta said, so no retry could ever be resumed.
--   * api/monitoring/daily-stats counts it GROUP BY sender_name to produce the
--     per-employee "WhatsApp Sent Today" figure on the admin dashboard. Writing
--     system notifications there would credit a phantom employee and inflate a
--     number people actually read.
--
-- whatsapp_logs stays exactly as it is: a record of staff-initiated wa.me
-- messages against a lead. This table records system-initiated sends against
-- any subject, and the two never mix.
--
-- ── The queue ───────────────────────────────────────────────────────────────
-- Rows are claimed with FOR UPDATE SKIP LOCKED, so the in-process retry timer
-- and the /api/notifications/retry-sweep endpoint can both be running and
-- exactly one of them will win any given row. next_retry_at drives the sweep;
-- locked_at exists so a process that dies mid-send can be detected and its row
-- reclaimed rather than stranded in 'sending' forever.

BEGIN;

-- ── 1. Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_logs (
  id               SERIAL PRIMARY KEY,

  -- 'whatsapp' today. Present so an email or SMS channel can share this table
  -- and the same retry machinery rather than cloning it.
  channel          VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',

  -- The business event: 'cp_registration', 'cp_lead_assigned', 'manual'.
  type             VARCHAR(60)  NOT NULL,

  -- Who it went to. receiver is the display name captured at send time, kept
  -- verbatim so the audit trail still reads correctly after a rename; the FK is
  -- for joining to the live user and goes NULL rather than deleting history.
  receiver         VARCHAR(255),
  receiver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receiver_phone   VARCHAR(20),

  -- What it was about. Together with `type` this is the idempotency key.
  subject_type     VARCHAR(40),
  subject_id       INTEGER,

  template_name    VARCHAR(100),

  -- Meta's wamid. NULL until a send succeeds; every delivery webhook matches
  -- on this.
  message_id       VARCHAR(128),

  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',

  -- { request, response, attempts[] }. The request body holds only recipient,
  -- template name and parameters — no credentials — which is exactly why it is
  -- safe to keep and useful for auditing parameter order before go-live.
  -- Headers are never stored.
  payload          JSONB,

  -- Retry state.
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

-- ── 2. Column top-ups ──────────────────────────────────────────────────────
-- For a database where an earlier revision of this file already created the
-- table. No-ops on a fresh one.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS channel          VARCHAR(20) NOT NULL DEFAULT 'whatsapp';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS receiver_user_id INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_type     VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS subject_id       INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS next_retry_at    TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS locked_at        TIMESTAMPTZ;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS last_error_code  VARCHAR(40);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS max_retries      INTEGER NOT NULL DEFAULT 3;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 3. Constraints ─────────────────────────────────────────────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the catalogue guard.
--
-- This CHECK mirrors NotificationStatus in src/types/whatsapp.types.ts.
-- Changing one without the other starts rejecting writes at runtime.
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

-- ── 4. Indexes ─────────────────────────────────────────────────────────────

-- One row per wamid. Every delivery webhook is WHERE message_id = $1, and
-- UNIQUE guarantees a receipt can never fan out across several rows. Partial,
-- because message_id is NULL until a send succeeds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_message_id
  ON notification_logs (message_id) WHERE message_id IS NOT NULL;

-- THE IDEMPOTENCY GUARANTEE. One notification per (type, subject).
--
-- enqueueNotification inserts with ON CONFLICT DO NOTHING against this index,
-- so a double-submitted form, a client retry, or two concurrent requests for the
-- same partner produce one row and therefore one WhatsApp message.
--
-- Consequence: a future "resend" feature must reset the existing row to
-- pending rather than inserting a second one. That is the intended default —
-- silently sending staff two identical alerts is worse than an explicit resend.
--
-- 'manual' ad-hoc sends pass subject_id = NULL and are exempt via the partial
-- predicate, so the same number can be messaged repeatedly by hand.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_subject
  ON notification_logs (type, subject_id) WHERE subject_id IS NOT NULL;

-- The sweep's only predicate. Partial on the two live statuses, so the index
-- holds just the working queue — a handful of rows — however many hundreds of
-- thousands of terminal rows pile up behind it.
CREATE INDEX IF NOT EXISTS idx_notification_logs_due
  ON notification_logs (next_retry_at)
  WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL;

-- The stale-lock reaper. Same reasoning: only rows currently in flight.
CREATE INDEX IF NOT EXISTS idx_notification_logs_stuck
  ON notification_logs (locked_at) WHERE status = 'sending';

-- Admin feed: default ordering, and the status filter / GROUP BY counts.
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs (status);

-- "Everything sent to this manager" — used by the admin filter and worth having
-- before someone builds the per-manager view.
CREATE INDEX IF NOT EXISTS idx_notification_logs_receiver_user
  ON notification_logs (receiver_user_id) WHERE receiver_user_id IS NOT NULL;

-- ── 5. updated_at trigger ──────────────────────────────────────────────────
-- set_updated_at() already exists in this database (created by the CP migrations
-- and attached to channel_partners). Reuse it if present; create it if this
-- migration happens to run first on a fresh database.
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

-- ── After running ───────────────────────────────────────────────────────────
-- Nothing else is required. The application writes here from the moment the
-- table exists, recording a 'skipped' row per triggered notification while the
-- Meta credentials are still absent — which is how the built payload and
-- parameter order can be inspected before a single message is sent:
--
--   SELECT id, type, status, last_error_code, receiver, receiver_phone
--     FROM notification_logs ORDER BY id DESC LIMIT 10;
--
--   SELECT jsonb_pretty(payload) FROM notification_logs ORDER BY id DESC LIMIT 1;
