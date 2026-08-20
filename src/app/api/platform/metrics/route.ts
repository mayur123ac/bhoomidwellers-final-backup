// api/platform/metrics/route.ts — the four dashboard counts.
//
// One round trip. The Phase 1 dashboard derived its tiles by summing the
// organization array client-side, which is wrong the moment the list is paged
// or filtered; these are counted in SQL against the whole estate.
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
         (SELECT count(*)::int FROM organizations) AS organizations,
         (SELECT count(*)::int FROM organizations
           WHERE COALESCE(NULLIF(btrim(status), ''), 'active') = 'active') AS active_organizations,
         -- Tenant users only: the platform account itself has no organization
         -- and is not part of any tenant's headcount.
         (SELECT count(*)::int FROM users
           WHERE deleted_at IS NULL AND organization_id IS NOT NULL) AS users,
         (SELECT count(*)::int FROM users
           WHERE deleted_at IS NULL AND organization_id IS NOT NULL AND is_active = true) AS active_users,
         (SELECT count(*)::int FROM walkin_enquiries) AS leads,
         (SELECT count(*)::int FROM booking_applications) AS bookings`
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/platform/metrics]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
