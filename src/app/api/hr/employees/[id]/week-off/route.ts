// app/api/hr/employees/[id]/week-off/route.ts
//
// GET — get current weekly-off pattern for an employee
// PUT — set/update weekly-off pattern (effective-dated)
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

    // Active patterns (effective_to IS NULL)
    const active = await query<any>(
      `SELECT id, day_of_week, effective_from, created_at
         FROM employee_week_off_pattern
        WHERE user_id = $1 AND organization_id = $2 AND effective_to IS NULL
        ORDER BY day_of_week ASC`,
      [userId, orgId]
    );

    // Historical patterns (effective_to IS NOT NULL) — last 10
    const history = await query<any>(
      `SELECT id, day_of_week, effective_from, effective_to, created_at
         FROM employee_week_off_pattern
        WHERE user_id = $1 AND organization_id = $2 AND effective_to IS NOT NULL
        ORDER BY effective_to DESC
        LIMIT 10`,
      [userId, orgId]
    );

    return NextResponse.json({
      success: true,
      data: {
        configured: active.length > 0,
        activeDays: active.map((r: any) => r.day_of_week),
        active,
        history,
      },
    });
  } catch (err: any) {
    console.error("[GET week-off]", err);
    return NextResponse.json({ success: false, message: "Failed to load week-off pattern." }, { status: 500 });
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
    const { days, effectiveFrom } = body;

    if (!Array.isArray(days)) {
      return NextResponse.json(
        { success: false, message: "days must be an array of day-of-week numbers (0=Sun, 6=Sat)." },
        { status: 400 }
      );
    }

    const validDays = days.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6);
    const effFrom = effectiveFrom || new Date().toISOString().slice(0, 10);
    const createdBy = getSessionUserId(gate.session);

    await transaction(async (client) => {
      // Verify employee exists
      const emp = await client.query(
        "SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
        [userId, orgId]
      );
      if (emp.rows.length === 0) throw new Error("EMP_NOT_FOUND");

      // Close all current active patterns
      await client.query(
        `UPDATE employee_week_off_pattern
            SET effective_to = ($3::date - INTERVAL '1 day')::date
          WHERE user_id = $1 AND organization_id = $2 AND effective_to IS NULL`,
        [userId, orgId, effFrom]
      );

      // Insert new patterns
      for (const day of validDays) {
        await client.query(
          `INSERT INTO employee_week_off_pattern
             (user_id, organization_id, day_of_week, effective_from, created_by)
           VALUES ($1, $2, $3, $4::date, $5)`,
          [userId, orgId, day, effFrom, createdBy]
        );
      }
    });

    return NextResponse.json({
      success: true,
      message: validDays.length > 0
        ? `Week-off set to ${validDays.length} day(s) effective ${effFrom}.`
        : "All week-off days cleared.",
    });
  } catch (err: any) {
    if (err.message === "EMP_NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }
    console.error("[PUT week-off]", err);
    return NextResponse.json({ success: false, message: "Failed to update week-off pattern." }, { status: 500 });
  }
}
