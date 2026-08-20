// lib/superAdmin.ts — the platform-level authorization gate.
//
// There is exactly one way to prove Super Admin in this codebase, and it is
// `requireSuperAdmin()`. No route re-implements the check, because the failure
// mode of a per-route check is a route that forgets one clause.
//
// ── What makes a Super Admin ────────────────────────────────────────────────
// Two conditions, both required, both re-read from the database on every call:
//
//   1. users.role normalises to "super admin"
//   2. users.organization_id IS NULL
//
// The second is the important one. "Platform level" is not a stronger tenant
// role — it is the absence of a tenant. Requiring a NULL organization means a
// tenant Admin cannot be promoted into the platform by flipping a role string
// alone: their row still carries an organization, so the gate still refuses.
// It also makes the invariant structural rather than a naming convention, and
// it is why every tenant query (`WHERE organization_id = $1`) excludes the
// platform account for free — a NULL never matches a UUID.
//
// ── What is never trusted ───────────────────────────────────────────────────
// The role is read from the HMAC-verified `crm_session` cookie and then
// re-verified against the live row. It is never taken from a request body, a
// query parameter, a header, or localStorage. A session minted before the role
// was revoked stops working on the next request, because the row is what
// decides — not the cookie's copy of it.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession, getSessionUserId } from "@/lib/serverAuth";

/** The canonical value stored in users.role. */
export const SUPER_ADMIN_ROLE = "super_admin";

/**
 * Role-string test, matching the normalisation middleware and cpRbac already
 * use: lowercased, trimmed, underscores to spaces. So "super_admin",
 * "Super Admin" and "SUPER_ADMIN" are the same role, and no caller has to know
 * which spelling a given row happens to hold.
 */
export function isSuperAdminRole(role: unknown): boolean {
  return (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ") === "super admin";
}

export interface SuperAdminIdentity {
  id: number;
  name: string;
  email: string;
  role: string;
}

/**
 * Resolves the calling Super Admin, or null.
 *
 * Returns null for every failure — no session, wrong role, deactivated, deleted,
 * or carrying an organization — without distinguishing between them, so callers
 * cannot accidentally leak which condition failed.
 */
export async function getSuperAdmin(): Promise<SuperAdminIdentity | null> {
  const session = await getServerSession();
  if (!session?.role) return null;

  // Cheap rejection first: if the signed cookie does not even claim the role,
  // there is no reason to touch the database.
  if (!isSuperAdminRole(session.role)) return null;

  const userId = getSessionUserId(session);
  if (userId == null) return null;

  // The authoritative check. `organization_id IS NULL` is in the WHERE clause
  // rather than asserted afterwards so the row simply does not come back for a
  // tenant-scoped account.
  const rows = await query<SuperAdminIdentity & { role: string }>(
    `SELECT id, name, email, role
       FROM users
      WHERE id = $1
        AND organization_id IS NULL
        AND is_active = true
        AND deleted_at IS NULL
        AND lower(btrim(replace(role, '_', ' '))) = 'super admin'
      LIMIT 1`,
    [userId]
  );

  return rows[0] ?? null;
}

export type SuperAdminGate =
  | { ok: true; admin: SuperAdminIdentity }
  | { ok: false; response: NextResponse };

/**
 * The gate every platform API route calls as its first statement.
 *
 * 401 when there is no usable session at all, 403 when there is a session that
 * is not a platform account — enough for a client to tell "sign in" from "not
 * for you", without revealing anything about which accounts exist.
 */
export async function requireSuperAdmin(): Promise<SuperAdminGate> {
  const session = await getServerSession();
  if (!session?.role) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Not signed in." },
        { status: 401 }
      ),
    };
  }

  const admin = await getSuperAdmin();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Platform access required." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, admin };
}
