// app/api/users/receptionist/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const receptionists = await query(
      `SELECT id, name, username, email, role, is_active as "isActive"
       FROM users
       WHERE LOWER(role) = 'receptionist'
         AND is_active = true
         AND organization_id = $1
       ORDER BY name ASC`,
      [await getOrganizationId()]
    );

    // Map id → _id so any frontend code using _id keeps working
    const mapped = receptionists.map(u => ({ ...u, _id: String(u.id) }));

    return NextResponse.json(
      { success: true, data: mapped },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error fetching receptionists:", error);
    return NextResponse.json(
      { success: false, message: "Server Error fetching receptionists" },
      { status: 500 }
    );
  }
}