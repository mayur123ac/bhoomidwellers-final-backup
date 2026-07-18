-- Migration: Bring loan_updates up to the columns LoanDealForm/LoanDealView actually use
-- Date: 2026-07-16
-- Purpose: The pre-existing /api/loan/route.ts INSERT referenced ~28 columns
--          (sales_manager_name, cibil, agent, emp_type, doc_pan, roi, tenure,
--          project, builder, phone, address, ...) that never existed on this
--          table — only id, lead_id, status, bank_name, amount_requested,
--          amount_approved, notes, created_at (+ loan_required, added earlier
--          today) are real. Every POST to /api/loan has failed since inception
--          (0 rows in the table). This adds only the columns genuinely needed
--          for the 5-section loan tracking form; the never-real speculative
--          columns (loan_type, processing_amt, roi, tenure, officer, prop_type,
--          prop_value, project, builder, phone, alt_phone, email, address,
--          app_date, aprv_date, exp_disb_date, disb_date) are not added back.

ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS sales_manager_name TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS cibil TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS agent TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS agent_contact TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS emp_type TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS income TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS emi TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_pan TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_aadhaar TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_salary TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_bank TEXT;
ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS doc_property TEXT;
