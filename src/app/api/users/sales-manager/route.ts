// app/api/users/sales-manager/route.ts
//
// Returns active Sales Managers for the current organization. Same response
// shape as /api/users/sourcing-manager so SearchableSelect works identically.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const managers = await query(
      `SELECT id, name, username, email, whatsapp_number AS phone, whatsapp_number
         FROM users
        WHERE REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sales manager'
          AND is_active = true
          AND organization_id = $1
        ORDER BY name ASC`,
      [await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: managers }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/users/sales-manager error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch sales managers", data: [] },
      { status: 500 }
    );
  }
}
