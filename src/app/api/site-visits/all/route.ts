import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// GET all site visits (admin-wide overview) with lead info joined
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let sql = `
      SELECT 
        sv.id,
        sv.lead_id,
        sv.visit_date,
        sv.created_by,
        sv.role,
        sv.status,
        sv.notes,
        sv.created_at,
        we.name    AS lead_name,
        we.phone   AS lead_phone,
        we.status  AS lead_status,
        we.assigned_to,
        we.assigned_receptionist
      FROM public.site_visits sv
      JOIN public.walkin_enquiries we ON we.id = sv.lead_id
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (from) {
      conditions.push(`sv.visit_date >= $${params.length + 1}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`sv.visit_date <= $${params.length + 1}`);
      params.push(to);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY sv.visit_date DESC`;

    const rows = await query(sql, params);

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// DELETE a site visit by id
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, message: "Missing id" }, { status: 400 });
    }

    await query(`DELETE FROM public.site_visits WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
