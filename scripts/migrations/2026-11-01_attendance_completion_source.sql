-- 2026-11-01 — Add completion_source to attendance_records
--
-- Tracks HOW a record was completed:
--   'manual'    — employee clicked "Done for the Day"
--   'scheduled' — auto-completed at the org's configured shift_end
--   'endofday'  — auto-completed by the 23:58 IST safety-net cron
--   'midnight'  — auto-completed by the midnight backfill mode
--   NULL        — legacy records created before this migration
--
-- Idempotent: safe to re-run.

ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS completion_source VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN attendance_records.completion_source IS
  'How the record was completed: manual | scheduled | endofday | midnight. NULL for legacy rows.';
