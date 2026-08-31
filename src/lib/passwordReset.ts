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

/**
 * The moment to write into `password_changed_at` / `sessions_revoked_at`.
 *
 * ── Why this is not SQL `now()` ─────────────────────────────────────────────
 * Revocation is a comparison between two timestamps, and they must come from
 * the SAME clock:
 *
 *   iat                  stamped by signSession() from the APPLICATION clock.
 *   password_changed_at
 *   sessions_revoked_at  were stamped by SQL `now()` — the DATABASE clock.
 *
 * Those clocks are not the same clock. Measured against this project's Neon
 * branch on 2026-08-24, the database ran 4.9 seconds ahead of the application
 * host. With `now()`, a revocation therefore lands ~5 seconds in the
 * application's future, and EVERY session minted in that window — including the
 * one the user gets by immediately signing back in — is refused as "issued
 * before the revocation". The symptom is a user who changes their password,
 * logs in successfully, and is bounced to the login screen by the first request
 * the new session makes.
 *
 * That was a latent defect in the pre-existing password-change paths; force
 * logout makes it constant rather than occasional, because signing straight
 * back in is the normal thing to do after being signed out.
 *
 * The alternative — tolerating N seconds of skew in the comparison — was
 * rejected. It would let any session issued in the N seconds before a
 * revocation survive it, and "someone signed in moments ago and I want them
 * out" is precisely the case force logout exists for.
 *
 * So the stamp is taken from the application clock, the same one that produced
 * `iat`, and the two are directly comparable. Every caller that writes either
 * column binds this value instead of calling `now()`.
 *
 * ── Why it is the START OF THE NEXT SECOND, not this instant ────────────────
 * `iat` is whole seconds. A session minted at 12:00:03.100 and a revocation at
 * 12:00:03.900 therefore both reduce to 12:00:03, and `iat < revokedAt` is
 * FALSE — the session survives a revocation that happened after it was issued.
 * That is not a rounding curiosity: force logout is most often used moments
 * after someone signs in, which is exactly when the two land in the same second.
 *
 * Advancing the stamp to the next second boundary resolves the ambiguity by
 * failing CLOSED. Everything issued during the current second — the whole set
 * of sessions that existed when the operator clicked — is refused, and the
 * first sign-in from the following second onward is honoured.
 *
 * The cost is bounded by the remainder of one second: a user who signs back in
 * within the same second as the revocation has that one request refused and is
 * fine on the retry. Compared with a force logout that silently does nothing,
 * that is the right way round.
 */
export function sessionRevocationNow(): Date {
  return new Date((Math.floor(Date.now() / 1000) + 1) * 1000);
}

/**
 * True when a session predates ANY revocation stamped on the account.
 *
 * There are two such stamps and they mean different things, so they are separate
 * columns rather than one reused field:
 *
 *   password_changed_at   the credential changed, so anyone holding a session
 *                         minted under the old one is out. Written by the
 *                         self-service and administrator password paths.
 *   sessions_revoked_at   the sessions were ended WITHOUT the credential
 *                         changing. Written by Super Admin force logout and by
 *                         organization suspension. The password still works;
 *                         the holder simply has to sign in again.
 *
 * The later of the two wins, because either on its own is sufficient to kill a
 * session and neither should be able to resurrect one the other killed.
 *
 * Reusing password_changed_at for a force logout was the obvious shortcut and is
 * wrong twice over: it would tell the account "your password was changed" when
 * it was not, and it would collide with the forgot-password flow, which reads
 * that same column to decide whether a reset has already happened.
 *
 * The comparison itself is delegated, so the second-granularity rule documented
 * on sessionPredatesPasswordChange() is stated once and cannot drift.
 */
export function sessionIsRevoked(
  session: any,
  stamps: {
    passwordChangedAt?: Date | string | null;
    sessionsRevokedAt?: Date | string | null;
  }
): boolean {
  return (
    sessionPredatesPasswordChange(session, stamps.passwordChangedAt ?? null) ||
    sessionPredatesPasswordChange(session, stamps.sessionsRevokedAt ?? null)
  );
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
  /** Present only when loaded by loadLiveOtpForPurpose — admin password-change
   *  flows encode the target user id here rather than an email address. */
  new_email?: string | null;
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

// ── Purpose-agnostic helpers (admin password-change flow) ─────────────────────

/** Purpose string for admin-initiated employee password changes. */
export const ADMIN_PW_CHANGE_PURPOSE = "admin_password_change";

/**
 * Per-account rate limiting for any OTP purpose.
 *
 * Identical logic to checkResetRateLimit but accepts an arbitrary purpose so
 * that each flow has its own independent throttle bucket.
 */
export async function checkRateLimitForPurpose(
  userId: number,
  purpose: string
): Promise<RateVerdict> {
  const recent = await query<{ created_at: string }>(
    `SELECT created_at FROM email_change_otps
      WHERE user_id = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, purpose]
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
    [userId, purpose]
  );
  if (Number(hourly[0]?.n ?? 0) >= MAX_REQUESTS_PER_HOUR) {
    return { ok: false, reason: "hourly", retryAfterSeconds: 3600 };
  }

  return { ok: true };
}

/**
 * The newest live OTP row for an account under any given purpose, or null.
 *
 * Selects new_email so the admin password-change confirm route can verify the
 * OTP was issued for the same target the request names.
 */
export async function loadLiveOtpForPurpose(
  userId: number,
  purpose: string
): Promise<OtpRow | null> {
  const rows = await query<OtpRow>(
    `SELECT id, user_id, otp_hash, attempts, expires_at, consumed_at, new_email
       FROM email_change_otps
      WHERE user_id = $1
        AND purpose = $2
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, purpose]
  );
  return rows[0] ?? null;
}

/**
 * Checks a submitted code against the live row for the given purpose,
 * counting failures. Does NOT consume the row on success.
 */
export async function checkOtpForPurpose(
  userId: number,
  submitted: string,
  purpose: string
): Promise<OtpCheck> {
  const row = await loadLiveOtpForPurpose(userId, purpose);
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
