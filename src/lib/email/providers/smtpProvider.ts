// lib/email/providers/smtpProvider.ts — Nodemailer over SMTP.
//
// The default provider. Nothing outside this file constructs a transporter.
//
// ── One pooled transporter, reused ──────────────────────────────────────────
// Nodemailer pools connections per transporter instance. Building one per email
// would open and tear down a TCP+TLS handshake every time — slow, and enough to
// trip the connection-rate limits that Gmail and SES both enforce (Gmail starts
// refusing at a few dozen new connections a minute, which a login-alert burst
// reaches easily).
//
// The instance is cached lazily rather than at module scope, for the reason set
// out in lib/secretsCrypto.ts: `next build` evaluates route modules with an
// environment that may not include .env.local, and a module-scope read would
// freeze that absence into the build.
//
// The cache is keyed on the configuration itself, so changing SMTP_HOST and
// restarting picks up the new host — and, more importantly, a stale transporter
// pointing at old credentials can never survive a config change.

import nodemailer, { type Transporter } from "nodemailer";
import { formatFromHeader, readSenderConfig, readSmtpConfig, type SmtpConfig } from "../config";
import {
  hasHeaderInjection,
  isValidRecipient,
  sanitiseHeader,
  type EmailError,
  type EmailMessage,
  type EmailProvider,
  type SendOutcome,
} from "../types";

/* ══════════════════════════════════════════════════════════════════════════
   Transporter cache
   ══════════════════════════════════════════════════════════════════════════ */

let cached: { key: string; transport: Transporter } | null = null;

/** Identifies a configuration. The password is hashed in, never stored. */
function configKey(smtp: SmtpConfig): string {
  return `${smtp.host}:${smtp.port}:${smtp.secure}:${smtp.user}:${smtp.password.length}`;
}

function buildTransport(smtp: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },

    // Bounded so a dead SMTP host fails the send instead of holding a request
    // handler open until the platform's own timeout kills it. `greetingTimeout`
    // is the one that catches the classic misconfiguration — implicit TLS
    // expected on a STARTTLS port produces a socket that connects and then
    // never speaks.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,

    pool: true,
    maxConnections: 3,
    // Most hosted SMTP counts messages per connection and drops the connection
    // when a limit is hit. Recycling before that happens turns a mid-burst
    // disconnect into a clean reconnect.
    maxMessages: 50,

    tls: {
      // Certificate verification stays ON. A self-signed SMTP server is not a
      // reason to disable it globally — that would silently accept any
      // interception of every email the CRM sends, including password alerts.
      // Deployments that genuinely need it can set SMTP_TLS_REJECT_UNAUTHORIZED
      // to "false" and own that decision explicitly.
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
      minVersion: "TLSv1.2",
    },
  });
}

function getTransport(smtp: SmtpConfig): Transporter {
  const key = configKey(smtp);
  if (cached && cached.key === key) return cached.transport;

  // Configuration changed. Close the old pool rather than leaking its sockets.
  if (cached) void cached.transport.close();

  cached = { key, transport: buildTransport(smtp) };
  return cached.transport;
}

/* ══════════════════════════════════════════════════════════════════════════
   Error classification
   ══════════════════════════════════════════════════════════════════════════ */

interface NodemailerError extends Error {
  code?: string;
  responseCode?: number;
  command?: string;
}

/**
 * Turn a Nodemailer failure into something actionable.
 *
 * The raw errors are accurate and nearly useless: "Invalid login: 535-5.7.8
 * Username and Password not accepted" is a Gmail app-password problem 95% of
 * the time, and the person reading the log at 2am should not have to know that.
 *
 * `retryable` is the field the caller acts on. An authentication failure will
 * fail identically forever; a timeout will not.
 */
