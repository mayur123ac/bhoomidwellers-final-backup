// app/api/hr/employees/[id]/leaves/route.ts
//
// GET  — list leave records + allocation summary for an employee
// POST — add a leave record (HR-managed, no self-service)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { LEAVE_TYPES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function GET(
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

    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") || new Date().getFullYear());

    const [allocations, records] = await Promise.all([
      query<any>(
        `SELECT id, leave_type, year, allocated, used,
                (allocated - used) AS remaining,
                updated_at
           FROM employee_leave_allocations
          WHERE user_id = $1 AND organization_id = $2 AND year = $3
          ORDER BY leave_type ASC`,
        [userId, orgId, year]
      ),
      query<any>(
        `SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days,
                lr.reason, lr.status, lr.created_by, cb.name AS created_by_name,
                lr.created_at, lr.updated_at
           FROM employee_leave_records lr
           LEFT JOIN users cb ON cb.id = lr.created_by
          WHERE lr.user_id = $1 AND lr.organization_id = $2
            AND EXTRACT(YEAR FROM lr.start_date) = $3
          ORDER BY lr.start_date DESC`,
        [userId, orgId, year]
      ),
    ]);

    return NextResponse.json({ success: true, data: { allocations, records, year } });
  } catch (err: any) {
    console.error("[GET employee leaves]", err);
    return NextResponse.json({ success: false, message: "Failed to load leave data." }, { status: 500 });
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
    const { leaveType, startDate, endDate, days, reason } = body;

    if (!leaveType || !startDate || !endDate || !days) {
      return NextResponse.json(
        { success: false, message: "leaveType, startDate, endDate, and days are required." },
        { status: 400 }
      );
    }

    if (!(LEAVE_TYPES as readonly string[]).includes(leaveType)) {
      return NextResponse.json(
        { success: false, message: `Invalid leave type. Must be one of: ${LEAVE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const numDays = Number(days);
    if (!Number.isInteger(numDays) || numDays < 1) {
      return NextResponse.json(
        { success: false, message: "Days must be a whole number >= 1." },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return NextResponse.json(
        { success: false, message: "Start date cannot be after end date." },
        { status: 400 }
      );
    }

    const createdBy = getSessionUserId(gate.session);

    const result = await transaction(async (client) => {
      // Verify employee exists
      const emp = await client.query(
        "SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
        [userId, orgId]
      );
      if (emp.rows.length === 0) throw new Error("EMP_NOT_FOUND");

      // Check for overlapping approved leave
      const overlap = await client.query(
        `SELECT id FROM employee_leave_records
          WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'
            AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]')`,
        [userId, orgId, startDate, endDate]
      );
      if (overlap.rows.length > 0) throw new Error("OVERLAP");

      // Insert leave record
      const ins = await client.query(
        `INSERT INTO employee_leave_records
           (user_id, organization_id, leave_type, start_date, end_date, days, reason, status, created_by)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, 'approved', $8)
         RETURNING id`,
        [userId, orgId, leaveType, startDate, endDate, numDays, reason?.trim() || null, createdBy]
      );

      // Update allocation used count (upsert allocation if not exists)
      const leaveYear = new Date(startDate).getFullYear();
      await client.query(
        `INSERT INTO employee_leave_allocations
           (user_id, organization_id, leave_type, year, allocated, used, created_by)
         VALUES ($1, $2, $3, $4, 0, $5, $6)
         ON CONFLICT (user_id, organization_id, leave_type, year)
         DO UPDATE SET used = employee_leave_allocations.used + $5,
                       updated_at = now(),
                       updated_by = $6`,
        [userId, orgId, leaveType, leaveYear, numDays, createdBy]
      );

      return ins.rows[0].id;
    });

    return NextResponse.json(
      { success: true, id: result, message: "Leave record created." },
      { status: 201 }
    );
  } catch (err: any) {
    if (err.message === "EMP_NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }
    if (err.message === "OVERLAP") {
      return NextResponse.json(
        { success: false, message: "Overlapping approved leave exists for this date range." },
        { status: 409 }
      );
    }
    console.error("[POST employee leaves]", err);
    return NextResponse.json({ success: false, message: "Failed to create leave record." }, { status: 500 });
  }
}
