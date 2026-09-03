-- Phase 1: Follow-up Reminder system — lead_reminders table + indexes.
--
-- A reminder is a personal, time-bound task tied to a lead. The salesperson
-- creates it ("call back in 1 week"), the cron endpoint fires it when due,
-- and SSE/Web Push/FCM deliver it. The table is the source of truth; the
-- frontend never stores reminder state.
--
-- Mirrors the site_visits pattern: separate CRUD table, auto-logs to follow_ups.
-- Mirrors the notification_logs cron pattern: FOR UPDATE SKIP LOCKED processing.

CREATE TABLE IF NOT EXISTS lead_reminders (
  id                SERIAL PRIMARY KEY,
  lead_id           INTEGER NOT NULL REFERENCES walkin_enquiries(id),
  organization_id   UUID NOT NULL REFERENCES organizations(id),

  -- Who: the user this reminder is for, and who created it.
  assigned_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_id     INTEGER NOT NULL REFERENCES users(id),
  created_by_name   VARCHAR(255) NOT NULL,

  -- What
  reminder_type     VARCHAR(30) NOT NULL DEFAULT 'follow_up'
                    CHECK (reminder_type IN (
                      'follow_up', 'callback', 'site_visit', 'payment', 'document'
                    )),
  note              TEXT,

  -- When: absolute instant, always TIMESTAMPTZ.
  remind_at         TIMESTAMPTZ NOT NULL,

  -- State machine: pending -> notified -> completed
  --                pending -> cancelled
  -- "due" and "overdue" are runtime derivations, not stored states.
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'notified', 'completed', 'cancelled')),
  notified_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,

  -- Audit
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cron query: "give me reminders that are due now" — narrow partial index on
-- only pending rows. As reminders complete/cancel they fall out of the index.
CREATE INDEX IF NOT EXISTS idx_lead_reminders_due
  ON lead_reminders (remind_at)
  WHERE status = 'pending';

-- Lead detail: "show all reminders for this lead"
CREATE INDEX IF NOT EXISTS idx_lead_reminders_lead
  ON lead_reminders (organization_id, lead_id, status);

-- User dashboard: "show my pending reminders soonest-first"
CREATE INDEX IF NOT EXISTS idx_lead_reminders_user
  ON lead_reminders (organization_id, assigned_user_id, status, remind_at);

-- Reuse the existing set_updated_at() trigger function from cp_commission_ledger.
CREATE TRIGGER set_updated_at_lead_reminders
  BEFORE UPDATE ON lead_reminders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
