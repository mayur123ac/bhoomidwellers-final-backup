// api/settings/email-verify/route.ts — verify the email-change OTP.
//
// Uses the hardened OTP infrastructure: checkOtpForPurpose() for hash
// comparison with attempt counting, and atomic consumption in a transaction
// that also promotes the email. No bypass, no fallback, fail-closed.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { transaction, query } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import {
  EMAIL_CHANGE_PURPOSE,
  checkOtpForPurpose,
  MAX_OTP_ATTEMPTS,
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

  const bad = (message: string, status = 400, extra?: Record<string, unknown>) =>
    NextResponse.json({ success: false, message, ...extra }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const otp = (body?.otp ?? body?.code ?? "").toString().trim();

    if (!/^\d{6}$/.test(otp)) return bad(INVALID);

    // ── Verify OTP (attempt-counted, expiry-checked, hash-compared) ────────
    const check = await checkOtpForPurpose(userId, otp, EMAIL_CHANGE_PURPOSE);
    if (!check.ok) {
      void writeAuditLog({
        userId,
        actorName: gate.session.name,
        action: "email_change.otp_failed",
        entityType: "user",
        entityId: String(userId),
        ipAddress: ip,
        userAgent,
        newValue: { reason: check.reason, attemptsRemaining: check.attemptsRemaining },
      });

      const restart = check.reason === "locked" || check.reason === "expired" || check.reason === "none";
      return bad(
        check.reason === "locked"
          ? "Too many incorrect attempts. Request a new code."
          : INVALID,
        400,
        { attemptsRemaining: check.attemptsRemaining, restart }
      );
    }

    // The new_email column on the OTP row holds the address that was verified.
    const newEmail = check.row.new_email;
    if (!newEmail) return bad(INVALID);

    // ── Atomic: consume OTP + promote email in one transaction ──────────────
    const updated = await transaction(async client => {
      const consumed = await client.query(
        `UPDATE email_change_otps
            SET consumed_at = now()
          WHERE id = $1 AND consumed_at IS NULL AND purpose = $2
        RETURNING id`,
        [check.row.id, EMAIL_CHANGE_PURPOSE]
      );
      if (consumed.rows.length === 0) return null;

      const res = await client.query(
        `UPDATE users
            SET email = $2,
                secondary_email_verified = true,
                last_email_change_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
            AND deleted_at IS NULL
        RETURNING id, email, secondary_email, secondary_email_verified`,
        [userId, newEmail]
      );
      return res.rows[0] ?? null;
    });

    if (!updated) return bad(INVALID);

    void writeAuditLog({
      userId,
      actorName: gate.session.name,
      action: "email_change.completed",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { newEmail, outcome: "email_changed" },
    });

    return NextResponse.json({
      success: true,
      message: "Email verified successfully.",
      user: updated,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/email-verify]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not verify the email." },
      { status: 500 }
    );
  }
}
