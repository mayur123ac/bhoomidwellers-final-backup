// app/api/settings/self-password-change/request-otp/route.ts
//
// Step 1 of the employee self-service OTP password-change flow.
//
// Any authenticated user whose `can_change_password` permission is true can
// call this route to receive a 6-digit OTP at their configured delivery
// address(es). They then supply it to the confirm route along with the new
// password.
//
// This is distinct from the Account & Security "Change password" route
// (app/api/settings/password/route.ts) which requires the CURRENT password
// rather than an OTP. Both paths check the `can_change_password` permission
// and are therefore gated by the same admin toggle.
//
// ── What is stored ───────────────────────────────────────────────────────────
// user_id   = the authenticated user (the actor and the target are the same)
// new_email = "self_pw_change" — distinguishes this purpose from email-change
//             and admin-initiated flows that reuse the same table
// sent_to   = the primary delivery address
// purpose   = SELF_PW_CHANGE_PURPOSE
//
// The plaintext OTP is never stored. Only the SHA-256 hash lands in the row.

import { NextRequest, NextResponse } from "next/server";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import { getPreferences, resolveRecipients } from "@/lib/emailRouting";
import { query } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import {
  RESET_OTP_TTL_MINUTES,
  checkRateLimitForPurpose,
  generateOtp,
  hashOtp,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

export const SELF_PW_CHANGE_PURPOSE = "self_pw_change";

export async function POST(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId!;
  const session = gate.session;

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  // Permission check — server-side, not a client hint.
  const allowed = await hasPermission(userId, "can_change_password");
  if (!allowed) {
    return bad(
      "Password changes are disabled for your account. Contact your administrator.",
      403
    );
  }

  if (!isMailConfigured()) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Email is not configured on this server. " +
          "Contact your administrator to set up SMTP, then try again.",
      },
      { status: 503 }
    );
  }

  // Fetch delivery addresses fresh from the DB — the session cookie is a
  // signed-at-login snapshot and may not reflect a later email-address change.
  const prefs = await getPreferences(userId);
  const resolution = prefs
    ? resolveRecipients(prefs)
    : { addresses: [], recipients: [], notes: [] };

  const deliveryAddresses = resolution.addresses;

  if (deliveryAddresses.length === 0) {
    return bad(
      "No verified email address is configured for your account. " +
        "Please update your email settings before changing your password."
    );
  }

  const primaryAddress = deliveryAddresses[0];

  const orgId = await getOrganizationId();

  // Rate limit per user per purpose.
  const rate = await checkRateLimitForPurpose(userId, SELF_PW_CHANGE_PURPOSE);
  if (!rate.ok) {
    return bad(
      rate.reason === "cooldown"
        ? `Please wait ${rate.retryAfterSeconds} second(s) before requesting another code.`
        : "Too many requests. Please try again in an hour."
    );
  }

  // Supersede any live code for this user + purpose.
  await query(
    `UPDATE email_change_otps
        SET consumed_at = now()
      WHERE user_id = $1
        AND purpose = $2
        AND consumed_at IS NULL`,
    [userId, SELF_PW_CHANGE_PURPOSE]
  );

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO email_change_otps
       (user_id, new_email, sent_to, otp_hash, expires_at, purpose, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      SELF_PW_CHANGE_PURPOSE,
      primaryAddress,
      hashOtp(otp),
      expiresAt,
      SELF_PW_CHANGE_PURPOSE,
      orgId,
    ]
  );

  const firstName = (session.name ?? "").trim().split(/\s+/)[0] || "there";

  const sendResults = await Promise.all(
    deliveryAddresses.map(async (to) => {
      try {
        return await EmailService.sendOTP(
          to,
          {
            name: firstName,
            code: otp,
            purpose: "Password change",
            expiryMinutes: RESET_OTP_TTL_MINUTES,
          },
          { userId, ip, userAgent }
        );
      } catch {
        return { delivered: false, provider: "error" };
      }
    })
  );

  const deliveredTo = deliveryAddresses.filter((_, i) => sendResults[i].delivered);

  if (deliveredTo.length === 0) {
    // Consume the row so the code cannot be redeemed if obtained out-of-band.
    await query(
      `UPDATE email_change_otps
          SET consumed_at = now()
        WHERE user_id = $1
          AND purpose = $2
          AND consumed_at IS NULL`,
      [userId, SELF_PW_CHANGE_PURPOSE]
    );

    void writeAuditLog({
      userId,
      actorName: session.name,
      action: "self_password_change.otp_delivery_failed",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { attemptedAddresses: deliveryAddresses.length },
    });

    return NextResponse.json(
      {
        success: false,
        message:
          "The verification code could not be delivered to your email address(es). " +
          "Please check your email configuration or contact support.",
      },
      { status: 503 }
    );
  }

  void writeAuditLog({
    userId,
    actorName: session.name,
    action: "self_password_change.otp_requested",
    entityType: "user",
    entityId: String(userId),
    ipAddress: ip,
    userAgent,
    newValue: {
      deliveredCount: deliveredTo.length,
      totalAddresses: deliveryAddresses.length,
      expiresInMinutes: RESET_OTP_TTL_MINUTES,
    },
  });

  const desc =
    deliveredTo.length > 1
      ? `your email addresses`
      : `your email (${primaryAddress})`;

  return NextResponse.json({
    success: true,
    message: `A verification code has been sent to ${desc}. It expires in ${RESET_OTP_TTL_MINUTES} minutes.`,
  });
}
