// app/api/hr/holidays/[id]/route.ts
//
// PATCH — soft-deactivate a holiday (set is_active = false)
//
// Gate: hr, admin.
// Holidays are never physically deleted to preserve historical reporting.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const holidayId = Number(id);
    if (!Number.isInteger(holidayId) || holidayId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid holiday ID." }, { status: 400 });
    }

    const deactivatedBy = getSessionUserId(gate.session);

    const result = await query<any>(
      `UPDATE organization_holidays
          SET is_active = false,
              deactivated_by = $3,
              deactivated_at = now(),
              updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND is_active = true
        RETURNING id`,
      [holidayId, orgId, deactivatedBy]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, message: "Holiday not found or already inactive." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Holiday deactivated." });
  } catch (err: any) {
    console.error("[PATCH /api/hr/holidays/:id]", err);
    return NextResponse.json({ success: false, message: "Failed to deactivate holiday." }, { status: 500 });
  }
}
