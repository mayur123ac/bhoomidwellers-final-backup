// app/api/booking-applications/[id]/milestones/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAllowedRole(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return clean === "admin" || clean === "site_head" || clean === "site head";
}

// ─── POST — create/update payment milestones for a booking ───────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { milestones, user_name, user_role } = body;

    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isAllowedRole(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin and Site Head can modify payment milestones." }, { status: 403 });
    }
    if (!Array.isArray(milestones) || milestones.length === 0) {
      return NextResponse.json({ success: false, message: "milestones array is required" }, { status: 400 });
    }

    const bookingRes = await query<{ agreement_value: string }>(
      `SELECT agreement_value FROM booking_applications WHERE id = $1`,
      [Number(id)]
    );
    if (!bookingRes.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }
    const agreementVal = Number(bookingRes[0].agreement_value) || 0;

    const saved = await transaction(async (client) => {
      const existingRes = await client.query(
        `SELECT id, milestone_order FROM booking_payment_milestones WHERE booking_id = $1`,
        [Number(id)]
      );
      const existingByOrder = new Map<number, number>(
        existingRes.rows.map((r: any) => [Number(r.milestone_order), r.id])
      );

      const savedRows: any[] = [];
      const changeLog: any[] = [];

      for (const ms of milestones) {
        const milestoneOrder = Number(ms.milestone_order);
        if (!ms.milestone_name || !milestoneOrder) continue;

        // Percentage is authoritative — recompute demand_amount whenever it's supplied.
        const percentage = ms.percentage != null && ms.percentage !== "" ? Number(ms.percentage) : null;
        const demandAmount = percentage != null
          ? (agreementVal * percentage) / 100
          : (ms.demand_amount != null ? Number(ms.demand_amount) : 0);

        const existingId = existingByOrder.get(milestoneOrder);
        let row;
        if (existingId) {
          const upd = await client.query(
            `UPDATE booking_payment_milestones SET
               milestone_name = $1, percentage = $2, demand_amount = $3,
               demand_date = COALESCE($4, demand_date), demand_letter_url = COALESCE($5, demand_letter_url),
               due_date = COALESCE($6, due_date), status = COALESCE($7, status), remarks = COALESCE($8, remarks),
               updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [ms.milestone_name, percentage, demandAmount, ms.demand_date || null, ms.demand_letter_url || null,
              ms.due_date || null, ms.status || null, ms.remarks || null, existingId]
          );
          row = upd.rows[0];
          changeLog.push({ milestone_order: milestoneOrder, action: "updated", demand_amount: demandAmount });
        } else {
          const ins = await client.query(
            `INSERT INTO booking_payment_milestones
               (booking_id, milestone_name, milestone_order, percentage, demand_amount, demand_date, demand_letter_url, due_date, status, remarks)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [Number(id), ms.milestone_name, milestoneOrder, percentage, demandAmount, ms.demand_date || null,
              ms.demand_letter_url || null, ms.due_date || null, ms.status || "Upcoming", ms.remarks || null]
          );
          row = ins.rows[0];
          changeLog.push({ milestone_order: milestoneOrder, action: "created", demand_amount: demandAmount });
        }
        savedRows.push(row);
      }

      await client.query(
        `INSERT INTO booking_history (booking_id, updated_by, user_role, changed_fields)
         VALUES ($1, $2, $3, $4)`,
        [Number(id), user_name, user_role, JSON.stringify({ payment_milestones: changeLog })]
      );

      return savedRows;
    });

    return NextResponse.json({ success: true, data: saved.sort((a, b) => a.milestone_order - b.milestone_order) }, { status: 200 });
  } catch (err: any) {
    console.error("[POST /api/booking-applications/[id]/milestones]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
