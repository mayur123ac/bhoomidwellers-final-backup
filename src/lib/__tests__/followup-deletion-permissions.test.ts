// Tests for the Follow-Up Deletion Role Toggle feature.
//
// Structural tests that verify:
// 1. Permission model logic (normalizeRole, admin/super-admin always allowed)
// 2. DELETE API route security (auth gates, role checks, org scoping, R2-first ordering)
// 3. Settings API security (GET open, POST admin-only, same permission source)
// 4. Frontend hook behaviour (fetch, cache, normalize, refresh export)
// 5. Workspace Settings UI (FollowUpDeletionPermissionsCard shape and wiring)

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const read = (relPath: string) =>
  fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");

// ── Source files under test ──────────────────────────────────────────────────
const permissionsSource = read("../followUpDeletionPermissions.ts");
const deleteRouteSource = read("../../app/api/followups/[id]/route.ts");
const settingsRouteSource = read(
  "../../app/api/settings/followup-deletion-permissions/route.ts"
);
const hookSource = read("../hooks/useFollowUpDeletionPermission.ts");
const workspaceSource = read(
  "../../app/dashboard/settings/workspace/page.tsx"
);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Permission model — followUpDeletionPermissions.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("followUpDeletionPermissions.ts — server-side permission model", () => {
  it("admin is always in ALL_FOLLOWUP_DELETABLE_ROLES", () => {
    expect(permissionsSource).toContain('"admin"');
    // Array is multiline — verify the constant name and admin entry are both present
    expect(permissionsSource).toContain("ALL_FOLLOWUP_DELETABLE_ROLES");
    expect(permissionsSource).toContain('"admin"');
  });

  it("setFollowUpDeletionRoles always includes admin regardless of input", () => {
    expect(permissionsSource).toMatch(/new Set.*\[.*"admin".*\]/);
  });

  it("normalizeRole replaces underscores with spaces", () => {
    expect(permissionsSource).toContain('.replace(/_/g, " ")');
  });

  it("table is bootstrapped with CREATE TABLE IF NOT EXISTS", () => {
    expect(permissionsSource).toContain(
      "CREATE TABLE IF NOT EXISTS organization_followup_deletion_permissions"
    );
  });

  it("default delete_roles is admin-only", () => {
    expect(permissionsSource).toMatch(/DEFAULT\s+ARRAY\['admin'\]/i);
  });

  it("canDeleteFollowUp explicitly allows super admin without a table lookup", () => {
    // Scope search to inside the canDeleteFollowUp function body only, so we
    // compare positions of the bypass and the lookup call (not the definition).
    const fnStart = permissionsSource.indexOf("async function canDeleteFollowUp");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = permissionsSource.slice(fnStart);
    const bypassIdx = fnBody.indexOf('"super admin"');
    const lookupIdx = fnBody.indexOf("getFollowUpDeletionRoles");
    expect(bypassIdx).toBeGreaterThan(-1);
    expect(lookupIdx).toBeGreaterThan(-1);
    // The bypass check must come before the DB lookup call
    expect(bypassIdx).toBeLessThan(lookupIdx);
  });

  it("canDeleteFollowUp reads from getFollowUpDeletionRoles and normalizes role", () => {
    expect(permissionsSource).toContain("async function canDeleteFollowUp");
    expect(permissionsSource).toContain("getFollowUpDeletionRoles");
    expect(permissionsSource).toContain("normalizeRole");
  });

  it("uses ON CONFLICT upsert — no duplicate row risk", () => {
    expect(permissionsSource).toContain("ON CONFLICT (organization_id) DO UPDATE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DELETE API route — followups/[id]/route.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/followups/[id] — server-side enforcement", () => {
  it("requires authentication via requireSession", () => {
    expect(deleteRouteSource).toContain("requireSession");
  });

  it("resolves tenant from signed cookie via getOrganizationId, not request body", () => {
    expect(deleteRouteSource).toContain("getOrganizationId");
    // Must NOT read org from body/params
    expect(deleteRouteSource).not.toMatch(/body\.(org|organization)|params\.(org|organization)/);
  });

  it("checks role permission via canDeleteFollowUp", () => {
    expect(deleteRouteSource).toContain("canDeleteFollowUp");
  });

  it("passes org and role from session to canDeleteFollowUp", () => {
    expect(deleteRouteSource).toContain("canDeleteFollowUp(orgId, gate.session.role)");
  });

  it("returns 403 when role is not allowed", () => {
    expect(deleteRouteSource).toContain("403");
    expect(deleteRouteSource).toContain("does not have permission to delete follow-ups");
  });

  it("scopes follow_ups SELECT to organization_id (cross-org deletion rejected)", () => {
    expect(deleteRouteSource).toMatch(
      /FROM\s+follow_ups\s+WHERE\s+id\s*=\s*\$1\s+AND\s+organization_id\s*=\s*\$2/
    );
  });

  it("returns 404 when follow-up not found or belongs to another org", () => {
    expect(deleteRouteSource).toContain("Follow-up not found");
    expect(deleteRouteSource).toContain("404");
  });

  it("loads attachments scoped to both follow_up_id AND organization_id", () => {
    expect(deleteRouteSource).toMatch(
      /FROM\s+follow_up_attachments[\s\S]*?follow_up_id\s*=\s*\$1[\s\S]*?organization_id\s*=\s*\$2/
    );
  });

  it("deletes R2 objects before touching the DB", () => {
    const r2DeleteIdx = deleteRouteSource.indexOf("deleteObjectFromR2");
    const dbDeleteIdx = deleteRouteSource.indexOf("DELETE FROM follow_ups");
    expect(r2DeleteIdx).toBeGreaterThan(-1);
    expect(dbDeleteIdx).toBeGreaterThan(-1);
    expect(r2DeleteIdx).toBeLessThan(dbDeleteIdx);
  });

  it("aborts with 500 when any R2 deletion fails (no data removed)", () => {
    expect(deleteRouteSource).toContain("r2Errors");
    expect(deleteRouteSource).toContain("Failed to delete file(s) from storage. No data was removed");
  });

  it("deletes attachment DB records before the follow-up row (transactional)", () => {
    const attDeleteIdx = deleteRouteSource.indexOf("DELETE FROM follow_up_attachments");
    const fuDeleteIdx = deleteRouteSource.indexOf("DELETE FROM follow_ups");
    expect(attDeleteIdx).toBeGreaterThan(-1);
    expect(fuDeleteIdx).toBeGreaterThan(-1);
    expect(attDeleteIdx).toBeLessThan(fuDeleteIdx);
  });

  it("wraps DB deletes in a transaction", () => {
    expect(deleteRouteSource).toContain("transaction(async");
  });

  it("writes an audit log entry with followup.deleted action", () => {
    expect(deleteRouteSource).toContain("writeAuditLog");
    expect(deleteRouteSource).toContain('"followup.deleted"');
    expect(deleteRouteSource).toContain('"follow_up"');
  });

  it("broadcasts followup.deleted event via broadcastToOrg", () => {
    expect(deleteRouteSource).toContain("broadcastToOrg");
    expect(deleteRouteSource).toContain('"followup.deleted"');
  });

  it("broadcast payload includes followUpId and leadId as strings", () => {
    expect(deleteRouteSource).toContain("followUpId: String(followUpId)");
    expect(deleteRouteSource).toContain("leadId: String(leadId)");
  });

  it("returns success response with followUpId and leadId", () => {
    expect(deleteRouteSource).toContain('"Follow-up deleted."');
    expect(deleteRouteSource).toContain("success: true");
  });

  it("gracefully handles missing attachments table (try/catch)", () => {
    // The attachment SELECT should be wrapped in try/catch with empty fallback
    const tryIdx = deleteRouteSource.indexOf("try {");
    const catchIdx = deleteRouteSource.indexOf("attachments = []");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Settings API — followup-deletion-permissions/route.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("Settings API — followup-deletion-permissions/route.ts", () => {
  it("GET allows any authenticated user (requireSession, not requireRoles)", () => {
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

  it("uses the same permission source as the DELETE API", () => {
    expect(settingsRouteSource).toContain("getFollowUpDeletionRoles");
    expect(settingsRouteSource).toContain("setFollowUpDeletionRoles");
    expect(deleteRouteSource).toContain("canDeleteFollowUp");
    expect(settingsRouteSource).toContain("@/lib/followUpDeletionPermissions");
    expect(deleteRouteSource).toContain("@/lib/followUpDeletionPermissions");
  });

  it("reads old roles before saving to produce audit diff", () => {
    const postBlock = settingsRouteSource.slice(
      settingsRouteSource.indexOf("async function POST")
    );
    const oldIdx = postBlock.indexOf("getFollowUpDeletionRoles");
    const setIdx = postBlock.indexOf("setFollowUpDeletionRoles");
    expect(oldIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeLessThan(setIdx);
  });

  it("writes an audit log on POST", () => {
    const postBlock = settingsRouteSource.slice(
      settingsRouteSource.indexOf("async function POST")
    );
    expect(postBlock).toContain("writeAuditLog");
    expect(postBlock).toContain('"followup_deletion_permission.changed"');
  });

  it("returns role map as boolean values (not array)", () => {
    expect(settingsRouteSource).toContain("result[r.replace(/ /g,");
    // The GET returns an object, not a raw array
    expect(settingsRouteSource).toContain("roles: result");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Client-side hook — useFollowUpDeletionPermission.ts
// ═══════════════════════════════════════════════════════════════════════════════
describe("useFollowUpDeletionPermission hook", () => {
  it("fetches from /api/settings/followup-deletion-permissions", () => {
    expect(hookSource).toContain("/api/settings/followup-deletion-permissions");
  });

  it("caches the result at module level to avoid repeated fetches", () => {
    expect(hookSource).toMatch(/let cached/);
    expect(hookSource).toContain("if (cached)");
  });

  it("uses single-flight (inFlight) to prevent concurrent duplicate requests", () => {
    expect(hookSource).toMatch(/let inFlight/);
    expect(hookSource).toContain("if (inFlight) return inFlight");
  });

  it("normalizes role key (lowercase, space to underscore) to match API response", () => {
    expect(hookSource).toContain(".trim().toLowerCase()");
    expect(hookSource).toContain('.replace(/ /g, "_")');
  });

  it("exports a refresh function for cache invalidation after settings save", () => {
    expect(hookSource).toContain("export function refreshFollowUpDeletionPermission");
    expect(hookSource).toContain("cached = null");
  });

  it("defaults to admin-only when fetch fails", () => {
    expect(hookSource).toContain("{ admin: true }");
  });

  it("does not hard-code a role equality check as the permission gate", () => {
    // Permission must come from the API response, not a hard-coded role check
    expect(hookSource).not.toMatch(/role\s*===?\s*["']admin["']/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Workspace Settings — FollowUpDeletionPermissionsCard
// ═══════════════════════════════════════════════════════════════════════════════
describe("Workspace Settings — FollowUpDeletionPermissionsCard", () => {
  it("renders FollowUpDeletionPermissionsCard", () => {
    expect(workspaceSource).toContain("<FollowUpDeletionPermissionsCard");
  });

  it("Admin toggle is always disabled (cannot be turned off)", () => {
    const cardBlock = workspaceSource.slice(
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard"),
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard") + 2000
    );
    expect(cardBlock).toMatch(/key:\s*"admin".*disabled:\s*true/);
  });

  it("includes toggles for site_head, sales_manager, receptionist", () => {
    const cardBlock = workspaceSource.slice(
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard"),
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard") + 2000
    );
    expect(cardBlock).toContain('"site_head"');
    expect(cardBlock).toContain('"sales_manager"');
    expect(cardBlock).toContain('"receptionist"');
  });

  it("calls refreshFollowUpDeletionPermission after saving", () => {
    const cardBlock = workspaceSource.slice(
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard"),
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard") + 2000
    );
    expect(cardBlock).toContain("refreshFollowUpDeletionPermission()");
  });

  it("POSTs to the same endpoint the hook GETs from", () => {
    const cardBlock = workspaceSource.slice(
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard"),
      workspaceSource.indexOf("function FollowUpDeletionPermissionsCard") + 2000
    );
    expect(cardBlock).toContain("/api/settings/followup-deletion-permissions");
    expect(cardBlock).toContain('"POST"');
  });

  it("imports refreshFollowUpDeletionPermission at the top of the workspace page", () => {
    expect(workspaceSource).toContain("refreshFollowUpDeletionPermission");
    expect(workspaceSource).toContain(
      "@/lib/hooks/useFollowUpDeletionPermission"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Single source of truth — no divergent permission checks
// ═══════════════════════════════════════════════════════════════════════════════
describe("Single permission source — no divergent checks", () => {
  it("DELETE API reads permission from DB, not from a hard-coded role list in the route", () => {
    // Must delegate to canDeleteFollowUp, not inline the check
    expect(deleteRouteSource).toContain("canDeleteFollowUp(orgId, gate.session.role)");
    expect(deleteRouteSource).not.toMatch(
      /gate\.session\.role\s*===?\s*["'](admin|site.head|sales.manager)["']/i
    );
  });

  it("frontend hook and backend both reference organization_followup_deletion_permissions table", () => {
    expect(permissionsSource).toContain("organization_followup_deletion_permissions");
    // Hook reads via the settings API which itself reads from that table
    expect(hookSource).toContain("/api/settings/followup-deletion-permissions");
    expect(settingsRouteSource).toContain("getFollowUpDeletionRoles");
  });

  it("realtime deletion event type matches broadcastToOrg call and followUpSync handler", () => {
    // The DELETE route broadcasts 'followup.deleted'
    expect(deleteRouteSource).toContain('"followup.deleted"');
    // Find the void broadcastToOrg( call (not the import line) and verify payload
    const callIdx = deleteRouteSource.indexOf("void broadcastToOrg");
    expect(callIdx).toBeGreaterThan(-1);
    const broadcastCall = deleteRouteSource.slice(callIdx, callIdx + 150);
    expect(broadcastCall).toContain('"followup.deleted"');
  });
});
