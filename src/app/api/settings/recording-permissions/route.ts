import { NextResponse } from "next/server";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import {
  getRecordingDeleteRoles,
  setRecordingDeleteRoles,
  ALL_DELETABLE_ROLES,
} from "@/lib/recordingPermissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the current recording-delete role configuration.
 *  Any authenticated user can read this — needed so ManualCallBubble
 *  can check whether the current role is allowed to delete. */
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const orgId = await getOrganizationId();
  const roles = await getRecordingDeleteRoles(orgId);

  // Return as a role→boolean map for the toggle UI
  const result: Record<string, boolean> = {};
  for (const r of ALL_DELETABLE_ROLES) {
    result[r.replace(/ /g, "_")] = roles.includes(r);
  }

  return NextResponse.json({ success: true, roles: result });
}

/** Saves the recording-delete role configuration. Admin-only. */
export async function POST(req: Request) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const orgId = await getOrganizationId();
  const body = await req.json().catch(() => ({}));

  if (!body.roles || typeof body.roles !== "object") {
    return NextResponse.json(
      { success: false, message: "roles object is required" },
      { status: 400 }
    );
  }

  // Convert role→boolean map back to array of enabled roles
  const enabledRoles: string[] = [];
  for (const r of ALL_DELETABLE_ROLES) {
    const key = r.replace(/ /g, "_");
    if (body.roles[key] === true) {
      enabledRoles.push(r);
    }
  }

  const saved = await setRecordingDeleteRoles(orgId, enabledRoles, gate.userId!);

  return NextResponse.json({
    success: true,
    message: "Recording permissions updated.",
    roles: saved,
  });
}
