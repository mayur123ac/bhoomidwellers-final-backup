// app/api/leads/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";

const jsonFields = new Set<keyof LeadUpdate>([
  "site_visit_history",
  "loan_tracking_info",
  "referral_info",
]);

const contactStatuses = new Set([
  "Contacted",
  "Interested",
  "Visit Scheduled",
  "Completed",
  "Closing",
  "Closed",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const leadId = Number(id);
    if (Number.isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid lead ID" }, { status: 400 });
    }

    const body = (await req.json()) as Partial<LeadUpdate>;

    const allowed: (keyof LeadUpdate)[] = [
      "name",
      "contact_no",
      "email",
      "source",
      "budget",
      "location",
      "channel_partner",
      "assign_manager",
      "feedback",
      "interest_status",
      "status",
      "site_visit_date",
      "assigned_at",
      "first_contact_at",
      "last_activity_at",
      "site_visit_history",
      "loan_tracking_info",
      "referral_info",
    ];

    const result = await transaction(async (client) => {
      const existingRows = await client.query(
        "SELECT id, assign_manager FROM leads WHERE id = $1",
        [leadId]
      );

      if (existingRows.rows.length === 0) {
        return null;
      }

      const previousManager = existingRows.rows[0].assign_manager;
      const assignmentChanged =
        typeof body.assign_manager === "string" &&
        body.assign_manager.trim().length > 0 &&
        body.assign_manager !== previousManager;

      const setClauses: string[] = [];
      const values: any[] = [];

      for (const key of allowed) {
        if (key in body && body[key] !== undefined) {
          let value = body[key];
          if (jsonFields.has(key)) {
            value = typeof value === "string" ? value : JSON.stringify(value ?? {});
          }
          values.push(value);
          setClauses.push(`${key} = $${values.length}`);
        }
      }

      if (assignmentChanged && !("assigned_at" in body)) {
        setClauses.push("assigned_at = NOW()");
      }

      if (
        body.status &&
        contactStatuses.has(body.status) &&
        !("first_contact_at" in body)
      ) {
        setClauses.push("first_contact_at = COALESCE(first_contact_at, NOW())");
      }

      if (!("last_activity_at" in body)) {
        setClauses.push("last_activity_at = NOW()");
      }

      if (setClauses.length === 0) {
        return { noFields: true };
      }

      values.push(leadId);
      const updateRows = await client.query(
        `
          UPDATE leads
          SET ${setClauses.join(", ")}, updated_at = NOW()
          WHERE id = $${values.length}
          RETURNING *
        `,
        values
      );

      if (assignmentChanged) {
        await client.query(
          `
            INSERT INTO lead_assignment_logs (lead_id, assigned_to, assigned_by, reason)
            VALUES ($1, $2, $3, $4)
          `,
          [
            leadId,
            body.assign_manager,
            body.assigned_by || "System/API",
            body.assignment_reason || "Manager Assigned",
          ]
        );
      }

      return { lead: updateRows.rows[0] };
    });

    if (!result) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if ("noFields" in result) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    return NextResponse.json({ success: true, lead: result.lead });
  } catch (err: any) {
    console.error(`[PATCH /api/leads/${id}]`, err);
    return NextResponse.json(
      { error: err.message || "Failed to update lead" },
      { status: 500 }
    );
  }
}

interface LeadUpdate {
  name: string;
  contact_no: string;
  email: string;
  source: string;
  budget: string;
  location: string;
  channel_partner: string;
  assign_manager: string;
  feedback: string;
  interest_status: string | null;
  status: string;
  site_visit_date: string | null;
  assigned_at?: string | null;
  first_contact_at?: string | null;
  last_activity_at?: string | null;
  site_visit_history?: any;
  loan_tracking_info?: any;
  referral_info?: any;
  assigned_by?: string;
  assignment_reason?: string;
}
