// app/api/settings/deactivate/route.ts — the Danger Zone.
//
// A soft delete: `deleted_at` and `deactivated_at` are stamped and `is_active`
// is cleared, which is what the login route already checks. No rows are removed.
// Everything the person created — leads, bookings, commissions, activity — keeps
// pointing at a user record that still exists, because deleting it would either
// cascade into the CRM's history or fail on a foreign key.
//
// Re-activation is an admin action from Employee Management, not a self-service
// undo; there would be nobody signed in to perform it.

import { getOrganizationId } from "@/lib/tenantContext";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { verifyPassword } from "@/lib/passwords";
import { sendToUser } from "@/lib/emailRouting";

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

  const password = String(body.password ?? "");
  if (!password) {
    return NextResponse.json(
      { success: false, message: "Confirm your password to deactivate." },
      { status: 400 }
    );
  }

  const rows = await query<{ password: string | null; name: string; email: string | null; role: string }>(
    `SELECT password, name, email, role FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [gate.userId, orgId]
  );
  if (rows.length === 0) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  if (!(await verifyPassword(password, rows[0].password))) {
    return NextResponse.json({ success: false, message: "Incorrect password." }, { status: 403 });
  }

  // An admin locking themselves out when they are the only one leaves nobody who
  // can manage the workspace or reinstate the account — the CRM would need a
  // manual database edit to recover.
  if ((rows[0].role ?? "").toLowerCase() === "admin") {
    const others = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users
        WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL AND id <> $1 AND organization_id = $2`,
      [gate.userId, orgId]
    );
    if (Number(others[0]?.count ?? 0) === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You are the only active admin. Promote another admin before deactivating this account.",
        },
        { status: 409 }
      );
    }
  }

  await query(
    `UPDATE users
        SET is_active = false, deactivated_at = NOW(), deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [gate.userId, orgId]
  );

  await query(
    `UPDATE employee_sessions
        SET is_active = false, session_end = NOW(), session_end_reason = 'account_deactivated'
      WHERE user_id = $1 AND is_active = true AND organization_id = $2`,
    [gate.userId, orgId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: rows[0].name,
    action: "account.deactivate",
    entityType: "user",
    entityId: gate.userId,
    ipAddress: ip,
    userAgent,
  });

  // Notify remaining admins. Each one is routed through their OWN notification
  // preferences via sendToUser — an admin who has configured an alternative
  // address receives this there, and an admin who has switched email off does
  // not receive it at all. `email IS NOT NULL` is no longer part of the query
  // because the address is no longer read here; the routing engine decides.
  const admins = await query<{ id: number; name: string }>(
    `SELECT id, name FROM users
      WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL AND id <> $1 AND organization_id = $2`,
    [gate.userId, orgId]
  );

  for (const admin of admins) {
    // `employee.deactivated`, not `employee.removed`: the account is archived
    // and reactivatable, and the two now carry separate switches on the
    // Notifications screen. Sending this under the removal type would make the
    // "Employee removed" toggle silence a deactivation notice.
    await sendToUser(admin.id, "employee.deactivated", {
      subject: "An account was deactivated - Bhoomi Dwellers CRM",
      text: `Hi ${admin.name},\n\n${rows[0].name} deactivated their own account on ${new Date().toISOString()}.\n\nTheir data has been archived, not deleted. You can reactivate them from Settings → Employee Management.`,
    });
  }

  const response = NextResponse.json({
    success: true,
    message: "Your account has been deactivated.",
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
