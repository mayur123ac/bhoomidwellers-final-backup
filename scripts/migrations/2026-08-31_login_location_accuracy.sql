-- 2026-08-31  GPS accuracy for login sessions
--
-- Stores the browser-reported accuracy (in meters) alongside the GPS
-- coordinates. Lets the attendance detail view show how precise the
-- reported position actually is.

BEGIN;

ALTER TABLE employee_sessions
  ADD COLUMN IF NOT EXISTS login_location_accuracy DOUBLE PRECISION;

COMMENT ON COLUMN employee_sessions.login_location_accuracy
  IS 'Browser-reported GPS accuracy in meters, e.g. 12.0';

COMMIT;
