// app/api/hr/employees/[id]/employment-history/route.ts
//
// GET  — list previous employment records
// POST — add a new employment record
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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

    // Verify employee belongs to this org.
    const emp = await query("SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL", [userId, orgId]);
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    const rows = await query<any>(
      `SELECT id, company_name, designation, employment_start, employment_end,
              reason_for_leaving, previous_salary, remarks, created_at
         FROM employee_employment_history
        WHERE user_id = $1 AND organization_id = $2
        ORDER BY employment_start DESC NULLS LAST`,
      [userId, orgId]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET employment-history]", err);
    return NextResponse.json({ success: false, message: "Failed to load history." }, { status: 500 });
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

    const emp = await query("SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL", [userId, orgId]);
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    const body = await req.json();
    const { companyName, designation, employmentStart, employmentEnd, reasonForLeaving, previousSalary, remarks } = body;

    if (!companyName?.trim()) {
      return NextResponse.json({ success: false, message: "Company name is required." }, { status: 400 });
    }

    const createdBy = getSessionUserId(gate.session);

    const result = await query<any>(
      `INSERT INTO employee_employment_history
         (user_id, organization_id, company_name, designation, employment_start,
          employment_end, reason_for_leaving, previous_salary, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        userId, orgId, companyName.trim(),
        designation?.trim() || null,
        employmentStart || null,
        employmentEnd || null,
        reasonForLeaving?.trim() || null,
        previousSalary != null ? previousSalary : null,
        remarks?.trim() || null,
        createdBy,
      ]
    );

    return NextResponse.json(
      { success: true, id: result[0].id, message: "Employment record added." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST employment-history]", err);
    return NextResponse.json({ success: false, message: "Failed to add record." }, { status: 500 });
  }
}
