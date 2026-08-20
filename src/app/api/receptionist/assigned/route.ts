import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

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

    const rows = await query(
      // assigned_to matches on NAME — see receptionist/leads for why the
      // organization filter is load-bearing here.
      `SELECT * FROM walkin_enquiries
       WHERE assigned_to = $1 AND organization_id = $2
       ORDER BY created_at DESC`,
      [name, await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: rows, total: rows.length }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}