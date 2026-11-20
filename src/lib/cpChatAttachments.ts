// lib/cpChatAttachments.ts — CP Chat attachment helpers.
//
// Client-safe: this file is imported by CpChatPanel.tsx ("use client"), so it
// must NOT import anything that transitively reaches server-only modules like
// db.ts or serverAuth.ts.  The validation constants below are intentionally
// duplicated from followUpAttachments.ts (which imports db.ts) so the client
// bundle never pulls in "next/headers".
//
// The server-side chat route imports followUpAttachments.ts directly for its
// own validation — the values are identical.

/** MIME types accepted for CP Chat uploads (mirrors followUpAttachments). */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/** Maximum file size: 10 MB per file (mirrors followUpAttachments). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum files per single send (mirrors followUpAttachments.MAX_FILES_PER_UPLOAD). */
export const MAX_FILES_PER_SEND = 5;

/** Maximum combined size for all files in one send: 25 MB. */
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024;

/** Returns true if the MIME type is an image. */
export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Categorizes a MIME type. */
export function fileCategory(mime: string): "image" | "document" {
  return isImageMime(mime) ? "image" : "document";
}

/**
 * Sanitizes a filename for use as an R2 key segment.
 * Strips path traversal, special chars, and limits length.
 */
export function sanitizeFileName(name: string): string {
  let clean = name.replace(/^.*[\\/]/, "");
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, "_");
  clean = clean.replace(/_+/g, "_");
  if (clean.length > 100) {
    const ext = clean.lastIndexOf(".") >= 0 ? clean.substring(clean.lastIndexOf(".")) : "";
    clean = clean.substring(0, 100 - ext.length) + ext;
  }
  return clean || "file";
}

/** Known magic-byte signatures for server-side content verification. */
const MAGIC_BYTES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "application/zip", bytes: [0x50, 0x4B, 0x03, 0x04] },
  { mime: "application/msword", bytes: [0xD0, 0xCF, 0x11, 0xE0] },
];

/**
 * Checks if the file's actual content matches its declared MIME type.
 * Returns true if the content appears valid, false if suspicious.
 */
export function verifyFileSignature(buffer: Buffer, declaredMime: string): boolean {
  if (declaredMime === "text/plain" || declaredMime === "text/csv") return true;

  const isOfficeXml = declaredMime.includes("openxmlformats") || declaredMime === "application/vnd.ms-excel";

  for (const sig of MAGIC_BYTES) {
    const matches = sig.bytes.every((b, i) => buffer.length > i && buffer[i] === b);
    if (!matches) continue;
    if (sig.mime === declaredMime) return true;
    if (sig.mime === "application/zip" && isOfficeXml) return true;
    if (sig.mime === "application/msword" && declaredMime === "application/msword") return true;
    if (sig.mime === "application/msword" && declaredMime === "application/vnd.ms-excel") return true;
  }

  return false;
}

/** Human-readable file size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a display-friendly extension like "PDF", "DOCX", etc. */
export function fileExtLabel(name: string): string {
  const ext = name.lastIndexOf(".") >= 0
    ? name.substring(name.lastIndexOf(".") + 1).toUpperCase()
    : "FILE";
  return ext;
}
