// app/api/walkin_enquiries/bulk-delete/route.ts
// Hard-deletes up to 100 leads in one transaction, reusing the exact same
// per-lead deletion + audit logic as the single-lead DELETE endpoint.
// Each lead runs inside its own SAVEPOINT so one failure (e.g. an FK block)
// is recorded in failed[] without aborting the rest of the batch.
import { NextResponse } from "next/server";
import { transaction, recalculateSrNos } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import {
  getExistingColumns,
  deleteLeadAssets,
  deleteLeadLocalUploads,
  deleteLeadDatabaseRecords,
  insertLeadDeletionAudit,
} from "@/lib/leadDeletion";

export const dynamic = "force-dynamic";

const MAX_BULK = 100;

export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized || !auth.session) {
      return NextResponse.json(
        { success: false, message: auth.error || "Unauthorized" },
        { status: auth.status || 401 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const rawIds = Array.isArray(body?.leadIds) ? body.leadIds : [];
    // Dedup + coerce to positive integers.
    const leadIds = Array.from(
      new Set(rawIds.map((v: any) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0))
    ) as number[];

    if (leadIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "No valid lead IDs provided." },
        { status: 400 }
      );
    }
    if (leadIds.length > MAX_BULK) {
      return NextResponse.json(
        { success: false, message: `Maximum ${MAX_BULK} leads per bulk delete` },
        { status: 400 }
      );
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : null;

    const adminId = String(auth.session._id || auth.session.id || "");
    const adminName = auth.session.name || "Admin";
    const sessionOrgId =
      auth.session.organization_id ??
      auth.session.organizationId ??
      auth.session.tenant_id ??
      auth.session.tenantId ??
      1;

    const result = await transaction(async (client) => {
      let deleted = 0;
      const failed: { id: number; reason: string }[] = [];

      const leadColumns = await getExistingColumns(client, "walkin_enquiries");
      const tenantColumn = ["organization_id", "tenant_id", "org_id"].find((c) =>
        leadColumns.has(c)
      );

      for (const leadId of leadIds) {
        await client.query("SAVEPOINT lead_del");
        try {
          const leadRows = await client.query(
            "SELECT * FROM walkin_enquiries WHERE id = $1 FOR UPDATE",
            [leadId]
          );
          if (leadRows.rows.length === 0) {
            throw new Error("Lead not found");
          }
          const lead = leadRows.rows[0];

          if (tenantColumn && String(lead[tenantColumn]) !== String(sessionOrgId)) {
            throw new Error("Lead belongs to another organization");
          }

          // Same order as single delete: R2 assets -> local files -> DB rows -> audit.
          const assetResult = await deleteLeadAssets(client, leadId);
          if (assetResult.failures.length > 0) {
            throw new Error(
              `Asset cleanup failed (${assetResult.failures.length} file(s))`
            );
          }

          const localAssetResult = await deleteLeadLocalUploads(leadId);
          // recalc:false — we recalc once after the whole batch.
          const databaseResult = await deleteLeadDatabaseRecords(client, leadId, {
            recalc: false,
          });

          const leadNumber = lead.sr_no ? String(lead.sr_no) : String(lead.id);
          await insertLeadDeletionAudit(client, {
            adminId,
            adminName,
            leadId,
            leadNumber,
            customerName: lead.name || null,
            reason,
            deletedFileCount: assetResult.deletedKeys.length,
            deletedLocalFileCount: localAssetResult.deletedFiles,
            deletedRecords: databaseResult.deletedRecords,
          });

          await client.query("RELEASE SAVEPOINT lead_del");
          deleted++;
        } catch (err: any) {
          // Undo just this lead's partial DB work and keep going.
          await client.query("ROLLBACK TO SAVEPOINT lead_del");
          failed.push({ id: leadId, reason: err?.message || "Deletion failed" });
        }
      }

      // Recalculate gapless Sr. Nos exactly once, after the whole batch.
      if (deleted > 0) {
        await recalculateSrNos(client);
      }

      return { deleted, failed };
    });

    return NextResponse.json(
      { success: true, deleted: result.deleted, failed: result.failed },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[POST /api/walkin_enquiries/bulk-delete]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Bulk delete failed." },
      { status: 500 }
    );
  }
}
