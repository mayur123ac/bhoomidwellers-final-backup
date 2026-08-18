-- 2026-08-18_attendance_tables.sql
--
-- Creates the four tables the attendance/telemetry module reads and writes but
-- which were never created in this database. Every attendance endpoint was
-- returning 500 as a result — /api/attendance/status fails on the very first
-- query with `relation "attendance_records" does not exist`, and the login route
-- fails the same way on employee_sessions.
--
-- The column sets below are taken from the queries in src/, not from the older
-- one-off runners in scripts/ (migrate_attendance.js, migrate_attendance_db.js,
-- migrate_ops_intelligence.js, api/migrate/route.ts). Those disagree with each
-- other and with the code — api/migrate/route.ts declares employee_live_state
-- without current_route, is_idle, productivity_score or lead_started_at, all of
-- which the heartbeat and log-activity upserts write. Where they conflict, the
-- code wins.
--
-- Additive only: every statement is IF NOT EXISTS, nothing is dropped or altered.

BEGIN;

-- ── employee_sessions ───────────────────────────────────────────────────────
-- Written by api/auth/login (INSERT ... user_id, session_start, last_heartbeat,
-- ip_address, device_info, is_active) and by api/auth/logout.
--
-- session_start is timestamptz rather than a naive timestamp because
-- api/attendance/live filters on `DATE(session_start AT TIME ZONE 'Asia/Kolkata')`,
-- which is only meaningful if the stored value carries a zone.
CREATE TABLE IF NOT EXISTS employee_sessions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_start  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat TIMESTAMPTZ,
  session_end    TIMESTAMPTZ,
  ip_address     VARCHAR(255),
  device_info    VARCHAR(255),
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The hot lookup: "the active session for this user", in login, mark, heartbeat.
CREATE INDEX IF NOT EXISTS employee_sessions_user_active_idx
  ON employee_sessions (user_id, is_active);

-- api/attendance/live sweeps stale sessions by last_heartbeat on every request.
CREATE INDEX IF NOT EXISTS employee_sessions_stale_idx
  ON employee_sessions (last_heartbeat) WHERE is_active = true;

-- ── attendance_records ──────────────────────────────────────────────────────
-- The table /api/attendance/status died on.
--
-- login_time is deliberately `TIMESTAMP WITHOUT TIME ZONE`: api/attendance/mark
-- writes `... AT TIME ZONE 'Asia/Kolkata'`, storing the IST wall clock, and both
-- the status and live routes compare `DATE(login_time)` against the IST date.
-- Making this timestamptz would re-interpret the naive value and shift it a
-- second time — the comment in status/route.ts spells this out.
--
-- organization_id is INTEGER, not the uuid used by users.organization_id:
-- api/attendance/mark passes a hardcoded literal 1.
CREATE TABLE IF NOT EXISTS attendance_records (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER     NOT NULL DEFAULT 1,
  employee_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_session_id  INTEGER     NOT NULL UNIQUE
                                REFERENCES employee_sessions(id) ON DELETE CASCADE,
  attendance_status VARCHAR(20) NOT NULL,
  submitted_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  login_time        TIMESTAMP,
  logout_time       TIMESTAMP,
  created_at        TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- Matches the `employee_id = $1 AND DATE(login_time) = <today IST>` lookup that
-- status and mark both run. DATE() on a naive timestamp is immutable, so it is
-- indexable.
CREATE INDEX IF NOT EXISTS attendance_records_employee_day_idx
  ON attendance_records (employee_id, (DATE(login_time)));

-- ── employee_live_state ─────────────────────────────────────────────────────
-- One row per user, upserted on ON CONFLICT (user_id) by both the heartbeat and
-- log-activity routes — hence user_id as the primary key rather than a surrogate.
--
-- active_lead_id is VARCHAR because the bolna webhook writes String(leadId).
--
-- idle_duration_seconds stays INTEGER even though the heartbeat's
-- `idle_duration_seconds + EXTRACT(EPOCH FROM ...)` yields numeric; Postgres
-- applies an assignment cast on UPDATE, so this is safe.
CREATE TABLE IF NOT EXISTS employee_live_state (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_module        VARCHAR(100),
  active_lead_id        VARCHAR(50),
  active_lead_name      VARCHAR(255),
  current_action        VARCHAR(255),
  current_route         TEXT,
  last_activity         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  lead_started_at       TIMESTAMPTZ,
  idle_duration_seconds INTEGER     NOT NULL DEFAULT 0,
  productivity_score    INTEGER     NOT NULL DEFAULT 0,
  is_idle               BOOLEAN     NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── employee_activity_logs ──────────────────────────────────────────────────
-- Permanent audit history behind the live activity feed.
--
-- user_id is nullable on purpose: src/webhooks/bolna.webhook.ts logs
-- 'voice_call_completed' with a literal NULL user_id, because the event
-- originates from the provider rather than from a signed-in person.
CREATE TABLE IF NOT EXISTS employee_activity_logs (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER      REFERENCES users(id) ON DELETE CASCADE,
  action_type    VARCHAR(100) NOT NULL,
  description    TEXT,
  module         VARCHAR(100),
  lead_id        VARCHAR(50),
  lead_name      VARCHAR(255),
  event_severity VARCHAR(20)  DEFAULT 'INFO',
  timestamp      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employee_activity_logs_user_time_idx
  ON employee_activity_logs (user_id, timestamp DESC);

-- Supports the `COUNT(DISTINCT lead_id) ... WHERE lead_id IS NOT NULL` rollup
-- in log-activity.
CREATE INDEX IF NOT EXISTS employee_activity_logs_lead_idx
  ON employee_activity_logs (lead_id) WHERE lead_id IS NOT NULL;

COMMIT;
