// app/api/settings/employees/route.ts — Employee Management.
//
// Operates on `users`. There is no separate employees table and none is created:
// users IS the directory. Every foreign key in the CRM points at users.id, the
// session cookie carries it, and /api/employees already reads it — a parallel
// table would need syncing on every write and would disagree the first time one
// was missed.
//
// This route is a superset of the existing /api/employees, adding department,
// reporting manager, invite state and bulk actions. /api/employees is left
// untouched so the current /dashboard/employees screen keeps working while both
// exist.
//
// Admin-only throughout.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";
import { diffFields, requestContext, writeAuditLog } from "@/lib/auditLog";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured } from "@/lib/email/config";
import { avatarSrc, initialsFor } from "@/lib/settingsUser";
import { describePropagation, propagateUserRename } from "@/lib/renameUserReferences";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVITE_TTL_DAYS = 7;

const DEPARTMENTS = ["Sales", "Management", "Support", "Operations", "Other"];

/**
 * Roles come from the `roles` table rather than a hardcoded list, because
 * middleware.ts routes on role strings and a value invented here that middleware
 * doesn't recognise would create a user who logs in and is bounced straight back
 * to the login screen by the "unrecognised role" fallback.
 */
async function validRoles(): Promise<string[]> {
  // MT-05: roles are organization-specific. Without this filter the employees
  // screen would offer another builder's role names as valid choices.
  const rows = await query<{ name: string }>(
    `SELECT name FROM roles WHERE organization_id = $1 ORDER BY id`,
    [await getOrganizationId()],
  );
  return rows.map((r) => r.name);
}

interface DirectoryRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  role: string | null;
  department: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  first_login_at: string | null;
  invite_sent_at: string | null;
  invite_expires_at: string | null;
  deactivated_at: string | null;
  avatar_key: string | null;
  avatar_url: string | null;
  reporting_manager_id: number | null;
  manager_name: string | null;
}

/**
 * Derived, not stored, so it cannot fall out of step with is_active.
 *   pending  — invited, never signed in
 *   inactive — deactivated
 *   active   — everyone else
 */
function statusOf(row: DirectoryRow): "active" | "pending" | "inactive" {
  if (!row.is_active || row.deactivated_at) return "inactive";
  if (row.invite_sent_at && !row.first_login_at) return "pending";
  return "active";
}

function serialize(row: DirectoryRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    username: row.username,
    role: row.role,
    department: row.department,
    reportingManagerId: row.reporting_manager_id,
    reportingManagerName: row.manager_name,
    status: statusOf(row),
    isActive: row.is_active,
    createdAt: row.created_at,
    lastActiveAt: row.last_login_at,
    firstLoginAt: row.first_login_at,
    inviteSentAt: row.invite_sent_at,
    inviteExpired:
      Boolean(row.invite_expires_at) &&
      new Date(row.invite_expires_at as string).getTime() < Date.now(),
    deactivatedAt: row.deactivated_at,
    avatarUrl: avatarSrc(row),
    initials: initialsFor(row.name),
  };
}

const SELECT_DIRECTORY = `
  SELECT u.id, u.name, u.email, u.phone, u.username, u.role, u.department,
         u.is_active, u.created_at, u.last_login_at, u.first_login_at,
         u.invite_sent_at, u.invite_expires_at, u.deactivated_at,
         u.avatar_key, u.avatar_url, u.reporting_manager_id,
         m.name AS manager_name
    FROM users u
    -- The manager join is organization-scoped too: without it a manager from
    -- another organization could surface as a name on this organization's row.
    LEFT JOIN users m ON m.id = u.reporting_manager_id AND m.organization_id = u.organization_id
`;

