-- Deal Stage Pipeline — Database Migration
-- Version: 2.0 | Date: 2026-11-01
-- Idempotent: all statements use IF NOT EXISTS. Safe to re-run.
--
-- Creates 3 new tables + indexes + constraints, and adds one column to
-- booking_applications. No existing data is modified.

-- ============================================================================
-- 1. deal_stage_outbox
-- ============================================================================

CREATE TABLE IF NOT EXISTS deal_stage_outbox (
  id               BIGSERIAL    PRIMARY KEY,
  lead_id          INTEGER      NOT NULL,
  event_type       TEXT         NOT NULL,
  event_ts         TIMESTAMPTZ  NOT NULL,
  event_key        TEXT         NOT NULL,
  actor_id         INTEGER,
  payload          JSONB        NOT NULL DEFAULT '{}',
  organization_id  UUID         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'pending',
  attempts         INTEGER      NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMPTZ,
  processed_at     TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Primary processing query: pending events in order
CREATE INDEX IF NOT EXISTS idx_dso_pending
  ON deal_stage_outbox (id)
  WHERE status = 'pending';

-- Retry query: failed events whose retry time has passed
CREATE INDEX IF NOT EXISTS idx_dso_retry
  ON deal_stage_outbox (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Idempotency: permanent — no event_key can ever be reused (ADL-04)
CREATE UNIQUE INDEX IF NOT EXISTS uq_dso_event_key
  ON deal_stage_outbox (event_key);

-- Lookup by lead (debugging, admin view)
CREATE INDEX IF NOT EXISTS idx_dso_lead
  ON deal_stage_outbox (lead_id);

-- ============================================================================
-- 2. deal_stage_history
-- ============================================================================

CREATE TABLE IF NOT EXISTS deal_stage_history (
  id               SERIAL       PRIMARY KEY,
  lead_id          INTEGER      NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  stage            TEXT         NOT NULL,
  stage_ordinal    SMALLINT     NOT NULL,
  entered_at       TIMESTAMPTZ  NOT NULL,
  transition_type  TEXT         NOT NULL DEFAULT 'ACTUAL',
  source_event     TEXT         NOT NULL,
  source_record_id INTEGER,
  source_table     TEXT,
  triggered_by     INTEGER,
  organization_id  UUID         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Stage must be valid
DO $$ BEGIN
  ALTER TABLE deal_stage_history
    ADD CONSTRAINT chk_dsh_stage
    CHECK (stage IN ('Fresh', 'Contacted', 'Site Visit', 'Negotiation', 'Sales', 'Booked'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stage ordinal must be 1-6
DO $$ BEGIN
  ALTER TABLE deal_stage_history
    ADD CONSTRAINT chk_dsh_ordinal
    CHECK (stage_ordinal BETWEEN 1 AND 6);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Transition type must be valid
DO $$ BEGIN
  ALTER TABLE deal_stage_history
    ADD CONSTRAINT chk_dsh_transition
    CHECK (transition_type IN ('ACTUAL', 'INFERRED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Primary read query: all stages for one lead, in order
CREATE INDEX IF NOT EXISTS idx_dsh_lead_entered
  ON deal_stage_history (lead_id, entered_at);

-- Batch read: current stage per lead (MAX ordinal)
CREATE INDEX IF NOT EXISTS idx_dsh_lead_ordinal
  ON deal_stage_history (lead_id, stage_ordinal DESC);

-- Tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_dsh_org
  ON deal_stage_history (organization_id);

-- One entry per stage per lead. Used for both idempotency and
-- INFERRED->ACTUAL correction via ON CONFLICT ... DO UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dsh_lead_stage
  ON deal_stage_history (lead_id, stage);

-- ============================================================================
-- 3. booking_initiations
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_initiations (
  id              SERIAL       PRIMARY KEY,
  lead_id         INTEGER      NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  initiated_by    INTEGER      NOT NULL REFERENCES users(id),
  organization_id UUID         NOT NULL,
  saved_field     JSONB        NOT NULL,
  booking_id      INTEGER      REFERENCES booking_applications(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One initiation per lead
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_lead
  ON booking_initiations (lead_id);

-- ============================================================================
-- 4. Add confirmed_at to booking_applications (ADL-03)
-- ============================================================================

ALTER TABLE booking_applications
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
