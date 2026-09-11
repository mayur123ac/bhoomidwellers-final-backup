-- 2026-09-09_attendance_working_track.sql
--
-- Adds a working_track column to attendance_records.
--
-- working_track stores the integer seconds between the employee's first punch-in
-- (login_time, a TIMESTAMPTZ) and their "Done for the Day" checkout, computed
-- server-side as EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - login_time))::integer.
-- Both operands are TIMESTAMPTZ so the subtraction is session-timezone-independent.
--
-- This is intentionally separate from the existing employee_sessions live timer,
-- which measures CRM session activity. working_track is an attendance-record
-- concept: it is only ever written once (at checkout) and never changes after.
--
-- NULL means the employee has not checked out for the day yet.

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS working_track INTEGER;
