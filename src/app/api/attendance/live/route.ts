import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "super_admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const queryDate = searchParams.get("date");
    const targetDate = queryDate || new Date().toISOString().split('T')[0];
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
        sc.active_sessions_count,
        
        EXTRACT(EPOCH FROM (NOW() - s.session_start)) as session_duration_seconds,
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
      LEFT JOIN employee_live_state l ON u.id = l.user_id AND l.organization_id = $2
      LEFT JOIN (
        SELECT DISTINCT ON (employee_id) employee_id, attendance_status
        FROM attendance_records
        WHERE DATE(login_time) = $1::date
          AND organization_id = $2
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
