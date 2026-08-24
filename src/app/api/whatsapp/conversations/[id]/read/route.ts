// api/whatsapp/conversations/[id]/read/route.ts — clear a thread's unread badge.
//
// Idempotent by construction: setting a counter to zero twice is setting it to
// zero. That matters because the panel calls this whenever the thread is focused,
// which includes every remount — spec §14's "do not create duplicate
// notifications every time the page renders" applies to the clearing side too.

import { NextResponse } from "next/server";
import { loadVisibility, markConversationRead } from "@/lib/whatsappConversations";
import { broadcastWhatsAppEvent } from "@/lib/whatsappEvents";
import { requireConversation } from "../../_access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireConversation(id);
  if (!gate.ok) return gate.response;

  const { viewer, conversation } = gate;

  const unread = await markConversationRead(viewer.organizationId, conversation.id);

  // Broadcast only when something actually changed, so a focused panel does not
  // spray no-op events at every other dashboard on each remount.
  if (conversation.unread_count > 0) {
    const visibility = await loadVisibility(viewer.organizationId, conversation.id);
    broadcastWhatsAppEvent(
      viewer.organizationId,
      {
        type: "conversation_updated",
        conversationId: conversation.id,
        leadId: conversation.lead_id,
        unreadCount: 0,
        matchState: conversation.match_state,
        ts: Date.now(),
      },
      visibility
    );
  }

  return NextResponse.json({ success: true, data: { unreadCount: unread ?? 0 } });
}
