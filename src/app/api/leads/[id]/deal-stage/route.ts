// api/leads/[id]/deal-stage/route.ts
//
// Single-lead deal stage read API.
//
// Returns the full stage progression for one lead, including durations,
// transition types, timeline consistency, and upcoming stages.
//
// Authorization:
//   Admin / Site Head:       always allowed (within their org)
//   Assigned Sales Manager:  allowed (assigned_to_user_id match or name fallback)
//   Receptionist:            403 Forbidden
//   All others:              403 Forbidden

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { buildApiResponse, type StageHistoryRow } from "@/lib/dealStage";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const { id } = await params;
    const leadId = parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json(
        { success: false, message: "Invalid lead id." },
        { status: 400 },
      );
    }

    const orgId = await getOrganizationId();

    // Fetch lead (tenant-scoped) — needed for existence + SM authorization
    const leadRows = await query<{
      id: number;
      assigned_to: string | null;
      assigned_to_user_id: number | null;
    }>(
      `SELECT id, assigned_to, assigned_to_user_id
         FROM walkin_enquiries
        WHERE id = $1 AND organization_id = $2
        LIMIT 1`,
      [leadId, orgId],
    );
    if (leadRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 },
      );
    }

    // Authorization
    const role = normalizeRole(session.role);
    const isAdmin = role === "admin" || role === "super admin";
    const isSiteHead = role === "site head";

    if (!isAdmin && !isSiteHead) {
      // Receptionist: always denied for single-lead deal stage
      if (role === "receptionist") {
        return NextResponse.json(
          { success: false, message: "Forbidden." },
          { status: 403 },
        );
      }

      // Sales Manager: must be assigned to this lead
      const lead = leadRows[0];
      const sessionUserId = getSessionUserId(session);
      const isAssigned =
        lead.assigned_to_user_id != null && sessionUserId != null
          ? Number(lead.assigned_to_user_id) === sessionUserId
          : (session as any).name === lead.assigned_to;

      if (!isAssigned) {
        return NextResponse.json(
          { success: false, message: "Forbidden." },
          { status: 403 },
        );
      }
    }

    // Fetch stage history
    const historyRows = await query<StageHistoryRow>(
      `SELECT id, lead_id, stage, stage_ordinal, entered_at, transition_type,
              source_event, source_record_id, source_table, triggered_by,
              organization_id, created_at
         FROM deal_stage_history
        WHERE lead_id = $1 AND organization_id = $2
        ORDER BY stage_ordinal ASC`,
      [leadId, orgId],
    );

    if (historyRows.length === 0) {
      return NextResponse.json({
        success: true,
        tracked: false,
        leadId,
      });
    }

    const response = buildApiResponse(historyRows, leadId);

    return NextResponse.json({
      success: true,
      tracked: true,
      ...response,
    });
  } catch (error: any) {
    console.error("GET /api/leads/[id]/deal-stage error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}
