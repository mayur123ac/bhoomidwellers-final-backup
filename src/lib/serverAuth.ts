import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySession } from "./sessionCookie";

// ── Revocation-check cache ────────────────────────────────────────────────────
//
// Every gated API route calls requireSession(), which issues a PK lookup to
// check whether the session was revoked after a password-reset or force-logout.
// That lookup is correct but expensive: when 5+ dashboard API calls land
// simultaneously at startup, all 5 compete for pool connections for this auth
// query before their business queries can even begin, which is the primary cause
// of the 800–1,600 ms connection-acquisition times seen in the slow-query log.
//
// The revocation timestamps (password_changed_at / sessions_revoked_at) change
// only on two rare events: the user changes their password, or a Super Admin
// force-logs them out. A short TTL memo of those two values is safe:
//
//   • Password change: the old cookie's `iat` predates the new timestamp and
//     is refused within at most TTL ms — typically the user just re-logged in
//     and the old session is idle or already gone.
//
//   • Force logout: SSE immediately pushes FORCE_LOGOUT to the target browser,
//     which leaves the app at once. Any lingering in-flight requests from that
//     browser complete within TTL ms, which the code comment in requireSession()
//     already acknowledges ("middleware still lets a page shell render for a
//     revoked session" — the DB check is belt-and-braces, not the primary gate).
//
//   • DB error: existing behaviour is fail-open; cache preserves that.
//
// Inflight dedup: when many concurrent requests arrive for the same userId and
// the cache is cold (e.g. first page load), they all share the same pending
// Promise rather than each racing to open a pool connection.
//
// Call invalidateRevocationCache(userId) from password-change and force-logout
// routes to make revocation effective immediately rather than after TTL.
// ─────────────────────────────────────────────────────────────────────────────

const REVOCATION_CACHE_TTL_MS = 15_000; // 15 seconds

interface RevocationEntry {
  passwordChangedAt: Date | null;
  sessionsRevokedAt: Date | null;
  fetchedAt: number;
}

const revocationCache = new Map<number, RevocationEntry>();
const revocationInflight = new Map<number, Promise<RevocationEntry | null>>();

/** Drop one user's cached revocation state immediately (call on password-change / force-logout). */
export function invalidateRevocationCache(userId: number): void {
  revocationCache.delete(userId);
  // Leave any inflight promise; it will overwrite the cache with the fresh value.
}

async function fetchRevocationTimestamps(userId: number): Promise<RevocationEntry | null> {
  const now = Date.now();
  const cached = revocationCache.get(userId);
  if (cached && now - cached.fetchedAt < REVOCATION_CACHE_TTL_MS) return cached;

  // Inflight dedup: concurrent callers for the same userId await the same fetch.
  const existing = revocationInflight.get(userId);
  if (existing) return existing;

  const promise = (async (): Promise<RevocationEntry | null> => {
    try {
      const { query } = await import("./db");
      const rows = await query<{
        password_changed_at: Date | null;
        sessions_revoked_at: Date | null;
      }>(
        "SELECT password_changed_at, sessions_revoked_at FROM users WHERE id = $1 LIMIT 1",
        [userId]
      );
      if (rows.length === 0) return null;
      const entry: RevocationEntry = {
        passwordChangedAt: rows[0].password_changed_at,
        sessionsRevokedAt: rows[0].sessions_revoked_at,
        fetchedAt: Date.now(),
      };
      revocationCache.set(userId, entry);
      return entry;
    } finally {
      revocationInflight.delete(userId);
    }
  })();

  revocationInflight.set(userId, promise);
  return promise;
}

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

  const userId = getSessionUserId(session);

  // ── Sessions issued before a revocation are refused ──────────────────────
  //
  // A password reset has to mean "everyone holding the old credentials is out",
  // and the cookie is stateless — signed, self-expiring, with no server-side row
  // to delete — so there is nothing to revoke by deletion. Instead the cookie's
  // `iat` is compared against a revocation timestamp on the users row; see
  // lib/passwordReset.ts for the comparison and why it is second-granular.
  //
  // There are two such timestamps and BOTH are read here:
  //
  //   password_changed_at   the credential changed.
  //   sessions_revoked_at   a Super Admin force-logged this user out, or their
  //                         organization was suspended. The password is
  //                         untouched; the sessions are not.
  //
  // This is what makes Super Admin force logout a real revocation rather than a
  // frontend flag: after it is stamped, every gated route in the CRM refuses the
  // session that is already sitting in the user's browser. No new session store
  // was introduced to achieve it — one more column, one more term in a
  // comparison that already ran on every request.
  //
  // This lives here rather than in getServerSession() or verifySession() for two
  // reasons: this is already THE gate every API route goes through, and
  // verifySession() also runs in middleware at the edge, where there is no
  // database to ask. It costs one primary-key lookup per gated request.
  //
  // Known limit, stated rather than papered over: middleware still lets a page
  // shell render for a revoked session, because it cannot reach the database.
  // Every route that page calls returns 401, so the session is dead in practice
  // — but the redirect happens on the first data fetch, not at the edge. Force
  // logout additionally pushes an SSE FORCE_LOGOUT to the target, which the
  // dashboard already listens for, so in practice the browser leaves at once.
  if (userId != null) {
    try {
      const entry = await fetchRevocationTimestamps(userId);
      const { sessionIsRevoked } = await import("./passwordReset");
      if (
        entry !== null &&
        sessionIsRevoked(session, {
          passwordChangedAt: entry.passwordChangedAt,
          sessionsRevokedAt: entry.sessionsRevokedAt,
        })
      ) {
        return deny("Your session was ended. Please sign in again.", "SESSION_REVOKED", 401);
      }
    } catch {
      // A database hiccup must not lock everyone out of a working session; the
      // signed cookie is still proof of a genuine login. Fail open here and let
      // the route's own query surface the outage.
    }
  }

  return { ok: true, session, userId };
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
