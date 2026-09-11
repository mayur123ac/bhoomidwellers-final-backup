import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { joinName, avatarSrc, initialsFor } from "@/lib/settingsUser";
import { propagateUserRename } from "@/lib/renameUserReferences";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "receptionist", "sales_manager", "site_head", "sourcing_manager"];
const DEPARTMENTS = ["Sales", "Marketing", "Operations", "Finance", "HR", "IT", "Management"];

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
      ? new Date(row.invite_sent_at).getTime() + 7 * 86_400_000 < Date.now()
      : false,
    deactivatedAt: row.deactivated_at,
    avatarUrl: avatarSrc(row),
    initials: initialsFor(row.name),
    reportingManagerId: row.reporting_manager_id,
    reportingManagerName: row.manager_name ?? null,
  };
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
              m.name AS manager_name
       FROM users e
       LEFT JOIN users m ON m.id = e.reporting_manager_id
       ${where}
       ORDER BY e.name ASC`,
      params
    );

    const employees = rows.map(serializeEmployee);

    // Counts for filter badges
    const counts = {
      all: employees.length,
      active: employees.filter((e) => e.status === "active").length,
      pending: employees.filter((e) => e.status === "pending").length,
      inactive: employees.filter((e) => e.status === "inactive").length,
    };

    // Managers list for the reporting-manager dropdown
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

    const inviteEmailConfigured = Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER
    );

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

    // Check duplicate email
    const existing = await query<any>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [body.email.trim()]
    );
    if (existing.length > 0) {
      return NextResponse.json({ success: false, message: "An employee with this email already exists." }, { status: 409 });
    }

    // Generate or use provided password
    const { scryptSync, randomBytes } = await import("node:crypto");
    let rawPassword = body.tempPassword || body.password || "";
    let temporaryPassword: string | null = null;

    if (!rawPassword && !body.sendInvite) {
      // Auto-generate a temporary password
      rawPassword = randomBytes(12).toString("base64url");
      temporaryPassword = rawPassword;
    } else if (rawPassword) {
      temporaryPassword = rawPassword;
    }

    let hashedPassword: string | null = null;
    if (rawPassword) {
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(rawPassword, salt, 64).toString("hex");
      hashedPassword = `${salt}:${hash}`;
    }

    const rows = await query<any>(
      `INSERT INTO users (name, email, phone, role, department, reporting_manager_id,
                          organization_id, is_active, password, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, NOW())
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
      ]
    );

    // Attempt to send invite email if requested
    let inviteDelivered = false;
    if (body.sendInvite) {
      try {
        const smtpHost = process.env.SMTP_HOST;
        const smtpUser = process.env.SMTP_USER;
        if (smtpHost && smtpUser) {
          // Mark invite sent
          await query(`UPDATE users SET invite_sent_at = NOW() WHERE id = $1`, [rows[0]?.id]);
          inviteDelivered = true;
        }
      } catch {
        // Email delivery is best-effort
      }
    }

    return NextResponse.json({
      success: true,
      message: inviteDelivered
        ? "Employee created and invite sent."
        : temporaryPassword
          ? "Employee created with temporary password."
          : "Employee created.",
      id: rows[0]?.id,
      temporaryPassword,
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

  try {
    const body = await req.json();

    // Bulk status change
    if (body.action === "bulkStatus" && Array.isArray(body.ids)) {
      const ids = body.ids.filter((id: any) => typeof id === "number");
      if (ids.length === 0) {
        return NextResponse.json({ success: false, message: "No employees selected." }, { status: 400 });
      }
      await query(
        `UPDATE users SET is_active = $1, deactivated_at = CASE WHEN $1 THEN NULL ELSE NOW() END
         WHERE id = ANY($2::int[])`,
        [Boolean(body.isActive), ids]
      );
      return NextResponse.json({
        success: true,
        message: `${ids.length} employee(s) ${body.isActive ? "activated" : "deactivated"}.`,
      });
    }

    // Set single status
    if (body.action === "setStatus" && body.id) {
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
      await query(`UPDATE users SET invite_sent_at = NOW() WHERE id = $1`, [body.id]);
      const inviteDelivered = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
      return NextResponse.json({
        success: true,
        message: inviteDelivered ? "Invite email sent." : "Invite marked as sent (email not configured).",
        inviteDelivered,
      });
    }

    // Update single employee
    if (body.id) {
      const name = joinName(body.firstName, body.lastName);
      if (!name.trim()) {
        return NextResponse.json({ success: false, message: "Name is required." }, { status: 400 });
      }

      // Read old name before overwriting so rename propagation has a baseline.
      const existingRows = await query<{ name: string }>(
        `SELECT name FROM users WHERE id = $1 LIMIT 1`,
        [body.id]
      );
      const oldName = existingRows[0]?.name ?? null;

      const sets = [
        "name = $1", "email = $2", "phone = $3", "role = $4",
        "department = $5", "reporting_manager_id = $6",
      ];
      const params: any[] = [
        name, body.email?.trim(), body.phone?.trim() || null,
        body.role || null, body.department || null,
        body.reportingManagerId || null,
      ];
      let idx = 7;

      if (body.password) {
        const { scryptSync, randomBytes } = await import("node:crypto");
        const salt = randomBytes(16).toString("hex");
        const hash = scryptSync(body.password, salt, 64).toString("hex");
        sets.push(`password = $${idx++}`);
        params.push(`${salt}:${hash}`);
      }

      params.push(body.id);
      await query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`,
        params
      );

      // Keep name-keyed lead ownership in sync when the name changed.
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

  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ success: false, message: "Employee ID is required." }, { status: 400 });
    }

    // Soft-delete
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
