import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query } from "@/lib/db";
import { uploadBufferToR2 } from "@/lib/r2";
import {
  insertAttachment,
  validateFile,
  MAX_FILES_PER_UPLOAD,
  MAX_FILE_SIZE,
} from "@/lib/followUpAttachments";

/**
 * POST /api/followups/attachments
 *
 * Upload one or more files and attach them to a follow-up.
 * Accepts multipart/form-data with:
 *   - follow_up_id: string (required)
 *   - files: File[] (1–5 files)
 *
 * Authorization:
 *   1. User must be authenticated
 *   2. The follow-up must exist and belong to the user's organization
 *
 * Flow:
 *   validate → upload each to R2 → insert metadata rows → return attachments
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const formData = await req.formData();

    const followUpId = Number(formData.get("follow_up_id"));
    if (!Number.isFinite(followUpId) || followUpId <= 0) {
      return NextResponse.json(
        { success: false, message: "follow_up_id is required" },
        { status: 400 }
      );
    }

    // Verify follow-up exists and belongs to this org
    const fuRows = await query<{ id: number }>(
      `SELECT id FROM follow_ups WHERE id = $1 AND organization_id = $2`,
      [followUpId, orgId]
    );
    if (fuRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Follow-up not found" },
        { status: 404 }
      );
    }

    // Collect files from form data
    const files: File[] = [];
    for (const [, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, message: "At least one file is required" },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES_PER_UPLOAD) {
      return NextResponse.json(
        { success: false, message: `Maximum ${MAX_FILES_PER_UPLOAD} files per upload` },
        { status: 400 }
      );
    }

    // Validate all files before uploading any
    for (const file of files) {
      const error = validateFile(file.name, file.type, file.size);
      if (error) {
        return NextResponse.json({ success: false, message: error }, { status: 400 });
      }
    }

    // Upload each file to R2 and create DB records
    const results = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Extension from filename
      let ext = ".bin";
      const dotIdx = file.name.lastIndexOf(".");
      if (dotIdx >= 0) ext = file.name.substring(dotIdx);

      const r2Key = `followups/${orgId}/${followUpId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

      await uploadBufferToR2(r2Key, buffer, file.type);

      const attachment = await insertAttachment(
        orgId,
        followUpId,
        gate.userId!,
        file.name,
        file.type,
        file.size,
        r2Key
      );

      results.push({
        id: attachment.id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
        created_at: attachment.created_at,
      });
    }

    return NextResponse.json(
      { success: true, data: results },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/followups/attachments error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to upload attachments" },
      { status: 500 }
    );
  }
}
