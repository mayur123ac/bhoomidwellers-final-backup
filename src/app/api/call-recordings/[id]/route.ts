import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { generatePresignedUrl, deleteObjectFromR2 } from "@/lib/r2";
import { canDeleteRecording } from "@/lib/recordingPermissions";

export async function GET(
  _req: NextRequest,
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

    const rows = await query<{ recording_r2_key: string | null }>(
      `SELECT recording_r2_key FROM call_sessions
       WHERE id = $1 AND organization_id = $2`,
      [sessionId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Call session not found" },
        { status: 404 }
      );
    }

    if (!rows[0].recording_r2_key) {
      return NextResponse.json(
        { success: false, message: "No recording for this session" },
        { status: 404 }
      );
    }

    const url = await generatePresignedUrl(rows[0].recording_r2_key, 300);

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error("GET /api/call-recordings/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate recording URL" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/call-recordings/[id]
 *
 * Permanently deletes a voice recording from R2 and clears the reference
 * in call_sessions and the follow_up message JSON.
 *
 * Authorization:
 *   1. User must be authenticated
 *   2. User's role must be in the org's recording_delete_roles
 *   3. The call session must belong to the same organization
 *   4. The recording must exist
 *
 * If the R2 object is already gone (404), the DB reference is still cleaned
 * up (idempotent). If R2 deletion fails for other reasons, the DB reference
 * is NOT cleared and the error is returned so the operation can be retried.
 */
export async function DELETE(
  _req: NextRequest,
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

    // 1. Check role permission
    const allowed = await canDeleteRecording(orgId, gate.session.role);
    if (!allowed) {
      return NextResponse.json(
        { success: false, message: "Your role does not have permission to delete recordings." },
        { status: 403 }
      );
    }

    // 2. Load the call session — scoped to org
    const rows = await query<{
      recording_r2_key: string | null;
      follow_up_id: number | null;
      lead_id: number | null;
      user_id: number;
    }>(
      `SELECT recording_r2_key, follow_up_id, lead_id, user_id
       FROM call_sessions
       WHERE id = $1 AND organization_id = $2`,
      [sessionId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Call session not found" },
        { status: 404 }
      );
    }

    const session = rows[0];

    if (!session.recording_r2_key) {
      // Already deleted or never had a recording — idempotent success
      return NextResponse.json({ success: true, message: "No recording to delete." });
    }

    // 3. Delete from R2 first — if this fails, we do NOT clear the DB reference
    await deleteObjectFromR2(session.recording_r2_key);

    // 4. Clear recording metadata in call_sessions
    await query(
      `UPDATE call_sessions
       SET recording_r2_key = NULL,
           recording_size = NULL,
           recording_duration = NULL,
           recording_mime = NULL,
           status = 'recording_unavailable',
           updated_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );

    // 5. Update the follow_up message JSON to remove recording reference
    if (session.follow_up_id) {
      try {
        const fuRows = await query<{ message: string }>(
          `SELECT message FROM follow_ups WHERE id = $1 AND organization_id = $2`,
          [session.follow_up_id, orgId]
        );
        if (fuRows.length > 0 && fuRows[0].message) {
          const msgData = JSON.parse(fuRows[0].message);
          delete msgData.recording_r2_key;
          delete msgData.recording_size;
          delete msgData.recording_mime;
          msgData.recording_deleted = true;
          msgData.recording_deleted_by = gate.session.name || gate.session.email;
          msgData.recording_deleted_at = new Date().toISOString();
          await query(
            `UPDATE follow_ups SET message = $1 WHERE id = $2`,
            [JSON.stringify(msgData), session.follow_up_id]
          );
        }
      } catch (e) {
        // Non-fatal — the R2 object is already gone, and the call_sessions
        // row is already cleared. The follow_up JSON still referencing a
        // deleted key is cosmetic; ManualCallBubble handles missing recordings.
        console.error("Failed to update follow_up message after recording delete:", e);
      }
    }

    // 6. Audit log (uses existing activity_logs if available)
    try {
      await query(
        `INSERT INTO activity_logs (organization_id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES ($1, $2, 'RECORDING_DELETED', 'call_session', $3, $4, NOW())`,
        [
          orgId,
          gate.userId,
          sessionId,
          JSON.stringify({
            deleted_by: gate.session.name || gate.session.email,
            deleted_by_role: gate.session.role,
            follow_up_id: session.follow_up_id,
            lead_id: session.lead_id,
          }),
        ]
      );
    } catch {
      // Audit logging is best-effort — don't fail the delete if the
      // activity_logs table doesn't exist or the insert fails.
    }

    return NextResponse.json({
      success: true,
      message: "Recording permanently deleted.",
    });
  } catch (error) {
    console.error("DELETE /api/call-recordings/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete recording. Please try again." },
      { status: 500 }
    );
  }
}
