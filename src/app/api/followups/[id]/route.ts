// app/api/followups/[id]/route.ts
//
// DELETE /api/followups/[id]
//
// Permanently deletes a single follow-up note, together with any file
// attachments it carries (R2 objects + DB records), all within a single
// transaction so no orphaned rows can survive a partial failure.
//
// Authorization sequence:
//   1. requireSession()                  — authenticated user
//   2. getOrganizationId()               — tenant from HMAC-signed cookie
//   3. canDeleteFollowUp(orgId, role)    — configurable per-role gate
//   4. WHERE id=$1 AND organization_id=$2 — confirms row belongs to this org
//
// Attachments:
//   R2 objects are deleted before the DB records. If R2 fails, the DB
//   records are left intact and the error is surfaced to the caller. This
//   is identical to the attachments/[id] DELETE route's contract.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query, transaction } from "@/lib/db";
import { canDeleteFollowUp } from "@/lib/followUpDeletionPermissions";
import { writeAuditLog } from "@/lib/auditLog";
import { broadcastToOrg } from "@/lib/supabase/broadcast";
import { deleteObjectFromR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Authentication
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const followUpId = Number(id);
    if (!Number.isFinite(followUpId) || followUpId <= 0) {
      return NextResponse.json(
        { success: false, message: "Invalid follow-up id" },
        { status: 400 }
      );
    }

    // 2. Tenant
    const orgId = await getOrganizationId();

    // 3. Role permission gate — configurable per org
    const allowed = await canDeleteFollowUp(orgId, gate.session.role);
    if (!allowed) {
      return NextResponse.json(
        { success: false, message: "Your role does not have permission to delete follow-ups." },
        { status: 403 }
      );
    }

    // 4. Load the follow-up — scoped to org (prevents cross-org access)
    const fuRows = await query<{ id: number; lead_id: number; message: string }>(
      `SELECT id, lead_id, message FROM follow_ups WHERE id = $1 AND organization_id = $2`,
      [followUpId, orgId]
    );
    if (fuRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Follow-up not found." },
        { status: 404 }
      );
    }
    const followUp = fuRows[0];
    const leadId = followUp.lead_id;

    // 5. Load all attachments for this follow-up
    let attachments: Array<{ id: number; r2_object_key: string }> = [];
    try {
      attachments = await query<{ id: number; r2_object_key: string }>(
        `SELECT id, r2_object_key FROM follow_up_attachments
         WHERE follow_up_id = $1 AND organization_id = $2`,
        [followUpId, orgId]
      );
    } catch {
      // Table may not exist yet — treat as no attachments.
      attachments = [];
    }

    // 6. Delete R2 objects first.
    // If any R2 deletion fails we abort before touching the DB, keeping the
    // DB state consistent with R2 (no orphaned records without R2 objects).
    const r2Errors: string[] = [];
    for (const att of attachments) {
      try {
        await deleteObjectFromR2(att.r2_object_key);
      } catch (err) {
        r2Errors.push(`Attachment ${att.id}: ${err instanceof Error ? err.message : "R2 error"}`);
      }
    }
    if (r2Errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Failed to delete file(s) from storage. No data was removed. Errors: ${r2Errors.join("; ")}`,
        },
        { status: 500 }
      );
    }

    // 7. Delete DB records in a transaction: attachments first, then the follow-up.
    await transaction(async (client) => {
      if (attachments.length > 0) {
        const attIds = attachments.map((a) => a.id);
        await client.query(
          `DELETE FROM follow_up_attachments WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [attIds, orgId]
        );
      }
      await client.query(
        `DELETE FROM follow_ups WHERE id = $1 AND organization_id = $2`,
        [followUpId, orgId]
      );
    });

    // 8. Audit log — best-effort, never fails the delete
    void writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name ?? null,
      action: "followup.deleted",
      entityType: "follow_up",
      entityId: String(followUpId),
      newValue: {
        follow_up_id: followUpId,
        lead_id: leadId,
        deleted_by: gate.session.name || gate.session.email,
        deleted_by_role: gate.session.role,
        attachments_deleted: attachments.length,
      },
    });

    // 9. Broadcast so other open sessions remove the item from their timelines
    void broadcastToOrg(orgId, "followup.deleted", {
      followUpId: String(followUpId),
      leadId: String(leadId),
    });

    return NextResponse.json({
      success: true,
      message: "Follow-up deleted.",
      followUpId: String(followUpId),
      leadId: String(leadId),
    });
  } catch (error) {
    console.error("DELETE /api/followups/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete follow-up. Please try again." },
      { status: 500 }
    );
  }
}
