// types/whatsapp.types.ts — the shared vocabulary of the notification module.
//
// Everything here is either a type or the one error class. Nothing in this file
// reads process.env, touches the database, or imports from next/*, so it can be
// pulled into a client bundle, a script, or a test without dragging the rest of
// the module along.
//
// WhatsAppError is a class rather than a plain interface because both
// whatsapp-client.ts (which throws it) and whatsapp.service.ts (which decides
// whether to retry) need `instanceof`. It lives here, in the only leaf both of
// them already import, rather than in a seventh file.

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every way a notification can fail, collapsed into a closed set.
 *
 * The distinction that matters operationally is not "which HTTP status" but
 * "will trying again help?" — see RETRYABLE_CODES. The codes are stored in
 * notification_logs.last_error_code so an admin can filter the feed by cause
 * without parsing prose.
 */
export type WhatsAppErrorCode =
  /** Env vars absent. The expected state before go-live, not a defect. */
  | "CONFIG_MISSING"
  /** WHATSAPP_ENABLED=false — an operator deliberately switched sending off. */
  | "DISABLED"
  /** The target user has no whatsapp_number on file. */
  | "MISSING_RECIPIENT"
  /** A number is present but cannot be coerced to E.164. A data defect. */
  | "INVALID_PHONE"
  /** Param count/shape wrong, or Meta rejected the template by name/locale. */
  | "INVALID_TEMPLATE"
  /** 401/403, or Meta's OAuthException code 190. Bad or expired token. */
  | "AUTH_FAILED"
  /** 429, or Meta's throughput codes. */
  | "RATE_LIMITED"
  /** Any other non-2xx from Graph. */
  | "META_API_ERROR"
  /** AbortSignal.timeout fired. */
  | "NETWORK_TIMEOUT"
  /** DNS, ECONNREFUSED, TLS — the request never got an HTTP response. */
  | "NETWORK_ERROR"
  /** Postgres refused. Usually the migration has not been run. */
  | "DB_ERROR"
  | "UNKNOWN";

/**
 * Codes where a later attempt has a genuine chance of succeeding.
 *
 * META_API_ERROR is deliberately absent: it is retryable only when the HTTP
 * status was 5xx, which the constructor decides. AUTH_FAILED and
 * INVALID_TEMPLATE are deliberately absent too — a bad token or an unapproved
 * template fails identically on attempt three, and burning the ladder only
 * delays the moment an admin sees the real cause.
 */
export const RETRYABLE_CODES: ReadonlySet<WhatsAppErrorCode> = new Set<WhatsAppErrorCode>([
  "RATE_LIMITED",
  "NETWORK_TIMEOUT",
  "NETWORK_ERROR",
]);

export interface WhatsAppErrorOptions {
  httpStatus?: number;
  metaCode?: number;
  metaSubcode?: number;
  /** Must already be redacted by the thrower. Stored in the log payload. */
  details?: unknown;
  /** Overrides the RETRYABLE_CODES default. */
  retryable?: boolean;
  cause?: unknown;
}

export class WhatsAppError extends Error {
  readonly code: WhatsAppErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly metaCode?: number;
  readonly metaSubcode?: number;
  readonly details?: unknown;

  constructor(code: WhatsAppErrorCode, message: string, opts: WhatsAppErrorOptions = {}) {
    super(message);
    this.name = "WhatsAppError";
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.metaCode = opts.metaCode;
    this.metaSubcode = opts.metaSubcode;
    this.details = opts.details;
    this.retryable =
      opts.retryable ??
      (RETRYABLE_CODES.has(code) || (code === "META_API_ERROR" && (opts.httpStatus ?? 0) >= 500));

    // Without this, `instanceof WhatsAppError` is false when the class is
    // extended and the build targets ES5. Cheap insurance.
    Object.setPrototypeOf(this, WhatsAppError.prototype);
  }

