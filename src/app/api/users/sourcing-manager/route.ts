// app/api/users/sourcing-manager/route.ts
//
// Mirrors /api/users/sales-manager, but returns the extra identifying fields the
// assignment dropdown shows: employee id, username, phone, email. The receptionist
// picks a person off this list and only the id is stored on the enquiry.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Underscores normalized so a role stored as "Sourcing_Manager" still matches,
    // consistent with normalizeRole in @/lib/cpRbac.
    const managers = await query(
      `SELECT id, name, username, email, whatsapp_number AS phone, whatsapp_number
         FROM users
        WHERE REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sourcing manager'
          AND is_active = true
        ORDER BY name ASC`
    );

    return NextResponse.json({ success: true, data: managers }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/users/sourcing-manager error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch sourcing managers", data: [] },
      { status: 500 }
    );
  }
}
