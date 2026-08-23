//api/leads/restore/route.ts
import { NextResponse } from "next/server";
import { query, recalculateSrNos } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastLeadUpdate } from "@/lib/lostLeadEvents";
import { requireSession, requireRoles } from "@/lib/serverAuth";

type RestorePayload = {
  leadId?: number | string;
  lead_id?: number | string;
  is_lost_lead?: boolean;
  restored_by?: string;
  restored_at?: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function PATCH(req: Request) {
  try {
    // Site Head included for the same reason as the Lost gate it mirrors: a role
    // that can mark a lead lost has to be able to undo it, or it can put a lead
    // into a state only someone else can get it out of.
    const gate = await requireRoles(["admin", "sales manager", "site head", "receptionist"]);
    if (!gate.ok) return gate.response;

    const body = (await req.json()) as RestorePayload;
    const leadId = body.leadId ?? body.lead_id;
    const restoredBy = (body.restored_by ?? "").trim();

    if (!leadId || !restoredBy || body.is_lost_lead !== false) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: leadId, is_lost_lead=false, restored_by" },
        { status: 400 }
      );
    }

    // Resolved once; the broadcast at the end must publish to the same tenant
    // the row was read from.
    const organizationId = await getOrganizationId();

    const existing = await query(
      "SELECT id, name, is_lost_lead FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
      [leadId, organizationId]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 }
      );
    }

    const updatedRows = await query(
      `UPDATE walkin_enquiries
       SET is_lost_lead = FALSE,
           lost_lead_reason = NULL,
           lost_lead_marked_at = NULL,
           lost_lead_marked_by = NULL
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [leadId, organizationId]
    );

    const updatedLead = updatedRows[0];
    await recalculateSrNos();
    const responseLead = {
      ...updatedLead,
      lost_reason: updatedLead.lost_lead_reason,
      lost_marked_by: updatedLead.lost_lead_marked_by,
      lost_marked_at: updatedLead.lost_lead_marked_at,
    };

    try {
      await query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date, organization_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          String(leadId),
          `Lead restored from Lost Leads\nRestored By: ${restoredBy}`,
          restoredBy,
          null,
          organizationId,
        ]
      );
    } catch (fuErr: unknown) {
      console.warn("[PATCH /api/leads/restore] follow_ups insert failed:", getErrorMessage(fuErr, "Unknown error"));
    }

    // This tenant's subscribers only — see lib/lostLeadEvents.ts.
    broadcastLeadUpdate(organizationId, {
      type: "lead:lost-updated",
      leadId: String(leadId),
      lead: responseLead,
      ts: Date.now(),
    });

    return NextResponse.json(
      {
        success: true,
        message: `Lead #${leadId} restored to active.`,
        data: responseLead,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[PATCH /api/leads/restore]", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Failed to restore lead.") },
      { status: 500 }
    );
  }
}
