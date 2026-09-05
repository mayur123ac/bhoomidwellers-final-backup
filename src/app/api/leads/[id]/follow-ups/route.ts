// app/api/followups/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

// GET: Fetch all follow-up messages
export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // Tenant leak fixed: this returned EVERY follow-up in the database.
    //
    // NOTE (recorded, not changed): despite sitting at /api/leads/[id]/follow-ups
    // this GET takes no params and ignores the [id] entirely. Narrowing it to the
    // lead would change the route's contract for its callers, which is outside
    // Batch 2's remit — so it is scoped to the organization only and flagged.
    const messages = await query(
      `SELECT * FROM follow_ups WHERE organization_id = $1 ORDER BY created_at ASC`,
      [await getOrganizationId()]
    );

    // Map to same shape the frontend expects from the old MongoDB response
    const mapped = messages.map(m => ({
      _id:             String(m.id),
      leadId:          String(m.lead_id),
      salesManagerName: m.created_by_name || "",
      createdBy:       m.created_by_name  || "sales",
      message:         m.message,
      siteVisitDate:   m.site_visit_date  || null,
      createdAt:       m.created_at,
    }));

    return NextResponse.json({ success: true, data: mapped }, { status: 200 });

 } catch (error: any) {
    console.error("POST followups REAL ERROR:", error.message); // ← change this line
    return NextResponse.json(
      { success: false, message: error.message }, // ← and this line
      { status: 500 }
    );
  }
}

// POST: Save a new follow-up message
export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const { leadId, salesManagerName, createdBy, message, siteVisitDate } = body;

    if (!leadId || !message) {
      return NextResponse.json(
        { success: false, message: "Missing fields: leadId and message are required" },
        { status: 400 }
      );
    }

    // Security: verify the lead exists and belongs to the caller's organization.
    // Without this check any authenticated user could supply an arbitrary leadId
    // and attach a follow-up to a lead in a different organization.
    const orgId = await getOrganizationId();
    const leadCheck = await query(
      `SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [String(leadId), orgId]
    );
    if (leadCheck.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }

    const rows = await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, site_visit_date, organization_id)
       VALUES ($1, $2, $3, $6, $4, $5)
       RETURNING *`,
      [
        String(leadId),
        message,
        salesManagerName || createdBy || "sales",
        siteVisitDate    || null,
        orgId,
        gate.userId,
      ]
    );

    const m = rows[0];

    // Return same shape as old MongoDB response so frontend needs no changes
    return NextResponse.json({
      success: true,
      data: {
        _id:             String(m.id),
        leadId:          String(m.lead_id),
        salesManagerName: m.created_by_name || "",
        createdBy:       m.created_by_name  || "sales",
        message:         m.message,
        siteVisitDate:   m.site_visit_date  || null,
        createdAt:       m.created_at,
      },
    }, { status: 201 });

  } catch (error: any) {
    console.error("POST followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save message" },
      { status: 500 }
    );
  }
}