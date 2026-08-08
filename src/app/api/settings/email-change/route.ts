// app/api/settings/email-change/route.ts — step 1 of the email change: send OTP.
//
// The OTP goes to the user's CURRENT address, not the new one, per spec. That is
// the security-relevant choice: it proves the person requesting the change
// controls the account as it stands today. (It does not prove they own the new
// address — a second confirmation to the new inbox would be the belt-and-braces
// version, and is noted as a follow-up rather than silently skipped.)
//
// The email column is not touched here. Nothing changes until the OTP is
// verified in ../email-verify.

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import { loadSettingsUser, splitName } from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

export function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const newEmail = String(body.newEmail ?? "").trim().toLowerCase();

  if (!EMAIL_RE.test(newEmail)) {
    return NextResponse.json(
      { success: false, message: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const user = await loadSettingsUser(gate.userId);
  if (!user) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  if (!user.email) {
    // Without a current address there is nowhere to send the proof-of-control
    // code, so this flow cannot run. An admin sets the first email.
    return NextResponse.json(
      {
        success: false,
        message: "Your account has no email address on file. Ask an admin to set one first.",
      },
      { status: 409 }
    );
  }

  if (newEmail === user.email.toLowerCase()) {
    return NextResponse.json(
      { success: false, message: "That is already your email address." },
      { status: 400 }
    );
  }

  const taken = await query<{ id: number }>(
    `SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1`,
    [newEmail, gate.userId]
  );
  if (taken.length > 0) {
    return NextResponse.json(
      { success: false, message: "Another account already uses that email address." },
      { status: 409 }
    );
  }

  // Resend cooldown, enforced server-side. The 60s countdown in the UI is a
  // nicety; without this check a scripted caller could spray the inbox.
  const recent = await query<{ created_at: string }>(
    `SELECT created_at FROM email_change_otps
      WHERE user_id = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [gate.userId]
  );
  if (recent.length > 0) {
    const elapsed = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return NextResponse.json(
        {
          success: false,
          message: `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting another code.`,
          retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed),
        },
        { status: 429 }
      );
    }
  }

  // Supersede any outstanding code, so a previously issued OTP cannot still be
  // used to complete a change to a DIFFERENT address than the one just requested.
  await query(
    `UPDATE email_change_otps SET consumed_at = NOW()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [gate.userId]
  );

  // randomInt is the CSPRNG; Math.random() is predictable and this is a
  // credential, however short-lived.
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await query(
    // `purpose` is explicit rather than relying on the column default, so that
    // this row can never be mistaken for an alternative-address verification by
    // /api/settings/notification-recipients/verify.
    `INSERT INTO email_change_otps (user_id, new_email, sent_to, otp_hash, expires_at, purpose)
     VALUES ($1, $2, $3, $4, $5, 'primary_change')`,
    [gate.userId, newEmail, user.email, hashOtp(otp), expiresAt]
  );

  const { firstName } = splitName(user.name);
  const { ip, userAgent } = requestContext(req);

  // Sent to the CURRENT address, not the new one: the point is to prove control
  // of the mailbox the account already has before it is moved. EmailService's
  // direct path, because routing this through notification preferences would
  // deliver it wherever alerts happen to go, which is not what is being proven.
  const mail = await EmailService.sendOTP(
    user.email,
    {
      name: firstName || "there",
      code: otp,
      expiryMinutes: OTP_TTL_MINUTES,
      purpose: `confirm changing your account email to ${newEmail}`,
      requestedFromIp: ip,
      requestedFromDevice: userAgent,
    },
    { userId: gate.userId, actorName: user.name, ip, userAgent }
  );

  await writeAuditLog({
    userId: gate.userId,
    actorName: user.name,
    action: "email.change.requested",
    entityType: "user",
    entityId: gate.userId,
    oldValue: user.email,
    newValue: newEmail,
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    sentTo: user.email,
    expiresInMinutes: OTP_TTL_MINUTES,
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    mailDelivered: mail.delivered,
    // No mail transport is configured (see lib/email/config.ts), so the code would be
    // unreachable and the flow untestable. It is returned only in that case, and
    // the UI labels it plainly as a stand-in for the email. Once SMTP is
    // configured isMailConfigured() flips and this field disappears.
    devOtp: isMailConfigured() ? undefined : otp,
    message: mail.delivered
      ? "Check your email for OTP"
      : "Email delivery is not configured on this server — use the code shown below.",
  });
}
