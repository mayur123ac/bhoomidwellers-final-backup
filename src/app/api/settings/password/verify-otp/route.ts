// api/settings/password/verify-otp/route.ts — Case A Step 2 / Case B Step 2.
//
// Verifies the OTP for either self_password_change (Case A) or
// self_password_recovery (Case B). On success, creates a short-lived
// password-change authorization token and returns it to the client.
//
// The OTP is consumed during this step. The authorization token is what
// permits the subsequent password write — not the OTP itself.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import {
  SELF_PW_CHANGE_PURPOSE,
  SELF_PW_RECOVERY_PURPOSE,
  checkOtpForPurpose,
} from "@/lib/passwordReset";
import { transaction } from "@/lib/db";
import {
  createPasswordChangeAuth,
  AUTH_TTL_MINUTES,
} from "@/lib/passwordChangeAuth";

export const dynamic = "force-dynamic";

const INVALID = "That code is invalid or has expired. Request a new one.";
const VALID_PURPOSES = [SELF_PW_CHANGE_PURPOSE, SELF_PW_RECOVERY_PURPOSE] as const;

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
    const otp = (body?.otp ?? "").toString().trim();
    const purpose = (body?.purpose ?? SELF_PW_CHANGE_PURPOSE).toString();

    if (!/^\d{6}$/.test(otp)) return bad(INVALID);
    if (!VALID_PURPOSES.includes(purpose as any)) return bad("Invalid purpose.");

    // ── Verify OTP ───────────────────────────────────────────────────────────
    const check = await checkOtpForPurpose(userId, otp, purpose);
    if (!check.ok) {
      void writeAuditLog({
        userId,
        actorName: gate.session.name,
        action: "self_password_change.otp_failed",
        entityType: "user",
        entityId: String(userId),
        ipAddress: ip,
        userAgent,
        newValue: { reason: check.reason, attemptsRemaining: check.attemptsRemaining, purpose },
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

    // ── Consume the OTP ──────────────────────────────────────────────────────
    await transaction(async (client) => {
      await client.query(
        `UPDATE email_change_otps
            SET consumed_at = now()
          WHERE id = $1 AND consumed_at IS NULL AND purpose = $2`,
        [check.row.id, purpose]
      );
    });

    // ── Create password-change authorization ─────────────────────────────────
    const orgId = gate.session.org ?? null;
    const authToken = await createPasswordChangeAuth(userId, purpose, orgId);

    void writeAuditLog({
      userId,
      actorName: gate.session.name,
      action: "self_password_change.otp_verified",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { purpose, authExpiresInMinutes: AUTH_TTL_MINUTES },
    });

    return NextResponse.json({
      success: true,
      message: "Code verified. You may now set a new password.",
      authToken,
      authExpiresInMinutes: AUTH_TTL_MINUTES,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/password/verify-otp]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not verify the code." },
      { status: 500 }
    );
  }
}
