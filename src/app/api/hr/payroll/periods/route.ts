// app/api/hr/payroll/periods/route.ts
//
// GET  — list payroll periods for the current org
// POST — generate (or re-generate) draft payroll for a given month

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { generateMonthlyPayroll } from "@/lib/hr/payrollEngine";

export const dynamic = "force-dynamic";

// ── GET: list periods ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ? Number(sp.get("year")) : null;
    const status = sp.get("status") || null;
    const page = Math.max(1, Number(sp.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, Number(sp.get("limit") || "20")));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["organization_id = $1"];
    const values: any[] = [orgId];
    let idx = 2;

    if (year) {
      conditions.push(`period_year = $${idx++}`);
      values.push(year);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }

    const where = conditions.join(" AND ");

    const rows = await query<any>(
      `SELECT *, (SELECT COUNT(*) FROM payroll_periods WHERE ${where}) AS _total
       FROM payroll_periods
       WHERE ${where}
       ORDER BY period_year DESC, period_month DESC
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );

    const total = rows.length > 0 ? Number(rows[0]._total) : 0;

    const periods = rows.map((r) => ({
      id: r.id,
      year: r.period_year,
      month: r.period_month,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      status: r.status,
      totalGross: Number(r.total_gross),
      totalDeductions: Number(r.total_deductions),
      totalNet: Number(r.total_net),
      employeeCount: r.employee_count,
      generatedAt: r.generated_at,
      submittedAt: r.submitted_at,
      approvedAt: r.approved_at,
      rejectedAt: r.rejected_at,
      rejectionReason: r.rejection_reason,
      notes: r.notes,
    }));

    return NextResponse.json({
      success: true,
      data: {
        periods,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/payroll/periods]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load payroll periods." },
      { status: 500 }
    );
  }
}

// ── POST: generate payroll for a month ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const { year, month } = await req.json();

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { success: false, message: "Valid year and month (1-12) are required." },
        { status: 400 }
      );
    }

    const userId = Number(gate.session._id);

    const result = await transaction((client) =>
      generateMonthlyPayroll(client, orgId, year, month, userId)
    );

    return NextResponse.json({
      success: true,
      data: result,
      message: result.alreadyExists
        ? `Payroll period already exists. ${result.employeesProcessed} new records generated.`
        : `Payroll generated for ${result.employeesProcessed} employees.`,
    });
  } catch (err: any) {
    console.error("[POST /api/hr/payroll/periods]", err);
    return NextResponse.json(
      { success: false, message: "Failed to generate payroll." },
      { status: 500 }
    );
  }
}
