// app/api/hr/analytics/route.ts
//
// Structured analytics data for the HR Analytics dashboard.
// Returns pre-computed KPIs, trends, and breakdowns.
// All data is org-scoped and role-gated.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const today = todayIst();
    const sp = req.nextUrl.searchParams;
    const days = Math.min(Math.max(Number(sp.get("days") || "30"), 7), 90);

    // ── A. Executive Overview ─────────────────────────────────────────────
    const [empRows, todayAttRows] = await Promise.all([
      query<any>(
        `SELECT COUNT(*)::int AS total FROM users
         WHERE organization_id = $1 AND is_active = true AND deleted_at IS NULL`,
        [orgId]
      ),
      query<any>(
        `WITH all_emp AS (
           SELECT id FROM users WHERE is_active = true AND organization_id = $1
         ),
         today_rec AS (
           SELECT DISTINCT ON (employee_id) employee_id, attendance_status
           FROM attendance_records
           WHERE organization_id = $1
             AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $2::date
           ORDER BY employee_id, id ASC
         )
         SELECT
           COUNT(CASE WHEN LOWER(tr.attendance_status) = 'present' THEN 1 END)::int AS present,
           COUNT(CASE WHEN tr.attendance_status ILIKE '%leave%' THEN 1 END)::int AS on_leave,
           COUNT(CASE WHEN tr.attendance_status IS NULL
                      OR LOWER(tr.attendance_status) = 'absent' THEN 1 END)::int AS absent
         FROM all_emp ae
         LEFT JOIN today_rec tr ON tr.employee_id = ae.id`,
        [orgId, today]
      ),
    ]);

    const totalEmployees = empRows[0]?.total ?? 0;
    const todayPresent = todayAttRows[0]?.present ?? 0;
    const todayAbsent = todayAttRows[0]?.absent ?? 0;
    const todayOnLeave = todayAttRows[0]?.on_leave ?? 0;

    // Attendance rate over period
    const attRateRows = await query<any>(
      `WITH days AS (
         SELECT generate_series(
           (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - ($2 - 1),
           (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
           '1 day'::interval
         )::date AS day
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
       ),
       emp_count AS (
         SELECT COUNT(*) AS total FROM users
         WHERE is_active = true AND organization_id = $1
       )
       SELECT
         d.day::text AS date,
         COALESCE(p.present_count, 0)::int AS present,
         GREATEST(ec.total::int - COALESCE(p.present_count, 0)::int, 0) AS absent
       FROM days d
       CROSS JOIN emp_count ec
       LEFT JOIN presents p ON p.day = d.day
       ORDER BY d.day ASC`,
      [orgId, days]
    );

    const totalAttDays = attRateRows.reduce((s: number, r: any) => s + r.present + r.absent, 0);
    const totalPresent = attRateRows.reduce((s: number, r: any) => s + r.present, 0);
    const attendanceRate = totalAttDays > 0 ? Math.round((totalPresent / totalAttDays) * 100) : null;

    // ── B. Attendance by role ─────────────────────────────────────────────
    const attByRoleRows = await query<any>(
      `WITH all_emp AS (
         SELECT id, role FROM users
         WHERE is_active = true AND organization_id = $1
       ),
       period_mark AS (
         SELECT DISTINCT ON (employee_id)
           employee_id, attendance_status
         FROM attendance_records
         WHERE organization_id = $1
           AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $2::date
         ORDER BY employee_id, id ASC
       )
       SELECT
         ae.role,
         COUNT(*)::int AS total,
         COUNT(CASE WHEN LOWER(pm.attendance_status) = 'present' THEN 1 END)::int AS present,
         COUNT(CASE WHEN pm.attendance_status IS NULL
                    OR LOWER(pm.attendance_status) = 'absent' THEN 1 END)::int AS absent,
         COUNT(CASE WHEN pm.attendance_status ILIKE '%leave%' THEN 1 END)::int AS on_leave
       FROM all_emp ae
       LEFT JOIN period_mark pm ON pm.employee_id = ae.id
       GROUP BY ae.role`,
      [orgId, today]
    );

    // ── C. Payroll analytics ──────────────────────────────────────────────
    const payrollRows = await query<any>(
      `SELECT pp.id, pp.period_year, pp.period_month, pp.status,
              COALESCE(pp.total_gross, 0)::numeric AS total_gross,
              COALESCE(pp.total_deductions, 0)::numeric AS total_deductions,
              COALESCE(pp.total_net, 0)::numeric AS total_net,
              (SELECT COUNT(*) FROM payroll_records pr WHERE pr.payroll_period_id = pp.id) AS record_count,
              (SELECT COUNT(*) FROM payroll_records pr WHERE pr.payroll_period_id = pp.id AND pr.status = 'approved') AS approved_count,
              (SELECT COUNT(*) FROM payroll_records pr WHERE pr.payroll_period_id = pp.id AND pr.status = 'exception') AS exception_count,
              (SELECT COALESCE(SUM(pay.amount), 0) FROM payroll_payments pay
               JOIN payroll_records pr2 ON pr2.id = pay.payroll_record_id
               WHERE pr2.payroll_period_id = pp.id AND pay.status = 'completed') AS total_paid
       FROM payroll_periods pp
       WHERE pp.organization_id = $1
       ORDER BY pp.period_year DESC, pp.period_month DESC
       LIMIT 12`,
      [orgId]
    );

    const latestApprovedPeriod = payrollRows.find((p: any) => p.status === "approved");
    const approvedPayrollTotal = latestApprovedPeriod ? Number(latestApprovedPeriod.total_net) : null;
    const totalPaid = latestApprovedPeriod ? Number(latestApprovedPeriod.total_paid) : null;
    const outstanding = approvedPayrollTotal !== null && totalPaid !== null
      ? approvedPayrollTotal - totalPaid : null;

    // Monthly payroll trend
    const payrollTrend = payrollRows.slice(0, 6).reverse().map((p: any) => ({
      month: new Date(2000, p.period_month - 1).toLocaleString("en", { month: "short" }),
      year: p.period_year,
      gross: Number(p.total_gross),
      deductions: Number(p.total_deductions),
      net: Number(p.total_net),
      paid: Number(p.total_paid),
      status: p.status,
      employees: Number(p.record_count),
      approved: Number(p.approved_count),
      exceptions: Number(p.exception_count),
    }));

    // ── D. Incentive analytics ────────────────────────────────────────────
    let incentiveData = {
      pendingCount: 0, pendingTotal: 0,
      approvedCount: 0, approvedTotal: 0,
      paidCount: 0, paidTotal: 0,
      byEmployee: [] as { name: string; role: string; total: number; count: number }[],
    };
    try {
      const incRows = await query<any>(
        `SELECT
           COUNT(CASE WHEN ei.status = 'pending' THEN 1 END)::int AS pending_count,
           COALESCE(SUM(CASE WHEN ei.status = 'pending' THEN ei.amount END), 0)::numeric AS pending_total,
           COUNT(CASE WHEN ei.status = 'approved' THEN 1 END)::int AS approved_count,
           COALESCE(SUM(CASE WHEN ei.status = 'approved' THEN ei.amount END), 0)::numeric AS approved_total,
           COUNT(CASE WHEN ei.status = 'paid' THEN 1 END)::int AS paid_count,
           COALESCE(SUM(CASE WHEN ei.status = 'paid' THEN ei.amount END), 0)::numeric AS paid_total
         FROM employee_incentives ei
         WHERE ei.organization_id = $1 AND ei.status != 'reversed'`,
        [orgId]
      );
      const ir = incRows[0];
      incentiveData.pendingCount = ir?.pending_count ?? 0;
      incentiveData.pendingTotal = Number(ir?.pending_total ?? 0);
      incentiveData.approvedCount = ir?.approved_count ?? 0;
      incentiveData.approvedTotal = Number(ir?.approved_total ?? 0);
      incentiveData.paidCount = ir?.paid_count ?? 0;
      incentiveData.paidTotal = Number(ir?.paid_total ?? 0);

      const incByEmpRows = await query<any>(
        `SELECT u.name, u.role, SUM(ei.amount)::numeric AS total, COUNT(*)::int AS count
         FROM employee_incentives ei
         JOIN users u ON u.id = ei.user_id
         WHERE ei.organization_id = $1 AND ei.status IN ('approved', 'paid')
         GROUP BY u.name, u.role
         ORDER BY total DESC
         LIMIT 10`,
        [orgId]
      );
      incentiveData.byEmployee = incByEmpRows.map((r: any) => ({
        name: r.name, role: r.role, total: Number(r.total), count: r.count,
      }));
    } catch {
      // employee_incentives may not exist
    }

    // ── E. Performance (lead activity) ────────────────────────────────────
    let performanceData = {
      byEmployee: [] as { name: string; role: string; leads: number; followUps: number; visits: number }[],
    };
    try {
      const perfRows = await query<any>(
        `SELECT
           u.name, u.role,
           COUNT(DISTINCT w.id)::int AS leads,
           (SELECT COUNT(*) FROM follow_ups f
            WHERE f.organization_id = $1 AND f.created_by_id = u.id
              AND f.created_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - ($2 - 1)
           )::int AS follow_ups,
           (SELECT COUNT(*) FROM site_visits sv
            WHERE sv.organization_id = $1 AND sv.assigned_to_id = u.id
              AND sv.visit_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - ($2 - 1)
           )::int AS visits
         FROM users u
         LEFT JOIN walkin_enquiries w ON w.organization_id = $1
           AND (w.assigned_to = u.name OR w.assigned_to_id = u.id)
           AND w.created_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - ($2 - 1)
         WHERE u.organization_id = $1 AND u.is_active = true
           AND LOWER(u.role) IN ('sales manager', 'sales_manager', 'senior sales manager', 'site head', 'site_head', 'management')
         GROUP BY u.id, u.name, u.role
         ORDER BY leads DESC
         LIMIT 15`,
        [orgId, days]
      );
      performanceData.byEmployee = perfRows.map((r: any) => ({
        name: r.name, role: r.role, leads: r.leads, followUps: r.follow_ups, visits: r.visits,
      }));
    } catch {
      // follow_ups/site_visits/walkin_enquiries may not match exactly
    }

    // ── F. HR Connect stats ───────────────────────────────────────────────
    let connectStats = { open: 0, inProgress: 0, resolved: 0, total: 0, byCategory: [] as { category: string; count: number }[] };
    try {
      const cRows = await query<any>(
        `SELECT
           COUNT(CASE WHEN status = 'open' THEN 1 END)::int AS open,
           COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int AS in_progress,
           COUNT(CASE WHEN status IN ('resolved', 'closed') THEN 1 END)::int AS resolved,
           COUNT(*)::int AS total
         FROM hr_requests WHERE organization_id = $1`,
        [orgId]
      );
      const cr = cRows[0];
      connectStats = { open: cr?.open ?? 0, inProgress: cr?.in_progress ?? 0, resolved: cr?.resolved ?? 0, total: cr?.total ?? 0, byCategory: [] };
      const catRows = await query<any>(
        `SELECT category, COUNT(*)::int AS count
         FROM hr_requests WHERE organization_id = $1
         GROUP BY category ORDER BY count DESC`,
        [orgId]
      );
      connectStats.byCategory = catRows.map((r: any) => ({ category: r.category, count: r.count }));
    } catch {
      // hr_requests may not exist
    }

    return NextResponse.json({
      success: true,
      data: {
        days,
        executive: {
          totalEmployees,
          todayPresent,
          todayAbsent,
          todayOnLeave,
          attendanceRate,
          approvedPayroll: approvedPayrollTotal,
          totalPaid,
          outstanding,
          incentivesPending: incentiveData.pendingTotal,
          incentivesApproved: incentiveData.approvedTotal,
        },
        attendanceTrend: attRateRows.map((r: any) => ({
          date: r.date,
          present: r.present,
          absent: r.absent,
        })),
        attendanceByRole: attByRoleRows.map((r: any) => ({
          role: r.role || "Unassigned",
          total: r.total,
          present: r.present,
          absent: r.absent,
          onLeave: r.on_leave,
        })),
        payrollTrend,
        incentives: incentiveData,
        performance: performanceData,
        connectStats,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/analytics]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load analytics." },
      { status: 500 }
    );
  }
}
