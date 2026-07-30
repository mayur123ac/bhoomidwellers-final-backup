// lib/whatsapp-client.ts — the only module that talks to Meta, and the only one
// that ever holds the access token.
//
// Transport concerns exclusively: build the request, set the auth header, apply
// the timeout, classify the failure, hand back a message id. It knows nothing
// about templates, nothing about the database, and imports nothing from next/*,
// so it can be exercised from a plain node script.
//
// ── The redaction choke point ────────────────────────────────────────────────
// Because this is the only place the token exists, it is also the only place a
// token could leak. Every string this module puts into a WhatsAppError — message
// or details — goes through redactSecrets() first, and request headers are never
// serialized anywhere. Everything downstream inherits that guarantee without
// having to remember it.

import crypto from "node:crypto";
import {
  WhatsAppError,
  type MetaErrorBody,
  type OutboundMessage,
  type OutboundDocumentMessage,
  type OutboundMediaMessage,
  type SendResult,
  type SignatureCheck,
  type TemplateMessage,
} from "@/types/whatsapp.types";
import { assertConfigured, redactSecrets, type WhatsAppConfig } from "@/config/whatsapp.config";

// ── Meta error code tables ───────────────────────────────────────────────────
// Sourced from Meta's Cloud API error reference. Grouped by what we do about
// them rather than by Meta's own taxonomy, which mixes retryable and terminal
// conditions under the same headings.

/** Token expired, revoked, or lacking permission. Never fixed by retrying. */
const AUTH_CODES = new Set([190, 102, 10, 200, 299]);

/** Throughput and pacing limits. Retrying later is exactly the right response. */
const RATE_LIMIT_CODES = new Set([130429, 131048, 80007, 4]);

/** The template does not exist, is unapproved, or the parameters do not fit. */
const TEMPLATE_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 131008]);

/**
 * Genuine Meta failures that will recur identically on every attempt:
 *   131026 recipient cannot receive messages
 *   131047 outside the 24-hour customer service window
 *   131051 unsupported message type
 *   133010 phone number not registered
 * These are 4xx-shaped problems with the recipient, not with us.
 */
const TERMINAL_DELIVERY_CODES = new Set([131026, 131047, 131051, 133010, 131031]);

/** Meta's own "try again" codes. */
const TRANSIENT_CODES = new Set([1, 2, 131000, 131016]);

/**
 * Turns a non-2xx Graph response into a classified WhatsAppError.
 *
 * The classification decides whether the retry ladder runs, so it is worth
 * being precise: retrying an AUTH_FAILED wastes three attempts and delays the
 * moment an admin sees "your token is wrong", while *not* retrying a 503 loses
 * a notification to a transient blip.
 */
export function classifyMetaError(httpStatus: number, json: unknown): WhatsAppError {
  const body = (json ?? {}) as MetaErrorBody;
  const err = body.error ?? {};
  const metaCode = typeof err.code === "number" ? err.code : undefined;
  const metaSubcode = typeof err.error_subcode === "number" ? err.error_subcode : undefined;

  const rawMessage =
    err.message || err.error_data?.details || `Meta returned HTTP ${httpStatus}`;
  const message = redactSecrets(String(rawMessage));

  // fbtrace_id is the first thing Meta support asks for. It identifies a request
  // in their logs and contains nothing sensitive.
  const details = {
    fbtrace_id: err.fbtrace_id ?? null,
    type: err.type ?? null,
    metaCode: metaCode ?? null,
    metaSubcode: metaSubcode ?? null,
  };
  const opts = { httpStatus, metaCode, metaSubcode, details };

  if (httpStatus === 401 || httpStatus === 403 || (metaCode !== undefined && AUTH_CODES.has(metaCode))) {
    return new WhatsAppError("AUTH_FAILED", message, { ...opts, retryable: false });
  }
  if (httpStatus === 429 || (metaCode !== undefined && RATE_LIMIT_CODES.has(metaCode))) {
    return new WhatsAppError("RATE_LIMITED", message, { ...opts, retryable: true });
  }
  if (metaCode !== undefined && TEMPLATE_CODES.has(metaCode)) {
    return new WhatsAppError("INVALID_TEMPLATE", message, { ...opts, retryable: false });
  }
  if (metaCode !== undefined && TERMINAL_DELIVERY_CODES.has(metaCode)) {
    return new WhatsAppError("META_API_ERROR", message, { ...opts, retryable: false });
  }
  if (httpStatus >= 500 || (metaCode !== undefined && TRANSIENT_CODES.has(metaCode))) {
    return new WhatsAppError("META_API_ERROR", message, { ...opts, retryable: true });
  }
  // Any other 4xx: we sent something Meta did not like. Retrying sends the same
  // thing again.
  return new WhatsAppError("META_API_ERROR", message, { ...opts, retryable: false });
}

/**
 * POSTs one message to the Cloud API.
 *
 * Throws WhatsAppError on every failure path — never returns a partial result —
 * so the caller's only job is to catch, read `.retryable`, and record `.code`.
 */
