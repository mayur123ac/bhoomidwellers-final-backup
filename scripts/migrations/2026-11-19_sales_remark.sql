-- Migration: Add sales_remark column to walkin_enquiries
-- Date: 2026-11-19
-- Purpose: The sales form "Remark" field was bound to the same state key as
--          "Lead Interest Status" (leadStatus) — both overwrote each other and
--          the remark was never persisted independently. This column stores the
--          SM's free-text remark from the sales form submission.

ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sales_remark TEXT;

COMMENT ON COLUMN walkin_enquiries.sales_remark IS 'Free-text remark from the sales form, written by /api/sales-form-submit';
