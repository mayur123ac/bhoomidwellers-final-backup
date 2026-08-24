// webhooks/whatsapp.webhook.ts — Meta callback handling, framework-free.
//
// Deliberately imports nothing from next/*. It takes plain inputs and returns
// {status, body, contentType}, so the App Router file is a thin adapter and this
// logic can be exercised from a plain node script — which matters, because the
// webhook is the one part of the module that cannot be tested by calling it the
// way the app calls it.
//
// ── What arrives here ────────────────────────────────────────────────────────
// GET  once, when you register the callback URL in the Meta App Dashboard.
// POST continuously, one per delivery state change (sent → delivered → read),
//      plus inbound messages if anyone replies to the business number.

import {
  isWebhookVerifyConfigured,
  getVerifyToken,
  readConfig,
} from "@/config/whatsapp.config";
import { safeEqual, verifyWebhookSignature } from "@/lib/whatsapp-client";
import { applyStatusUpdate } from "@/services/whatsapp.service";
import type {
  WebhookResponse,
  WebhookStatusName,
  WebhookStatusUpdate,
} from "@/types/whatsapp.types";

/**
 * Meta's subscription handshake.
 *
 * The challenge must come back as a raw string with no JSON quoting — Meta
 * compares the body byte for byte and rejects `"CHAL123"` where it expects
 * `CHAL123`. Hence the contentType field; the route must honour it.
 */
export function handleVerification(q: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
}): WebhookResponse {
  // 503 rather than 403 on purpose: an admin wiring this up needs to be able to
  // tell "my token is wrong" from "I have not set a token at all". Returning 403
  // for both sends them hunting for a typo in a value that does not exist.
  if (!isWebhookVerifyConfigured()) {
    return {
      status: 503,
      body: {
        error: "webhook_not_configured",
        message: "VERIFY_TOKEN is not set in .env.local.",
      },
      contentType: "application/json",
    };
  }

  if (q.mode === "subscribe" && q.token && safeEqual(q.token, getVerifyToken())) {
    return { status: 200, body: q.challenge ?? "", contentType: "text/plain" };
  }

  return {
    status: 403,
    body: { error: "verification_failed" },
    contentType: "application/json",
  };
}

/**
 * Pulls delivery receipts out of Meta's envelope.
 *
 * Every level is optional-chained and Array.isArray-guarded because Meta ships
 * new `field` values and new nesting into this payload without notice, and a
 * webhook that throws on an unrecognised shape gets the whole subscription
 * disabled after enough non-2xx responses.
 */
export function parseStatuses(payload: unknown): WebhookStatusUpdate[] {
  const out: WebhookStatusUpdate[] = [];
  const root = payload as any;
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      for (const s of statuses) {
        const id = typeof s?.id === "string" ? s.id : null;
        const status = s?.status as WebhookStatusName | undefined;
        if (!id || !status) continue;
        if (!["sent", "delivered", "read", "failed"].includes(status)) continue;

        const err = Array.isArray(s?.errors) ? s.errors[0] : null;

        out.push({
          messageId: id,
          status,
          // Meta sends unix SECONDS, as a string. Number() on a bad value yields
          // NaN, which to_timestamp would reject — fall back to now.
          timestampUnix: Number.isFinite(Number(s?.timestamp))
            ? Number(s.timestamp)
            : Math.floor(Date.now() / 1000),
          recipientId: typeof s?.recipient_id === "string" ? s.recipient_id : null,
          errorCode: typeof err?.code === "number" ? err.code : null,
          errorTitle:
            typeof err?.title === "string"
              ? err.title
              : typeof err?.message === "string"
                ? err.message
                : null,
        });
      }
    }
  }

  return out;
}

/**
 * Applies one delivery receipt to a CONVERSATION message.
 *
 * The same business number carries two kinds of outbound traffic — automated
 * notifications tracked in notification_logs, and customer conversation messages
 * in whatsapp_messages — and Meta sends receipts for both down this one webhook
 * with nothing to tell them apart but the wamid.
 *
 * So both handlers run, and each ignores ids it does not own. Order matters only
 * in that neither may throw: a receipt for a notification must not prevent a
 * conversation receipt later in the same payload from being applied.
 */
