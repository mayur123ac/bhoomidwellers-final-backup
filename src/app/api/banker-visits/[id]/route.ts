// api/banker-visits/[id]/route.ts — Admin-only DELETE for banker visit records.
//
// banker_visits has no child tables referencing its PK, so deletion is a
// straight hard delete with no FK guard required.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { normalizeRole } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

const DELETE_ROLES = ["admin"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const role = normalizeRole(gate.session.role);
  if (!DELETE_ROLES.includes(role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot delete banker visits.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid banker visit id." },
      { status: 400 }
    );
  }

  try {
    const orgId = await getOrganizationId();

    const rows = await query(
      `DELETE FROM banker_visits WHERE id = $1 AND organization_id = $2 RETURNING id, banker_name`,
      [visitId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: `Banker visit ${id} not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, message: `Banker visit "${rows[0].banker_name}" deleted.` },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[DELETE /api/banker-visits/[id]]", err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
