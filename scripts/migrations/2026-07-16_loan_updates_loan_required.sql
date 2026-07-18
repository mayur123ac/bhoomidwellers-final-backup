-- Migration: Add loan_required to loan_updates
-- Date: 2026-07-16
-- Purpose: The informal loan-tracking form asks "Loan Required? (Yes/No/Not Sure)",
--          which has no home in loan_updates — the existing loan_type column means
--          something different (Home Loan / Top-Up Loan / Balance Transfer, a
--          booking-level concept). Table is currently empty; safe additive change.

ALTER TABLE loan_updates ADD COLUMN IF NOT EXISTS loan_required TEXT;
