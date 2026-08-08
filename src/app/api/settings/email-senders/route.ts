// app/api/settings/email-senders/route.ts — mail transport status and testing.
//
// Replaces the guesswork in diagnosing "why did nobody get their email". Three
// questions, answered without reading server logs:
//
//   GET             what is configured, and what is wrong with it
//   POST verify     do the credentials actually authenticate
//   POST test       does a real message reach a real inbox
//
// ── What is deliberately NOT returned ───────────────────────────────────────
// SMTP_PASSWORD, RESEND_API_KEY, and any other secret. The response carries the
// host, the port, the username and the sender address — enough to see that the
// configuration is the one intended — and nothing that would let a reader send
// mail as this workspace. The username is included because it is half of "are
// these the right credentials" and is not itself a secret; the password is the
// other half and is never echoed, not even masked, because a masked value still
// leaks its length.
//
// Admin-only. Mail configuration is infrastructure, and the recent-failures list
// contains employee email addresses.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { requestContext } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { activeProvider, readSenderConfig, readSmtpConfig, validateMailConfig } from "@/lib/email/config";
import { isValidRecipient } from "@/lib/email/types";

export const dynamic = "force-dynamic";

interface FailureRow {
  created_at: string;
  email_type: string;
  recipient: string;
  destination: string;
  transport: string;
  error: string | null;
}

export async function GET() {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const provider = activeProvider();
  const sender = readSenderConfig();
  const smtp = readSmtpConfig();

  // The last few failures, so the page can show what actually went wrong rather
  // than only what the configuration looks like. These two disagree more often
  // than they agree — a valid-looking config that the server rejects is the
  // whole reason this screen exists.
  let recentFailures: FailureRow[] = [];
  let stats = { total: 0, delivered: 0, failed: 0 };

  try {
    recentFailures = await query<FailureRow>(
      `SELECT created_at, email_type, recipient, destination, transport, error
         FROM email_delivery_attempts
        WHERE delivered = false
        ORDER BY created_at DESC
        LIMIT 10`
    );

    const totals = await query<{ total: string; delivered: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE delivered)::text AS delivered
         FROM email_delivery_attempts
        WHERE created_at > NOW() - INTERVAL '30 days'`
    );

    const total = Number(totals[0]?.total ?? 0);
    const delivered = Number(totals[0]?.delivered ?? 0);
    stats = { total, delivered, failed: total - delivered };
  } catch (err) {
    // The delivery-attempts table is created by a migration. If it is missing,
    // the rest of this page is still worth showing.
    console.error(
      "[email-senders] could not read delivery history:",
      err instanceof Error ? err.message : String(err)
    );
  }

  return NextResponse.json({
    success: true,
    provider,
    configured: provider !== "console",
    sender: {
      fromName: sender.fromName,
      fromEmail: sender.fromEmail,
      replyTo: sender.replyTo,
      supportEmail: sender.supportEmail,
      companyName: sender.companyName,
      appUrl: sender.appUrl,
    },
    // Secrets omitted — see the header.
    smtp: smtp
      ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user }
      : null,
    problems: validateMailConfig(),
    stats,
    recentFailures,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const payload = (body ?? {}) as { action?: unknown; to?: unknown };
  const action = String(payload.action ?? "");
  const { ip, userAgent } = requestContext(req);

  /* ── Verify: authenticate without sending ── */
  if (action === "verify") {
    const result = await EmailService.verify();

    return NextResponse.json({
      success: result.ok,
      provider: result.provider,
      message: result.ok
        ? `Connected and authenticated against ${result.provider}.`
        : result.error.message,
      errorKind: result.ok ? undefined : result.error.kind,
      retryable: result.ok ? undefined : result.error.retryable,
    });
  }

  /* ── Test: send a real message ── */
  if (action === "test") {
    const to = String(payload.to ?? "").trim();

    if (!isValidRecipient(to)) {
      return NextResponse.json(
        { success: false, message: "Enter a valid email address to send the test to." },
        { status: 400 }
      );
    }

    const result = await EmailService.sendTestEmail(to, {
      userId: gate.userId ?? null,
      actorName: gate.session.name,
      ip,
      userAgent,
    });

    return NextResponse.json({
      // 200 either way: the request was handled correctly, and a delivery
      // failure is the ANSWER this endpoint exists to give, not an error in
      // giving it. A 500 here would make the UI show "request failed" instead
      // of the diagnostic the admin came for.
      success: result.delivered,
      provider: result.provider,
      messageId: result.messageId,
      message: result.delivered
        ? `Test email sent to ${to}. If it does not arrive within a minute, check the spam folder.`
        : (result.error?.message ?? "The test email could not be sent."),
      errorKind: result.error?.kind,
      retryable: result.error?.retryable,
    });
  }

  return NextResponse.json(
    { success: false, message: `Unknown action "${action}".` },
    { status: 400 }
  );
}
