// api/cron/deal-stage-process/route.ts
//
// Manual recovery endpoint for deal stage events.
//
// Deal stage processing is event-driven: each business hook processes its
// event immediately via insertAndProcessOutboxEvent(). This endpoint exists
// solely for administrative recovery of events that failed immediate
// processing (e.g., transient database errors during a deploy).
//
// Auth: admin session only (tenant-scoped). No cron dependency.

import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { processOneEvent, type OutboxEvent } from "@/lib/dealStage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Processing ──────────────────────────────────────────────────────────────

interface RecoveryReport {
  processed: number;
  failed: number;
  deadLettered: number;
  durationMs: number;
}

async function recoverBatch(
  orgId: string,
  limit: number,
): Promise<RecoveryReport> {
  const start = Date.now();

  const report: RecoveryReport = {
    processed: 0,
    failed: 0,
    deadLettered: 0,
    durationMs: 0,
  };

  await transaction(async (client) => {
    const batch = await client.query<OutboxEvent>(
      `SELECT id, lead_id, event_type, event_ts, event_key,
              actor_id, payload, organization_id, attempts
         FROM deal_stage_outbox
        WHERE organization_id = $1
          AND (
            (status = 'pending')
            OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
          )
        ORDER BY id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [orgId, limit],
    );

    if (batch.rows.length === 0) return;

    for (let i = 0; i < batch.rows.length; i++) {
      const event = batch.rows[i];
      if (typeof event.payload === "string") {
        event.payload = JSON.parse(event.payload);
      }

      const sp = `recover_${i}`;
      await client.query(`SAVEPOINT ${sp}`);

      try {
        await processOneEvent(client, event);

        await client.query(
          `UPDATE deal_stage_outbox
              SET status = 'done', processed_at = NOW(), error_message = NULL
            WHERE id = $1`,
          [event.id],
        );
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        report.processed++;
      } catch (err: any) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);

        const newAttempts = (event.attempts ?? 0) + 1;
        const errorMsg = String(err?.message || "Unknown error").slice(0, 500);
        const isDeadLetter = newAttempts >= 10;

        await client.query(
          `UPDATE deal_stage_outbox
              SET status = 'failed',
                  attempts = $1,
                  error_message = $2,
                  next_retry_at = CASE
                    WHEN $3::boolean THEN NULL
                    ELSE NOW() + make_interval(secs => LEAST(pow(2, $1) * 30, 3600))
                  END
            WHERE id = $4`,
          [newAttempts, errorMsg, isDeadLetter, event.id],
        );

        if (isDeadLetter) report.deadLettered++;
        report.failed++;
      }
    }
  });

  report.durationMs = Date.now() - start;
  return report;
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function handler(req: NextRequest): Promise<NextResponse> {
  // Admin session only — tenant-scoped
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const role = normalizeRole(gate.session.role);
  if (role !== "admin" && role !== "super admin") {
    return NextResponse.json(
      { success: false, message: "Admin access required." },
      { status: 403 },
    );
  }

  const orgId = await getOrganizationId();

  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get("limit");
  let limit = 50;
  if (rawLimit) {
    const parsed = parseInt(rawLimit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  const report = await recoverBatch(orgId, limit);

  return NextResponse.json({
    success: true,
    orgId,
    ...report,
  });
}

export const GET = handler;
export const POST = handler;
