import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    const sql = `
      SELECT 
        b.id AS booking_id,
        b.booking_number,
        b.primary_name AS customer_name,
        b.created_by AS sales_manager,
        w.project,
        w.wing,
        w.configuration,
        b.flat_number,
        b.agreement_value,
        b.booking_amount,
        l.loan_amount,
        f.ocr_amount,
        f.sdr_amount,
        r.expected_registration_date,
        l.expected_disbursement_date,
        p.current_stage,
        p.status
      FROM booking_applications b
      LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
      LEFT JOIN booking_financials f ON f.booking_id = b.id
      LEFT JOIN booking_loan_details l ON l.booking_id = b.id
      LEFT JOIN booking_registration_details r ON r.booking_id = b.id
      LEFT JOIN booking_pipeline p ON p.booking_id = b.id
      WHERE b.booking_status = 'Confirmed'
      ORDER BY b.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const rows = await query(sql, [limit, offset]);
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/revenue-pipeline]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
