// api/cp-enquiries/[id]/route.ts — a single Channel Partner enquiry, by id.
//
// The list endpoint (../route.ts) already forces a Sourcing Manager's own id into
// its WHERE clause, so they can never receive another manager's rows in a list
// response. This route exists so the same guarantee holds for the one other shape
// of "access by URL/API call" the isolation requirement names explicitly: a direct
// GET by enquiry id. No current page calls this — the table's detail drawer reads
// from rows already fetched from the scoped list — but the endpoint must still
// refuse a Sourcing Manager who tries CP #7 belonging to someone else, rather than
// leaving that guarantee undefined for whatever calls this route next.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { CP_SOURCE_VALUES } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["admin", "receptionist", "sourcing manager"];

const SELECT_SQL = `
  SELECT
    w.id, w.sr_no, w.created_at, w.enquiry_date, w.status,
    w.name  AS client_name,
    w.phone AS client_phone,
    w.alt_phone, w.email, w.address,
    w.city AS client_city, w.pin_code AS client_pin_code,
    w.preferred_location, w.budget, w.configuration, w.purpose,
    w.occupation, w.organization, w.loan_planned,
    w.source, w.assigned_to, w.assigned_receptionist,
    w.channel_partner_id,
    w.cp_name, w.cp_company, w.cp_phone,
    cp.name AS partner_name, cp.company_name AS partner_company, cp.phone AS partner_phone,
    cp.office_address, cp.owner_contact_person, cp.gst_number, cp.rera_registration_no,
    cp.city AS partner_city, cp.pin_code AS partner_pin_code,
    w.sourcing_manager_id, w.sourcing_manager_assigned_at, w.sourcing_manager_assigned_by,
    sm.name AS sourcing_manager_name, sm.username AS sourcing_manager_username,
    sm.email AS sourcing_manager_email, sm.whatsapp_number AS sourcing_manager_phone
  FROM walkin_enquiries w
  LEFT JOIN channel_partners cp ON cp.id = w.channel_partner_id
  LEFT JOIN users sm            ON sm.id = w.sourcing_manager_id
  WHERE w.id = $1
`;

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
      { success: false, message: "Your role cannot view channel partner enquiries." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const enquiryId = Number(id);
  if (!Number.isInteger(enquiryId)) {
    return NextResponse.json({ success: false, message: "Invalid enquiry id." }, { status: 400 });
  }

  try {
    const rows = await query(SELECT_SQL, [enquiryId]);
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Enquiry not found." }, { status: 404 });
    }

    const row = rows[0];

    if (!(CP_SOURCE_VALUES as readonly string[]).includes((row.source || "").trim())) {
      return NextResponse.json(
        { success: false, message: "This is not a Channel Partner enquiry." },
        { status: 404 }
      );
    }

    // The one check this route exists for: a Sourcing Manager may load a CP
    // enquiry id directly, but only if it is theirs. Everyone else's — including
    // an unassigned one — is refused with 403, not silently downgraded to a
    // filtered empty result, since the caller asked for one specific record.
    if (role === "sourcing manager" && String(row.sourcing_manager_id) !== String(session._id)) {
      return NextResponse.json(
        { success: false, message: "This channel partner enquiry is not assigned to you." },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, data: row }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/cp-enquiries/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
