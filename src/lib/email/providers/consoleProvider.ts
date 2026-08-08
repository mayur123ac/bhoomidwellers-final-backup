// lib/email/providers/consoleProvider.ts — the no-transport fallback.
//
// Selected only when nothing else is configured. It is NOT a mock and NOT a
// placeholder: it never claims to have delivered anything. `delivered` is false
// and the error says exactly why, so the routing engine records a failed
// attempt, the UI reports that no mail was sent, and the OTP routes surface the
// code in their own response to keep the flow testable.
//
// The alternative — returning success and silently dropping the message — is
// the single worst thing a mail layer can do, because everything downstream
// looks healthy while no email exists.
//
// It logs the full message so a developer without SMTP credentials can still
// read the OTP or follow the invite link during local work.

import type { EmailError, EmailMessage, EmailProvider, SendOutcome } from "../types";

const NOT_CONFIGURED: EmailError = {
  kind: "config",
  retryable: false,
  message:
    "No mail transport is configured, so nothing was sent. Set SMTP_HOST, SMTP_PORT, " +
    "SMTP_USER, SMTP_PASSWORD and MAIL_FROM_EMAIL in .env.local.",
};

export class ConsoleProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<SendOutcome> {
    // console.info, not console.error — a missing transport is a configuration
    // state, not a fault, and it should not read as one in the logs.
    console.info(
      [
        "",
        "──────── EMAIL (not sent — no mail transport configured) ────────",
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "─────────────────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );

    return { delivered: false, provider: this.name, error: NOT_CONFIGURED };
  }

  async verify(): Promise<{ ok: false; error: EmailError }> {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
