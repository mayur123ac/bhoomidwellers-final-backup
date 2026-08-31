-- 2026-08-31  Human-readable location name for login sessions
--
-- Stores the reverse-geocoded place name alongside the GPS coordinates.
-- Resolved once at login time so the attendance tracker never calls a
-- geocoding API on page load.

BEGIN;

ALTER TABLE employee_sessions
  ADD COLUMN IF NOT EXISTS login_location_name VARCHAR(255);

COMMENT ON COLUMN employee_sessions.login_location_name
  IS 'Reverse-geocoded place name from login GPS coordinates, e.g. "Mumbai, Maharashtra"';

COMMIT;
