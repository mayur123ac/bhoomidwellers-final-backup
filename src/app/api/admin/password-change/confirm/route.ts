// api/admin/password-change/confirm/route.ts
//
// Step 2 of the admin-initiated employee password-change flow.
//
// ── Security properties ──────────────────────────────────────────────────────
// 1. The OTP must match the one sent to the admin's inbox (5-attempt cap,
//    10-minute TTL, consumed in the same transaction as the password write).
// 2. The OTP row encodes the target user id in `new_email`. We verify it
//    matches the request's targetUserId — a code issued for employee A cannot
//    be replayed to change employee B's password.
// 3. The target must still be in the same org, active, and not deleted.
// 4. The new password is hashed with scrypt before it ever reaches the DB.
// 5. password_changed_at is stamped from the application clock (not SQL now())
//    so that all of the target's active sessions are revoked on the next
//    request they make. See sessionRevocationNow() in lib/passwordReset.ts.
// 6. The audit log records actor, target, outcome — no password, no hash.
import { NextRequest, NextResponse } from "next/server";
import { transaction, query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import {
  ADMIN_PW_CHANGE_PURPOSE,
  checkOtpForPurpose,
  sessionRevocationNow,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

const INVALID = "That code is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const admin = gate.session;
  const adminId = gate.userId!;

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = Number(body?.targetUserId);
    const otp = (body?.otp ?? "").toString().trim();
    const newPassword = (body?.newPassword ?? "").toString();

    if (!Number.isFinite(targetUserId) || targetUserId <= 0) return bad(INVALID);
    if (!/^\d{6}$/.test(otp)) return bad(INVALID);
    if (!newPassword) return bad("A new password is required.");
    if (!passwordMeetsRules(newPassword)) {
      return bad(
        "Password must be at least 8 characters and include upper case, lower case, a number and a symbol."
      );
    }

    if (adminId === targetUserId) {
      return bad("Use Account & Security to change your own password.");
    }

    // Validate OTP against the admin's live code for this purpose.
    // checkOtpForPurpose increments the attempt counter on every mismatch,
    // so neither this route nor the verify route can be used as an uncounted
    // brute-force oracle.
    const check = await checkOtpForPurpose(adminId, otp, ADMIN_PW_CHANGE_PURPOSE);
    if (!check.ok) {
      void writeAuditLog({
        userId: adminId,
        actorName: admin.name,
        action: "admin_password_change.otp_failed",
        entityType: "user",
        entityId: String(targetUserId),
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

    // Verify the OTP was issued for exactly the target the caller claims.
    // Without this, a valid code for employee A could be replayed to change
    // employee B's password — same admin session, same purpose, different target.
    const expectedMarker = `admin_pw_change:${targetUserId}`;
    if (check.row.new_email !== expectedMarker) {
      // Mismatch — do not burn another attempt (the code itself was correct),
      // just refuse.
      return bad(INVALID);
    }

    // Verify the target is still in this org, active, and not deleted.
    const orgId = await getOrganizationId();
    const targets = await query<{ name: string }>(
      `SELECT name FROM users
        WHERE id = $1
          AND organization_id = $2
          AND is_active = true
          AND deleted_at IS NULL
        LIMIT 1`,
      [targetUserId, orgId]
    );
    if (targets.length === 0) return bad("Employee not found.", 404);
    const targetName = targets[0].name;

    // Hash outside the transaction — scrypt at N=65536 takes ~100ms and
    // holding a pooled connection through it would be a long idle transaction.
    const hashed = await hashPassword(newPassword);

    const updated = await transaction(async client => {
      // Consume the OTP in the same transaction as the password write.
      // If two requests race the same code, only one wins; the other gets
      // 0 rows back and the handler returns INVALID.
      const consumed = await client.query(
        `UPDATE email_change_otps
            SET consumed_at = now()
          WHERE id = $1
            AND consumed_at IS NULL
            AND purpose = $2
          RETURNING id`,
        [check.row.id, ADMIN_PW_CHANGE_PURPOSE]
      );
      if (consumed.rows.length === 0) return null;

      // Stamp password_changed_at from the APPLICATION clock. This is what
      // requireSession() compares each cookie's iat against — see
      // sessionRevocationNow() for why SQL now() would lock the account on
      // the immediate re-login that follows being signed out.
      const res = await client.query(
        `UPDATE users
            SET password = $2,
                password_changed_at = $3,
                updated_at = now()
          WHERE id = $1
            AND organization_id = $4
            AND deleted_at IS NULL
            AND is_active = true
          RETURNING id`,
        [targetUserId, hashed, sessionRevocationNow(), orgId]
      );
      return res.rows[0] ?? null;
    });

    if (!updated) return bad(INVALID);

    void writeAuditLog({
      userId: adminId,
      actorName: admin.name,
      action: "admin_password_change.completed",
      entityType: "user",
      entityId: String(targetUserId),
      ipAddress: ip,
      userAgent,
      // Outcome only. No password, no hash.
      newValue: { targetName, outcome: "password_changed", sessionsRevoked: true },
    });

    return NextResponse.json({
      success: true,
      message: `Password changed for ${targetName}. Their active sessions have been signed out.`,
    });

  } catch (err: any) {
    console.error("[POST /api/admin/password-change/confirm]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not change the password." },
      { status: 500 }
    );
  }
}
