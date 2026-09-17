// api/settings/password/recover/route.ts — Case B Step 1.
//
// "Forgot current password?" for a logged-in user. Sends a recovery OTP
// to the user's canonical email (users.email) using a separate purpose
// (self_password_recovery) so it cannot cross-authorize a Case A flow.
//
// The user's identity comes from the authenticated session — the client
// cannot substitute another user's email or user_id.
//
// A session alone is NOT sufficient to change the password. The user must
// also prove control of their registered email via the OTP.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import {
  SELF_PW_RECOVERY_PURPOSE,
  RESET_OTP_TTL_MINUTES,
  checkRateLimitForPurpose,
  generateOtp,
  hashOtp,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  const { ip, userAgent } = requestContext(req);

  try {
    // ── Load user from session (NOT from request body) ───────────────────────
    const rows = await query<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    const { email, name } = rows[0];

    // ── Pre-flight: require mail transport ────────────────────────────────────
    if (!isMailConfigured()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Email is not configured on this server. " +
            "The verification code cannot be delivered. Please contact your administrator.",
        },
        { status: 503 }
      );
    }

    // ── Rate limit ───────────────────────────────────────────────────────────
    const rate = await checkRateLimitForPurpose(userId, SELF_PW_RECOVERY_PURPOSE);
    if (!rate.ok) {
      return NextResponse.json(
        {
          success: false,
          message:
            rate.reason === "cooldown"
              ? `Please wait ${rate.retryAfterSeconds} second(s) before requesting another code.`
              : "Too many requests. Please try again in an hour.",
          retryAfter: rate.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // ── Supersede existing codes ─────────────────────────────────────────────
    await query(
      `UPDATE email_change_otps SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, SELF_PW_RECOVERY_PURPOSE]
    );

    // ── Generate, hash, store ────────────────────────────────────────────────
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO email_change_otps
         (user_id, new_email, sent_to, otp_hash, expires_at, purpose, organization_id)
       VALUES ($1, $2, $2, $3, $4, $5,
               (SELECT organization_id FROM users WHERE id = $1))`,
      [userId, email, hashOtp(otp), expiresAt, SELF_PW_RECOVERY_PURPOSE]
    );

    // ── Send the email ───────────────────────────────────────────────────────
    const firstName = (name || "").trim().split(/\s+/)[0] || "there";
    const sendResult = await EmailService.sendOTP(
      email,
      {
        name: firstName,
        code: otp,
        purpose: "change your password",
        expiryMinutes: RESET_OTP_TTL_MINUTES,
      },
      { userId, ip, userAgent }
    );

    if (!sendResult.delivered) {
      await query(
        `UPDATE email_change_otps SET consumed_at = now()
          WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [userId, SELF_PW_RECOVERY_PURPOSE]
      );
      return NextResponse.json(
        {
          success: false,
          message: "The verification code could not be delivered. Please try again later.",
        },
        { status: 503 }
      );
    }

    void writeAuditLog({
      userId,
      actorName: name,
      action: "self_password_recovery.otp_requested",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { sentTo: email, expiresInMinutes: RESET_OTP_TTL_MINUTES },
    });

    return NextResponse.json({
      success: true,
      message: `A recovery code has been sent to your email (${email}). It expires in ${RESET_OTP_TTL_MINUTES} minutes.`,
      mailDelivered: true,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/password/recover]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not send recovery code." },
      { status: 500 }
    );
  }
}
