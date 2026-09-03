//api/site-visits
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export async function GET(req: Request) {
  try {
    // Lead names and phones join into this response.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");

    // ✅ Lead-specific history — fetch ALL visits, not just today's
    if (leadId) {
      const rows = await query(
        `SELECT * FROM public.site_visits 
         WHERE lead_id = $1 AND organization_id = $2
         ORDER BY visit_date ASC`,
        [leadId, await getOrganizationId()]
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
      // The JOIN carries its own tenant predicate as well as the outer filter:
      // scoping only sv would still let a visit join a lead from another
      // organization and expose we.name / we.assigned_to through it.
      `SELECT sv.*, we.name as lead_name, we.assigned_to
       FROM public.site_visits sv
       JOIN public.walkin_enquiries we
         ON we.id = sv.lead_id AND we.organization_id = sv.organization_id
       WHERE sv.visit_date >= $1 AND sv.visit_date <= $2
         AND sv.organization_id = $3
       ORDER BY sv.visit_date ASC`,
      [svStart.toISOString(), svEnd.toISOString(), await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { lead_id, visit_date, created_by, role, notes } = await req.json();
    if (!lead_id || !visit_date || !created_by) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    // 🔒 Final-state lock guard
    const leadRows = await query(
      `SELECT status, is_lost_lead FROM public.walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [lead_id, await getOrganizationId()]
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
       WHERE lead_id = $1 AND visit_date = $2 AND status != 'cancelled'
         AND organization_id = $3`,
      [lead_id, visit_date, await getOrganizationId()]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, message: "A visit already exists at this date/time" },
        { status: 409 }
      );
    }

    const result = await query(
      `INSERT INTO public.site_visits (lead_id, visit_date, created_by, created_by_id, role, status, notes, organization_id)
       VALUES ($1, $2, $3, $7, $4, 'scheduled', $5, $6)
       RETURNING *`,
      [lead_id, visit_date, created_by, role || "Sales Manager", notes || "", await getOrganizationId(), gate.userId]
    );

    const newVisit = result[0];

    // Log the scheduling as a follow-up
    await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, organization_id) VALUES ($1, $2, $3, $5, $4)`,
      [lead_id, `Site Visit Scheduled for ${new Date(visit_date).toLocaleString("en-IN")}`, created_by, await getOrganizationId(), gate.userId]
    );

    return NextResponse.json({ success: true, data: newVisit });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    // Hard delete of a visit row.
    const gate = await requireRoles(["admin", "sales manager", "receptionist"]);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, message: "Missing id" }, { status: 400 });
    }
    // id comes from the query string, so the organization is part of the WHERE:
    // another organization's visit matches 0 rows.
    await query(`DELETE FROM public.site_visits WHERE id = $1 AND organization_id = $2`, [id, await getOrganizationId()]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

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

    // id comes from the request; organization_id is appended after it so the
    // dynamic SET clause's placeholder numbering is untouched.
    values.push(id);
    values.push(await getOrganizationId());
    const result = await query(
      `UPDATE public.site_visits SET ${fields.join(", ")} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
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
        `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, organization_id) VALUES ($1, $2, $3, $5, $4)`,
        [updatedVisit.lead_id, message, "Admin", await getOrganizationId(), gate.userId]
      );
      
      if (status === "completed") {
        await query(
          `UPDATE public.walkin_enquiries SET status = 'Site Visit Done' WHERE id = $1 AND status != 'Closing' AND is_lost_lead = false AND organization_id = $2`,
          [updatedVisit.lead_id, await getOrganizationId()]
        );
        await query(
          `UPDATE public.site_visits SET completed_at = NOW() WHERE id = $1 AND completed_at IS NULL`,
          [id]
        );
      }
    }

    return NextResponse.json({ success: true, data: updatedVisit });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}