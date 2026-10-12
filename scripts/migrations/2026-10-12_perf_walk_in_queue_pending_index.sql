-- Performance index: walk_in_assignment_queue for the pending_sm_name correlated subquery.
--
--   node scripts/run_sql_migration.js 2026-10-12_perf_walk_in_queue_pending_index.sql
--
-- Idempotent. Adds no columns, changes no data, alters no behaviour.
--
-- ── Why this is needed ───────────────────────────────────────────────────────
-- The walkin_enquiries GET handler includes a correlated subquery per row:
--
--   LEFT JOIN walk_in_assignment_queue q
--     ON q.lead_id = w.id AND q.status = 'pending'
--
-- (previously written as a scalar correlated subquery, same plan shape)
--
-- The existing UNIQUE(lead_id) index covers the lead_id lookup, but it has no
-- WHERE clause — so Postgres must perform a heap fetch on every matched row to
-- check status = 'pending'. For assigned rows (status = 'assigned') the heap
-- fetch returns a row that fails the filter, wasting I/O.
--
-- As the queue grows over time — most rows transition to 'assigned' and stay
-- there — the cost grows: every list-page request pays a heap fetch for every
-- historical 'assigned' entry whose lead_id appears in the current page.
--
-- The partial index below covers only pending rows. The planner can satisfy
-- the join with an index-only scan: a lead_id absent from the partial index
-- immediately returns NULL, no heap fetch required. Once the queue is mostly
-- historical 'assigned' rows (the steady-state) the partial index is tiny and
-- nearly all lookups terminate at the B-tree level.
--
-- ── Index shape ──────────────────────────────────────────────────────────────
-- (lead_id) WHERE status = 'pending'
--
-- Plain lead_id is sufficient: the join predicate is an equality on lead_id
-- and the WHERE on status is captured by the partial predicate.
--
-- The existing UNIQUE(lead_id) index is kept; it enforces the constraint and
-- is used for writes. This new index is read-path only.
--
-- ── Impact on writes ─────────────────────────────────────────────────────────
-- Adds one small index maintained only for pending rows. An INSERT adds one
-- entry; UPDATE status = 'assigned' removes it. The partial index is always
-- small (only current queue depth, typically 0–10 rows), so write overhead
-- is negligible.

CREATE INDEX IF NOT EXISTS idx_walk_in_queue_lead_pending
  ON walk_in_assignment_queue (lead_id)
  WHERE status = 'pending';

-- Update planner statistics so the new index is considered immediately.
ANALYZE walk_in_assignment_queue;
