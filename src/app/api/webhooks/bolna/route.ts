// api/webhooks/bolna/route.ts — Bolna's callback endpoint.
//
// A thin adapter, matching api/webhooks/whatsapp/route.ts. All the logic lives
// in @/webhooks/bolna.webhook, which imports nothing from next/*.
//
// Intentionally unauthenticated in the session sense — Bolna has no cookie. Its
// authentication is the token on the URL; see the long note in the webhook
// module about why that, rather than a signature or the documented IP allowlist.
// src/middleware.ts only matches /dashboard/:path*, so nothing intercepts this.

import { NextRequest, NextResponse } from "next/server";
import { authenticateWebhook, handleWebhookPost } from "@/webhooks/bolna.webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Best-effort source address.
 *
 * Only consulted when BOLNA_WEBHOOK_ALLOWED_IPS is set, and it is documented as
 * a second factor rather than the primary check precisely because these headers
 * are forgeable unless a trusted proxy overwrites them. The leftmost
 * X-Forwarded-For entry is the original client where the chain is honest, and
 * attacker-controlled where it is not — which is why the token does the real work.
 */
function sourceIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  const auth = authenticateWebhook({
    token: req.nextUrl.searchParams.get("token"),
    ip: sourceIp(req),
  });

  if (!auth.ok) {
    console.warn("[bolna webhook] rejected:", auth.reason);
    return NextResponse.json({ success: false, message: auth.reason }, { status: auth.status });
  }

  // .text() rather than .json() so a malformed body produces our own 400 rather
  // than a framework-level parse error, and so the raw payload is available if
  // Bolna ever adds signing.
  const rawBody = await req.text();
  const r = await handleWebhookPost(rawBody);

  return NextResponse.json(r.body, { status: r.status });
}

/**
 * Bolna does not perform a verification handshake the way Meta does, but a GET
 * is the first thing anyone does when checking whether a URL is live. Answering
 * with the token's validity turns "is my webhook URL right?" into a question
 * that can be settled with a browser.
 */
export async function GET(req: NextRequest) {
  const auth = authenticateWebhook({
    token: req.nextUrl.searchParams.get("token"),
    ip: sourceIp(req),
  });

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.reason }, { status: auth.status });
  }

  return NextResponse.json({
    ok: true,
    message: "Bolna webhook endpoint is live and the token is valid.",
  });
}
