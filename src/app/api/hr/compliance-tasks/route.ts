// app/api/hr/compliance-tasks/route.ts
//
// GET  — list compliance tasks (missing document deadlines)
// PATCH — update a task (assign HR, change deadline, add notes)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || ""; // pending, overdue, resolved, all
    const employeeId = sp.get("employeeId");

    const conditions: string[] = ["t.organization_id = $1"];
    const values: any[] = [orgId];
    let idx = 2;

    if (status === "pending") {
      conditions.push("t.status = 'pending'");
    } else if (status === "overdue") {
      conditions.push("(t.status = 'pending' AND t.deadline < CURRENT_DATE)");
    } else if (status === "resolved") {
      conditions.push("t.status = 'resolved'");
    } else {
      // Default: show open tasks (pending + overdue).
      conditions.push("t.status IN ('pending', 'overdue')");
    }

    if (employeeId) {
      conditions.push(`t.user_id = $${idx++}`);
      values.push(Number(employeeId));
    }

    const rows = await query<any>(
      `SELECT t.id, t.user_id, u.name AS employee_name, u.email AS employee_email,
              t.document_type, t.status, t.deadline, t.notes,
              t.assigned_hr_id, hr.name AS assigned_hr_name,
              t.resolved_at, t.resolved_by, rb.name AS resolved_by_name,
              t.created_at, t.updated_at,
              CASE WHEN t.status = 'pending' AND t.deadline < CURRENT_DATE
                   THEN true ELSE false END AS is_overdue
         FROM hr_compliance_tasks t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN users hr ON hr.id = t.assigned_hr_id
         LEFT JOIN users rb ON rb.id = t.resolved_by
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          CASE WHEN t.deadline < CURRENT_DATE THEN 0 ELSE 1 END,
          t.deadline ASC NULLS LAST,
          u.name ASC`,
      values
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET compliance-tasks]", err);
    return NextResponse.json({ success: false, message: "Failed to load tasks." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const body = await req.json();
    const { taskId, assignedHrId, deadline, notes } = body;

    if (!taskId) {
      return NextResponse.json({ success: false, message: "Task ID is required." }, { status: 400 });
    }

    const sets: string[] = ["updated_at = now()"];
    const vals: any[] = [];
    let p = 1;

    if (assignedHrId !== undefined) {
      sets.push(`assigned_hr_id = $${p++}`);
      vals.push(assignedHrId || null);
    }
    if (deadline !== undefined) {
      sets.push(`deadline = $${p++}::date`);
      vals.push(deadline || null);
    }
    if (notes !== undefined) {
      sets.push(`notes = $${p++}`);
      vals.push(notes?.trim() || null);
    }

    vals.push(taskId, orgId);

    const result = await query<any>(
      `UPDATE hr_compliance_tasks
          SET ${sets.join(", ")}
        WHERE id = $${p} AND organization_id = $${p + 1}
          AND status IN ('pending', 'overdue')
        RETURNING id`,
      vals
    );

    if (result.length === 0) {
      return NextResponse.json({ success: false, message: "Task not found or already resolved." }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Task updated." });
  } catch (err: any) {
    console.error("[PATCH compliance-tasks]", err);
    return NextResponse.json({ success: false, message: "Failed to update task." }, { status: 500 });
  }
}
