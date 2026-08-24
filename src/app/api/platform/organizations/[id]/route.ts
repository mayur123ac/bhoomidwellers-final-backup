// api/platform/organizations/[id]/route.ts — one tenant, for the detail sheet.
//
// Read-only. The figures are counts of a tenant's records, never the records
// themselves: a platform operator needs to know an organization has 314 leads,
// not who those leads are. Nothing here returns a customer name, a phone number,
// or any user's credentials.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { revokeOrganizationSessions } from "@/lib/userSecurity";

export const dynamic = "force-dynamic";

/** Rejects anything that is not a UUID before it reaches Postgres. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const rows = await query(
      `SELECT
         o.id, o.name, o.slug,
         COALESCE(NULLIF(btrim(o.status), ''), 'active') AS status,
         o.created_at, o.updated_at,
         (SELECT count(*)::int FROM users u
           WHERE u.organization_id = o.id AND u.deleted_at IS NULL) AS users,
         (SELECT count(*)::int FROM users u
           WHERE u.organization_id = o.id AND u.deleted_at IS NULL
             AND lower(btrim(replace(u.role, '_', ' '))) = 'admin') AS admins,
         (SELECT count(*)::int FROM walkin_enquiries w
           WHERE w.organization_id = o.id) AS leads,
         (SELECT count(*)::int FROM booking_applications b
           WHERE b.organization_id = o.id) AS bookings,
         (SELECT count(*)::int FROM booking_applications b
           WHERE b.organization_id = o.id AND b.booking_status = 'Confirmed') AS confirmed_bookings,
         (SELECT count(*)::int FROM inventory_projects p
           WHERE p.organization_id = o.id) AS projects,
         (SELECT count(*)::int FROM channel_partners c
           WHERE c.organization_id = o.id) AS channel_partners,
         (SELECT max(s.session_start) FROM employee_sessions s
           WHERE s.organization_id = o.id) AS last_session_at,
         (SELECT max(w.created_at) FROM walkin_enquiries w
           WHERE w.organization_id = o.id) AS last_lead_at
       FROM organizations o
      WHERE o.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Organization not found." },
        { status: 404 }
      );
    }

    const o = rows[0];
    const lastActivity = [o.last_session_at, o.last_lead_at, o.updated_at]
      .filter(Boolean)
      .sort((a: any, b: any) => +new Date(b) - +new Date(a))[0] ?? null;

    return NextResponse.json(
      { success: true, data: { ...o, last_activity: lastActivity } },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/platform/organizations/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

/**
 * Suspend or reactivate a tenant.
 *
 * ── Why suspension revokes sessions ─────────────────────────────────────────
 * `organizations.status` already existed and the Organizations table already had
 * a Suspend control; what neither had was a meaning. A status column that only
 * repaints a pill is the frontend `isLoggedIn` variable the brief warns about,
 * one level up: the tenant would be labelled suspended and its 24 people would
 * carry on working.
 *
 * So suspension does two things. It sets the status, and it revokes every
 * session belonging to the organization through the same mechanism a per-user
 * force logout uses — `users.sessions_revoked_at` plus closing the tracked
 * `employee_sessions` rows. Signing back in is then blocked by the login route,
 * which refuses a suspended tenant.
 *
 * Reactivating clears the status and nothing else. It deliberately does NOT
 * un-revoke: people sign in again, which is a two-second inconvenience and
 * avoids resurrecting cookies minted before the suspension.
 *
 * The Super Admin's own account is untouched by all of this — it has no
 * organization, so `WHERE organization_id = $1` cannot match it, and suspending
 * every tenant on the estate still leaves the platform operator signed in.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, message: "Invalid organization id." }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const status = (body?.status ?? "").toString().trim().toLowerCase();

    // An allow-list, not a passthrough: `status` is a bare text column with no
    // CHECK constraint, so anything written here becomes a value the
    // Organizations filter and the status pill have to cope with forever.
    if (status !== "active" && status !== "suspended") {
      return NextResponse.json(
        { success: false, message: "Status must be either 'active' or 'suspended'." },
        { status: 400 }
      );
    }

    const before = await query<{ id: string; name: string; status: string }>(
      `SELECT id, name, COALESCE(NULLIF(btrim(status), ''), 'active') AS status
         FROM organizations WHERE id = $1`,
      [id]
    );
    if (before.length === 0) {
      return NextResponse.json({ success: false, message: "Organization not found." }, { status: 404 });
    }

    const updated = await query<{ id: string; name: string; status: string }>(
      `UPDATE organizations
          SET status = $2, updated_at = now()
        WHERE id = $1
      RETURNING id, name, status`,
      [id, status]
    );

    let revoked = { users: 0, closedSessions: 0 };
    if (status === "suspended") {
      revoked = await revokeOrganizationSessions(id);
    }

    const { ip, userAgent } = requestContext(req);
    await writeAuditLog({
      userId: gate.admin.id,
      actorName: gate.admin.name,
      action: status === "suspended" ? "platform.organization.suspend" : "platform.organization.reactivate",
      entityType: "organization",
      entityId: id,
      oldValue: { status: before[0].status },
      newValue: {
        status,
        organization: before[0].name,
        usersSignedOut: revoked.users,
        sessionsClosed: revoked.closedSessions,
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json(
      {
        success: true,
        data: updated[0],
        message:
          status === "suspended"
            ? `Organization suspended. ${revoked.users} ${revoked.users === 1 ? "user was" : "users were"} signed out and can no longer sign in.`
            : "Organization reactivated. Its users can sign in again.",
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[PATCH /api/platform/organizations/[id]]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not change the organization's status." },
      { status: 500 }
    );
  }
}
