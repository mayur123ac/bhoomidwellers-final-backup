// app/api/users/sales-manager/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // Case-insensitive match — same behaviour as the old MongoDB $regex
    const managers = await query(
      `SELECT id, name
       FROM users
       WHERE LOWER(role) = 'sales manager'
         AND is_active = true
         AND organization_id = $1
       ORDER BY name ASC`,
      [await getOrganizationId()]
    );

    // Return { success, data } — same shape the receptionist page already expects
    return NextResponse.json(
      { success: true, data: managers },
      { status: 200 }
    );

  } catch (error) {
    console.error("GET /api/users/sales-manager error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch managers" },
      { status: 500 }
    );
  }
}
