// app/api/hr/dashboard/route.ts
//
// Single endpoint for the Phase 1 HR Dashboard.
//
// API Audit Map:
//  Attendance Trend (7d/30d)   -> attendance_records
//  Today Workforce (donut)     -> attendance_records + users
//  Workforce by Role (bar)     -> users (role, is_active)
//  Live Workforce (donut)      -> employee_sessions + employee_live_state
//  Working Hours by Role (bar) -> employee_sessions + users
//  Attendance by Role (bar)    -> attendance_records + users
//  Live Employee Table         -> users + employee_sessions + employee_live_state + attendance_records
//
// All data from existing tables. No new schema.
// Gate: hr and admin only. Tenant-isolated via organization_id.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

const ROLE_DISPLAY: Record<string, string> = {
  "sales manager":    "Sales",
  "sales_manager":    "Sales",
  "sourcing manager": "Sourcing Manager",
  "sourcing_manager": "Sourcing Manager",
  "calling":          "Sourcing Manager",
  "receptionist":     "Receptionist",
  "front desk":       "Receptionist",
  "front_desk":       "Receptionist",
  "site head":        "Site Head",
  "site_head":        "Site Head",
  "management":       "Site Head",
};

const VISIBLE_DISPLAY_ROLES = ["Sales", "Sourcing Manager", "Receptionist", "Site Head"];

