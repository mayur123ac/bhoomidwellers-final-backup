// api/platform/organizations/route.ts — every tenant on the platform.
//
// ── Why these queries have no organization_id filter ────────────────────────
// Every other read in this codebase is tenant-scoped, and correctly so. This one
// must not be: a platform operator asking "which organizations exist" cannot be
// answered by a query confined to one organization. The isolation that matters
// here is at the gate, not in the WHERE clause — requireSuperAdmin() is the
// first statement, and nothing below runs without it.
//
// The counts are GROUPed BY organization_id rather than fetched per tenant, so
// adding the hundredth organization does not add a hundred queries.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  try {
    const rows = await query(
      `SELECT
         o.id,
         o.name,
         o.slug,
         -- status is a real column on organizations; defaulted rather than
         -- invented so a NULL reads as active instead of blank in the UI.
         COALESCE(NULLIF(btrim(o.status), ''), 'active') AS status,
         o.created_at,
         COALESCE(u.total, 0)    AS users,
         COALESCE(u.admins, 0)   AS admins,
         COALESCE(l.total, 0)    AS leads,
         COALESCE(b.total, 0)    AS bookings,
         COALESCE(p.total, 0)    AS projects,
         -- "Last activity" is the most recent of the signals a tenant actually
         -- produces. GREATEST ignores NULLs only if every argument is NULL, so
         -- each is coalesced to a floor date and the result nulled back out.
         NULLIF(GREATEST(
           COALESCE(l.last_at,  'epoch'::timestamptz),
           COALESCE(b.last_at,  'epoch'::timestamptz),
           COALESCE(s.last_at,  'epoch'::timestamptz),
           COALESCE(o.updated_at, 'epoch'::timestamptz)
         ), 'epoch'::timestamptz) AS last_activity
       FROM organizations o
       LEFT JOIN (
         SELECT organization_id,
                count(*)::int AS total,
                count(*) FILTER (
                  WHERE lower(btrim(replace(role, '_', ' '))) = 'admin'
                )::int AS admins
           FROM users
          WHERE deleted_at IS NULL
          GROUP BY organization_id
       ) u ON u.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, count(*)::int AS total, max(created_at) AS last_at
           FROM walkin_enquiries GROUP BY organization_id
       ) l ON l.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, count(*)::int AS total, max(created_at) AS last_at
           FROM booking_applications GROUP BY organization_id
       ) b ON b.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, count(*)::int AS total
           FROM inventory_projects GROUP BY organization_id
       ) p ON p.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, max(session_start) AS last_at
           FROM employee_sessions GROUP BY organization_id
       ) s ON s.organization_id = o.id
       ORDER BY o.created_at DESC NULLS LAST, o.name`
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/platform/organizations]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
