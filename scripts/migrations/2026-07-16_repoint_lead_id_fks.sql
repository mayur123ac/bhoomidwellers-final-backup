-- Migration: Repoint lead_id foreign keys from the legacy `leads` table to `walkin_enquiries`
-- Date: 2026-07-16
-- Purpose: follow_ups, loan_updates, site_visits, whatsapp_logs, booking_applications, and
--          booking_documents all had lead_id FKs referencing `leads(id)` — a deprecated,
--          empty CSV-import table. Every route in the app actually reads/writes
--          `walkin_enquiries`, which no FK pointed at. As a result, every insert into these
--          six child tables violated its FK for any real lead. Verified all six tables are
--          currently empty, so this repoint is a safe, lossless schema fix.

ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_lead_id_fkey;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE loan_updates DROP CONSTRAINT loan_updates_lead_id_fkey;
ALTER TABLE loan_updates ADD CONSTRAINT loan_updates_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE site_visits DROP CONSTRAINT site_visits_lead_id_fkey;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE whatsapp_logs DROP CONSTRAINT whatsapp_logs_lead_id_fkey;
ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE booking_applications DROP CONSTRAINT booking_applications_lead_id_fkey;
ALTER TABLE booking_applications ADD CONSTRAINT booking_applications_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);

ALTER TABLE booking_documents DROP CONSTRAINT booking_documents_lead_id_fkey;
ALTER TABLE booking_documents ADD CONSTRAINT booking_documents_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES walkin_enquiries(id);