// ── GET: the directory ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  const params = req.nextUrl.searchParams;
  const search = (params.get("search") ?? "").trim();
  const status = params.get("status") ?? "all";
  const role = params.get("role") ?? "all";
  const department = params.get("department") ?? "all";

  const rows = await query<DirectoryRow>(
    `${SELECT_DIRECTORY}
      WHERE u.deleted_at IS NULL
        AND u.organization_id = $4
        AND ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
        AND ($2 = 'all' OR u.role = $2)
        AND ($3 = 'all' OR COALESCE(u.department, '') = $3)
      ORDER BY u.name`,
    [search, role, department, orgId]
  );

  // Status is derived from three columns, so it is filtered after mapping rather
  // than reimplemented as a SQL predicate that could disagree with statusOf().
  const serialized = rows.map(serialize);
  const filtered =
    status === "all" ? serialized : serialized.filter((r) => r.status === status);

  return NextResponse.json({
    success: true,
    employees: filtered,
    catalogue: {
      roles: await validRoles(),
      departments: DEPARTMENTS,
      // Anyone active can be named as a reporting manager.
      managers: serialized
        .filter((r) => r.status === "active")
        .map((r) => ({ id: r.id, name: r.name, role: r.role })),
    },
    counts: {
      all: serialized.length,
      active: serialized.filter((r) => r.status === "active").length,
      pending: serialized.filter((r) => r.status === "pending").length,
      inactive: serialized.filter((r) => r.status === "inactive").length,
    },
    inviteEmailConfigured: isMailConfigured(),
  });
}

async function loadOne(id: number): Promise<DirectoryRow | null> {
  const rows = await query<DirectoryRow>(`${SELECT_DIRECTORY} WHERE u.id = $1`, [id]);
  return rows[0] ?? null;
}

