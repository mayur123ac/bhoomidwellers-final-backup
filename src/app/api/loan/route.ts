// app/api/loan/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

<<<<<<< HEAD
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

=======
// ── GET: Fetch all loan updates ───────────────────────────────────────────────
export async function GET() {
  try {
    const loans = await query(
      `SELECT * FROM loan_updates ORDER BY created_at ASC`
    );
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
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


    // 1. Save structured loan data to PostgreSQL
    const rows = await query(
      `INSERT INTO loan_updates (
        lead_id, sales_manager_name, created_by,
<<<<<<< HEAD
        status, loan_required,
        bank_name, amount_requested, amount_approved,
        cibil, agent, agent_contact,
        emp_type, income, emi,
        doc_pan, doc_aadhaar, doc_salary, doc_bank, doc_property,
        notes
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        $15,$16,$17,$18,$19,
        $20
=======
        status, loan_type,
        amount_req, amount_app, processing_amt, roi, tenure,
        bank, officer, agent, agent_contact,
        emp_type, income, emi, cibil,
        prop_type, prop_value, project, builder,
        phone, alt_phone, email, address,
        doc_pan, doc_aadhaar, doc_salary, doc_bank, doc_property,
        app_date, aprv_date, exp_disb_date, disb_date, notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,
        $27,$28,$29,$30,$31,$32,$33,$34,$35,$36
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
      ) RETURNING *`,
      [
        String(body.leadId),
        body.salesManagerName || null,
        body.createdBy || "sales",
        body.status || "Pending",
<<<<<<< HEAD
        body.loanRequired || null,
        body.bank || null,
        body.amountReq || null,
        body.amountApp || null,
        body.cibil || null,
=======
        body.loanType || null,
        body.amountReq || null,
        body.amountApp || null,
        body.processingAmt || null,
        body.roi || null,
        body.tenure || null,
        body.bank || null,
        body.officer || null,
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
        body.agent || null,
        body.agentContact || null,
        body.empType || null,
        body.income || null,
        body.emi || null,
<<<<<<< HEAD
=======
        body.cibil || null,
        body.propType || null,
        body.propValue || null,
        body.project || null,
        body.builder || null,
        body.phone || null,
        body.altPhone || null,
        body.email || null,
        body.address || null,
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
        body.docPan || "Pending",
        body.docAadhaar || "Pending",
        body.docSalary || "Pending",
        body.docBank || "Pending",
        body.docProperty || "Pending",
<<<<<<< HEAD
=======
        body.appDate || null,
        body.apprvDate || null,
        body.expDisbDate || null,
        body.disbDate || null,
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
        body.notes || null,
      ]
    );

    const newLoan = rows[0];

    // 2. Build the same visual summary message your frontend timeline shows
    const summaryMessage = `🏦 Loan Update:
<<<<<<< HEAD
• Loan Required: ${body.loanRequired || "N/A"}
=======
• Loan Required: Yes
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
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