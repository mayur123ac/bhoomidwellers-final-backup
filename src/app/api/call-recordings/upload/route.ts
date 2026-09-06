import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { uploadBufferToR2 } from "@/lib/r2";

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/amr",
  "audio/ogg",
  "audio/wav",
  "audio/3gpp",
  "audio/aac",
  "audio/x-wav",
  "audio/mp3",
]);

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

const MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/3gpp": "3gp",
  "audio/aac": "aac",
};

export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const formData = await req.formData();
    const callSessionId = Number(formData.get("callSessionId"));
    const file = formData.get("file") as File | null;
    const durationStr = formData.get("duration");
    const duration = durationStr ? Number(durationStr) : null;

    if (!Number.isFinite(callSessionId) || !file) {
      return NextResponse.json(
        { success: false, message: "callSessionId and file are required" },
        { status: 400 }
      );
    }

    // Validate MIME type
    const mimeType = file.type || "audio/mpeg";
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { success: false, message: `Unsupported audio format: ${mimeType}` },
        { status: 400 }
      );
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, message: "File exceeds 50MB limit" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();

    // Verify session ownership
    const sessions = await query<{
      id: number;
      lead_id: number | null;
      recording_r2_key: string | null;
    }>(
      `SELECT id, lead_id, recording_r2_key
       FROM call_sessions
       WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
      [callSessionId, orgId, gate.userId]
    );

    if (sessions.length === 0) {
      return NextResponse.json(
        { success: false, message: "Call session not found" },
        { status: 404 }
      );
    }

    if (sessions[0].recording_r2_key) {
      return NextResponse.json(
        { success: false, message: "Recording already uploaded for this session" },
        { status: 409 }
      );
    }

    const ext = MIME_TO_EXT[mimeType] || "mp3";
    const leadPart = sessions[0].lead_id || "unknown";
    const r2Key = `call-recordings/${orgId}/${leadPart}/${callSessionId}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await uploadBufferToR2(r2Key, buffer, mimeType);

    // Update call_sessions with recording metadata and status
    await query(
      `UPDATE call_sessions
       SET recording_r2_key = $1,
           recording_size = $2,
           recording_duration = $3,
           recording_mime = $4,
           status = 'recording_attached',
           updated_at = NOW()
       WHERE id = $5`,
      [r2Key, file.size, duration, mimeType, callSessionId]
    );

    return NextResponse.json({
      success: true,
      r2Key,
      size: file.size,
    });
  } catch (error) {
    console.error("POST /api/call-recordings/upload error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to upload recording" },
      { status: 500 }
    );
  }
}
