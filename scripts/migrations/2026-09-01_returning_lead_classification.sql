-- Migration: Add returning-lead classification columns to walkin_enquiries.
--
-- lead_classification: UNIQUE (default), DUPLICATE, or RETURNING_LEAD.
-- returning_from_lead_id: references the prior lead when classification is RETURNING_LEAD.
--
-- These support the returning-lead detection feature: when a phone number that
-- was seen more than 24 hours ago walks in again, the new lead is tagged as
-- RETURNING_LEAD and linked back to the original.

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS lead_classification VARCHAR(20) DEFAULT 'UNIQUE',
  ADD COLUMN IF NOT EXISTS returning_from_lead_id INTEGER REFERENCES walkin_enquiries(id);

-- Expression index for phone normalization — the duplicates API and returning-lead
-- check both use RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10). An index
-- on that expression makes both queries index-scannable instead of sequential.
CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_norm_phone
  ON walkin_enquiries (RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10));