// ── POST: add an employee ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const role = String(body.role ?? "").trim();
  const department = String(body.department ?? "").trim();
  const sendInvite = body.sendInvite !== false; // default ON, per spec
  const tempPassword = String(body.tempPassword ?? "");
  const reportingManagerId = body.reportingManagerId ? Number(body.reportingManagerId) : null;

  if (!firstName) {
    return NextResponse.json({ success: false, message: "First name is required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }
  if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) {
    return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
  }

  const roles = await validRoles();
  if (!roles.includes(role)) {
    return NextResponse.json(
      { success: false, message: `Role must be one of: ${roles.join(", ")}.` },
      { status: 400 }
    );
  }

  const name = [firstName, lastName].filter(Boolean).join(" ");

  // Both are login identifiers (the login route matches email OR name), so both
  // must be unique or two accounts become indistinguishable at sign-in.
  const clash = await query<{ id: number; email: string | null; name: string }>(
    `SELECT id, email, name FROM users
      WHERE LOWER(email) = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
    [email, name]
  );
  if (clash.length > 0) {
    return NextResponse.json(
      {
        success: false,
        message:
          (clash[0].email ?? "").toLowerCase() === email
            ? "That email is already registered."
            : "Another account already uses that name.",
      },
      { status: 409 }
    );
  }

  if (reportingManagerId) {
    // A reporting manager must belong to the same organization as the employee.
    const manager = await query<{ id: number }>(
      `SELECT id FROM users WHERE id = $1 AND organization_id = $2`,
      [reportingManagerId, orgId],
    );
    if (manager.length === 0) {
      return NextResponse.json(
        { success: false, message: "Selected reporting manager does not exist." },
        { status: 400 }
      );
    }
  }

  let passwordValue: string;
  let inviteToken: string | null = null;
  let inviteSentAt: Date | null = null;
  let inviteExpiresAt: Date | null = null;
  let shownPassword: string | null = null;

  if (sendInvite) {
    // No usable password until the invite is accepted. A long random value is
    // stored rather than NULL because the login route treats a missing password
    // as "no account found" territory, and this way the row is simply
    // unguessable until the person sets their own.
    passwordValue = await hashPassword(randomBytes(32).toString("hex"));
    inviteToken = randomBytes(32).toString("hex");
    inviteSentAt = new Date();
    inviteExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
  } else {
    if (!passwordMeetsRules(tempPassword)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Set a temporary password of 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol.",
        },
        { status: 400 }
      );
    }
    passwordValue = await hashPassword(tempPassword);
    // Returned once so the admin can hand it over — it is a hash in the database
    // from this point and cannot be read back.
    shownPassword = tempPassword;
  }

  const inserted = await query<{ id: number }>(
    `INSERT INTO users
       (name, email, phone, role, department, reporting_manager_id, password,
        is_active, username, invite_token, invite_sent_at, invite_expires_at,
        organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      name,
      email,
      phone || null,
      role,
      department || null,
      reportingManagerId,
      passwordValue,
      email, // username defaults to email; the existing screen treats them alike
      inviteToken,
      inviteSentAt,
      inviteExpiresAt,
      await getOrganizationId(),
    ]
  );

  const newId = inserted[0].id;

  let mailDelivered = false;
  if (sendInvite && inviteToken) {
    const origin = req.nextUrl.origin;
    const context = requestContext(req);

    // EmailService's DIRECT path, not the routed one. An invite is the system
    // email that must go to a specific address rather than to routing
    // preferences: the recipient has not signed in yet, so any preferences on
    // their new row are defaults nobody chose. Sending it anywhere other than
    // the address being invited would mean inviting someone and mailing the
    // invitation elsewhere.
    const mail = await EmailService.sendEmployeeInvitation(
      email,
      {
        name,
        organization: "Bhoomi Dwellers",
        role,
        inviteUrl: `${origin}/signup?invite=${inviteToken}`,
        expiryDays: INVITE_TTL_DAYS,
        invitedBy: gate.session.name,
      },
      { userId: gate.userId, actorName: gate.session.name, ip: context.ip, userAgent: context.userAgent }
    );
    mailDelivered = mail.delivered;
  }

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "employee.create",
    entityType: "user",
    entityId: newId,
    newValue: { name, email, role, department, sendInvite },
    ipAddress: ip,
    userAgent,
  });

  const row = await loadOne(newId);
  return NextResponse.json(
    {
      success: true,
      employee: row ? serialize(row) : null,
      temporaryPassword: shownPassword,
      inviteDelivered: mailDelivered,
      message: sendInvite
        ? mailDelivered
          ? "Employee added. Invite sent to email."
          : "Employee added. Email delivery is not configured, so the invite was not sent — set a temporary password instead, or configure SMTP."
        : "Employee added. Share the temporary password shown — it cannot be retrieved later.",
    },
    { status: 201 }
  );
}

