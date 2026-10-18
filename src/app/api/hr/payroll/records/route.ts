// app/api/hr/payroll/records/route.ts
//
// GET — list payroll records, optionally filtered by status.
// Used by Admin Payroll Approvals to find individually submitted records.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || null;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "50")));

    const conditions: string[] = ["pr.organization_id = $1"];
    const values: any[] = [orgId];
    let idx = 2;

    if (status) {
      conditions.push(`pr.status = $${idx++}`);
      values.push(status);
    }

    const where = conditions.join(" AND ");

    const rows = await query<any>(
      `SELECT pr.id, pr.user_id, pr.payroll_period_id,
              pr.base_salary, pr.gross_salary, pr.total_additions, pr.total_deductions,
              pr.net_payable, pr.incentive_total, pr.status, pr.exception_reason,
              pr.working_days, pr.present_days, pr.leave_days, pr.holiday_days,
              pr.week_off_days, pr.absent_days,
              pr.submitted_at, pr.submitted_by, pr.approved_at, pr.approved_by,
              pr.rejected_at, pr.rejected_by, pr.rejection_reason,
              u.name AS employee_name, u.email AS employee_email, u.employee_code,
              pp.period_year, pp.period_month, pp.status AS period_status
       FROM payroll_records pr
       JOIN users u ON u.id = pr.user_id
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       WHERE ${where}
       ORDER BY pr.submitted_at DESC NULLS LAST, pr.updated_at DESC
       LIMIT ${limit}`,
      values
    );

    const records = rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      periodId: r.payroll_period_id,
      periodYear: r.period_year,
      periodMonth: r.period_month,
      periodStatus: r.period_status,
      employeeName: r.employee_name,
      employeeEmail: r.employee_email,
      employeeCode: r.employee_code,
      baseSalary: Number(r.base_salary),
      grossSalary: Number(r.gross_salary),
      totalAdditions: Number(r.total_additions),
      totalDeductions: Number(r.total_deductions),
      netPayable: Number(r.net_payable),
      incentiveTotal: Number(r.incentive_total),
      workingDays: r.working_days,
      presentDays: r.present_days,
      leaveDays: r.leave_days,
      holidayDays: r.holiday_days,
      weekOffDays: r.week_off_days,
      absentDays: r.absent_days,
      status: r.status,
      exceptionReason: r.exception_reason,
      submittedAt: r.submitted_at,
      submittedBy: r.submitted_by,
      approvedAt: r.approved_at,
      approvedBy: r.approved_by,
      rejectedAt: r.rejected_at,
      rejectedBy: r.rejected_by,
      rejectionReason: r.rejection_reason,
    }));

    return NextResponse.json({ success: true, data: { records } });
  } catch (err: any) {
    console.error("[GET /api/hr/payroll/records]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load records." },
      { status: 500 }
    );
  }
}
