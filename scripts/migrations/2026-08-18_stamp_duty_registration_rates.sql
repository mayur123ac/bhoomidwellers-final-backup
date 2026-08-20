-- 2026-08-18 — Customisable Stamp Duty / Registration Fee rates
--
-- Until now the 5% stamp duty and 1% registration fee were hardcoded in the
-- booking form's autoStampDuty()/autoRegistrationFee() bodies. Only the final
-- rupee amount was stored, so a booking done at the female-co-owner 4% rate or
-- the Mumbai 6% rate carried no record of the percentage it came from, and
-- reopening it showed no rate at all.
--
-- These columns make the RATE the stored thing, exactly like gst_rate on
-- booking_applications — the amount stays derived from agreement_value × rate.
--
-- DEFAULT 5 / 1 backfills every existing row with the Maharashtra rates the old
-- hardcoded functions used, so no already-saved booking changes value. Rows
-- whose stamp_duty_amount was a manual override keep that amount; the rate
-- column simply records what the estimate would have been.
--
-- Safe to re-run. Apply to BOTH local and Neon.

ALTER TABLE booking_registration_details
  ADD COLUMN IF NOT EXISTS stamp_duty_rate       NUMERIC DEFAULT 5,
  ADD COLUMN IF NOT EXISTS registration_fee_rate NUMERIC DEFAULT 1;

-- Older rows created before the DEFAULT existed can still hold NULL.
UPDATE booking_registration_details SET stamp_duty_rate       = 5 WHERE stamp_duty_rate       IS NULL;
UPDATE booking_registration_details SET registration_fee_rate = 1 WHERE registration_fee_rate IS NULL;
