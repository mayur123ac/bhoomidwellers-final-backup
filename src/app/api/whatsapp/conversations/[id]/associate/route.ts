// api/whatsapp/conversations/[id]/associate/route.ts — attach an orphan thread
// to a lead (spec §5).
//
// Restricted to the roles that already arbitrate lead ownership. A sales manager
// attaching an unknown number to one of their own leads is exactly the
// mis-association the ambiguous state exists to prevent, so the role check here
// is the feature, not boilerplate.

import { NextResponse } from "next/server";
import { associateConversation, loadVisibility } from "@/lib/whatsappConversations";
import { broadcastWhatsAppEvent } from "@/lib/whatsappEvents";
import { canAssociateConversations } from "@/lib/whatsappAccess";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { requireConversation } from "../../_access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireConversation(id);
  if (!gate.ok) return gate.response;

  const { viewer, conversation } = gate;

  if (!canAssociateConversations(viewer.role)) {
    return NextResponse.json(
      {
        success: false,
        code: "FORBIDDEN",
        message: "Only an admin or site head can link a conversation to a lead.",
      },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const leadId = Number(body?.leadId);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return NextResponse.json({ success: false, message: "leadId is required." }, { status: 400 });
  }

  const result = await associateConversation({
    organizationId: viewer.organizationId,
    conversationId: conversation.id,
    leadId,
  });

  if (!result.ok) {
    const status = result.reason === "already_matched" ? 409 : 404;
    const message =
      result.reason === "already_matched"
        ? "This conversation is already linked to a lead."
        : result.reason === "lead_not_found"
          ? "Lead not found."
          : "Conversation not found.";
    return NextResponse.json({ success: false, code: result.reason, message }, { status });
  }

  // Who linked what to which lead is precisely the kind of decision a dispute
  // turns on later, so it goes in the same audit log as every other consequential
  // action rather than only into the conversation row.
  try {
    const ctx = requestContext(req);
    await writeAuditLog({
      userId: viewer.userId,
      actorName: viewer.name,
      action: "whatsapp_conversation_associated",
      entityType: "whatsapp_conversation",
      entityId: conversation.id,
      oldValue: {
        matchState: conversation.match_state,
        leadId: null,
        candidates: conversation.candidate_lead_ids,
      },
      newValue: {
        matchState: "matched",
        leadId,
        customerPhone: conversation.customer_phone,
        byRole: viewer.role,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    console.error("[whatsapp associate] audit log failed:", (err as Error).message);
  }

  const visibility = await loadVisibility(viewer.organizationId, conversation.id);
  broadcastWhatsAppEvent(
    viewer.organizationId,
    {
      type: "conversation_updated",
      conversationId: conversation.id,
      leadId,
      unreadCount: conversation.unread_count,
      matchState: "matched",
      ts: Date.now(),
    },
    visibility
  );

  return NextResponse.json({ success: true, data: { id: conversation.id, leadId } });
}
