// app/api/settings/permissions/route.ts — per-employee permission management.
//
// GET  /api/settings/permissions
//   Admin: returns all active employees in the org with their current
//   permission overrides. Used by the Members & Team admin panel.
//   Employee: returns the caller's own permissions. Used by the Members & Team
//   self-service view.
//
// PUT  /api/settings/permissions
//   Admin only. Updates one or more permissions for a target employee.
//   Body: { targetUserId: number, can_change_password?: boolean }
//
// Permissions themselves are stored in `user_permissions` (see lib/permissions.ts).
// The table is created on first access — no migration needed.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles, requireSession } from "@/lib/serverAuth";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { getPermissions, listPermissions, setPermissions } from "@/lib/permissions";
import { avatarSrc } from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId!;
  const session = gate.session;
  const isAdmin =
    session.role === "admin" ||
    session.role === "super_admin" ||
    session.role === "Admin" ||
    session.role === "Super Admin";

  const orgId = await getOrganizationId();

  if (!isAdmin) {
    // Non-admin: return only their own permissions.
    const perms = await getPermissions(userId);
    return NextResponse.json({ own: true, permissions: perms });
  }

  // Admin: return all employees with their permission overrides.
  const [permList, employees] = await Promise.all([
    listPermissions(orgId),
    query<{
      id: number;
      name: string;
      email: string | null;
      role: string | null;
      department: string | null;
      is_active: boolean;
      avatar_key: string | null;
      avatar_url: string | null;
    }>(
      `SELECT id, name, email, role, department, is_active, avatar_key, avatar_url
         FROM users
        WHERE organization_id = $1
          AND is_active = true
          AND deleted_at IS NULL
        ORDER BY name`,
      [orgId]
    ),
  ]);

  const permMap = new Map(permList.map((p) => [p.userId, p]));

  const members = employees.map((emp) => {
    const p = permMap.get(emp.id);
    return {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      department: emp.department,
      avatarUrl: avatarSrc({ avatar_key: emp.avatar_key, avatar_url: emp.avatar_url }),
      permissions: {
        can_change_password: p?.can_change_password ?? true,
      },
    };
  });

  return NextResponse.json({ own: false, members });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const { ip, userAgent } = requestContext(req);

  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const adminId = gate.userId!;
  const admin = gate.session;
  const orgId = await getOrganizationId();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const targetUserId = Number(body?.targetUserId);
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid target user." },
      { status: 400 }
    );
  }

  // Verify the target exists in the same org.
  const targets = await query<{ name: string }>(
    `SELECT name FROM users
      WHERE id = $1
        AND organization_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [targetUserId, orgId]
  );
  if (targets.length === 0) {
    return NextResponse.json(
      { success: false, message: "Employee not found." },
      { status: 404 }
    );
  }
  const targetName = targets[0].name;

  // Extract and validate permission values.
  const updates: { can_change_password?: boolean } = {};
  if (body.can_change_password !== undefined) {
    if (typeof body.can_change_password !== "boolean") {
      return NextResponse.json(
        { success: false, message: "can_change_password must be a boolean." },
        { status: 400 }
      );
    }
    updates.can_change_password = body.can_change_password;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, message: "No permission fields supplied." },
      { status: 400 }
    );
  }

  await setPermissions(targetUserId, orgId, updates, adminId);

  void writeAuditLog({
    userId: adminId,
    actorName: admin.name,
    action: "permissions.updated",
    entityType: "user",
    entityId: String(targetUserId),
    ipAddress: ip,
    userAgent,
    newValue: { targetName, updates },
  });

  return NextResponse.json({ success: true, message: "Permissions updated." });
}
