// app/api/settings/notification-recipients/verify/route.ts
//
// The staged verification workflow:
//
//   GET    → current verification state
//   POST   → send a code to the STAGED address
//   PUT    → check the code and promote the staged address to live
//   DELETE → discard the staged address
//
// Staging itself happens in PATCH /api/settings/notification-recipients, which
// is what "Save Changes" calls. Nothing here writes the live address except a
// successful PUT.
//
// All four are thin. Every rule — the expiry, the attempt cap, the cooldown, the
// hourly ceiling, the promotion, the audit entries — lives in
// lib/alternativeEmailVerification.ts, so there is one place where they interlock.
//
// ── Authorisation ───────────────────────────────────────────────────────────
// requireSession(), and the user id comes from the verified session cookie
// rather than the body. A body-supplied id would let anyone verify an address
// against a colleague's account — and a verified alternative address both
// receives that account's security mail and works as a sign-in identifier.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { requestContext } from "@/lib/auditLog";
import {
  clearPendingEmail,
  getVerificationState,
  sendVerificationCode,
  verifyCode,
} from "@/lib/alternativeEmailVerification";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  return NextResponse.json({ success: true, state: await getVerificationState(gate.userId) });
}

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const { ip, userAgent } = requestContext(req);

  const result = await sendVerificationCode({
    userId: gate.userId,
    actorName: gate.session.name,
    ip,
    userAgent,
  });

  if (!result.ok) {
    // 429 for the two rate limits, 400 otherwise — a client backing off needs to
    // tell "too fast" apart from "nothing staged".
    const status = result.code === "COOLDOWN" || result.code === "HOURLY_LIMIT" ? 429 : 400;
    return NextResponse.json(
      { success: false, code: result.code, message: result.message, state: result.state },
      { status }
    );
  }

  return NextResponse.json({
    success: true,
    message: result.delivered
      ? `A 6-digit code has been sent to ${result.address}.`
      : "Mail delivery is not configured, so the code could not be sent. It is shown below for testing.",
    address: result.address,
    sessionId: result.sessionId,
    delivered: result.delivered,
    devOtp: result.devOtp,
    state: result.state,
  });
}

export async function PUT(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { ip, userAgent } = requestContext(req);

  const result = await verifyCode({
    userId: gate.userId,
    actorName: gate.session.name,
    otp: String(body.otp ?? ""),
    sessionId: body.sessionId == null ? null : String(body.sessionId),
    ip,
    userAgent,
  });

  if (!result.ok) {
    const status = result.code === "TOO_MANY_ATTEMPTS" ? 429 : 400;
    return NextResponse.json(
      { success: false, code: result.code, message: result.message, state: result.state },
      { status }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Alternative email verified and saved successfully.",
    address: result.address,
    state: result.state,
  });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const { ip, userAgent } = requestContext(req);

  const state = await clearPendingEmail({
    userId: gate.userId,
    actorName: gate.session.name,
    ip,
    userAgent,
  });

  return NextResponse.json({ success: true, message: "Pending change discarded.", state });
}
