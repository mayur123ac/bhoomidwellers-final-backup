// app/api/hr/payroll/records/[id]/route.ts
//
// GET   — single payroll record detail with adjustments and payments
// PATCH — edit a draft record OR submit/approve/reject an individual record

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { PAYROLL_APPROVE_ROLES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

// ── GET: record detail ────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const { id } = await params;
    const recordId = Number(id);

    const records = await query<any>(
      `SELECT pr.*, u.name AS employee_name, u.email AS employee_email,
              pp.period_year, pp.period_month, pp.status AS period_status
       FROM payroll_records pr
       JOIN users u ON u.id = pr.user_id
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       WHERE pr.id = $1 AND pr.organization_id = $2`,
      [recordId, orgId]
    );

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, message: "Record not found." },
        { status: 404 }
      );
    }

    const r = records[0];

    const adjustments = await query<any>(
      `SELECT * FROM payroll_adjustments
       WHERE payroll_record_id = $1 AND organization_id = $2
       ORDER BY created_at ASC`,
      [recordId, orgId]
    );

    const payments = await query<any>(
      `SELECT * FROM payroll_payments
       WHERE payroll_record_id = $1 AND organization_id = $2
       ORDER BY payment_date DESC`,
      [recordId, orgId]
    );

    return NextResponse.json({
      success: true,
      data: {
        record: {
          id: r.id,
          periodId: r.payroll_period_id,
          periodYear: r.period_year,
          periodMonth: r.period_month,
          periodStatus: r.period_status,
          userId: r.user_id,
          employeeName: r.employee_name,
          employeeEmail: r.employee_email,
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
          calculationSnapshot: r.calculation_snapshot,
        },
        adjustments: adjustments.map((a: any) => ({
          id: a.id,
          type: a.type,
          category: a.category,
          description: a.description,
          amount: Number(a.amount),
          source: a.source,
          sourceId: a.source_id,
          createdAt: a.created_at,
        })),
        payments: payments.map((p: any) => ({
          id: p.id,
          amount: Number(p.amount),
          paymentDate: p.payment_date,
          paymentReference: p.payment_reference,
          paymentMethod: p.payment_method,
          status: p.status,
          reversalReason: p.reversal_reason,
          createdAt: p.created_at,
        })),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/payroll/records/[id]]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load record." },
      { status: 500 }
    );
  }
}

