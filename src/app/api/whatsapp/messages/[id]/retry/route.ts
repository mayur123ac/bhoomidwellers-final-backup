// api/whatsapp/messages/[id]/retry/route.ts — resend a failed message (spec §3).
//
// Retries the EXISTING row rather than creating a new one, so the thread does not
// accumulate a bubble per attempt and the audit trail keeps one message with one
// history. Only a message in 'failed' is eligible: retrying one that Meta already
// accepted would deliver it twice, and the customer has no way to tell that was
// our mistake rather than a deliberate repeat.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { assertConfigured, isConfigured } from "@/config/whatsapp.config";
import { sendText, sendTemplate } from "@/lib/whatsapp-client";
import { toMetaRecipient } from "@/lib/phone";
import { WhatsAppError } from "@/types/whatsapp.types";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { conversationScope, type Viewer } from "@/lib/whatsappAccess";
import {
  loadVisibility,
  markOutboundFailed,
  markOutboundSent,
  windowState,
} from "@/lib/whatsappConversations";
import { broadcastWhatsAppEvent } from "@/lib/whatsappEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const viewer: Viewer = {
    userId: gate.userId,
    name: gate.session.name || gate.session.email || "",
    role: gate.session.role,
    organizationId: await getOrganizationId(),
  };

  const messageId = Number(id);
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ success: false, message: "Invalid message id." }, { status: 400 });
  }

  if (!isConfigured()) {
    return NextResponse.json(
      { success: false, code: "CONFIG_MISSING", message: "WhatsApp is not configured." },
      { status: 503 }
    );
  }

  // The message is loaded through the same conversation visibility rule as
  // everything else, so a retry cannot be used to reach a thread the caller
  // could not otherwise open.
  const qp: unknown[] = [viewer.organizationId, messageId];
  const scope = conversationScope(viewer, qp.length + 1, "c", "l");
  qp.push(...scope.params);

  const rows = await query<any>(
    `SELECT m.id, m.status, m.direction, m.message_text, m.message_type,
            m.template_name, m.conversation_id, m.lead_id,
            c.customer_phone, c.last_inbound_at
       FROM public.whatsapp_messages m
       JOIN public.whatsapp_conversations c ON c.id = m.conversation_id
       LEFT JOIN public.walkin_enquiries l  ON l.id = c.lead_id
      WHERE m.organization_id = $1 AND m.id = $2 AND ${scope.sql}`,
    qp
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: false, message: "Message not found." }, { status: 404 });
  }

  const msg = rows[0];

  if (msg.direction !== "outbound") {
    return NextResponse.json(
      { success: false, message: "Only outbound messages can be retried." },
      { status: 400 }
    );
  }
  if (msg.status !== "failed") {
    return NextResponse.json(
      {
        success: false,
        code: "NOT_RETRYABLE",
        message: `This message is "${msg.status}", not failed. Retrying would send it twice.`,
      },
      { status: 409 }
    );
  }

  const isTemplate = Boolean(msg.template_name);
  const win = windowState(msg.last_inbound_at);
  if (!isTemplate && !win.open) {
    return NextResponse.json(
      {
        success: false,
        code: "WINDOW_CLOSED",
        message:
          "The 24-hour window has closed since this message failed. Send an approved template instead.",
        window: win,
      },
      { status: 409 }
    );
  }

  // Back to 'sending' before the attempt, for the same reason the original send
  // writes first: an in-flight retry must be visible as in-flight.
  await query(
    `UPDATE public.whatsapp_messages
        SET status = 'sending', error_code = NULL, error_message = NULL, failed_at = NULL
      WHERE id = $1`,
    [msg.id]
  );

  const to = toMetaRecipient(msg.customer_phone);

  try {
    const cfg = assertConfigured();
    const result = isTemplate
      ? await sendTemplate(
          to,
          { name: msg.template_name, language: { code: cfg.templateLanguage } } as any,
          cfg
        )
      : await sendText(to, String(msg.message_text ?? ""), cfg);

    const sent = await markOutboundSent(msg.id, result.messageId);

    const visibility = await loadVisibility(viewer.organizationId, msg.conversation_id);
    broadcastWhatsAppEvent(
      viewer.organizationId,
      {
        type: "message_status",
        conversationId: msg.conversation_id,
        leadId: msg.lead_id,
        messageId: String(msg.id),
        status: sent?.status ?? "sent",
        ts: Date.now(),
      },
      visibility
    );

    return NextResponse.json({ success: true, data: sent });
  } catch (err) {
    const wa = WhatsAppError.from(err);
    const failed = await markOutboundFailed(msg.id, wa.code, wa.message);

    const visibility = await loadVisibility(viewer.organizationId, msg.conversation_id);
    broadcastWhatsAppEvent(
      viewer.organizationId,
      {
        type: "message_status",
        conversationId: msg.conversation_id,
        leadId: msg.lead_id,
        messageId: String(msg.id),
        status: "failed",
        errorCode: wa.code,
        errorMessage: wa.message,
        ts: Date.now(),
      },
      visibility
    );

    return NextResponse.json({
      success: false,
      code: wa.code,
      message: wa.message,
      data: failed,
    });
  }
}
