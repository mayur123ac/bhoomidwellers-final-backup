import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

// GET /api/receptionist/leads?name=Receptionist
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
      // assigned_receptionist matches on NAME, which is only unique by
      // convention — the organization filter stops a same-named receptionist in
      // another builder pulling in their leads.
      `SELECT * FROM walkin_enquiries
       WHERE assigned_receptionist = $1 AND organization_id = $2
       ORDER BY created_at DESC`,
      [name, await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: rows, total: rows.length }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}