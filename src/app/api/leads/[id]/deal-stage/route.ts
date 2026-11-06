// api/leads/[id]/deal-stage/route.ts
//
// Single-lead deal stage read + manual advance API.
//
// GET  — Returns the full stage progression for one lead.
// POST — Manual stage advancement (Admin / Site Head only).
//
// Authorization (GET):
//   Admin / Site Head:       always allowed (within their org)
//   Assigned Sales Manager:  allowed (assigned_to_user_id match or name fallback)
//   Receptionist:            403 Forbidden
//   All others:              403 Forbidden
//
// Authorization (POST):
//   Admin / Site Head:       always allowed (within their org)
//   All others:              403 Forbidden

import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { buildApiResponse, STAGE_NAMES, type StageHistoryRow } from "@/lib/dealStage";
import { insertAndProcessOutboxEvent, buildEventKey } from "@/lib/dealStageOutbox";

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

    // Enrich with triggered_by user names
    const triggeredByIds = [...new Set(
      historyRows.filter((r) => r.triggered_by != null).map((r) => r.triggered_by!),
    )];
    let userNames: Record<number, string> = {};
    if (triggeredByIds.length > 0) {
      const userRows = await query<{ id: number; name: string }>(
        `SELECT id, name FROM users WHERE id = ANY($1::int[])`,
        [triggeredByIds],
      );
      for (const u of userRows) userNames[u.id] = u.name;
    }

    // Fetch manual advance reasons from outbox payload
    const manualReasons: Record<string, string> = {};
    const manualStages = historyRows.filter(
      (r) => r.source_event.startsWith("manual_advance_"),
    );
    if (manualStages.length > 0) {
      const manualKeys = manualStages.map(
        (r) => `${r.source_event}:manual:${leadId}`,
      );
      const outboxRows = await query<{ event_key: string; payload: any }>(
        `SELECT event_key, payload FROM deal_stage_outbox
          WHERE event_key = ANY($1::text[]) AND organization_id = $2`,
        [manualKeys, orgId],
      );
      for (const row of outboxRows) {
        const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        if (p?.reason) {
          // Extract ordinal from event_key: "manual_advance_3:manual:123"
          const match = row.event_key.match(/^manual_advance_(\d)/);
          if (match) manualReasons[match[1]] = p.reason;
        }
      }
    }

    return NextResponse.json({
      success: true,
      tracked: true,
      ...response,
      userNames,
      manualReasons,
    });
  } catch (error: any) {
    console.error("GET /api/leads/[id]/deal-stage error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Manual stage advancement
// ---------------------------------------------------------------------------

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    // Authorization: Admin / Site Head only
    const role = normalizeRole(session.role);
    const isAdmin = role === "admin" || role === "super admin";
    const isSiteHead = role === "site head";
    if (!isAdmin && !isSiteHead) {
      return NextResponse.json(
        { success: false, message: "Only Admin or Site Head can manually advance stages." },
        { status: 403 },
      );
    }

    const { id } = await params;
    const leadId = parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json(
        { success: false, message: "Invalid lead id." },
        { status: 400 },
      );
    }

    const body = await req.json();
    const targetOrdinal = Number(body.target_ordinal);
    const reason = String(body.reason || "").trim();
    const eventTs = body.event_ts ? String(body.event_ts) : new Date().toISOString();

    // Validate target ordinal
    if (!Number.isInteger(targetOrdinal) || targetOrdinal < 1 || targetOrdinal > 6) {
      return NextResponse.json(
        { success: false, message: "target_ordinal must be an integer 1–6." },
        { status: 400 },
      );
    }

    // Validate reason
    if (!reason || reason.length < 3) {
      return NextResponse.json(
        { success: false, message: "A reason (minimum 3 characters) is required." },
        { status: 400 },
      );
    }
    if (reason.length > 500) {
      return NextResponse.json(
        { success: false, message: "Reason must be 500 characters or fewer." },
        { status: 400 },
      );
    }

    // Validate event_ts is a parseable date
    if (isNaN(new Date(eventTs).getTime())) {
      return NextResponse.json(
        { success: false, message: "Invalid event_ts." },
        { status: 400 },
      );
    }

    const orgId = await getOrganizationId();

    // Verify lead exists (tenant-scoped)
    const leadRows = await query<{ id: number }>(
      `SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [leadId, orgId],
    );
    if (leadRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 },
      );
    }

    // Check current highest stage — cannot advance to same or lower
    const currentRows = await query<{ max_ordinal: number }>(
      `SELECT COALESCE(MAX(stage_ordinal), 0) AS max_ordinal
         FROM deal_stage_history
        WHERE lead_id = $1 AND organization_id = $2`,
      [leadId, orgId],
    );
    const currentMax = currentRows[0]?.max_ordinal ?? 0;
    if (targetOrdinal <= currentMax) {
      return NextResponse.json(
        {
          success: false,
          message: `Lead is already at ${STAGE_NAMES[currentMax] || `stage ${currentMax}`}. Cannot advance to ${STAGE_NAMES[targetOrdinal]}.`,
        },
        { status: 409 },
      );
    }

    const sessionUserId = getSessionUserId(session);
    const eventType = `manual_advance_${targetOrdinal}`;

    await transaction(async (client) => {
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: eventType,
        event_ts: eventTs,
        event_key: buildEventKey(eventType, "manual", leadId),
        actor_id: sessionUserId,
        payload: {
          source_table: "manual",
          reason,
          advanced_by: session.name || session.email || `user_${sessionUserId}`,
        },
        organization_id: orgId,
      });
    });

    return NextResponse.json({
      success: true,
      message: `Lead advanced to ${STAGE_NAMES[targetOrdinal]}.`,
      stage: STAGE_NAMES[targetOrdinal],
      ordinal: targetOrdinal,
    });
  } catch (error: any) {
    console.error("POST /api/leads/[id]/deal-stage error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}
