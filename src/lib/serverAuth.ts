import { cookies } from "next/headers";

export async function getServerSession() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("crm_session")?.value;

  if (!sessionCookie) return null;

  try {
    const decodedStr = Buffer.from(sessionCookie, "base64").toString("utf-8");
    return JSON.parse(decodedStr);
  } catch (err) {
    return null;
  }
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
