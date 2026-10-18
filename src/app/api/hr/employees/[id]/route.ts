// app/api/hr/employees/[id]/route.ts
//
// GET  /api/hr/employees/:id — full HR profile for one employee.
// PUT  /api/hr/employees/:id — update HR profile fields (designation, etc.).
//
// Gate: hr, admin. Salary fields require salary-view permission.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { evaluateCompleteness, ensureComplianceTasks } from "@/lib/hr/profileCompleteness";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { transaction } from "@/lib/db";
import { EMPLOYEE_CODE_PREFIX } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
    }

    // Profile + reporting manager in one query.
    const [profileRows, historyRows, salaryRows, docRows, assetRows] =
      await Promise.all([
        query<any>(
          `SELECT
             u.id, u.name, u.email, u.role, u.designation, u.department,
             u.employee_code, u.date_of_birth, u.joining_date,
             u.employment_status, u.employment_type, u.is_active,
             u.personal_phone, u.emergency_contact_name, u.emergency_contact_phone,
             u.blood_group, u.current_address, u.permanent_address,
             u.reporting_manager_id, u.created_at,
             rm.name AS reporting_manager_name
           FROM users u
           LEFT JOIN users rm ON rm.id = u.reporting_manager_id
           WHERE u.id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`,
          [userId, orgId]
        ),
        query<any>(
          `SELECT id, company_name, designation, employment_start, employment_end,
                  reason_for_leaving, remarks, created_at
             FROM employee_employment_history
            WHERE user_id = $1 AND organization_id = $2
            ORDER BY employment_start DESC NULLS LAST`,
          [userId, orgId]
        ),
        // Salary visible to hr/admin
        query<any>(
          `SELECT id, base_salary, effective_from, effective_to, revision_reason, created_at
             FROM employee_salary_history
            WHERE user_id = $1 AND organization_id = $2
            ORDER BY effective_from DESC`,
          [userId, orgId]
        ),
        query<any>(
          `SELECT id, document_type, file_name, mime_type, verification_status,
                  verified_at, rejection_reason, expiry_date, version, created_at
             FROM employee_documents
            WHERE user_id = $1 AND organization_id = $2
              AND superseded_by IS NULL
            ORDER BY created_at DESC`,
          [userId, orgId]
        ),
        query<any>(
          `SELECT a.id AS assignment_id, ca.id AS asset_id, ca.asset_name, ca.asset_type,
                  ca.serial_number, ca.make_model,
                  a.assigned_date, a.returned_date, a.condition_on_return, a.remarks
             FROM employee_asset_assignments a
             JOIN company_assets ca ON ca.id = a.asset_id
            WHERE a.user_id = $1 AND a.organization_id = $2
            ORDER BY a.assigned_date DESC`,
          [userId, orgId]
        ),
      ]);

    if (profileRows.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    const profile = profileRows[0];
    const completeness = await evaluateCompleteness(userId, orgId);

    // Silently ensure compliance tasks for missing docs.
    if (completeness.missing.length > 0) {
      const hrUserId = getSessionUserId(gate.session);
      await ensureComplianceTasks(userId, orgId, completeness.missing, hrUserId);
    }

    return NextResponse.json({
      success: true,
      data: {
        profile: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          role: profile.role,
          designation: profile.designation,
          department: profile.department,
          employeeCode: profile.employee_code,
          dateOfBirth: profile.date_of_birth,
          joiningDate: profile.joining_date,
          employmentStatus: profile.employment_status,
          employmentType: profile.employment_type,
          isActive: profile.is_active,
          personalPhone: profile.personal_phone,
          emergencyContactName: profile.emergency_contact_name,
          emergencyContactPhone: profile.emergency_contact_phone,
          bloodGroup: profile.blood_group,
          currentAddress: profile.current_address,
          permanentAddress: profile.permanent_address,
          reportingManagerId: profile.reporting_manager_id,
          reportingManagerName: profile.reporting_manager_name,
          createdAt: profile.created_at,
        },
        completeness,
        employmentHistory: historyRows,
        salaryHistory: salaryRows.map((s: any) => ({
          id: s.id,
          baseSalary: s.base_salary,
          effectiveFrom: s.effective_from,
          effectiveTo: s.effective_to,
          revisionReason: s.revision_reason,
          createdAt: s.created_at,
        })),
        documents: docRows,
        assets: assetRows,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/employees/:id]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load employee profile." },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
    }

    const body = await req.json();

    // Allowed HR profile fields — NOT salary, NOT role, NOT password.
    const ALLOWED = [
      "designation", "department", "employee_code", "date_of_birth",
      "joining_date", "employment_status", "employment_type",
      "personal_phone", "emergency_contact_name", "emergency_contact_phone",
      "blood_group", "current_address", "permanent_address",
      "reporting_manager_id",
    ] as const;

    // Fetch current values for audit logging (joining_date, employee_code)
    const currentRows = await query<any>(
      `SELECT joining_date, employee_code FROM users
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [userId, orgId]
    );
    if (currentRows.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }
    const currentProfile = currentRows[0];

    const sets: string[] = [];
    const vals: any[] = [];
    let p = 1;

    for (const col of ALLOWED) {
      const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[camel] !== undefined) {
        sets.push(`${col} = $${p++}`);
        vals.push(body[camel] === "" ? null : body[camel]);
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, message: "No fields to update." }, { status: 400 });
    }

    vals.push(userId, orgId);
    const result = await query<any>(
      `UPDATE users SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${p} AND organization_id = $${p + 1} AND deleted_at IS NULL
       RETURNING id`,
      vals
    );

    if (result.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    // Audit log for joining_date changes
    const hrUserId = getSessionUserId(gate.session);
    if (body.joiningDate !== undefined) {
      const oldDate = currentProfile.joining_date;
      const newDate = body.joiningDate || null;
      if (String(oldDate ?? "") !== String(newDate ?? "")) {
        const { ip, userAgent } = requestContext(req);
        void writeAuditLog({
          userId: hrUserId,
          action: "hr.joining_date_changed",
          entityType: "user",
          entityId: userId,
          oldValue: { joining_date: oldDate },
          newValue: { joining_date: newDate },
          ipAddress: ip,
          userAgent,
        });
      }
    }

    return NextResponse.json({ success: true, message: "Profile updated." });
  } catch (err: any) {
    console.error("[PUT /api/hr/employees/:id]", err);
    return NextResponse.json(
      { success: false, message: "Failed to update profile." },
      { status: 500 }
    );
  }
}

/**
 * Auto-generates an employee code. Format: BD-0001, BD-0002, etc.
 * Unique per organization. Uses an advisory lock inside a transaction
 * so concurrent requests cannot produce duplicate codes.
 */
export async function generateEmployeeCode(orgId: string): Promise<string> {
  return transaction(async (client) => {
    // Advisory lock keyed on a hash of the orgId to serialize code generation
    // within the same org. pg_advisory_xact_lock releases on COMMIT/ROLLBACK.
    const lockKey = Math.abs(hashCode(orgId));
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

    const result = await client.query(
      `SELECT COALESCE(
         MAX(CAST(SUBSTRING(employee_code FROM '[0-9]+$') AS INTEGER)), 0
       ) + 1 AS next_seq
       FROM users
       WHERE organization_id = $1 AND employee_code IS NOT NULL
         AND employee_code ~ '[0-9]+$'`,
      [orgId]
    );
    const seq = result.rows[0]?.next_seq ?? 1;
    return `${EMPLOYEE_CODE_PREFIX}-${String(seq).padStart(4, "0")}`;
  });
}

/** Simple string hash for advisory lock keys. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
