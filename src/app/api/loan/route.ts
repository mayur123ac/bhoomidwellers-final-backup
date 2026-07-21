// app/api/loan/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// C5: loan_updates is an append-only activity log — every POST inserts a NEW row
// (it never updates in place), so the timeline is the history. The authoritative
// current status lives elsewhere (booking_loan_details.loan_status post-booking, or
// the lead's draft pre-booking). These columns add per-entry audit clarity.
// Idempotent ADD COLUMN IF NOT EXISTS matches the codebase's ensure-table pattern,
// so the live loan-save path works whether or not the columns were added manually.
let loanColsEnsured = false;
async function ensureLoanUpdatesColumns() {
  if (loanColsEnsured) return;
  await query(`
    ALTER TABLE loan_updates
      ADD COLUMN IF NOT EXISTS previous_status TEXT,
      ADD COLUMN IF NOT EXISTS new_status TEXT
  `);
  loanColsEnsured = true;
}

// ── GET: Fetch loan updates, optionally scoped to one lead ────────────────────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");

    const loans = leadId
      ? await query(
          `SELECT * FROM loan_updates WHERE lead_id = $1 ORDER BY created_at ASC`,
          [leadId]
        )
      : await query(`SELECT * FROM loan_updates ORDER BY created_at ASC`);

    return NextResponse.json({ success: true, data: loans }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch loans:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch loans" },
      { status: 500 }
    );
  }
}

// ── POST: Save loan update + inject follow-up timeline message ────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.leadId) {
      return NextResponse.json(
        { success: false, message: "Missing leadId" },
        { status: 400 }
      );
    }

    // 🔒 Final-state lock guard
    const leadRows = await query(
      `SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1`,
      [body.leadId]
    );
    const lead = leadRows[0];
    if (!lead) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }
    if (lead.status === "Closing" || lead.is_lost_lead) {
      return NextResponse.json(
        { success: false, message: "Closed or Lost leads cannot be modified." },
        { status: 403 }
      );
    }

    await ensureLoanUpdatesColumns();

    // Audit pair: carry the last entry's status forward as previous_status.
    const prevRows = await query<{ new_status: string | null; status: string | null }>(
      `SELECT new_status, status FROM loan_updates WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(body.leadId)]
    );
    const previousStatus = prevRows[0]?.new_status ?? prevRows[0]?.status ?? null;
    const newStatus = body.status || "Pending";

    // 1. Append a new activity-log row to PostgreSQL (never an in-place update)
    const rows = await query(
      `INSERT INTO loan_updates (
        lead_id, sales_manager_name, created_by,
        status, loan_required,
        bank_name, amount_requested, amount_approved,
        cibil, agent, agent_contact,
        emp_type, income, emi,
        doc_pan, doc_aadhaar, doc_salary, doc_bank, doc_property,
        notes, previous_status, new_status
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        $15,$16,$17,$18,$19,
        $20,$21,$22
      ) RETURNING *`,
      [
        String(body.leadId),
        body.salesManagerName || null,
        body.createdBy || "sales",
        newStatus,
        body.loanRequired || null,
        body.bank || null,
        body.amountReq || null,
        body.amountApp || null,
        body.cibil || null,
        body.agent || null,
        body.agentContact || null,
        body.empType || null,
        body.income || null,
        body.emi || null,
        body.docPan || "Pending",
        body.docAadhaar || "Pending",
        body.docSalary || "Pending",
        body.docBank || "Pending",
        body.docProperty || "Pending",
        body.notes || null,
        previousStatus,
        newStatus,
      ]
    );

    const newLoan = rows[0];

    // 2. Build the same visual summary message your frontend timeline shows
    const summaryMessage = `🏦 Loan Update:
• Loan Required: ${body.loanRequired || "N/A"}
• Status: ${body.status || "N/A"}
• Bank Name: ${body.bank || "N/A"}
• Amount Requested: ${body.amountReq || "N/A"}
• Amount Approved: ${body.amountApp || "N/A"}
• CIBIL Score: ${body.cibil || "N/A"}
• Agent Name: ${body.agent || "N/A"}
• Agent Contact: ${body.agentContact || "N/A"}
• Employment Type: ${body.empType || "N/A"}
• Monthly Income: ${body.income || "N/A"}
• Existing EMIs: ${body.emi || "N/A"}
• PAN Card: ${body.docPan || "Pending"}
• Aadhaar Card: ${body.docAadhaar || "Pending"}
• Salary Slips: ${body.docSalary || "Pending"}
• Bank Statements: ${body.docBank || "Pending"}
• Property Docs: ${body.docProperty || "Pending"}
• Notes: ${body.notes || "N/A"}`;

    // 3. Inject into follow_ups table (PostgreSQL) instead of MongoDB FollowupMessage
    await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        String(body.leadId),
        summaryMessage,
        body.salesManagerName || body.createdBy || "sales",
      ]
    );

    return NextResponse.json({ success: true, data: newLoan }, { status: 201 });

  } catch (error) {
    console.error("Failed to save loan update:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save loan update" },
      { status: 500 }
    );
  }
}