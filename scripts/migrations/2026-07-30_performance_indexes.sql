-- Performance indexes for the lead pipeline.
--
--   node scripts/run_sql_migration.js 2026-07-30_performance_indexes.sql
--
-- Idempotent. Adds no columns, changes no data, alters no behaviour — every
-- statement here is either a new index or the removal of a redundant one.
--
-- ── Why these, measured on a 100,000-lead / 400,000-follow-up copy ──────────
--
-- BEFORE, the two hottest queries in the app both ran without any usable index:
--
--   SELECT * FROM follow_ups WHERE lead_id = $1
--     → Parallel Seq Scan, Buffers: shared hit=8997, 37 ms to return 4 rows.
--       The whole 70 MB table was read to find one lead's follow-ups. This runs
--       every time a lead is opened.
--
--   SELECT * FROM walkin_enquiries ORDER BY sr_no DESC NULLS LAST LIMIT 20
--     → Gather Merge → Sort, "temp read=1087 written=3461", 74 ms.
--       The sort SPILLED TO DISK: 100,000 rows at ~3.2 kB each blows past
--       work_mem, so Postgres wrote 27 MB of temp files just to return 20 rows.
--       Every list page paid this.
--
-- An index whose column order matches the ORDER BY lets Postgres walk the index
-- and stop after LIMIT rows, so the sort disappears entirely rather than getting
-- faster.

BEGIN;

-- ── 1. follow_ups ──────────────────────────────────────────────────────────
-- lead_id is the single most-used predicate in the codebase (17 call sites) and
-- had NO index at all — the table carried only its primary key. created_at is
-- included because every one of those lookups is
-- "WHERE lead_id = $1 ORDER BY created_at", so a composite index serves the
-- filter and the sort in one pass.
--
-- NOTE ON THE COLUMN TYPE: follow_ups.lead_id is integer, but POST /api/followups
-- inserts String(leadId). Postgres coerces the literal, so the index is still
-- used — but see the comment at the end of this file about that cast.
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead_id_created_at
  ON follow_ups (lead_id, created_at);

-- Site-visit dashboards scan for follow-ups that carry a visit date. Partial,
-- because the overwhelming majority of rows have none.
CREATE INDEX IF NOT EXISTS idx_follow_ups_site_visit_date
  ON follow_ups (site_visit_date)
  WHERE site_visit_date IS NOT NULL AND site_visit_date <> '';

-- "What did this employee log today?" — the daily monitor groups by name.
CREATE INDEX IF NOT EXISTS idx_follow_ups_created_by_name
  ON follow_ups (created_by_name, created_at DESC);

-- ── 2. walkin_enquiries ────────────────────────────────────────────────────
-- The list ordering. DESC NULLS LAST must be spelled out: an index built as
-- plain (sr_no) does NOT satisfy "ORDER BY sr_no DESC NULLS LAST" without an
-- extra sort step, which is the whole cost we are removing.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_sr_no_desc
  ON walkin_enquiries (sr_no DESC NULLS LAST);

-- Second-most-common ordering, and the fallback when sr_no is null.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_created_at_desc
  ON walkin_enquiries (created_at DESC);

-- Duplicate-lead detection on intake runs on every single enquiry POST.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_phone
  ON walkin_enquiries (phone);

-- Status filtering, and the status pills' counts.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_status
  ON walkin_enquiries (status);

-- "My leads" for a Sales Manager — the single most common filtered view.
-- Composite with the sort column so the filter and ordering are one index walk.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_to_sr_no
  ON walkin_enquiries (assigned_to, sr_no DESC NULLS LAST);

-- Same shape for the receptionist's own queue.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_assigned_receptionist
  ON walkin_enquiries (assigned_receptionist, sr_no DESC NULLS LAST);

-- Lost-lead views. Partial: lost leads are a small minority, and the common
-- case (the main list) filters them OUT, which this also serves.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_is_lost_lead
  ON walkin_enquiries (is_lost_lead)
  WHERE is_lost_lead = true;

-- Source breakdown reporting.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_source
  ON walkin_enquiries (source);

-- ── 3. Remove a redundant index ────────────────────────────────────────────
-- idx_walkin_enquiries_cp and idx_walkin_enquiries_channel_partner are byte-for-byte
-- the same index on (channel_partner_id). Carrying both doubles the write cost of
-- every lead INSERT and UPDATE and buys nothing — the planner can only use one.
DROP INDEX IF EXISTS idx_walkin_enquiries_cp;

COMMIT;

-- Index-only statistics are what the planner uses to choose these; without a
-- refresh it may keep the old plans until autovacuum catches up.
ANALYZE follow_ups;
ANALYZE walkin_enquiries;

-- ── Follow-up: a type mismatch worth fixing separately ─────────────────────
-- POST /api/followups binds String(leadId) into an integer column. Postgres
-- accepts it because the parameter is untyped and gets resolved to integer, so
-- the index above is used and nothing is broken today. But if that column is
-- ever compared against a text expression the index would be bypassed. Left
-- alone here because changing the bind is application logic, not an index.
