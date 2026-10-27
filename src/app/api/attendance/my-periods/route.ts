// app/api/attendance/my-periods/route.ts
//
// GET /api/attendance/my-periods?date=YYYY-MM-DD
//
// Self-service variant of /api/attendance/periods: returns the
// authenticated user's own attendance_periods for the given IST day.
// Used by AttendanceView's "View History" expandable.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireRole([
      "admin",
      "sales manager", "sales_manager",
      "site_head", "site head",
      "receptionist",
    ]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = getSessionUserId(auth.session);
    if (userId === null) {
      return NextResponse.json({ message: "Cannot determine current user" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const targetDate = searchParams.get("date") || todayIst;
    const orgId = await getOrganizationId();

    const periods = await query(
      `SELECT
        ap.period_number,
        TO_CHAR(ap.started_at AT TIME ZONE 'Asia/Kolkata',
                'YYYY-MM-DD"T"HH24:MI:SS') AS started_at_ist,
        TO_CHAR(ap.completed_at AT TIME ZONE 'Asia/Kolkata',
                'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_ist,
        ap.duration_seconds,
        CASE WHEN ap.completed_at IS NULL THEN
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ap.started_at))::integer
        ELSE ap.duration_seconds
        END AS effective_seconds,
        ap.completed_at IS NOT NULL AS is_completed
      FROM attendance_periods ap
      JOIN attendance_records ar ON ar.id = ap.attendance_id
      WHERE ar.employee_id = $1
        AND ar.organization_id = $2
        AND DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') = $3::date
      ORDER BY ap.period_number ASC`,
      [userId, orgId, targetDate]
    );

    return NextResponse.json({ success: true, periods });
  } catch (error) {
    console.error("GET /api/attendance/my-periods error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
