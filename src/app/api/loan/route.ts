// app/api/loan/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

// C5: loan_updates is an append-only activity log — every POST inserts a NEW row
// (it never updates in place), so the timeline is the history. The authoritative
// current status lives elsewhere (booking_loan_details.loan_status post-booking, or
// the lead's draft pre-booking). previous_status/new_status add per-entry audit
// clarity.
//
// PERF: this file used to create those two columns at runtime via a module-flag
// guarded `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. The guard made it run once
// per process, but that once was the first loan save after every cold start, and
// ALTER TABLE takes an ACCESS EXCLUSIVE lock that blocks every concurrent reader
// of loan_updates. The statement now lives in
// scripts/migrations/2026-08-24_move_runtime_ddl_out_of_request_path.sql and is
// already applied on production.

// ── GET: Fetch loan updates, optionally scoped to one lead ────────────────────
export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");

    // Opt-in: return only the newest entry. Every caller in this app reads
    // `rows[rows.length - 1]` and discards the rest, and loan_updates is
    // append-only, so the log grows without bound per lead. The response stays an
    // ARRAY ordered oldest-first, so indexing keeps working unchanged; with
    // latest=1 it simply has one element. Omitting the param returns the full log
    // exactly as before, so existing callers are unaffected.
    const latestOnly = searchParams.get("latest") === "1";

    // MT-05: loan_updates carries organization_id (added by the MT-04 migration,
    // indexed as idx_loan_updates_org). This GET was the one path in the file that
    // never applied it. lead_id is a GLOBALLY unique integer, so the lead_id branch
    // let any signed-in user of any tenant read another tenant's loan history by
    // guessing an id — and the branch below it returned every loan_update row in
    // every organization. POST has always scoped correctly; this brings GET in line.
    const orgId = await getOrganizationId();

    const loans = leadId
      ? await query(
          `SELECT * FROM loan_updates
             WHERE lead_id = $1 AND organization_id = $2
             ORDER BY created_at ${latestOnly ? "DESC" : "ASC"}
             ${latestOnly ? "LIMIT 1" : ""}`,
          [leadId, orgId]
        )
      : await query(
          `SELECT * FROM loan_updates WHERE organization_id = $1 ORDER BY created_at ASC`,
          [orgId]
        );

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
    // MT-05: from the authenticated session, never from the request body.
    const orgId = await getOrganizationId();
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();

    if (!body.leadId) {
      return NextResponse.json(
        { success: false, message: "Missing leadId" },
        { status: 400 }
      );
    }

    // 🔒 Final-state lock guard
    const leadRows = await query(
      `SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [body.leadId, orgId]
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
        notes, previous_status, new_status,
        organization_id
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        $15,$16,$17,$18,$19,
        $20,$21,$22,
        $23
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
        orgId,
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
      `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, created_at, organization_id)
       VALUES ($1, $2, $3, $5, NOW(), $4)`,
      [
        String(body.leadId),
        summaryMessage,
        body.salesManagerName || body.createdBy || "sales",
        orgId,
        gate.userId,
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