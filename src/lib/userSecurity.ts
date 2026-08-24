// lib/userSecurity.ts — the credential and session operations an administrator
// performs ON ANOTHER USER.
//
// ── Why this file exists rather than a second set of endpoints ──────────────
// Two callers need exactly the same behaviour and disagree about one thing only:
//
//   Tenant Admin   /api/settings/employees — scoped by getOrganizationId(),
//                  which reads the caller's own `org` session claim.
//   Super Admin    /api/platform/users/[id] — has NO organization of its own
//                  (that is what makes it platform level), so getOrganizationId()
//                  cannot answer for it and would throw.
//
// That difference is why Super Admin cannot simply call the Admin endpoint: the
// Admin endpoint derives the tenant from the caller, and the caller here has
// none. So the ROUTES differ and the BEHAVIOUR does not — the policy (what a
// valid password is, how it is hashed, what a change does to live sessions, how
// email uniqueness is decided) lives here, once, and both routes call in.
//
// The organization is a required argument on every function. It is never
// resolved inside, and it is never optional: a NULL organization would make the
// UPDATE match a platform account, so passing one in is deliberately impossible.
// Callers obtain it server-side — the tenant route from the session, the
// platform route by reading the target user's own row — never from a request
// body.
//
// ── What never leaves this module ───────────────────────────────────────────
// The `password` column is never SELECTed here and is written in exactly one
// place. No function returns it, no function returns a hash, and no function
// accepts one. `passwordStatusOf()` exists precisely so a UI can show that
// credentials are configured without the value travelling in order to say so.

import { query } from "@/lib/db";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import { broadcastEvent } from "@/lib/eventBus";
import { sessionRevocationNow } from "@/lib/passwordReset";

/**
 * The message shown when a password fails the rules, worded once.
 *
 * The rules themselves are in lib/passwords.ts (`passwordMeetsRules`) and are
 * the same ones the Admin employee screen and the Super Admin account screen
 * already enforce — this is the sentence, not a second rule set.
 */
export const PASSWORD_RULES_MESSAGE =
  "Password must be at least 8 characters and include an uppercase letter, " +
  "a lowercase letter, a number and a symbol.";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the UI is allowed to know about a stored credential. */
export type PasswordStatus = "set" | "not_set";

/**
 * Derives the password status WITHOUT the value.
 *
 * Takes a boolean the SQL computed (`password IS NOT NULL AND password <> ''`),
 * never the column. The distinction matters: a helper that took the hash and
 * returned "set" would still have pulled the hash across the process boundary
 * and into whatever logs the query. The column is not selected at all.
 */
export function passwordStatusOf(hasPassword: boolean): PasswordStatus {
  return hasPassword ? "set" : "not_set";
}

export interface TargetUser {
  id: number;
  name: string;
  email: string;
  role: string;
  organization_id: string | null;
}

/**
 * Loads the user an administrator is about to act on, scoped to one tenant.
 *
 * Returns null when the id does not exist, is soft-deleted, or belongs to a
 * DIFFERENT organization — the three are not distinguished, so a caller poking
 * at ids cannot use the response to map which tenant owns which user.
 *
 * `organization_id = $2` is the whole point of this function. Every mutation
 * below re-states it in its own WHERE clause rather than trusting that this ran
 * first, because a check and an update two statements apart are two places for a
 * future edit to drift.
 */
