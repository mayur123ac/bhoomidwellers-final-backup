// app/api/followups/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// GET: Fetch all follow-up messages
export async function GET() {
  try {
    const messages = await query(
      `SELECT * FROM follow_ups ORDER BY created_at ASC`
    );

    // Return same shape as old MongoDB response so frontend needs no changes
    const mapped = messages.map(m => ({
      _id: String(m.id),
      leadId: String(m.lead_id),
      salesManagerName: m.created_by_name || "",
      createdBy: m.created_by_name || "sales",
      message: m.message,
      siteVisitDate: m.site_visit_date || null,
      createdAt: m.created_at,
    }));

    return NextResponse.json({ success: true, data: mapped }, { status: 200 });

  } catch (error) {
    console.error("GET followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

// POST: Save a new follow-up message
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { leadId, salesManagerName, createdBy, message, siteVisitDate } = body;

    if (!leadId || !message) {
      return NextResponse.json(
        { success: false, message: "Missing fields: leadId and message are required" },
        { status: 400 }
      );
    }

    // 🔒 Final-state lock guard
    const leadRows = await query(
      `SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1`,
      [leadId]
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

    const rows = await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        String(leadId),
        message,
        salesManagerName || createdBy || "sales",
        siteVisitDate || null,
      ]
    );

    const m = rows[0];

    // Return same shape as old MongoDB response
    return NextResponse.json({
      success: true,
      data: {
        _id: String(m.id),
        leadId: String(m.lead_id),
        salesManagerName: m.created_by_name || "",
        createdBy: m.created_by_name || "sales",
        message: m.message,
        siteVisitDate: m.site_visit_date || null,
        createdAt: m.created_at,
      },
    }, { status: 201 });

  } catch (error) {
    console.error("POST followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save message" },
      { status: 500 }
    );
  }
}
