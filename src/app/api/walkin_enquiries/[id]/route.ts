// app/api/walkin_enquiries/[id]/route.ts
import { NextResponse } from "next/server";
import { transaction, recalculateSrNos } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
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
      const sessionOrgId =
        auth.session.organization_id ??
        auth.session.organizationId ??
        auth.session.tenant_id ??
        auth.session.tenantId ??
        1;

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
