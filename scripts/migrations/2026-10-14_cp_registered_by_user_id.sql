-- 2026-10-14 — CP registration attribution
--
-- Adds registered_by_user_id to channel_partners so every new CP registration
-- records which employee filled out the form. The existing created_by column
-- is a VARCHAR display name and cannot reliably identify an employee.
--
-- Existing rows get NULL (unknown attribution). No historical fabrication.
--
-- FK pattern matches assigned_sourcing_manager_id: simple FK to users(id),
-- ON DELETE SET NULL. Both organization_id values (CP and user) are derived
-- from the same signed session at write time, so cross-tenant attribution
-- cannot occur through the application path.

ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS registered_by_user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN channel_partners.registered_by_user_id IS
  'users.id of the employee who originally registered this CP. NULL for historical rows. Immutable after creation.';
