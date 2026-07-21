// app/api/walkin_enquiries/[id]/loan-applications/route.ts
// Multi-lender shopping history for a lead. A DSA/sales manager typically files
// with several banks in parallel and picks whichever sanctions first/best — each
// row here is one lender the case was submitted to.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveLatestBookingId } from "@/lib/pdd";

export const dynamic = "force-dynamic";

function isLoanManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager", "site_head", "site head"].includes(clean);
}

// ─── GET — list all lender applications for a lead ────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT * FROM loan_applications WHERE lead_id = $1 ORDER BY created_at ASC`,
      [Number(id)],
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/walkin_enquiries/[id]/loan-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create a new lender application ───────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { user_name, user_role } = body;

    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isLoanManager(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can add loan applications." }, { status: 403 });
    }
    if (!body.bank_name || !String(body.bank_name).trim()) {
      return NextResponse.json({ success: false, message: "bank_name is required" }, { status: 400 });
    }

    const num = (v: any) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(/[₹,\s]/g, ""));
      return isNaN(n) ? null : n;
    };

    // Attach to the lead's booking if one already exists.
    const bookingId = await resolveLatestBookingId(Number(id));

    const rows = await query(
      `INSERT INTO loan_applications (
         lead_id, booking_id, bank_name, loan_type, dsa_agent_name, dsa_agent_contact,
         loan_executive, loan_reference_no, amount_requested, amount_sanctioned,
         interest_rate, tenure_months, application_date, status, remarks, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        Number(id), bookingId, String(body.bank_name).trim(), body.loan_type || null,
        body.dsa_agent_name || null, body.dsa_agent_contact || null,
        body.loan_executive || null, body.loan_reference_no || null,
        num(body.amount_requested), num(body.amount_sanctioned),
        num(body.interest_rate), num(body.tenure_months),
        body.application_date || null, body.status || "Submitted",
        body.remarks || null, user_name,
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/walkin_enquiries/[id]/loan-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
