// api/admin/password-change/request-otp/route.ts
//
// Step 1 of the admin-initiated employee password-change flow.
//
// The OTP is sent to the ADMIN'S OWN email(s) — the admin proves their identity,
// not the target's. This prevents a stolen admin cookie from silently resetting
// any employee's credential: the actor must also control the email address the
// OTP reaches.
//
// ── Address resolution ───────────────────────────────────────────────────────
// The admin's delivery addresses are fetched FRESH from the database, not from
// the session cookie. The session is a signed-at-login snapshot and may not
// reflect a later email-address change. The alternative address is also fetched,
// and the OTP is sent to ALL resolved addresses (primary + verified alternative)
// using the same resolveRecipients() logic that governs every other outgoing
// notification — so the admin's preference settings are honoured consistently.
//
// ── What is stored ──────────────────────────────────────────────────────────
// user_id    = admin's id (the actor whose OTP this is)
// new_email  = "admin_pw_change:{targetUserId}" — encodes the target so the
//              confirm route can verify the OTP was issued for this specific
//              employee, not substituted mid-flow for a different one.
// sent_to    = first verified delivery address (primary when available)
// purpose    = ADMIN_PW_CHANGE_PURPOSE
//
// The plaintext OTP is never stored. Only the SHA-256 hash lands in the row.
// The code itself reaches only the admin's inbox(es) and the confirm request.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import { getPreferences, resolveRecipients } from "@/lib/emailRouting";
import {
  ADMIN_PW_CHANGE_PURPOSE,
  RESET_OTP_TTL_MINUTES,
  checkRateLimitForPurpose,
  generateOtp,
  hashOtp,
} from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

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

    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return bad("Invalid target user.");
    }

    // An admin changing their own password must use Account & Security.
    if (adminId === targetUserId) {
      return bad("Use Account & Security to change your own password.");
    }

    // ── Pre-flight: require a working mail transport ──────────────────────────
    //
    // Checked before generating a code. A misconfigured transport that cannot
    // reach the admin's inbox makes the OTP useless; surfacing the problem here
    // is far more useful than silently generating a code and returning "sent".
    if (!isMailConfigured()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Email is not configured on this server. " +
            "Set SMTP credentials in your environment and restart, " +
            "then try again.",
        },
        { status: 503 }
      );
    }

    // ── Resolve admin's delivery addresses from the database ─────────────────
    //
    // The session cookie carries the email that was on the account at login
    // time — it is never refreshed. Fetching fresh from the DB catches a
    // post-login address change, and this is the only way to learn about the
    // verified alternative address stored in notification_preferences.
    //
    // resolveRecipients() applies the same rules as every other outgoing
    // notification: primary when send_current_email is on, alternative when
    // send_alternative_email is on AND alternative_email_verified is true,
    // deduplicating when both point at the same mailbox.
    const prefs = await getPreferences(adminId);
    const resolution = prefs
      ? resolveRecipients(prefs)
      : { addresses: [], recipients: [], notes: [] };

    const deliveryAddresses = resolution.addresses;

    if (deliveryAddresses.length === 0) {
      return bad(
        "No verified email address is configured for your account. " +
          "Please update your email settings before changing an employee's password."
      );
    }

    // The first address is the primary (account email when send_current_email
    // is true, which it is by default). It is the canonical address stored in
    // the OTP row's sent_to column and shown in success messages.
    const primaryAddress = deliveryAddresses[0];

    const orgId = await getOrganizationId();

    // Verify the target exists in the same org and is active.
    const targets = await query<{ id: number; name: string }>(
      `SELECT id, name FROM users
        WHERE id = $1
          AND organization_id = $2
          AND is_active = true
          AND deleted_at IS NULL
        LIMIT 1`,
      [targetUserId, orgId]
    );
    if (targets.length === 0) {
      return bad("Employee not found.", 404);
    }
    const targetName = targets[0].name;

    // Rate limit per admin per purpose — independent of the self-reset bucket.
    const rate = await checkRateLimitForPurpose(adminId, ADMIN_PW_CHANGE_PURPOSE);
    if (!rate.ok) {
      return bad(
        rate.reason === "cooldown"
          ? `Please wait ${rate.retryAfterSeconds} second(s) before requesting another code.`
          : "Too many requests. Please try again in an hour."
      );
    }

    // Supersede any live code for this admin + purpose, so a previous code
    // cannot still be redeemed once a newer one has been issued.
    await query(
      `UPDATE email_change_otps
          SET consumed_at = now()
        WHERE user_id = $1
          AND purpose = $2
          AND consumed_at IS NULL`,
      [adminId, ADMIN_PW_CHANGE_PURPOSE]
    );

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO email_change_otps
         (user_id, new_email, sent_to, otp_hash, expires_at, purpose, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        adminId,
        `admin_pw_change:${targetUserId}`, // encodes the target — checked on confirm
        primaryAddress,
        hashOtp(otp),
        expiresAt,
        ADMIN_PW_CHANGE_PURPOSE,
        orgId,
      ]
    );

    // ── Send to all resolved addresses ────────────────────────────────────────
    //
    // Awaited, not fire-and-forget. This is an authenticated route; there is no
    // unauthenticated enumeration risk that would require timing neutralisation.
    // Awaiting means a real delivery failure is visible to the caller and can be
    // acted on, rather than silently lost inside a fire-and-forget promise.
    //
    // Both addresses receive the same code. The OTP row is stored once; the
    // confirm route checks the hash regardless of which inbox the admin reads.
    const firstName = (admin.name ?? "").trim().split(/\s+/)[0] || "Admin";

    const sendResults = await Promise.all(
      deliveryAddresses.map(async (to) => {
        try {
          return await EmailService.sendOTP(
            to,
            {
              name: firstName,
              code: otp,
              purpose: `Password change for ${targetName}`,
              expiryMinutes: RESET_OTP_TTL_MINUTES,
            },
            { userId: adminId, ip, userAgent }
          );
        } catch {
          // Provider threw unexpectedly — return a failed outcome so the per-
          // address result array remains parallel to deliveryAddresses.
          return { delivered: false, provider: "error" };
        }
      })
    );

    const deliveredTo = deliveryAddresses.filter((_, i) => sendResults[i].delivered);

    if (deliveredTo.length === 0) {
      // Every send failed. Consume the OTP row so the code cannot be redeemed
      // if the admin somehow obtains it from outside the email channel.
      await query(
        `UPDATE email_change_otps
            SET consumed_at = now()
          WHERE user_id = $1
            AND purpose = $2
            AND consumed_at IS NULL`,
        [adminId, ADMIN_PW_CHANGE_PURPOSE]
      );

      void writeAuditLog({
        userId: adminId,
        actorName: admin.name,
        action: "admin_password_change.otp_delivery_failed",
        entityType: "user",
        entityId: String(targetUserId),
        ipAddress: ip,
        userAgent,
        newValue: {
          targetName,
          attemptedAddresses: deliveryAddresses.length,
          // No addresses logged — they would expose which ones are configured.
        },
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
      userId: adminId,
      actorName: admin.name,
      action: "admin_password_change.otp_requested",
      entityType: "user",
      entityId: String(targetUserId),
      ipAddress: ip,
      userAgent,
      newValue: {
        targetName,
        deliveredCount: deliveredTo.length,
        totalAddresses: deliveryAddresses.length,
        expiresInMinutes: RESET_OTP_TTL_MINUTES,
        // Addresses are not logged — they would appear in audit_logs which are
        // visible to any admin. The delivery count is enough to diagnose issues.
      },
    });

    const desc =
      deliveredTo.length > 1
        ? `your admin email addresses`
        : `your email (${primaryAddress})`;

    return NextResponse.json({
      success: true,
      message: `A verification code has been sent to ${desc}. It expires in ${RESET_OTP_TTL_MINUTES} minutes.`,
    });
  } catch (err: any) {
    console.error("[POST /api/admin/password-change/request-otp]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not send verification code." },
      { status: 500 }
    );
  }
}
