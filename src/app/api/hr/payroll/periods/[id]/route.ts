// app/api/hr/payroll/periods/[id]/route.ts
//
// GET   — period detail with all employee records
// PATCH — submit / approve / reject a period

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { PAYROLL_APPROVE_ROLES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

// ── GET: period detail with records ───────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const { id } = await params;
    const periodId = Number(id);

    const periods = await query<any>(
      `SELECT * FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
      [periodId, orgId]
    );

    if (periods.length === 0) {
      return NextResponse.json(
        { success: false, message: "Period not found." },
        { status: 404 }
      );
    }

    const period = periods[0];

    // Fetch records with employee names
    const records = await query<any>(
      `SELECT pr.*, u.name AS employee_name, u.email AS employee_email, u.employee_code
       FROM payroll_records pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.payroll_period_id = $1 AND pr.organization_id = $2
       ORDER BY u.name ASC`,
      [periodId, orgId]
    );

    // Fetch adjustments for all records in this period
    const recordIds = records.map((r: any) => r.id);
    let adjustments: any[] = [];
    if (recordIds.length > 0) {
      adjustments = await query<any>(
        `SELECT * FROM payroll_adjustments
         WHERE payroll_record_id = ANY($1) AND organization_id = $2
         ORDER BY created_at ASC`,
        [recordIds, orgId]
      );
    }

    // Group adjustments by record
    const adjByRecord = new Map<number, any[]>();
    for (const adj of adjustments) {
      const list = adjByRecord.get(adj.payroll_record_id) || [];
      list.push({
        id: adj.id,
        type: adj.type,
        category: adj.category,
        description: adj.description,
        amount: Number(adj.amount),
        source: adj.source,
        sourceId: adj.source_id,
      });
      adjByRecord.set(adj.payroll_record_id, list);
    }

    const mappedRecords = records.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      employeeName: r.employee_name,
      employeeEmail: r.employee_email,
      employeeCode: r.employee_code,
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
      exceptionReason: r.exception_reason,
      adjustments: adjByRecord.get(r.id) || [],
    }));

    return NextResponse.json({
      success: true,
      data: {
        period: {
          id: period.id,
          year: period.period_year,
          month: period.period_month,
          periodStart: period.period_start,
          periodEnd: period.period_end,
          status: period.status,
          totalGross: Number(period.total_gross),
          totalDeductions: Number(period.total_deductions),
          totalNet: Number(period.total_net),
          employeeCount: period.employee_count,
          generatedAt: period.generated_at,
          submittedAt: period.submitted_at,
          approvedAt: period.approved_at,
          rejectedAt: period.rejected_at,
          rejectionReason: period.rejection_reason,
          notes: period.notes,
        },
        records: mappedRecords,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/payroll/periods/[id]]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load period detail." },
      { status: 500 }
    );
  }
}

// ── PATCH: submit / approve / reject ──────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // All HR/admin can submit; only admin can approve (separation of duties)
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const { id } = await params;
    const periodId = Number(id);
    const body = await req.json();
    const { action, rejectionReason, notes } = body;

    if (!["submit", "approve", "reject"].includes(action)) {
      return NextResponse.json(
        { success: false, message: "Action must be 'submit', 'approve', or 'reject'." },
        { status: 400 }
      );
    }

    // Load current period
    const periods = await query<any>(
      `SELECT id, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
      [periodId, orgId]
    );
    if (periods.length === 0) {
      return NextResponse.json(
        { success: false, message: "Period not found." },
        { status: 404 }
      );
    }

    const current = periods[0];
    const userId = Number(gate.session._id);
    const role = gate.session.role?.toLowerCase().replace(/_/g, " ");

    // ── Submit (draft/rejected → submitted) ───────────────────────────────
    if (action === "submit") {
      if (current.status !== "draft" && current.status !== "rejected") {
        return NextResponse.json(
          { success: false, message: `Cannot submit a period with status '${current.status}'.` },
          { status: 400 }
        );
      }

      // Check for unresolved exceptions
      const exceptions = await query<any>(
        `SELECT COUNT(*)::int AS cnt FROM payroll_records
         WHERE payroll_period_id = $1 AND status = 'exception'`,
        [periodId]
      );
      if (exceptions[0]?.cnt > 0) {
        return NextResponse.json(
          { success: false, message: `Cannot submit: ${exceptions[0].cnt} records have unresolved exceptions.` },
          { status: 400 }
        );
      }

      await query(
        `UPDATE payroll_periods SET status = 'submitted', submitted_at = now(), submitted_by = $1, notes = COALESCE($2, notes), updated_at = now()
         WHERE id = $3`,
        [userId, notes || null, periodId]
      );

      // Cascade status to draft records
      await query(
        `UPDATE payroll_records SET status = 'submitted', updated_at = now()
         WHERE payroll_period_id = $1 AND status = 'draft'`,
        [periodId]
      );

      return NextResponse.json({ success: true, message: "Payroll submitted for approval." });
    }

    // ── Approve (submitted → approved) — admin only ───────────────────────
    if (action === "approve") {
      const approveRoles = PAYROLL_APPROVE_ROLES.map((r) => r.toLowerCase());
      if (!approveRoles.includes(role)) {
        return NextResponse.json(
          { success: false, message: "Only Admin can approve payroll (separation of duties)." },
          { status: 403 }
        );
      }

      if (current.status !== "submitted") {
        return NextResponse.json(
          { success: false, message: `Cannot approve a period with status '${current.status}'.` },
          { status: 400 }
        );
      }

      await query(
        `UPDATE payroll_periods SET status = 'approved', approved_at = now(), approved_by = $1, notes = COALESCE($2, notes), updated_at = now()
         WHERE id = $3`,
        [userId, notes || null, periodId]
      );

      await query(
        `UPDATE payroll_records SET status = 'approved', updated_at = now()
         WHERE payroll_period_id = $1 AND status = 'submitted'`,
        [periodId]
      );

      return NextResponse.json({ success: true, message: "Payroll approved." });
    }

    // ── Reject (submitted → rejected) — admin only ────────────────────────
    if (action === "reject") {
      const approveRoles = PAYROLL_APPROVE_ROLES.map((r) => r.toLowerCase());
      if (!approveRoles.includes(role)) {
        return NextResponse.json(
          { success: false, message: "Only Admin can reject payroll." },
          { status: 403 }
        );
      }

      if (current.status !== "submitted") {
        return NextResponse.json(
          { success: false, message: `Cannot reject a period with status '${current.status}'.` },
          { status: 400 }
        );
      }

      if (!rejectionReason?.trim()) {
        return NextResponse.json(
          { success: false, message: "Rejection reason is required." },
          { status: 400 }
        );
      }

      await query(
        `UPDATE payroll_periods SET status = 'rejected', rejected_at = now(), rejected_by = $1, rejection_reason = $2, notes = COALESCE($3, notes), updated_at = now()
         WHERE id = $4`,
        [userId, rejectionReason.trim(), notes || null, periodId]
      );

      // Cascade back to draft so HR can edit
      await query(
        `UPDATE payroll_records SET status = 'draft', updated_at = now()
         WHERE payroll_period_id = $1 AND status = 'submitted'`,
        [periodId]
      );

      return NextResponse.json({ success: true, message: "Payroll rejected. HR can review and resubmit." });
    }

    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    console.error("[PATCH /api/hr/payroll/periods/[id]]", err);
    return NextResponse.json(
      { success: false, message: "Failed to update period." },
      { status: 500 }
    );
  }
}
