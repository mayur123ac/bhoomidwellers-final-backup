// api/cp-commissions/[id]/recalculate/route.ts
//
// Deliberately a separate endpoint rather than relaxing PATCH /cp-commissions/[id].
// That route refuses to touch calculated money fields at all, which is what stops
// an amount being quietly rewritten by a stray client. Correcting a commission is
// a different, explicit act: it recomputes the whole gross -> TDS -> net chain from
// an input the admin supplies, records who did it, and is admin-only.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { recalculateCommission, CPCommissionError } from "@/lib/cpCommissionEngine";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Correcting a recorded payable is an admin act — a sales manager entering the
// wrong rate is the exact scenario this exists to fix, so they must not be able
// to fix it themselves.
function canRecalculate(role: any): boolean {
  return (role || "").toString().trim().toLowerCase() === "admin";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();

    if (!canRecalculate(body.user_role)) {
      return NextResponse.json(
        { success: false, message: "Only an Admin can correct a recorded commission.", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const commissionId = Number(id);
    if (!commissionId || Number.isNaN(commissionId)) {
      return NextResponse.json({ success: false, message: "Invalid commission id." }, { status: 400 });
    }

    const updatedBy = (body.updated_by || body.user_name || "admin").toString();

    const row = await transaction((client) =>
      recalculateCommission(
        client,
        commissionId,
        {
          ratePercent: body.ratePercent ?? body.rate_percent,
          grossAmount: body.grossAmount ?? body.gross_amount,
          reason: body.reason,
        },
        updatedBy
      )
    );

    return NextResponse.json({ success: true, data: row }, { status: 200 });
  } catch (err: any) {
    if (err instanceof CPCommissionError) {
      return NextResponse.json(
        { success: false, message: err.message, code: err.code },
        { status: err.status }
      );
    }
    console.error("[PATCH /api/cp-commissions/[id]/recalculate]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
