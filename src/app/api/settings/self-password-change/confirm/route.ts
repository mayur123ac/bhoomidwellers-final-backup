// app/api/settings/self-password-change/confirm/route.ts
//
// Step 2 of the employee self-service OTP password-change flow.
//
// The caller must supply the 6-digit code sent by the request-otp route plus
// the desired new password. The OTP is consumed atomically with the password
// write so that two concurrent requests cannot both succeed on the same code.
//
// ── Security properties ──────────────────────────────────────────────────────
// 1. `can_change_password` permission is re-checked — it must be true at
//    confirm time as well, so revoking the permission mid-flow takes effect.
// 2. OTP: 5-attempt cap, 10-minute TTL, consumed in the same transaction as
//    the password write.
// 3. New password is validated by passwordMeetsRules() before hashing.
// 4. password_changed_at is stamped from the application clock (not SQL now())
//    so that other active sessions are revoked on their next request.
// 5. The response sets MaxAge=0 on the session cookie, signing this browser out
//    and requiring a fresh login (the password just changed).
// 6. Audit log: actor, action, outcome. No password, no hash.

import { NextRequest, NextResponse } from "next/server";
import { transaction, query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import { hasPermission } from "@/lib/permissions";
import { EmailService } from "@/lib/email/EmailService";
import {
  checkOtpForPurpose,
  sessionRevocationNow,
} from "@/lib/passwordReset";
import { SELF_PW_CHANGE_PURPOSE } from "../request-otp/route";

export const dynamic = "force-dynamic";

const INVALID = "That code is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId!;
  const session = gate.session;

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  // Re-check permission at confirm time.
  const allowed = await hasPermission(userId, "can_change_password");
  if (!allowed) {
    return bad(
      "Password changes are disabled for your account. Contact your administrator.",
      403
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const otp = (body?.otp ?? "").toString().trim();
  const newPassword = (body?.newPassword ?? "").toString();

  if (!/^\d{6}$/.test(otp)) return bad(INVALID);
  if (!newPassword) return bad("A new password is required.");
  if (!passwordMeetsRules(newPassword)) {
    return bad(
      "Password must be at least 8 characters and include upper case, lower case, a number and a symbol."
    );
  }

  // Validate OTP.
  const check = await checkOtpForPurpose(userId, otp, SELF_PW_CHANGE_PURPOSE);
  if (!check.ok) {
    void writeAuditLog({
      userId,
      actorName: session.name,
      action: "self_password_change.otp_failed",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { reason: check.reason },
    });
    return bad(
      check.reason === "locked"
        ? "Too many incorrect attempts. Request a new code."
        : INVALID
    );
  }

  const orgId = await getOrganizationId();

  // Hash outside the transaction — scrypt at N=65536 takes ~100ms and holding a
  // pooled connection through it would be a long idle transaction.
  const hashed = await hashPassword(newPassword);

  const updated = await transaction(async (client) => {
    // Consume the OTP atomically with the password write.
    const consumed = await client.query(
      `UPDATE email_change_otps
          SET consumed_at = now()
        WHERE id = $1
          AND consumed_at IS NULL
          AND purpose = $2
        RETURNING id`,
      [check.row.id, SELF_PW_CHANGE_PURPOSE]
    );
    if (consumed.rows.length === 0) return null;

    const res = await client.query(
      `UPDATE users
          SET password            = $2,
              password_changed_at = $3,
              updated_at          = now()
        WHERE id = $1
          AND organization_id     = $4
          AND deleted_at IS NULL
          AND is_active = true
        RETURNING id, name, email`,
      [userId, hashed, sessionRevocationNow(), orgId]
    );
    return res.rows[0] ?? null;
  });

  if (!updated) return bad(INVALID);

  // Close active sessions for this user so the Active Sessions list reflects the change.
  await query(
    `UPDATE employee_sessions
        SET is_active = false, session_end = now(), session_end_reason = 'password_changed'
      WHERE user_id = $1 AND is_active = true AND organization_id = $2`,
    [userId, orgId]
  );

  // Best-effort: send a "password changed" confirmation email.
  void EmailService.sendPasswordChanged(
    userId,
    { name: session.name, timestamp: new Date().toISOString(), ipAddress: ip, device: userAgent },
    { userId, actorName: session.name, ip, userAgent }
  );

  void writeAuditLog({
    userId,
    actorName: session.name,
    action: "self_password_change.completed",
    entityType: "user",
    entityId: String(userId),
    ipAddress: ip,
    userAgent,
    newValue: { outcome: "password_changed", sessionsRevoked: true },
  });

  // Clear the session cookie — the caller must re-authenticate with the new password.
  const response = NextResponse.json({
    success: true,
    message: "Password changed. Please sign in again with your new password.",
    reauthRequired: true,
  });

  response.cookies.set({
    name: "crm_session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
