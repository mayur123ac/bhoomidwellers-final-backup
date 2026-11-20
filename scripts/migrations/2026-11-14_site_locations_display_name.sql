-- Add display_name to site_locations.
-- When set, the enquiry form dropdown shows this instead of the full name.
-- NULL means "use the name as-is".

ALTER TABLE site_locations
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
