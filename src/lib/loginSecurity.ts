// lib/loginSecurity.ts — failed-login thresholds and device trust tokens.
//
// Two concerns that both belong to the sign-in path and both need to stay out
// of the login route itself, which is already the busiest handler in the app.
//
// ── On "Lock status" ────────────────────────────────────────────────────────
// The spec asks the burst alert to report a lock status. This CRM does not lock
// accounts after failed attempts, and this module does not add that — automatic
// lockout is a denial-of-service primitive as much as a defence (anyone who
// knows a colleague's email can lock them out of work), and switching it on is
// a policy decision for the business, not a side effect of adding an email.
//
// So the field reports the truth: the account is not locked, and it says what
// would have to change for that to be otherwise. `describeLockStatus()` is the
// single place to revise if a lockout policy is later adopted.

import crypto from "node:crypto";
import { query } from "@/lib/db";

export const FAILED_LOGIN_THRESHOLD = 5;
export const FAILED_LOGIN_WINDOW_MINUTES = 15;

/** How long a "Was this you?" link stays usable. */
const DEVICE_CONFIRM_TTL_HOURS = 72;

export interface FailedAttemptRecord {
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export interface FailedLoginOutcome {
  /** Attempts inside the window, including the one just recorded. */
  count: number;
  /** True only on the attempt that crosses the threshold. */
  thresholdCrossed: boolean;
  recent: FailedAttemptRecord[];
}

/**
 * Record a failed sign-in and report whether it has just crossed the threshold.
 *
 * `thresholdCrossed` is true on exactly one attempt per burst, not on every
 * attempt from the fifth onward. Without that, a sustained attack would send an
 * email per guess — turning a security feature into an outbound mailbomb aimed
 * at the victim.
 *
 * The suppression works by looking for an already-alerted attempt inside the
 * window rather than by a cooldown timestamp: once an alert has fired, no
 * further alert fires until the window clears of alerted rows, which is the same
 * thing but needs no extra column.
 */
export async function recordFailedLogin(params: {
  userId: number | null;
  identifier: string;
  ip: string;
  userAgent: string;
}): Promise<FailedLoginOutcome> {
  const identifier = params.identifier.trim().toLowerCase().slice(0, 255);

  try {
    await query(
      `INSERT INTO failed_login_attempts (user_id, identifier, ip_address, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [
        params.userId,
        identifier,
        (params.ip || "").split(",")[0].trim().slice(0, 64) || null,
        params.userAgent || null,
      ]
    );

    const rows = await query<FailedAttemptRecord & { alerted_at: string | null }>(
      `SELECT created_at, ip_address, user_agent, alerted_at
         FROM failed_login_attempts
        WHERE identifier = $1
          AND created_at >= NOW() - ($2 || ' minutes')::interval
        ORDER BY created_at DESC`,
      [identifier, String(FAILED_LOGIN_WINDOW_MINUTES)]
    );

    const count = rows.length;
    const alreadyAlerted = rows.some((r) => r.alerted_at !== null);
    const thresholdCrossed = count >= FAILED_LOGIN_THRESHOLD && !alreadyAlerted;

    if (thresholdCrossed) {
      // Stamp every attempt in the window, so the suppression check above sees
      // the burst as handled no matter which row it inspects.
      await query(
        `UPDATE failed_login_attempts
            SET alerted_at = NOW()
          WHERE identifier = $1
            AND created_at >= NOW() - ($2 || ' minutes')::interval
            AND alerted_at IS NULL`,
        [identifier, String(FAILED_LOGIN_WINDOW_MINUTES)]
      );
    }

    // Opportunistic retention sweep — see the note at the foot of
    // notification_routing_phase2_2026-08-07.sql.
    if (Math.random() < 0.005) {
      await query(
        `DELETE FROM failed_login_attempts WHERE created_at < NOW() - INTERVAL '30 days'`
      );
    }

    return {
      count,
      thresholdCrossed,
      recent: rows.slice(0, FAILED_LOGIN_THRESHOLD),
    };
  } catch (err) {
    // A tracking failure must never fail a login attempt — not even a failed
    // one, which still needs to return its 401 rather than a 500.
    console.error(
      "[loginSecurity] could not record failed attempt:",
      err instanceof Error ? err.message : String(err)
    );
    return { count: 0, thresholdCrossed: false, recent: [] };
  }
}

/** Clear the burst history for an identifier after a successful sign-in. */
export async function clearFailedLogins(identifier: string): Promise<void> {
  try {
    await query(`DELETE FROM failed_login_attempts WHERE identifier = $1`, [
      identifier.trim().toLowerCase(),
    ]);
  } catch {
    /* non-fatal: the rows age out on their own */
  }
}

/**
 * What to print in the alert's "Lock status" field.
 *
 * See the module header. This tells the truth rather than implying a protection
 * that is not in place.
 */
export function describeLockStatus(): string {
  return "Not locked — this CRM does not lock accounts automatically after failed attempts.";
}

/* ══════════════════════════════════════════════════════════════════════════
   Device trust
   ══════════════════════════════════════════════════════════════════════════ */

export interface DeviceConfirmLinks {
  confirmUrl: string;
  secureUrl: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint the "Was this you?" links for a newly-seen device.
 *
 * One token covers both actions, with the action carried as a separate query
 * parameter. Two tokens would be no more secure — anyone holding the email holds
 * both — and would double what has to be stored and expired.
 *
 * Returns null if the token cannot be stored, so the caller renders the email
 * without a call to action rather than with links that would 404.
 */
export async function issueDeviceConfirmLinks(params: {
  userId: number;
  deviceHash: string;
  origin: string;
}): Promise<DeviceConfirmLinks | null> {
  try {
    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + DEVICE_CONFIRM_TTL_HOURS * 3600_000).toISOString();

    const updated = await query<{ id: number }>(
      `UPDATE known_login_devices
          SET confirm_token_hash = $3, confirm_expires_at = $4
        WHERE user_id = $1 AND device_hash = $2
        RETURNING id`,
      [params.userId, params.deviceHash, hashToken(token), expires]
    );

    if (updated.length === 0) return null;

    const base = `${params.origin}/api/security/device?uid=${params.userId}&token=${encodeURIComponent(token)}`;
    return {
      confirmUrl: `${base}&action=confirm`,
      secureUrl: `${base}&action=secure`,
    };
  } catch (err) {
    console.error(
      "[loginSecurity] could not issue device confirm links:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

export type DeviceTrustOutcome =
  | { ok: true; action: "confirm" | "secure"; deviceLabel: string; sessionsEnded: number }
  | { ok: false; message: string };

/**
 * Apply a "Was this you?" response.
 *
 * The token is single-use: it is cleared whichever way the user answers, so a
 * forwarded email cannot be replayed to flip the decision back.
 */
export async function respondToDevicePrompt(params: {
  userId: number;
  token: string;
  action: "confirm" | "secure";
}): Promise<DeviceTrustOutcome> {
  const rows = await query<{
    id: number;
    device_label: string;
    confirm_token_hash: string | null;
    confirm_expires_at: string | null;
  }>(
    `SELECT id, device_label, confirm_token_hash, confirm_expires_at
       FROM known_login_devices
      WHERE user_id = $1 AND confirm_token_hash IS NOT NULL`,
    [params.userId]
  );

  const supplied = Buffer.from(hashToken(params.token), "hex");

  // Compared against every outstanding token for this user rather than looked up
  // by hash, so the comparison stays constant-time per row. A user has at most a
  // handful of devices, so the scan is trivial.
  const match = rows.find((row) => {
    if (!row.confirm_token_hash) return false;
    const stored = Buffer.from(row.confirm_token_hash, "hex");
    return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
  });

  if (!match) return { ok: false, message: "This link is not valid or has already been used." };

  if (match.confirm_expires_at && new Date(match.confirm_expires_at).getTime() <= Date.now()) {
    await query(
      `UPDATE known_login_devices SET confirm_token_hash = NULL, confirm_expires_at = NULL WHERE id = $1`,
      [match.id]
    );
    return { ok: false, message: "This link has expired." };
  }

  await query(
    `UPDATE known_login_devices
        SET trusted = $2, trust_responded_at = NOW(),
            confirm_token_hash = NULL, confirm_expires_at = NULL
      WHERE id = $1`,
    [match.id, params.action === "confirm"]
  );

  let sessionsEnded = 0;

  if (params.action === "secure") {
    // Closes the tracked login sessions. The same caveat applies as in
    // /api/settings/password: sessions are stateless signed cookies, so an
    // already-issued cookie stays valid for its remaining TTL and cannot be torn
    // up from here. This ends what CAN be ended and is honest in the response
    // about what that means, rather than claiming a full revocation.
    const ended = await query<{ id: number }>(
      `UPDATE employee_sessions
          SET is_active = false, session_end = NOW(), session_end_reason = 'device_not_recognised'
        WHERE user_id = $1 AND is_active = true
        RETURNING id`,
      [params.userId]
    );
    sessionsEnded = ended.length;
  }

  return {
    ok: true,
    action: params.action,
    deviceLabel: match.device_label,
    sessionsEnded,
  };
}
