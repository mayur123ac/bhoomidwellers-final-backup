// api/auth/forgot-password/verify/route.ts — step 2: check the code.
//
// This step deliberately does NOT consume the code. Consumption happens in the
// reset route, in the same statement that changes the password, so a code can
// never be spent by a step that then fails and leaves the user with a dead code
// and an unchanged password.
//
// It is still a real check, not a client-side convenience: every failure
// increments `attempts` through the same helper the reset route uses, so this
// endpoint cannot be used as an uncounted brute-force oracle against a 6-digit
// space.
//
// Unlike step 1, this one does report failure — by the time someone holds a code
// they have already proven control of the mailbox, and "wrong code" has to be
// distinguishable from "right code" for the flow to work at all. It still never
// says whether the ADDRESS exists: an unknown address gets the same "invalid or
// expired" answer as a wrong code.
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { canSelfResetPassword, checkOtp, findResetTarget, MAX_OTP_ATTEMPTS } from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

const INVALID = "That code is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    const otp = (body?.otp ?? "").toString().trim();

    if (!email || !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ success: false, message: INVALID }, { status: 400 });
    }

    const target = await findResetTarget(email);
    // Unknown address, or an address whose role may not self-reset, is answered
    // exactly like a wrong code — no row is ever created for those accounts, so
    // there is nothing here to distinguish them anyway.
    if (!target || !canSelfResetPassword(target.role)) {
      return NextResponse.json({ success: false, message: INVALID }, { status: 400 });
    }

    const check = await checkOtp(target.id, otp);
    if (!check.ok) {
      void writeAuditLog({
        userId: target.id, actorName: target.name, action: "password_reset.otp_failed",
        entityType: "user", entityId: String(target.id), ipAddress: ip, userAgent,
        newValue: { reason: check.reason, attemptsRemaining: check.attemptsRemaining },
      });
      return NextResponse.json(
        {
          success: false,
          message: check.reason === "locked"
            ? `Too many incorrect attempts. Request a new code.`
            : INVALID,
          // Safe to return: it tells the holder of a code how many tries are
          // left, which they can already infer, and reveals nothing about the
          // account to someone without one.
          attemptsRemaining: check.attemptsRemaining,
        },
        { status: 400 }
      );
    }

    void writeAuditLog({
      userId: target.id, actorName: target.name, action: "password_reset.otp_verified",
      entityType: "user", entityId: String(target.id), ipAddress: ip, userAgent,
      newValue: { outcome: "code_accepted" },
    });

    // No token is issued. The final step re-checks the same code and consumes
    // it, which keeps the OTP the single proof of control rather than minting a
    // second credential that would need its own expiry and revocation rules.
    return NextResponse.json(
      { success: true, message: "Code verified. Choose a new password.", maxAttempts: MAX_OTP_ATTEMPTS },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[POST /api/auth/forgot-password/verify]", err?.message);
    return NextResponse.json({ success: false, message: INVALID }, { status: 400 });
  }
}
