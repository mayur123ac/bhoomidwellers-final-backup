import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { joinName, avatarSrc, initialsFor } from "@/lib/settingsUser";
import { propagateUserRename } from "@/lib/renameUserReferences";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { EmailService } from "@/lib/email/EmailService";
import { isMailConfigured, readSenderConfig } from "@/lib/email/config";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "receptionist", "sales_manager", "site_head", "sourcing_manager"];
const DEPARTMENTS = ["Sales", "Marketing", "Operations", "Finance", "HR", "IT", "Management"];
const INVITE_EXPIRY_DAYS = 7;

function deriveStatus(row: any): "active" | "pending" | "inactive" {
  if (!row.is_active) return "inactive";
  if (!row.first_login_at && !row.last_login_at) return "pending";
  return "active";
}

function serializeEmployee(row: any) {
  const status = deriveStatus(row);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    department: row.department,
    isActive: row.is_active,
    status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActiveAt: row.last_login_at,
    firstLoginAt: row.first_login_at,
    inviteSentAt: row.invite_sent_at,
    inviteExpired: row.invite_sent_at
      ? new Date(row.invite_sent_at).getTime() + INVITE_EXPIRY_DAYS * 86_400_000 < Date.now()
      : false,
    deactivatedAt: row.deactivated_at,
    avatarUrl: avatarSrc(row),
    initials: initialsFor(row.name),
    reportingManagerId: row.reporting_manager_id,
    reportingManagerName: row.manager_name ?? null,
    salesFormException: row.sales_form_exception ?? false,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashPassword(raw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(raw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** Verify user belongs to this admin's org. Super admins bypass the org check. */
async function verifyOwnership(
  userId: number,
  orgId: string | null
): Promise<{ owned: boolean; row?: any }> {
  if (!orgId) {
    // Super admin — verify user exists and is not deleted
    const rows = await query<any>(
      `SELECT id, organization_id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    return { owned: rows.length > 0, row: rows[0] };
  }
  const rows = await query<any>(
    `SELECT id, organization_id FROM users
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [userId, orgId]
  );
  return { owned: rows.length > 0, row: rows[0] };
}

async function getOrgName(orgId: string | null): Promise<string> {
  if (!orgId) return "Bhoomi Dwellers";
  const rows = await query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );
  return rows[0]?.name ?? "Bhoomi Dwellers";
}

async function sendInviteEmail(
  employeeId: number,
  employeeEmail: string,
  employeeName: string,
  role: string,
  orgId: string | null,
  invitedById: number,
  invitedByName: string | null,
  ip: string | null,
  userAgent: string | null
): Promise<{ delivered: boolean; token?: string }> {
  if (!isMailConfigured()) {
    return { delivered: false };
  }

  const token = generateInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86_400_000);

  // Invalidate any existing unused invitations for this user
  await query(
    `UPDATE employee_invitations SET consumed_at = NOW()
     WHERE user_id = $1 AND consumed_at IS NULL`,
    [employeeId]
  );

  // Store the invitation
  await query(
    `INSERT INTO employee_invitations
       (user_id, token_hash, organization_id, invited_by, email, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [employeeId, tokenHash, orgId, invitedById, employeeEmail, expiresAt]
  );

  const orgName = await getOrgName(orgId);
  const appUrl = readSenderConfig().appUrl;
  const inviteUrl = appUrl
    ? `${appUrl}/accept-invite?token=${token}`
    : "";

  const result = await EmailService.sendEmployeeInvitation(
    employeeEmail,
    {
      name: employeeName,
      organization: orgName,
      role,
      inviteUrl,
      expiryDays: INVITE_EXPIRY_DAYS,
      invitedBy: invitedByName,
    },
    { userId: invitedById, ip, userAgent }
  );

  if (result.delivered) {
    await query(
      `UPDATE users SET invite_sent_at = NOW() WHERE id = $1`,
      [employeeId]
    );
  }

  return { delivered: result.delivered, token };
}

// GET /api/settings/employees
export async function GET(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "all";
  const role = url.searchParams.get("role") || "all";
  const department = url.searchParams.get("department") || "all";

  try {
    const conditions: string[] = ["e.deleted_at IS NULL"];
    const params: any[] = [];
    let idx = 1;

    if (orgId) {
      conditions.push(`e.organization_id = $${idx++}`);
      params.push(orgId);
    }

    if (search) {
      conditions.push(`(e.name ILIKE $${idx} OR e.email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    if (status === "active") {
      conditions.push(`e.is_active = true`);
    } else if (status === "inactive") {
      conditions.push(`e.is_active = false`);
    }

    if (role !== "all") {
      conditions.push(`LOWER(REPLACE(e.role, ' ', '_')) = LOWER($${idx++})`);
      params.push(role);
    }

    if (department !== "all") {
      conditions.push(`e.department = $${idx++}`);
      params.push(department);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await query<any>(
      `SELECT e.id, e.name, e.email, e.phone, e.role, e.department, e.is_active,
              e.created_at, e.last_login_at, e.first_login_at, e.invite_sent_at,
              e.deactivated_at, e.avatar_key, e.avatar_url, e.reporting_manager_id,
              e.sales_form_exception,
              m.name AS manager_name
       FROM users e
       LEFT JOIN users m ON m.id = e.reporting_manager_id
       ${where}
       ORDER BY e.name ASC`,
      params
    );

    const employees = rows.map(serializeEmployee);

    const counts = {
      all: employees.length,
      active: employees.filter((e) => e.status === "active").length,
      pending: employees.filter((e) => e.status === "pending").length,
      inactive: employees.filter((e) => e.status === "inactive").length,
    };

    const managerConditions = ["deleted_at IS NULL", "is_active = true"];
    const managerParams: any[] = [];
    if (orgId) {
      managerConditions.push(`organization_id = $1`);
      managerParams.push(orgId);
    }
    const managers = await query<any>(
      `SELECT id, name, role FROM users
       WHERE ${managerConditions.join(" AND ")}
       ORDER BY name ASC`,
      managerParams
    );

    const inviteEmailConfigured = isMailConfigured();

    return NextResponse.json({
      success: true,
      employees,
      counts,
      catalogue: {
        roles: ROLES,
        departments: DEPARTMENTS,
        managers: managers.map((m: any) => ({ id: m.id, name: m.name, role: m.role })),
      },
      inviteEmailConfigured,
    });
  } catch (err: any) {
    console.error("[GET /api/settings/employees]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/employees — create
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    const body = await req.json();
    const name = joinName(body.firstName, body.lastName);

    if (!name.trim()) {
      return NextResponse.json({ success: false, message: "Name is required." }, { status: 400 });
    }
    if (!body.email?.trim()) {
      return NextResponse.json({ success: false, message: "Email is required." }, { status: 400 });
    }

    // Check duplicate email (platform-wide — email is the login identity)
    const existing = await query<any>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [body.email.trim()]
    );
    if (existing.length > 0) {
      return NextResponse.json({ success: false, message: "An employee with this email already exists." }, { status: 409 });
    }

    // Reporting manager must belong to the same org
    if (body.reportingManagerId && orgId) {
      const mgr = await verifyOwnership(body.reportingManagerId, orgId);
      if (!mgr.owned) {
        return NextResponse.json({ success: false, message: "Invalid reporting manager." }, { status: 400 });
      }
    }

    // Password handling:
    // - If sendInvite AND no password: generate a temporary one so the account
    //   is usable via direct login as a fallback, but the primary path is the
    //   invitation link.
    // - If password provided: use it.
    // - If neither invite nor password: auto-generate and return it.
    let rawPassword = body.tempPassword || body.password || "";
    let temporaryPassword: string | null = null;

    if (!rawPassword) {
      rawPassword = randomBytes(12).toString("base64url");
      temporaryPassword = rawPassword;
    } else {
      temporaryPassword = rawPassword;
    }

    const hashedPassword = hashPassword(rawPassword);

    const rows = await query<any>(
      `INSERT INTO users (name, email, phone, role, department, reporting_manager_id,
                          organization_id, is_active, password, sales_form_exception, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, NOW())
       RETURNING id`,
      [
        name,
        body.email.trim(),
        body.phone?.trim() || null,
        body.role || "sales_manager",
        body.department || null,
        body.reportingManagerId || null,
        orgId || null,
        hashedPassword,
        Boolean(body.salesFormException),
      ]
    );

    const newUserId = rows[0]?.id;

    // Send invite email if requested — AFTER the user row exists
    let inviteDelivered = false;
    if (body.sendInvite && newUserId) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const userAgent = req.headers.get("user-agent") ?? null;

      try {
        const result = await sendInviteEmail(
          newUserId,
          body.email.trim(),
          name,
          body.role || "sales_manager",
          orgId,
          gate.userId!,
          gate.session.name ?? null,
          ip,
          userAgent
        );
        inviteDelivered = result.delivered;
      } catch (err: any) {
        console.error("[POST /api/settings/employees] invite email failed:", err?.message);
        // The employee was created; email failure is surfaced but not fatal.
      }
    }

    return NextResponse.json({
      success: true,
      message: inviteDelivered
        ? "Employee created and invite sent."
        : body.sendInvite && !inviteDelivered
          ? "Employee created but the invitation email could not be delivered. Check email configuration."
          : temporaryPassword
            ? "Employee created with temporary password."
            : "Employee created.",
      id: newUserId,
      temporaryPassword: inviteDelivered ? null : temporaryPassword,
      inviteDelivered,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/employees]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/employees — update, bulk status, resend invite, set status
export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    const body = await req.json();

    // Bulk status change
    if (body.action === "bulkStatus" && Array.isArray(body.ids)) {
      const ids = body.ids.filter((id: any) => typeof id === "number");
      if (ids.length === 0) {
        return NextResponse.json({ success: false, message: "No employees selected." }, { status: 400 });
      }

      // Verify all IDs belong to this org
      if (orgId) {
        const owned = await query<{ id: number }>(
          `SELECT id FROM users WHERE id = ANY($1::int[]) AND organization_id = $2 AND deleted_at IS NULL`,
          [ids, orgId]
        );
        const ownedIds = new Set(owned.map((r) => r.id));
        const unowned = ids.filter((id: number) => !ownedIds.has(id));
        if (unowned.length > 0) {
          return NextResponse.json(
            { success: false, message: `${unowned.length} employee(s) not found in your organization.` },
            { status: 403 }
          );
        }
      }

      await query(
        `UPDATE users SET is_active = $1, deactivated_at = CASE WHEN $1 THEN NULL ELSE NOW() END
         WHERE id = ANY($2::int[])${orgId ? ` AND organization_id = $3` : ""} AND deleted_at IS NULL`,
        orgId ? [Boolean(body.isActive), ids, orgId] : [Boolean(body.isActive), ids]
      );
      return NextResponse.json({
        success: true,
        message: `${ids.length} employee(s) ${body.isActive ? "activated" : "deactivated"}.`,
      });
    }

    // Set single status
    if (body.action === "setStatus" && body.id) {
      const check = await verifyOwnership(body.id, orgId);
      if (!check.owned) {
        return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
      }

      await query(
        `UPDATE users SET is_active = $1, deactivated_at = CASE WHEN $1 THEN NULL ELSE NOW() END
         WHERE id = $2`,
        [Boolean(body.isActive), body.id]
      );
      return NextResponse.json({
        success: true,
        message: body.isActive ? "Employee activated." : "Employee deactivated.",
      });
    }

    // Resend invite
    if (body.action === "resendInvite" && body.id) {
      const check = await verifyOwnership(body.id, orgId);
      if (!check.owned) {
        return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
      }

      // Look up the employee's email and details for the invitation
      const empRows = await query<{ email: string; name: string; role: string }>(
        `SELECT email, name, role FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [body.id]
      );
      if (empRows.length === 0) {
        return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
      }

      const emp = empRows[0];
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const userAgent = req.headers.get("user-agent") ?? null;

      try {
        const result = await sendInviteEmail(
          body.id,
          emp.email,
          emp.name,
          emp.role,
          orgId,
          gate.userId!,
          gate.session.name ?? null,
          ip,
          userAgent
        );

        if (!result.delivered) {
          return NextResponse.json({
            success: false,
            message: "Invite email could not be delivered. Check email configuration.",
          }, { status: 503 });
        }

        return NextResponse.json({
          success: true,
          message: "Invite email sent.",
          inviteDelivered: true,
        });
      } catch (err: any) {
        console.error("[PATCH /api/settings/employees] resend invite failed:", err?.message);
        return NextResponse.json({
          success: false,
          message: "Failed to send invite email.",
        }, { status: 500 });
      }
    }

    // Update single employee
    if (body.id) {
      const check = await verifyOwnership(body.id, orgId);
      if (!check.owned) {
        return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
      }

      const name = joinName(body.firstName, body.lastName);
      if (!name.trim()) {
        return NextResponse.json({ success: false, message: "Name is required." }, { status: 400 });
      }

      // Reporting manager must belong to the same org
      if (body.reportingManagerId && orgId) {
        const mgr = await verifyOwnership(body.reportingManagerId, orgId);
        if (!mgr.owned) {
          return NextResponse.json({ success: false, message: "Invalid reporting manager." }, { status: 400 });
        }
      }

      const existingRows = await query<{ name: string }>(
        `SELECT name FROM users WHERE id = $1 LIMIT 1`,
        [body.id]
      );
      const oldName = existingRows[0]?.name ?? null;

      const sets = [
        "name = $1", "email = $2", "phone = $3", "role = $4",
        "department = $5", "reporting_manager_id = $6", "sales_form_exception = $7",
      ];
      const params: any[] = [
        name, body.email?.trim(), body.phone?.trim() || null,
        body.role || null, body.department || null,
        body.reportingManagerId || null,
        Boolean(body.salesFormException),
      ];
      let idx = 8;

      if (body.password) {
        sets.push(`password = $${idx++}`);
        params.push(hashPassword(body.password));
      }

      params.push(body.id);
      await query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`,
        params
      );

      if (oldName && oldName.trim() !== name.trim()) {
        propagateUserRename(oldName, name).catch((e: any) =>
          console.error("[PATCH /api/settings/employees] propagateUserRename failed:", e?.message)
        );
      }

      return NextResponse.json({ success: true, message: "Employee updated." });
    }

    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  } catch (err: any) {
    console.error("[PATCH /api/settings/employees]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// DELETE /api/settings/employees
export async function DELETE(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ success: false, message: "Employee ID is required." }, { status: 400 });
    }

    const check = await verifyOwnership(body.id, orgId);
    if (!check.owned) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    await query(
      `UPDATE users SET deleted_at = NOW(), is_active = false, deactivated_at = NOW() WHERE id = $1`,
      [body.id]
    );

    return NextResponse.json({ success: true, message: "Employee removed." });
  } catch (err: any) {
    console.error("[DELETE /api/settings/employees]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
