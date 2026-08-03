-- 2026-08-02_walkin_enquiries_neon_sync.sql
-- Brings Neon.walkin_enquiries up to the local schema.
--
-- Trigger: production threw  column "location" of relation "walkin_enquiries"
-- does not exist.  `location` and `referral_name` exist locally but appear in NO
-- migration file — they were added ad-hoc and never shipped, so Neon never got
-- them. Rather than patch those two and wait for the next drift, this asserts
-- every column the local schema has.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op for columns already present,
-- so this is safe to re-run and safe to run against a database that is already
-- correct. It only ADDS — nothing is dropped, retyped or backfilled.
--
-- Run in pgAdmin against Neon, then re-test the failing edit.

BEGIN;

ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS name VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS occupation VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS organization VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS budget VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS configuration VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS purpose VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS followup_date VARCHAR(50);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS consent BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_planned VARCHAR(50);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS source_other VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS cp_name VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS cp_company VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS cp_phone VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS assigned_receptionist VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS is_global_shared BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS overseeing_site_head VARCHAR(150);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS escalated_to_site_head BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS referral_name TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS is_lost_lead BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lost_lead_reason TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lost_lead_marked_at TIMESTAMP;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lost_lead_marked_by TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS enquiry_date TIMESTAMP;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS auto_date_enabled BOOLEAN DEFAULT false;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sr_no INTEGER;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sales_budget TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS use_type TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS planning_purchase TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_planned_confirmed TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS lead_interest_status TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS property_type TEXT;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS closing_date TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS site_visit_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS loan_tracking_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS referral_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS external_ref VARCHAR(100);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS channel_partner_id INTEGER;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS pin_code VARCHAR(20);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS city VARCHAR(120);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS preferred_location VARCHAR(255);
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sourcing_manager_id INTEGER;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_at TIMESTAMP;
ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_by VARCHAR(100);

COMMIT;

-- Verify: expect 57 rows.
-- SELECT count(*) FROM information_schema.columns WHERE table_name = 'walkin_enquiries';
-- Confirm the two that caused this:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'walkin_enquiries' AND column_name IN ('location','referral_name');
