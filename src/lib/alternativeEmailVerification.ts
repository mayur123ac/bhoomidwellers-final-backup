// lib/alternativeEmailVerification.ts — AlternativeEmailVerificationService.
//
// Owns the whole lifecycle of proving that a user controls a candidate
// alternative address, and only then promoting it to the live one.
//
// ── The staging model, and the circular dependency it removes ───────────────
// An earlier version kept ONE column and gated saving on verification. That did
// not work, because the code was sent to the saved address:
//
//   saving required verification → verification required sending a code →
//   sending required the address to already be saved
//
// It was also destructive: typing a new address wiped the currently verified one
// before the replacement was proven, so a typo cost a working address instantly.
//
// Now there are two columns and exactly one path between them:
//
//   pending_alternative_email   the candidate. Freely writable. Never delivered
//                               to, never a valid sign-in identifier.
//                    │
//                    │  correct OTP — the ONLY promotion path
//                    ▼
//   alternative_email           the live address. Non-NULL implies verified.
//
// A code is sent to the PENDING address, which needs no prior verification, so
// nothing is circular. An abandoned or failed attempt leaves the live value
// exactly as it was.
//
// ── What is stored ──────────────────────────────────────────────────────────
// Only hashes. `otp_hash` is SHA-256; the plaintext exists in the outbound email
// and in this function's local scope, and nowhere else.
//
// SHA-256 rather than scrypt is deliberate: a 6-digit code has 10^6
// possibilities, so no KDF makes an offline search hard. What actually bounds
// the attack is the 5-attempt cap and the 10-minute expiry, enforced here.

import crypto from "node:crypto";
import { query } from "@/lib/db";
import { writeAuditLog } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import { isValidEmail } from "@/lib/emailRouting";

/* ══════════════════════════════════════════════════════════════════════════
   Policy
   ══════════════════════════════════════════════════════════════════════════ */

export const OTP_TTL_MINUTES = 10;
export const MAX_VERIFICATION_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_OTPS_PER_HOUR = 5;

/** The states the UI renders. */
export type VerificationStatus =
  /** No live address and nothing staged. */
  | "not_added"
  /** A candidate is staged but no code has been sent for it yet. */
  | "pending_changes"
  /** A code is outstanding for the staged candidate. */
  | "awaiting_code"
  /** The live address is set and proven. */
  | "verified"
  /** The last attempt on the staged candidate failed. */
  | "failed";

export interface VerificationState {
  status: VerificationStatus;
  /** The live, verified address. Null until a verification succeeds. */
  alternativeEmail: string | null;
  /** The candidate under verification, if any. */
  pendingEmail: string | null;
  verifiedAt: string | null;
  /** Identifies the current attempt; echoed back on submit. */
  sessionId: string | null;
  resendAvailableIn: number;
  otpExpiresIn: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  otpsSentThisHour: number;
  otpsRemainingThisHour: number;
  failureReason: string | null;
}

interface PrefRow {
  user_id: number;
  alternative_email: string | null;
  pending_alternative_email: string | null;
  alternative_email_verified: boolean | null;
  alternative_email_verified_at: string | null;
  verification_session_id: string | null;
  otp_hash: string | null;
  otp_expires_at: string | null;
  verification_attempts: number | null;
  last_otp_sent_at: string | null;
  otp_window_started_at: string | null;
  otp_sent_in_window: number | null;
  last_verification_failed_at: string | null;
  last_verification_failure_reason: string | null;
}

const PREF_COLUMNS = `
  user_id, alternative_email, pending_alternative_email,
  alternative_email_verified, alternative_email_verified_at,
  verification_session_id, otp_hash, otp_expires_at, verification_attempts,
  last_otp_sent_at, otp_window_started_at, otp_sent_in_window,
  last_verification_failed_at, last_verification_failure_reason
`;

function hash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function secondsUntil(timestamp: string | null): number {
  if (!timestamp) return 0;
  return Math.max(0, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 1000));
}

function secondsSince(timestamp: string | null): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(timestamp).getTime()) / 1000;
}

