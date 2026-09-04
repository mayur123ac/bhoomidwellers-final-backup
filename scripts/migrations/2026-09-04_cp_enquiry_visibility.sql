-- Add cp_enquiry_visibility JSONB to organization_settings.
-- Controls which roles see the standalone "CP Enquiry" tab.
-- Default: sales_manager true (pre-existing), receptionist and site_head false.

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS cp_enquiry_visibility JSONB
    DEFAULT '{"receptionist":false,"site_head":false,"sales_manager":true}'::jsonb;
