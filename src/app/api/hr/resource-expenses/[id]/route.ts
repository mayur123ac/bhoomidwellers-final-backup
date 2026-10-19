import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json({ success: false, error: "Organization not found" }, { status: 403 });
    }

    const existing = await query<any>(
      `SELECT * FROM employee_resource_expenses WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );

    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: "Resource expense not found" }, { status: 404 });
    }

    const current = existing[0];
    const body = await req.json();
    const { status, description, notes, allocationMonths } = body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    if (allocationMonths !== undefined) {
      const months = parseInt(allocationMonths, 10);
      if (isNaN(months) || months < 1) {
        return NextResponse.json({ success: false, error: "allocationMonths must be at least 1" }, { status: 400 });
      }

      setClauses.push(`allocation_months = $${paramIndex++}`);
      values.push(months);

      const cost = parseFloat(current.purchase_cost) || 0;

      if (current.allocation_method === "monthly") {
        const newMonthlyAmount = cost / months;
        setClauses.push(`monthly_amount = $${paramIndex++}`);
        values.push(newMonthlyAmount);

        const endDate = new Date(current.allocation_start);
        endDate.setMonth(endDate.getMonth() + months);
        setClauses.push(`allocation_end = $${paramIndex++}`);
        values.push(endDate.toISOString().split("T")[0]);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);

    values.push(id);
    const idParam = paramIndex++;
    values.push(orgId);
    const orgParam = paramIndex++;

    const result = await query<any>(
      `UPDATE employee_resource_expenses
       SET ${setClauses.join(", ")}
       WHERE id = $${idParam} AND organization_id = $${orgParam}
       RETURNING *`,
      values
    );

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error: any) {
    console.error("PATCH /api/hr/resource-expenses/[id] error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json({ success: false, error: "Organization not found" }, { status: 403 });
    }

    const existing = await query<any>(
      `SELECT id FROM employee_resource_expenses WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );

    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: "Resource expense not found" }, { status: 404 });
    }

    await query(
      `UPDATE employee_resource_expenses
       SET status = 'written_off', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/hr/resource-expenses/[id] error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
