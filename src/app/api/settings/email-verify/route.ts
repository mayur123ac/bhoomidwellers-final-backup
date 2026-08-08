// app/api/settings/email-verify/route.ts — step 2: verify the OTP, apply the change.
//
// The new address is read from the stored OTP row, NOT from the request body.
// If the client supplied it, someone could request a code for an address they
// control, then submit the valid code alongside a different address entirely.

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { loadSettingsUser, serializeSettingsUser } from "@/lib/settingsUser";
import { hashOtp } from "../email-change/route";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;

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

  const otp = String(body.otp ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    return NextResponse.json(
      { success: false, message: "Enter the 6-digit code." },
      { status: 400 }
    );
  }

  const pending = await query<{
    id: number;
    new_email: string;
    otp_hash: string;
    attempts: number;
    expires_at: string;
  }>(
    // The purpose filter is load-bearing. email_change_otps is shared with the
    // alternative-address verification flow, and without it the most recent
    // outstanding code of EITHER kind would be picked up here — so a code issued
    // to prove ownership of a notification address could be used to complete a
    // change of the account's primary email.
    `SELECT id, new_email, otp_hash, attempts, expires_at
       FROM email_change_otps
      WHERE user_id = $1 AND purpose = 'primary_change' AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [gate.userId]
  );

  if (pending.length === 0) {
    return NextResponse.json(
      { success: false, message: "No pending email change. Start again." },
      { status: 404 }
    );
  }

  const record = pending[0];

  if (new Date(record.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [record.id]);
    return NextResponse.json(
      { success: false, message: "That code has expired. Request a new one.", restart: true },
      { status: 410 }
    );
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [record.id]);
    return NextResponse.json(
      { success: false, message: "Too many incorrect attempts. Request a new code.", restart: true },
      { status: 429 }
    );
  }

  const user = await loadSettingsUser(gate.userId);
  if (!user) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  if (hashOtp(otp) !== record.otp_hash) {
    // Count the attempt before responding, so a wrong guess costs the caller
    // something even if they abandon the request mid-flight.
    const updated = await query<{ attempts: number }>(
      `UPDATE email_change_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
      [record.id]
    );
    const remaining = Math.max(MAX_ATTEMPTS - (updated[0]?.attempts ?? MAX_ATTEMPTS), 0);

    const { ip, userAgent } = requestContext(req);
    await writeAuditLog({
      userId: gate.userId,
      actorName: user.name,
      action: "email.change.otp_failed",
      entityType: "user",
      entityId: gate.userId,
      newValue: { remainingAttempts: remaining },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json(
      {
        success: false,
        message: remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect attempts. Request a new code.",
        remainingAttempts: remaining,
        restart: remaining === 0,
      },
      { status: 400 }
    );
  }

  // Re-check the uniqueness of the target address at the moment of application.
  // It was free when the code was issued up to ten minutes ago; someone else may
  // have taken it since.
  const taken = await query<{ id: number }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,
    [record.new_email, gate.userId]
  );
  if (taken.length > 0) {
    await query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [record.id]);
    return NextResponse.json(
      { success: false, message: "That email was claimed by another account. Start again.", restart: true },
      { status: 409 }
    );
  }

  // One transaction: consuming the code and applying the address must not come
  // apart, or a crash between them leaves a spent code with the old email intact
  // (user must redo it) or — worse the other way — a live code after the change.
  await transaction(async (client) => {
    await client.query(
      `UPDATE users
          SET email = $1, last_email_change_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [record.new_email, gate.userId]
    );
    await client.query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [
      record.id,
    ]);
  });

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: user.name,
    action: "email.change.completed",
    entityType: "user",
    entityId: gate.userId,
    oldValue: user.email,
    newValue: record.new_email,
    ipAddress: ip,
    userAgent,
  });

  const after = await loadSettingsUser(gate.userId);
  return NextResponse.json({
    success: true,
    // The session cookie carries the old email in its signed payload and cannot
    // be rewritten from here without re-signing it. Nothing gates on that field
    // — routes use _id and role — so it is stale but harmless until the next
    // login. The client refreshes its localStorage copy from this response.
    user: after ? serializeSettingsUser(after) : null,
    message: "Email address changed",
  });
}
