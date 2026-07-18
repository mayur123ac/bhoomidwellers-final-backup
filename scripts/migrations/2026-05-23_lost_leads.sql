ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS is_lost_lead BOOLEAN DEFAULT FALSE;

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS lost_lead_reason TEXT;

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS lost_lead_marked_at TIMESTAMP;

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS lost_lead_marked_by TEXT;