function mapRole(rawRole: string): string | null {
  const norm = (rawRole ?? "").trim().toLowerCase();
  return ROLE_DISPLAY[norm] ?? null;
}

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const trendDays = Math.min(Number(searchParams.get("days") ?? "7"), 30);
    const orgId = await getOrganizationId();
    const today = todayIst();

    // Expire stale sessions (mirrors /attendance/live)
    await query(
      `UPDATE employee_sessions
       SET is_active = false, session_end = last_heartbeat
       WHERE is_active = true AND organization_id = $1
         AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300`,
      [orgId]
    );

    // Q1: Attendance trend
    const trendRows = await query<any>(
      `WITH days AS (
         SELECT generate_series(
           (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - ($2 - 1),
           (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
           '1 day'::interval
         )::date AS day
       ),
       employee_count AS (
         SELECT COUNT(*) AS total FROM users
         WHERE is_active = true AND organization_id = $1
       ),
       presents AS (
         SELECT
           DATE(login_time AT TIME ZONE 'Asia/Kolkata') AS day,
           COUNT(DISTINCT employee_id) AS present_count
         FROM attendance_records
         WHERE organization_id = $1
           AND attendance_status ILIKE 'present'
           AND DATE(login_time AT TIME ZONE 'Asia/Kolkata')
               BETWEEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - ($2 - 1)
               AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
         GROUP BY DATE(login_time AT TIME ZONE 'Asia/Kolkata')
       )
       SELECT
         d.day::text AS date,
         COALESCE(p.present_count, 0)::int AS present,
         GREATEST(ec.total::int - COALESCE(p.present_count, 0)::int, 0) AS absent
       FROM days d
       CROSS JOIN employee_count ec
       LEFT JOIN presents p ON p.day = d.day
       ORDER BY d.day ASC`,
      [orgId, trendDays]
    );

    // Q2: Today workforce donut
    const todayWorkforceRows = await query<any>(
      `WITH all_emp AS (
         SELECT id FROM users
         WHERE is_active = true AND organization_id = $1
       ),
       today_records AS (
         SELECT DISTINCT ON (employee_id) employee_id, attendance_status
         FROM attendance_records
         WHERE organization_id = $1
           AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $2::date
         ORDER BY employee_id, id ASC
       )
       SELECT
         COUNT(CASE WHEN LOWER(tr.attendance_status) = 'present' THEN 1 END)::int    AS present,
         COUNT(CASE WHEN tr.attendance_status ILIKE '%leave%' THEN 1 END)::int        AS on_leave,
         COUNT(CASE WHEN tr.attendance_status IS NULL
                    OR LOWER(tr.attendance_status) = 'absent' THEN 1 END)::int        AS absent
       FROM all_emp ae
       LEFT JOIN today_records tr ON tr.employee_id = ae.id`,
      [orgId, today]
    );

    // Q3: Workforce by role headcount
    const roleHeadcountRows = await query<any>(
      `SELECT role, COUNT(*)::int AS count
       FROM users WHERE is_active = true AND organization_id = $1
       GROUP BY role`,
      [orgId]
    );
    const byRoleMap: Record<string, number> = {};
    for (const row of roleHeadcountRows) {
      const display = mapRole(row.role);
      if (display && VISIBLE_DISPLAY_ROLES.includes(display)) {
        byRoleMap[display] = (byRoleMap[display] ?? 0) + Number(row.count);
      }
    }
    const workforceByRole = VISIBLE_DISPLAY_ROLES.map((label) => ({
      role: label,
      count: byRoleMap[label] ?? 0,
    }));

    // Q4: Live workforce counts
    const liveStatusRows = await query<any>(
      `SELECT
         CASE
           WHEN s.user_id IS NULL OR s.is_active = false THEN 'offline'
           WHEN l.is_idle = true THEN 'idle'
           ELSE 'active'
         END AS live_status
       FROM users u
       LEFT JOIN (
         SELECT DISTINCT ON (user_id) *
         FROM employee_sessions
         WHERE DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $2
           AND organization_id = $1
         ORDER BY user_id, session_start DESC
       ) s ON u.id = s.user_id
       LEFT JOIN employee_live_state l ON u.id = l.user_id AND l.organization_id = $1
       WHERE u.is_active = true AND u.organization_id = $1`,
      [orgId, today]
    );
    const liveCount = { active: 0, idle: 0, offline: 0, logged_out: 0 };
    for (const r of liveStatusRows) {
      if (r.live_status === "active") liveCount.active++;
      else if (r.live_status === "idle") liveCount.idle++;
      else liveCount.offline++;
    }
    const loggedOutRows = await query<any>(
      `SELECT COUNT(DISTINCT user_id)::int AS count
       FROM employee_sessions
       WHERE is_active = false
         AND DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $2
         AND organization_id = $1`,
      [orgId, today]
    );
    liveCount.logged_out = Number(loggedOutRows[0]?.count ?? 0);

    // Q5: Working hours by role (avg today)
    const whRows = await query<any>(
      `SELECT u.role,
         COALESCE(AVG(
           EXTRACT(EPOCH FROM (COALESCE(s.session_end, NOW()) - s.session_start)) / 3600
         ), 0)::numeric(6,2) AS avg_hours
       FROM employee_sessions s
       JOIN users u ON s.user_id = u.id AND u.organization_id = s.organization_id
       WHERE s.organization_id = $1
         AND DATE(s.session_start AT TIME ZONE 'Asia/Kolkata') = $2
       GROUP BY u.role`,
      [orgId, today]
    );
    const whMap: Record<string, { sum: number; count: number }> = {};
    for (const row of whRows) {
      const display = mapRole(row.role);
      if (display && VISIBLE_DISPLAY_ROLES.includes(display)) {
        const e = whMap[display] ?? { sum: 0, count: 0 };
        e.sum += Number(row.avg_hours);
        e.count += 1;
        whMap[display] = e;
      }
    }
    const workingHoursByRole = VISIBLE_DISPLAY_ROLES.map((label) => ({
      role: label,
      avgHours: whMap[label]
        ? Math.round((whMap[label].sum / whMap[label].count) * 10) / 10
        : 0,
    }));

    // Q6: Attendance by role (present / absent today)
    const attByRoleRows = await query<any>(
      `WITH all_emp AS (
         SELECT id, role FROM users
         WHERE is_active = true AND organization_id = $1
       ),
       today_mark AS (
         SELECT DISTINCT ON (ar.employee_id)
           ar.employee_id, ar.attendance_status
         FROM attendance_records ar
         WHERE ar.organization_id = $1
           AND DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') = $2::date
         ORDER BY ar.employee_id, ar.id ASC
       )
       SELECT
         ae.role,
         COUNT(CASE WHEN LOWER(tm.attendance_status) = 'present' THEN 1 END)::int AS present,
         COUNT(CASE WHEN tm.attendance_status IS NULL
                    OR LOWER(tm.attendance_status) = 'absent' THEN 1 END)::int    AS absent
       FROM all_emp ae
       LEFT JOIN today_mark tm ON tm.employee_id = ae.id
       GROUP BY ae.role`,
      [orgId, today]
    );
    const attByRoleMap: Record<string, { present: number; absent: number }> = {};
    for (const row of attByRoleRows) {
      const display = mapRole(row.role);
      if (display && VISIBLE_DISPLAY_ROLES.includes(display)) {
        const e = attByRoleMap[display] ?? { present: 0, absent: 0 };
        attByRoleMap[display] = {
          present: e.present + Number(row.present),
          absent:  e.absent  + Number(row.absent),
        };
      }
    }
    const attendanceByRole = VISIBLE_DISPLAY_ROLES.map((label) => ({
      role:    label,
      present: attByRoleMap[label]?.present ?? 0,
      absent:  attByRoleMap[label]?.absent  ?? 0,
    }));

    // Q7: Live employee table
    const liveTableRows = await query<any>(
      `SELECT
         u.id        AS user_id,
         u.name,
         u.role      AS raw_role,
         s.session_start AS login_time,
         CASE
           WHEN s.user_id IS NULL OR s.is_active = false THEN 'Offline'
           WHEN l.is_idle = true THEN 'Idle'
           ELSE 'Active'
         END AS status,
         CASE WHEN s.is_active THEN l.current_module     ELSE NULL END AS current_module,
         CASE WHEN s.is_active THEN l.active_lead_name   ELSE NULL END AS active_lead,
         CASE WHEN s.is_active THEN l.current_action     ELSE NULL END AS current_action,
         CASE WHEN s.is_active THEN
           ROUND(EXTRACT(EPOCH FROM (NOW() - s.session_start)) / 3600, 1)
         ELSE NULL END AS working_hours,
         CASE WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
              WHEN s.is_active THEN 'Pending'
              ELSE 'Absent'
         END AS attendance_status
       FROM users u
       LEFT JOIN (
         SELECT DISTINCT ON (user_id) *
         FROM employee_sessions
         WHERE DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $2
           AND organization_id = $1
         ORDER BY user_id, session_start DESC
       ) s ON u.id = s.user_id
       LEFT JOIN employee_live_state l ON u.id = l.user_id AND l.organization_id = $1
       LEFT JOIN (
         SELECT DISTINCT ON (employee_id) employee_id, attendance_status
         FROM attendance_records
         WHERE DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $2::date
           AND organization_id = $1
         ORDER BY employee_id, id ASC
       ) ar ON u.id = ar.employee_id
       WHERE u.is_active = true AND u.organization_id = $1
       ORDER BY
         CASE WHEN s.is_active = true AND (l.is_idle IS NULL OR l.is_idle = false) THEN 0
              WHEN l.is_idle = true THEN 1
              ELSE 2 END,
         u.name ASC`,
      [orgId, today]
    );

    const liveTable = liveTableRows.map((r: any) => ({
      userId:           r.user_id,
      name:             r.name,
      role:             mapRole(r.raw_role) ?? r.raw_role,
      loginTime:        r.login_time,
      status:           r.status,
      currentModule:    r.current_module ?? "—",
      activeLead:       r.active_lead ?? "—",
      currentAction:    r.current_action ?? "—",
      workingHours:     r.working_hours,
      attendanceStatus: r.attendance_status,
    }));

    return NextResponse.json({
      success: true,
      data: {
        trendDays,
        attendanceTrend:   trendRows,
        todayWorkforce:    todayWorkforceRows[0] ?? { present: 0, absent: 0, on_leave: 0 },
        workforceByRole,
        liveWorkforce:     liveCount,
        workingHoursByRole,
        attendanceByRole,
        liveTable,
      },
    });
  } catch (err: any) {
    console.error("[/api/hr/dashboard]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load HR dashboard data." },
      { status: 500 }
    );
  }
}
