import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json({ success: false, error: "Organization not found" }, { status: 403 });
    }

    const body = await req.json();
    const {
      brokerageRate,
      brokerageMethod,
      status,
      receivedAmount,
      receivedDate,
      reversalReason,
      notes,
    } = body;

    const result = await transaction(async (client) => {
      // 1. Fetch current record
      const existingResult = await client.query(
        `SELECT * FROM booking_brokerage WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      );

      if (existingResult.rows.length === 0) {
        throw new Error("Brokerage record not found");
      }

      const current = existingResult.rows[0];
      const oldValues = { ...current };

      // 2. Build SET clause
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      let newBrokerageRate = current.brokerage_rate;
      let newBrokerageMethod = current.brokerage_method;
      let rateChanged = false;

      if (brokerageRate !== undefined) {
        newBrokerageRate = brokerageRate;
        setClauses.push(`brokerage_rate = $${paramIndex++}`);
        values.push(brokerageRate);
        rateChanged = true;
      }

      if (brokerageMethod !== undefined) {
        newBrokerageMethod = brokerageMethod;
        setClauses.push(`brokerage_method = $${paramIndex++}`);
        values.push(brokerageMethod);
        rateChanged = true;
      }

      // 3. Recalculate brokerage_amount if rate or method changed
      if (rateChanged) {
        const agreementValue = parseFloat(current.agreement_value_snapshot) || 0;
        let brokerageAmount: number;

        if (newBrokerageMethod === "fixed") {
          brokerageAmount = parseFloat(newBrokerageRate) || 0;
        } else {
          brokerageAmount = (agreementValue * (parseFloat(newBrokerageRate) || 0)) / 100;
        }

        setClauses.push(`brokerage_amount = $${paramIndex++}`);
        values.push(brokerageAmount);

        setClauses.push(`source = $${paramIndex++}`);
        values.push("manual_override");
      }

      if (status !== undefined) {
        const validStatuses = ["expected", "received", "partially_received", "pending", "reversed"];
        if (!validStatuses.includes(status)) {
          throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
        }
        setClauses.push(`status = $${paramIndex++}`);
        values.push(status);
      }

      if (receivedAmount !== undefined) {
        setClauses.push(`received_amount = $${paramIndex++}`);
        values.push(receivedAmount);
      }

      if (receivedDate !== undefined) {
        setClauses.push(`received_date = $${paramIndex++}`);
        values.push(receivedDate);
      }

      if (reversalReason !== undefined) {
        setClauses.push(`reversal_reason = $${paramIndex++}`);
        values.push(reversalReason);
      }

      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIndex++}`);
        values.push(notes);
      }

      if (setClauses.length === 0) {
        throw new Error("No fields to update");
      }

      setClauses.push(`updated_by = $${paramIndex++}`);
      values.push(gate.userId);
      setClauses.push(`updated_at = NOW()`);

      values.push(id);
      const idParam = paramIndex++;
      values.push(orgId);
      const orgParam = paramIndex++;

      // 4. Execute update
      const updateResult = await client.query(
        `UPDATE booking_brokerage
         SET ${setClauses.join(", ")}
         WHERE id = $${idParam} AND organization_id = $${orgParam}
         RETURNING *`,
        values
      );

      const updated = updateResult.rows[0];

      // 5. Audit log
      await client.query(
        `INSERT INTO brokerage_audit_log
         (organization_id, entity_type, entity_id, action, old_values, new_values, changed_by)
         VALUES ($1, 'booking_brokerage', $2, 'updated',
                 $3::jsonb, $4::jsonb, $5)`,
        [
          orgId,
          id,
          JSON.stringify(oldValues),
          JSON.stringify(updated),
          gate.userId,
        ]
      );

      return updated;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error("PATCH /api/hr/booking-brokerage/[id] error:", error);
    const status = error.message === "Brokerage record not found" ? 404
      : error.message === "No fields to update" ? 400
      : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status }
    );
  }
}
