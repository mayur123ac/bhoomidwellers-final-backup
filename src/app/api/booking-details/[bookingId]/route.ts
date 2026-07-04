import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await context.params;
    
    // Fetch financial details
    const financialsRes = await query(`SELECT * FROM booking_financials WHERE booking_id = $1`, [bookingId]);
    // Fetch loan details
    const loanRes = await query(`SELECT * FROM booking_loan_details WHERE booking_id = $1`, [bookingId]);
    // Fetch registration details
    const registrationRes = await query(`SELECT * FROM booking_registration_details WHERE booking_id = $1`, [bookingId]);
    // Fetch pipeline stage
    const pipelineRes = await query(`SELECT * FROM booking_pipeline WHERE booking_id = $1`, [bookingId]);
    // Fetch custom charges
    const customChargesRes = await query(`SELECT * FROM booking_custom_charges WHERE booking_id = $1`, [bookingId]);
    // Fetch documents
    const documentsRes = await query(`SELECT * FROM booking_documents WHERE booking_id = $1 ORDER BY uploaded_at DESC`, [bookingId]);

    const data = {
      financials: financialsRes[0] || null,
      loan: loanRes[0] || null,
      registration: registrationRes[0] || null,
      pipeline: pipelineRes[0] || null,
      custom_charges: customChargesRes,
      documents: documentsRes
    };

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-details]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
