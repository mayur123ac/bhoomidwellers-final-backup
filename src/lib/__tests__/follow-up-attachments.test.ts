// Tests for the Follow-up File Attachments feature.
//
// Structural tests that verify:
// 1. Schema and table design
// 2. Upload API security (auth, org scoping, file validation)
// 3. Download API security (auth, org scoping, presigned URLs)
// 4. Delete API security (auth, org scoping, uploader/admin gate)
// 5. R2 integration (upload, presigned download, deletion order)
// 6. Frontend rendering component
// 7. Existing voice recording is unchanged

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const read = (relPath: string) =>
  fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");

// ── Source files under test ──────────────────────────────────────────────────
const helperSource = read("../followUpAttachments.ts");
const uploadRoute = read("../../app/api/followups/attachments/route.ts");
const downloadDeleteRoute = read("../../app/api/followups/attachments/[id]/route.ts");
const bulkRoute = read("../../app/api/followups/attachments/by-follow-ups/route.ts");
const bubbleSource = read("../../components/FollowUpAttachments.tsx");
const pickerSource = read("../../components/FollowUpAttachmentPicker.tsx");
const hookSource = read("../hooks/useFollowUpAttachments.ts");
const composerSource = read("../../components/FollowUpComposer.tsx");
const migrationSource = fs.readFileSync(
  path.resolve(__dirname, "../../../scripts/migrations/2026-09-07_follow_up_attachments.sql"),
  "utf-8"
);
// Voice recording sources (must remain unchanged)
const callRecordingRoute = read("../../app/api/call-recordings/[id]/route.ts");
const manualCallBubble = read("../../components/ManualCallBubble.tsx");

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Schema — follow_up_attachments table
// ═══════════════════════════════════════════════════════════════════════════════
describe("follow_up_attachments schema", () => {
  it("creates the table with required columns", () => {
    expect(migrationSource).toContain("CREATE TABLE IF NOT EXISTS follow_up_attachments");
    expect(migrationSource).toContain("organization_id");
    expect(migrationSource).toContain("follow_up_id");
    expect(migrationSource).toContain("uploaded_by");
    expect(migrationSource).toContain("file_name");
    expect(migrationSource).toContain("mime_type");
    expect(migrationSource).toContain("file_size");
    expect(migrationSource).toContain("r2_object_key");
    expect(migrationSource).toContain("created_at");
  });

  it("has indexes on organization_id and follow_up_id", () => {
    expect(migrationSource).toContain("idx_fua_organization_id");
    expect(migrationSource).toContain("idx_fua_follow_up_id");
    expect(migrationSource).toContain("idx_fua_org_follow_up");
  });

  it("uses UUID for organization_id (consistent with CRM convention)", () => {
    expect(migrationSource).toContain("organization_id UUID");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Upload API — POST /api/followups/attachments
// ═══════════════════════════════════════════════════════════════════════════════
describe("Upload API — POST /api/followups/attachments", () => {
  it("requires authentication", () => {
    expect(uploadRoute).toContain("requireSession");
  });

  it("verifies follow-up belongs to user's organization", () => {
    expect(uploadRoute).toContain("organization_id = $2");
    expect(uploadRoute).toContain("getOrganizationId");
  });

  it("returns 404 if follow-up not found in org", () => {
    expect(uploadRoute).toContain('"Follow-up not found"');
    expect(uploadRoute).toContain("404");
  });

  it("rejects when no files are provided", () => {
    expect(uploadRoute).toContain('"At least one file is required"');
  });

  it("limits maximum files per upload", () => {
    expect(uploadRoute).toContain("MAX_FILES_PER_UPLOAD");
  });

  it("validates files server-side before uploading", () => {
    expect(uploadRoute).toContain("validateFile");
  });

  it("uploads to R2 with org-scoped key path", () => {
    expect(uploadRoute).toContain("uploadBufferToR2");
    expect(uploadRoute).toContain("`followups/${orgId}/${followUpId}/");
  });

  it("inserts metadata into follow_up_attachments", () => {
    expect(uploadRoute).toContain("insertAttachment");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Download API — GET /api/followups/attachments/[id]
// ═══════════════════════════════════════════════════════════════════════════════
describe("Download API — GET /api/followups/attachments/[id]", () => {
  it("requires authentication", () => {
    expect(downloadDeleteRoute).toContain("requireSession");
  });

  it("scopes to organization", () => {
    expect(downloadDeleteRoute).toContain("getOrganizationId");
    expect(downloadDeleteRoute).toContain("getAttachmentById(orgId");
  });

  it("returns 404 for cross-org access", () => {
    expect(downloadDeleteRoute).toContain('"Attachment not found"');
    expect(downloadDeleteRoute).toContain("404");
  });

  it("generates a presigned URL, never a permanent public URL", () => {
    expect(downloadDeleteRoute).toContain("generatePresignedUrl");
    expect(downloadDeleteRoute).toContain("attachment.r2_object_key");
  });

  it("never allows frontend to specify an arbitrary R2 key", () => {
    // Key is read from DB, not from query params or body
    expect(downloadDeleteRoute).not.toContain("req.url");
    expect(downloadDeleteRoute).not.toContain('searchParams.get("key")');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Delete API — DELETE /api/followups/attachments/[id]
// ═══════════════════════════════════════════════════════════════════════════════
describe("Delete API — DELETE /api/followups/attachments/[id]", () => {
  it("requires authentication", () => {
    expect(downloadDeleteRoute).toContain("requireSession");
  });

  it("scopes to organization", () => {
    // getAttachmentById includes orgId
    expect(downloadDeleteRoute).toContain("getAttachmentById(orgId, attachmentId)");
  });

  it("allows only uploader or admin to delete", () => {
    expect(downloadDeleteRoute).toContain("isUploader");
    expect(downloadDeleteRoute).toContain("isAdmin");
    expect(downloadDeleteRoute).toContain("403");
    expect(downloadDeleteRoute).toContain("Only the uploader or an admin can delete");
  });

  it("deletes from R2 before removing DB record", () => {
    const r2Idx = downloadDeleteRoute.indexOf("deleteObjectFromR2");
    const dbIdx = downloadDeleteRoute.indexOf("deleteAttachmentRecord");
    expect(r2Idx).toBeGreaterThan(-1);
    expect(dbIdx).toBeGreaterThan(-1);
    expect(r2Idx).toBeLessThan(dbIdx);
  });

  it("does not delete the follow-up itself", () => {
    expect(downloadDeleteRoute).not.toMatch(/DELETE\s+FROM\s+follow_ups/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Server-side file validation
// ═══════════════════════════════════════════════════════════════════════════════
describe("File validation — followUpAttachments.ts", () => {
  it("supports image/* MIME types", () => {
    expect(helperSource).toContain("image/jpeg");
    expect(helperSource).toContain("image/png");
    expect(helperSource).toContain("image/gif");
    expect(helperSource).toContain("image/webp");
  });

  it("supports PDF", () => {
    expect(helperSource).toContain("application/pdf");
  });

  it("supports common office documents", () => {
    expect(helperSource).toContain("application/msword");
    expect(helperSource).toContain("officedocument.wordprocessingml");
    expect(helperSource).toContain("vnd.ms-excel");
    expect(helperSource).toContain("officedocument.spreadsheetml");
  });

  it("enforces file size limit", () => {
    expect(helperSource).toContain("MAX_FILE_SIZE");
    expect(helperSource).toContain("10 * 1024 * 1024");
  });

  it("validates both MIME type and file extension", () => {
    expect(helperSource).toContain("ALLOWED_MIME_TYPES");
    expect(helperSource).toContain("ALLOWED_EXTENSIONS");
  });

  it("rejects unsupported types with clear error", () => {
    expect(helperSource).toContain("is not supported");
  });

  it("rejects oversized files with clear error", () => {
    expect(helperSource).toContain("exceeds the 10 MB limit");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Frontend — FollowUpAttachments renderer
// ═══════════════════════════════════════════════════════════════════════════════
describe("FollowUpAttachments component", () => {
  it("fetches attachments from the batch endpoint", () => {
    expect(bubbleSource).toContain("/api/followups/attachments/by-follow-ups");
  });

  it("supports prefetched attachments to avoid per-bubble requests", () => {
    expect(bubbleSource).toContain("prefetched");
  });

  it("shows file icons based on MIME type", () => {
    expect(bubbleSource).toContain("iconForMime");
    expect(bubbleSource).toContain("FaImage");
    expect(bubbleSource).toContain("FaFilePdf");
    expect(bubbleSource).toContain("FaFileAlt");
  });

  it("downloads via presigned URL, not direct R2 URL", () => {
    expect(bubbleSource).toContain("/api/followups/attachments/");
    expect(bubbleSource).toContain("json.url");
  });

  it("shows delete button with confirmation modal", () => {
    expect(bubbleSource).toContain("confirmDelete");
    expect(bubbleSource).toContain("Delete attachment?");
    expect(bubbleSource).toContain("cannot be undone");
  });

  it("calls DELETE API and removes from local state", () => {
    expect(bubbleSource).toContain('method: "DELETE"');
    expect(bubbleSource).toContain("prev.filter");
  });

  it("shows image thumbnails with presigned URL previews", () => {
    expect(bubbleSource).toContain("imageUrls");
    expect(bubbleSource).toContain("object-cover");
  });

  it("separates images from documents for different display", () => {
    expect(bubbleSource).toContain("imageAtts");
    expect(bubbleSource).toContain("docAtts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Frontend — AttachButton and PendingFileList
// ═══════════════════════════════════════════════════════════════════════════════
describe("AttachButton and PendingFileList", () => {
  it("renders a paperclip button", () => {
    expect(pickerSource).toContain("FaPaperclip");
    expect(pickerSource).toContain("Attach files");
  });

  it("accepts multiple files", () => {
    expect(pickerSource).toContain("multiple");
  });

  it("limits accepted file types client-side", () => {
    expect(pickerSource).toContain("accept={ACCEPT}");
  });

  it("shows pending file count badge", () => {
    expect(pickerSource).toContain("currentCount");
  });

  it("shows file name, size, and remove button in pending list", () => {
    expect(pickerSource).toContain("formatSize");
    expect(pickerSource).toContain("FaTimes");
    expect(pickerSource).toContain("onRemove");
  });

  it("client-side validation matches server limits", () => {
    expect(pickerSource).toContain("10 * 1024 * 1024");
    expect(pickerSource).toContain("MAX_FILES");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7b. FollowUpComposer — unified composer with inline previews
// ═══════════════════════════════════════════════════════════════════════════════
describe("FollowUpComposer component", () => {
  it("uses a textarea that auto-resizes", () => {
    expect(composerSource).toContain("<textarea");
    expect(composerSource).toContain("scrollHeight");
  });

  it("supports Enter to send, Shift+Enter for newline", () => {
    expect(composerSource).toContain("e.key === \"Enter\"");
    expect(composerSource).toContain("!e.shiftKey");
  });

  it("shows image thumbnails with ObjectURL previews", () => {
    expect(composerSource).toContain("URL.createObjectURL");
    expect(composerSource).toContain("ImageThumb");
  });

  it("shows document file cards for non-image files", () => {
    expect(composerSource).toContain("DocCard");
    expect(composerSource).toContain("iconForType");
  });

  it("supports drag and drop", () => {
    expect(composerSource).toContain("onDrop");
    expect(composerSource).toContain("handleDrop");
    expect(composerSource).toContain("dragOver");
  });

  it("has attach, reminder, and send buttons", () => {
    expect(composerSource).toContain("FaPaperclip");
    expect(composerSource).toContain("FaClock");
    expect(composerSource).toContain("FaPaperPlane");
  });

  it("cleans up ObjectURLs on unmount", () => {
    expect(composerSource).toContain("URL.revokeObjectURL");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Upload hook — useFollowUpAttachments
// ═══════════════════════════════════════════════════════════════════════════════
describe("useFollowUpAttachments hook", () => {
  it("snapshots files before clearing to avoid race condition", () => {
    expect(hookSource).toContain("snapshotRef");
    expect(hookSource).toContain("snapshotAndClear");
  });

  it("uploads via FormData to the attachments API", () => {
    expect(hookSource).toContain("new FormData");
    expect(hookSource).toContain("/api/followups/attachments");
  });

  it("validates files client-side before adding", () => {
    expect(hookSource).toContain("validateFiles");
  });

  it("restores snapshot on failure so files are not lost", () => {
    expect(hookSource).toContain("restoreSnapshot");
    expect(hookSource).toContain("setPendingFiles(snapshotRef.current)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Multiple attachments per follow-up
// ═══════════════════════════════════════════════════════════════════════════════
describe("Multiple attachments support", () => {
  it("schema allows many attachments per follow_up_id (no unique constraint)", () => {
    // follow_up_id has an index but no UNIQUE constraint
    expect(migrationSource).not.toMatch(/UNIQUE.*follow_up_id/);
  });

  it("upload API processes multiple files in one request", () => {
    expect(uploadRoute).toContain("for (const file of files)");
  });

  it("bulk fetch returns all attachments for given follow-up IDs", () => {
    expect(bulkRoute).toContain("getAttachmentsByFollowUps");
    expect(bulkRoute).toContain("follow_up_ids");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Existing voice recording unchanged
// ═══════════════════════════════════════════════════════════════════════════════
describe("Voice recording architecture is unchanged", () => {
  it("call recording route still uses call_sessions table", () => {
    expect(callRecordingRoute).toContain("call_sessions");
    expect(callRecordingRoute).not.toContain("follow_up_attachments");
  });

  it("ManualCallBubble still parses recording from JSON message", () => {
    expect(manualCallBubble).toContain("recording_r2_key");
    expect(manualCallBubble).not.toContain("follow_up_attachments");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Multi-tenant isolation
// ═══════════════════════════════════════════════════════════════════════════════
describe("Multi-tenant isolation", () => {
  it("all helper queries scope by organization_id", () => {
    // Every SELECT/INSERT/DELETE in the helper includes organization_id
    const queryLines = helperSource.match(/organization_id\s*=\s*\$\d/g) || [];
    expect(queryLines.length).toBeGreaterThanOrEqual(3);
  });

  it("upload API reads org from server auth, not from request body", () => {
    expect(uploadRoute).toContain("getOrganizationId()");
    expect(uploadRoute).not.toContain("body.organization_id");
  });

  it("download API reads org from server auth", () => {
    expect(downloadDeleteRoute).toContain("getOrganizationId()");
  });

  it("delete API reads org from server auth", () => {
    // Same file as download, already checked
    expect(downloadDeleteRoute).toContain("getOrganizationId()");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. R2 deletion safety
// ═══════════════════════════════════════════════════════════════════════════════
describe("R2 deletion safety", () => {
  it("deletes R2 object before DB record", () => {
    const r2Idx = downloadDeleteRoute.indexOf("deleteObjectFromR2");
    const dbIdx = downloadDeleteRoute.indexOf("deleteAttachmentRecord");
    expect(r2Idx).toBeLessThan(dbIdx);
  });

  it("R2 deletion uses key from DB, not from request", () => {
    expect(downloadDeleteRoute).toContain("attachment.r2_object_key");
  });
});
