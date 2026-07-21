// app/api/booking-applications/[id]/loan-applications/route.ts
// Lender applications scoped to a booking (once one exists). Same rows as the
// lead-scoped list, filtered to those migrated onto this booking.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── GET — list lender applications for a booking ─────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT * FROM loan_applications WHERE booking_id = $1 ORDER BY created_at ASC`,
      [Number(id)],
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/loan-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
