// app/api/followups/unread-count/route.ts
//
// Unread internal-message count for the signed-in sales manager, for the bell
// badge in the sales dashboard header.
//
// NOTE ON "the existing notification system": there isn't one to extend.
// /api/notifications is admin-only WhatsApp *delivery* diagnostics over
// notification_logs, and the header bell is derived client-side from
// follow-up-due leads. There is no per-user in-app notification table. So this
// is a count read straight off follow_ups — no new notification system, no new
// table, one query.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    if (!gate.userId) {
      return NextResponse.json({ success: true, count: 0, leads: [] }, { status: 200 });
    }

    // Addressed-to-me is the whole condition. It is already narrower than "leads
    // assigned to me": a message is addressed at send time, so a later
    // reassignment cannot strip a manager of a message someone actually sent
    // them, nor hand it to their replacement.
    const rows = await query<{ id: number; lead_id: number; message: string; created_by_name: string; created_at: string }>(
      `SELECT f.id, f.lead_id, f.message, f.created_by_name, f.created_at
         FROM follow_ups f
        WHERE f.follow_up_type = 'internal_message'
          AND f.sent_to_user_id = $1
          AND f.read_at IS NULL
        ORDER BY f.created_at DESC
        LIMIT 50`,
      [gate.userId]
    );

    return NextResponse.json(
      {
        success: true,
        count: rows.length,
        leads: rows.map(r => ({
          followUpId: r.id,
          leadId: r.lead_id,
          from: r.created_by_name,
          preview: String(r.message || "").slice(0, 60),
          createdAt: r.created_at,
        })),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/followups/unread-count]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
