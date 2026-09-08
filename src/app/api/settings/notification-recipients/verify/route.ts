// api/settings/notification-recipients/verify/route.ts
//
// POST — handles OTP send and verify for alternative email verification.
// Minimal stub: email delivery requires SMTP credentials that are not yet
// configured (see memory: email-smtp-pending-credentials.md). This route
// returns the correct shape so the UI does not 404, and will be wired to
// real OTP delivery once SMTP is live.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "send") {
      // Stub: would send OTP via SMTP.
      return NextResponse.json({
        success: true,
        message: "Email verification is not yet available. SMTP credentials are pending.",
        sessionId: null,
        expiresIn: 0,
        resendAvailableIn: 60,
      });
    }

    if (action === "verify") {
      return NextResponse.json({
        success: false,
        message: "Email verification is not yet available. SMTP credentials are pending.",
      });
    }

    return NextResponse.json(
      { success: false, message: "Unknown action." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("[POST /api/settings/notification-recipients/verify]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