async function loadRow(userId: number): Promise<PrefRow | null> {
  const rows = await query<PrefRow>(
    `SELECT ${PREF_COLUMNS} FROM notification_preferences WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/** Sends in the current hour window; 0 once the window has aged out. */
function sendsInWindow(row: PrefRow | null): number {
  if (!row?.otp_window_started_at) return 0;
  if (secondsSince(row.otp_window_started_at) >= 3600) return 0;
  return row.otp_sent_in_window ?? 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════════════════ */

export async function getVerificationState(userId: number): Promise<VerificationState> {
  const row = await loadRow(userId);

  const sent = sendsInWindow(row);
  const attempts = row?.verification_attempts ?? 0;
  const codeLive = Boolean(row?.otp_hash) && secondsUntil(row?.otp_expires_at ?? null) > 0;

  const base = {
    alternativeEmail: row?.alternative_email ?? null,
    pendingEmail: row?.pending_alternative_email ?? null,
    verifiedAt: row?.alternative_email_verified_at ?? null,
    sessionId: codeLive ? (row?.verification_session_id ?? null) : null,
    resendAvailableIn: row?.last_otp_sent_at
      ? Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince(row.last_otp_sent_at)))
      : 0,
    otpExpiresIn: secondsUntil(row?.otp_expires_at ?? null),
    attemptsUsed: attempts,
    attemptsRemaining: Math.max(0, MAX_VERIFICATION_ATTEMPTS - attempts),
    otpsSentThisHour: sent,
    otpsRemainingThisHour: Math.max(0, MAX_OTPS_PER_HOUR - sent),
    failureReason: row?.last_verification_failure_reason ?? null,
  };

  // Order matters. A staged candidate always wins over the live address,
  // because the user's most recent intent is the thing the UI must reflect —
  // showing a green "verified" tick while an unverified replacement sits in the
  // field would be actively misleading.
  if (row?.pending_alternative_email) {
    if (codeLive) return { ...base, status: "awaiting_code" };
    if (row.last_verification_failed_at) return { ...base, status: "failed" };
    return { ...base, status: "pending_changes", failureReason: null };
  }

  if (row?.alternative_email) {
    return { ...base, status: "verified", failureReason: null };
  }

  return { ...base, status: "not_added", failureReason: null };
}

/* ══════════════════════════════════════════════════════════════════════════
   Staging
   ══════════════════════════════════════════════════════════════════════════ */

export type StageOutcome =
  | { ok: true; address: string; state: VerificationState }
  | { ok: false; code: string; message: string };

/**
 * Validate a candidate address and stage it. Sends nothing.
 *
 * This is what "Save Changes" calls. It is deliberately separate from
 * sendVerificationCode(): the user has to see which address the code is going to
 * and press a button before any mail moves, and separating the two means an
 * accidental save cannot mail a stranger.
 */
export async function stagePendingEmail(params: {
  userId: number;
  actorName: string;
  candidate: string;
  currentEmail: string | null;
  ip: string;
  userAgent: string;
}): Promise<StageOutcome> {
  const candidate = params.candidate.trim().toLowerCase();

  if (!isValidEmail(candidate)) {
    return { ok: false, code: "INVALID", message: "Enter a valid email address." };
  }

  if (candidate === (params.currentEmail ?? "").trim().toLowerCase()) {
    return {
      ok: false,
      code: "SAME_AS_PRIMARY",
      message: "The alternative address must be different from your account email.",
    };
  }

  // ── Already in use elsewhere ──
  // Checked against three things, because all three would make the address
  // ambiguous: another account's login email, another account's live
  // alternative, and another account's staged candidate. The last one matters
  // because two people mid-verification on the same address would race, and
  // whoever verified second would silently steal it.
  const clash = await query<{ source: string }>(
    `SELECT 'account'   AS source FROM users
       WHERE LOWER(email) = $1 AND id <> $2 AND deleted_at IS NULL
     UNION ALL
     SELECT 'alternative' FROM notification_preferences
       WHERE LOWER(alternative_email) = $1 AND user_id <> $2
     UNION ALL
     SELECT 'pending'     FROM notification_preferences
       WHERE LOWER(pending_alternative_email) = $1 AND user_id <> $2
     LIMIT 1`,
    [candidate, params.userId]
  );

  if (clash.length > 0) {
    // One message for all three cases on purpose. Distinguishing them would turn
    // this endpoint into an oracle for "does this person have an account here",
    // which is exactly what an attacker enumerating a customer list wants.
    return {
      ok: false,
      code: "IN_USE",
      message: "That email address is already associated with another account.",
    };
  }

  const row = await loadRow(params.userId);

  if ((row?.alternative_email ?? "").trim().toLowerCase() === candidate) {
    return {
      ok: false,
      code: "ALREADY_VERIFIED",
      message: "That address is already your verified alternative email.",
    };
  }

  const changed =
    (row?.pending_alternative_email ?? "").trim().toLowerCase() !== candidate;

  await query(
    `INSERT INTO notification_preferences (user_id, pending_alternative_email, updated_at, updated_by, organization_id)
     VALUES ($1, $2, NOW(), $1, (SELECT organization_id FROM users WHERE id = $1))
     ON CONFLICT (user_id) DO UPDATE
       SET pending_alternative_email = EXCLUDED.pending_alternative_email,
           -- Changing the candidate invalidates any code in flight. A code
           -- mailed to address A must never be redeemable against address B.
           otp_hash                     = CASE WHEN $3 THEN NULL ELSE notification_preferences.otp_hash END,
           otp_expires_at               = CASE WHEN $3 THEN NULL ELSE notification_preferences.otp_expires_at END,
           verification_session_id      = CASE WHEN $3 THEN NULL ELSE notification_preferences.verification_session_id END,
           alternative_email_token_hash = CASE WHEN $3 THEN NULL ELSE notification_preferences.alternative_email_token_hash END,
           verification_attempts        = CASE WHEN $3 THEN 0 ELSE notification_preferences.verification_attempts END,
           last_verification_failed_at      = CASE WHEN $3 THEN NULL ELSE notification_preferences.last_verification_failed_at END,
           last_verification_failure_reason = CASE WHEN $3 THEN NULL ELSE notification_preferences.last_verification_failure_reason END,
           -- The hourly send budget deliberately survives, so the cap cannot be
           -- reset by retyping the address.
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
    [params.userId, candidate, changed]
  );

  if (changed) {
    await writeAuditLog({
      userId: params.userId,
      actorName: params.actorName,
      action: "alt_email.pending_staged",
      entityType: "user",
      entityId: params.userId,
      oldValue: { pending: row?.pending_alternative_email ?? null },
      newValue: { pending: candidate },
      ipAddress: params.ip,
      userAgent: params.userAgent,
    });
  }

  return {
    ok: true,
    address: candidate,
    state: await getVerificationState(params.userId),
  };
}