async function applyConversationStatus(u: WebhookStatusUpdate): Promise<boolean> {
  const { applyDeliveryStatus, loadVisibility } = await import(
    "@/lib/whatsappConversations"
  );
  const { broadcastWhatsAppEvent } = await import("@/lib/whatsappEvents");
  const { query } = await import("@/lib/db");

  const result = await applyDeliveryStatus({
    whatsappMessageId: u.messageId,
    status: u.status,
    timestampUnix: u.timestampUnix,
    errorCode: u.errorCode,
    errorTitle: u.errorTitle,
  });

  if (!result.applied || !result.message || result.conversationId == null) return false;

  // The organization is taken from the stored message, not from the payload:
  // the row is already proof of which tenant owns the wamid.
  const orgRows = await query<{ organization_id: string }>(
    `SELECT organization_id FROM public.whatsapp_messages WHERE id = $1`,
    [result.message.id]
  );
  const organizationId = orgRows[0]?.organization_id;
  if (!organizationId) return true;

  const visibility = await loadVisibility(organizationId, result.conversationId);

  broadcastWhatsAppEvent(
    organizationId,
    {
      type: "message_status",
      conversationId: result.conversationId,
      leadId: result.leadId,
      messageId: String(result.message.id),
      status: result.message.status,
      deliveredAt: result.message.delivered_at
        ? new Date(result.message.delivered_at).toISOString()
        : null,
      readAt: result.message.read_at
        ? new Date(result.message.read_at).toISOString()
        : null,
      errorCode: result.message.error_code,
      errorMessage: result.message.error_message,
      ts: Date.now(),
    },
    visibility
  );

  return true;
}

let warnedNoSecret = false;

export async function handleWebhookPost(i: {
  rawBody: string;
  signature: string | null;
}): Promise<WebhookResponse> {
  const appSecret = readConfig().config?.appSecret ?? process.env.WHATSAPP_APP_SECRET ?? null;

  // ── Signature ────────────────────────────────────────────────────────────
  if (appSecret) {
    const check = verifyWebhookSignature(i.rawBody, i.signature, appSecret);
    if (!check.ok) {
      return {
        status: 401,
        body: { error: "invalid_signature", reason: check.reason },
        contentType: "application/json",
      };
    }
  } else if (!warnedNoSecret) {
    warnedNoSecret = true;
    console.warn(
      "[whatsapp] WHATSAPP_APP_SECRET is not set — webhook signature verification is DISABLED. " +
        "Anyone who finds this URL can forge delivery receipts."
    );
  }

  // ── Parse ────────────────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(i.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" }, contentType: "application/json" };
  }

  const object = (payload as any)?.object;
  if (object !== "whatsapp_business_account") {
    return { status: 200, body: { ignored: true, object: object ?? null } };
  }

  // ── Apply delivery receipts ──────────────────────────────────────────────
  // Both stores are offered every receipt; each ignores what it does not own.
  // Each is wrapped so that one failing store cannot abandon the rest of the
  // payload — the remaining events would never be re-sent.
  const updates = parseStatuses(payload);
  let updated = 0;
  let conversationUpdated = 0;

  for (const u of updates) {
    try {
      if (await applyStatusUpdate(u)) updated += 1;
    } catch (err) {
      console.error("[whatsapp] notification status update failed:", (err as Error).message);
    }
    try {
      if (await applyConversationStatus(u)) conversationUpdated += 1;
    } catch (err) {
      console.error("[whatsapp] conversation status update failed:", (err as Error).message);
    }
  }

  // ── Store inbound customer messages ──────────────────────────────────────
  const { parseInbound, processInbound } = await import("./whatsappInbound");
  const inboundMessages = parseInbound(payload);
  let inboundResult = { stored: 0, duplicates: 0, unroutable: 0, failed: 0 };
  if (inboundMessages.length > 0) {
    try {
      inboundResult = await processInbound(inboundMessages, payload);
    } catch (err) {
      // processInbound already contains per-message failures; reaching here means
      // something outside the loop broke. Still answer 200 — see below.
      console.error("[whatsapp] inbound processing failed:", (err as Error).message);
    }
  }

  // 200 for anything well-formed and correctly signed, even when nothing
  // matched. Meta retries non-2xx aggressively with backoff and disables the
  // subscription after sustained failures — and a wamid we do not recognise
  // (one sent by hand from WhatsApp Manager, say) is not an error.
  //
  // A message we could not store is therefore invisible in the HTTP status by
  // design. whatsapp_webhook_failures is where it becomes visible instead.
  return {
    status: 200,
    body: {
      received: true,
      statuses: updates.length,
      updated,
      conversationUpdated,
      inbound: inboundMessages.length,
      inboundStored: inboundResult.stored,
      inboundDuplicates: inboundResult.duplicates,
      inboundUnroutable: inboundResult.unroutable,
      inboundFailed: inboundResult.failed,
    },
    contentType: "application/json",
  };
}
