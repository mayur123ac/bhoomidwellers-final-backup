// lib/followUpAttachments.ts — follow-up file attachment helpers.
//
// Table is bootstrapped on first access (same pattern as recordingPermissions.ts).

import { query } from "@/lib/db";

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS follow_up_attachments (
    id              SERIAL       PRIMARY KEY,
    organization_id UUID         NOT NULL,
    follow_up_id    INTEGER      NOT NULL,
    uploaded_by     INTEGER,
    file_name       TEXT         NOT NULL,
    mime_type       VARCHAR(255) NOT NULL,
    file_size       INTEGER      NOT NULL DEFAULT 0,
    r2_object_key   TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
  )
`;

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await query(ENSURE_TABLE_SQL, []);
  // Best-effort index creation — won't fail if they already exist.
  await query(`CREATE INDEX IF NOT EXISTS idx_fua_org_follow_up ON follow_up_attachments (organization_id, follow_up_id)`, []).catch(() => {});
  tableEnsured = true;
}

// ── File type validation ──────────────────────────────────────────────────────

/** MIME types we accept. Matches the booking-documents conventions. */
export const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // PDF
  "application/pdf",
  // Office documents
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain",
  "text/csv",
]);

/** Allowed file extensions (lowercase, with dot). */
const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv",
]);

/** Maximum file size: 10 MB per file. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum attachments per single upload request. */
export const MAX_FILES_PER_UPLOAD = 5;

export function validateFile(
  fileName: string,
  mimeType: string,
  size: number
): string | null {
  if (size > MAX_FILE_SIZE) {
    return `File "${fileName}" exceeds the 10 MB limit.`;
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `File type "${mimeType}" is not supported.`;
  }
  const ext = fileName.lastIndexOf(".") >= 0
    ? fileName.substring(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return `File extension "${ext || "(none)"}" is not allowed.`;
  }
  return null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export interface FollowUpAttachment {
  id: number;
  organization_id: string;
  follow_up_id: number;
  uploaded_by: number | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  r2_object_key: string;
  created_at: string;
}

export async function insertAttachment(
  orgId: string,
  followUpId: number,
  uploadedBy: number,
  fileName: string,
  mimeType: string,
  fileSize: number,
  r2Key: string
): Promise<FollowUpAttachment> {
  await ensureTable();
  const rows = await query<FollowUpAttachment>(
    `INSERT INTO follow_up_attachments
       (organization_id, follow_up_id, uploaded_by, file_name, mime_type, file_size, r2_object_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [orgId, followUpId, uploadedBy, fileName, mimeType, fileSize, r2Key]
  );
  return rows[0];
}

export async function getAttachmentsByFollowUp(
  orgId: string,
  followUpId: number
): Promise<FollowUpAttachment[]> {
  await ensureTable();
  return query<FollowUpAttachment>(
    `SELECT * FROM follow_up_attachments
     WHERE organization_id = $1 AND follow_up_id = $2
     ORDER BY created_at ASC`,
    [orgId, followUpId]
  );
}

export async function getAttachmentsByFollowUps(
  orgId: string,
  followUpIds: number[]
): Promise<FollowUpAttachment[]> {
  if (followUpIds.length === 0) return [];
  await ensureTable();
  return query<FollowUpAttachment>(
    `SELECT * FROM follow_up_attachments
     WHERE organization_id = $1 AND follow_up_id = ANY($2)
     ORDER BY follow_up_id, created_at ASC`,
    [orgId, followUpIds]
  );
}

export async function getAttachmentById(
  orgId: string,
  attachmentId: number
): Promise<FollowUpAttachment | null> {
  await ensureTable();
  const rows = await query<FollowUpAttachment>(
    `SELECT * FROM follow_up_attachments
     WHERE id = $1 AND organization_id = $2`,
    [attachmentId, orgId]
  );
  return rows[0] ?? null;
}

export async function deleteAttachmentRecord(
  orgId: string,
  attachmentId: number
): Promise<boolean> {
  await ensureTable();
  const rows = await query(
    `DELETE FROM follow_up_attachments
     WHERE id = $1 AND organization_id = $2
     RETURNING id`,
    [attachmentId, orgId]
  );
  return rows.length > 0;
}
