// app/api/leads/transfer/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: Request) {
  try {
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
      `SELECT id, sr_no, assigned_to, assigned_receptionist FROM walkin_enquiries WHERE id = $1`,
      [lead_id]
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
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [String(lead_id), transferMessage, transferred_by, null]
      );
      followUpRow = followUpRows[0];
    } catch (fuErr: any) {
      // If follow_ups schema is different, try the salesManagerName column
      console.warn("[transfer] follow_ups insert failed, trying alternate schema:", fuErr.message);
      try {
        const followUpRows = await query(
          `INSERT INTO follow_ups (lead_id, message, sales_manager_name, created_by, site_visit_date)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [String(lead_id), transferMessage, transferred_by, "receptionist", null]
        );
        followUpRow = followUpRows[0];
      } catch (fuErr2: any) {
        console.error("[transfer] follow_ups insert failed completely:", fuErr2.message);
        // Don't fail the whole transfer just because follow-up logging failed
      }
    }

    // ── 5. Update assigned_to ─────────────────────────────────────────
    const updatedRows = await query(
      `UPDATE walkin_enquiries
       SET assigned_to = $1,
           assigned_at = NOW(),
           last_activity_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [transfer_to, lead_id]
    );

    if (updatedRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Failed to update lead assignment." },
        { status: 500 }
      );
    }

    // ── 6. Map follow-up to frontend shape ────────────────────────────
    await query(
      `INSERT INTO lead_assignment_logs (lead_id, assigned_to, assigned_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [
        Number(lead_id),
        transfer_to,
        transferred_by,
        transfer_note?.trim() || `Transferred from ${currentManager || "Unassigned"}`,
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
