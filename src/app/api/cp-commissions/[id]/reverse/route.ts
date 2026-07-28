// api/cp-commissions/[id]/reverse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { reverseCPCommission, CPCommissionError } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const reason = (body.reason || "").toString().trim();
    const updatedBy = (body.updated_by || body.user_name || "system").toString();

    if (!reason) {
      return NextResponse.json(
        { success: false, message: "A reversal reason is required.", code: "REASON_REQUIRED" },
        { status: 400 }
      );
    }

    const row = await transaction(async (client) => {
      // The engine keys on booking_id (a booking has at most one commission), while
      // the route is addressed by commission id — resolve inside the transaction so
      // the lookup and the reversal see the same snapshot.
      const found = await client.query(`SELECT booking_id FROM cp_commissions WHERE id = $1`, [
        Number(id),
      ]);
      if (found.rows.length === 0) {
        throw new CPCommissionError(`Commission ${id} not found.`, "COMMISSION_NOT_FOUND", 404);
      }
      return reverseCPCommission(client, found.rows[0].booking_id, reason, updatedBy);
    });

    return NextResponse.json({ success: true, data: row }, { status: 200 });
  } catch (err: any) {
    if (err instanceof CPCommissionError) {
      return NextResponse.json(
        { success: false, message: err.message, code: err.code },
        { status: err.status }
      );
    }
    console.error("[POST /api/cp-commissions/[id]/reverse]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
