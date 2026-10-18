// app/api/hr/employees/[id]/leaves/allocations/route.ts
//
// GET — view leave entitlements for an employee for a year
// PUT — set/update leave entitlements (HR-managed, no defaults)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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

    const year = Number(req.nextUrl.searchParams.get("year") || new Date().getFullYear());

    const rows = await query<any>(
      `SELECT id, leave_type, year, allocated, used,
              (allocated - used) AS remaining,
              created_at, updated_at
         FROM employee_leave_allocations
        WHERE user_id = $1 AND organization_id = $2 AND year = $3
        ORDER BY leave_type ASC`,
      [userId, orgId, year]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET leave allocations]", err);
    return NextResponse.json({ success: false, message: "Failed to load allocations." }, { status: 500 });
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
    const { year, allocations } = body;

    if (!year || !Array.isArray(allocations)) {
      return NextResponse.json(
        { success: false, message: "year and allocations[] are required." },
        { status: 400 }
      );
    }

    const updatedBy = getSessionUserId(gate.session);

    // Verify employee exists
    const emp = await query<any>(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
      [userId, orgId]
    );
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    for (const alloc of allocations) {
      const { leaveType, allocated } = alloc;
      if (!(LEAVE_TYPES as readonly string[]).includes(leaveType)) continue;

      const numAllocated = Number(allocated);
      if (!Number.isFinite(numAllocated) || numAllocated < 0) continue;

      await query(
        `INSERT INTO employee_leave_allocations
           (user_id, organization_id, leave_type, year, allocated, used, created_by)
         VALUES ($1, $2, $3, $4, $5, 0, $6)
         ON CONFLICT (user_id, organization_id, leave_type, year)
         DO UPDATE SET allocated = $5, updated_at = now(), updated_by = $6`,
        [userId, orgId, leaveType, year, numAllocated, updatedBy]
      );
    }

    return NextResponse.json({ success: true, message: "Allocations updated." });
  } catch (err: any) {
    console.error("[PUT leave allocations]", err);
    return NextResponse.json({ success: false, message: "Failed to update allocations." }, { status: 500 });
  }
}
