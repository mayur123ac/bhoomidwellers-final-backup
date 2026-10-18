// app/api/hr/employees/[id]/salary/route.ts
//
// GET  — salary history (effective-dated records)
// POST — add a salary revision (closes previous active record)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

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

    const emp = await query("SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL", [userId, orgId]);
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    const rows = await query<any>(
      `SELECT id, base_salary, effective_from, effective_to, revision_reason,
              created_by, created_at
         FROM employee_salary_history
        WHERE user_id = $1 AND organization_id = $2
        ORDER BY effective_from DESC`,
      [userId, orgId]
    );

    // Current salary = row where effective_to IS NULL.
    const current = rows.find((r: any) => r.effective_to === null) || null;

    return NextResponse.json({
      success: true,
      data: {
        currentSalary: current
          ? { baseSalary: current.base_salary, effectiveFrom: current.effective_from }
          : null,
        history: rows.map((r: any) => ({
          id: r.id,
          baseSalary: r.base_salary,
          effectiveFrom: r.effective_from,
          effectiveTo: r.effective_to,
          revisionReason: r.revision_reason,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (err: any) {
    console.error("[GET salary]", err);
    return NextResponse.json({ success: false, message: "Failed to load salary." }, { status: 500 });
  }
}

export async function POST(
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
    const { baseSalary, effectiveFrom, revisionReason } = body;

    if (baseSalary == null || Number(baseSalary) < 0) {
      return NextResponse.json({ success: false, message: "Valid base salary is required." }, { status: 400 });
    }
    if (!effectiveFrom) {
      return NextResponse.json({ success: false, message: "Effective date is required." }, { status: 400 });
    }

    const createdBy = getSessionUserId(gate.session);

    const result = await transaction(async (client) => {
      // Verify employee in this org.
      const emp = await client.query(
        "SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
        [userId, orgId]
      );
      if (emp.rows.length === 0) throw new Error("NOT_FOUND");

      // Close previous active salary (set effective_to to the day before new one).
      const dayBefore = new Date(effectiveFrom);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayBeforeStr = dayBefore.toISOString().slice(0, 10);

      await client.query(
        `UPDATE employee_salary_history
            SET effective_to = $3::date
          WHERE user_id = $1 AND organization_id = $2 AND effective_to IS NULL`,
        [userId, orgId, dayBeforeStr]
      );

      // Insert new salary.
      const ins = await client.query(
        `INSERT INTO employee_salary_history
           (user_id, organization_id, base_salary, effective_from, revision_reason, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6)
         RETURNING id`,
        [userId, orgId, baseSalary, effectiveFrom, revisionReason?.trim() || null, createdBy]
      );

      return ins.rows[0].id;
    });

    return NextResponse.json(
      { success: true, id: result, message: "Salary revision recorded." },
      { status: 201 }
    );
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }
    console.error("[POST salary]", err);
    return NextResponse.json({ success: false, message: "Failed to add salary." }, { status: 500 });
  }
}
