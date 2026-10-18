// app/api/hr/employees/route.ts
//
// GET /api/hr/employees — paginated HR employee directory with profile
// completeness, designation, department, joining date, and employment status.
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "50")));
    const offset = (page - 1) * limit;
    const search = (sp.get("search") || "").trim();
    const status = (sp.get("status") || "").trim();
    const completeness = sp.get("completeness"); // "complete" | "incomplete"

    const conditions: string[] = [
      "u.organization_id = $1",
      "u.deleted_at IS NULL",
    ];
    const values: any[] = [orgId];
    let idx = 2;

    if (search) {
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.employee_code ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    if (status === "active") {
      conditions.push("u.is_active = true");
    } else if (status === "inactive") {
      conditions.push("u.is_active = false");
    }

    const where = conditions.join(" AND ");

    // Completeness subquery: count mandatory docs fulfilled.
    // LEFT JOIN against hr_mandatory_documents + employee_documents to derive
    // fulfilled / total in SQL rather than N+1 calls.
    const completenessSelect = `
      COALESCE(md.total_mandatory, 0) AS total_mandatory,
      COALESCE(ed.fulfilled, 0) AS docs_fulfilled
    `;
    const completenessJoins = `
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_mandatory
          FROM hr_mandatory_documents m
         WHERE m.organization_id = u.organization_id AND m.is_active = true
      ) md ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT d.document_type) AS fulfilled
          FROM employee_documents d
          JOIN hr_mandatory_documents m2
            ON m2.organization_id = d.organization_id
           AND m2.document_type = d.document_type
           AND m2.is_active = true
         WHERE d.user_id = u.id
           AND d.organization_id = u.organization_id
           AND d.verification_status IN ('verified', 'pending')
           AND d.superseded_by IS NULL
      ) ed ON true
    `;

    let havingClause = "";
    if (completeness === "complete") {
      havingClause = "HAVING COALESCE(md.total_mandatory, 0) = COALESCE(ed.fulfilled, 0)";
    } else if (completeness === "incomplete") {
      havingClause = "HAVING COALESCE(md.total_mandatory, 0) > COALESCE(ed.fulfilled, 0)";
    }

    // Using a CTE so the HAVING filter applies before pagination.
    const sql = `
      WITH emp AS (
        SELECT
          u.id, u.name, u.email, u.role, u.designation, u.department,
          u.employee_code, u.joining_date, u.employment_status,
          u.employment_type, u.is_active, u.created_at,
          u.reporting_manager_id,
          rm.name AS reporting_manager_name,
          ${completenessSelect}
        FROM users u
        LEFT JOIN users rm ON rm.id = u.reporting_manager_id
        ${completenessJoins}
        WHERE ${where}
        GROUP BY u.id, rm.name, md.total_mandatory, ed.fulfilled
        ${havingClause}
      )
      SELECT *, (SELECT COUNT(*) FROM emp) AS _total
      FROM emp
      ORDER BY name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await query<any>(sql, values);
    const total = rows.length > 0 ? Number(rows[0]._total) : 0;

    const employees = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      designation: r.designation,
      department: r.department,
      employeeCode: r.employee_code,
      joiningDate: r.joining_date,
      employmentStatus: r.employment_status,
      employmentType: r.employment_type,
      isActive: r.is_active,
      reportingManager: r.reporting_manager_name,
      profileComplete: Number(r.total_mandatory) <= Number(r.docs_fulfilled),
      docsTotal: Number(r.total_mandatory),
      docsFulfilled: Number(r.docs_fulfilled),
    }));

    return NextResponse.json({
      success: true,
      data: {
        employees,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/employees]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load employees." },
      { status: 500 }
    );
  }
}
