// app/api/booking-applications/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── GET — fetch single booking ───────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT b.*, w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,
              w.address AS lead_address, w.budget AS lead_budget,
              w.configuration AS lead_configuration, w.purpose AS lead_purpose,
              w.source AS lead_source, w.assigned_to AS lead_assigned_to,
              w.assigned_receptionist AS lead_receptionist,
              w.overseeing_site_head AS lead_site_head,
              w.created_at AS lead_created_at, w.enquiry_date AS lead_enquiry_date,
              w.alt_phone AS lead_alt_phone, w.sr_no AS lead_sr_no
       FROM booking_applications b
       LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
       WHERE b.id = $1`,
      [Number(id)]
    );
    if (!rows.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── PUT — update booking ─────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { user_role, ...fields } = body;

    // Check current booking status
    const existing = await query(
      `SELECT booking_status FROM booking_applications WHERE id = $1`,
      [Number(id)]
    );
    if (!existing.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const currentStatus = existing[0].booking_status;
    // Sales Manager cannot edit after approval
    if (user_role === "sales" && currentStatus === "Approved") {
      return NextResponse.json(
        { success: false, message: "Booking has been approved and is read-only." },
        { status: 403 }
      );
    }

    const allowedFields = [
      "primary_name", "primary_email", "primary_mobile", "primary_pan",
      "primary_occupation", "primary_nationality",
      "joint_name", "joint_email", "joint_mobile", "joint_pan",
      "joint_occupation", "joint_nationality",
      "address", "pin", "state", "country",
      "property_type", "floor_number", "flat_number", "carpet_area",
      "consideration_value", "consideration_value_words", "parking_details",
      "payment_details",
      "witness_name", "witness_aadhaar",
      "booking_source", "direct_source", "channel_partner_name", "channel_partner_contact",
      "unit_cost", "sdr", "gst",
      "declaration_accepted", "terms_accepted", "consent_accepted",
      "signature_data", "application_date", "booking_status",
    ];

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (field in fields && fields[field] !== undefined) {
        values.push(field === "payment_details" ? JSON.stringify(fields[field]) : fields[field]);
        setClauses.push(`${field} = $${values.length}`);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ success: false, message: "No fields to update" }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(Number(id));

    const rows = await query(
      `UPDATE booking_applications SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/booking-applications/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
