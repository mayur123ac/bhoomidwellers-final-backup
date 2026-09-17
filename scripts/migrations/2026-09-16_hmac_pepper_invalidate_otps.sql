-- 2026-09-16: Invalidate all pending OTPs for HMAC pepper migration.
--
-- The OTP verifier derivation changed from SHA-256(otp) to HMAC-SHA256(OTP_PEPPER, otp).
-- All previously stored hashes are incompatible with the new verifier and cannot be
-- verified. Rather than maintaining a dual SHA/HMAC fallback (which would preserve the
-- offline precomputation attack), we consume all unconsumed OTPs.
--
-- Users with a pending OTP will need to request a new code. OTPs have a 10-minute TTL,
-- so the window of affected users is small.
--
-- Idempotent: safe to re-run (consumed_at IS NULL filters already-consumed rows).

UPDATE email_change_otps
   SET consumed_at = now()
 WHERE consumed_at IS NULL;
