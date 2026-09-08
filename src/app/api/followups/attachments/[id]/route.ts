import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { generatePresignedUrl, deleteObjectFromR2 } from "@/lib/r2";
import { getAttachmentById, deleteAttachmentRecord } from "@/lib/followUpAttachments";

/**
 * GET /api/followups/attachments/[id]
 *
 * Returns a short-lived presigned download URL for the attachment.
 * The user must be authenticated and the attachment must belong to their org.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const attachmentId = Number(id);
    if (!Number.isFinite(attachmentId)) {
      return NextResponse.json(
        { success: false, message: "Invalid attachment id" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();
    const attachment = await getAttachmentById(orgId, attachmentId);
    if (!attachment) {
      return NextResponse.json(
        { success: false, message: "Attachment not found" },
        { status: 404 }
      );
    }

    const url = await generatePresignedUrl(attachment.r2_object_key, 300);

    return NextResponse.json({
      success: true,
      url,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      file_size: attachment.file_size,
    });
  } catch (error) {
    console.error("GET /api/followups/attachments/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to generate download URL" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/followups/attachments/[id]
 *
 * Permanently deletes a file attachment from R2 and the database.
 *
 * Authorization:
 *   1. User must be authenticated
 *   2. Attachment must belong to the user's organization
 *   3. Only the uploader or an admin can delete
 *
 * Flow:
 *   verify auth → verify org → delete from R2 → delete DB record
 *   (R2 first so a failed R2 delete does not orphan the DB record)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const attachmentId = Number(id);
    if (!Number.isFinite(attachmentId)) {
      return NextResponse.json(
        { success: false, message: "Invalid attachment id" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();
    const attachment = await getAttachmentById(orgId, attachmentId);
    if (!attachment) {
      return NextResponse.json(
        { success: false, message: "Attachment not found" },
        { status: 404 }
      );
    }

    // Authorization: uploader or admin can delete
    const role = (gate.session.role || "").trim().toLowerCase().replace(/_/g, " ");
    const isUploader = attachment.uploaded_by === gate.userId;
    const isAdmin = role === "admin";
    if (!isUploader && !isAdmin) {
      return NextResponse.json(
        { success: false, message: "Only the uploader or an admin can delete attachments." },
        { status: 403 }
      );
    }

    // Delete from R2 first — if this fails, the DB record survives for retry
    await deleteObjectFromR2(attachment.r2_object_key);

    // Now safe to delete the DB record
    await deleteAttachmentRecord(orgId, attachmentId);

    return NextResponse.json({
      success: true,
      message: "Attachment deleted.",
    });
  } catch (error) {
    console.error("DELETE /api/followups/attachments/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete attachment" },
      { status: 500 }
    );
  }
}
