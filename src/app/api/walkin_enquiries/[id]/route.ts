// app/api/walkin_enquiries/[id]/route.ts
import { NextResponse } from "next/server";
import { query, transaction, recalculateSrNos } from "@/lib/db";
import { requireRole, getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { getOrganizationId } from "@/lib/tenantContext";
import {
  deleteLeadAssets,
  deleteLeadDatabaseRecords,
  deleteLeadLocalUploads,
  getExistingColumns,
  insertLeadDeletionAudit,
} from "@/lib/leadDeletion";

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

// ─── GET — one lead's loan-form draft ─────────────────────────────────────────
// Read-only, and deliberately narrow: it returns the lead's id/name plus the
// loan_tracking_info JSONB that the Loan & Deal form writes (agreement value
// estimate, GST rate, token amount, sanction figures…). The Booking form reads
// it to prefill Step 3 — see applyLoanPrefill in BookingFormModal.
//
// Scoped to these columns rather than SELECT * so a read added for a prefill
// can't become an accidental full-lead disclosure endpoint.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const leadId = Number(id);
    if (Number.isNaN(leadId)) {
      return NextResponse.json({ success: false, message: "Invalid lead ID" }, { status: 400 });
    }

    const rows = await query(
      "SELECT id, name, loan_tracking_info FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
      [leadId, await getOrganizationId()]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/walkin_enquiries/[id]]", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // This endpoint has no per-role field scoping — allowedFields below never
    // includes sourcing_manager_id, so it can't reassign a channel partner, but a
    // Sourcing Manager could still use it to edit status/assigned_to on ANY lead,
    // including a CP enquiry that belongs to someone else. Receptionist, Sales
    // Manager, Site Head and Admin all have real, working call sites against this
    // route today (booking forms, contact-field edits, loan deal updates, lead
    // status changes) — narrowing their access here risks breaking flows this
    // change was never asked to touch. The Sourcing Manager panel has no call site
    // against this endpoint at all, so blocking that one role closes the gap with
    // zero regression risk for everyone else.
    const session = await getServerSession();
    // MT-08 (CRITICAL, pre-existing): same defect as the list endpoint, but on a
    // WRITE — an anonymous caller failed the role test and went on to edit any
    // lead by id. Reject the unauthenticated caller before the role rule.
    if (!session?.role) {
      return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
    }
    if (normalizeRole(session.role) === "sourcing manager") {
      return NextResponse.json(
        { success: false, message: "Sourcing Managers cannot edit leads directly." },
        { status: 403 }
      );
    }

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
      "phone",
      "email",
      "alt_phone",
      "location",
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
        "SELECT id, assigned_to, status, is_lost_lead FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
        [leadId, await getOrganizationId(client)]
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

      if (body.status === "Closing") {
        fields.push("closing_date = COALESCE(closing_date, NOW())");
      }

      if (!("last_activity_at" in body)) {
        fields.push("last_activity_at = NOW()");
      }

      if (fields.length === 0) {
        return { noFields: true };
      }

      // leadId comes from the URL; organization_id is appended after it so the
      // dynamic SET clause's numbering is untouched.
      values.push(leadId);
      values.push(await getOrganizationId(client));
      const updateRows = await client.query(
        `UPDATE walkin_enquiries SET ${fields.join(", ")} WHERE id = $${values.length - 1} AND organization_id = $${values.length} RETURNING *`,
        values
      );

      if (assignmentChanged) {
        await client.query(
          `
            INSERT INTO lead_assignment_logs (lead_id, assigned_to, assigned_by, reason, organization_id)
            VALUES ($1, $2, $3, $4,
                    (SELECT organization_id FROM walkin_enquiries WHERE id = $1))
          `,
          [
            leadId,
            body.assigned_to,
            body.assigned_by || body.transferred_by || body.updated_by || "System/API",
            body.assignment_reason || body.transfer_note || "Lead Assigned",
          ]
        );
      }

      if ("enquiry_date" in body) {
        await recalculateSrNos(client);
        const finalRes = await client.query(
          "SELECT * FROM walkin_enquiries WHERE id = $1",
          [leadId]
        );
        return { data: finalRes.rows[0] };
      }

      return { data: updateRows.rows[0] };
    });

   if (!result) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }

    if ("locked" in result) {
      return NextResponse.json(
        {
          success: false,
          message: "This lead is Closed or marked as Lost and cannot be modified. Reopen/Restore it first.",
        },
        { status: 403 }
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
  const { id } = await params;

  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized || !auth.session) {
      return NextResponse.json(
        { success: false, message: auth.error || "Unauthorized" },
        { status: auth.status || 401 }
      );
    }

    const leadId = Number(id);
    if (!Number.isInteger(leadId) || leadId <= 0) {
      return NextResponse.json(
        { success: false, message: "Invalid lead ID" },
        { status: 400 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (body?.confirmation !== "DELETE") {
      return NextResponse.json(
        { success: false, message: "Type DELETE to confirm permanent deletion." },
        { status: 400 }
      );
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : null;

    const result = await transaction(async (client) => {
      const leadRows = await client.query(
        "SELECT * FROM walkin_enquiries WHERE id = $1 FOR UPDATE",
        [leadId]
      );

      if (leadRows.rows.length === 0) {
        return { status: "not-found" as const };
      }

      const lead = leadRows.rows[0];
      const leadColumns = await getExistingColumns(client, "walkin_enquiries");
      const tenantColumn = ["organization_id", "tenant_id", "org_id"].find((column) =>
        leadColumns.has(column)
      );
      // Server-resolved tenant identity. Never read from the session payload,
      // and no fallback to a literal id.
      const sessionOrgId = await getOrganizationId(client);

      if (tenantColumn && String(lead[tenantColumn]) !== String(sessionOrgId)) {
        return { status: "forbidden" as const };
      }

      const assetResult = await deleteLeadAssets(client, leadId);
      if (assetResult.failures.length > 0) {
        return {
          status: "asset-failed" as const,
          failures: assetResult.failures,
        };
      }

      const localAssetResult = await deleteLeadLocalUploads(leadId);
      const databaseResult = await deleteLeadDatabaseRecords(client, leadId);

      const leadNumber = lead.sr_no ? String(lead.sr_no) : String(lead.id);
      await insertLeadDeletionAudit(client, {
        adminId: String(auth.session._id || auth.session.id || ""),
        adminName: auth.session.name || "Admin",
        leadId,
        leadNumber,
        customerName: lead.name || null,
        reason,
        deletedFileCount: assetResult.deletedKeys.length,
        deletedLocalFileCount: localAssetResult.deletedFiles,
        deletedRecords: databaseResult.deletedRecords,
      });

      return {
        status: "deleted" as const,
        leadId,
        leadNumber,
        customerName: lead.name || null,
        deletedFiles: assetResult.deletedKeys.length,
        deletedLocalFiles: localAssetResult.deletedFiles,
        deletedRecords: databaseResult.deletedRecords,
        clearedLiveStateRows: databaseResult.clearedLiveStateRows,
      };
    });

    if (result.status === "not-found") {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }

    if (result.status === "forbidden") {
      return NextResponse.json(
        { success: false, message: "Lead belongs to another organization." },
        { status: 403 }
      );
    }

    if (result.status === "asset-failed") {
      console.error("[DELETE walkin_enquiries] R2 cleanup failed", result.failures);
      return NextResponse.json(
        {
          success: false,
          message: "Lead deletion failed. No data has been permanently removed.",
          failures: result.failures,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Lead permanently deleted successfully.",
        data: result,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("DELETE walkin_enquiries error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Lead deletion failed. No data has been permanently removed.",
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