function classify(err: unknown): EmailError {
  const error = err as NodemailerError;
  const detail = error?.message ?? String(err);
  const code = error?.code ?? "";
  const responseCode = error?.responseCode ?? 0;
  const text = detail.toLowerCase();

  // Order matters: the checks run most-specific first. `ESOCKET` in particular
  // is reported for both TLS negotiation failures and plain connection
  // failures, so the TLS test has to come before the connection test or every
  // certificate problem is misreported as an unreachable host.

  if (
    code === "EAUTH" ||
    responseCode === 535 ||
    responseCode === 534 ||
    /invalid login|authentication failed|username and password not accepted/.test(text)
  ) {
    return {
      kind: "auth",
      retryable: false,
      message:
        "The SMTP server rejected the username or password. If this is Gmail, SMTP_PASSWORD " +
        "must be a 16-character App Password (with 2-Step Verification enabled), not the " +
        "account password.",
      detail,
    };
  }

  if (
    code === "EPROTO" ||
    /self[- ]?signed|certificate|wrong version number|unable to verify|dh key too small|sslv3|tlsv1|ssl routines/.test(
      text
    )
  ) {
    return {
      kind: "tls",
      retryable: false,
      message:
        "TLS negotiation with the SMTP server failed. This usually means SMTP_SECURE does not " +
        "match the port (465 = true, 587 = false), or the server's certificate is not trusted.",
      detail,
    };
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    /greeting never received|timed? ?out/.test(text)
  ) {
    return {
      kind: "timeout",
      retryable: true,
      message:
        "The SMTP server did not respond in time. Check SMTP_HOST and SMTP_PORT, and whether " +
        "SMTP_SECURE matches the port — implicit TLS on a STARTTLS port hangs rather than failing.",
      detail,
    };
  }

  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EDNS" ||
    code === "EAI_AGAIN" ||
    code === "ESOCKET"
  ) {
    return {
      kind: "connection",
      retryable: true,
      message:
        "Could not reach the SMTP server. Check SMTP_HOST resolves and that outbound traffic " +
        "on this port is not blocked — many hosts block port 25 entirely.",
      detail,
    };
  }

  if (responseCode === 550 || responseCode === 553 || responseCode === 554 || /recipient|no such user|mailbox unavailable/.test(text)) {
    return {
      kind: "invalid_recipient",
      retryable: false,
      message: "The SMTP server refused the recipient address.",
      detail,
    };
  }

  if (responseCode === 421 || responseCode === 450 || responseCode === 452 || /rate|too many|quota|limit exceeded/.test(text)) {
    return {
      kind: "rate_limited",
      retryable: true,
      message: "The SMTP server is rate limiting or temporarily out of capacity.",
      detail,
    };
  }

  return { kind: "unknown", retryable: true, message: `SMTP delivery failed: ${detail}`, detail };
}

/* ══════════════════════════════════════════════════════════════════════════
   The provider
   ══════════════════════════════════════════════════════════════════════════ */

export class SmtpProvider implements EmailProvider {
  readonly name = "smtp";

  async send(message: EmailMessage): Promise<SendOutcome> {
    const smtp = readSmtpConfig();

    if (!smtp) {
      return {
        delivered: false,
        provider: this.name,
        error: {
          kind: "config",
          retryable: false,
          message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD.",
        },
      };
    }

    const sender = readSenderConfig();
    const from = formatFromHeader(sender);

    if (!from) {
      return {
        delivered: false,
        provider: this.name,
        error: {
          kind: "config",
          retryable: false,
          message: "No sender address. Set MAIL_FROM_EMAIL.",
        },
      };
    }

    // Validated here, at the boundary, rather than trusted from the caller.
    // This is the last point before the address reaches a network protocol.
    const to = message.to.trim();

    if (!isValidRecipient(to) || hasHeaderInjection(to)) {
      return {
        delivered: false,
        provider: this.name,
        error: {
          kind: "invalid_recipient",
          retryable: false,
          message: `"${to.slice(0, 80)}" is not a valid email address.`,
        },
      };
    }

    try {
      const info = await getTransport(smtp).sendMail({
        from,
        to,
        replyTo: message.replyTo || sender.replyTo || undefined,
        subject: sanitiseHeader(message.subject),
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.cid,
        })),
      });

      // A 250 with the recipient in `rejected` is an accepted envelope with a
      // refused recipient. Nodemailer does not throw for it, and treating it as
      // success is how mail silently disappears.
      if (info.rejected && info.rejected.length > 0) {
        return {
          delivered: false,
          provider: this.name,
          messageId: info.messageId,
          error: {
            kind: "invalid_recipient",
            retryable: false,
            message: `The SMTP server accepted the message but rejected ${to}.`,
            detail: String(info.response ?? ""),
          },
        };
      }

      return { delivered: true, provider: this.name, messageId: info.messageId };
    } catch (err) {
      const error = classify(err);
      console.error(`[email:smtp] delivery to ${to} failed (${error.kind}):`, error.detail);
      return { delivered: false, provider: this.name, error };
    }
  }

  async verify(): Promise<{ ok: true } | { ok: false; error: EmailError }> {
    const smtp = readSmtpConfig();

    if (!smtp) {
      return {
        ok: false,
        error: {
          kind: "config",
          retryable: false,
          message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD.",
        },
      };
    }

    try {
      await getTransport(smtp).verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: classify(err) };
    }
  }

  async close(): Promise<void> {
    if (!cached) return;
    cached.transport.close();
    cached = null;
  }
}
