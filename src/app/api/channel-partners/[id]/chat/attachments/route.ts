// api/channel-partners/[id]/chat/attachments/route.ts
//
// Dedicated media upload endpoint for CP Chat. Accepts multipart/form-data
// with one or more files plus optional location metadata (from camera capture).
//
// Each uploaded file becomes its own cp_chat_messages row with
// message_type='attachment'. Location metadata (GPS) is written on every row
// when provided, so that each photo in a batch carries its own coordinates.
//
// This endpoint handles ONLY binary uploads. Text-only messages still go
// through the existing POST /api/channel-partners/[id]/chat JSON path.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession, getSessionUserId } from "@/lib/serverAuth";
import { canViewPartners, canViewAllPartners } from "@/lib/cpRbac";
import { resolveSender } from "@/lib/cpChat";
import { uploadBufferToR2, generatePresignedUrl } from "@/lib/r2";
import {
  validateFile as fuaValidateFile,
  MAX_FILES_PER_UPLOAD as FUA_MAX_FILES,
} from "@/lib/followUpAttachments";
import {
  sanitizeFileName, verifyFileSignature, MAX_TOTAL_SIZE,
} from "@/lib/cpChatAttachments";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 4000;

const at = (v: any) => (v ? new Date(v).getTime() : 0);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!canViewPartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot message channel partners." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const cpId = Number(id);
  if (!Number.isInteger(cpId)) {
    return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
  }

  const senderUserId = getSessionUserId(session);
  if (senderUserId == null) {
    return NextResponse.json(
      { success: false, message: "Your session does not identify a user." },
      { status: 401 }
    );
  }

  try {
    const orgId = await getOrganizationId();

    // Verify partner access
    const cpRows = await query(
      `SELECT cp.id, cp.assigned_sourcing_manager_id
         FROM channel_partners cp
        WHERE cp.id = $1 AND cp.organization_id = $2`,
      [cpId, orgId]
    );
    if (cpRows.length === 0) {
      return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
    }
    if (
      !canViewAllPartners(session.role) &&
      String(cpRows[0].assigned_sourcing_manager_id ?? "") !== String(senderUserId ?? "")
    ) {
      return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
    }

    const formData = await req.formData();

    // Optional text (goes on the first attachment row)
    const text = (formData.get("text") as string || "").trim();
    if (text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { success: false, message: `Message is longer than ${MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Files (the watermarked/main files)
    const files = formData.getAll("files") as File[];
    if (files.length === 0) {
      return NextResponse.json({ success: false, message: "No files provided." }, { status: 400 });
    }
    if (files.length > FUA_MAX_FILES) {
      return NextResponse.json(
        { success: false, message: `Maximum ${FUA_MAX_FILES} files per upload.` },
        { status: 400 }
      );
    }

    // Optional original (un-watermarked) file — from camera capture
    const originalFile = formData.get("originalFile") as File | null;

    // Optional location metadata (from camera capture)
    const rawLat = formData.get("latitude") as string | null;
    const rawLng = formData.get("longitude") as string | null;
    const rawAccuracy = formData.get("accuracy") as string | null;
    const rawCaptureTs = formData.get("captureTimestamp") as string | null;
    const captureDevice = (formData.get("captureDevice") as string || "").trim().slice(0, 200) || null;

    const latitude = rawLat ? parseFloat(rawLat) : null;
    const longitude = rawLng ? parseFloat(rawLng) : null;
    const accuracy = rawAccuracy ? parseFloat(rawAccuracy) : null;
    const captureTimestamp = rawCaptureTs ? new Date(rawCaptureTs) : null;

    // Validate coordinates if provided
    if (latitude !== null && (isNaN(latitude) || latitude < -90 || latitude > 90)) {
      return NextResponse.json({ success: false, message: "Invalid latitude." }, { status: 400 });
    }
    if (longitude !== null && (isNaN(longitude) || longitude < -180 || longitude > 180)) {
      return NextResponse.json({ success: false, message: "Invalid longitude." }, { status: 400 });
    }

    // Validate all files before uploading any
    let totalSize = 0;
    const fileBuffers: Array<{ file: File; buffer: Buffer; sanitized: string }> = [];

    for (const file of files) {
      const err = fuaValidateFile(file.name, file.type, file.size);
      if (err) {
        return NextResponse.json({ success: false, message: err }, { status: 400 });
      }
      totalSize += file.size;
      if (totalSize > MAX_TOTAL_SIZE) {
        return NextResponse.json(
          { success: false, message: "Total upload size exceeds 25 MB." },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!verifyFileSignature(buffer, file.type)) {
        return NextResponse.json(
          { success: false, message: `"${file.name}" content does not match its declared type.` },
          { status: 400 }
        );
      }
      fileBuffers.push({ file, buffer, sanitized: sanitizeFileName(file.name) });
    }

    // Validate and prepare original file if provided
    let originalBuffer: Buffer | null = null;
    let originalSanitized: string | null = null;
    if (originalFile && originalFile.size > 0) {
      const origErr = fuaValidateFile(originalFile.name, originalFile.type, originalFile.size);
      if (!origErr) {
        const buf = Buffer.from(await originalFile.arrayBuffer());
        if (verifyFileSignature(buf, originalFile.type)) {
          originalBuffer = buf;
          originalSanitized = sanitizeFileName(originalFile.name);
        }
      }
      // If original validation fails, we still proceed — the watermarked file is the primary
    }

    // Upload all files to R2
    const now = Date.now();
    const uploadedKeys: Array<{
      key: string; name: string; type: string; size: number; url: string;
      watermarkedKey?: string;
    }> = [];

    for (let i = 0; i < fileBuffers.length; i++) {
      const { file, buffer, sanitized } = fileBuffers[i];
      const r2Key = `cp-chat/${orgId}/${cpId}/${now}_${i}_${sanitized}`;
      await uploadBufferToR2(r2Key, buffer, file.type);
      let url = "";
      try { url = await generatePresignedUrl(r2Key, 600); } catch { /* non-fatal */ }

      let watermarkedKey: string | undefined;

      // If this is a camera capture with an original file, the main "files" entry
      // is the watermarked version. Upload the original separately.
      if (i === 0 && originalBuffer && originalSanitized) {
        // The main key IS the watermarked file. Store original under a sibling key.
        const origR2Key = `cp-chat/${orgId}/${cpId}/${now}_orig_${originalSanitized}`;
        await uploadBufferToR2(origR2Key, originalBuffer, originalFile!.type);
        // Swap: attachment_key = original, watermarked_key = watermarked
        // This way the chat displays the watermarked image (via watermarked_key)
        // but the original is preserved as the primary attachment_key.
        watermarkedKey = r2Key;
        uploadedKeys.push({
          key: origR2Key,
          name: originalFile!.name,
          type: originalFile!.type,
          size: originalFile!.size,
          url, // presigned URL is for the watermarked version (displayed in chat)
          watermarkedKey,
        });
      } else {
        uploadedKeys.push({ key: r2Key, name: file.name, type: file.type, size: file.size, url });
      }
    }

    // Insert message rows
    const createdMessages: any[] = [];
    const sender = resolveSender(session.role, session.name);

    // Detect if the location + watermarked_key columns exist
    let hasLocationCols = false;
    try {
      const colCheck = await query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'cp_chat_messages'
            AND column_name = 'capture_latitude'
          LIMIT 1`
      );
      hasLocationCols = colCheck.length > 0;
    } catch { /* safe fallback */ }

    for (let i = 0; i < uploadedKeys.length; i++) {
      const att = uploadedKeys[i];
      const msgText = i === 0 && text ? text : null;

      let rows;
      if (hasLocationCols && (latitude !== null || att.watermarkedKey)) {
        rows = await query(
          `INSERT INTO cp_chat_messages
             (organization_id, channel_partner_id, sender_user_id,
              message_type, message_text,
              attachment_key, attachment_name, attachment_type, attachment_size,
              capture_latitude, capture_longitude, capture_accuracy,
              capture_timestamp, capture_device, watermarked_key)
           VALUES ($1, $2, $3, 'attachment', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id, sent_at`,
          [
            orgId, cpId, senderUserId, msgText,
            att.key, att.name, att.type, att.size,
            latitude, longitude, accuracy,
            captureTimestamp?.toISOString() ?? null, captureDevice,
            att.watermarkedKey ?? null,
          ]
        );
      } else {
        rows = await query(
          `INSERT INTO cp_chat_messages
             (organization_id, channel_partner_id, sender_user_id,
              message_type, message_text,
              attachment_key, attachment_name, attachment_type, attachment_size)
           VALUES ($1, $2, $3, 'attachment', $4, $5, $6, $7, $8)
           RETURNING id, sent_at`,
          [orgId, cpId, senderUserId, msgText, att.key, att.name, att.type, att.size]
        );
      }

      createdMessages.push({
        id: `m${rows[0].id}`,
        ts: at(rows[0].sent_at),
        kind: "attachment",
        text: msgText || "",
        sender,
        mine: true,
        attachment: {
          key: att.watermarkedKey || att.key,
          name: att.name,
          type: att.type,
          size: att.size,
          url: att.url,
        },
        location: latitude !== null && longitude !== null
          ? { latitude, longitude, accuracy, captureTimestamp: captureTimestamp?.toISOString() ?? null }
          : null,
        source: "cp_chat_messages",
      });
    }

    return NextResponse.json({ success: true, data: createdMessages }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/channel-partners/[id]/chat/attachments]", err);
    if (err?.code === "23514") {
      return NextResponse.json(
        { success: false, message: "That partner belongs to another organization." },
        { status: 403 }
      );
    }
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
