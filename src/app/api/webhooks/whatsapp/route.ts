// api/webhooks/whatsapp/route.ts — Meta's callback endpoint.
//
// A thin adapter. All the logic lives in @/webhooks/whatsapp.webhook, which
// imports nothing from next/* and can therefore be tested without booting the
// framework.
//
// This route is intentionally unauthenticated in the session sense — Meta has no
// cookie. Its authentication is the verify token on GET and the HMAC signature
// on POST. src/middleware.ts only matches /dashboard/:path*, so nothing
// intercepts it.

import { NextRequest, NextResponse } from "next/server";
import { handleVerification, handleWebhookPost } from "@/webhooks/whatsapp.webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const r = handleVerification({
    mode: sp.get("hub.mode"),
    token: sp.get("hub.verify_token"),
    challenge: sp.get("hub.challenge"),
  });

  // The challenge must be returned as a bare string. NextResponse.json would
  // wrap it in quotes and Meta would reject the subscription.
  if (r.contentType === "text/plain") {
    return new NextResponse(String(r.body ?? ""), {
      status: r.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(req: NextRequest) {
  // MUST be .text(), never .json(). The HMAC is computed over the exact bytes
  // Meta sent; parsing and re-serializing changes key order and whitespace, and
  // the signature would never match no matter how correct the secret is.
  const rawBody = await req.text();

  const r = await handleWebhookPost({
    rawBody,
    signature: req.headers.get("x-hub-signature-256"),
  });

  return NextResponse.json(r.body, { status: r.status });
}