/** Discard a staged candidate without touching the live address. */
export async function clearPendingEmail(params: {
  userId: number;
  actorName: string;
  ip: string;
  userAgent: string;
}): Promise<VerificationState> {
  const row = await loadRow(params.userId);

  await query(
    `UPDATE notification_preferences
        SET pending_alternative_email = NULL,
            otp_hash = NULL,
            otp_expires_at = NULL,
            verification_session_id = NULL,
            alternative_email_token_hash = NULL,
            verification_attempts = 0,
            last_verification_failed_at = NULL,
            last_verification_failure_reason = NULL,
            updated_at = NOW()
      WHERE user_id = $1`,
    [params.userId]
  );

  if (row?.pending_alternative_email) {
    await writeAuditLog({
      userId: params.userId,
      actorName: params.actorName,
      action: "alt_email.pending_discarded",
      entityType: "user",
      entityId: params.userId,
      oldValue: { pending: row.pending_alternative_email },
      ipAddress: params.ip,
      userAgent: params.userAgent,
    });
  }

  return getVerificationState(params.userId);
}

/* ══════════════════════════════════════════════════════════════════════════
   Sending
   ══════════════════════════════════════════════════════════════════════════ */

export type SendOutcome =
  | {
      ok: true;
      address: string;
      sessionId: string;
      delivered: boolean;
      state: VerificationState;
    }
  | { ok: false; code: string; message: string; state: VerificationState };

/**
 * Send a code to the STAGED address.
 *
 * Nothing here reads or writes `alternative_email`. The live address is
 * untouched for the entire duration of a verification attempt.
 */
