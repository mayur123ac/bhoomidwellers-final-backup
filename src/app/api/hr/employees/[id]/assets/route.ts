// app/api/hr/employees/[id]/assets/route.ts
//
// GET  — list asset assignments for an employee
// POST — assign an asset to this employee
// PUT  — record an asset return
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

    const rows = await query<any>(
      `SELECT a.id AS assignment_id, ca.id AS asset_id,
              ca.asset_name, ca.asset_type, ca.serial_number, ca.make_model,
              ca.current_condition, ca.purchase_value,
              a.assigned_date, a.expected_return, a.returned_date,
              a.condition_on_return, a.remarks,
              ab.name AS assigned_by_name,
              rt.name AS returned_to_name
         FROM employee_asset_assignments a
         JOIN company_assets ca ON ca.id = a.asset_id
         LEFT JOIN users ab ON ab.id = a.assigned_by
         LEFT JOIN users rt ON rt.id = a.returned_to
        WHERE a.user_id = $1 AND a.organization_id = $2
        ORDER BY a.assigned_date DESC`,
      [userId, orgId]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET employee assets]", err);
    return NextResponse.json({ success: false, message: "Failed to load assets." }, { status: 500 });
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
    const { assetId, assignedDate, expectedReturn, remarks } = body;

    if (!assetId) {
      return NextResponse.json({ success: false, message: "Asset ID is required." }, { status: 400 });
    }

    const assignedBy = getSessionUserId(gate.session);

    const result = await transaction(async (client) => {
      // Verify employee.
      const emp = await client.query(
        "SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
        [userId, orgId]
      );
      if (emp.rows.length === 0) throw new Error("EMP_NOT_FOUND");

      // Verify asset belongs to org and is available.
      const asset = await client.query(
        "SELECT id, asset_status FROM company_assets WHERE id = $1 AND organization_id = $2",
        [assetId, orgId]
      );
      if (asset.rows.length === 0) throw new Error("ASSET_NOT_FOUND");
      if (asset.rows[0].asset_status !== "available") throw new Error("ASSET_NOT_AVAILABLE");

      // Create assignment.
      const ins = await client.query(
        `INSERT INTO employee_asset_assignments
           (asset_id, user_id, organization_id, assigned_date, expected_return, remarks, assigned_by)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7)
         RETURNING id`,
        [
          assetId, userId, orgId,
          assignedDate || new Date().toISOString().slice(0, 10),
          expectedReturn || null,
          remarks?.trim() || null,
          assignedBy,
        ]
      );

      // Mark asset as assigned.
      await client.query(
        "UPDATE company_assets SET asset_status = 'assigned', updated_at = now() WHERE id = $1",
        [assetId]
      );

      return ins.rows[0].id;
    });

    return NextResponse.json(
      { success: true, id: result, message: "Asset assigned." },
      { status: 201 }
    );
  } catch (err: any) {
    if (err.message === "EMP_NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }
    if (err.message === "ASSET_NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Asset not found." }, { status: 404 });
    }
    if (err.message === "ASSET_NOT_AVAILABLE") {
      return NextResponse.json({ success: false, message: "Asset is not available for assignment." }, { status: 409 });
    }
    console.error("[POST employee assets]", err);
    return NextResponse.json({ success: false, message: "Failed to assign asset." }, { status: 500 });
  }
}

// PUT — record return of an asset.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _userId } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const body = await req.json();
    const { assignmentId, conditionOnReturn, remarks } = body;

    if (!assignmentId) {
      return NextResponse.json({ success: false, message: "Assignment ID is required." }, { status: 400 });
    }

    const returnedTo = getSessionUserId(gate.session);

    await transaction(async (client) => {
      const asgn = await client.query(
        `SELECT a.id, a.asset_id FROM employee_asset_assignments a
          WHERE a.id = $1 AND a.organization_id = $2 AND a.returned_date IS NULL`,
        [assignmentId, orgId]
      );
      if (asgn.rows.length === 0) throw new Error("NOT_FOUND");

      await client.query(
        `UPDATE employee_asset_assignments
            SET returned_date = CURRENT_DATE,
                condition_on_return = $2,
                remarks = COALESCE($3, remarks),
                returned_to = $4
          WHERE id = $1`,
        [assignmentId, conditionOnReturn || "good", remarks?.trim() || null, returnedTo]
      );

      // Mark asset as available again.
      await client.query(
        `UPDATE company_assets
            SET asset_status = 'available',
                current_condition = COALESCE($2, current_condition),
                updated_at = now()
          WHERE id = $1`,
        [asgn.rows[0].asset_id, conditionOnReturn || null]
      );
    });

    return NextResponse.json({ success: true, message: "Asset returned." });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Assignment not found or already returned." }, { status: 404 });
    }
    console.error("[PUT employee assets]", err);
    return NextResponse.json({ success: false, message: "Failed to record return." }, { status: 500 });
  }
}
