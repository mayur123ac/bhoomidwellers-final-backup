// lib/hr/payrollEngine.ts
//
// Monthly payroll generation engine. Creates draft payroll records for the
// previous calendar month. Idempotent — safe to retry.
//
// Does NOT approve or mark as paid. Only produces draft records for HR review.

import { PoolClient } from "pg";

interface PayrollGenerationResult {
  periodId: number;
  periodYear: number;
  periodMonth: number;
  employeesProcessed: number;
  exceptionsCreated: number;
  skipped: number;
  alreadyExists: boolean;
}

/**
 * Generate draft payroll for a given org + month. Called inside a transaction.
 *
 * - Creates the payroll_period row if it doesn't exist.
 * - For each active employee, snapshots salary, attendance, leave, holidays,
 *   week-offs, and approved incentives.
 * - Creates payroll_records and payroll_adjustments (incentive line items).
 * - Employees with missing salary config get status='exception'.
 * - Skips already-processed employees (idempotent).
 * - Never overwrites HR-edited drafts.
 */
export async function generateMonthlyPayroll(
  client: PoolClient,
  orgId: string,
  year: number,
  month: number,
  generatedBy: number | null
): Promise<PayrollGenerationResult> {
  // Period boundaries (IST)
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // month is 1-based, but Date(y,m,0) = last day of prev month; Date(2026,10,0) = Sep 30
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // Check if period already exists
  const existingPeriod = await client.query(
    `SELECT id, status FROM payroll_periods
     WHERE organization_id = $1 AND period_year = $2 AND period_month = $3`,
    [orgId, year, month]
  );

  let periodId: number;
  let alreadyExists = false;

  if (existingPeriod.rows.length > 0) {
    const existing = existingPeriod.rows[0];
    // If already submitted/approved, don't regenerate
    if (existing.status !== "draft" && existing.status !== "rejected") {
      return {
        periodId: existing.id,
        periodYear: year,
        periodMonth: month,
        employeesProcessed: 0,
        exceptionsCreated: 0,
        skipped: 0,
        alreadyExists: true,
      };
    }
    periodId = existing.id;
    alreadyExists = true;
  } else {
    // Create period
    const inserted = await client.query(
      `INSERT INTO payroll_periods (organization_id, period_year, period_month, period_start, period_end, generated_by)
       VALUES ($1, $2, $3, $4::date, $5::date, $6)
       RETURNING id`,
      [orgId, year, month, periodStart, periodEnd, generatedBy]
    );
    periodId = inserted.rows[0].id;
  }

  // Fetch active employees
  const employees = await client.query(
    `SELECT id, name, joining_date, created_at
     FROM users
     WHERE organization_id = $1 AND is_active = true AND deleted_at IS NULL
       AND role NOT IN ('super_admin')
     ORDER BY id`,
    [orgId]
  );

  // Fetch holidays in period
  const holidays = await client.query(
    `SELECT holiday_date::text AS day
     FROM organization_holidays
     WHERE organization_id = $1 AND is_active = true
       AND holiday_date BETWEEN $2::date AND $3::date`,
    [orgId, periodStart, periodEnd]
  );
  const holidaySet = new Set(holidays.rows.map((h: any) => h.day));

  let processed = 0;
  let exceptions = 0;
  let skipped = 0;

  for (const emp of employees.rows) {
    // Skip if record already exists for this employee+period
    const existingRecord = await client.query(
      `SELECT id, status FROM payroll_records
       WHERE payroll_period_id = $1 AND user_id = $2`,
      [periodId, emp.id]
    );

    if (existingRecord.rows.length > 0) {
      // Don't overwrite existing records (HR may have edited)
      skipped++;
      continue;
    }

    // Check if employee was active during period (joined before period end)
    const empStart = emp.joining_date || emp.created_at;
    const empStartDate = new Date(empStart);
    const periodEndDate = new Date(periodEnd + "T23:59:59+05:30");
    if (empStartDate > periodEndDate) {
      skipped++;
      continue;
    }

    // Find applicable salary
    const salaryRows = await client.query(
      `SELECT id, base_salary, effective_from, effective_to
       FROM employee_salary_history
       WHERE user_id = $1 AND organization_id = $2
         AND effective_from <= $3::date
         AND (effective_to IS NULL OR effective_to >= $4::date)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [emp.id, orgId, periodEnd, periodStart]
    );

    const hasSalary = salaryRows.rows.length > 0;
    const salary = hasSalary ? salaryRows.rows[0] : null;
    const baseSalary = salary ? Number(salary.base_salary) : 0;
    const salaryHistoryId = salary?.id || null;

    // Attendance: distinct present days in period (IST)
    const attRows = await client.query(
      `SELECT COUNT(DISTINCT DATE(login_time AT TIME ZONE 'Asia/Kolkata'))::int AS present_days
       FROM attendance_records
       WHERE employee_id = $1 AND organization_id = $2
         AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') BETWEEN $3::date AND $4::date`,
      [emp.id, orgId, periodStart, periodEnd]
    );
    const presentDays = attRows.rows[0]?.present_days ?? 0;

    // Leave days in period
    const leaveRows = await client.query(
      `SELECT COALESCE(SUM(days), 0)::int AS leave_days
       FROM employee_leave_records
       WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'
         AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]')`,
      [emp.id, orgId, periodStart, periodEnd]
    );
    const leaveDays = leaveRows.rows[0]?.leave_days ?? 0;

    // Week-off patterns
    const weekOffRows = await client.query(
      `SELECT day_of_week, effective_from, effective_to
       FROM employee_week_off_pattern
       WHERE user_id = $1 AND organization_id = $2
         AND effective_from <= $4::date
         AND (effective_to IS NULL OR effective_to >= $3::date)`,
      [emp.id, orgId, periodStart, periodEnd]
    );

    // Count working days, holidays, week-offs in period
    let workingDays = 0;
    let holidayDays = 0;
    let weekOffDays = 0;
    const cur = new Date(periodStart + "T00:00:00");
    const end = new Date(periodEnd + "T00:00:00");

    // Effective employee start within this period
    const effectiveStart = empStartDate > cur ? empStartDate : cur;

    const iter = new Date(effectiveStart);
    iter.setHours(0, 0, 0, 0);

    while (iter <= end) {
      const dayStr = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, "0")}-${String(iter.getDate()).padStart(2, "0")}`;
      const dow = iter.getDay();

      if (holidaySet.has(dayStr)) {
        holidayDays++;
      } else if (weekOffRows.rows.some((w: any) => {
        if (w.day_of_week !== dow) return false;
        const ef = new Date(w.effective_from);
        const et = w.effective_to ? new Date(w.effective_to) : null;
        return iter >= ef && (!et || iter <= et);
      })) {
        weekOffDays++;
      } else {
        workingDays++;
      }
      iter.setDate(iter.getDate() + 1);
    }

    const absentDays = Math.max(0, workingDays - presentDays - leaveDays);

    // Approved incentives in period (not yet included in any payroll)
    const incRows = await client.query(
      `SELECT id, amount, category, description
       FROM employee_incentives
       WHERE user_id = $1 AND organization_id = $2
         AND status = 'approved'
         AND (earning_date BETWEEN $3::date AND $4::date
              OR (earning_date IS NULL AND created_at BETWEEN $3::date AND ($4::date + interval '1 day')))`,
      [emp.id, orgId, periodStart, periodEnd]
    );
    const incentiveTotal = incRows.rows.reduce((sum: number, r: any) => sum + Number(r.amount), 0);

    // Calculate net
    const grossSalary = baseSalary;
    const totalAdditions = incentiveTotal;
    const totalDeductions = 0; // No auto-deductions without explicit policy
    const netPayable = grossSalary + totalAdditions - totalDeductions;

    // Determine status
    let recordStatus = "draft";
    let exceptionReason: string | null = null;

    if (!hasSalary) {
      recordStatus = "exception";
      exceptionReason = "No salary configuration found for this employee.";
      exceptions++;
    }

    // Build calculation snapshot
    const snapshot = {
      baseSalary,
      salaryHistoryId,
      workingDays,
      presentDays,
      leaveDays,
      holidayDays,
      weekOffDays,
      absentDays,
      incentiveTotal,
      grossSalary,
      totalAdditions,
      totalDeductions,
      netPayable,
      generatedAt: new Date().toISOString(),
    };

    // Insert payroll record
    const recordResult = await client.query(
      `INSERT INTO payroll_records (
         payroll_period_id, user_id, organization_id,
         base_salary, salary_history_id,
         working_days, present_days, leave_days, holiday_days, week_off_days, absent_days,
         gross_salary, total_additions, total_deductions, net_payable,
         incentive_total, status, exception_reason, calculation_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        periodId, emp.id, orgId,
        baseSalary, salaryHistoryId,
        workingDays, presentDays, leaveDays, holidayDays, weekOffDays, absentDays,
        grossSalary, totalAdditions, totalDeductions, netPayable,
        incentiveTotal, recordStatus, exceptionReason, JSON.stringify(snapshot),
      ]
    );

    const recordId = recordResult.rows[0].id;

    // Create incentive adjustment line items
    for (const inc of incRows.rows) {
      await client.query(
        `INSERT INTO payroll_adjustments (payroll_record_id, organization_id, type, category, description, amount, source, source_id, created_by)
         VALUES ($1, $2, 'addition', $3, $4, $5, 'incentive', $6, $7)`,
        [recordId, orgId, inc.category || "incentive", inc.description || "Approved incentive", Number(inc.amount), inc.id, generatedBy || 0]
      );
    }

    processed++;
  }

  // Update period totals
  await client.query(
    `UPDATE payroll_periods SET
       total_gross = (SELECT COALESCE(SUM(gross_salary), 0) FROM payroll_records WHERE payroll_period_id = $1),
       total_deductions = (SELECT COALESCE(SUM(total_deductions), 0) FROM payroll_records WHERE payroll_period_id = $1),
       total_net = (SELECT COALESCE(SUM(net_payable), 0) FROM payroll_records WHERE payroll_period_id = $1),
       employee_count = (SELECT COUNT(*) FROM payroll_records WHERE payroll_period_id = $1),
       updated_at = now()
     WHERE id = $1`,
    [periodId]
  );

  return {
    periodId,
    periodYear: year,
    periodMonth: month,
    employeesProcessed: processed,
    exceptionsCreated: exceptions,
    skipped,
    alreadyExists,
  };
}
