// api/channel-partners/[id]/commissions/route.ts
// Commission history for one partner, plus their running FY total.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getFinancialYearWindow, TDS_THRESHOLD_INR } from "@/lib/cpCommissionEngine";
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

    const cpCommOrgId = await getOrganizationId();
    const rows = await query(
      `SELECT c.*, b.booking_number, b.primary_name AS buyer_name
         FROM cp_commissions c
         LEFT JOIN booking_applications b
           ON b.id = c.booking_id AND b.organization_id = c.organization_id
        WHERE c.channel_partner_id = $1 AND c.organization_id = $2
        ORDER BY c.created_at DESC, c.id DESC`,
      [cpId, cpCommOrgId]
    );

    // Mirrors the engine's threshold query exactly: sums gross across ALL sources
    // (auto and manual alike), excludes reversed rows, scoped to the current FY.
    // Deliberately NOT filtered by commission_source — see cpCommissionEngine.
    const fy = getFinancialYearWindow();
    const totalRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(gross_commission_amount), 0) AS total
         FROM cp_commissions
        WHERE channel_partner_id = $1
          AND status <> 'reversed'
          AND created_at >= $2::timestamp
          AND created_at <  $3::timestamp
          AND organization_id = $4`,
      [cpId, fy.start, fy.end, cpCommOrgId]
    );

    return NextResponse.json(
      {
        success: true,
        data: rows,
        fySummary: {
          label: fy.label,
          total: totalRows[0]?.total ?? "0",
          thresholdInr: TDS_THRESHOLD_INR,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]/commissions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
