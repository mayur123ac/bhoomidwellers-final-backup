// app/api/me/compensation/route.ts
//
// GET — Fetch the authenticated employee's own compensation data.
// Requires a valid salary_view authorization token (query param or header).
//
// Returns: current salary, salary history, payroll records (approved only),
// incentives (approved/paid), adjustments, and payment status.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { checkPasswordChangeAuth } from "@/lib/passwordChangeAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const SALARY_VIEW_PURPOSE = "salary_view";

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = getSessionUserId(gate.session);
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  // Verify salary-view token
  const token =
    req.nextUrl.searchParams.get("token") ||
    req.headers.get("x-salary-token") ||
    "";

  if (!token) {
    return NextResponse.json(
      { success: false, message: "Salary view authorization required.", code: "SALARY_AUTH_REQUIRED" },
      { status: 403 }
    );
  }

  const authCheck = await checkPasswordChangeAuth(userId, token, SALARY_VIEW_PURPOSE);
  if (!authCheck.ok) {
    const msg =
      authCheck.reason === "expired"
        ? "Your salary view session has expired. Please verify your password again."
        : authCheck.reason === "consumed"
          ? "This authorization has already been used. Please verify again."
          : "Invalid authorization. Please verify your password.";
    return NextResponse.json(
      { success: false, message: msg, code: "SALARY_AUTH_INVALID" },
      { status: 403 }
    );
  }

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ? Number(sp.get("year")) : new Date().getFullYear();

    // 1. Current salary (effective_to IS NULL)
    const currentSalary = await query<any>(
      `SELECT id, base_salary, effective_from, effective_to, revision_reason, created_at
       FROM employee_salary_history
       WHERE user_id = $1 AND organization_id = $2 AND effective_to IS NULL
       ORDER BY effective_from DESC LIMIT 1`,
      [userId, orgId]
    );

    // 2. Salary history (all records)
    const salaryHistory = await query<any>(
      `SELECT id, base_salary, effective_from, effective_to, revision_reason, created_at
       FROM employee_salary_history
       WHERE user_id = $1 AND organization_id = $2
       ORDER BY effective_from DESC`,
      [userId, orgId]
    );

    // 3. Payroll records — only approved/submitted (never draft/exception)
    const payrollRecords = await query<any>(
      `SELECT pr.id, pr.payroll_period_id, pp.period_year, pp.period_month,
              pp.period_start, pp.period_end, pp.status AS period_status,
              pr.base_salary, pr.working_days, pr.present_days, pr.leave_days,
              pr.holiday_days, pr.week_off_days, pr.absent_days,
              pr.gross_salary, pr.total_additions, pr.total_deductions,
              pr.net_payable, pr.incentive_total, pr.status
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       WHERE pr.user_id = $1 AND pr.organization_id = $2
         AND pr.status IN ('submitted', 'approved')
         AND pp.period_year = $3
       ORDER BY pp.period_year DESC, pp.period_month DESC`,
      [userId, orgId, year]
    );

    // 4. Adjustments for those records
    const recordIds = payrollRecords.map((r: any) => r.id);
    let adjustments: any[] = [];
    if (recordIds.length > 0) {
      adjustments = await query<any>(
        `SELECT id, payroll_record_id, type, category, description, amount, source
         FROM payroll_adjustments
         WHERE payroll_record_id = ANY($1) AND organization_id = $2
         ORDER BY created_at ASC`,
        [recordIds, orgId]
      );
    }

    // 5. Payments for those records
    let payments: any[] = [];
    if (recordIds.length > 0) {
      payments = await query<any>(
        `SELECT id, payroll_record_id, amount, payment_date, payment_method, status
         FROM payroll_payments
         WHERE payroll_record_id = ANY($1) AND organization_id = $2
           AND status = 'completed'
         ORDER BY payment_date DESC`,
        [recordIds, orgId]
      );
    }

    // 6. Incentives (approved + paid only, not pending)
    const incentives = await query<any>(
      `SELECT id, amount, category, description, earning_date, earning_period,
              status, approved_at, created_at
       FROM employee_incentives
       WHERE user_id = $1 AND organization_id = $2
         AND status IN ('approved', 'paid')
         AND EXTRACT(YEAR FROM COALESCE(earning_date, created_at)) = $3
       ORDER BY COALESCE(earning_date, created_at) DESC`,
      [userId, orgId, year]
    );

    // 7. Incentive summary (all statuses for informational display)
    const incentiveSummary = await query<any>(
      `SELECT status,
              COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::numeric AS total
       FROM employee_incentives
       WHERE user_id = $1 AND organization_id = $2
         AND EXTRACT(YEAR FROM COALESCE(earning_date, created_at)) = $3
       GROUP BY status`,
      [userId, orgId, year]
    );

    // Group adjustments and payments by record
    const adjByRecord = new Map<number, any[]>();
    for (const a of adjustments) {
      const list = adjByRecord.get(a.payroll_record_id) || [];
      list.push({
        id: a.id,
        type: a.type,
        category: a.category,
        description: a.description,
        amount: Number(a.amount),
        source: a.source,
      });
      adjByRecord.set(a.payroll_record_id, list);
    }

    const payByRecord = new Map<number, any[]>();
    for (const p of payments) {
      const list = payByRecord.get(p.payroll_record_id) || [];
      list.push({
        id: p.id,
        amount: Number(p.amount),
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method,
        status: p.status,
      });
      payByRecord.set(p.payroll_record_id, list);
    }

    // Build response
    const current = currentSalary[0] || null;

    // Latest approved payroll for "Your Pay" card
    const latestApproved = payrollRecords.find((r: any) => r.status === "approved") || null;
    const latestPayments = latestApproved ? (payByRecord.get(latestApproved.id) || []) : [];
    const totalPaid = latestPayments.reduce((s: number, p: any) => s + p.amount, 0);

    return NextResponse.json({
      success: true,
      data: {
        year,
        currentSalary: current
          ? {
              baseSalary: Number(current.base_salary),
              effectiveFrom: current.effective_from,
              revisionReason: current.revision_reason,
            }
          : null,

        salaryHistory: salaryHistory.map((s: any) => ({
          baseSalary: Number(s.base_salary),
          effectiveFrom: s.effective_from,
          effectiveTo: s.effective_to,
          revisionReason: s.revision_reason,
        })),

        latestPay: latestApproved
          ? {
              periodYear: latestApproved.period_year,
              periodMonth: latestApproved.period_month,
              netPayable: Number(latestApproved.net_payable),
              totalPaid,
              outstanding: Number(latestApproved.net_payable) - totalPaid,
              status: latestApproved.status,
              periodStatus: latestApproved.period_status,
            }
          : null,

        payrollRecords: payrollRecords.map((r: any) => {
          const rPayments = payByRecord.get(r.id) || [];
          const rPaid = rPayments.reduce((s: number, p: any) => s + p.amount, 0);
          return {
            id: r.id,
            periodYear: r.period_year,
            periodMonth: r.period_month,
            periodStart: r.period_start,
            periodEnd: r.period_end,
            baseSalary: Number(r.base_salary),
            workingDays: r.working_days,
            presentDays: r.present_days,
            leaveDays: r.leave_days,
            holidayDays: r.holiday_days,
            weekOffDays: r.week_off_days,
            absentDays: r.absent_days,
            grossSalary: Number(r.gross_salary),
            totalAdditions: Number(r.total_additions),
            totalDeductions: Number(r.total_deductions),
            netPayable: Number(r.net_payable),
            incentiveTotal: Number(r.incentive_total),
            status: r.status,
            periodStatus: r.period_status,
            adjustments: adjByRecord.get(r.id) || [],
            payments: rPayments,
            totalPaid: rPaid,
            outstanding: Number(r.net_payable) - rPaid,
          };
        }),

        incentives: incentives.map((i: any) => ({
          id: i.id,
          amount: Number(i.amount),
          category: i.category,
          description: i.description,
          earningDate: i.earning_date,
          earningPeriod: i.earning_period,
          status: i.status,
          approvedAt: i.approved_at,
        })),

        incentiveSummary: Object.fromEntries(
          incentiveSummary.map((s: any) => [
            s.status,
            { count: s.count, total: Number(s.total) },
          ])
        ),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/me/compensation]", err?.message);
    return NextResponse.json(
      { success: false, message: "Failed to load compensation data." },
      { status: 500 }
    );
  }
}
