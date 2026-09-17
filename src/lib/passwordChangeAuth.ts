// lib/passwordChangeAuth.ts — short-lived, single-use password-change authorizations.
//
// After an OTP is verified, the server creates an authorization that permits
// exactly one password change for a specific user and purpose. The client
// receives an opaque token; only its HMAC-SHA256 hash is stored. This prevents
// a database dump from yielding usable authorization tokens.
//
// The authorization:
//   - is cryptographically random (32 bytes)
//   - is bound to a user_id and purpose
//   - expires after 5 minutes
//   - can be consumed exactly once (atomic UPDATE ... WHERE consumed_at IS NULL)
//   - is stored as an HMAC-SHA256 hash (same pepper as OTP)
//
// This is NOT the OTP itself. The OTP proves email control; the authorization
// permits the subsequent password write. Collapsing the two into a client-side
// flag would let a compromised frontend skip the OTP step.

import { randomBytes, createHmac } from "crypto";
import { query, transaction } from "@/lib/db";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import { sessionRevocationNow } from "@/lib/passwordReset";

/** Authorization tokens expire 5 minutes after creation. */
export const AUTH_TTL_MINUTES = 5;

/**
 * Hash an authorization token using the same OTP_PEPPER.
 * Throws if OTP_PEPPER is missing — fail-closed.
 */
function hashToken(token: string): string {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new Error("OTP_PEPPER is not configured. Authorization operations unavailable.");
  }
  return createHmac("sha256", pepper).update(token).digest("hex");
}

/**
 * Create a password-change authorization after OTP verification succeeds.
 *
 * Returns the raw token to send to the client. Only the hash is stored.
 */
export async function createPasswordChangeAuth(
  userId: number,
  purpose: string,
  organizationId: string | null
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + AUTH_TTL_MINUTES * 60 * 1000);

  // Supersede any existing authorization for this user + purpose
  await query(
    `UPDATE password_change_authorizations SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  );

  await query(
    `INSERT INTO password_change_authorizations
       (user_id, purpose, token_hash, expires_at, organization_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, purpose, tokenHash, expiresAt, organizationId]
  );

  return token;
}

export type AuthCheck =
  | { ok: true; row: { id: number; user_id: number; purpose: string } }
  | { ok: false; reason: "invalid" | "expired" | "consumed" };

/**
 * Validate a password-change authorization token without consuming it.
 */
export async function checkPasswordChangeAuth(
  userId: number,
  token: string,
  purpose: string
): Promise<AuthCheck> {
  const tokenHash = hashToken(token);

  const rows = await query<{
    id: number;
    user_id: number;
    purpose: string;
    expires_at: string;
    consumed_at: string | null;
  }>(
    `SELECT id, user_id, purpose, expires_at, consumed_at
       FROM password_change_authorizations
      WHERE user_id = $1 AND token_hash = $2 AND purpose = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, tokenHash, purpose]
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid" };
  if (row.consumed_at) return { ok: false, reason: "consumed" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, row: { id: row.id, user_id: row.user_id, purpose: row.purpose } };
}

/**
 * Atomically consume an authorization and change the password in one transaction.
 *
 * Returns true on success, false if the authorization was already consumed
 * (race condition) or the user row could not be updated.
 */
export async function consumeAuthAndChangePassword(
  authId: number,
  userId: number,
  purpose: string,
  newPassword: string
): Promise<boolean> {
  const hashed = await hashPassword(newPassword);
  const revokedAt = sessionRevocationNow();

  return await transaction(async (client) => {
    const consumed = await client.query(
      `UPDATE password_change_authorizations
          SET consumed_at = now()
        WHERE id = $1 AND consumed_at IS NULL AND purpose = $2
      RETURNING id`,
      [authId, purpose]
    );
    if (consumed.rows.length === 0) return false;

    const updated = await client.query(
      `UPDATE users
          SET password = $2,
              password_changed_at = $3,
              sessions_revoked_at = $3,
              updated_at = now()
        WHERE id = $1
          AND deleted_at IS NULL
      RETURNING id`,
      [userId, hashed, revokedAt]
    );
    return (updated.rows[0] ?? null) !== null;
  });
}
