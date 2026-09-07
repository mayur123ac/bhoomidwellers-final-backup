// Tests for the Voice Recording Deletion Permissions feature.
//
// Structural tests that verify:
// 1. Permission model logic (normalizeRole, admin always included)
// 2. API route security (auth gates, role checks, org scoping)
// 3. Frontend permission hook behaviour
// 4. ManualCallBubble UI states (delete visible/hidden, post-delete state)
// 5. R2 deletion flow (DB not cleared on R2 failure, idempotent repeated delete)

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const read = (relPath: string) =>
  fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");

// ── Source files under test ──────────────────────────────────────────────────
const permissionsSource = read("../recordingPermissions.ts");
const apiRouteSource = read(
  "../../app/api/call-recordings/[id]/route.ts"
);
const settingsRouteSource = read(
  "../../app/api/settings/recording-permissions/route.ts"
);
const hookSource = read("../hooks/useRecordingDeletePermission.ts");
const bubbleSource = read("../../components/ManualCallBubble.tsx");
const workspaceSource = read(
  "../../app/dashboard/settings/workspace/page.tsx"
);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Permission model — recordingPermissions.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("recordingPermissions.ts — server-side permission model", () => {
  it("admin is always in ALL_DELETABLE_ROLES", () => {
    expect(permissionsSource).toContain('"admin"');
    expect(permissionsSource).toMatch(/ALL_DELETABLE_ROLES\s*=\s*\[.*"admin"/);
  });

  it("setRecordingDeleteRoles always includes admin regardless of input", () => {
    // The set should always seed with "admin"
    expect(permissionsSource).toMatch(/new Set.*\[.*"admin".*\]/);
  });

  it("normalizeRole replaces underscores with spaces", () => {
    expect(permissionsSource).toContain('.replace(/_/g, " ")');
  });

  it("table is bootstrapped with CREATE TABLE IF NOT EXISTS", () => {
    expect(permissionsSource).toContain("CREATE TABLE IF NOT EXISTS organization_recording_permissions");
  });

  it("default delete_roles is admin-only", () => {
    expect(permissionsSource).toMatch(/DEFAULT\s+ARRAY\['admin'\]/i);
  });

  it("canDeleteRecording reads from getRecordingDeleteRoles and normalizes", () => {
    expect(permissionsSource).toContain("async function canDeleteRecording");
    expect(permissionsSource).toContain("getRecordingDeleteRoles");
    expect(permissionsSource).toContain("normalizeRole");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DELETE API route — call-recordings/[id]/route.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/call-recordings/[id] — server-side enforcement", () => {
  it("requires authentication via requireSession", () => {
    expect(apiRouteSource).toContain("requireSession");
  });

  it("checks role permission via canDeleteRecording", () => {
    expect(apiRouteSource).toContain("canDeleteRecording");
  });

  it("returns 403 when role is not allowed", () => {
    expect(apiRouteSource).toContain("403");
    expect(apiRouteSource).toContain("does not have permission");
  });

  it("scopes call_sessions query to organization_id", () => {
    // The SQL must include organization_id in the WHERE clause
    expect(apiRouteSource).toMatch(/FROM\s+call_sessions[\s\S]*?organization_id\s*=\s*\$2/);
  });

  it("does not accept R2 key from the request — reads it from DB", () => {
    // The route should read recording_r2_key from the database, not from req body
    expect(apiRouteSource).toContain("session.recording_r2_key");
    // And it should NOT parse a recording key from the request
    expect(apiRouteSource).not.toMatch(/body\.r2_key|body\.recording_r2_key|req\.json/);
  });

  it("deletes from R2 before clearing DB reference", () => {
    const r2DeleteIdx = apiRouteSource.indexOf("deleteObjectFromR2");
    const dbClearIdx = apiRouteSource.indexOf("recording_r2_key = NULL");
    expect(r2DeleteIdx).toBeGreaterThan(-1);
    expect(dbClearIdx).toBeGreaterThan(-1);
    expect(r2DeleteIdx).toBeLessThan(dbClearIdx);
  });

  it("clears recording metadata in call_sessions after R2 delete", () => {
    expect(apiRouteSource).toContain("recording_r2_key = NULL");
    expect(apiRouteSource).toContain("recording_size = NULL");
    expect(apiRouteSource).toContain("recording_mime = NULL");
  });

  it("updates follow_up message JSON with recording_deleted flag", () => {
    expect(apiRouteSource).toContain("recording_deleted");
    expect(apiRouteSource).toContain("recording_deleted_by");
    expect(apiRouteSource).toContain("recording_deleted_at");
  });

  it("does not delete the follow_up row itself", () => {
    // Should UPDATE follow_ups, never DELETE FROM follow_ups
    expect(apiRouteSource).not.toMatch(/DELETE\s+FROM\s+follow_ups/i);
  });

  it("handles already-deleted recording idempotently", () => {
    expect(apiRouteSource).toContain("No recording to delete");
  });

  it("writes an audit log entry", () => {
    expect(apiRouteSource).toContain("activity_logs");
    expect(apiRouteSource).toContain("RECORDING_DELETED");
  });

  it("cross-org deletion is rejected by org scoping", () => {
    // The call_sessions SELECT requires both id AND organization_id
    expect(apiRouteSource).toMatch(
      /WHERE\s+id\s*=\s*\$1\s+AND\s+organization_id\s*=\s*\$2/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Settings API — recording-permissions/route.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("Settings API — recording-permissions/route.ts", () => {
  it("GET allows any authenticated user (requireSession, not requireRoles)", () => {
    // The GET handler must use requireSession so non-admins can check their permission
    const getBlock = settingsRouteSource.slice(
      settingsRouteSource.indexOf("async function GET"),
      settingsRouteSource.indexOf("async function POST")
    );
    expect(getBlock).toContain("requireSession");
    expect(getBlock).not.toContain("requireRoles");
  });

  it("POST is admin-only via requireRoles", () => {
    const postBlock = settingsRouteSource.slice(
      settingsRouteSource.indexOf("async function POST")
    );
    expect(postBlock).toContain('requireRoles(["admin"])');
  });

  it("uses the same permission source (recordingPermissions) as the DELETE API", () => {
    expect(settingsRouteSource).toContain("getRecordingDeleteRoles");
    expect(settingsRouteSource).toContain("setRecordingDeleteRoles");
    expect(apiRouteSource).toContain("canDeleteRecording");
    // Both import from the same module
    expect(settingsRouteSource).toContain("@/lib/recordingPermissions");
    expect(apiRouteSource).toContain("@/lib/recordingPermissions");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Client-side hook — useRecordingDeletePermission.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("useRecordingDeletePermission hook", () => {
  it("fetches from /api/settings/recording-permissions", () => {
    expect(hookSource).toContain("/api/settings/recording-permissions");
  });

  it("caches the result to avoid repeated fetches", () => {
    expect(hookSource).toMatch(/let cached/);
    expect(hookSource).toContain("if (cached)");
  });

  it("normalizes role key (lowercase, underscore to match API response)", () => {
    expect(hookSource).toContain(".trim().toLowerCase()");
  });

  it("exports a refresh function for cache invalidation", () => {
    expect(hookSource).toContain("export function refreshRecordingDeletePermission");
    expect(hookSource).toContain("cached = null");
  });

  it("does not hard-code role === admin as the permission check", () => {
    // Permission is dynamic from the API, not a hard-coded role check
    expect(hookSource).not.toMatch(/role\s*===?\s*["']admin["']/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ManualCallBubble — UI states
// ═══════════════════════════════════════════════════════════════════════════════
describe("ManualCallBubble — recording deletion UI", () => {
  it("uses useRecordingDeletePermission for visibility", () => {
    expect(bubbleSource).toContain("useRecordingDeletePermission");
    expect(bubbleSource).toContain("canDelete");
  });

  it("reads user role from getStoredCrmUser internally", () => {
    expect(bubbleSource).toContain("getStoredCrmUser");
    expect(bubbleSource).toContain("user?.role");
  });

  it("shows Delete Recording button only when canDelete is true", () => {
    expect(bubbleSource).toContain("{canDelete && (");
    expect(bubbleSource).toContain("Delete Recording");
  });

  it("shows Play Recording alongside Delete Recording", () => {
    expect(bubbleSource).toContain("Play Recording");
    expect(bubbleSource).toContain("Delete Recording");
  });

  it("shows confirmation modal before deleting", () => {
    expect(bubbleSource).toContain("showDeleteConfirm");
    expect(bubbleSource).toContain("Delete recording?");
    expect(bubbleSource).toContain("cannot be undone");
  });

  it("confirmation modal explains follow-up and call history remain", () => {
    expect(bubbleSource).toContain("The follow-up and call history will remain");
  });

  it("shows Recording deleted after successful deletion", () => {
    expect(bubbleSource).toContain("Recording deleted");
    expect(bubbleSource).toContain("wasDeleted");
  });

  it("does not show Play Recording after deletion", () => {
    // hasRecording is false when deleted
    expect(bubbleSource).toContain("!deleted");
    expect(bubbleSource).toMatch(/hasRecording\s*=.*&&\s*!deleted/);
  });

  it("stops audio playback before deleting", () => {
    // handleDelete should pause audio
    const handleDelete = bubbleSource.slice(
      bubbleSource.indexOf("const handleDelete"),
      bubbleSource.indexOf("const { date, time }")
    );
    expect(handleDelete).toContain("audioRef.current.pause()");
    expect(handleDelete).toContain("audioRef.current = null");
  });

  it("calls onRecordingDeleted after successful deletion", () => {
    expect(bubbleSource).toContain("onRecordingDeleted?.()");
  });

  it("calls DELETE /api/call-recordings/{sessionId}, not a custom key", () => {
    expect(bubbleSource).toContain("`/api/call-recordings/${sessionId}`");
    expect(bubbleSource).toContain('method: "DELETE"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Workspace Settings — RecordingPermissionsCard
// ═══════════════════════════════════════════════════════════════════════════════
describe("Workspace Settings — RecordingPermissionsCard", () => {
  it("renders RecordingPermissionsCard", () => {
    expect(workspaceSource).toContain("<RecordingPermissionsCard");
  });

  it("Admin toggle is always disabled (cannot be turned off)", () => {
    expect(workspaceSource).toMatch(/key:\s*"admin".*disabled:\s*true/);
  });

  it("includes toggles for site_head, sales_manager, receptionist", () => {
    expect(workspaceSource).toContain('"site_head"');
    expect(workspaceSource).toContain('"sales_manager"');
    expect(workspaceSource).toContain('"receptionist"');
  });

  it("calls refreshRecordingDeletePermission after saving", () => {
    expect(workspaceSource).toContain("refreshRecordingDeletePermission");
    // The refresh should happen inside the save function, before or after toast
    const cardBlock = workspaceSource.slice(
      workspaceSource.indexOf("function RecordingPermissionsCard"),
      workspaceSource.indexOf("export default function WorkspaceSettingsPage")
    );
    expect(cardBlock).toContain("refreshRecordingDeletePermission()");
  });

  it("POSTs to the same endpoint the hook GETs from", () => {
    const cardBlock = workspaceSource.slice(
      workspaceSource.indexOf("function RecordingPermissionsCard"),
      workspaceSource.indexOf("export default function WorkspaceSettingsPage")
    );
    expect(cardBlock).toContain("/api/settings/recording-permissions");
    expect(cardBlock).toContain('method: "POST"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Single source of truth — frontend and backend use the same config
// ═══════════════════════════════════════════════════════════════════════════════
describe("Single permission source — no divergent checks", () => {
  it("ManualCallBubble does NOT hard-code role checks", () => {
    // Should not contain role === "admin" or similar
    expect(bubbleSource).not.toMatch(/role\s*===?\s*["'](admin|site.head|sales.manager|receptionist)["']/i);
  });

  it("DELETE API reads permission from DB, not from request", () => {
    // Must use canDeleteRecording which reads from organization_recording_permissions
    expect(apiRouteSource).toContain("canDeleteRecording(orgId, gate.session.role)");
  });

  it("frontend hook and backend use the same org table", () => {
    // Hook fetches from the settings API which reads organization_recording_permissions
    expect(hookSource).toContain("/api/settings/recording-permissions");
    expect(settingsRouteSource).toContain("getRecordingDeleteRoles");
    // Backend DELETE reads from the same table via canDeleteRecording
    expect(permissionsSource).toContain("organization_recording_permissions");
  });
});
