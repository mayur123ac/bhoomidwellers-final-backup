import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getAttachmentsByFollowUps } from "@/lib/followUpAttachments";

/**
 * POST /api/followups/attachments/by-follow-ups
 *
 * Returns all attachments for a list of follow-up IDs.
 * Body: { follow_up_ids: number[] }
 *
 * Used by the Lead Detail timeline to batch-load attachment metadata
 * for all visible follow-ups in a single request.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const body = await req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.follow_up_ids)
      ? body.follow_up_ids.filter((id: unknown) => typeof id === "number" && Number.isFinite(id))
      : [];

    if (ids.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Cap to prevent abuse
    if (ids.length > 500) {
      return NextResponse.json(
        { success: false, message: "Too many follow-up IDs (max 500)" },
        { status: 400 }
      );
    }

    const attachments = await getAttachmentsByFollowUps(orgId, ids);

    return NextResponse.json({
      success: true,
      data: attachments.map((a) => ({
        id: a.id,
        follow_up_id: a.follow_up_id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        file_size: a.file_size,
        created_at: a.created_at,
      })),
    });
  } catch (error) {
    console.error("POST /api/followups/attachments/by-follow-ups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch attachments" },
      { status: 500 }
    );
  }
}
