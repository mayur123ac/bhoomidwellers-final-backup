// api/settings/password/verify-current/route.ts — Case A Step 1.
//
// Verifies the user's current password server-side. If correct, generates
// an OTP (purpose = self_password_change), sends it to users.email, and
// returns success. If wrong, rejects without generating any OTP.
//
// The current password is NEVER trusted from the frontend alone. It is
// verified against the stored hash (scrypt or legacy plaintext) using
// verifyPassword(), which handles both formats with constant-time comparison.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { verifyPassword } from "@/lib/passwords";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import {
  SELF_PW_CHANGE_PURPOSE,
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
    const body = await req.json().catch(() => ({}));
    const currentPassword = (body?.currentPassword ?? "").toString();

    if (!currentPassword) {
      return NextResponse.json(
        { success: false, message: "Current password is required." },
        { status: 400 }
      );
    }

    // ── Load user ────────────────────────────────────────────────────────────
    const rows = await query<{
      password: string | null;
      email: string;
      name: string;
    }>(
      `SELECT password, email, name
         FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    const { password: stored, email, name } = rows[0];

    // ── Verify current password ──────────────────────────────────────────────
    const ok = await verifyPassword(currentPassword, stored);
    if (!ok) {
      void writeAuditLog({
        userId,
        actorName: name,
        action: "self_password_change.current_password_failed",
        entityType: "user",
        entityId: String(userId),
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        { success: false, message: "Current password is incorrect." },
        { status: 403 }
      );
    }

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
    const rate = await checkRateLimitForPurpose(userId, SELF_PW_CHANGE_PURPOSE);
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
      [userId, SELF_PW_CHANGE_PURPOSE]
    );

    // ── Generate, hash, store ────────────────────────────────────────────────
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO email_change_otps
         (user_id, new_email, sent_to, otp_hash, expires_at, purpose, organization_id)
       VALUES ($1, $2, $2, $3, $4, $5,
               (SELECT organization_id FROM users WHERE id = $1))`,
      [userId, email, hashOtp(otp), expiresAt, SELF_PW_CHANGE_PURPOSE]
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
        [userId, SELF_PW_CHANGE_PURPOSE]
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
      action: "self_password_change.otp_requested",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { sentTo: email, expiresInMinutes: RESET_OTP_TTL_MINUTES },
    });

    return NextResponse.json({
      success: true,
      message: `A verification code has been sent to your email (${email}). It expires in ${RESET_OTP_TTL_MINUTES} minutes.`,
      mailDelivered: true,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/password/verify-current]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not process your request." },
      { status: 500 }
    );
  }
}
