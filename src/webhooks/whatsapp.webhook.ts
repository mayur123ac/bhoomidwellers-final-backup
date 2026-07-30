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

/** Counts inbound messages without acting on them. */
function countInbound(payload: unknown): number {
  const root = payload as any;
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  let n = 0;
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (Array.isArray(change?.value?.messages)) n += change.value.messages.length;
    }
  }
  return n;
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

  // ── Apply ────────────────────────────────────────────────────────────────
  const updates = parseStatuses(payload);
  let updated = 0;
  for (const u of updates) {
    if (await applyStatusUpdate(u)) updated += 1;
  }

  const inbound = countInbound(payload);

  // 200 for anything well-formed and correctly signed, even when nothing
  // matched. Meta retries non-2xx aggressively with backoff and disables the
  // subscription after sustained failures — and a wamid we do not recognise
  // (one sent by hand from WhatsApp Manager, say) is not an error.
  return {
    status: 200,
    body: { received: true, statuses: updates.length, updated, inbound },
    contentType: "application/json",
  };
}
