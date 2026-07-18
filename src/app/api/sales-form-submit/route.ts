// app/api/sales-form-submit/route.ts
//
// Atomic Sales Form submission.
// Replaces the old 3-call browser sequence (followups POST + walkin_enquiries PUT
// + site-visits POST) with a single transactional endpoint so the follow-up,
// the normalized columns, the lead status, and the site visit either all land
// together or not at all.
import { NextResponse } from "next/server";
import { transaction } from "@/lib/db";

type SalesFormFields = {
  propertyType?: string;
  location?: string;
  budget?: string;
  useType?: string;
  purchaseDate?: string;
  loanPlanned?: string;
  leadStatus?: string;
};

// Build the same human-readable "Detailed Salesform Submitted" string that the
// dashboard used to construct client-side, so the follow-up timeline is unchanged.
function buildMessage(f: SalesFormFields, siteVisitDate?: string | null): string {
  let visitLine = "No";
  if (siteVisitDate) {
    try {
      visitLine = new Date(siteVisitDate).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      visitLine = String(siteVisitDate);
    }
  }

  return (
    "📝 Detailed Salesform Submitted:\n" +
    "• Property Type: " + (f.propertyType || "N/A") + "\n" +
    "• Location: " + (f.location || "N/A") + "\n" +
    "• Budget: " + (f.budget || "N/A") + "\n" +
    "• Use Type: " + (f.useType || "N/A") + "\n" +
    "• Planning to Purchase: " + (f.purchaseDate || "N/A") + "\n" +
    "• Loan Planned: " + (f.loanPlanned || "N/A") + "\n" +
    "• Lead Status: " + (f.leadStatus || "N/A") + "\n" +
    "• Site Visit Requested: " + visitLine
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      leadId,
      salesManagerName,
      createdBy,
      formFields = {},
      siteVisitDate,
    } = body as {
      leadId?: string | number;
      salesManagerName?: string;
      createdBy?: string;
      formFields?: SalesFormFields;
      siteVisitDate?: string | null;
    };

    if (!leadId) {
      return NextResponse.json(
        { success: false, message: "Missing field: leadId is required" },
        { status: 400 }
      );
    }

    const visitDate = siteVisitDate || null;
    const message = buildMessage(formFields, visitDate);
    const authorName = salesManagerName || createdBy || "sales";

    const result = await transaction(async (client) => {
      // 🔒 Row-lock the lead so no concurrent write can flip it to Closing/Lost
      // mid-transaction.
      const lockCheck = await client.query(
        `SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1 FOR UPDATE`,
        [leadId]
      );
      const lead = lockCheck.rows[0];
      if (!lead) {
        return { notFound: true as const };
      }
      if (lead.status === "Closing" || lead.is_lost_lead) {
        return { locked: true as const };
      }

      // 1️⃣ One follow-up row = the human timeline entry.
      const followUpRes = await client.query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [String(leadId), message, authorName, visitDate]
      );

      // 2️⃣ Normalized columns + status, in the same UPDATE.
      const newStatus = visitDate ? "Visit Scheduled" : lead.status;
      await client.query(
        `UPDATE walkin_enquiries
         SET status = $1,
             last_activity_at = NOW(),
             property_type = $2,
             sales_budget = $3,
             use_type = $4,
             planning_purchase = $5,
             loan_planned_confirmed = $6,
             lead_interest_status = $7
         WHERE id = $8`,
        [
          newStatus,
          formFields.propertyType || null,
          formFields.budget || null,
          formFields.useType || null,
          formFields.purchaseDate || null,
          formFields.loanPlanned || null,
          formFields.leadStatus || null,
          leadId,
        ]
      );

      // 3️⃣ One site_visits row when a visit is scheduled. No extra follow-up —
      // the row above already records it.
      if (visitDate) {
        await client.query(
          `INSERT INTO site_visits (lead_id, visit_date, created_by, role, status, notes)
           VALUES ($1, $2, $3, $4, 'scheduled', $5)`,
          [leadId, visitDate, authorName, "Sales Manager", "Scheduled via Salesform"]
        );
      }

      return { followUp: followUpRes.rows[0] };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }
    if ("locked" in result) {
      return NextResponse.json(
        { success: false, message: "Lead is locked" },
        { status: 403 }
      );
    }

    const m = result.followUp;
    return NextResponse.json(
      {
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
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST sales-form-submit error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to submit sales form" },
      { status: 500 }
    );
  }
}
