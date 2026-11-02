// api/leads/deal-stages/route.ts
//
// Batch deal stage read API.
//
// GET /api/leads/deal-stages?ids=1234,1235,1236
//
// Returns deal stage data for multiple leads in a single request.
// Maximum 200 IDs per request. Foreign IDs return { tracked: false }.
//
// Authorization:
//   Admin / Site Head:  all leads in their org
//   Sales Manager:      only leads assigned to them (unassigned → tracked: false)
//   Receptionist:       only leads they submitted (unsubmitted → tracked: false)
//   All others:         403

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { buildApiResponse, type StageHistoryRow } from "@/lib/dealStage";

export const dynamic = "force-dynamic";

const MAX_IDS = 200;

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get("ids");
    if (!idsParam) {
      return NextResponse.json(
        { success: false, message: "Missing ids parameter." },
        { status: 400 },
      );
    }

    // Parse comma-separated IDs
    const rawIds = idsParam.split(",").map((s) => s.trim());
    const leadIds: number[] = [];
    for (const raw of rawIds) {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(
          { success: false, message: `Invalid lead id: ${raw}` },
          { status: 400 },
        );
      }
      leadIds.push(n);
    }

    if (leadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "No valid IDs provided." },
        { status: 400 },
      );
    }
    if (leadIds.length > MAX_IDS) {
      return NextResponse.json(
        { success: false, message: `Maximum ${MAX_IDS} IDs per request.` },
        { status: 400 },
      );
    }

    const orgId = await getOrganizationId();
    const role = normalizeRole(session.role);
    const isAdmin = role === "admin" || role === "super admin";
    const isSiteHead = role === "site head";
    const isSM =
      role === "sales manager" || role === "senior sales manager";
    const isReceptionist = role === "receptionist";

    if (!isAdmin && !isSiteHead && !isSM && !isReceptionist) {
      return NextResponse.json(
        { success: false, message: "Forbidden." },
        { status: 403 },
      );
    }

    // Fetch leads with ownership columns — tenant-scoped, single query
    const leadRows = await query<{
      id: number;
      assigned_to_user_id: number | null;
      assigned_to: string | null;
      assigned_receptionist_user_id: number | null;
      assigned_receptionist: string | null;
    }>(
      `SELECT id, assigned_to_user_id, assigned_to,
              assigned_receptionist_user_id, assigned_receptionist
         FROM walkin_enquiries
        WHERE id = ANY($1::int[]) AND organization_id = $2`,
      [leadIds, orgId],
    );

    // Build a set of authorized lead IDs based on role
    const sessionUserId = getSessionUserId(session);
    const sessionName = ((session as any).name ?? "").trim().toLowerCase();
    const authorizedIds = new Set<number>();

    for (const lead of leadRows) {
      if (isAdmin || isSiteHead) {
        authorizedIds.add(lead.id);
      } else if (isSM) {
        // SM: assigned_to_user_id match or name fallback
        if (lead.assigned_to_user_id != null && sessionUserId != null) {
          if (Number(lead.assigned_to_user_id) === sessionUserId) {
            authorizedIds.add(lead.id);
          }
        } else if (
          lead.assigned_to_user_id === null &&
          (lead.assigned_to ?? "").trim().toLowerCase() === sessionName
        ) {
          authorizedIds.add(lead.id);
        }
      } else if (isReceptionist) {
        // Receptionist: assigned_receptionist_user_id match or name fallback
        if (
          lead.assigned_receptionist_user_id != null &&
          sessionUserId != null
        ) {
          if (Number(lead.assigned_receptionist_user_id) === sessionUserId) {
            authorizedIds.add(lead.id);
          }
        } else if (
          lead.assigned_receptionist_user_id === null &&
          (lead.assigned_receptionist ?? "").trim().toLowerCase() ===
            sessionName
        ) {
          authorizedIds.add(lead.id);
        }
      }
    }

    // Fetch all stage history for authorized leads in one query (avoid N+1)
    let historyRows: StageHistoryRow[] = [];
    if (authorizedIds.size > 0) {
      historyRows = await query<StageHistoryRow>(
        `SELECT id, lead_id, stage, stage_ordinal, entered_at, transition_type,
                source_event, source_record_id, source_table, triggered_by,
                organization_id, created_at
           FROM deal_stage_history
          WHERE lead_id = ANY($1::int[]) AND organization_id = $2
          ORDER BY lead_id, stage_ordinal ASC`,
        [Array.from(authorizedIds), orgId],
      );
    }

    // Group history by lead_id
    const historyByLead = new Map<number, StageHistoryRow[]>();
    for (const row of historyRows) {
      const arr = historyByLead.get(row.lead_id) || [];
      arr.push(row);
      historyByLead.set(row.lead_id, arr);
    }

    // Build response for every requested ID
    const results: Record<
      string,
      | { tracked: false }
      | { tracked: true; [key: string]: unknown }
    > = {};

    for (const id of leadIds) {
      if (!authorizedIds.has(id)) {
        // Not in org, or not authorized — indistinguishable (prevents enumeration)
        results[String(id)] = { tracked: false };
        continue;
      }

      const rows = historyByLead.get(id);
      if (!rows || rows.length === 0) {
        results[String(id)] = { tracked: false };
        continue;
      }

      const apiResp = buildApiResponse(rows, id);
      results[String(id)] = { tracked: true, ...apiResp };
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("GET /api/leads/deal-stages error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}
