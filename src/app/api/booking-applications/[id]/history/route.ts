// app/api/booking-applications/[id]/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // The CREATE TABLE IF NOT EXISTS that used to run here has moved to
    // scripts/migrations/2026-08-23_booking_schema_baseline.sql. It was a no-op
    // that cost a full round trip to Neon (~82 ms) on every history read, which
    // was roughly a third of this endpoint's entire response time.
    const rows = await query(
      // MT-06: the booking id is a caller-supplied route parameter. Without the
      // organization predicate any signed-in user could read another tenant's
      // booking history by walking the id space.
      `SELECT * FROM booking_history WHERE booking_id = $1 AND organization_id = $2 ORDER BY created_at DESC`,
      [Number(id), await getOrganizationId()]
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/history]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
