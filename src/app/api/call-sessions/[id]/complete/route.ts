import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastFollowUp, type FollowUpPayload } from "@/lib/followUpEvents";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export async function POST(
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

    // Verify ownership and get session data
    const sessions = await query<{
      id: number;
      lead_id: number | null;
      caller_lead_id: number | null;
      user_name: string;
      phone_number: string;
      status: string;
      call_log_duration: number | null;
      recording_r2_key: string | null;
      recording_size: number | null;
      recording_duration: number | null;
      recording_mime: string | null;
      follow_up_id: number | null;
    }>(
      `SELECT id, lead_id, caller_lead_id, user_name, phone_number, status,
              call_log_duration, recording_r2_key, recording_size, recording_duration,
              recording_mime, follow_up_id
       FROM call_sessions
       WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
      [sessionId, orgId, gate.userId]
    );

    if (sessions.length === 0) {
      return NextResponse.json(
        { success: false, message: "Call session not found" },
        { status: 404 }
      );
    }

    const session = sessions[0];

    if (session.follow_up_id) {
      return NextResponse.json(
        { success: false, message: "Call session already completed" },
        { status: 409 }
      );
    }

    if (!session.lead_id) {
      // No lead to attach the follow-up to — just mark as completed
      const finalStatus = session.recording_r2_key ? "recording_attached" : "completed";
      await query(
        `UPDATE call_sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
        [finalStatus, sessionId]
      );
      return NextResponse.json({ success: true, followUpId: null });
    }

    const body = await req.json().catch(() => ({}));
    const note = String(body.note || "").trim();

    // Build the follow-up message JSON
    const messagePayload: Record<string, unknown> = {
      call_session_id: sessionId,
      duration_seconds: session.call_log_duration || 0,
      phone_number: session.phone_number,
    };
    if (session.recording_r2_key) {
      messagePayload.recording_r2_key = session.recording_r2_key;
      messagePayload.recording_size = session.recording_size;
      messagePayload.recording_mime = session.recording_mime;
    }
    if (note) {
      messagePayload.note = note;
    }

    // Determine final session status based on whether a recording was attached
    const finalStatus = session.recording_r2_key
      ? "recording_attached"
      : "recording_unavailable";

    const result = await transaction(async (client) => {
      // Insert follow-up with type "call"
      const fuRows = await client.query(
        `INSERT INTO follow_ups
           (lead_id, message, created_by_name, created_by_id, follow_up_type, organization_id)
         VALUES ($1, $2, $3, $4, 'call', $5)
         RETURNING id, created_at`,
        [
          session.lead_id,
          JSON.stringify(messagePayload),
          session.user_name,
          gate.userId,
          orgId,
        ]
      );

      const followUpId = fuRows.rows[0].id;

      // Update call session
      await client.query(
        `UPDATE call_sessions
         SET status = $1, follow_up_id = $2, updated_at = NOW()
         WHERE id = $3`,
        [finalStatus, followUpId, sessionId]
      );

      return {
        followUpId,
        createdAt: fuRows.rows[0].created_at,
      };
    });

    // Broadcast for realtime timeline update
    const followUpData: FollowUpPayload = {
      _id: String(result.followUpId),
      leadId: String(session.lead_id),
      salesManagerName: session.user_name,
      createdBy: session.user_name,
      message: JSON.stringify(messagePayload),
      siteVisitDate: null,
      createdAt: result.createdAt,
      followUpType: "call",
      createdByRole: null,
      sentToRole: null,
      sentToUserId: null,
      parentFollowUpId: null,
      readAt: null,
    };
    broadcastFollowUp(orgId, { type: "followup:created", followUp: followUpData });
    broadcastToOrg(orgId, "followup.created", { followUp: followUpData });

    return NextResponse.json({
      success: true,
      followUpId: result.followUpId,
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/call-sessions/[id]/complete error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to complete call session" },
      { status: 500 }
    );
  }
}
