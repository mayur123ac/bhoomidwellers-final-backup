// api/whatsapp/conversations/[id]/messages/route.ts — send a message (spec §3).
//
// ── The ordering rule ───────────────────────────────────────────────────────
// The message row is written in 'sending' BEFORE the Meta call, and only moves
// to 'sent' once Meta returns a wamid. Nothing here reports delivery: 'sent'
// means Meta accepted the request, and that is all it means. 'delivered' and
// 'read' arrive later, from the webhook, on the customer's handset's schedule —
// which is the whole point of spec §3's instruction not to pretend otherwise.
//
// A crash between the insert and the response therefore leaves a visible row in
// 'sending' rather than a message that silently never existed.

import { NextResponse } from "next/server";
import { assertConfigured, isConfigured, readConfig } from "@/config/whatsapp.config";
import { sendText, sendTemplate } from "@/lib/whatsapp-client";
import { toMetaRecipient } from "@/lib/phone";
import { WhatsAppError } from "@/types/whatsapp.types";
import {
  createOutbound,
  loadVisibility,
  markOutboundFailed,
  markOutboundSent,
  windowState,
} from "@/lib/whatsappConversations";
import { broadcastWhatsAppEvent } from "@/lib/whatsappEvents";
import { requireConversation } from "../../_access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WhatsApp's own limit for a text body. */
const MAX_TEXT_LENGTH = 4096;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireConversation(id);
  if (!gate.ok) return gate.response;

  const { viewer, conversation } = gate;

  if (!isConfigured()) {
    const { missing } = readConfig();
    return NextResponse.json(
      {
        success: false,
        code: "CONFIG_MISSING",
        message:
          missing.length > 0
            ? `WhatsApp is not configured. Missing: ${missing.join(", ")}`
            : "WhatsApp sending is disabled (WHATSAPP_ENABLED=false).",
      },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body?.text === "string" ? body.text : "";
  const templateName = typeof body?.template === "string" ? body.template.trim() : "";
  const templateParams: string[] = Array.isArray(body?.params) ? body.params.map(String) : [];
  const clientToken =
    typeof body?.clientToken === "string" && body.clientToken.trim()
      ? body.clientToken.trim().slice(0, 64)
      : null;

  if (!templateName) {
    if (!text.trim()) {
      return NextResponse.json(
        { success: false, message: "Message text is required." },
        { status: 400 }
      );
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { success: false, message: `Message must be ${MAX_TEXT_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }
  }

  // ── Validate the customer's number (spec §3 step 2) ───────────────────────
  // customer_phone was normalized to E.164 when the thread was created, so this
  // is a re-check rather than a first parse — but a row edited by hand, or one
  // written before a normalization fix, must not reach Meta unvalidated.
  const to = toMetaRecipient(conversation.customer_phone);
  if (!/^[1-9]\d{7,14}$/.test(to)) {
    return NextResponse.json(
      { success: false, message: `Stored number is not dialable: ${conversation.customer_phone}` },
      { status: 400 }
    );
  }

  // ── The 24-hour window (spec §13) ─────────────────────────────────────────
  // Advisory, and checked BEFORE the row is written so a predictable rejection
  // does not leave a failed message in the thread. Meta remains the authority: a
  // send that passes this check and still fails 131047 is recorded as failed.
  const win = windowState(conversation.last_inbound_at);
  if (!templateName && !win.open) {
    return NextResponse.json(
      {
        success: false,
        code: "WINDOW_CLOSED",
        message:
          "WhatsApp only allows free-form messages within 24 hours of the customer's " +
          "last message. Use an approved template to reach this customer.",
        window: win,
      },
      { status: 409 }
    );
  }

  // ── 1. Write first ────────────────────────────────────────────────────────
  const { message, duplicate } = await createOutbound({
    organizationId: viewer.organizationId,
    conversationId: conversation.id,
    leadId: conversation.lead_id,
    senderUserId: viewer.userId,
    senderName: viewer.name,
    senderRole: viewer.role,
    text: templateName ? (text || `[template: ${templateName}]`) : text,
    messageType: templateName ? "template" : "text",
    templateName: templateName || null,
    clientToken,
  });

  // A repeated clientToken is a double-submit, not a second message. Return the
  // original so the UI reconciles instead of rendering a duplicate bubble.
  if (duplicate) {
    return NextResponse.json({ success: true, data: message, duplicate: true });
  }

  // ── 2. Send ───────────────────────────────────────────────────────────────
  try {
    const cfg = assertConfigured();

    const result = templateName
      ? await sendTemplate(
          to,
          {
            name: templateName,
            language: { code: cfg.templateLanguage },
            ...(templateParams.length > 0
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: templateParams.map((t) => ({ type: "text", text: t })),
                    },
                  ],
                }
              : {}),
          } as any,
          cfg
        )
      : await sendText(to, text, cfg);

    const sent = await markOutboundSent(message.id, result.messageId);

    const visibility = await loadVisibility(viewer.organizationId, conversation.id);
    broadcastWhatsAppEvent(
      viewer.organizationId,
      {
        type: "message_created",
        conversationId: conversation.id,
        leadId: conversation.lead_id,
        message: sent ?? message,
        unreadCount: conversation.unread_count,
        ts: Date.now(),
      },
      visibility
    );

    // ── 3. Return immediately (spec §3 step 7) ──────────────────────────────
    return NextResponse.json({ success: true, data: sent ?? message });
  } catch (err) {
    const wa = WhatsAppError.from(err);
    console.error("[whatsapp send]", wa.toLogString());

    const failed = await markOutboundFailed(message.id, wa.code, wa.message);

    const visibility = await loadVisibility(viewer.organizationId, conversation.id);
    broadcastWhatsAppEvent(
      viewer.organizationId,
      {
        type: "message_status",
        conversationId: conversation.id,
        leadId: conversation.lead_id,
        messageId: String(message.id),
        status: "failed",
        errorCode: wa.code,
        errorMessage: wa.message,
        ts: Date.now(),
      },
      visibility
    );

    // 200 with a failed message, not a 4xx. The send genuinely failed, but the
    // REQUEST succeeded — the message exists, is visible in the thread, and is
    // retryable. Returning an error status would make the UI discard a row the
    // database is holding, and the two would disagree about what happened.
    return NextResponse.json({
      success: false,
      code: wa.code,
      message: wa.message,
      data: failed ?? message,
    });
  }
}
