// app/api/booking-applications/[id]/loan-applications/route.ts
// Lender applications scoped to a booking (once one exists). Same rows as the
// lead-scoped list, filtered to those migrated onto this booking.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// ─── GET — list lender applications for a booking ─────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const rows = await query(
      // MT-06: caller-supplied booking id — scoped so a foreign booking returns
      // an empty list rather than another tenant's loan applications.
      `SELECT * FROM loan_applications WHERE booking_id = $1 AND organization_id = $2 ORDER BY created_at ASC`,
      [Number(id), await getOrganizationId()],
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/loan-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
