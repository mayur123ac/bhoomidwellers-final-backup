// lib/email/types.ts — the provider contract.
//
// One interface, `EmailProvider`, with one method. Swapping SMTP for SES,
// SendGrid or Mailgun is a new file in providers/ and one line in provider.ts;
// no template, no service method and no business logic changes, because none of
// them knows which provider is in use.
//
// ── Failures are returned, not thrown ───────────────────────────────────────
// `send()` resolves with `delivered: false` rather than rejecting. The routing
// engine in lib/emailRouting.ts branches on that flag to decide whether the
// fallback address should be tried, and an exception would force every caller
// to wrap the send in a try/catch to recover the same information. A provider
// that throws anyway is caught at the dispatch boundary in provider.ts.

/* ══════════════════════════════════════════════════════════════════════════
   Messages
   ══════════════════════════════════════════════════════════════════════════ */

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /**
   * Content-ID for inline images, referenced as `cid:<value>` in the HTML.
   *
   * Used for the logo. The alternatives are worse: a remote <img> needs a
   * publicly reachable URL (so it shows nothing in local development, and
   * nothing at all in the many clients that block remote images by default),
   * and a base64 data: URI is stripped outright by Gmail.
   */
  cid?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Always present. Every template renders both parts. */
  text: string;
  /** Always present for service-sent mail. */
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

/* ══════════════════════════════════════════════════════════════════════════
   Results
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What went wrong, in a form the caller can branch on.
 *
 * The distinction that matters operationally is retryable-or-not. A timeout or
 * a network blip is worth another attempt; a rejected password or a malformed
 * recipient will fail identically forever, and retrying it just delays the
 * moment someone reads the log.
 */
export type EmailErrorKind =
  | "auth"
  | "connection"
  | "timeout"
  | "tls"
  | "invalid_recipient"
  | "rejected"
  | "rate_limited"
  | "config"
  | "unknown";

export interface EmailError {
  kind: EmailErrorKind;
  /** Plain-language, safe to show an administrator. */
  message: string;
  /** Whether another attempt could plausibly succeed. */
  retryable: boolean;
  /** The provider's own text, for the log. Never shown in the UI. */
  detail?: string;
}

export interface SendOutcome {
  delivered: boolean;
  provider: string;
  /** The provider's id for the message, when it gives one. */
  messageId?: string;
  error?: EmailError;
}

export interface EmailProvider {
  /** Stable id, recorded on every delivery attempt row. */
  readonly name: string;
  send(message: EmailMessage): Promise<SendOutcome>;
  /** Open a connection and authenticate without sending. */
  verify(): Promise<{ ok: true } | { ok: false; error: EmailError }>;
  /** Release pooled connections. Called when configuration changes. */
  close?(): Promise<void>;
}

/* ══════════════════════════════════════════════════════════════════════════
   Recipient validation
   ══════════════════════════════════════════════════════════════════════════ */

// Deliberately stricter than the RFC allows. The point is to reject typos that
// would silently black-hole a notification, not to admit every technically
// legal address — nobody is configuring `"quoted string"@example.com` here.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidRecipient(value: string | null | undefined): boolean {
  const address = (value ?? "").trim();
  return address.length > 0 && address.length <= 254 && EMAIL_RE.test(address);
}

/**
 * Reject anything that could inject a header.
 *
 * A recipient or subject containing CR or LF ends the current header and starts
 * a new one, which is how a "To" field becomes an extra Bcc to somewhere else.
 * Nodemailer guards its own header encoding, but this runs before the message
 * reaches any provider — including future ones that build headers by hand — and
 * the check is a single regex.
 *
 * Also rejects NUL, which truncates the header at the C-string boundary in some
 * MTAs, hiding whatever follows it from inspection.
 */
const HEADER_INJECTION_RE = /[\r\n\u0000]/;

export function hasHeaderInjection(value: string): boolean {
  return HEADER_INJECTION_RE.test(value);
}

/**
 * Collapse a value so it is safe to place in a header.
 *
 * Used for subjects, which are assembled from user-supplied names and
 * organisation strings. Newlines become spaces rather than being stripped, so
 * "Alice\nBcc: x@y" reads as nonsense instead of silently becoming "AliceBcc:
 * x@y" — visibly wrong is better than plausibly wrong.
 */
export function sanitiseHeader(value: string): string {
  return value.replace(/[\r\n\u0000]+/g, " ").trim();
}
