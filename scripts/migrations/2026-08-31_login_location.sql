-- 2026-08-31  Mandatory location on login
--
-- Adds GPS coordinates to the employee_sessions table so every login records
-- where it came from.  The login route rejects requests that do not carry valid
-- coordinates, so these columns will never be NULL for sessions created after
-- this migration.

BEGIN;

ALTER TABLE employee_sessions
  ADD COLUMN IF NOT EXISTS login_latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS login_longitude DOUBLE PRECISION;

COMMENT ON COLUMN employee_sessions.login_latitude  IS 'GPS latitude captured from the browser at login time';
COMMENT ON COLUMN employee_sessions.login_longitude IS 'GPS longitude captured from the browser at login time';

COMMIT;
