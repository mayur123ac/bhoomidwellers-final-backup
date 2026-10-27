import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "super_admin", "site_head", "site head"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const queryDate = searchParams.get("date");
    // When no explicit date is requested, derive today's Indian business date
    // in Asia/Kolkata rather than using new Date().toISOString().split('T')[0],
    // which gives the UTC date. UTC and IST differ by +5:30, so between
    // 12:00 AM IST and 5:30 AM IST the UTC date is still the previous calendar
    // day — causing the live view to show yesterday's data for the first 5.5
    // hours of every Indian working day. Intl.DateTimeFormat with en-CA locale
    // returns YYYY-MM-DD in the specified timezone, matching what the admin's
    // date picker shows.
    const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const targetDate = queryDate || todayIst;
    const orgId = await getOrganizationId();

    // 1. Automatic Session Expiration Cleanup
    // If a session has not received a heartbeat in over 5 minutes (300 seconds), mark it inactive.
    // Scoped to the caller's organization: this housekeeping runs inside one admin's
    // page load, and an unscoped sweep would have that admin closing sessions that
    // belong to other tenants entirely.
    await query(`
      UPDATE employee_sessions
      SET is_active = false, session_end = last_heartbeat
      WHERE is_active = true AND organization_id = $1
        AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300
    `, [orgId]);

    // We join Users -> Sessions (filtered for targetDate) -> Live State (Telemetry)
    const liveSessions = await query(`
      SELECT 
        u.id as user_id,
        u.name,
        u.email,
        u.role,
        CASE WHEN s.is_active THEN l.current_module ELSE NULL END as current_module,
        CASE WHEN s.is_active THEN l.active_lead_id ELSE NULL END as active_lead_id,
        CASE WHEN s.is_active THEN l.active_lead_name ELSE NULL END as active_lead_name,
        CASE WHEN s.is_active THEN l.current_action ELSE NULL END as current_action,
        CASE WHEN s.is_active THEN l.current_route ELSE NULL END as current_route,
        CASE WHEN s.is_active THEN l.last_activity ELSE NULL END as last_activity,
        CASE WHEN s.is_active THEN l.idle_duration_seconds ELSE 0 END as idle_duration_seconds,
        CASE WHEN s.is_active THEN l.productivity_score ELSE 0 END as productivity_score,
        l.is_idle,
        CASE 
          WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
          WHEN s.is_active THEN 'Pending'
          ELSE 'Absent'
        END as attendance_status,
        s.session_start,
        s.session_end,
        s.is_active as session_is_active,
        s.ip_address,
        s.device_info,
        s.login_device_name,
        s.login_device_type,
        s.login_os,
        s.login_browser,
        s.login_latitude,
        s.login_longitude,
        s.login_location_name,
        s.login_location_accuracy,
        sc.active_sessions_count,
        
        -- Per-session elapsed time (correct for both active and ended sessions)
        CASE
          WHEN s.session_start IS NULL THEN NULL
          WHEN s.is_active THEN EXTRACT(EPOCH FROM (NOW() - s.session_start))::integer
          WHEN s.session_end IS NOT NULL THEN EXTRACT(EPOCH FROM (s.session_end - s.session_start))::integer
          ELSE NULL
        END as session_duration_seconds,
        ar.working_track,
        ar.attendance_span_seconds,
        ar.attendance_marked_at,
        ar.attendance_completed_at,
        ar.attendance_completed,
        ar.total_periods,
        -- Daily total working seconds across ALL sessions for this user on
        -- this date.  Session-based fallback for employees who have not
        -- marked attendance.
        sw.total_working_seconds,
        CASE
          WHEN s.user_id IS NULL THEN 'OFFLINE'
          WHEN s.is_active = false THEN 'OFFLINE'
          WHEN l.is_idle THEN 'IDLE'
          ELSE 'ACTIVE'
        END as status
      FROM users u
      LEFT JOIN (
        -- Get the most recent session for each user on targetDate
        SELECT DISTINCT ON (user_id) * 
        FROM employee_sessions 
        WHERE DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $1
          AND organization_id = $2
        ORDER BY user_id, session_start DESC
      ) s ON u.id = s.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(id) as active_sessions_count
        FROM employee_sessions
        WHERE is_active = true AND DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $1
          AND organization_id = $2
        GROUP BY user_id
      ) sc ON u.id = sc.user_id
      LEFT JOIN (
        -- Working hours = First Login → Final Logout (or NOW if still active).
        -- Breaks between sessions are NOT subtracted: the client's rule is
        -- continuous first-login-to-final-logout.
        SELECT user_id,
          EXTRACT(EPOCH FROM (
            MAX(CASE
              WHEN is_active THEN NOW()
              ELSE COALESCE(session_end, last_heartbeat, session_start)
            END)
            - MIN(session_start)
          ))::integer AS total_working_seconds
        FROM employee_sessions
        WHERE DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $1
          AND organization_id = $2
        GROUP BY user_id
      ) sw ON u.id = sw.user_id
      LEFT JOIN employee_live_state l ON u.id = l.user_id AND l.organization_id = $2
      LEFT JOIN (
        -- ORDER BY id ASC matches mark/status/checkout routes: the first
        -- attendance_records row for the day is the authoritative one, and
        -- working_track is written to that row by the checkout route.
        --
        -- attendance_span_seconds: the authoritative Working Hours metric.
        -- Uses SUM of attendance_periods durations (net working time,
        -- excludes breaks between periods). Falls back to gross span
        -- (logout_time − submitted_at) for records without periods.
        --
        -- attendance_marked_at: ISO-8601 UTC string of submitted_at for
        -- client-side live timer on active attendance days.
        SELECT DISTINCT ON (ar_inner.employee_id)
          ar_inner.employee_id,
          ar_inner.attendance_status,
          ar_inner.working_track,
          CASE WHEN ar_inner.submitted_at IS NOT NULL THEN
            COALESCE(
              ap_sum.periods_total_seconds,
              EXTRACT(EPOCH FROM (
                COALESCE(ar_inner.logout_time, CURRENT_TIMESTAMP) - (ar_inner.submitted_at AT TIME ZONE 'UTC')
              ))::integer
            )
          END AS attendance_span_seconds,
          TO_CHAR(ar_inner.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS attendance_marked_at,
          TO_CHAR(ar_inner.logout_time AT TIME ZONE 'UTC' AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS attendance_completed_at,
          CASE WHEN ar_inner.logout_time IS NOT NULL THEN true ELSE false END AS attendance_completed,
          COALESCE(ap_sum.total_periods, 0) AS total_periods
        FROM attendance_records ar_inner
        LEFT JOIN LATERAL (
          SELECT
            SUM(CASE
              WHEN ap.completed_at IS NOT NULL THEN ap.duration_seconds
              ELSE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ap.started_at))::integer
            END)::integer AS periods_total_seconds,
            COUNT(*)::integer AS total_periods
          FROM attendance_periods ap
          WHERE ap.attendance_id = ar_inner.id
        ) ap_sum ON true
        WHERE DATE(ar_inner.login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
          AND ar_inner.organization_id = $2
        ORDER BY ar_inner.employee_id, ar_inner.id ASC
      ) ar ON u.id = ar.employee_id
      -- Every derived table carries its own organization predicate INSIDE the
      -- subquery, ahead of its DISTINCT ON / GROUP BY: a filter applied after the
      -- pick would silently drop this tenant's row whenever another tenant's row
      -- for the same user id sorted first.
      WHERE u.is_active = true AND u.organization_id = $2
      ORDER BY l.productivity_score DESC NULLS LAST, s.session_start DESC
    `, [targetDate, orgId]);

    return NextResponse.json({ sessions: liveSessions });
  } catch (error) {
    console.error("Live attendance API error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
