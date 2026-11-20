// api/channel-partners/[id]/chat/download/route.ts
//
// Secure attachment download: validates the caller owns the conversation,
// verifies the attachment key belongs to this CP thread, then issues a
// short-lived presigned R2 URL.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession, getSessionUserId } from "@/lib/serverAuth";
import { canViewPartners, canViewAllPartners } from "@/lib/cpRbac";
import { generatePresignedUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!canViewPartners(session.role)) {
    return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
  }

  const { id } = await params;
  const cpId = Number(id);
  if (!Number.isInteger(cpId)) {
    return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key || typeof key !== "string" || key.length > 500) {
    return NextResponse.json({ success: false, message: "Missing or invalid key." }, { status: 400 });
  }

  try {
    const orgId = await getOrganizationId();

    // Verify the partner belongs to this org AND the caller may see it
    const cpRows = await query(
      `SELECT cp.id, cp.assigned_sourcing_manager_id
         FROM channel_partners cp
        WHERE cp.id = $1 AND cp.organization_id = $2`,
      [cpId, orgId]
    );
    if (cpRows.length === 0) {
      return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
    }
    if (
      !canViewAllPartners(session.role) &&
      String(cpRows[0].assigned_sourcing_manager_id ?? "") !== String(getSessionUserId(session) ?? "")
    ) {
      return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
    }

    // Verify the attachment_key belongs to a message in THIS conversation
    const msgRows = await query(
      `SELECT id FROM cp_chat_messages
        WHERE organization_id = $1
          AND channel_partner_id = $2
          AND attachment_key = $3
        LIMIT 1`,
      [orgId, cpId, key]
    );
    if (msgRows.length === 0) {
      return NextResponse.json({ success: false, message: "Attachment not found." }, { status: 404 });
    }

    // Generate a 10-minute presigned URL and redirect
    const url = await generatePresignedUrl(key, 600);
    return NextResponse.redirect(url);
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]/chat/download]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
