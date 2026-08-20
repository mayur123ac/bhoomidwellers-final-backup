import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { CP_SOURCE_VALUES } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["admin", "receptionist", "sourcing manager"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const role = normalizeRole(session.role);
  if (!VIEW_ROLES.includes(role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot view channel partner assignment history." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const enquiryId = Number(id);
  if (!Number.isInteger(enquiryId)) {
    return NextResponse.json({ success: false, message: "Invalid enquiry id." }, { status: 400 });
  }

  try {
    const leadRows = await query(
      `SELECT id, source, sourcing_manager_id
         FROM walkin_enquiries
        WHERE id = $1 AND organization_id = $2`,
      [enquiryId, await getOrganizationId()]
    );

    if (leadRows.length === 0) {
      return NextResponse.json({ success: false, message: "Enquiry not found." }, { status: 404 });
    }

    const lead = leadRows[0];
    if (!(CP_SOURCE_VALUES as readonly string[]).includes((lead.source || "").trim())) {
      return NextResponse.json(
        { success: false, message: "This is not a Channel Partner enquiry." },
        { status: 404 }
      );
    }

    if (role === "sourcing manager" && String(lead.sourcing_manager_id) !== String(session._id)) {
      return NextResponse.json(
        { success: false, message: "This channel partner enquiry is not assigned to you." },
        { status: 403 }
      );
    }

    const rows = await query(
      `SELECT
         h.id,
         h.lead_id,
         h.previous_sourcing_manager_id,
         prev_sm.name     AS previous_sourcing_manager_name,
         prev_sm.username AS previous_sourcing_manager_username,
         prev_sm.whatsapp_number AS previous_sourcing_manager_phone,
         h.new_sourcing_manager_id,
         new_sm.name      AS new_sourcing_manager_name,
         new_sm.username  AS new_sourcing_manager_username,
         new_sm.whatsapp_number AS new_sourcing_manager_phone,
         h.assigned_by_user_id,
         h.assigned_by_name,
         h.assigned_by_role,
         h.action,
         h.assigned_at
       FROM cp_assignment_history h
       LEFT JOIN users prev_sm
              ON prev_sm.id = h.previous_sourcing_manager_id
             AND prev_sm.organization_id = h.organization_id
       LEFT JOIN users new_sm
              ON new_sm.id = h.new_sourcing_manager_id
             AND new_sm.organization_id = h.organization_id
       WHERE h.lead_id = $1 AND h.organization_id = $2
       ORDER BY h.assigned_at DESC, h.id DESC`,
      [enquiryId, await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/cp-enquiries/[id]/assignment-history]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
