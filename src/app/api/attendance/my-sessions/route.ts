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
    // Derive today's date in IST, not UTC.  Between 12:00 AM and 5:30 AM IST
    // the UTC calendar date is still the previous day, so a UTC fallback would
    // show yesterday's data for the first 5.5 hours of every Indian workday.
    const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const dateStr = searchParams.get("date") || todayIst;

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
          -- Resolve session_end for expired sessions: the heartbeat cleanup
          -- sets session_end = last_heartbeat, but if last_heartbeat was NULL
          -- (no heartbeats after login) session_end stays NULL.  COALESCE
          -- ensures the frontend always has a valid end timestamp for inactive
          -- sessions, matching the admin live API's sw subquery logic.
          CASE WHEN es.is_active THEN es.session_end
               ELSE COALESCE(es.session_end, es.last_heartbeat)
          END                                          AS session_end,
          es.is_active                                 AS session_is_active,
          es.ip_address,
          es.device_info,
          CASE
            WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
            WHEN es.is_active THEN 'Pending'
            ELSE 'Absent'
          END                                          AS attendance_status,
          ar.working_track                              AS attendance_working_track,
          -- TO_CHAR produces an explicit ISO-8601 UTC string that bypasses
          -- the postgres-date driver parser entirely.  This is necessary
          -- because the actual Neon column types diverge from the migration
          -- file: logout_time is TIMESTAMPTZ while submitted_at is TIMESTAMP.
          -- "col AT TIME ZONE 'UTC'" flips direction depending on the input
          -- type, and postgres-date interprets a bare TIMESTAMP wire value
          -- (no +00 offset) in the Node process timezone — which on an IST
          -- machine shifts the instant by −5:30.
          TO_CHAR(ar.login_time   AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS attendance_login_time,
          TO_CHAR(ar.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS attendance_marked_at,
          TO_CHAR(ar.logout_time  AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS attendance_completed_at,
          -- Authoritative daily Working Hours: attendance span from first mark
          -- to latest completion (or NOW if still active).  This is
          -- logout_time − login_time, NOT a sum of session durations.
          CASE WHEN ar.login_time IS NOT NULL THEN
            EXTRACT(EPOCH FROM (
              COALESCE(ar.logout_time, CURRENT_TIMESTAMP) - ar.login_time
            ))::integer
          END                                          AS attendance_span_seconds,
          EXTRACT(EPOCH FROM (
            COALESCE(
              CASE WHEN es.is_active THEN NOW() ELSE es.session_end END,
              es.last_heartbeat,
              es.session_start
            ) - es.session_start
          ))                                           AS session_duration_seconds
        FROM employee_sessions es
        JOIN users u ON u.id = es.user_id
        LEFT JOIN (
          SELECT DISTINCT ON (employee_id) employee_id, attendance_status, working_track, submitted_at, logout_time, login_time
          FROM attendance_records
          WHERE DATE(login_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $2::date AND organization_id = $3
          ORDER BY employee_id, id ASC
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
          CASE WHEN es.is_active THEN es.session_end
               ELSE COALESCE(es.session_end, es.last_heartbeat)
          END                                          AS session_end,
          es.is_active                                 AS session_is_active,
          es.ip_address,
          es.device_info,
          CASE
            WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
            WHEN es.is_active THEN 'Pending'
            ELSE 'Absent'
          END                                          AS attendance_status,
          ar.working_track                              AS attendance_working_track,
          TO_CHAR(ar.login_time   AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS attendance_login_time,
          TO_CHAR(ar.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS attendance_marked_at,
          TO_CHAR(ar.logout_time  AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS attendance_completed_at,
          CASE WHEN ar.login_time IS NOT NULL THEN
            EXTRACT(EPOCH FROM (
              COALESCE(ar.logout_time, CURRENT_TIMESTAMP) - ar.login_time
            ))::integer
          END                                          AS attendance_span_seconds,
          EXTRACT(EPOCH FROM (
            COALESCE(
              CASE WHEN es.is_active THEN NOW() ELSE es.session_end END,
              es.last_heartbeat,
              es.session_start
            ) - es.session_start
          ))                                           AS session_duration_seconds
        FROM employee_sessions es
        JOIN users u ON u.id = es.user_id
        LEFT JOIN (
          SELECT DISTINCT ON (employee_id) employee_id, attendance_status, working_track, submitted_at, logout_time, login_time
          FROM attendance_records
          WHERE DATE(login_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $2::date AND organization_id = $3
          ORDER BY employee_id, id ASC
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
