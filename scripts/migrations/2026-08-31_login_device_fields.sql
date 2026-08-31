-- 2026-08-31  Structured device fields for login sessions
--
-- The existing device_info column stores a short label like "Windows PC / Chrome".
-- These four columns store the parsed components so the attendance tracker can
-- display them in a dedicated Device column and inspector drawer without
-- re-parsing User-Agent strings at read time.

BEGIN;

ALTER TABLE employee_sessions
  ADD COLUMN IF NOT EXISTS login_device_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS login_device_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS login_os          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS login_browser     VARCHAR(50);

COMMENT ON COLUMN employee_sessions.login_device_name IS 'Parsed device name from UA, e.g. "OPPO", "iPhone", "Windows PC"';
COMMENT ON COLUMN employee_sessions.login_device_type IS 'Mobile, Tablet, or Desktop';
COMMENT ON COLUMN employee_sessions.login_os          IS 'OS with version, e.g. "Android 15", "iOS 18.1"';
COMMENT ON COLUMN employee_sessions.login_browser     IS 'Browser name, e.g. "Chrome", "Safari"';

COMMIT;