export async function loadTargetUser(
  userId: number,
  organizationId: string
): Promise<TargetUser | null> {
  const rows = await query<TargetUser>(
    `SELECT id, name, email, role, organization_id
       FROM users
      WHERE id = $1
        AND organization_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [userId, organizationId]
  );
  return rows[0] ?? null;
}

export type SecurityResult =
  | { ok: true }
  | { ok: false; message: string; status: 400 | 404 | 409 };

/**
 * Sets another user's password.
 *
 * Three things happen and all three are the point:
 *
 *   1. the plaintext is validated against the project's own rules;
 *   2. it is hashed with lib/passwords.hashPassword (scrypt, N=2^16) — the same
 *      function login verifies against, so there is no second hashing scheme;
 *   3. `password_changed_at` is stamped, which REVOKES every session issued
 *      under the old password (lib/serverAuth.ts refuses a cookie whose `iat`
 *      predates it).
 *
 * Point 3 is the application's existing security policy for a password change —
 * the self-service path in /api/settings/password and the platform account path
 * both already do it — applied here so an administrator-initiated change is not
 * the one kind of change that leaves old sessions alive.
 *
 * The plaintext is never stored, never logged, and never returned.
 */
export async function setUserPassword(params: {
  userId: number;
  /** Server-derived. Never a value from the request body. */
  organizationId: string;
  newPassword: string;
}): Promise<SecurityResult> {
  const { userId, organizationId, newPassword } = params;

  if (!newPassword) return { ok: false, message: "A new password is required.", status: 400 };
  if (!passwordMeetsRules(newPassword)) {
    return { ok: false, message: PASSWORD_RULES_MESSAGE, status: 400 };
  }

  // Hashed before the UPDATE rather than inside a transaction: scrypt at these
  // parameters takes ~100ms, and holding a pooled connection through it would be
  // a slow transaction for nothing.
  const hashed = await hashPassword(newPassword);

  // The stamp comes from the APPLICATION clock, not SQL now() — see
  // sessionRevocationNow() for the skew this avoids. `updated_at` keeps now(),
  // because nothing compares it to a token.
  const updated = await query<{ id: number }>(
    `UPDATE users
        SET password = $3,
            password_changed_at = $4,
            updated_at = now()
      WHERE id = $1
        AND organization_id = $2
        AND deleted_at IS NULL
    RETURNING id`,
    [userId, organizationId, hashed, sessionRevocationNow()]
  );

  if (updated.length === 0) {
    return { ok: false, message: "User not found in that organization.", status: 404 };
  }
  return { ok: true };
}

/**
 * Changes another user's email address.
 *
 * ── Why the uniqueness check is global and covers `name` too ────────────────
 * `users.email` has NO unique constraint in this schema; uniqueness is an
 * application rule, and the login route resolves an identifier with
 * `LOWER(email) = $1 OR LOWER(name) = $1 ... LIMIT 1`. So an address that
 * collides with another row's NAME is exactly as ambiguous as one colliding with
 * its email — whichever row Postgres returns first decides who signs in. Both
 * columns are therefore checked across every organization, which is the rule
 * /api/settings/employees and /api/platform/account/email already apply. Scoping
 * it per tenant would be the bug, not the fix.
 *
 * ── Verification ────────────────────────────────────────────────────────────
 * The CRM has an OTP-verified email change (/api/settings/email-change) for a
 * user changing their OWN address, where the point is proving the requester
 * controls the mailbox. An administrator setting someone else's address is the
 * established out-of-band path — the same one /api/settings/employees uses for
 * Admin — and is deliberately not routed through an OTP the administrator would
 * have to read out of the employee's inbox to complete. That existing behaviour
 * is preserved rather than replaced.
 */
export async function setUserEmail(params: {
  userId: number;
  /** Server-derived. Never a value from the request body. */
  organizationId: string;
  newEmail: string;
}): Promise<SecurityResult & { email?: string }> {
  const { userId, organizationId } = params;
  const newEmail = (params.newEmail ?? "").trim().toLowerCase();

  if (!newEmail) return { ok: false, message: "A new email address is required.", status: 400 };
  if (!EMAIL_RE.test(newEmail)) {
    return { ok: false, message: "That is not a valid email address.", status: 400 };
  }
  if (newEmail.length > 254) {
    return { ok: false, message: "That email address is too long.", status: 400 };
  }

  const clash = await query<{ id: number }>(
    `SELECT id FROM users
      WHERE id <> $1
        AND deleted_at IS NULL
        AND (LOWER(email) = $2 OR LOWER(name) = $2)
      LIMIT 1`,
    [userId, newEmail]
  );
  if (clash.length > 0) {
    return { ok: false, message: "That email address is already in use.", status: 409 };
  }

  const updated = await query<{ id: number; email: string }>(
    `UPDATE users
        SET email = $3, updated_at = now()
      WHERE id = $1
        AND organization_id = $2
        AND deleted_at IS NULL
    RETURNING id, email`,
    [userId, organizationId, newEmail]
  );

  if (updated.length === 0) {
    return { ok: false, message: "User not found in that organization.", status: 404 };
  }
  return { ok: true, email: updated[0].email };
}

/**
 * Ends every one of a user's sessions — for real.
 *
 * ── The two halves, and why neither alone is enough ─────────────────────────
 *
 *   employee_sessions          the TRACKED session: what Attendance and Live
 *                              Activity read, and what "currently logged in" is
 *                              computed from. Closing these rows is what makes
 *                              the panels agree. On its own it revokes nothing —
 *                              the cookie in the user's browser has never
 *                              consulted this table.
 *
 *   users.sessions_revoked_at  the REVOCATION. Auth is a stateless signed
 *                              cookie, so there is no row to delete;
 *                              lib/serverAuth.ts refuses any session whose `iat`
 *                              predates this stamp. This is what actually stops
 *                              the request. On its own it would leave the
 *                              attendance timer running.
 *
 * Both are done, in that order, and the stamp is the one that must not fail.
 *
 * The SSE nudge afterwards is a courtesy, not the mechanism: the dashboard's
 * useActivityTracker already listens for FORCE_LOGOUT and clears the client
 * session, so the browser leaves immediately instead of at its next fetch. If
 * the socket is gone, the next request is refused anyway.
 */
export async function revokeUserSessions(params: {
  userId: number;
  /** Server-derived. Never a value from the request body. */
  organizationId: string;
  /** Stored on the closed rows; matches the existing session_end_reason values. */
  reason?: string;
}): Promise<SecurityResult & { closedSessions?: number }> {
  const { userId, organizationId } = params;
  const reason = params.reason ?? "forced_logout";

  // The stamp first. If the second statement fails, the session is still dead —
  // the reverse ordering would leave a user logged out of the attendance panel
  // but still able to call every API.
  const stamped = await query<{ id: number }>(
    `UPDATE users
        SET sessions_revoked_at = $3,
            updated_at = now()
      WHERE id = $1
        AND organization_id = $2
        AND deleted_at IS NULL
    RETURNING id`,
    [userId, organizationId, sessionRevocationNow()]
  );
  if (stamped.length === 0) {
    return { ok: false, message: "User not found in that organization.", status: 404 };
  }

  const closed = await query<{ id: number }>(
    `UPDATE employee_sessions
        SET is_active = false,
            session_end = NOW(),
            session_end_reason = $3
      WHERE user_id = $1
        AND organization_id = $2
        AND is_active = true
    RETURNING id`,
    [userId, organizationId, reason]
  );

  // Tenant-scoped as well as user-scoped, exactly as /api/attendance/force-logout
  // does it: user ids are global, so an id that collided across tenants would
  // otherwise sign out the wrong person's browser.
  try {
    broadcastEvent(organizationId, { type: "FORCE_LOGOUT" }, undefined, userId);
    broadcastEvent(
      organizationId,
      { type: "SESSION_UPDATE", userId, status: "OFFLINE", message: "Forcefully Terminated" },
      ["admin", "site_head"]
    );
  } catch {
    // An in-memory broadcast failing must not turn a completed revocation into
    // an error the operator will retry. The revocation already happened.
  }

  return { ok: true, closedSessions: closed.length };
}

/**
 * Revokes every session belonging to an organization.
 *
 * Used when a tenant is suspended: leaving its people signed in would make
 * suspension a label rather than a control. One statement over the whole tenant
 * rather than a loop, so a large tenant costs one round trip.
 */
export async function revokeOrganizationSessions(
  organizationId: string,
  reason = "organization_suspended"
): Promise<{ users: number; closedSessions: number }> {
  const stamped = await query<{ id: number }>(
    `UPDATE users
        SET sessions_revoked_at = $2, updated_at = now()
      WHERE organization_id = $1
        AND deleted_at IS NULL
    RETURNING id`,
    [organizationId, sessionRevocationNow()]
  );

  const closed = await query<{ id: number }>(
    `UPDATE employee_sessions
        SET is_active = false, session_end = NOW(), session_end_reason = $2
      WHERE organization_id = $1 AND is_active = true
    RETURNING id`,
    [organizationId, reason]
  );

  try {
    broadcastEvent(organizationId, { type: "FORCE_LOGOUT" });
  } catch {
    /* see revokeUserSessions */
  }

  return { users: stamped.length, closedSessions: closed.length };
}

/**
 * Activates or deactivates a user, reusing the CRM's OWN deactivation model.
 *
 * There is no separate "suspended" flag and none is added: `is_active` is what
 * the login route checks ("Account deactivated. Please contact admin."), what
 * requireSession() checks, and what every employee screen already renders.
 * `deactivated_at` is the existing companion column. This is the same pair of
 * writes /api/settings/employees performs for `action: "setStatus"`.
 *
 * Deactivating also revokes: an account that can no longer sign in but whose
 * existing cookie still works is not deactivated in any sense that matters.
 */
export async function setUserActive(params: {
  userId: number;
  organizationId: string;
  isActive: boolean;
}): Promise<SecurityResult> {
  const { userId, organizationId, isActive } = params;

  const updated = await query<{ id: number }>(
    `UPDATE users
        SET is_active = $3,
            deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END,
            updated_at = now()
      WHERE id = $1
        AND organization_id = $2
        AND deleted_at IS NULL
    RETURNING id`,
    [userId, organizationId, isActive]
  );

  if (updated.length === 0) {
    return { ok: false, message: "User not found in that organization.", status: 404 };
  }

  if (!isActive) {
    await revokeUserSessions({ userId, organizationId, reason: "account_deactivated" });
  }

  return { ok: true };
}

/**
 * True when disabling this user would leave their organization with no active
 * Admin at all.
 *
 * /api/settings/employees already refuses that for its own edits; the platform
 * routes refuse it too, so a Super Admin cannot accidentally strand a tenant
 * they then have to repair by hand.
 *
 * Force logout is deliberately NOT guarded by this: signing the last Admin out
 * is reversible by them signing back in, which is the entire point of the
 * action.
 */
export async function isLastActiveAdmin(
  userId: number,
  organizationId: string
): Promise<boolean> {
  const self = await query<{ role: string; is_active: boolean }>(
    `SELECT role, is_active FROM users
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [userId, organizationId]
  );
  const selfIsAdmin =
    (self[0]?.role ?? "").trim().toLowerCase().replace(/_/g, " ") === "admin";
  if (!selfIsAdmin || self[0]?.is_active !== true) return false;

  const others = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM users
      WHERE organization_id = $2
        AND id <> $1
        AND is_active = true
        AND deleted_at IS NULL
        AND lower(btrim(replace(role, '_', ' '))) = 'admin'`,
    [userId, organizationId]
  );
  return Number(others[0]?.count ?? 0) === 0;
}
