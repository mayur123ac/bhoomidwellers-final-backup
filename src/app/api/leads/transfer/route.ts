// app/api/leads/transfer/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export async function POST(req: Request) {
  try {
    // Reassigns a lead to another manager.
    //
    // Receptionist is included because handing a walk-in to a Sales Manager is
    // the front desk's core job — the receptionist dashboard has a dedicated
    // transfer modal for it ("Transfer state (Receptionist Lead → Manager)").
    // An earlier gate of admin+sales-manager broke that flow; the endpoint had
    // no check at all before, so this narrows access rather than widening it.
    // Sourcing Manager and Site Head are excluded: neither works the walk-in
    // queue, and lead routing is not theirs to change.
    const gate = await requireRoles(["admin", "sales manager", "receptionist"]);
    if (!gate.ok) return gate.response;

    // MT-05: resolved once for the whole handler, from the authenticated
    // session — never from `body`, which the browser controls.
    const orgId = await getOrganizationId();

    const body = await req.json();
    const { lead_id, transfer_to, transfer_note, transferred_by } = body as {
      lead_id:        number | string;
      transfer_to:    string;
      transfer_note:  string;
      transferred_by: string;
    };

    // ── Validation ────────────────────────────────────────────────────
    if (!lead_id || !transfer_to || !transferred_by) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: lead_id, transfer_to, transferred_by" },
        { status: 400 }
      );
    }

   

    const existing = await query(
      `SELECT id, sr_no, assigned_to, assigned_receptionist FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [lead_id, orgId]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 }
      );
    }

    const currentManager = existing[0].assigned_to;

    // ── 2. Prevent same-manager transfer ─────────────────────────────
    if (currentManager === transfer_to) {
      return NextResponse.json(
        { success: false, message: `Lead is already assigned to ${transfer_to}. Please select a different manager.` },
        { status: 400 }
      );
    }

    // ── 3. Build follow-up message ────────────────────────────────────
    const leadNo = existing[0].sr_no || lead_id;
    const transferMessage =
      `🔄 Lead Transferred by ${transferred_by} (Receptionist)\n` +
      `• From: ${currentManager || "Unassigned"}\n` +
      `• To: ${transfer_to}\n\n` +
      `Handover Summary:\n${transfer_note.trim()}`;

    // ── 4. Log follow-up ──────────────────────────────────────────────
    // Adjust column names to match your actual follow_ups table schema
    let followUpRow: any = null;
    try {
      const followUpRows = await query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, site_visit_date, organization_id)
         VALUES ($1, $2, $3, $6, $4, $5)
         RETURNING *`,
        [String(lead_id), transferMessage, transferred_by, null, orgId, gate.userId]
      );
      followUpRow = followUpRows[0];
    } catch (fuErr: any) {
      // The "alternate schema" retry that used to live here has been removed.
      // It inserted into follow_ups(sales_manager_name, created_by) — NEITHER
      // column exists on follow_ups, so that retry could only ever throw and be
      // swallowed by its own catch. The MT-05 PREPARE harness surfaced it; it is
      // a pre-existing dead branch, not something this phase introduced.
      // Behaviour is unchanged: the transfer still succeeds, followUpRow stays
      // null, and the failure is logged once instead of twice.
      console.error("[transfer] follow_ups insert failed:", fuErr.message);
      // Don't fail the whole transfer just because follow-up logging failed.
    }

    // ── 5. Update assigned_to ─────────────────────────────────────────
    const updatedRows = await query(
      `UPDATE walkin_enquiries
       SET assigned_to = $1,
           assigned_at = NOW(),
           last_activity_at = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [transfer_to, lead_id, orgId]
    );

    if (updatedRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Failed to update lead assignment." },
        { status: 500 }
      );
    }

    // ── 6. Map follow-up to frontend shape ────────────────────────────
    await query(
      `INSERT INTO lead_assignment_logs (lead_id, assigned_to, assigned_by, reason, organization_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        Number(lead_id),
        transfer_to,
        transferred_by,
        transfer_note?.trim() || `Transferred from ${currentManager || "Unassigned"}`,
        orgId,
      ]
    );

    const mappedFollowUp = followUpRow
      ? {
          _id:              String(followUpRow.id),
          leadId:           String(followUpRow.lead_id),
          salesManagerName: followUpRow.created_by_name || followUpRow.sales_manager_name || transferred_by,
          createdBy:        followUpRow.created_by || "receptionist",
          message:          followUpRow.message,
          siteVisitDate:    followUpRow.site_visit_date || null,
          createdAt:        followUpRow.created_at,
        }
      : null;

    return NextResponse.json(
      {
        success: true,
        message: `Lead #${leadNo} successfully transferred from ${currentManager} to ${transfer_to}.`,
        data: {
          lead:     updatedRows[0],
          followUp: mappedFollowUp,
          previousManager: currentManager,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[POST /api/leads/transfer]", error);
    return NextResponse.json(
      { success: false, message: error.message ?? "Transfer failed. Please try again." },
      { status: 500 }
    );
  }
}
