// app/api/hr/employees/[id]/incentives/route.ts
//
// GET  — list incentive entries for an employee
// POST — add a new incentive entry (HR-managed, manual)
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { INCENTIVE_STATUSES } from "@/lib/hr/constants";

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
    const status = sp.get("status") || "";

    const conditions = ["i.user_id = $1", "i.organization_id = $2"];
    const values: any[] = [userId, orgId];
    let idx = 3;

    if (status && (INCENTIVE_STATUSES as readonly string[]).includes(status)) {
      conditions.push(`i.status = $${idx++}`);
      values.push(status);
    }

    const rows = await query<any>(
      `SELECT i.id, i.booking_id, i.amount, i.category, i.description,
              i.earning_date, i.earning_period, i.source, i.status,
              i.created_by, cb.name AS created_by_name,
              i.approved_by, ab.name AS approved_by_name,
              i.approved_at, i.reversal_reason, i.reversed_at,
              i.created_at, i.updated_at,
              ba.booking_number, ba.primary_name AS booking_client_name
         FROM employee_incentives i
         LEFT JOIN users cb ON cb.id = i.created_by
         LEFT JOIN users ab ON ab.id = i.approved_by
         LEFT JOIN booking_applications ba ON ba.id = i.booking_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY i.created_at DESC`,
      values
    );

    // Summary totals
    const summary = await query<any>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0)::numeric AS total_pending,
         COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0)::numeric AS total_approved,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)::numeric AS total_paid,
         COUNT(*)::int AS total_entries
       FROM employee_incentives
      WHERE user_id = $1 AND organization_id = $2 AND status != 'reversed'`,
      [userId, orgId]
    );

    return NextResponse.json({
      success: true,
      data: {
        incentives: rows,
        summary: summary[0] ?? { total_pending: 0, total_approved: 0, total_paid: 0, total_entries: 0 },
      },
    });
  } catch (err: any) {
    console.error("[GET employee incentives]", err);
    return NextResponse.json({ success: false, message: "Failed to load incentives." }, { status: 500 });
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
    const { amount, category, description, bookingId, earningDate, earningPeriod } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, message: "A positive amount is required." },
        { status: 400 }
      );
    }

    // Verify employee exists
    const emp = await query<any>(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
      [userId, orgId]
    );
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    // If booking_id provided, verify it belongs to the org
    if (bookingId) {
      const booking = await query<any>(
        "SELECT id FROM booking_applications WHERE id = $1 AND organization_id = $2",
        [bookingId, orgId]
      );
      if (booking.length === 0) {
        return NextResponse.json({ success: false, message: "Booking not found." }, { status: 404 });
      }
    }

    const createdBy = getSessionUserId(gate.session);

    const result = await query<{ id: number }>(
      `INSERT INTO employee_incentives
         (user_id, organization_id, booking_id, amount, category, description,
          earning_date, earning_period, source, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, 'manual', 'pending', $9)
       RETURNING id`,
      [
        userId, orgId,
        bookingId || null,
        Number(amount),
        category?.trim() || "incentive",
        description?.trim() || null,
        earningDate || null,
        earningPeriod?.trim() || null,
        createdBy,
      ]
    );

    // Record creation in history
    await query(
      `INSERT INTO employee_incentive_history
         (incentive_id, action, new_values, changed_by)
       VALUES ($1, 'created', $2, $3)`,
      [result[0].id, JSON.stringify({ amount, category, bookingId, source: "manual" }), createdBy]
    );

    return NextResponse.json(
      { success: true, id: result[0].id, message: "Incentive entry created." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST employee incentives]", err);
    return NextResponse.json({ success: false, message: "Failed to create incentive." }, { status: 500 });
  }
}
