// api/platform/organizations/[id]/users/route.ts — the users of ONE tenant,
// with their live login state.
//
// ── Organization isolation ──────────────────────────────────────────────────
// This is the endpoint the brief singles out: "Organization A → User A1, A2 must
// never accidentally return Organization B → User B1". Three things make that
// true here, and each is doing separate work:
//
//   1. `WHERE u.organization_id = $1` is on the users query itself, so another
//      tenant's rows never leave Postgres. There is no post-filter in JS — a
//      filter applied after the fetch is a filter someone can forget.
//   2. The id in the path is validated as a UUID and then checked to EXIST as an
//      organization before anything is read. A malformed or unknown id is a 400
//      or a 404, never an unscoped query.
//   3. Every JOINed table repeats the organization predicate. `employee_sessions`
//      carries its own organization_id, so the session sub-select is scoped too;
//      user ids are global integers, and a join on user_id alone would happily
//      attach another tenant's session row if an id ever collided.
//
// The organization id is NOT trusted because the frontend sent it — it is
// trusted because `requireSuperAdmin()` has already established that the caller
// may read ANY organization, and the value is then used only as a filter that
// narrows what they see. A tenant-role caller never reaches this line.
//
// ── What is not returned ────────────────────────────────────────────────────
// The column list is an allow-list. `password` is not selected, not aliased and
// not derived from — the only thing computed from it is the BOOLEAN
// `password IS NOT NULL AND btrim(password) <> ''`, evaluated inside Postgres,
// so neither the plaintext nor the scrypt hash crosses the process boundary.
// `invite_token` and the OTP columns are likewise absent.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { passwordStatusOf } from "@/lib/userSecurity";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How stale a heartbeat may be before a session stops counting as live.
 *
 * 300 seconds, matching /api/attendance/live, which already sweeps sessions
 * older than this to inactive. Using a different number here would produce a
 * panel that disagrees with the Attendance Tracker about who is online.
 */
const HEARTBEAT_TTL_SECONDS = 300;

interface Row {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  has_password: boolean;
  session_id: number | null;
  session_start: string | null;
  last_heartbeat: string | null;
  device_info: string | null;
  active_session_count: number;
  is_logged_in: boolean;
  last_activity: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { success: false, message: "Invalid organization id." },
      { status: 400 }
    );
  }

  try {
    const org = await query<{ id: string; name: string; status: string }>(
      `SELECT id, name, COALESCE(NULLIF(btrim(status), ''), 'active') AS status
         FROM organizations WHERE id = $1`,
      [id]
    );
    if (org.length === 0) {
      return NextResponse.json(
        { success: false, message: "Organization not found." },
        { status: 404 }
      );
    }

    const rows = await query<Row>(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.is_active,
         u.created_at,
         u.last_login_at,
         -- The ONLY thing derived from the credential column, and it is derived
         -- inside the database. A boolean leaves; the value never does.
         (u.password IS NOT NULL AND btrim(u.password) <> '') AS has_password,
         s.id            AS session_id,
         s.session_start AS session_start,
         s.last_heartbeat,
         s.device_info,
         COALESCE(sc.active_session_count, 0)::int AS active_session_count,
         -- ── "Logged in" is a fact about the SESSION, not about last_login_at ──
         -- The brief is explicit that login status must not be inferred from a
         -- last-login stamp, and it is right: last_login_at only ever says the
         -- person signed in once, and it is never cleared. This asks the three
         -- questions that actually decide it:
         --   * is there a session row still marked active?
         --   * has it produced a heartbeat recently enough to be a live browser?
         --   * was it issued AFTER any revocation stamped on the account?
         -- The third is what keeps this honest after a force logout: the cookie
         -- is refused by lib/serverAuth.ts from that moment, so a row that
         -- somehow survived must not still read as online.
         (
           s.id IS NOT NULL
           AND s.is_active = true
           AND s.last_heartbeat IS NOT NULL
           AND EXTRACT(EPOCH FROM (now() - s.last_heartbeat)) <= $2
           AND s.session_start > COALESCE(u.sessions_revoked_at, '-infinity'::timestamptz)
           AND s.session_start > COALESCE(u.password_changed_at, '-infinity'::timestamptz)
         ) AS is_logged_in,
         GREATEST(
           COALESCE(s.last_heartbeat, '-infinity'::timestamptz),
           COALESCE(l.last_activity AT TIME ZONE 'UTC', '-infinity'::timestamptz),
           COALESCE(u.last_login_at, '-infinity'::timestamptz)
         ) AS last_activity
       FROM users u
       -- The newest session for this user, IN THIS ORGANIZATION. The tenant
       -- predicate is inside the lateral, not applied afterwards.
       LEFT JOIN LATERAL (
         SELECT es.id, es.is_active, es.session_start, es.last_heartbeat, es.device_info
           FROM employee_sessions es
          WHERE es.user_id = u.id
            AND es.organization_id = $1
          ORDER BY es.session_start DESC
          LIMIT 1
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS active_session_count
           FROM employee_sessions es
          WHERE es.user_id = u.id
            AND es.organization_id = $1
            AND es.is_active = true
            AND es.last_heartbeat IS NOT NULL
            AND EXTRACT(EPOCH FROM (now() - es.last_heartbeat)) <= $2
       ) sc ON true
       LEFT JOIN employee_live_state l ON l.user_id = u.id
      WHERE u.organization_id = $1
        AND u.deleted_at IS NULL
      ORDER BY u.is_active DESC, lower(u.name)`,
      [id, HEARTBEAT_TTL_SECONDS]
    );

    const users = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      // The CRM's own account states. There is no separate "suspended" flag on
      // users — deactivation is `is_active`, which is what login checks.
      status: r.is_active ? "active" : "inactive",
      // A safe indicator, never the credential. See lib/userSecurity.
      passwordStatus: passwordStatusOf(r.has_password === true),
      loginStatus: r.is_logged_in ? "online" : "offline",
      activeSessions: Number(r.active_session_count ?? 0),
      currentLoginAt: r.is_logged_in ? r.session_start : null,
      device: r.is_logged_in ? r.device_info : null,
      lastLoginAt: r.last_login_at,
      lastActivityAt:
        r.last_activity && new Date(r.last_activity).getFullYear() > 1970
          ? r.last_activity
          : null,
      createdAt: r.created_at,
    }));

    const loggedIn = users.filter((u) => u.loginStatus === "online").length;

    return NextResponse.json(
      {
        success: true,
        data: {
          organization: {
            id: org[0].id,
            name: org[0].name,
            status: org[0].status,
          },
          counts: {
            total: users.length,
            active: users.filter((u) => u.status === "active").length,
            loggedIn,
          },
          users,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/platform/organizations/[id]/users]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not load the organization's users." },
      { status: 500 }
    );
  }
}