// ── PATCH: edit a draft record OR submit/approve/reject ──────────────────────
//
// Field edits:  { baseSalary, grossSalary, ... }  — only draft/exception records
// Actions:      { action: "submit" | "approve" | "reject", rejectionReason? }
//
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const { id } = await params;
    const recordId = Number(id);
    const body = await req.json();
    const userId = Number(gate.session._id);
    const role = gate.session.role?.toLowerCase().replace(/_/g, " ");

    // Load record
    const records = await query<any>(
      `SELECT pr.id, pr.status, pr.payroll_period_id, pr.base_salary,
              pr.net_payable, pr.exception_reason,
              pp.status AS period_status
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       WHERE pr.id = $1 AND pr.organization_id = $2`,
      [recordId, orgId]
    );

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, message: "Record not found." },
        { status: 404 }
      );
    }

    const record = records[0];

    // ── Action-based transitions ────────────────────────────────────────────
    if (body.action) {
      const { action, rejectionReason } = body;

      if (!["submit", "approve", "reject"].includes(action)) {
        return NextResponse.json(
          { success: false, message: "Action must be 'submit', 'approve', or 'reject'." },
          { status: 400 }
        );
      }

      // ── Submit (draft/rejected → submitted) ────────────────────────────
      if (action === "submit") {
        if (record.status !== "draft" && record.status !== "rejected") {
          return NextResponse.json(
            { success: false, message: `Cannot submit a record with status '${record.status}'.` },
            { status: 400 }
          );
        }

        // Validate: base salary must be > 0 (no unresolved exception)
        if (Number(record.base_salary) <= 0) {
          return NextResponse.json(
            { success: false, message: "Cannot submit: base salary is zero. Configure salary first." },
            { status: 400 }
          );
        }

        await query(
          `UPDATE payroll_records
              SET status = 'submitted', submitted_at = now(), submitted_by = $1,
                  rejected_at = NULL, rejected_by = NULL, rejection_reason = NULL,
                  updated_at = now()
            WHERE id = $2 AND organization_id = $3`,
          [userId, recordId, orgId]
        );

        return NextResponse.json({ success: true, message: "Record submitted for Admin approval." });
      }

      // ── Approve (submitted → approved) — admin only ────────────────────
      if (action === "approve") {
        const approveRoles = PAYROLL_APPROVE_ROLES.map((r) => r.toLowerCase());
        if (!approveRoles.includes(role)) {
          return NextResponse.json(
            { success: false, message: "Only Admin can approve individual payroll records." },
            { status: 403 }
          );
        }

        if (record.status !== "submitted") {
          return NextResponse.json(
            { success: false, message: `Cannot approve a record with status '${record.status}'.` },
            { status: 400 }
          );
        }

        await query(
          `UPDATE payroll_records
              SET status = 'approved', approved_at = now(), approved_by = $1, updated_at = now()
            WHERE id = $2 AND organization_id = $3 AND status = 'submitted'`,
          [userId, recordId, orgId]
        );

        return NextResponse.json({ success: true, message: "Record approved." });
      }

      // ── Reject (submitted → rejected) — admin only ─────────────────────
      if (action === "reject") {
        const approveRoles = PAYROLL_APPROVE_ROLES.map((r) => r.toLowerCase());
        if (!approveRoles.includes(role)) {
          return NextResponse.json(
            { success: false, message: "Only Admin can reject payroll records." },
            { status: 403 }
          );
        }

        if (record.status !== "submitted") {
          return NextResponse.json(
            { success: false, message: `Cannot reject a record with status '${record.status}'.` },
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
          `UPDATE payroll_records
              SET status = 'rejected', rejected_at = now(), rejected_by = $1,
                  rejection_reason = $2, updated_at = now()
            WHERE id = $3 AND organization_id = $4 AND status = 'submitted'`,
          [userId, rejectionReason.trim(), recordId, orgId]
        );

        return NextResponse.json({ success: true, message: "Record rejected. HR can review and resubmit." });
      }
    }

    // ── Field edits (original behavior) — only draft/exception records ───
    if (record.status !== "draft" && record.status !== "exception") {
      return NextResponse.json(
        { success: false, message: `Cannot edit a record with status '${record.status}'.` },
        { status: 400 }
      );
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let p = 1;

    const editableFields: Record<string, string> = {
      baseSalary: "base_salary",
      grossSalary: "gross_salary",
      totalAdditions: "total_additions",
      totalDeductions: "total_deductions",
      netPayable: "net_payable",
      workingDays: "working_days",
      presentDays: "present_days",
      leaveDays: "leave_days",
      holidayDays: "holiday_days",
      weekOffDays: "week_off_days",
      absentDays: "absent_days",
      exceptionReason: "exception_reason",
    };

    for (const [jsKey, dbCol] of Object.entries(editableFields)) {
      if (body[jsKey] !== undefined) {
        setClauses.push(`${dbCol} = $${p++}`);
        values.push(body[jsKey]);
      }
    }

    // Resolve exception if requested
    if (body.resolveException === true) {
      setClauses.push(`status = $${p++}`);
      values.push("draft");
      // Only clear exception_reason if not explicitly provided in body
      if (body.exceptionReason === undefined) {
        setClauses.push(`exception_reason = $${p++}`);
        values.push(null);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, message: "No fields to update." },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = now()`);

    values.push(recordId);
    values.push(orgId);
    await query(
      `UPDATE payroll_records SET ${setClauses.join(", ")}
       WHERE id = $${p} AND organization_id = $${p + 1}`,
      values
    );

    // Recalculate period totals
    await query(
      `UPDATE payroll_periods SET
         total_gross = (SELECT COALESCE(SUM(gross_salary + total_additions), 0) FROM payroll_records WHERE payroll_period_id = $1),
         total_deductions = (SELECT COALESCE(SUM(total_deductions), 0) FROM payroll_records WHERE payroll_period_id = $1),
         total_net = (SELECT COALESCE(SUM(net_payable), 0) FROM payroll_records WHERE payroll_period_id = $1),
         updated_at = now()
       WHERE id = $1`,
      [record.payroll_period_id]
    );

    return NextResponse.json({ success: true, message: "Record updated." });
  } catch (err: any) {
    console.error("[PATCH /api/hr/payroll/records/[id]]", err);
    return NextResponse.json(
      { success: false, message: "Failed to update record." },
      { status: 500 }
    );
  }
}
