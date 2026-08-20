// api/platform/organizations/[id]/route.ts — one tenant, for the detail sheet.
//
// Read-only. The figures are counts of a tenant's records, never the records
// themselves: a platform operator needs to know an organization has 314 leads,
// not who those leads are. Nothing here returns a customer name, a phone number,
// or any user's credentials.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";

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
