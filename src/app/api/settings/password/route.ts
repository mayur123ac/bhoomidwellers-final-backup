// app/api/settings/password/route.ts — change your own password.
//
// This is the route that starts moving the CRM off plaintext passwords: it
// always writes a scrypt hash. The login route verifies both formats, so a user
// who changes their password here can still sign in, and everyone who hasn't is
// unaffected. See lib/passwords.ts for the full reasoning.

import { getOrganizationId } from "@/lib/tenantContext";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { checkPasswordRules, hashPassword, passwordMeetsRules, verifyPassword } from "@/lib/passwords";
import { EmailService } from "@/lib/email/EmailService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  const confirmPassword = String(body.confirmPassword ?? "");

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { success: false, message: "Current and new password are both required." },
      { status: 400 }
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { success: false, message: "New password and confirmation do not match." },
      { status: 400 }
    );
  }

  const stored = await query<{ password: string | null; name: string; email: string | null }>(
    `SELECT password, name, email FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [gate.userId, orgId]
  );
  if (stored.length === 0) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  if (!(await verifyPassword(currentPassword, stored[0].password))) {
    const { ip, userAgent } = requestContext(req);
    await writeAuditLog({
      userId: gate.userId,
      actorName: stored[0].name,
      action: "password.change_failed",
      entityType: "user",
      entityId: gate.userId,
      newValue: { reason: "wrong current password" },
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      { success: false, message: "Your current password is incorrect." },
      { status: 403 }
    );
  }

  if (!passwordMeetsRules(newPassword)) {
    return NextResponse.json(
      {
        success: false,
        message: "New password does not meet the requirements.",
        rules: checkPasswordRules(newPassword),
      },
      { status: 400 }
    );
  }

  if (await verifyPassword(newPassword, stored[0].password)) {
    return NextResponse.json(
      { success: false, message: "New password must differ from your current one." },
      { status: 400 }
    );
  }

  const hashed = await hashPassword(newPassword);
  await query(
    `UPDATE users SET password = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [hashed, gate.userId]
  );

  const { ip, userAgent } = requestContext(req);

  // ── Session invalidation ──
  // The spec asks for a forced re-login everywhere. Sessions here are stateless
  // signed cookies (lib/sessionCookie.ts) with no server-side revocation list,
  // so an already-issued cookie stays valid for its remaining TTL and cannot be
  // torn up from this route. What CAN be done is closing the tracked login
  // sessions, which is what the Active Sessions list reads, and clearing the
  // caller's own cookie so at minimum this browser re-authenticates.
  //
  // Genuinely revoking other browsers needs a `session_version` claim checked in
  // middleware — noted in the handover, not silently pretended here.
  await query(
    `UPDATE employee_sessions
        SET is_active = false, session_end = NOW(), session_end_reason = 'password_changed'
      WHERE user_id = $1 AND is_active = true AND organization_id = $2`,
    [gate.userId, orgId]
  );

  await writeAuditLog({
    userId: gate.userId,
    actorName: stored[0].name,
    action: "password.change",
    entityType: "user",
    entityId: gate.userId,
    ipAddress: ip,
    userAgent,
  });

  // Routed through the preference engine rather than sent to stored[0].email
  // directly. That direct send was the bug this whole feature exists to fix: a
  // user who had configured an alternative notification address still got their
  // password-change alert at the account address only.
  await EmailService.sendPasswordChanged(
    gate.userId,
    { name: stored[0].name, timestamp: new Date().toISOString(), ipAddress: ip, device: userAgent },
    { userId: gate.userId, actorName: stored[0].name, ip, userAgent }
  );

  const response = NextResponse.json({
    success: true,
    message: "Password updated. Re-login required.",
    // Tells the client to clear localStorage and bounce to the login screen.
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
