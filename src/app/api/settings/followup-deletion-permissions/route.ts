import { NextResponse } from "next/server";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import {
  getFollowUpDeletionRoles,
  setFollowUpDeletionRoles,
  ALL_FOLLOWUP_DELETABLE_ROLES,
} from "@/lib/followUpDeletionPermissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/followup-deletion-permissions
 *
 * Returns the current follow-up deletion role configuration.
 * Any authenticated user may read this — the frontend uses it to decide
 * whether to show the Delete button in the follow-up timeline.
 */
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const orgId = await getOrganizationId();
  const roles = await getFollowUpDeletionRoles(orgId);

  // Return as a role→boolean map (underscore keys) matching the recording-permissions shape.
  const result: Record<string, boolean> = {};
  for (const r of ALL_FOLLOWUP_DELETABLE_ROLES) {
    result[r.replace(/ /g, "_")] = roles.includes(r);
  }

  return NextResponse.json({ success: true, roles: result });
}

/**
 * POST /api/settings/followup-deletion-permissions
 *
 * Saves the follow-up deletion role configuration. Admin-only.
 * Admin is always included regardless of input.
 */
export async function POST(req: Request) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const orgId = await getOrganizationId();
  const { ip, userAgent } = requestContext(req);

  const body = await req.json().catch(() => ({}));

  if (!body.roles || typeof body.roles !== "object") {
    return NextResponse.json(
      { success: false, message: "roles object is required" },
      { status: 400 }
    );
  }

  // Read old value for audit diff.
  const oldRoles = await getFollowUpDeletionRoles(orgId);

  // Convert role→boolean map back to array of enabled roles.
  const enabledRoles: string[] = [];
  for (const r of ALL_FOLLOWUP_DELETABLE_ROLES) {
    const key = r.replace(/ /g, "_");
    if (body.roles[key] === true) {
      enabledRoles.push(r);
    }
  }

  const saved = await setFollowUpDeletionRoles(orgId, enabledRoles, gate.userId!);

  void writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name ?? null,
    action: "followup_deletion_permission.changed",
    entityType: "organization_followup_deletion_permissions",
    entityId: orgId,
    oldValue: { delete_roles: oldRoles },
    newValue: { delete_roles: saved },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    message: "Follow-up deletion permissions updated.",
    roles: saved,
  });
}
