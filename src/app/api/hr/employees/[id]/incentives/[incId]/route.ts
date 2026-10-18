// app/api/hr/employees/[id]/incentives/[incId]/route.ts
//
// PATCH — adjust an incentive entry (audited: approve, reverse, or edit amount)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; incId: string }> }
) {
  const { id, incId } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    const incentiveId = Number(incId);

    if (!Number.isInteger(userId) || !Number.isInteger(incentiveId)) {
      return NextResponse.json({ success: false, message: "Invalid IDs." }, { status: 400 });
    }

    const body = await req.json();
    const { action, amount, description, reason } = body;

    if (!action) {
      return NextResponse.json(
        { success: false, message: "Action is required (approve, reverse, adjust)." },
        { status: 400 }
      );
    }

    const changedBy = getSessionUserId(gate.session);

    await transaction(async (client) => {
      // Fetch with row lock
      const current = await client.query(
        `SELECT * FROM employee_incentives
          WHERE id = $1 AND user_id = $2 AND organization_id = $3
          FOR UPDATE`,
        [incentiveId, userId, orgId]
      );

      if (current.rows.length === 0) throw new Error("NOT_FOUND");
      const old = current.rows[0];

      if (action === "approve") {
        if (old.status !== "pending") throw new Error("NOT_PENDING");

        await client.query(
          `UPDATE employee_incentives
              SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
            WHERE id = $1`,
          [incentiveId, changedBy]
        );

        await client.query(
          `INSERT INTO employee_incentive_history
             (incentive_id, action, old_values, new_values, reason, changed_by)
           VALUES ($1, 'approved', $2, $3, $4, $5)`,
          [
            incentiveId,
            JSON.stringify({ status: old.status }),
            JSON.stringify({ status: "approved" }),
            reason?.trim() || null,
            changedBy,
          ]
        );
      } else if (action === "reverse") {
        if (old.status === "reversed") throw new Error("ALREADY_REVERSED");
        if (!reason?.trim()) throw new Error("REASON_REQUIRED");

        await client.query(
          `UPDATE employee_incentives
              SET status = 'reversed', reversal_reason = $2,
                  reversed_at = now(), reversed_by = $3, updated_at = now()
            WHERE id = $1`,
          [incentiveId, reason.trim(), changedBy]
        );

        await client.query(
          `INSERT INTO employee_incentive_history
             (incentive_id, action, old_values, new_values, reason, changed_by)
           VALUES ($1, 'reversed', $2, $3, $4, $5)`,
          [
            incentiveId,
            JSON.stringify({ status: old.status, amount: old.amount }),
            JSON.stringify({ status: "reversed" }),
            reason.trim(),
            changedBy,
          ]
        );
      } else if (action === "adjust") {
        if (old.status === "reversed" || old.status === "paid") throw new Error("CANNOT_ADJUST");
        if (!amount || Number(amount) <= 0) throw new Error("INVALID_AMOUNT");
        if (!reason?.trim()) throw new Error("REASON_REQUIRED");

        const newAmount = Number(amount);

        await client.query(
          `UPDATE employee_incentives
              SET amount = $2, description = COALESCE($3, description), updated_at = now()
            WHERE id = $1`,
          [incentiveId, newAmount, description?.trim() || null]
        );

        await client.query(
          `INSERT INTO employee_incentive_history
             (incentive_id, action, old_values, new_values, reason, changed_by)
           VALUES ($1, 'adjusted', $2, $3, $4, $5)`,
          [
            incentiveId,
            JSON.stringify({ amount: old.amount, description: old.description }),
            JSON.stringify({ amount: newAmount, description: description?.trim() || old.description }),
            reason.trim(),
            changedBy,
          ]
        );
      } else {
        throw new Error("INVALID_ACTION");
      }
    });

    return NextResponse.json({ success: true, message: `Incentive ${action}d.` });
  } catch (err: any) {
    const errorMap: Record<string, [string, number]> = {
      NOT_FOUND: ["Incentive not found.", 404],
      NOT_PENDING: ["Only pending incentives can be approved.", 409],
      ALREADY_REVERSED: ["Incentive is already reversed.", 409],
      CANNOT_ADJUST: ["Cannot adjust a reversed or paid incentive.", 409],
      REASON_REQUIRED: ["A reason is required for this action.", 400],
      INVALID_AMOUNT: ["A positive amount is required for adjustment.", 400],
      INVALID_ACTION: ["Action must be: approve, reverse, or adjust.", 400],
    };

    const mapped = errorMap[err.message];
    if (mapped) {
      return NextResponse.json({ success: false, message: mapped[0] }, { status: mapped[1] });
    }

    console.error("[PATCH incentive]", err);
    return NextResponse.json({ success: false, message: "Failed to update incentive." }, { status: 500 });
  }
}
