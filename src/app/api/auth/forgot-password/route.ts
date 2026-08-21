// api/auth/forgot-password/route.ts — step 1: request a reset code.
//
// ── Every path returns the same thing ───────────────────────────────────────
// Unknown address, employee address, rate-limited account, mail failure and
// successful send all produce an identical 200 with GENERIC_RESET_MESSAGE. The
// response cannot be used to test whether an address exists, or what role it
// holds — which is the whole point, since an attacker who can enumerate admins
// has already halved the work.
//
// Timing is kept close to flat as well: the mail send is not awaited, so a real
// admin's request does not take an SMTP round-trip longer than an unknown one.
// That does mean a delivery failure is invisible to the caller by design; it is
// recorded in audit_logs by EmailService instead.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import {
  GENERIC_RESET_MESSAGE, RESET_OTP_TTL_MINUTES, RESET_PURPOSE,
  canSelfResetPassword, checkResetRateLimit, findResetTarget, generateOtp, hashOtp,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

/** The one response every branch returns. */
const generic = () =>
  NextResponse.json({ success: true, message: GENERIC_RESET_MESSAGE }, { status: 200 });

export async function POST(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body?.email ?? "").toString().trim().toLowerCase();

    // A malformed address is answered generically too — telling the caller their
    // input was invalid is harmless, but keeping one shape keeps the branch count
    // (and so the timing surface) down.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic();

    const target = await findResetTarget(email);

    // Unknown address. Audited without a user id so repeated probing is visible
    // to an operator, while the caller learns nothing.
    if (!target) {
      void writeAuditLog({
        userId: null, actorName: "Anonymous", action: "password_reset.requested_unknown",
        entityType: "user", entityId: null, ipAddress: ip, userAgent,
        newValue: { outcome: "no_matching_account" },
      });
      return generic();
    }

    // Employee. No mail, no OTP row, same reply.
    if (!canSelfResetPassword(target.role)) {
      void writeAuditLog({
        userId: target.id, actorName: target.name, action: "password_reset.requested_blocked",
        entityType: "user", entityId: String(target.id), ipAddress: ip, userAgent,
        newValue: { outcome: "role_not_permitted_self_reset" },
      });
      return generic();
    }

    const rate = await checkResetRateLimit(target.id);
    if (!rate.ok) {
      void writeAuditLog({
        userId: target.id, actorName: target.name, action: "password_reset.rate_limited",
        entityType: "user", entityId: String(target.id), ipAddress: ip, userAgent,
        newValue: { reason: rate.reason },
      });
      // Deliberately NOT a 429: a different status for a throttled account is
      // itself a signal that the account exists.
      return generic();
    }

    // Supersede anything outstanding, so a code from a previous request cannot
    // still be redeemed once a newer one has been issued.
    await query(
      `UPDATE email_change_otps SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [target.id, RESET_PURPOSE]
    );

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

    // Only the hash is stored. `new_email` is NOT NULL on this shared table and
    // has no meaning for a reset, so it carries the account's own address.
    await query(
      `INSERT INTO email_change_otps
         (user_id, new_email, sent_to, otp_hash, expires_at, purpose, organization_id)
       VALUES ($1, $2, $2, $3, $4, $5,
               (SELECT organization_id FROM users WHERE id = $1))`,
      [target.id, target.email, hashOtp(otp), expiresAt, RESET_PURPOSE]
    );

    void writeAuditLog({
      userId: target.id, actorName: target.name, action: "password_reset.requested",
      entityType: "user", entityId: String(target.id), ipAddress: ip, userAgent,
      // Expiry and destination only. The code itself is never audited.
      newValue: { sentTo: target.email, expiresInMinutes: RESET_OTP_TTL_MINUTES },
    });

    // Not awaited — see the timing note at the top. Sent through the project's
    // existing Bhoomi Dwellers mail configuration.
    const firstName = (target.name || "").trim().split(/\s+/)[0] || "there";
    void EmailService.sendOTP(
      target.email,
      {
        name: firstName,
        code: otp,
        purpose: "Password reset",
        expiryMinutes: RESET_OTP_TTL_MINUTES,
      },
      { userId: target.id, ipAddress: ip, userAgent }
    ).catch(() => {
      // Swallowed on purpose: surfacing a send failure here would distinguish a
      // real account from an unknown one. EmailService audits its own failures.
    });

    return generic();
  } catch (err: any) {
    // Even a server fault answers generically. The detail goes to the log, and
    // never includes the code.
    console.error("[POST /api/auth/forgot-password]", err?.message);
    return generic();
  }
}
