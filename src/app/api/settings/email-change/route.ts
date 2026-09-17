// api/settings/email-change/route.ts — initiate a primary-email change.
//
// Stages the new address in users.secondary_email, generates a hashed OTP in
// email_change_otps (purpose = 'email_change'), and sends the plaintext to the
// NEW address via EmailService. The OTP is NEVER returned in the response.
//
// Uses the same hardened OTP infrastructure as forgot-password:
//   - generateOtp() / hashOtp() from lib/passwordReset.ts
//   - checkRateLimitForPurpose() for resend throttling
//   - email_change_otps table with attempt counting, expiry, consumed_at
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import {
  EMAIL_CHANGE_PURPOSE,
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
    const newEmail = ((body?.newEmail ?? "") as string).trim().toLowerCase();

    if (!newEmail) {
      return NextResponse.json(
        { success: false, message: "New email is required." },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return NextResponse.json(
        { success: false, message: "Invalid email address." },
        { status: 400 }
      );
    }

    // ── Check uniqueness ───────────────────────────────────────────────────
    const existing = await query<{ id: number }>(
      `SELECT id FROM users
        WHERE LOWER(email) = LOWER($1) AND id != $2 AND deleted_at IS NULL
        LIMIT 1`,
      [newEmail, userId]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, message: "This email is already in use." },
        { status: 409 }
      );
    }

    // ── Pre-flight: require a working mail transport ────────────────────────
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

    // ── Rate limit ─────────────────────────────────────────────────────────
    const rate = await checkRateLimitForPurpose(userId, EMAIL_CHANGE_PURPOSE);
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

    // ── Stage the new address ──────────────────────────────────────────────
    await query(
      `UPDATE users SET secondary_email = $1, secondary_email_verified = false WHERE id = $2`,
      [newEmail, userId]
    );

    // ── Supersede any live code for this user + purpose ─────────────────────
    await query(
      `UPDATE email_change_otps SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, EMAIL_CHANGE_PURPOSE]
    );

    // ── Generate, hash, store ──────────────────────────────────────────────
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO email_change_otps
         (user_id, new_email, sent_to, otp_hash, expires_at, purpose, organization_id)
       VALUES ($1, $2, $2, $3, $4, $5,
               (SELECT organization_id FROM users WHERE id = $1))`,
      [userId, newEmail, hashOtp(otp), expiresAt, EMAIL_CHANGE_PURPOSE]
    );

    // ── Send the email to the NEW address ──────────────────────────────────
    const userName = gate.session.name || "there";
    const firstName = userName.trim().split(/\s+/)[0];
    const sendResult = await EmailService.sendOTP(
      newEmail,
      {
        name: firstName,
        code: otp,
        purpose: "Email address change",
        expiryMinutes: RESET_OTP_TTL_MINUTES,
      },
      { userId, ip, userAgent }
    );

    if (!sendResult.delivered) {
      await query(
        `UPDATE email_change_otps SET consumed_at = now()
          WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [userId, EMAIL_CHANGE_PURPOSE]
      );
      return NextResponse.json(
        {
          success: false,
          message:
            "The verification code could not be delivered to the new email address. " +
            "Please check the address and try again.",
        },
        { status: 503 }
      );
    }

    void writeAuditLog({
      userId,
      actorName: gate.session.name,
      action: "email_change.otp_requested",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { newEmail, expiresInMinutes: RESET_OTP_TTL_MINUTES },
    });

    return NextResponse.json({
      success: true,
      message: `A verification code has been sent to ${newEmail}. It expires in ${RESET_OTP_TTL_MINUTES} minutes.`,
      mailDelivered: true,
      resendAfterSeconds: 60,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/email-change]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not initiate email change." },
      { status: 500 }
    );
  }
}
