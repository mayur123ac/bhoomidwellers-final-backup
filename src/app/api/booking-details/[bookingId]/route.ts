import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ bookingId: string }> }) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { bookingId } = await context.params;
    // MT-06: bookingId is a caller-supplied route parameter and every statement
    // below is keyed on it alone. Resolved once and applied to all six, so this
    // endpoint cannot assemble another tenant's financials, loan, registration,
    // pipeline, charges or documents.
    const orgId = await getOrganizationId();

    // Fetch financial details
    const financialsRes = await query(`SELECT * FROM booking_financials WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]);
    // Fetch loan details
    const loanRes = await query(`SELECT * FROM booking_loan_details WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]);
    // Fetch registration details
    const registrationRes = await query(`SELECT * FROM booking_registration_details WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]);
    // Fetch pipeline stage
    const pipelineRes = await query(`SELECT * FROM booking_pipeline WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]);
    // Fetch custom charges
    const customChargesRes = await query(`SELECT * FROM booking_custom_charges WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]);
    // Fetch documents
    const documentsRes = await query(`SELECT * FROM booking_documents WHERE booking_id = $1 AND organization_id = $2 ORDER BY created_at DESC`, [bookingId, orgId]);

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
