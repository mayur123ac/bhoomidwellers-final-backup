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
//   Assigned Receptionist:   allowed (assigned_receptionist_user_id match or name fallback)
//   All others:              403 Forbidden
//
// Authorization (POST):
//   Admin / Site Head:       always allowed (within their org)
//   Sales Manager:           allowed on leads assigned to them
//   All others:              403 Forbidden

import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { buildApiResponse, STAGE_NAMES, type StageHistoryRow } from "@/lib/dealStage";
import { insertAndProcessOutboxEvent, buildEventKey } from "@/lib/dealStageOutbox";
import { processQueueForManager } from "@/lib/walkInQueue";

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

    // Fetch lead + stage history in parallel (both tenant-scoped, independent reads).
    // If the lead doesn't exist, the history result is discarded.
    const [leadRows, historyRows] = await Promise.all([
      query<{
        id: number;
        assigned_to: string | null;
        assigned_to_user_id: number | null;
        assigned_receptionist: string | null;
        assigned_receptionist_user_id: number | null;
        created_at: string;
      }>(
        `SELECT id, assigned_to, assigned_to_user_id,
                assigned_receptionist, assigned_receptionist_user_id,
                created_at
           FROM walkin_enquiries
          WHERE id = $1 AND organization_id = $2
          LIMIT 1`,
        [leadId, orgId],
      ),
      query<StageHistoryRow>(
        `SELECT id, lead_id, stage, stage_ordinal, entered_at, transition_type,
                source_event, source_record_id, source_table, triggered_by,
                organization_id, created_at
           FROM deal_stage_history
          WHERE lead_id = $1 AND organization_id = $2
          ORDER BY stage_ordinal ASC`,
        [leadId, orgId],
      ),
    ]);

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
      const lead = leadRows[0];
      const sessionUserId = getSessionUserId(session);
      const sessionName = ((session as any).name ?? "").trim().toLowerCase();

      let isAuthorized = false;

      if (role === "receptionist") {
        // Receptionist: assigned_receptionist_user_id match or name fallback
        if (lead.assigned_receptionist_user_id != null && sessionUserId != null) {
          isAuthorized = Number(lead.assigned_receptionist_user_id) === sessionUserId;
        } else if (lead.assigned_receptionist_user_id === null) {
          isAuthorized = (lead.assigned_receptionist ?? "").trim().toLowerCase() === sessionName;
        }
      } else {
        // Sales Manager / other roles: assigned_to_user_id match or name fallback
        isAuthorized =
          lead.assigned_to_user_id != null && sessionUserId != null
            ? Number(lead.assigned_to_user_id) === sessionUserId
            : (session as any).name === lead.assigned_to;
      }

      if (!isAuthorized) {
        return NextResponse.json(
          { success: false, message: "Forbidden." },
          { status: 403 },
        );
      }
    }

    // If no stage history exists for this lead, auto-seed a "Fresh" entry.
    // This covers leads created before the deal-stage pipeline was deployed,
    // leads from the import engine whose hook failed silently, and any edge
    // case where the lead_assigned outbox event was lost. The seed is
    // idempotent (ON CONFLICT DO NOTHING) and uses the lead's created_at.
    if (historyRows.length === 0) {
      try {
        // Use created_at from the lead row already fetched above — no extra query.
        const leadCreatedAt = leadRows[0].created_at;
        if (leadCreatedAt) {
          await transaction(async (client) => {
            await client.query(
              `INSERT INTO deal_stage_history
                 (lead_id, stage, stage_ordinal, entered_at, transition_type,
                  source_event, source_record_id, source_table, triggered_by, organization_id)
               VALUES ($1, 'Fresh', 1, $2, 'INFERRED', 'auto_seed_fresh', NULL, 'walkin_enquiries', NULL, $3)
               ON CONFLICT (lead_id, stage) DO NOTHING`,
              [leadId, leadCreatedAt, orgId],
            );
          });

          // Re-fetch after seeding
          const seededRows = await query<StageHistoryRow>(
            `SELECT id, lead_id, stage, stage_ordinal, entered_at, transition_type,
                    source_event, source_record_id, source_table, triggered_by,
                    organization_id, created_at
               FROM deal_stage_history
              WHERE lead_id = $1 AND organization_id = $2
              ORDER BY stage_ordinal ASC`,
            [leadId, orgId],
          );
          if (seededRows.length > 0) {
            const response = buildApiResponse(seededRows, leadId);
            return NextResponse.json({ success: true, tracked: true, ...response, userNames: {}, manualReasons: {} });
          }
        }
      } catch (seedErr) {
        console.error("[GET /api/leads/[id]/deal-stage] Fresh auto-seed failed:", seedErr);
      }

      // If seeding failed or lead doesn't exist, fall through to untracked
      return NextResponse.json({
        success: true,
        tracked: false,
        leadId,
      });
    }

    const response = buildApiResponse(historyRows, leadId);

    // Enrich with user names + manual reasons in parallel (independent queries)
    const triggeredByIds = [...new Set(
      historyRows.filter((r) => r.triggered_by != null).map((r) => r.triggered_by!),
    )];
    const manualStages = historyRows.filter(
      (r) => r.source_event.startsWith("manual_advance_"),
    );

    const [userNameRows, outboxRows] = await Promise.all([
      triggeredByIds.length > 0
        ? query<{ id: number; name: string }>(
            `SELECT id, name FROM users WHERE id = ANY($1::int[])`,
            [triggeredByIds],
          )
        : Promise.resolve([] as { id: number; name: string }[]),
      manualStages.length > 0
        ? query<{ event_key: string; payload: any }>(
            `SELECT event_key, payload FROM deal_stage_outbox
              WHERE event_key = ANY($1::text[]) AND organization_id = $2`,
            [manualStages.map((r) => `${r.source_event}:manual:${leadId}`), orgId],
          )
        : Promise.resolve([] as { event_key: string; payload: any }[]),
    ]);

    const userNames: Record<number, string> = {};
    for (const u of userNameRows) userNames[u.id] = u.name;

    const manualReasons: Record<string, string> = {};
    for (const row of outboxRows) {
      const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      if (p?.reason) {
        const match = row.event_key.match(/^manual_advance_(\d)/);
        if (match) manualReasons[match[1]] = p.reason;
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

    // Authorization: Admin / Site Head / Sales Manager / Senior Sales Manager
    const role = normalizeRole(session.role);
    const isAdmin = role === "admin" || role === "super admin";
    const isSiteHead = role === "site head";
    const isSM = role === "sales manager" || role === "senior sales manager";
    if (!isAdmin && !isSiteHead && !isSM) {
      return NextResponse.json(
        { success: false, message: "Only Admin, Site Head, or Sales Manager can advance stages." },
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
    const sessionUserId = getSessionUserId(session);
    const eventType = `manual_advance_${targetOrdinal}`;

    const result = await transaction(async (client) => {
      // Lock lead row + fetch assignment & queue-relevant columns
      const leadLock = await client.query<{
        id: number;
        assigned_to: string | null;
        assigned_to_user_id: number | null;
        receptionist_submitted: boolean;
        sales_form_submitted_at: string | null;
      }>(
        `SELECT id, assigned_to, assigned_to_user_id,
                receptionist_submitted, sales_form_submitted_at
           FROM walkin_enquiries
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [leadId, orgId],
      );
      if (leadLock.rows.length === 0) {
        return { notFound: true as const };
      }
      const lead = leadLock.rows[0];

      // SM can only advance their own leads
      if (isSM) {
        const isAssigned =
          lead.assigned_to_user_id != null && sessionUserId != null
            ? Number(lead.assigned_to_user_id) === sessionUserId
            : (session as any).name === lead.assigned_to;
        if (!isAssigned) {
          return { forbidden: true as const };
        }
      }

      // Check current highest stage — cannot advance to same or lower
      const currentRows = await client.query<{ max_ordinal: number }>(
        `SELECT COALESCE(MAX(stage_ordinal), 0) AS max_ordinal
           FROM deal_stage_history
          WHERE lead_id = $1 AND organization_id = $2`,
        [leadId, orgId],
      );
      const currentMax = currentRows.rows[0]?.max_ordinal ?? 0;
      if (targetOrdinal <= currentMax) {
        return { conflict: true as const, currentMax };
      }

      // Insert + process the outbox event
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

      // Wire with sales_form_submitted_at: advancing to Contacted (2) or higher
      // releases the SM's BUSY status in the receptionist dropdown, identical to
      // submitting the sales form.
      if (targetOrdinal >= 2 && !lead.sales_form_submitted_at) {
        await client.query(
          `UPDATE walkin_enquiries
              SET sales_form_submitted_at = COALESCE(sales_form_submitted_at, NOW()),
                  last_activity_at        = NOW()
            WHERE id = $1 AND organization_id = $2`,
          [leadId, orgId],
        );

        // Sequential queue trigger: assign the next queued lead to this SM,
        // exactly like sales-form-submit does on first submission.
        if (lead.receptionist_submitted && lead.assigned_to_user_id) {
          await processQueueForManager(
            client,
            Number(lead.assigned_to_user_id),
            String(lead.assigned_to ?? ""),
            orgId,
          );
        }
      }

      return { ok: true as const };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 },
      );
    }
    if ("forbidden" in result) {
      return NextResponse.json(
        { success: false, message: "You can only advance stages on leads assigned to you." },
        { status: 403 },
      );
    }
    if ("conflict" in result) {
      const cm = (result as { conflict: true; currentMax: number }).currentMax;
      return NextResponse.json(
        {
          success: false,
          message: `Lead is already at ${STAGE_NAMES[cm] || `stage ${cm}`}. Cannot advance to ${STAGE_NAMES[targetOrdinal]}.`,
        },
        { status: 409 },
      );
    }

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
