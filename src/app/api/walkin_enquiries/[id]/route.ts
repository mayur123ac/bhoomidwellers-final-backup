// app/api/walkin_enquiries/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool, transaction } from "@/lib/db";

const jsonFields = new Set([
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

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const leadId = Number(id);
    if (Number.isNaN(leadId)) {
      return NextResponse.json(
        { success: false, message: "Invalid lead ID" },
        { status: 400 }
      );
    }

    const body = await req.json();

    const allowedFields = [
      "name",
      "status",
      "alt_phone",
      "loan_planned",
      "source_other",
      "cp_name",
      "cp_company",
      "cp_phone",
      "assigned_to",
      "is_lost_lead",
      "lost_lead_reason",
      "lost_lead_marked_at",
      "lost_lead_marked_by",
      "enquiry_date",
      "assigned_at",
      "first_contact_at",
      "last_activity_at",
      "site_visit_history",
      "loan_tracking_info",
      "referral_info",
    ];

    const result = await transaction(async (client) => {
      const existingRows = await client.query(
        "SELECT id, assigned_to, status, is_lost_lead FROM walkin_enquiries WHERE id = $1",
        [leadId]
      );

      if (existingRows.rows.length === 0) {
        return null;
      }

      const existingLead = existingRows.rows[0];
      const previousAssignee = existingLead.assigned_to;
      const assignmentChanged =
        typeof body.assigned_to === "string" &&
        body.assigned_to.trim().length > 0 &&
        body.assigned_to !== previousAssignee;

      // 🔒 Final-state lock guard — Closed/Lost leads are read-only,
      // except for the explicit Reopen (status away from "Closing")
      // or Restore (is_lost_lead → false) transitions that unlock them.
      const isCurrentlyLocked =
        existingLead.status === "Closing" || existingLead.is_lost_lead === true;
      const isReopenAttempt =
        existingLead.status === "Closing" &&
        typeof body.status === "string" &&
        body.status !== "Closing";
      const isRestoreAttempt =
        existingLead.is_lost_lead === true && body.is_lost_lead === false;

      if (isCurrentlyLocked && !isReopenAttempt && !isRestoreAttempt) {
        return { locked: true };
      }

      const fields: string[] = [];
      const values: any[] = [];

      for (const field of allowedFields) {
        if (field in body && body[field] !== undefined) {
          let value = body[field];
          if (jsonFields.has(field)) {
            value = typeof value === "string" ? value : JSON.stringify(value ?? {});
          }
          values.push(value);
          fields.push(`${field} = $${values.length}`);
        }
      }

      if (assignmentChanged && !("assigned_at" in body)) {
        fields.push("assigned_at = NOW()");
      }

      if (
        body.status &&
        contactStatuses.has(body.status) &&
        !("first_contact_at" in body)
      ) {
        fields.push("first_contact_at = COALESCE(first_contact_at, NOW())");
      }

      if (!("last_activity_at" in body)) {
        fields.push("last_activity_at = NOW()");
      }

      if (fields.length === 0) {
        return { noFields: true };
      }

      values.push(leadId);
      const updateRows = await client.query(
        `UPDATE walkin_enquiries SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
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
            body.assigned_to,
            body.assigned_by || body.transferred_by || body.updated_by || "System/API",
            body.assignment_reason || body.transfer_note || "Lead Assigned",
          ]
        );
      }

      return { data: updateRows.rows[0] };
    });

    if (!result) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }

    if ("noFields" in result) {
      return NextResponse.json(
        { success: false, message: "No fields to update" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: result.data }, { status: 200 });
  } catch (error: any) {
    console.error("PUT walkin_enquiries error:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const { id } = await params;
    await pool.query("DELETE FROM walkin_enquiries WHERE id = $1", [id]);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("DELETE walkin_enquiries error:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