  /** Wraps anything thrown into a WhatsAppError without losing the message. */
  static from(err: unknown): WhatsAppError {
    if (err instanceof WhatsAppError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new WhatsAppError("UNKNOWN", message, { cause: err });
  }

  /** One line for notification_logs.last_error. Caller must redact first. */
  toLogString(): string {
    const bits: string[] = [`[WA:${this.code}]`, this.message];
    if (this.httpStatus) bits.push(`http=${this.httpStatus}`);
    if (this.metaCode !== undefined) bits.push(`meta=${this.metaCode}`);
    if (this.metaSubcode !== undefined) bits.push(`sub=${this.metaSubcode}`);
    return bits.join(" ");
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      metaCode: this.metaCode,
      retryable: this.retryable,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The status column of notification_logs. Mirrored by the CHECK constraint in
 * 2026-07-30_whatsapp_notification_logs.sql — changing one without the other
 * will start rejecting writes.
 *
 *   pending    inserted, never attempted            → swept
 *   sending    claimed by a worker (locked_at set)  → stale-lock reaper only
 *   sent       Meta returned a wamid                → awaits webhook
 *   delivered  webhook said delivered
 *   read       webhook said read                    → terminal
 *   failed     attempt failed, retry scheduled      → swept
 *   dead       retries exhausted / non-retryable    → terminal
 *   skipped    never attempted, and that is correct → terminal
 *
 * `skipped` carries the weight here. Before credentials exist every trigger
 * still writes a fully-built row so the resolved recipient and the exact
 * parameter order can be audited without sending anything. Those rows are never
 * auto-drained when credentials arrive — by then they describe stale events.
 */
export type NotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "dead"
  | "skipped";

/** Ordering used to stop out-of-order webhooks moving a row backwards. */
export const STATUS_RANK: Readonly<Record<string, number>> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * What happened, in business terms. Stored in notification_logs.type and used
 * with subject_id as the idempotency key, so a value here is a promise that
 * (type, subject_id) uniquely identifies one real-world event.
 */
export type NotificationType =
  | "cp_registration"
  | "cp_lead_assigned"
  /** Ad-hoc send from POST /api/whatsapp. Exempt from the uniqueness index. */
  | "manual";

/** Key into TEMPLATE_REGISTRY. Distinct from NotificationType because a future
 *  event may reuse an existing template, or ship two variants of its own. */
export type TemplateKey = "cp_registration" | "cp_lead_assigned";

/** Why a row was skipped or killed before any network call was made. */
export type SkipReason =
  | "CONFIG_MISSING"
  | "DISABLED"
  | "NO_ASSIGNEE"
  | "MISSING_RECIPIENT"
  | "DUPLICATE";

export type SubjectType = "channel_partner" | "walkin_enquiry";

// ─────────────────────────────────────────────────────────────────────────────
// Meta Cloud API wire shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateTextParameter {
  type: "text";
  text: string;
}

export interface TemplateComponent {
  type: "body" | "header" | "button";
  sub_type?: string;
  index?: string;
  parameters: TemplateTextParameter[];
}

export interface TemplateMessage {
  name: string;
  language: { code: string };
  components: TemplateComponent[];
}

interface OutboundBase {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  /** Digits only, no leading '+'. See toMetaRecipient in lib/phone.ts. */
  to: string;
}

export interface OutboundTemplateMessage extends OutboundBase {
  type: "template";
  template: TemplateMessage;
}

export interface OutboundTextMessage extends OutboundBase {
  type: "text";
  text: { preview_url: false; body: string };
}

export interface OutboundMediaMessage extends OutboundBase {
  type: "image" | "video" | "audio" | "sticker";
  image?: MediaObject;
  video?: MediaObject;
  audio?: MediaObject;
  sticker?: MediaObject;
}

export interface OutboundDocumentMessage extends OutboundBase {
  type: "document";
  document: MediaObject & { filename?: string };
}

/** Meta accepts either a hosted media id or a public link, never both. */
export interface MediaObject {
  id?: string;
  link?: string;
  caption?: string;
}

export type OutboundMessage =
  | OutboundTemplateMessage
  | OutboundTextMessage
  | OutboundMediaMessage
  | OutboundDocumentMessage;

export interface SendResult {
  /** The wamid. Written to notification_logs.message_id and matched by webhooks. */
  messageId: string;
  /** Meta's canonical form of the recipient, when it echoes one. */
  waId: string | null;
  raw: unknown;
}

/** Meta's error envelope, as far as we rely on it. */
export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_data?: { messaging_product?: string; details?: string };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────────

export type WebhookStatusName = "sent" | "delivered" | "read" | "failed";

export interface WebhookStatusUpdate {
  messageId: string;
  status: WebhookStatusName;
  /** Meta sends unix SECONDS as a string; parsed to a number here. */
  timestampUnix: number;
  recipientId: string | null;
  errorCode: number | null;
  errorTitle: string | null;
}

/** What the pure webhook handlers return; the route turns it into a Response. */
export interface WebhookResponse {
  status: number;
  body: unknown;
  contentType?: "text/plain" | "application/json";
}

export interface SignatureCheck {
  ok: boolean;
  reason?: "no_secret" | "missing_header" | "bad_format" | "mismatch";
}

// ─────────────────────────────────────────────────────────────────────────────
// Database row
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors notification_logs 1:1. Timestamps arrive from pg as Date objects. */
export interface NotificationLogRow {
  id: number;
  channel: string;
  type: string;
  receiver: string | null;
  receiver_user_id: number | null;
  receiver_phone: string | null;
  subject_type: string | null;
  subject_id: number | null;
  template_name: string | null;
  message_id: string | null;
  status: NotificationStatus;
  payload: NotificationPayload | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: Date | null;
  locked_at: Date | null;
  last_error: string | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  failed_at: Date | null;
}

/**
 * The JSONB column. `request` is the exact body posted to Meta — it contains
 * only the recipient, template name and parameters, which is precisely why
 * keeping it is safe and useful. Headers are never stored, so the token cannot
 * reach this column even by accident.
 */
export interface NotificationPayload {
  request?: unknown;
  response?: unknown;
  attempts?: NotificationAttempt[];
  /** Set only on INVALID_PHONE, so the offending input can be corrected. */
  raw_phone?: string;
}

export interface NotificationAttempt {
  at: string;
  code: WhatsAppErrorCode | "OK";
  httpStatus?: number | null;
  message?: string;
}
