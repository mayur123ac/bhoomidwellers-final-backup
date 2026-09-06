import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { batchGetVisitDepths } from "@/lib/visitChain";

// GET /api/receptionist/assigned?name=Receptionist
export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { success: false, message: "Query param 'name' is required" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();
    const rows = await query(
      // assigned_to matches on NAME — see receptionist/leads for why the
      // organization filter is load-bearing here.
      `SELECT * FROM walkin_enquiries
       WHERE assigned_to = $1 AND organization_id = $2
       ORDER BY created_at DESC`,
      [name, orgId]
    );

    // Attach visitNumber — single batch CTE, no N+1.
    const leadIds = rows.map((r: any) => r.id as number);
    const visitDepths = await batchGetVisitDepths(leadIds, orgId);
    const rowsWithVisits = rows.map((r: any) => ({
      ...r,
      visitNumber: visitDepths.get(r.id) ?? 1,
    }));

    return NextResponse.json({ success: true, data: rowsWithVisits, total: rowsWithVisits.length }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}