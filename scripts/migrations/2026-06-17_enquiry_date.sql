-- Migration: Add enquiry_date column to walkin_enquiries
-- Date: 2026-06-17
-- Purpose: Support backdated client entries via the Walk-In Enquiry Form

ALTER TABLE walkin_enquiries
ADD COLUMN IF NOT EXISTS enquiry_date TIMESTAMP DEFAULT NOW();

-- Backfill: set enquiry_date = created_at for all existing records
UPDATE walkin_enquiries
SET enquiry_date = created_at
WHERE enquiry_date IS NULL;
