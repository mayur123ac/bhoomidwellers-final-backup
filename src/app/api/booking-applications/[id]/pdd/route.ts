// app/api/booking-applications/[id]/pdd/route.ts
// Post-Disbursement Documents checklist for a booking. Seeded automatically when
// a loan fully disburses (see the tranches route), or manually by an admin here.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { seedPddChecklist } from "@/lib/pdd";

export const dynamic = "force-dynamic";

function isLoanManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager", "site_head", "site head"].includes(clean);
}

// ─── GET — list the PDD checklist for a booking ───────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT * FROM loan_pdd_tracking WHERE booking_id = $1 ORDER BY id ASC`,
      [Number(id)],
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/pdd]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — seed the standard PDD checklist (idempotent) ──────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const { user_name, user_role } = body;
    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isLoanManager(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can seed PDD." }, { status: 403 });
    }

    const inserted = await seedPddChecklist(Number(id), body.loan_application_id ?? null, body.disbursement_date ?? null);
    const rows = await query(
      `SELECT * FROM loan_pdd_tracking WHERE booking_id = $1 ORDER BY id ASC`,
      [Number(id)],
    );
    return NextResponse.json({ success: true, seeded: inserted, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[POST /api/booking-applications/[id]/pdd]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
