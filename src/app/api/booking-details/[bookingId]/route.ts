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

    // ── One round trip, not six ──────────────────────────────────────────────
    // These six reads are independent — no query needs another's result — but
    // they ran in a sequential await chain, so the response cost six round trips
    // to Neon ap-southeast-1 back to back. Measured at 82 ms per round trip, that
    // is ~490 ms of pure waiting; this endpoint benchmarked at 527 ms against
    // roughly 2 ms of actual SQL execution.
    //
    // Promise.all issues them together on separate pool connections, so the cost
    // becomes the SLOWEST query rather than the SUM of all six. Nothing about the
    // statements changes — each still carries its own organization predicate,
    // which is what stops this endpoint assembling another tenant's financials,
    // loan, registration, pipeline, charges or documents from a guessed id.
    const [
      financialsRes, loanRes, registrationRes, pipelineRes, customChargesRes, documentsRes,
    ] = await Promise.all([
      query(`SELECT * FROM booking_financials WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]),
      query(`SELECT * FROM booking_loan_details WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]),
      query(`SELECT * FROM booking_registration_details WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]),
      query(`SELECT * FROM booking_pipeline WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]),
      query(`SELECT * FROM booking_custom_charges WHERE booking_id = $1 AND organization_id = $2`, [bookingId, orgId]),
      query(`SELECT * FROM booking_documents WHERE booking_id = $1 AND organization_id = $2 ORDER BY created_at DESC`, [bookingId, orgId]),
    ]);

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
