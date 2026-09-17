// api/settings/password/change/route.ts — Case A Step 3 / Case B Step 3.
//
// Changes the user's password. Requires a valid, unexpired, unconsumed
// password-change authorization token. The token is consumed atomically
// with the password write and session revocation.
//
// After success, sends a security notification email.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { passwordMeetsRules } from "@/lib/passwords";
import { EmailService } from "@/lib/email/EmailService";
import {
  SELF_PW_CHANGE_PURPOSE,
  SELF_PW_RECOVERY_PURPOSE,
} from "@/lib/passwordReset";
import {
  checkPasswordChangeAuth,
  consumeAuthAndChangePassword,
} from "@/lib/passwordChangeAuth";

export const dynamic = "force-dynamic";

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

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const authToken = (body?.authToken ?? "").toString().trim();
    const newPassword = (body?.newPassword ?? "").toString();
    const confirmPassword = (body?.confirmPassword ?? "").toString();
    const purpose = (body?.purpose ?? SELF_PW_CHANGE_PURPOSE).toString();

    if (!authToken) return bad("Authorization token is required.");
    if (!newPassword) return bad("A new password is required.");
    if (newPassword !== confirmPassword) return bad("Passwords do not match.");
    if (!VALID_PURPOSES.includes(purpose as any)) return bad("Invalid purpose.");
    if (!passwordMeetsRules(newPassword)) {
      return bad(
        "Password must be at least 8 characters and include upper case, lower case, a number and a symbol."
      );
    }

    // ── Verify authorization ─────────────────────────────────────────────────
    const authCheck = await checkPasswordChangeAuth(userId, authToken, purpose);
    if (!authCheck.ok) {
      void writeAuditLog({
        userId,
        actorName: gate.session.name,
        action: "self_password_change.auth_failed",
        entityType: "user",
        entityId: String(userId),
        ipAddress: ip,
        userAgent,
        newValue: { reason: authCheck.reason, purpose },
      });
      return bad(
        authCheck.reason === "expired"
          ? "Your authorization has expired. Please start over."
          : authCheck.reason === "consumed"
            ? "This authorization has already been used."
            : "Invalid authorization. Please start over.",
        400
      );
    }

    // ── Atomic: consume auth + change password + revoke sessions ─────────────
    const success = await consumeAuthAndChangePassword(
      authCheck.row.id,
      userId,
      purpose,
      newPassword
    );

    if (!success) {
      return bad("Could not change the password. The authorization may have been used by another request.");
    }

    // ── Audit ────────────────────────────────────────────────────────────────
    const isRecovery = purpose === SELF_PW_RECOVERY_PURPOSE;
    void writeAuditLog({
      userId,
      actorName: gate.session.name,
      action: isRecovery
        ? "self_password_recovery.completed"
        : "self_password_change.completed",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      userAgent,
      newValue: { outcome: "password_changed", sessionsRevoked: true, method: isRecovery ? "recovery" : "change" },
    });

    // ── Security notification email ──────────────────────────────────────────
    // Fire-and-forget. A failed notification must NOT roll back a successful
    // password change — the password is already updated and sessions revoked.
    void EmailService.sendPasswordChanged(
      userId,
      {
        name: gate.session.name || "User",
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        ipAddress: ip || "Unknown",
        device: userAgent || null,
      },
      { userId, ip, userAgent }
    ).catch((err) => {
      console.error("[password-change] notification email failed:", err?.message);
    });

    return NextResponse.json({
      success: true,
      message: isRecovery
        ? "Password changed via recovery. You will be signed out."
        : "Password changed. You will be signed out.",
      reauthRequired: true,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/password/change]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not change the password." },
      { status: 500 }
    );
  }
}
