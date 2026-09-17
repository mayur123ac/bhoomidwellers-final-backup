-- 2026-09-16: Drop insecure scaffold OTP tables.
--
-- These tables stored plaintext OTP codes and had no attempt limiting.
-- All OTP flows now use email_change_otps with SHA-256 hashed codes,
-- attempt counting, expiry, and consumed_at — the same infrastructure
-- used by forgot-password, admin-password-change, and email verification.
--
-- No application code references these tables after the security remediation.
-- Idempotent: safe to re-run.

DROP TABLE IF EXISTS password_change_codes;
DROP TABLE IF EXISTS email_verification_codes;
