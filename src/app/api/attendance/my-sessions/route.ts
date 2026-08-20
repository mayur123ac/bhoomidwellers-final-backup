import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance/my-sessions?date=YYYY-MM-DD
 *
 * Returns ALL employee_sessions rows for the currently authenticated user
 * on the given date (defaults to today). Includes completed + active sessions.
 *
 * This is used by AttendanceView to compute cumulative total working time
 * across multiple login/logout cycles — so the Live Timer never resets.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireRole([
      "admin",
      "sales manager",
      "sales_manager",
      "site_head",
      "site head",
      "receptionist",
    ]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateStr =
      searchParams.get("date") || new Date().toISOString().split("T")[0];

    // Resolve the user_id and name from the authenticated session
    const userId = getSessionUserId(auth.session);
    const userName = auth.session?.name;

    if (!userId && !userName) {
      return NextResponse.json(
        { message: "Cannot determine current user" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();

    // Expire stale sessions (no heartbeat in >5 min) — same as live API, and
    // scoped the same way: the sweep may only touch the caller's own tenant.
    await query(`
      UPDATE employee_sessions
      SET is_active = false, session_end = last_heartbeat
      WHERE is_active = true AND organization_id = $1
        AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300
    `, [orgId]);

    // Fetch ALL sessions for this user on this date, oldest first
    let rows: any[];
    if (userId) {
      rows = await query(
        `
        SELECT
          es.id                                        AS session_id,
          es.user_id,
          u.name,
          u.email,
          u.role,
          es.session_start,
          es.session_end,
          es.is_active                                 AS session_is_active,
          es.ip_address,
          es.device_info,
          CASE
            WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
            WHEN es.is_active THEN 'Pending'
            ELSE 'Absent'
          END                                          AS attendance_status,
          EXTRACT(EPOCH FROM (
            COALESCE(
              CASE WHEN es.is_active THEN NOW() ELSE es.session_end END,
              es.session_start
            ) - es.session_start
          ))                                           AS session_duration_seconds
        FROM employee_sessions es
        JOIN users u ON u.id = es.user_id
        LEFT JOIN (
          SELECT DISTINCT ON (employee_id) employee_id, attendance_status
          FROM attendance_records
          WHERE DATE(login_time) = $2::date AND organization_id = $3
        ) ar ON u.id = ar.employee_id
        WHERE es.user_id = $1
          AND es.organization_id = $3
          AND u.organization_id = $3
          AND DATE(es.session_start AT TIME ZONE 'Asia/Kolkata') = $2
        ORDER BY es.session_start ASC
        `,
        [userId, dateStr, orgId]
      );
    } else {
      // Fallback: look up by name if id not available
      rows = await query(
        `
        SELECT
          es.id                                        AS session_id,
          es.user_id,
          u.name,
          u.email,
          u.role,
          es.session_start,
          es.session_end,
          es.is_active                                 AS session_is_active,
          es.ip_address,
          es.device_info,
          CASE
            WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
            WHEN es.is_active THEN 'Pending'
            ELSE 'Absent'
          END                                          AS attendance_status,
          EXTRACT(EPOCH FROM (
            COALESCE(
              CASE WHEN es.is_active THEN NOW() ELSE es.session_end END,
              es.session_start
            ) - es.session_start
          ))                                           AS session_duration_seconds
        FROM employee_sessions es
        JOIN users u ON u.id = es.user_id
        LEFT JOIN (
          SELECT DISTINCT ON (employee_id) employee_id, attendance_status
          FROM attendance_records
          WHERE DATE(login_time) = $2::date AND organization_id = $3
        ) ar ON u.id = ar.employee_id
        -- Name matching is ambiguous ACROSS tenants as well as within one, so the
        -- organization predicate is what keeps a same-named user in another tenant
        -- out of this employee's own session list.
        WHERE LOWER(u.name) = LOWER($1)
          AND es.organization_id = $3
          AND u.organization_id = $3
          AND DATE(es.session_start AT TIME ZONE 'Asia/Kolkata') = $2
        ORDER BY es.session_start ASC
        `,
        [userName, dateStr, orgId]
      );
    }

    // Compute server-side aggregate for convenience
    const totalSeconds = rows.reduce((sum: number, r: any) => {
      return sum + Math.max(0, parseFloat(r.session_duration_seconds) || 0);
    }, 0);

    return NextResponse.json({
      success: true,
      sessions: rows,
      totalSeconds,
      date: dateStr,
    });
  } catch (error) {
    console.error("my-sessions API error:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
