// lib/email/provider.ts — picks the provider and guards the boundary.
//
// The one place that decides which implementation is in use. Adding SES,
// SendGrid or Mailgun is a new file in providers/ and one case below; nothing
// else in the CRM changes, because nothing else names a provider.

import { activeProvider, type ProviderKind } from "./config";
import { ConsoleProvider } from "./providers/consoleProvider";
import { ResendProvider } from "./providers/resendProvider";
import { SmtpProvider } from "./providers/smtpProvider";
import type { EmailError, EmailMessage, EmailProvider, SendOutcome } from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   Selection
   ══════════════════════════════════════════════════════════════════════════ */

// One instance of each. The SMTP provider owns a connection pool, so it must be
// a singleton — a fresh instance per send would defeat the pooling it exists
// for. The other two are stateless and shared for symmetry.
const instances: Record<ProviderKind, EmailProvider> = {
  smtp: new SmtpProvider(),
  resend: new ResendProvider(),
  console: new ConsoleProvider(),
};

export function getProvider(): EmailProvider {
  return instances[activeProvider()];
}

/** Release pooled connections. For tests and configuration reloads. */
export async function closeProviders(): Promise<void> {
  for (const provider of Object.values(instances)) {
    if (provider.close) await provider.close().catch(() => {});
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Dispatch
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Send through the active provider.
 *
 * The try/catch is the contract enforcement point. Providers are documented to
 * return failures rather than throw, but a bug in one — or in a provider added
 * later by someone who did not read that line — must not turn an unsent email
 * into an unhandled rejection that takes down the request. This is the seam
 * where "email failed" stops propagating.
 */
export async function dispatch(message: EmailMessage): Promise<SendOutcome> {
  const provider = getProvider();

  try {
    return await provider.send(message);
  } catch (err) {
    const error: EmailError = {
      kind: "unknown",
      retryable: true,
      message: "The email provider threw an unexpected error.",
      detail: err instanceof Error ? err.message : String(err),
    };
    console.error(`[email] provider "${provider.name}" threw:`, error.detail);
    return { delivered: false, provider: provider.name, error };
  }
}

/** Open a connection and authenticate without sending. */
export async function verifyProvider(): Promise<
  { ok: true; provider: string } | { ok: false; provider: string; error: EmailError }
> {
  const provider = getProvider();

  try {
    const result = await provider.verify();
    return result.ok
      ? { ok: true, provider: provider.name }
      : { ok: false, provider: provider.name, error: result.error };
  } catch (err) {
    return {
      ok: false,
      provider: provider.name,
      error: {
        kind: "unknown",
        retryable: true,
        message: "The email provider threw while verifying.",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