export async function sendMessage(
  msg: OutboundMessage,
  cfg?: WhatsAppConfig
): Promise<SendResult> {
  const c = cfg ?? assertConfigured();
  const url = `${c.baseUrl}/${c.apiVersion}/${c.phoneNumberId}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        // The one place the token appears. Never logged, never stored.
        Authorization: `Bearer ${c.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(c.timeoutMs),
      cache: "no-store",
    });
  } catch (e: any) {
    // No HTTP response happened at all: timeout, DNS, refused connection, TLS.
    // Both are retryable — the message provably never reached Meta.
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new WhatsAppError("NETWORK_TIMEOUT", `Meta did not respond within ${c.timeoutMs}ms.`, {
        retryable: true,
      });
    }
    const causeCode = e?.cause?.code ? ` (${e.cause.code})` : "";
    throw new WhatsAppError(
      "NETWORK_ERROR",
      redactSecrets(`Could not reach Meta: ${e?.message ?? e}${causeCode}`),
      { retryable: true }
    );
  }

  // A non-JSON body from a proxy or an HTML error page must not surface as a
  // JSON parse crash — it is still an upstream failure and should be classified
  // as one.
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw new WhatsAppError("META_API_ERROR", `Meta returned HTTP ${res.status} with a non-JSON body.`, {
        httpStatus: res.status,
        retryable: res.status >= 500,
      });
    }
  }

  if (!res.ok) throw classifyMetaError(res.status, json);

  const data = (json ?? {}) as {
    messages?: Array<{ id?: string }>;
    contacts?: Array<{ wa_id?: string; input?: string }>;
  };
  const messageId = data.messages?.[0]?.id;

  if (!messageId) {
    // A 2xx with no wamid should not happen. It is explicitly NOT retryable:
    // Meta may well have accepted the message, and retrying would duplicate it.
    throw new WhatsAppError(
      "META_API_ERROR",
      "Meta accepted the request but returned no message id.",
      { httpStatus: res.status, retryable: false, details: redactSecrets(JSON.stringify(json ?? null)) }
    );
  }

  return { messageId, waId: data.contacts?.[0]?.wa_id ?? null, raw: json };
}

/** Sends an approved template. The only form that reaches a cold recipient. */
export async function sendTemplate(
  to: string,
  template: TemplateMessage,
  cfg?: WhatsAppConfig
): Promise<SendResult> {
  return sendMessage(
    { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template },
    cfg
  );
}

/**
 * Sends free-form text.
 *
 * Only delivers inside the 24-hour customer service window — that is, to
 * someone who messaged your business number in the last day. A Sourcing Manager
 * who has never written to the business number is *always* outside it, and Meta
 * returns 131047 every time. This exists for replying to inbound conversations;
 * notifications must use templates.
 */
export async function sendText(
  to: string,
  body: string,
  cfg?: WhatsAppConfig
): Promise<SendResult> {
  return sendMessage(
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    },
    cfg
  );
}

/** Sends an image/video/audio/sticker by hosted media id or public link. */
export async function sendMedia(
  to: string,
  kind: OutboundMediaMessage["type"],
  media: { id?: string; link?: string; caption?: string },
  cfg?: WhatsAppConfig
): Promise<SendResult> {
  if (!media.id && !media.link) {
    throw new WhatsAppError("INVALID_TEMPLATE", "Media requires either an id or a link.", {
      retryable: false,
    });
  }
  const msg = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: kind,
    [kind]: media,
  } as OutboundMediaMessage;
  return sendMessage(msg, cfg);
}

/** Sends a document (PDF booking form, receipt, statement). */
export async function sendDocument(
  to: string,
  document: { id?: string; link?: string; caption?: string; filename?: string },
  cfg?: WhatsAppConfig
): Promise<SendResult> {
  if (!document.id && !document.link) {
    throw new WhatsAppError("INVALID_TEMPLATE", "Document requires either an id or a link.", {
      retryable: false,
    });
  }
  const msg: OutboundDocumentMessage = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document,
  };
  return sendMessage(msg, cfg);
}

/**
 * Verifies X-Hub-Signature-256 over the RAW request body.
 *
 * The caller must pass the bytes exactly as received. Meta computes the HMAC
 * over its own serialization, so a body that has been JSON.parse'd and
 * re-stringified — different key order, different whitespace — will never match,
 * no matter how correct the secret is.
 *
 * Returns a reason rather than throwing, because "no secret configured" is a
 * deployment choice the caller must be free to allow, while "mismatch" is an
 * attack or a misconfiguration it must reject.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | null
): SignatureCheck {
  if (!appSecret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "missing_header" };

  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!/^[0-9a-f]+$/i.test(provided)) return { ok: false, reason: "bad_format" };

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.toLowerCase(), "utf8");
  // timingSafeEqual throws on unequal lengths, so the length check has to come
  // first — and a length mismatch is already a definitive answer.
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/**
 * Constant-time string comparison, for the webhook verify token and the sweep
 * endpoint's shared secret. Both are compared against attacker-supplied input.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
