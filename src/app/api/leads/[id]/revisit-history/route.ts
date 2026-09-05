// api/leads/[id]/revisit-history/route.ts
//
// Returns the full historical context panel for a RETURNING_LEAD.
// Caller receives: previous enquiry header, historical follow-ups (< cutoff),
// loan history, and booking from the old lead.
//
// Authorization (strict):
//   ALLOW if session role is admin or site head.
//   ALLOW if session.name === new_revisit_lead.assigned_to (current SM).
//   DENY  everyone else, including:
//     - Receptionists
//     - Sourcing Managers
//     - Previous Sales Manager (old ownership alone is not a credential here)
//     - Unrelated Sales Managers
//
// Security:
//   - Tenant-scoped: both the current lead and the previous lead are verified
//     against the caller's organization_id.
//   - Previous lead's phone is masked via resolvePhone (LEAD_PHONE scope).
//   - Follow-up text is free text; phones embedded in messages are not masked
//     (not a structured field, consistent with the existing follow-up display).
//   - Loan and booking data contain no raw phone fields.
//   - This endpoint is READ-ONLY.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { resolvePhone } from "@/lib/phoneAccess";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const { id } = await params;
    const leadId = parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ success: false, message: "Invalid lead id." }, { status: 400 });
    }

    const orgId = await getOrganizationId();

    // Fetch the current (revisit) lead — tenant-scoped.
    const currentRows = await query(
      `SELECT id, returning_from_lead_id, created_at, lead_classification, assigned_to
       FROM walkin_enquiries
       WHERE id = $1 AND organization_id = $2
       LIMIT 1`,
      [leadId, orgId]
    );

    if (currentRows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found." }, { status: 404 });
    }

    const current = currentRows[0];

    // ── Authorization ──────────────────────────────────────────────────────────
    // Admin and Site Head can always view historical context.
    // Only the currently assigned Sales Manager on THIS new revisit lead may
    // view it. Previous SM, unrelated SM, Receptionist, and Sourcing Manager
    // are denied — old ownership does not grant access to the new lead's preview.
    const role = normalizeRole(session.role);
    const isAdmin = role === "admin";
    const isSiteHead = role === "site head";
    const isAssignedSM = session.name === current.assigned_to;

    if (!isAdmin && !isSiteHead && !isAssignedSM) {
      return NextResponse.json(
        { success: false, message: "You are not authorized to view this lead's historical data." },
        { status: 403 }
      );
    }

    // If there is no returning_from_lead_id, there is no history to show.
    if (!current.returning_from_lead_id) {
      return NextResponse.json({ success: true, hasHistory: false });
    }

    const prevLeadId = current.returning_from_lead_id;
    const cutoffAt = current.created_at;

    // Fetch the previous lead in full — tenant-scoped (cross-tenant guard).
    const prevRows = await query(
      `SELECT id, sr_no, name, phone, assigned_to, created_at, status,
              is_lost_lead, lost_lead_reason, lost_lead_marked_at, lost_lead_marked_by,
              budget, configuration, purpose, source, lead_classification,
              closing_date, lead_interest_status
       FROM walkin_enquiries
       WHERE id = $1 AND organization_id = $2
       LIMIT 1`,
      [prevLeadId, orgId]
    );

    if (prevRows.length === 0) {
      // Previous lead was deleted or belongs to a different org.
      return NextResponse.json({ success: true, hasHistory: false });
    }

    const prevLead = prevRows[0];

    // Historical follow-ups: only those created BEFORE the revisit lead's created_at.
    // Server-side cutoff enforcement — future follow-ups are never returned.
    const followUps = await query(
      `SELECT id, message, created_by_name, created_at, site_visit_date
       FROM follow_ups
       WHERE lead_id = $1
         AND created_at < $2
         AND organization_id = $3
       ORDER BY created_at ASC`,
      [prevLeadId, cutoffAt, orgId]
    );

    // Loan history for the old lead (all updates before the cutoff).
    const loanRows = await query(
      `SELECT id, status, bank_name, amount_requested, amount_approved,
              loan_required, cibil, agent, emp_type, income, emi,
              sales_manager_name, created_at, notes
       FROM loan_updates
       WHERE lead_id = $1
         AND created_at < $2
         AND organization_id = $3
       ORDER BY created_at ASC`,
      [prevLeadId, cutoffAt, orgId]
    );

    // Booking for the old lead (if any).
    // booking_applications has no status column; booking_status is the field.
    const bookingRows = await query(
      `SELECT id, booking_number, primary_name, consideration_value,
              apartment_name, project_name, tower, flat_number,
              booking_amount, agreement_value, booking_status,
              booking_date, created_at
       FROM booking_applications
       WHERE lead_id = $1
         AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [prevLeadId, orgId]
    );

    // Mask the previous lead's phone before returning.
    const actor = {
      _id: session._id ?? (session as any).id,
      name: session.name,
      role: session.role,
    };
    const maskedPhone = await resolvePhone(actor, prevLead, "LEAD_PHONE", orgId, prevLead.phone);

    // Extract the historical Sales Form from follow-ups (the last one before cutoff).
    const salesFormFups = followUps.filter((f: any) =>
      f.message?.includes("Detailed Salesform Submitted")
    );
    const historicalSalesForm = salesFormFups.length > 0
      ? salesFormFups[salesFormFups.length - 1].message
      : null;

    return NextResponse.json({
      success: true,
      hasHistory: true,
      previousLead: {
        id: prevLead.id,
        sr_no: prevLead.sr_no,
        name: prevLead.name,
        phone: maskedPhone,
        assigned_to: prevLead.assigned_to,
        created_at: prevLead.created_at,
        status: prevLead.status,
        lead_classification: prevLead.lead_classification,
        is_lost_lead: prevLead.is_lost_lead,
        lost_lead_reason: prevLead.lost_lead_reason,
        lost_lead_marked_at: prevLead.lost_lead_marked_at,
        lost_lead_marked_by: prevLead.lost_lead_marked_by,
        budget: prevLead.budget,
        configuration: prevLead.configuration,
        purpose: prevLead.purpose,
        source: prevLead.source,
        closing_date: prevLead.closing_date,
        lead_interest_status: prevLead.lead_interest_status,
      },
      historicalSalesForm,
      followUps: followUps.map((f: any) => ({
        id: f.id,
        message: f.message,
        createdByName: f.created_by_name,
        createdAt: f.created_at,
        siteVisitDate: f.site_visit_date,
      })),
      loan: loanRows.length > 0 ? loanRows.map((l: any) => ({
        id: l.id,
        status: l.status,
        bankName: l.bank_name,
        amountRequested: l.amount_requested,
        amountApproved: l.amount_approved,
        loanRequired: l.loan_required,
        cibil: l.cibil,
        agent: l.agent,
        empType: l.emp_type,
        income: l.income,
        emi: l.emi,
        salesManagerName: l.sales_manager_name,
        notes: l.notes,
        createdAt: l.created_at,
      })) : [],
      booking: bookingRows.length > 0 ? {
        id: bookingRows[0].id,
        bookingNumber: bookingRows[0].booking_number,
        primaryName: bookingRows[0].primary_name,
        considerationValue: bookingRows[0].consideration_value,
        apartmentName: bookingRows[0].apartment_name,
        projectName: bookingRows[0].project_name,
        tower: bookingRows[0].tower,
        flatNumber: bookingRows[0].flat_number,
        bookingAmount: bookingRows[0].booking_amount,
        agreementValue: bookingRows[0].agreement_value,
        bookingStatus: bookingRows[0].booking_status,
        bookingDate: bookingRows[0].booking_date,
        createdAt: bookingRows[0].created_at,
      } : null,
      cutoffAt,
    });
  } catch (error: any) {
    console.error("GET revisit-history Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
