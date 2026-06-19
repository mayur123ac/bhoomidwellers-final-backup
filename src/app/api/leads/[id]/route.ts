// app/api/leads/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// ✅ NEW — to this
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const leadId = Number(id);    
    if (isNaN(leadId)) return NextResponse.json({ error: "Invalid lead ID" }, { status: 400 });

    const body = await req.json() as Partial<LeadUpdate>;

    const allowed: (keyof LeadUpdate)[] = [
      "name", "contact_no", "email", "source", "budget", "location",
      "channel_partner", "assign_manager", "feedback",
      "interest_status", "status", "site_visit_date",
      "assigned_at", "first_contact_at", "last_activity_at",
      "site_visit_history", "loan_tracking_info", "referral_info"
    ];

    const setClauses: string[] = [];
    const values: any[]        = [];

    // Check if assign_manager is being updated to a specific person
    if ("assign_manager" in body && body.assign_manager) {
      if (!body.assigned_at) {
        body.assigned_at = new Date().toISOString();
      }
    }

    for (const key of allowed) {
      if (key in body && body[key] !== undefined) {
        let val = body[key];
        if (key === 'site_visit_history' || key === 'loan_tracking_info' || key === 'referral_info') {
          val = typeof val === 'string' ? val : JSON.stringify(val);
        }
        values.push(val);
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(leadId);
    const sql = `
      UPDATE leads
      SET ${setClauses.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const rows = await query(sql, values);
    if (rows.length === 0) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    // Handle audit logging if assigned
    if (body.assign_manager) {
      await query(`
        INSERT INTO lead_assignment_logs (lead_id, assigned_to, assigned_by, reason)
        VALUES ($1, $2, $3, $4)
      `, [leadId, body.assign_manager, 'System/API', 'Manager Assigned']);
    }

    return NextResponse.json({ success: true, lead: rows[0] });
    } catch (err: any) {
        console.error(`[PATCH /api/leads/${id}]`, err);  // ✅ id not params.id
  }

}

interface LeadUpdate {
  name:            string;
  contact_no:      string;
  email:           string;
  source:          string;
  budget:          string;
  location:        string;
  channel_partner: string;
  assign_manager:  string;
  feedback:        string;
  interest_status: string | null;
  status:          string;
  site_visit_date: string | null;
  assigned_at?:    string | null;
  first_contact_at?: string | null;
  last_activity_at?: string | null;
  site_visit_history?: any;
  loan_tracking_info?: any;
  referral_info?: any;
}