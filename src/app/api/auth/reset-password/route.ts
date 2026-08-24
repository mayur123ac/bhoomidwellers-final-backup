// api/auth/reset-password/route.ts — step 3: set the new password.
//
// ── Which account is changed ────────────────────────────────────────────────
// The one that owns the code. The body carries an email, but that address only
// selects which OTP row to check — it grants nothing on its own, and no role,
// user id or organization_id is read from the request. The UPDATE targets the
// id on the OTP row, and re-asserts that the account is still permitted to
// self-reset.
//
// ── Single use ──────────────────────────────────────────────────────────────
// The code is consumed in the same transaction that writes the new hash, and
// only on success. A failed password validation leaves the code live so the user
// can try again; a successful reset kills it, so replaying the same code does
// nothing.
//
// ── Sessions ────────────────────────────────────────────────────────────────
// `password_changed_at` is stamped alongside the new hash, which is what
// requireSession() compares each cookie's `iat` against. Committing this revokes
// every session the account had, on every device.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import {
  canSelfResetPassword, checkOtp, findResetTarget, RESET_PURPOSE, sessionRevocationNow,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

const INVALID = "That code is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    const otp = (body?.otp ?? "").toString().trim();
    const newPassword = (body?.newPassword ?? "").toString();
    const confirmPassword = (body?.confirmPassword ?? "").toString();

    if (!email || !/^\d{6}$/.test(otp)) return bad(INVALID);

    // Password shape is checked BEFORE the code, so a rejected password does not
    // burn an attempt or consume the code.
    if (!newPassword) return bad("A new password is required.");
    if (newPassword !== confirmPassword) return bad("Passwords do not match.");
    if (!passwordMeetsRules(newPassword)) {
      return bad("Password must be at least 8 characters and include upper case, lower case, a number and a symbol.");
    }

    const target = await findResetTarget(email);
    if (!target || !canSelfResetPassword(target.role)) return bad(INVALID);

    const check = await checkOtp(target.id, otp);
    if (!check.ok) {
      void writeAuditLog({
        userId: target.id, actorName: target.name, action: "password_reset.otp_failed",
        entityType: "user", entityId: String(target.id), ipAddress: ip, userAgent,
        newValue: { reason: check.reason, stage: "reset" },
      });
      return bad(
        check.reason === "locked" ? "Too many incorrect attempts. Request a new code." : INVALID
      );
    }

    // Hashed outside the transaction: scrypt at N=65536 takes real time and
    // holding a pooled connection through it would be a slow transaction for
    // nothing.
    const hashed = await hashPassword(newPassword);

    const updated = await transaction(async client => {
      // Consume the exact row that was verified, and only if it is still
      // unconsumed — so two requests racing the same code cannot both win.
      const consumed = await client.query(
        `UPDATE email_change_otps
            SET consumed_at = now()
          WHERE id = $1 AND consumed_at IS NULL AND purpose = $2
        RETURNING id`,
        [check.row.id, RESET_PURPOSE]
      );
      if (consumed.rows.length === 0) return null;

      // password_changed_at is what revokes existing sessions. Stamped from the
      // APPLICATION clock, matching the `iat` on the cookie the user's next
      // sign-in will carry — see sessionRevocationNow() in lib/passwordReset.ts
      // for why SQL now() locked people out of the account they had just reset.
      const res = await client.query(
        `UPDATE users
            SET password = $2,
                password_changed_at = $3,
                updated_at = now()
          WHERE id = $1
            AND deleted_at IS NULL
            AND is_active = true
        RETURNING id, email, role`,
        [check.row.user_id, hashed, sessionRevocationNow()]
      );
      return res.rows[0] ?? null;
    });

    if (!updated) return bad(INVALID);

    void writeAuditLog({
      userId: updated.id, actorName: target.name, action: "password_reset.completed",
      entityType: "user", entityId: String(updated.id), ipAddress: ip, userAgent,
      // Outcome only. No password, no hash, no code.
      newValue: { outcome: "password_changed", sessionsRevoked: true },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Password updated. All sessions have been signed out — please sign in again.",
        data: { sessionsRevoked: true },
      },
      { status: 200 }
    );
  } catch (err: any) {
    // Generic to the caller; detail to the server log, which never receives the
    // password or the code.
    console.error("[POST /api/auth/reset-password]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not reset the password." },
      { status: 500 }
    );
  }
}
