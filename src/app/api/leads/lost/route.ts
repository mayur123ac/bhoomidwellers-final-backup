//api/leads/lost/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { broadcastLeadUpdate } from "@/lib/lostLeadEvents";

type LostLeadPayload = {
  leadId?: number | string;
  lead_id?: number | string;
  is_lost_lead?: boolean;
  lost_reason?: string;
  reason?: string;
  lost_marked_by?: string;
  marked_by?: string;
  restored_by?: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as LostLeadPayload;
    const leadId = body.leadId ?? body.lead_id;
    const isLost = body.is_lost_lead;
    const reason = (body.lost_reason ?? body.reason ?? "").trim();
    const actor = (body.lost_marked_by ?? body.marked_by ?? body.restored_by ?? "").trim();

    if (!leadId || typeof isLost !== "boolean" || !actor) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: leadId, is_lost_lead, lost_marked_by" },
        { status: 400 }
      );
    }

    if (isLost && reason.length < 10) {
      return NextResponse.json(
        { success: false, message: "Reason must be at least 10 characters long." },
        { status: 400 }
      );
    }

    const existing = await query(
      "SELECT id, name, is_lost_lead FROM walkin_enquiries WHERE id = $1",
      [leadId]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 }
      );
    }

    const updatedRows = isLost
      ? await query(
          `UPDATE walkin_enquiries
           SET is_lost_lead = TRUE,
               lost_lead_reason = $1,
               lost_lead_marked_at = NOW(),
               lost_lead_marked_by = $2
           WHERE id = $3
           RETURNING *`,
          [reason, actor, leadId]
        )
      : await query(
          `UPDATE walkin_enquiries
           SET is_lost_lead = FALSE,
               lost_lead_reason = NULL,
               lost_lead_marked_at = NULL,
               lost_lead_marked_by = NULL
           WHERE id = $1
           RETURNING *`,
          [leadId]
        );

    const updatedLead = updatedRows[0];
    const responseLead = {
      ...updatedLead,
      lost_reason: updatedLead.lost_lead_reason,
      lost_marked_by: updatedLead.lost_lead_marked_by,
      lost_marked_at: updatedLead.lost_lead_marked_at,
    };
    const logMessage = isLost
      ? `Lead marked as Lost\nReason: ${reason}\nBy: ${actor}`
      : `Lead Restored to Active\nBy: ${actor}`;

    try {
      await query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
         VALUES ($1, $2, $3, $4)`,
        [String(leadId), logMessage, actor, null]
      );
    } catch (fuErr: unknown) {
      console.warn("[PATCH /api/leads/lost] follow_ups insert failed:", getErrorMessage(fuErr, "Unknown error"));
    }

    const event = {
      type: "lead:lost-updated",
      leadId: String(leadId),
      lead: responseLead,
      ts: Date.now(),
    };
    broadcastLeadUpdate(event);

    return NextResponse.json(
      {
        success: true,
        message: isLost ? `Lead #${leadId} marked as lost.` : `Lead #${leadId} restored to active.`,
        data: responseLead,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[PATCH /api/leads/lost]", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Failed to update lost lead state.") },
      { status: 500 }
    );
  }
}
