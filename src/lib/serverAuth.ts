import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySession } from "./sessionCookie";

/**
 * The signed-in user, or null.
 *
 * The cookie is now HMAC-verified (see lib/sessionCookie.ts) rather than merely
 * base64-decoded. Every route that gates on `session.role` depends on this call
 * refusing a payload it cannot prove the server issued — previously a hand-made
 * cookie claiming `role: "admin"` was accepted everywhere.
 *
 * Return shape is unchanged, so callers need no edits.
 */
export async function getServerSession() {
  const cookieStore = await cookies();
  return verifySession(cookieStore.get("crm_session")?.value);
}

/**
 * Resolves the numeric users.id for the current session.
 *
 * The login route stores the user as `_id` (stringified) in the crm_session
 * cookie — there is no `id` field. Reading `session.id` yields undefined, which
 * node-postgres binds as NULL, so `WHERE employee_id = $1` silently matches
 * nothing. Always go through this helper instead of touching the field directly.
 */
export function getSessionUserId(session: any): number | null {
  const raw = session?._id ?? session?.id;
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE session gate. Every API route calls one of these two helpers and nothing
   else.

   70 of 111 routes shipped with no session check at all, and the ones that did
   check each rolled their own — which is how /api/admin/ai/chat ended up with a
   comment reading "for now, we trust the frontend role check". The fix is not
   better per-route checks; it is removing the discretion to write one. If a
   route needs a user, it calls requireSession(). If it needs a specific role, it
   calls requireRoles(). There is no third option.

   No `req` parameter: cookies() reads from ambient request context in the App
   Router, so passing the request would be decoration that implies the helper
   might read something else from it.
   ════════════════════════════════════════════════════════════════════════════ */

export interface SessionUser {
  _id: string;
  name: string;
  email?: string;
  role: string;
  isActive?: boolean;
  /**
   * MT-05: the signing user's organization, as a UUID string.
   *
   * Stamped at login from `users.organization_id` and carried inside the
   * SIGNED payload, so it cannot be edited by the cookie holder — the same
   * protection `role` relies on. Read it through
   * `getOrganizationId()` in lib/tenantContext, never directly: routes must not
   * acquire the habit of pulling a tenant id out of a request object.
   *
   * Optional because sessions issued before MT-05 do not carry it. Those fall
   * back to sole-organization resolution, which stays correct while exactly one
   * organization exists and fails loudly the moment that stops being true.
   */
  org?: string;
  iat?: number;
  exp?: number;
}

export type SessionGate =
  | { ok: true; session: SessionUser; userId: number | null }
  | { ok: false; response: NextResponse };

function deny(message: string, code: string, status: 401 | 403): SessionGate {
  return {
    ok: false,
    response: NextResponse.json({ success: false, message, code }, { status }),
  };
}

/**
 * Require a signed-in user. Rejects missing, unsigned, forged, tampered and
 * expired cookies alike — verifySession cannot tell them apart and neither
 * should the caller.
 *
 * Usage:
 *   const gate = await requireSession();
 *   if (!gate.ok) return gate.response;
 *   // gate.session is trustworthy from here
 */
export async function requireSession(): Promise<SessionGate> {
  const session = (await getServerSession()) as SessionUser | null;

  if (!session?.role) {
    return deny("You must be signed in.", "UNAUTHORIZED", 401);
  }
  if (session.isActive === false) {
    return deny("This account is deactivated.", "ACCOUNT_DISABLED", 403);
  }

  return { ok: true, session, userId: getSessionUserId(session) };
}

/**
 * Require one of the named roles. Role strings are inconsistent in the users
 * table ("site_head" and "Site Head" both occur), so both sides are normalized
 * the same way rather than each caller remembering to.
 */
export async function requireRoles(allowedRoles: string[]): Promise<SessionGate> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const normalize = (r: unknown) => (r ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
  const allowed = allowedRoles.map(normalize);

  if (!allowed.includes(normalize(gate.session.role))) {
    return deny("Your role cannot perform this action.", "FORBIDDEN", 403);
  }
  return gate;
}

export async function requireRole(allowedRoles: string[]) {
  const session = await getServerSession();

  if (!session || !session.role) {
    return {
      isAuthorized: false,
      session: null,
      error: "Unauthorized",
      status: 401,
    };
  }

  const role = session.role.toLowerCase();

  // Normalize allowed roles for comparison
  const normalizedAllowedRoles = allowedRoles.map((r) => r.toLowerCase());

  if (!normalizedAllowedRoles.includes(role)) {
    return {
      isAuthorized: false,
      session,
      error: "Forbidden - Insufficient permissions",
      status: 403,
    };
  }

  return {
    isAuthorized: true,
    session,
    error: null,
    status: 200,
  };
}