// ── PATCH: edit, deactivate/reactivate, resend invite, bulk actions ──────────
export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { ip, userAgent } = requestContext(req);
  const action = String(body.action ?? "update");

  // ── Bulk deactivate / reactivate ──
  if (action === "bulkStatus") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    const activate = Boolean(body.isActive);
    if (ids.length === 0) {
      return NextResponse.json({ success: false, message: "No employees selected." }, { status: 400 });
    }

    // Refuse to deactivate the last admin, and refuse self-deactivation here —
    // the Danger Zone is the deliberate path for the latter, with a password
    // confirmation this bulk action does not have.
    if (!activate) {
      if (ids.includes(gate.userId as number)) {
        return NextResponse.json(
          {
            success: false,
            message: "You cannot deactivate your own account here. Use Account & Security → Deactivate.",
          },
          { status: 400 }
        );
      }
      const remaining = await query<{ count: string }>(
        // The "last admin" guard must count only THIS organization's admins —
        // another organization's admin is no protection against locking this one out.
        `SELECT COUNT(*)::text AS count FROM users
          WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL
            AND organization_id = $2
            AND NOT (id = ANY($1::int[]))`,
        [ids, orgId]
      );
      if (Number(remaining[0]?.count ?? 0) === 0) {
        return NextResponse.json(
          { success: false, message: "That would leave the workspace with no active admin." },
          { status: 409 }
        );
      }
    }

    const updated = await query<{ id: number }>(
      `UPDATE users
          SET is_active = $1,
              deactivated_at = CASE WHEN $1 THEN NULL ELSE NOW() END,
              updated_at = NOW()
        WHERE id = ANY($2::int[]) AND deleted_at IS NULL AND organization_id = $3
      RETURNING id`,
      [activate, ids, orgId]
    );

    if (!activate) {
      await query(
        `UPDATE employee_sessions
            SET is_active = false, session_end = NOW(), session_end_reason = 'deactivated_by_admin'
          WHERE user_id = ANY($1::int[]) AND organization_id = $2 AND is_active = true`,
        [ids, orgId]
      );
    }

    await writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name,
      action: activate ? "employee.bulk_reactivate" : "employee.bulk_deactivate",
      entityType: "user",
      newValue: { ids: updated.map((u) => u.id) },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      updated: updated.length,
      message: `${updated.length} employee${updated.length === 1 ? "" : "s"} ${
        activate ? "reactivated" : "deactivated"
      }.`,
    });
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, message: "Employee id is required." }, { status: 400 });
  }

  const before = await loadOne(id);
  if (!before) {
    return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
  }

  // ── Resend invite ──
  if (action === "resendInvite") {
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);

    await query(
      `UPDATE users SET invite_token = $1, invite_sent_at = NOW(), invite_expires_at = $2, updated_at = NOW()
        WHERE id = $3 AND organization_id = $4`,
      [token, expires, id, orgId]
    );

    const mail = before.email
      ? await EmailService.sendEmployeeInvitation(
          before.email,
          {
            name: before.name,
            organization: "Bhoomi Dwellers",
            role: before.role ?? "team member",
            inviteUrl: `${req.nextUrl.origin}/signup?invite=${token}`,
            expiryDays: INVITE_TTL_DAYS,
            invitedBy: gate.session.name,
          },
          { userId: gate.userId, actorName: gate.session.name, ip, userAgent }
        )
      : { delivered: false };

    await writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name,
      action: "employee.invite_resent",
      entityType: "user",
      entityId: id,
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      message: mail.delivered
        ? `Invite resent to ${before.email}.`
        : "Invite regenerated, but email delivery is not configured so nothing was sent.",
      inviteDelivered: mail.delivered,
    });
  }

  // ── Single status toggle ──
  if (action === "setStatus") {
    const activate = Boolean(body.isActive);

    if (!activate) {
      if (id === gate.userId) {
        return NextResponse.json(
          {
            success: false,
            message: "You cannot deactivate your own account here. Use Account & Security → Deactivate.",
          },
          { status: 400 }
        );
      }
      if ((before.role ?? "").toLowerCase() === "admin") {
        const others = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users
            WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL
              AND organization_id = $2 AND id <> $1`,
          [id, orgId]
        );
        if (Number(others[0]?.count ?? 0) === 0) {
          return NextResponse.json(
            { success: false, message: "That is the only active admin." },
            { status: 409 }
          );
        }
      }
    }

    await query(
      `UPDATE users
          SET is_active = $1,
              deactivated_at = CASE WHEN $1 THEN NULL ELSE NOW() END,
              updated_at = NOW()
        WHERE id = $2 AND organization_id = $3`,
      [activate, id, orgId]
    );

    if (!activate) {
      await query(
        `UPDATE employee_sessions
            SET is_active = false, session_end = NOW(), session_end_reason = 'deactivated_by_admin'
          WHERE user_id = $1 AND organization_id = $2 AND is_active = true`,
        [id, orgId]
      );
    }

    await writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name,
      action: activate ? "employee.reactivate" : "employee.deactivate",
      entityType: "user",
      entityId: id,
      oldValue: { isActive: before.is_active },
      newValue: { isActive: activate },
      ipAddress: ip,
      userAgent,
    });

    const after = await loadOne(id);
    return NextResponse.json({
      success: true,
      employee: after ? serialize(after) : null,
      message: activate ? "Employee reactivated." : "Employee deactivated.",
    });
  }

  // ── Field update ──
  const updates: Record<string, any> = {};

  if (body.firstName !== undefined || body.lastName !== undefined) {
    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    if (!firstName) {
      return NextResponse.json({ success: false, message: "First name is required." }, { status: 400 });
    }
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const clash = await query<{ id: number }>(
      // Name and email are LOGIN IDENTIFIERS and are unique PLATFORM-WIDE
      // (decision 2026-08-19), so these clash checks are deliberately not
      // organization-scoped — scoping them would let two organizations hold the
      // same identifier and make the login lookup ambiguous.
      `SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,
      [name, id]
    );
    if (clash.length > 0) {
      return NextResponse.json(
        { success: false, message: "Another account already uses that name." },
        { status: 409 }
      );
    }
    updates.name = name;
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ success: false, message: "Enter a valid email." }, { status: 400 });
    }
    const clash = await query<{ id: number }>(
      // Platform-wide email identity — see the name check above.
      `SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1`,
      [email, id]
    );
    if (clash.length > 0) {
      return NextResponse.json(
        { success: false, message: "That email is already registered." },
        { status: 409 }
      );
    }
    updates.email = email;
  }

  if (body.phone !== undefined) {
    const phone = String(body.phone ?? "").trim();
    if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) {
      return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
    }
    updates.phone = phone || null;
  }

  if (body.role !== undefined) {
    const roles = await validRoles();
    if (!roles.includes(body.role)) {
      return NextResponse.json(
        { success: false, message: `Role must be one of: ${roles.join(", ")}.` },
        { status: 400 }
      );
    }
    // Demoting the last admin locks everyone out of workspace administration
    // just as surely as deactivating them does.
    if ((before.role ?? "").toLowerCase() === "admin" && body.role.toLowerCase() !== "admin") {
      const others = await query<{ count: string }>(
        // Counts THIS workspace's other admins. Unscoped, another tenant's admin
        // would satisfy the check and a workspace could demote its own last one.
        `SELECT COUNT(*)::text AS count FROM users
          WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL
            AND organization_id = $2 AND id <> $1`,
        [id, orgId]
      );
      if (Number(others[0]?.count ?? 0) === 0) {
        return NextResponse.json(
          { success: false, message: "That is the only active admin — promote someone else first." },
          { status: 409 }
        );
      }
    }
    updates.role = body.role;
  }

  if (body.department !== undefined) {
    const department = String(body.department ?? "").trim();
    if (department && !DEPARTMENTS.includes(department)) {
      return NextResponse.json({ success: false, message: "Unknown department." }, { status: 400 });
    }
    updates.department = department || null;
  }

  if (body.reportingManagerId !== undefined) {
    const managerId = body.reportingManagerId ? Number(body.reportingManagerId) : null;
    if (managerId === id) {
      return NextResponse.json(
        { success: false, message: "An employee cannot report to themselves." },
        { status: 400 }
      );
    }
    if (managerId) {
      // Same organization as the employee being edited.
      const manager = await query<{ id: number }>(
        `SELECT id FROM users WHERE id = $1 AND organization_id = $2`,
        [managerId, orgId],
      );
      if (manager.length === 0) {
        return NextResponse.json(
          { success: false, message: "Selected reporting manager does not exist." },
          { status: 400 }
        );
      }
    }
    updates.reporting_manager_id = managerId;
  }

  if (body.password) {
    if (!passwordMeetsRules(String(body.password))) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Password needs 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol.",
        },
        { status: 400 }
      );
    }
    updates.password = await hashPassword(String(body.password));
    // Stamped so an ADMIN-set password revokes the target's live sessions, the
    // same way a self-service change already does (/api/settings/password) and
    // the same way the platform path does (lib/userSecurity.setUserPassword).
    // Without this, the one route that changes someone ELSE'S password was the
    // one route that left their old cookie working.
    updates.password_changed_at = new Date();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
  }

  const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`);
  // MT-05: id comes from the request, so the organization is part of the WHERE.
  const values = [...Object.values(updates), id, orgId];
  await query(
    `UPDATE users SET ${setClauses.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length - 1} AND organization_id = $${values.length}`,
    values
  );

  // Lead ownership is keyed on the name string, so renaming an employee has to
  // move their assignments too. See lib/renameUserReferences.ts.
  const moved = updates.name ? await propagateUserRename(before.name, updates.name) : [];

  // The password hash is never logged, not even as "changed to X".
  const loggable = { ...updates };
  if (loggable.password) loggable.password = "[hashed]";
  const { old, next } = diffFields(before as any, loggable);

  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "employee.update",
    entityType: "user",
    entityId: id,
    oldValue: old,
    newValue: moved.length > 0 ? { ...next, reassigned: moved } : next,
    ipAddress: ip,
    userAgent,
  });

  const after = await loadOne(id);
  const propagationNote = describePropagation(moved);

  return NextResponse.json({
    success: true,
    employee: after ? serialize(after) : null,
    message: propagationNote ? `Employee updated. ${propagationNote}` : "Employee updated.",
  });
}

// ── DELETE: soft-remove from the directory ──────────────────────────────────
export async function DELETE(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, message: "Employee id is required." }, { status: 400 });
  }
  if (id === gate.userId) {
    return NextResponse.json(
      { success: false, message: "You cannot remove your own account." },
      { status: 400 }
    );
  }

  const before = await loadOne(id);
  if (!before) {
    return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
  }

  if ((before.role ?? "").toLowerCase() === "admin") {
    const others = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users
        WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL
          AND organization_id = $2 AND id <> $1`,
      [id, orgId]
    );
    if (Number(others[0]?.count ?? 0) === 0) {
      return NextResponse.json(
        { success: false, message: "That is the only active admin." },
        { status: 409 }
      );
    }
  }

  // ── Lead reassignment ──
  // walkin_enquiries.assigned_to holds the employee NAME, not an id (see the
  // sourcing/assignment code), so reassignment is a name swap. Doing this before
  // the soft delete keeps the two consistent if the second statement fails.
  const disposition = String(body.leadDisposition ?? "keep");
  let reassigned = 0;

  if (disposition === "reassign" || disposition === "unassign") {
    const target = disposition === "reassign" ? gate.session.name : null;
    const moved = await query<{ id: number }>(
      // Lead ownership is keyed on the employee NAME, which is only unique
      // platform-wide by convention — so this reassignment is organization-scoped
      // to stop it rewriting another builder's leads that share a name.
      `UPDATE walkin_enquiries SET assigned_to = $1
        WHERE assigned_to = $2 AND organization_id = $3
      RETURNING id`,
      [target, before.name, orgId]
    );
    reassigned = moved.length;
  }

  // Soft delete only. Rows across leads, bookings, commissions and activity logs
  // reference this user; a hard DELETE either cascades into the CRM's history or
  // fails on a foreign key.
  await query(
    `UPDATE users
        SET is_active = false, deactivated_at = NOW(), deleted_at = NOW(),
            invite_token = NULL, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );

  await query(
    `UPDATE employee_sessions
        SET is_active = false, session_end = NOW(), session_end_reason = 'removed_by_admin'
      WHERE user_id = $1 AND is_active = true AND organization_id = $2`,
    [id, orgId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "employee.remove",
    entityType: "user",
    entityId: id,
    oldValue: { name: before.name, email: before.email, role: before.role },
    newValue: { leadDisposition: disposition, leadsReassigned: reassigned },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    leadsReassigned: reassigned,
    message:
      `${before.name} removed from team.` +
      (reassigned > 0
        ? ` ${reassigned} lead${reassigned === 1 ? "" : "s"} ${
            disposition === "reassign" ? `reassigned to you` : "unassigned"
          }.`
        : ""),
  });
}
