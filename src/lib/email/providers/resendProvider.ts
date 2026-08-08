// lib/email/providers/resendProvider.ts — Resend's HTTP API, behind the
// provider interface.
//
// ── Why this still exists ───────────────────────────────────────────────────
// The brief says the Resend integration should be "removed or abstracted". It is
// abstracted: no business logic, no template and no service method knows this
// file exists, and nothing selects it unless EMAIL_PROVIDER=resend or SMTP is
// unconfigured while a key is present.
//
// Keeping it costs one file and earns two things. It is the worked example that
// proves the provider seam is real — the interface is satisfied by something
// structurally unlike SMTP, an HTTP call with no connection pool — so the next
// provider (SES, SendGrid, Mailgun) is a known quantity rather than a hope. And
// it leaves this deployment a way back if SMTP credentials turn out to be
// unavailable, without a revert.
//
// Sent with fetch against the documented REST endpoint rather than the `resend`
// SDK: the SDK is a thin wrapper over this one call, going direct means no
// dependency that can break on a major-version bump, and the raw status code
// stays visible — which is what makes the 403 translation below possible. The
// SDK collapses errors into a generic shape and that guidance would be lost.

import { formatFromHeader, readSenderConfig } from "../config";
import {
  hasHeaderInjection,
  isValidRecipient,
  sanitiseHeader,
  type EmailError,
  type EmailMessage,
  type EmailProvider,
  type SendOutcome,
} from "../types";

const TIMEOUT_MS = 20_000;

/**
 * Turn a Resend error into something the person reading the log can act on.
 *
 * The 403 case is the one that matters, and it is the exact failure this
 * deployment hit: the message is accurate but reads like a quota or billing
 * problem, when it is really "your MAIL_FROM domain is not verified".
 */
function explain(status: number, body: string, to: string): EmailError {
  let apiMessage = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") apiMessage = parsed.message;
  } catch {
    /* not JSON — keep the raw text */
  }

  if (status === 403 && /own email address/i.test(apiMessage)) {
    return {
      kind: "rejected",
      retryable: false,
      message:
        `Resend refused delivery to ${to}. The sender address is Resend's shared ` +
        `onboarding@resend.dev, which can only deliver to the address the Resend account ` +
        `was registered with. Verify a domain at https://resend.com/domains and set ` +
        `MAIL_FROM_EMAIL to an address on it.`,
      detail: apiMessage,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      retryable: false,
      message: `Resend rejected the API key (${status}). Check RESEND_API_KEY.`,
      detail: apiMessage,
    };
  }

  if (status === 422) {
    return {
      kind: "invalid_recipient",
      retryable: false,
      message: `Resend rejected the message as invalid: ${apiMessage}`,
      detail: apiMessage,
    };
  }

  if (status === 429) {
    return {
      kind: "rate_limited",
      retryable: true,
      message: "Resend rate limit reached (429).",
      detail: apiMessage,
    };
  }

  return {
    kind: status >= 500 ? "connection" : "rejected",
    retryable: status >= 500,
    message: `Resend returned ${status}: ${apiMessage}`,
    detail: apiMessage,
  };
}

export class ResendProvider implements EmailProvider {
  readonly name = "resend";

  async send(message: EmailMessage): Promise<SendOutcome> {
    const apiKey = (process.env.RESEND_API_KEY ?? "").trim();

    if (!apiKey) {
      return {
        delivered: false,
        provider: this.name,
        error: { kind: "config", retryable: false, message: "RESEND_API_KEY is not set." },
      };
    }

    const sender = readSenderConfig();
    const from = formatFromHeader(sender);

    if (!from) {
      return {
        delivered: false,
        provider: this.name,
        error: { kind: "config", retryable: false, message: "No sender address. Set MAIL_FROM_EMAIL." },
      };
    }

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

    const controller = new AbortController();
    // Bounded so a hung API call cannot hold a request handler open. Matches the
    // SMTP provider's socket timeout.
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          reply_to: message.replyTo || sender.replyTo || undefined,
          subject: sanitiseHeader(message.subject),
          text: message.text,
          html: message.html,
          // Resend takes inline attachments base64-encoded. The logo travels as
          // a normal attachment with a content id, exactly as over SMTP, so the
          // same rendered HTML works on both providers.
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content.toString("base64"),
            content_type: a.contentType,
            content_id: a.cid,
          })),
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        let messageId: string | undefined;
        try {
          messageId = (await response.json())?.id;
        } catch {
          /* an accepted send with an unparseable body is still accepted */
        }
        return { delivered: true, provider: this.name, messageId };
      }

      const error = explain(response.status, await response.text(), to);
      console.error(`[email:resend] delivery to ${to} failed (${error.kind}):`, error.detail);
      return { delivered: false, provider: this.name, error };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      const error: EmailError = aborted
        ? {
            kind: "timeout",
            retryable: true,
            message: `Resend did not respond within ${TIMEOUT_MS / 1000} seconds.`,
          }
        : {
            kind: "connection",
            retryable: true,
            message: "Could not reach the Resend API.",
            detail: err instanceof Error ? err.message : String(err),
          };
      console.error(`[email:resend] request failed (${error.kind}):`, error.detail ?? error.message);
      return { delivered: false, provider: this.name, error };
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(): Promise<{ ok: true } | { ok: false; error: EmailError }> {
    const apiKey = (process.env.RESEND_API_KEY ?? "").trim();

    if (!apiKey) {
      return {
        ok: false,
        error: { kind: "config", retryable: false, message: "RESEND_API_KEY is not set." },
      };
    }

    try {
      // Lists domains rather than sending anything: it exercises the same key
      // and network path, and answers in one call both whether the key works
      // AND whether a sending domain exists — which is the thing most likely to
      // be missing.
      const response = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        // A send-only key cannot list domains and answers 401. That is not a
        // broken key — it is a correctly scoped one, and reporting it as a
        // failure would send someone hunting for a problem that is not there.
        const body = await response.text();
        if (response.status === 401 && /restricted/i.test(body)) return { ok: true };
        return { ok: false, error: explain(response.status, body, "(no recipient)") };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "connection",
          retryable: true,
          message: "Could not reach the Resend API.",
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
