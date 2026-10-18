// app/api/hr/employees/[id]/earnings/route.ts
//
// GET — employee financial summary from verified source records.
//
// Reports salary RATES (not paid amounts), incentive statuses, and
// attendance/leave totals. Does not claim payments occurred without
// a verified payment record.
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

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
    const year = Number(sp.get("year") || new Date().getFullYear());

    // Fetch employee's joining date / created_at for absent-day calculation
    const empMeta = await query<any>(
      `SELECT joining_date, created_at FROM users
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [userId, orgId]
    );

    const [salaryRows, incentiveRows, leaveRows, attendanceRows, holidayRows, weekOffRows, leaveRecordRows] = await Promise.all([
      // Current salary rate + history
      query<any>(
        `SELECT base_salary, effective_from, effective_to
           FROM employee_salary_history
          WHERE user_id = $1 AND organization_id = $2
          ORDER BY effective_from DESC`,
        [userId, orgId]
      ),

      // Incentive summary by status
      query<any>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0)::numeric AS total_pending,
           COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0)::numeric AS total_approved,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)::numeric AS total_paid,
           COALESCE(SUM(CASE WHEN status != 'reversed' THEN amount END), 0)::numeric AS total_earned
         FROM employee_incentives
        WHERE user_id = $1 AND organization_id = $2
          AND EXTRACT(YEAR FROM COALESCE(earning_date, created_at)) = $3`,
        [userId, orgId, year]
      ),

      // Leave allocation summary for year
      query<any>(
        `SELECT leave_type, allocated, used, (allocated - used) AS remaining
           FROM employee_leave_allocations
          WHERE user_id = $1 AND organization_id = $2 AND year = $3
          ORDER BY leave_type`,
        [userId, orgId, year]
      ),

      // Attendance counts for year — DISTINCT IST dates, not raw rows.
      // login_time is timestamptz; Neon session timezone is UTC, so we
      // must convert to IST before extracting the date.
      query<any>(
        `SELECT
           COUNT(DISTINCT DATE(login_time AT TIME ZONE 'Asia/Kolkata'))::int AS present_days,
           COUNT(*)::int AS total_records
         FROM attendance_records
        WHERE employee_id = $1 AND organization_id = $2
          AND EXTRACT(YEAR FROM login_time AT TIME ZONE 'Asia/Kolkata') = $3`,
        [userId, orgId, year]
      ),

      // Organization holidays in year (for absent-day calculation)
      query<any>(
        `SELECT holiday_date::text AS day
           FROM organization_holidays
          WHERE organization_id = $1 AND is_active = true
            AND EXTRACT(YEAR FROM holiday_date) = $2`,
        [orgId, year]
      ),

      // Employee week-off patterns active in year
      query<any>(
        `SELECT day_of_week, effective_from, effective_to
           FROM employee_week_off_pattern
          WHERE user_id = $1 AND organization_id = $2
            AND EXTRACT(YEAR FROM effective_from) <= $3
            AND (effective_to IS NULL OR EXTRACT(YEAR FROM effective_to) >= $3)`,
        [userId, orgId, year]
      ),

      // Approved leave days in year
      query<any>(
        `SELECT start_date, end_date, days
           FROM employee_leave_records
          WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'
            AND EXTRACT(YEAR FROM start_date) = $3`,
        [userId, orgId, year]
      ),
    ]);

    const currentSalary = salaryRows.find((s: any) => s.effective_to === null);

    // ── Compute absent days from calendar, holidays, week-offs, leaves ──
    const presentDays = attendanceRows[0]?.present_days ?? 0;
    const totalRecords = attendanceRows[0]?.total_records ?? 0;

    // Determine the employee's applicable date range for the year
    const meta = empMeta[0];
    const joiningOrCreated = meta?.joining_date || meta?.created_at;
    const yearStart = new Date(`${year}-01-01T00:00:00+05:30`);
    const nowIst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const yearEnd = year < nowIst.getFullYear()
      ? new Date(`${year}-12-31T00:00:00+05:30`)
      : nowIst;

    // Start from joining/creation date or year start, whichever is later
    let periodStart = yearStart;
    if (joiningOrCreated) {
      const jd = new Date(joiningOrCreated);
      if (jd > periodStart) periodStart = jd;
    }

    // Build holiday set
    const holidaySet = new Set(holidayRows.map((h: any) => h.day));

    // Count approved leave days in year
    const approvedLeaveDays = leaveRecordRows.reduce((sum: number, l: any) => sum + Number(l.days || 0), 0);

    // Count calendar days, excluding holidays and week-offs
    let totalCalendarDays = 0;
    let holidayDays = 0;
    let weekOffDays = 0;
    const hasWeekOffConfig = weekOffRows.length > 0;

    const cur = new Date(periodStart);
    cur.setHours(0, 0, 0, 0);
    const endDate = new Date(yearEnd);
    endDate.setHours(0, 0, 0, 0);

    while (cur <= endDate) {
      totalCalendarDays++;
      const dayStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      const dayOfWeek = cur.getDay();

      if (holidaySet.has(dayStr)) {
        holidayDays++;
      } else if (hasWeekOffConfig && weekOffRows.some((w: any) => {
        if (w.day_of_week !== dayOfWeek) return false;
        const effFrom = new Date(w.effective_from);
        const effTo = w.effective_to ? new Date(w.effective_to) : null;
        return cur >= effFrom && (!effTo || cur <= effTo);
      })) {
        weekOffDays++;
      }

      cur.setDate(cur.getDate() + 1);
    }

    const expectedWorkingDays = totalCalendarDays - holidayDays - weekOffDays;
    const absentDays = Math.max(0, expectedWorkingDays - presentDays - approvedLeaveDays);

    return NextResponse.json({
      success: true,
      data: {
        year,
        salary: {
          currentMonthlyBase: currentSalary ? Number(currentSalary.base_salary) : null,
          rateHistory: salaryRows.map((s: any) => ({
            baseSalary: Number(s.base_salary),
            effectiveFrom: s.effective_from,
            effectiveTo: s.effective_to,
          })),
          note: "Salary rates from employee_salary_history. These are configured rates, not verified payment records. Payroll is a future phase.",
        },
        incentives: {
          totalPending: Number(incentiveRows[0]?.total_pending ?? 0),
          totalApproved: Number(incentiveRows[0]?.total_approved ?? 0),
          totalPaid: Number(incentiveRows[0]?.total_paid ?? 0),
          totalEarned: Number(incentiveRows[0]?.total_earned ?? 0),
          note: "Incentive amounts from employee_incentives. 'paid' requires a verified payment record.",
        },
        leave: leaveRows.map((r: any) => ({
          leaveType: r.leave_type,
          allocated: Number(r.allocated),
          used: Number(r.used),
          remaining: Number(r.remaining),
        })),
        attendance: {
          presentDays,
          absentDays,
          totalRecords,
          totalCalendarDays,
          holidayDays,
          weekOffDays,
          approvedLeaveDays,
          expectedWorkingDays,
          hasWeekOffConfig,
          periodStart: periodStart.toISOString().slice(0, 10),
          note: !hasWeekOffConfig
            ? "Week-off schedule not configured. All calendar days are treated as working days. Configure week-offs for accurate absent counts."
            : undefined,
        },
      },
    });
  } catch (err: any) {
    console.error("[GET employee earnings]", err);
    return NextResponse.json({ success: false, message: "Failed to load earnings summary." }, { status: 500 });
  }
}
