// api/whatsapp/conversations/[id]/route.ts — one thread, with its messages.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { windowState } from "@/lib/whatsappConversations";
import { canAssociateConversations } from "@/lib/whatsappAccess";
import { requireConversation } from "../_access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 200;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireConversation(id);
  if (!gate.ok) return gate.response;

  const { conversation, viewer } = gate;
  const url = new URL(req.url);

  // Cursor pagination on id, ascending. The thread renders oldest-first and grows
  // at the bottom, so `after` is what an already-open panel asks for after a
  // reconnect: "everything I missed", not "the latest N".
  const after = Number(url.searchParams.get("after") ?? 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? PAGE), 1), 500);

  const messages = await query<any>(
    `SELECT id::text                AS id,
            direction,
            sender_user_id          AS "senderUserId",
            sender_name             AS "senderName",
            sender_role             AS "senderRole",
            message_type            AS "messageType",
            message_text            AS "messageText",
            media,
            template_name           AS "templateName",
            whatsapp_message_id     AS "whatsappMessageId",
            status,
            error_code              AS "errorCode",
            error_message           AS "errorMessage",
            sent_at                 AS "sentAt",
            delivered_at            AS "deliveredAt",
            read_at                 AS "readAt",
            failed_at               AS "failedAt",
            created_at              AS "createdAt"
       FROM public.whatsapp_messages
      WHERE conversation_id = $1 AND id > $2
      ORDER BY created_at ASC, id ASC
      LIMIT $3`,
    [conversation.id, Number.isFinite(after) ? after : 0, limit]
  );

  // Candidate leads for an ambiguous thread, so the association UI can show who
  // the choices actually are rather than a list of bare ids.
  let candidates: any[] = [];
  if (conversation.match_state !== "matched" && canAssociateConversations(viewer.role)) {
    const ids = conversation.candidate_lead_ids ?? [];
    if (ids.length > 0) {
      candidates = await query<any>(
        `SELECT id, name, phone, assigned_to AS "assignedTo", status,
                COALESCE(is_lost_lead, false) AS "isLost", created_at AS "createdAt"
           FROM public.walkin_enquiries
          WHERE organization_id = $1 AND id = ANY($2)
          ORDER BY id`,
        [viewer.organizationId, ids]
      );
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      id: conversation.id,
      leadId: conversation.lead_id,
      leadName: conversation.lead_name,
      leadPhone: conversation.lead_phone,
      assignedTo: conversation.assigned_to,
      customerPhone: conversation.customer_phone,
      customerProfileName: conversation.customer_profile_name,
      matchState: conversation.match_state,
      unreadCount: conversation.unread_count,
      window: windowState(conversation.last_inbound_at),
      canAssociate: canAssociateConversations(viewer.role),
      candidates,
      messages,
    },
  });
}
