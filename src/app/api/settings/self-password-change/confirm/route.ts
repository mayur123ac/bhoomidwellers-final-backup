// api/settings/self-password-change/confirm/route.ts
//
// Verifies the OTP issued by the request-otp route and changes the user's
// password. Uses the same hardened infrastructure as forgot-password:
//
//   - checkOtpForPurpose() verifies the hash and increments the attempt counter
//   - consumption and password write happen in a single transaction
//   - sessionRevocationNow() stamps from the application clock
//   - hashPassword() uses scrypt (N=65536)
//
// The OTP is never returned, never logged, never bypassed.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { transaction } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import {
  SELF_PW_CHANGE_PURPOSE,
  checkOtpForPurpose,
  sessionRevocationNow,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

const INVALID = "That code is invalid or has expired. Request a new one.";

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

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const otp = (body?.otp ?? "").toString().trim();
    const newPassword = (body?.newPassword ?? "").toString();

    if (!/^\d{6}$/.test(otp)) return bad(INVALID);
    if (!newPassword) return bad("A new password is required.");
    if (!passwordMeetsRules(newPassword)) {
      return bad(
        "Password must be at least 8 characters and include upper case, lower case, a number and a symbol."
      );
    }

    // ── Verify OTP (attempt-counted, expiry-checked, hash-compared) ────────
    const check = await checkOtpForPurpose(userId, otp, SELF_PW_CHANGE_PURPOSE);
    if (!check.ok) {
      void writeAuditLog({
        userId,
        actorName: gate.session.name,
        action: "self_password_change.otp_failed",
        entityType: "user",
        entityId: String(userId),
        ipAddress: ip,
        userAgent,
        newValue: { reason: check.reason, attemptsRemaining: check.attemptsRemaining },
      });
      return bad(
        check.reason === "locked"
          ? "Too many incorrect attempts. Request a new code."
          : INVALID
      );
    }

    // ── Hash outside the transaction (scrypt is ~100ms) ────────────────────
    const hashed = await hashPassword(newPassword);

    // ── Atomic: consume OTP + write new password in one transaction ────────
    const updated = await transaction(async client => {
      const consumed = await client.query(
        `UPDATE email_change_otps
            SET consumed_at = now()
          WHERE id = $1 AND consumed_at IS NULL AND purpose = $2
        RETURNING id`,
        [check.row.id, SELF_PW_CHANGE_PURPOSE]
      );
      if (consumed.rows.length === 0) return null;

      const res = await client.query(
        `UPDATE users
            SET password = $2,
                password_changed_at = $3,
                sessions_revoked_at = $3,
                updated_at = now()
          WHERE id = $1
            AND deleted_at IS NULL
        RETURNING id`,
        [userId, hashed, sessionRevocationNow()]
      );
      return res.rows[0] ?? null;
    });

    if (!updated) return bad(INVALID);

    void writeAuditLog({
      userId,
      actorName: gate.session.name,
      action: "self_password_change.completed",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { outcome: "password_changed", sessionsRevoked: true },
    });

    return NextResponse.json({
      success: true,
      message: "Password changed. You will be signed out.",
      reauthRequired: true,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/self-password-change/confirm]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not change the password." },
      { status: 500 }
    );
  }
}
