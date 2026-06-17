// app/api/walkin_enquiries/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const { id } = await params;
    const body = await req.json();

    const {
      name, status, alt_phone, loan_planned,
      source_other, cp_name, cp_company, cp_phone,
      assigned_to, // for transfer flow
      is_lost_lead, lost_lead_reason, lost_lead_marked_at, lost_lead_marked_by,
      enquiry_date, // backdated enquiry date support
      // assigned_receptionist is intentionally NEVER accepted here
    } = body;

    const fields: string[] = [];
    const values: any[]    = [];
    let i = 1;

    if (name         !== undefined) { fields.push(`name = $${i++}`);         values.push(name); }
    if (status       !== undefined) { fields.push(`status = $${i++}`);       values.push(status); }
    if (alt_phone    !== undefined) { fields.push(`alt_phone = $${i++}`);    values.push(alt_phone); }
    if (loan_planned !== undefined) { fields.push(`loan_planned = $${i++}`); values.push(loan_planned); }
    if (source_other !== undefined) { fields.push(`source_other = $${i++}`); values.push(source_other); }
    if (cp_name      !== undefined) { fields.push(`cp_name = $${i++}`);      values.push(cp_name); }
    if (cp_company   !== undefined) { fields.push(`cp_company = $${i++}`);   values.push(cp_company); }
    if (cp_phone     !== undefined) { fields.push(`cp_phone = $${i++}`);     values.push(cp_phone); }
    if (assigned_to  !== undefined) { fields.push(`assigned_to = $${i++}`);  values.push(assigned_to); }
    if (is_lost_lead !== undefined) { fields.push(`is_lost_lead = $${i++}`); values.push(is_lost_lead); }
    if (lost_lead_reason    !== undefined) { fields.push(`lost_lead_reason = $${i++}`);    values.push(lost_lead_reason); }
    if (lost_lead_marked_at !== undefined) { fields.push(`lost_lead_marked_at = $${i++}`); values.push(lost_lead_marked_at); }
    if (lost_lead_marked_by !== undefined) { fields.push(`lost_lead_marked_by = $${i++}`); values.push(lost_lead_marked_by); }
    if (enquiry_date !== undefined) { fields.push(`enquiry_date = $${i++}`); values.push(enquiry_date); }

    if (fields.length === 0) {
      return NextResponse.json({ success: false, message: "No fields to update" }, { status: 400 });
    }

    values.push(id);
    const query = `UPDATE walkin_enquiries SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 200 });

  } catch (error: any) {
    console.error("PUT walkin_enquiries error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const { id } = await params;
    await pool.query(`DELETE FROM walkin_enquiries WHERE id = $1`, [id]);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("DELETE walkin_enquiries error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}