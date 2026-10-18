// app/api/hr/employees/[id]/leaves/[leaveId]/route.ts
//
// PATCH — correct a leave record (audited edit with history)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { LEAVE_TYPES, LEAVE_STATUSES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; leaveId: string }> }
) {
  const { id, leaveId } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    const recordId = Number(leaveId);

    if (!Number.isInteger(userId) || !Number.isInteger(recordId)) {
      return NextResponse.json({ success: false, message: "Invalid IDs." }, { status: 400 });
    }

    const body = await req.json();
    const { leaveType, startDate, endDate, days, reason, status, correctionReason } = body;

    if (!correctionReason?.trim()) {
      return NextResponse.json(
        { success: false, message: "A correction reason is required for leave edits." },
        { status: 400 }
      );
    }

    const changedBy = getSessionUserId(gate.session);

    await transaction(async (client) => {
      // Fetch current record with row lock
      const current = await client.query(
        `SELECT * FROM employee_leave_records
          WHERE id = $1 AND user_id = $2 AND organization_id = $3
          FOR UPDATE`,
        [recordId, userId, orgId]
      );

      if (current.rows.length === 0) throw new Error("NOT_FOUND");
      const old = current.rows[0];

      // Build update
      const newLeaveType = leaveType && (LEAVE_TYPES as readonly string[]).includes(leaveType) ? leaveType : old.leave_type;
      const newStartDate = startDate || old.start_date;
      const newEndDate = endDate || old.end_date;
      const newDays = days != null ? Number(days) : old.days;
      const newReason = reason !== undefined ? (reason?.trim() || null) : old.reason;
      const newStatus = status && (LEAVE_STATUSES as readonly string[]).includes(status) ? status : old.status;

      if (newDays < 1 || !Number.isInteger(newDays)) throw new Error("INVALID_DAYS");

      // Record history
      const oldValues = {
        leave_type: old.leave_type,
        start_date: old.start_date,
        end_date: old.end_date,
        days: old.days,
        reason: old.reason,
        status: old.status,
      };
      const newValues = {
        leave_type: newLeaveType,
        start_date: newStartDate,
        end_date: newEndDate,
        days: newDays,
        reason: newReason,
        status: newStatus,
      };

      await client.query(
        `INSERT INTO employee_leave_record_history
           (leave_record_id, action, old_values, new_values, reason, changed_by)
         VALUES ($1, 'correction', $2, $3, $4, $5)`,
        [recordId, JSON.stringify(oldValues), JSON.stringify(newValues), correctionReason.trim(), changedBy]
      );

      // Update the record
      await client.query(
        `UPDATE employee_leave_records
            SET leave_type = $4, start_date = $5::date, end_date = $6::date,
                days = $7, reason = $8, status = $9, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
        [recordId, userId, orgId, newLeaveType, newStartDate, newEndDate, newDays, newReason, newStatus]
      );

      // Recalculate allocation used count for affected year(s)
      const years = new Set([
        new Date(old.start_date).getFullYear(),
        new Date(newStartDate).getFullYear(),
      ]);

      for (const yr of years) {
        // Recalculate total used from approved records for this type+year
        for (const lt of new Set([old.leave_type, newLeaveType])) {
          const sum = await client.query(
            `SELECT COALESCE(SUM(days), 0)::integer AS total_used
               FROM employee_leave_records
              WHERE user_id = $1 AND organization_id = $2
                AND leave_type = $3 AND status = 'approved'
                AND EXTRACT(YEAR FROM start_date) = $4`,
            [userId, orgId, lt, yr]
          );

          await client.query(
            `INSERT INTO employee_leave_allocations
               (user_id, organization_id, leave_type, year, allocated, used, created_by)
             VALUES ($1, $2, $3, $4, 0, $5, $6)
             ON CONFLICT (user_id, organization_id, leave_type, year)
             DO UPDATE SET used = $5, updated_at = now(), updated_by = $6`,
            [userId, orgId, lt, yr, sum.rows[0].total_used, changedBy]
          );
        }
      }
    });

    return NextResponse.json({ success: true, message: "Leave record corrected." });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Leave record not found." }, { status: 404 });
    }
    if (err.message === "INVALID_DAYS") {
      return NextResponse.json({ success: false, message: "Days must be a whole number >= 1." }, { status: 400 });
    }
    console.error("[PATCH leave record]", err);
    return NextResponse.json({ success: false, message: "Failed to update leave record." }, { status: 500 });
  }
}
