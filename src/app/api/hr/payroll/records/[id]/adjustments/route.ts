// app/api/hr/payroll/records/[id]/adjustments/route.ts
//
// POST — add a manual adjustment (addition or deduction) to a draft record

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function POST(
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

    const { type, category, description, amount } = body;

    if (!type || !["addition", "deduction"].includes(type)) {
      return NextResponse.json(
        { success: false, message: "Type must be 'addition' or 'deduction'." },
        { status: 400 }
      );
    }
    if (!category?.trim()) {
      return NextResponse.json(
        { success: false, message: "Category is required." },
        { status: 400 }
      );
    }
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, message: "Amount must be positive." },
        { status: 400 }
      );
    }

    // Verify record exists, belongs to org, and is editable
    const records = await query<any>(
      `SELECT pr.id, pr.status, pr.payroll_period_id,
              pr.gross_salary, pr.total_additions, pr.total_deductions
       FROM payroll_records pr
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
    if (record.status !== "draft" && record.status !== "exception") {
      return NextResponse.json(
        { success: false, message: `Cannot add adjustments to a record with status '${record.status}'.` },
        { status: 400 }
      );
    }

    const userId = Number(gate.session._id);
    const numAmount = Number(amount);

    // Insert adjustment
    await query(
      `INSERT INTO payroll_adjustments (payroll_record_id, organization_id, type, category, description, amount, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)`,
      [recordId, orgId, type, category.trim(), description?.trim() || null, numAmount, userId]
    );

    // Recalculate record totals from adjustments
    const totals = await query<any>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'addition'), 0) AS additions,
         COALESCE(SUM(amount) FILTER (WHERE type = 'deduction'), 0) AS deductions
       FROM payroll_adjustments
       WHERE payroll_record_id = $1`,
      [recordId]
    );

    const additions = Number(totals[0].additions);
    const deductions = Number(totals[0].deductions);
    const grossSalary = Number(record.gross_salary);
    const netPayable = grossSalary + additions - deductions;

    await query(
      `UPDATE payroll_records SET
         total_additions = $1, total_deductions = $2, net_payable = $3, updated_at = now()
       WHERE id = $4`,
      [additions, deductions, netPayable, recordId]
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

    return NextResponse.json({
      success: true,
      message: `${type === "addition" ? "Addition" : "Deduction"} of ${numAmount} added.`,
    });
  } catch (err: any) {
    console.error("[POST /api/hr/payroll/records/[id]/adjustments]", err);
    return NextResponse.json(
      { success: false, message: "Failed to add adjustment." },
      { status: 500 }
    );
  }
}
