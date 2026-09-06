import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { generatePresignedUrl } from "@/lib/r2";

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
