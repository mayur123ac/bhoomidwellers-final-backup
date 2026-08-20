// api/channel-partners/[id]/eligible-bookings/route.ts
// Bookings attributed to this partner that can still take a commission.
//
// "Eligible" mirrors the partial unique index idx_cp_commissions_booking_active:
// a booking is available when it has no NON-REVERSED commission. A booking whose
// only commission was reversed is eligible again, which is what makes the
// reverse-then-recompute workflow reachable from the UI.
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

    const cpId = Number(id);
    if (!cpId || Number.isNaN(cpId)) {
      return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
    }

    const rows = await query(
      `SELECT b.id, b.booking_number, b.agreement_value, b.primary_name AS buyer_name
         FROM booking_applications b
        WHERE b.sourced_by_channel_partner_id = $1
          AND b.organization_id = $2
          AND NOT EXISTS (
                SELECT 1 FROM cp_commissions c
                 WHERE c.booking_id = b.id
                   AND c.status <> 'reversed'
                   AND c.organization_id = b.organization_id
              )
        ORDER BY b.id DESC`,
      [cpId, await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]/eligible-bookings]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
