// app/api/followups/read/route.ts
//
// Marks a sales manager's unread internal messages on ONE lead as read.
//
// Lead-scoped rather than per-message on purpose: this fires automatically when
// the manager opens the lead, and what "read" means there is "I have looked at
// this lead's timeline", not "I clicked message #12". A per-id endpoint would
// have the client loop over ids to express the same thing.
//
// Only ever marks rows addressed to the caller, so opening a lead can never
// clear somebody else's unread badge.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { broadcastFollowUp } from "@/lib/followUpEvents";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const leadId = Number(body.leadId);
    if (!leadId) {
      return NextResponse.json({ success: false, message: "leadId is required" }, { status: 400 });
    }
    if (!gate.userId) {
      return NextResponse.json({ success: true, marked: 0 }, { status: 200 });
    }

    const orgId = await getOrganizationId();

    // Idempotent: read_at IS NULL means already-read messages are skipped.
    const rows = await query<{ id: number }>(
      `UPDATE follow_ups
          SET read_at = NOW()
        WHERE lead_id = $1
          AND follow_up_type = 'internal_message'
          AND sent_to_user_id = $2
          AND read_at IS NULL
          AND organization_id = $3
        RETURNING id`,
      [leadId, gate.userId, orgId]
    );

    // Broadcast read receipt so the sender sees the ticks update in real time.
    if (rows.length > 0) {
      broadcastFollowUp(orgId, {
        type: "followup:read",
        ids: rows.map(r => r.id),
        leadId,
        readAt: new Date().toISOString(),
        readBy: gate.session.name || gate.session.email || "unknown",
      });
    }

    return NextResponse.json({ success: true, marked: rows.length, ids: rows.map(r => r.id) }, { status: 200 });
  } catch (err: any) {
    console.error("[PATCH /api/followups/read]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
