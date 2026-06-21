import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");

    // ✅ Lead-specific history — fetch ALL visits, not just today's
    if (leadId) {
      const rows = await query(
        `SELECT * FROM public.site_visits 
         WHERE lead_id = $1 
         ORDER BY visit_date ASC`,
        [leadId]
      );
      return NextResponse.json({ success: true, data: rows });
    }

    // ✅ Dashboard: today's visits — use IST-aware UTC window
    const now = new Date();
    const todayStr = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]; // today's date in IST

    // Store as UTC bounds covering the full IST day
    const svStart = new Date(todayStr + "T00:00:00.000+05:30");
    const svEnd = new Date(todayStr + "T23:59:59.999+05:30");

    const rows = await query(
      `SELECT sv.*, we.name as lead_name, we.assigned_to
       FROM public.site_visits sv
       JOIN public.walkin_enquiries we ON we.id = sv.lead_id
       WHERE sv.visit_date >= $1 AND sv.visit_date <= $2
       ORDER BY sv.visit_date ASC`,
      [svStart.toISOString(), svEnd.toISOString()]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { lead_id, visit_date, created_by, role, notes } = await req.json();
    if (!lead_id || !visit_date || !created_by) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    // 🔒 Final-state lock guard
    const leadRows = await query(
      `SELECT status, is_lost_lead FROM public.walkin_enquiries WHERE id = $1`,
      [lead_id]
    );
    const lead = leadRows[0];
    if (!lead) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }
    if (lead.status === "Closing" || lead.is_lost_lead) {
      return NextResponse.json(
        { success: false, message: "Closed or Lost leads cannot be modified." },
        { status: 403 }
      );
    }

    // Note: We allow scheduling in the past so admins can log visits that already occurred.

    // Prevent duplicate on same datetime
    const existing = await query(
      `SELECT id FROM public.site_visits 
       WHERE lead_id = $1 AND visit_date = $2 AND status != 'cancelled'`,
      [lead_id, visit_date]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, message: "A visit already exists at this date/time" },
        { status: 409 }
      );
    }

    const result = await query(
      `INSERT INTO public.site_visits (lead_id, visit_date, created_by, role, status, notes)
       VALUES ($1, $2, $3, $4, 'scheduled', $5)
       RETURNING *`,
      [lead_id, visit_date, created_by, role || "Sales Manager", notes || ""]
    );

    const newVisit = result[0];

    // Log the scheduling as a follow-up
    await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name) VALUES ($1, $2, $3)`,
      [lead_id, `Site Visit Scheduled for ${new Date(visit_date).toLocaleString("en-IN")}`, created_by]
    );

    return NextResponse.json({ success: true, data: newVisit });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

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

export async function PATCH(req: Request) {
  try {
    const { id, status, notes, visit_date } = await req.json();
    if (!id) {
      return NextResponse.json({ success: false, message: "Missing id" }, { status: 400 });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(notes);
    }
    if (visit_date !== undefined) {
      fields.push(`visit_date = $${idx++}`);
      values.push(visit_date);
    }

    if (fields.length === 0) {
      return NextResponse.json({ success: false, message: "Nothing to update" }, { status: 400 });
    }

    values.push(id);
    const result = await query(
      `UPDATE public.site_visits SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    const updatedVisit = result[0];

    if (!updatedVisit) {
      return NextResponse.json(
        { success: false, message: "Site visit not found. It may be a legacy record; please reschedule it to create a proper entry." },
        { status: 404 }
      );
    }

    if (status && ["completed", "cancelled", "rescheduled"].includes(status)) {
      const message = `Site Visit marked as ${status.charAt(0).toUpperCase() + status.slice(1)}`;
      await query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name) VALUES ($1, $2, $3)`,
        [updatedVisit.lead_id, message, "Admin"]
      );
      
      if (status === "completed") {
        await query(
          `UPDATE public.walkin_enquiries SET status = 'Site Visit Done' WHERE id = $1 AND status != 'Closing' AND is_lost_lead = false`,
          [updatedVisit.lead_id]
        );
      }
    }

    return NextResponse.json({ success: true, data: updatedVisit });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}