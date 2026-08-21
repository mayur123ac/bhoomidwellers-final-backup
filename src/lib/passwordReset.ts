// lib/passwordReset.ts — shared rules for the forgot-password flow.
//
// ── Who may self-reset ──────────────────────────────────────────────────────
// Only Admin and Super Admin. Every other role's password is managed by their
// administrator through Employee Management, so "Forgot Password?" on the login
// page is not a route into their account. That is a deliberate product rule, not
// an oversight, and it is enforced server-side — the browser is never told which
// side of it an address falls on.
//
// ── No new table ────────────────────────────────────────────────────────────
// `email_change_otps` already stores exactly what a one-time code needs
// (otp_hash, expires_at, attempts, consumed_at) and already carries a `purpose`
// column precisely so it can be shared between flows. Password reset uses
// purpose = 'password_reset'; the existing email-change and alternative-address
// flows filter on their own purposes, so the two cannot be confused.
//
// ── What is never stored or returned ────────────────────────────────────────
// Only the SHA-256 of the code is written. The plaintext exists in the outbound
// email and in the request that verifies it, and nowhere else — not in a
// response, not in a log, not in an audit row.
import { createHash, randomInt } from "crypto";
import { query } from "@/lib/db";

/** Matches the existing email-change flow. Short enough to limit exposure. */
export const RESET_OTP_TTL_MINUTES = 10;
/** Failed verifications allowed before the code is dead. */
export const MAX_OTP_ATTEMPTS = 5;
/** Minimum gap between requests for one account. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Requests allowed per account per hour. */
export const MAX_REQUESTS_PER_HOUR = 5;

/** Distinguishes these rows from the email-change ones sharing the table. */
export const RESET_PURPOSE = "password_reset";

/**
 * The single generic reply. Returned for a blocked employee, an unknown
 * address, a rate-limited account and a successful send alike, so the response
 * body cannot be used to test whether an address exists or what role it has.
 */
export const GENERIC_RESET_MESSAGE =
  "If that email address belongs to an account that can reset its own password, " +
  "a 6-digit code has been sent to it. Employee passwords are managed by your " +
  "administrator — please contact them for a reset.";

/** SHA-256, matching the hashing the email-change flow already uses. */
export function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

/** A 6-digit code from the CSPRNG. Math.random() is predictable. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * True for the roles allowed to reset their own password from the login page.
 *
 * Normalised the same way middleware and cpRbac normalise, so "super_admin",
 * "Super Admin" and "admin" all land correctly.
 */
export function canSelfResetPassword(role: unknown): boolean {
  const r = (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
  return r === "admin" || r === "super admin";
}

/**
 * True when a session predates the account's last password change.
 *
 * Sessions are stateless signed cookies with no server-side record to delete, so
 * revocation is expressed as a comparison instead: `signSession()` stamps `iat`,
 * and a password change stamps `users.password_changed_at`. Anything issued
 * before that moment was handed out to whoever knew the old password.
 *
 * Compared at whole-second granularity because `iat` is whole seconds — a
 * sub-second `password_changed_at` would otherwise be "newer" than the token
 * minted by the very next login, locking the account out of itself.
 */
export function sessionPredatesPasswordChange(
  session: any,
  passwordChangedAt: Date | string | null
): boolean {
  if (!passwordChangedAt) return false;
  const changedAtSeconds = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
  const issuedAt = Number(session?.iat);
  // No `iat` means the session predates the claim and cannot be shown to be
  // current, so it is treated as stale rather than trusted.
  if (!Number.isFinite(issuedAt)) return true;
  return issuedAt < changedAtSeconds;
}

export interface ResetTarget {
  id: number;
  name: string;
  email: string;
  role: string;
  organization_id: string | null;
}

/**
 * Resolves an account by email for reset purposes, or null.
 *
 * Email identity is platform-wide in this schema (one address is one account
 * across every organization — that is what lets login identify a user by email
 * alone), so this lookup is deliberately not organization-scoped.
 */
export async function findResetTarget(email: string): Promise<ResetTarget | null> {
  const rows = await query<ResetTarget>(
    `SELECT id, name, email, role, organization_id
       FROM users
      WHERE LOWER(email) = LOWER($1)
        AND deleted_at IS NULL
        AND is_active = true
      LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

export type RateVerdict =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hourly"; retryAfterSeconds: number };

/**
 * Per-account rate limiting, counted from the OTP rows themselves rather than a
 * separate counter table.
 *
 * Both limits are enforced server-side and are invisible to the caller: a
 * throttled request still returns the generic message, so timing a rejection
 * cannot be used to prove an address exists.
 */
export async function checkResetRateLimit(userId: number): Promise<RateVerdict> {
  const recent = await query<{ created_at: string }>(
    `SELECT created_at FROM email_change_otps
      WHERE user_id = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, RESET_PURPOSE]
  );
  if (recent.length > 0) {
    const elapsed = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return { ok: false, reason: "cooldown", retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
    }
  }

  const hourly = await query<{ n: string }>(
    `SELECT count(*) AS n FROM email_change_otps
      WHERE user_id = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'`,
    [userId, RESET_PURPOSE]
  );
  if (Number(hourly[0]?.n ?? 0) >= MAX_REQUESTS_PER_HOUR) {
    return { ok: false, reason: "hourly", retryAfterSeconds: 3600 };
  }

  return { ok: true };
}

export interface OtpRow {
  id: number;
  user_id: number;
  otp_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

/**
 * The newest live code for an account, or null.
 *
 * "Live" excludes consumed rows and expired ones. Only the newest is considered,
 * so issuing a new code makes the previous one unusable even before the explicit
 * supersede runs.
 */
export async function loadLiveOtp(userId: number): Promise<OtpRow | null> {
  const rows = await query<OtpRow>(
    `SELECT id, user_id, otp_hash, attempts, expires_at, consumed_at
       FROM email_change_otps
      WHERE user_id = $1
        AND purpose = $2
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, RESET_PURPOSE]
  );
  return rows[0] ?? null;
}

export type OtpCheck =
  | { ok: true; row: OtpRow }
  | { ok: false; reason: "none" | "expired" | "locked" | "mismatch"; attemptsRemaining: number };

/**
 * Checks a submitted code against the live row, counting failures.
 *
 * Does NOT consume the row — consumption happens only when the password is
 * actually changed, so a verified code cannot be spent by a step that then
 * fails. Every failure increments `attempts`, in both the verify and the reset
 * routes, so neither can be used as an uncounted brute-force oracle.
 */
export async function checkOtp(userId: number, submitted: string): Promise<OtpCheck> {
  const row = await loadLiveOtp(userId);
  if (!row) return { ok: false, reason: "none", attemptsRemaining: 0 };

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired", attemptsRemaining: 0 };
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false, reason: "locked", attemptsRemaining: 0 };
  }

  if (hashOtp(submitted) !== row.otp_hash) {
    const bumped = await query<{ attempts: number }>(
      `UPDATE email_change_otps SET attempts = attempts + 1
        WHERE id = $1 RETURNING attempts`,
      [row.id]
    );
    const used = bumped[0]?.attempts ?? row.attempts + 1;
    return { ok: false, reason: "mismatch", attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - used) };
  }

  return { ok: true, row };
}
