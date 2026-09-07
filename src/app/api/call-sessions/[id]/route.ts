import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

// States that are considered final — a late/duplicate client event must not
// overwrite these. The endpoint returns 200 (idempotent) without mutating.
const LOCKED_STATES = new Set([
  "recording_attached",
  "completed",
]);

// All states the client is allowed to request via PATCH.
const ALLOWED_STATUSES = new Set([
  "initiated",
  "calling",
  "completed",
  "cancelled",
  "missed",
  "recording_pending",
  "recording_detected",
  "recording_attached",
  "recording_unavailable",
  "upload_failed",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const sessionId = Number(id);
    if (!Number.isFinite(sessionId)) {
      return NextResponse.json(
        { success: false, message: "Invalid session id" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();

    // Verify ownership AND fetch current status for transition validation
    const existing = await query<{ id: number; status: string }>(
      `SELECT id, status FROM call_sessions WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
      [sessionId, orgId, gate.userId]
    );
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, message: "Call session not found" },
        { status: 404 }
      );
    }

    const currentStatus = existing[0].status;

    // If the session has already reached a final state, succeed silently.
    // This prevents a late/retried PATCH from overwriting a completed session.
    if (LOCKED_STATES.has(currentStatus)) {
      return NextResponse.json({ success: true, locked: true });
    }

    const body = await req.json().catch(() => ({}));
    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (body.status) {
      if (!ALLOWED_STATUSES.has(body.status)) {
        return NextResponse.json(
          { success: false, message: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(", ")}` },
          { status: 400 }
        );
      }
      // Don't allow a late event to regress from recording_unavailable either,
      // unless it's explicitly being set to recording_attached (upload succeeded
      // between the skip and the PATCH arriving).
      if (currentStatus === "recording_unavailable" && body.status !== "recording_attached") {
        return NextResponse.json({ success: true, locked: true });
      }
      updates.push(`status = $${paramIdx++}`);
      values.push(body.status);
    }
    if (body.callLogDuration !== undefined) {
      updates.push(`call_log_duration = $${paramIdx++}`);
      values.push(body.callLogDuration);
    }
    if (body.callLogDate !== undefined) {
      updates.push(`call_log_date = $${paramIdx++}`);
      values.push(body.callLogDate);
    }
    if (body.callLogType !== undefined) {
      updates.push(`call_log_type = $${paramIdx++}`);
      values.push(body.callLogType);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, message: "No fields to update" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);

    await query(
      `UPDATE call_sessions SET ${updates.join(", ")} WHERE id = $${paramIdx} AND organization_id = $${paramIdx + 1}`,
      [...values, sessionId, orgId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/call-sessions/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update call session" },
      { status: 500 }
    );
  }
}
