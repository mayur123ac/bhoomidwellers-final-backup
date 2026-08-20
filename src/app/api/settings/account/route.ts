// app/api/settings/account/route.ts — the Account & Security summary block,
// plus the notification-email preference which lives on that screen.

import { getOrganizationId } from "@/lib/tenantContext";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { isHashed } from "@/lib/passwords";
import { loadSettingsUser, serializeSettingsUser } from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const row = await loadSettingsUser(gate.userId);
  if (!row) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const active = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM employee_sessions
      WHERE user_id = $1 AND is_active = true AND organization_id = $2`,
    [gate.userId, orgId]
  );

  const stored = await query<{ password: string | null }>(
    `SELECT password FROM users WHERE id = $1 AND organization_id = $2`,
    [gate.userId, orgId]
  );

  return NextResponse.json({
    success: true,
    user: serializeSettingsUser(row),
    account: {
      status: row.deactivated_at ? "suspended" : row.is_active ? "active" : "inactive",
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      activeSessions: Number(active[0]?.count ?? 0),
      // Surfaced so the UI can be honest about it rather than showing a
      // reassuring lock icon over a plaintext column.
      passwordHashed: isHashed(stored[0]?.password),
      passwordChangedAt: row.password_changed_at,
    },
  });
}

/** Notification-email preference: primary address, a secondary one, or none. */
export async function PATCH(req: NextRequest) {
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

  const preference = String(body.notificationEmailPreference ?? "").trim();
  if (!["primary", "secondary", "none"].includes(preference)) {
    return NextResponse.json(
      { success: false, message: "Choose the current email, an alternative, or no updates." },
      { status: 400 }
    );
  }

  const before = await loadSettingsUser(gate.userId);
  if (!before) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  let secondaryEmail = before.secondary_email;

  if (preference === "secondary") {
    const candidate = String(body.secondaryEmail ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(candidate)) {
      return NextResponse.json(
        { success: false, message: "Enter a valid alternative email address." },
        { status: 400 }
      );
    }
    if (candidate === (before.email ?? "").toLowerCase()) {
      return NextResponse.json(
        { success: false, message: "The alternative address must differ from your primary one." },
        { status: 400 }
      );
    }
    secondaryEmail = candidate;
  }

  await query(
    `UPDATE users
        SET notification_email_preference = $1,
            secondary_email = $2,
            -- Changing the address invalidates any previous verification. It is
            -- reset rather than carried over, so nothing claims a fresh, unproven
            -- address has been confirmed.
            secondary_email_verified = CASE
              WHEN $2 IS DISTINCT FROM secondary_email THEN false
              ELSE secondary_email_verified
            END,
            updated_at = NOW()
      WHERE id = $3`,
    [preference, secondaryEmail, gate.userId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: before.name,
    action: "account.notification_email.update",
    entityType: "user",
    entityId: gate.userId,
    oldValue: {
      preference: before.notification_email_preference,
      secondary: before.secondary_email,
    },
    newValue: { preference, secondary: secondaryEmail },
    ipAddress: ip,
    userAgent,
  });

  const after = await loadSettingsUser(gate.userId);
  return NextResponse.json({
    success: true,
    user: after ? serializeSettingsUser(after) : null,
    message: "Notification email preference saved",
  });
}
