// app/api/hr/payroll/records/[id]/payments/route.ts
//
// POST — record a payment against an approved payroll record

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const { id } = await params;
    const recordId = Number(id);
    const body = await req.json();

    const { amount, paymentDate, paymentReference, paymentMethod } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, message: "Amount must be positive." },
        { status: 400 }
      );
    }
    if (!paymentDate) {
      return NextResponse.json(
        { success: false, message: "Payment date is required." },
        { status: 400 }
      );
    }

    // Verify record exists and is approved
    const records = await query<any>(
      `SELECT pr.id, pr.status, pr.net_payable
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
    if (record.status !== "approved") {
      return NextResponse.json(
        { success: false, message: `Cannot record payment for status '${record.status}'. Must be approved.` },
        { status: 400 }
      );
    }

    const userId = Number(gate.session._id);

    await query(
      `INSERT INTO payroll_payments (payroll_record_id, organization_id, amount, payment_date, payment_reference, payment_method, recorded_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
      [recordId, orgId, Number(amount), paymentDate, paymentReference?.trim() || null, paymentMethod?.trim() || null, userId]
    );

    return NextResponse.json({
      success: true,
      message: "Payment recorded.",
    });
  } catch (err: any) {
    // Duplicate payment reference
    if (err?.code === "23505" && err?.constraint?.includes("payment_ref")) {
      return NextResponse.json(
        { success: false, message: "Duplicate payment reference." },
        { status: 409 }
      );
    }
    console.error("[POST /api/hr/payroll/records/[id]/payments]", err);
    return NextResponse.json(
      { success: false, message: "Failed to record payment." },
      { status: 500 }
    );
  }
}
