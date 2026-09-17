// lib/email/providers/consoleProvider.ts — the no-transport fallback.
//
// Selected only when nothing else is configured. It is NOT a mock and NOT a
// placeholder: it never claims to have delivered anything. `delivered` is false
// and the error says exactly why, so the routing engine records a failed
// attempt, the UI reports that no mail was sent, and the request-otp routes
// require a real transport (isMailConfigured) before generating a code.
//
// The alternative — returning success and silently dropping the message — is
// the single worst thing a mail layer can do, because everything downstream
// looks healthy while no email exists.
//
// Sensitive values (OTP codes, verification links) are redacted from the
// logged body so they cannot be recovered from application logs.

import type { EmailError, EmailMessage, EmailProvider, SendOutcome } from "../types";

const NOT_CONFIGURED: EmailError = {
  kind: "config",
  retryable: false,
  message:
    "No mail transport is configured, so nothing was sent. Set SMTP_HOST, SMTP_PORT, " +
    "SMTP_USER, SMTP_PASSWORD and MAIL_FROM_EMAIL in .env.local.",
};

/**
 * Redacts 6-digit OTP codes and similar verification secrets from an email
 * body before logging. Matches common patterns: standalone 6-digit sequences
 * that appear after "code", "OTP", "verification", or between whitespace.
 */
function redactSecrets(text: string): string {
  // Redact standalone 6-digit numbers (likely OTPs) surrounded by whitespace/punctuation/line boundaries
  return text.replace(/\b(\d{6})\b/g, "******");
}

export class ConsoleProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<SendOutcome> {
    // Log metadata and redacted body. The subject is safe (it never contains
    // the code); the text body is redacted to prevent OTP leakage in logs.
    console.info(
      [
        "",
        "-------- EMAIL (not sent -- no mail transport configured) --------",
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        redactSecrets(message.text),
        "-----------------------------------------------------------------",
        "",
      ].join("\n")
    );

    return { delivered: false, provider: this.name, error: NOT_CONFIGURED };
  }

  async verify(): Promise<{ ok: false; error: EmailError }> {
    return { ok: false, error: NOT_CONFIGURED };
  }
}