export async function sendVerificationCode(params: {
  userId: number;
  actorName: string;
  ip: string;
  userAgent: string;
}): Promise<SendOutcome> {
  const { userId } = params;
  const row = await loadRow(userId);

  const fail = async (code: string, message: string): Promise<SendOutcome> => ({
    ok: false,
    code,
    message,
    state: await getVerificationState(userId),
  });

  const address = (row?.pending_alternative_email ?? "").trim();

  if (!isValidEmail(address)) {
    return fail("NO_PENDING", "There is no address waiting to be verified.");
  }

  const sinceLast = secondsSince(row?.last_otp_sent_at ?? null);
  if (sinceLast < RESEND_COOLDOWN_SECONDS) {
    return fail(
      "COOLDOWN",
      `Wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast)} seconds before requesting another code.`
    );
  }

  const alreadySent = sendsInWindow(row);
  if (alreadySent >= MAX_OTPS_PER_HOUR) {
    const windowEndsIn = Math.ceil(3600 - secondsSince(row?.otp_window_started_at ?? null));
    return fail(
      "HOURLY_LIMIT",
      `You have requested ${MAX_OTPS_PER_HOUR} codes in the last hour. Try again in ${Math.ceil(windowEndsIn / 60)} minutes.`
    );
  }

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const sessionId = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
  const startNewWindow = alreadySent === 0;

  await query(
    `UPDATE notification_preferences
        SET otp_hash                = $2,
            otp_expires_at          = $3,
            verification_session_id = $4,
            -- A new code resets the attempt counter. Without this, five wrong
            -- guesses would permanently block the address rather than burning
            -- only the code they were aimed at.
            verification_attempts   = 0,
            last_otp_sent_at        = NOW(),
            otp_window_started_at   = CASE WHEN $5 THEN NOW() ELSE otp_window_started_at END,
            otp_sent_in_window      = CASE WHEN $5 THEN 1 ELSE otp_sent_in_window + 1 END,
            last_verification_failed_at      = NULL,
            last_verification_failure_reason = NULL,
            updated_at              = NOW()
      WHERE user_id = $1`,
    [userId, hash(otp), expiresAt, sessionId, startNewWindow]
  );

  // EmailService's DIRECT path, not the routed one: this must reach the address
  // under test. Routing it through the preference engine would deliver it to the
  // already-configured recipients, which is the very thing being established.
  const mail = await EmailService.sendOTP(
    address,
    {
      name: params.actorName,
      code: otp,
      expiryMinutes: OTP_TTL_MINUTES,
      purpose: "confirm that CRM notifications can be delivered to this address",
      requestedFromIp: params.ip,
      requestedFromDevice: params.userAgent,
    },
    { userId, actorName: params.actorName, ip: params.ip, userAgent: params.userAgent }
  );

  await writeAuditLog({
    userId,
    actorName: params.actorName,
    action: "alt_email.otp_sent",
    entityType: "user",
    entityId: userId,
    newValue: { address, delivered: mail.delivered, sentThisHour: alreadySent + 1 },
    ipAddress: params.ip,
    userAgent: params.userAgent,
  });

  return {
    ok: true,
    address,
    sessionId,
    delivered: mail.delivered,
    state: await getVerificationState(userId),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Verifying and promoting
   ══════════════════════════════════════════════════════════════════════════ */

export type VerifyOutcome =
  | { ok: true; address: string; state: VerificationState }
  | { ok: false; code: string; message: string; state: VerificationState };

async function burnCode(userId: number, reason: string): Promise<void> {
  await query(
    `UPDATE notification_preferences
        SET otp_hash = NULL,
            otp_expires_at = NULL,
            verification_session_id = NULL,
            alternative_email_token_hash = NULL,
            last_verification_failed_at = NOW(),
            last_verification_failure_reason = $2,
            updated_at = NOW()
      WHERE user_id = $1`,
    [userId, reason]
  );
}

/**
 * Verify the code and promote the candidate.
 *
 * The promotion is one statement covering both columns, so there is no instant
 * at which the live address is cleared but the replacement not yet written.
 *
 * Notifications and fallback are switched on at the same time. That is the
 * point of the exercise from the user's side — they added the address in order
 * to receive mail there — and leaving them to find a second toggle afterwards
 * would mean a "verified" address that still receives nothing.
 */
export async function verifyCode(params: {
  userId: number;
  actorName: string;
  otp: string;
  /** Optional. When supplied it must match the current attempt. */
  sessionId?: string | null;
  ip: string;
  userAgent: string;
}): Promise<VerifyOutcome> {
  const { userId } = params;

  const fail = async (code: string, message: string): Promise<VerifyOutcome> => ({
    ok: false,
    code,
    message,
    state: await getVerificationState(userId),
  });

  if (!/^\d{6}$/.test(params.otp.trim())) {
    return fail("MALFORMED", "Enter the 6-digit code.");
  }

  const row = await loadRow(userId);

  if (!row?.otp_hash || !row.pending_alternative_email) {
    return fail("NO_CODE", "No verification is in progress. Request a new code.");
  }

  // Guards the two-tab case: a code issued for one attempt cannot be redeemed
  // against a session the client has since replaced.
  if (params.sessionId && row.verification_session_id !== params.sessionId) {
    return fail(
      "STALE_SESSION",
      "This verification was restarted elsewhere. Request a new code."
    );
  }

  if (secondsUntil(row.otp_expires_at) <= 0) {
    await burnCode(userId, "expired");
    await writeAuditLog({
      userId,
      actorName: params.actorName,
      action: "alt_email.otp_expired",
      entityType: "user",
      entityId: userId,
      newValue: { address: row.pending_alternative_email },
      ipAddress: params.ip,
      userAgent: params.userAgent,
    });
    return fail("EXPIRED", "That code has expired. Request a new one.");
  }

  const attempts = row.verification_attempts ?? 0;
  if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
    await burnCode(userId, "too_many_attempts");
    return fail("TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
  }

  const supplied = Buffer.from(hash(params.otp.trim()), "hex");
  const stored = Buffer.from(row.otp_hash, "hex");
  const matches = supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);

  if (!matches) {
    const used = attempts + 1;
    await query(
      `UPDATE notification_preferences SET verification_attempts = $2, updated_at = NOW()
        WHERE user_id = $1`,
      [userId, used]
    );

    await writeAuditLog({
      userId,
      actorName: params.actorName,
      action: "alt_email.otp_failed",
      entityType: "user",
      entityId: userId,
      newValue: { address: row.pending_alternative_email, attempt: used },
      ipAddress: params.ip,
      userAgent: params.userAgent,
    });

    const remaining = MAX_VERIFICATION_ATTEMPTS - used;
    if (remaining <= 0) {
      await burnCode(userId, "too_many_attempts");
      return fail("TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
    }

    // The staged address is untouched — the user keeps their typed value and
    // simply tries again.
    return fail(
      "INCORRECT",
      `Invalid verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
    );
  }

  const promoted = row.pending_alternative_email;
  const previous = row.alternative_email;

  await query(
    `UPDATE notification_preferences
        SET alternative_email             = pending_alternative_email,
            pending_alternative_email     = NULL,
            alternative_email_verified    = true,
            alternative_email_verified_at = NOW(),
            -- Switched on together with the promotion: the user added this
            -- address in order to receive mail at it.
            send_alternative_email        = true,
            fallback_enabled              = true,
            otp_hash                      = NULL,
            otp_expires_at                = NULL,
            verification_session_id       = NULL,
            alternative_email_token_hash  = NULL,
            verification_attempts         = 0,
            last_verification_failed_at      = NULL,
            last_verification_failure_reason = NULL,
            updated_at                    = NOW(),
            updated_by                    = $1
      WHERE user_id = $1`,
    [userId]
  );

  // Keep the legacy columns in step — serializeSettingsUser() and the Account
  // screen still read them during the transition described in phase 1.
  await query(
    `UPDATE users SET secondary_email = $2, secondary_email_verified = true, updated_at = NOW()
      WHERE id = $1`,
    [userId, promoted]
  );

  await writeAuditLog({
    userId,
    actorName: params.actorName,
    action: "alt_email.verified_and_saved",
    entityType: "user",
    entityId: userId,
    oldValue: { alternativeEmail: previous },
    newValue: { alternativeEmail: promoted, sendAlternativeEmail: true, fallbackEnabled: true },
    ipAddress: params.ip,
    userAgent: params.userAgent,
  });

  return {
    ok: true,
    address: promoted,
    state: await getVerificationState(userId),
  };
}

/** Remove the live alternative address. Verification is unrelated to removal. */
export async function removeAlternativeEmail(params: {
  userId: number;
  actorName: string;
  ip: string;
  userAgent: string;
}): Promise<VerificationState> {
  const row = await loadRow(params.userId);

  await query(
    `UPDATE notification_preferences
        SET alternative_email             = NULL,
            pending_alternative_email     = NULL,
            alternative_email_verified    = false,
            alternative_email_verified_at = NULL,
            send_alternative_email        = false,
            otp_hash = NULL, otp_expires_at = NULL,
            verification_session_id = NULL, alternative_email_token_hash = NULL,
            verification_attempts = 0,
            last_verification_failed_at = NULL,
            last_verification_failure_reason = NULL,
            updated_at = NOW(), updated_by = $1
      WHERE user_id = $1`,
    [params.userId]
  );

  await query(
    `UPDATE users SET secondary_email = NULL, secondary_email_verified = false, updated_at = NOW()
      WHERE id = $1`,
    [params.userId]
  );

  if (row?.alternative_email || row?.pending_alternative_email) {
    await writeAuditLog({
      userId: params.userId,
      actorName: params.actorName,
      action: "alt_email.removed",
      entityType: "user",
      entityId: params.userId,
      oldValue: {
        alternativeEmail: row.alternative_email,
        pending: row.pending_alternative_email,
      },
      ipAddress: params.ip,
      userAgent: params.userAgent,
    });
  }

  return getVerificationState(params.userId);
}
