// app/api/booking-applications/[id]/pdd/[pddId]/route.ts
// Mark a PDD document submitted (or edit its details).
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function isLoanManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager", "site_head", "site head"].includes(clean);
}

const EDITABLE: Record<string, (v: any) => any> = {
  document_name: v => String(v),
  required_by_date: v => v || null,
  submitted: v => !!v,
  submitted_date: v => v || null,
  submitted_to: v => (v == null ? null : String(v)),
  acknowledgement_no: v => (v == null ? null : String(v)),
  remarks: v => (v == null ? null : String(v)),
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pddId: string }> },
) {
  const { id, pddId } = await params;
  try {
    const body = await req.json();
    const { user_name, user_role } = body;
    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isLoanManager(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can update PDD." }, { status: 403 });
    }

    const setParts: string[] = [];
    const vals: any[] = [];
    for (const [key, coerce] of Object.entries(EDITABLE)) {
      if (key in body) {
        vals.push(coerce(body[key]));
        setParts.push(`${key} = $${vals.length}`);
      }
    }
    // Convenience: marking submitted with no explicit date defaults to today.
    if (body.submitted === true && !("submitted_date" in body)) {
      setParts.push(`submitted_date = COALESCE(submitted_date, CURRENT_DATE)`);
    }
    if (setParts.length === 0) {
      return NextResponse.json({ success: false, message: "No fields to update" }, { status: 400 });
    }
    setParts.push(`updated_at = NOW()`);
    vals.push(Number(pddId), Number(id));

    const rows = await query(
      `UPDATE loan_pdd_tracking SET ${setParts.join(", ")}
       WHERE id = $${vals.length - 1} AND booking_id = $${vals.length}
       RETURNING *`,
      vals,
    );
    if (!rows.length) {
      return NextResponse.json({ success: false, message: "PDD record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/booking-applications/[id]/pdd/[pddId]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
