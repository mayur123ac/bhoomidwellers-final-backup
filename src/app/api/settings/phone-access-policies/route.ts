// api/settings/phone-access-policies/route.ts
//
// GET  — any authenticated user may read the current policies.
//        (Needed so the UI knows whether it should expect masked phones, and
//         so non-admin pages can reflect the current state without guessing.)
//
// PUT  — admin-only. Updates one or more policy rows.
//        Body: { scope, role, can_view_full_phone }
//        or   { policies: [{ scope, role, can_view_full_phone }] }
//
// Security: the session role is read from the HMAC-signed cookie.
// No body-supplied role claim is trusted for the authorization decision.
//
// Audit: every mutation is written to audit_logs with actor, scope, role,
// old value, new value, and timestamp. Raw phone numbers are never logged.
//
// Realtime: a successful PUT broadcasts PHONE_POLICY_CHANGED to the org's
// Supabase channel so active sessions re-fetch masked data immediately.

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import {
  getAllPoliciesForOrg,
  getPhonePolicy,
  setPhonePolicy,
  type PhoneScope,
  type PhoneRole,
} from "@/lib/phoneAccess";
import { writeAuditLog, requestContext } from "@/lib/auditLog";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export const dynamic = "force-dynamic";

const VALID_SCOPES = new Set<PhoneScope>(["CP_ENQUIRY", "CP_LINKED_LEAD"]);
const VALID_ROLES = new Set<PhoneRole>([
  "receptionist",
  "sales_manager",
  "site_head",
  "sourcing_manager",
]);

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const orgId = await getOrganizationId();
  const rows = await getAllPoliciesForOrg(orgId);

  // Build the full policy object (including defaults for any missing rows).
  const policyMap: Record<string, Record<string, boolean>> = {};
  for (const scope of ["CP_ENQUIRY", "CP_LINKED_LEAD"] as PhoneScope[]) {
    policyMap[scope] = {};
    for (const role of [
      "receptionist",
      "sales_manager",
      "site_head",
      "sourcing_manager",
    ] as PhoneRole[]) {
      // Find the stored row, default to true if absent.
      const stored = rows.find((r) => r.scope === scope && r.role === role);
      policyMap[scope][role] = stored ? stored.can_view_full_phone : true;
    }
  }

  return NextResponse.json({ success: true, policies: policyMap });
}

// ─── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  // Admin-only: the server independently verifies the role from the signed
  // session cookie. A non-admin supplying a forged body is rejected here.
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const { ip, userAgent } = requestContext(req);
  const orgId = await getOrganizationId();
  const actorId = gate.userId;
  const actorName = gate.session.name;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  // Accept either a single { scope, role, can_view_full_phone } or a
  // { policies: [...] } batch. Both are normalized to an array.
  type PolicyUpdate = {
    scope: PhoneScope;
    role: PhoneRole;
    can_view_full_phone: boolean;
  };

  let updates: PolicyUpdate[];

  if (
    body &&
    typeof body === "object" &&
    "policies" in (body as object) &&
    Array.isArray((body as Record<string, unknown>).policies)
  ) {
    updates = (body as { policies: unknown[] }).policies as PolicyUpdate[];
  } else if (
    body &&
    typeof body === "object" &&
    "scope" in (body as object) &&
    "role" in (body as object) &&
    "can_view_full_phone" in (body as object)
  ) {
    updates = [body as PolicyUpdate];
  } else {
    return NextResponse.json(
      {
        success: false,
        message:
          "Body must be { scope, role, can_view_full_phone } or { policies: [...] }",
      },
      { status: 400 }
    );
  }

  // Validate each entry.
  for (const u of updates) {
    if (!VALID_SCOPES.has(u.scope)) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid scope "${u.scope}". Must be CP_ENQUIRY or CP_LINKED_LEAD.`,
        },
        { status: 400 }
      );
    }
    if (!VALID_ROLES.has(u.role)) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid role "${u.role}". Must be one of: receptionist, sales_manager, site_head, sourcing_manager.`,
        },
        { status: 400 }
      );
    }
    if (typeof u.can_view_full_phone !== "boolean") {
      return NextResponse.json(
        { success: false, message: "can_view_full_phone must be a boolean." },
        { status: 400 }
      );
    }
  }

  try {
    // Apply each update and audit.
    for (const u of updates) {
      const oldValue = await getPhonePolicy(orgId, u.scope, u.role);
      if (oldValue === u.can_view_full_phone) continue; // no actual change

      await setPhonePolicy(
        orgId,
        u.scope,
        u.role,
        u.can_view_full_phone,
        actorName ?? "admin"
      );

      // Audit record. Raw phone numbers are NEVER written to audit logs.
      void writeAuditLog({
        userId: actorId,
        actorName: actorName ?? null,
        action: "phone_access_policy.changed",
        entityType: "phone_number_access_policies",
        entityId: `${u.scope}:${u.role}`,
        oldValue: { scope: u.scope, role: u.role, can_view_full_phone: oldValue },
        newValue: {
          scope: u.scope,
          role: u.role,
          can_view_full_phone: u.can_view_full_phone,
        },
        ipAddress: ip,
        userAgent,
      });

      // Realtime: tell active clients to re-fetch (they will get masked data
      // on the next request if their role's policy was just disabled).
      // Fire-and-forget — a broadcast failure must not break the API response.
      void broadcastToOrg(orgId, "PHONE_POLICY_CHANGED", {
        scope: u.scope,
        role: u.role,
        can_view_full_phone: u.can_view_full_phone,
      });
    }

    // Return the current full policy state.
    const rows = await getAllPoliciesForOrg(orgId);
    const policyMap: Record<string, Record<string, boolean>> = {};
    for (const scope of ["CP_ENQUIRY", "CP_LINKED_LEAD"] as PhoneScope[]) {
      policyMap[scope] = {};
      for (const role of [
        "receptionist",
        "sales_manager",
        "site_head",
        "sourcing_manager",
      ] as PhoneRole[]) {
        const stored = rows.find((r) => r.scope === scope && r.role === role);
        policyMap[scope][role] = stored ? stored.can_view_full_phone : true;
      }
    }

    return NextResponse.json({
      success: true,
      message: "Phone access policies updated.",
      policies: policyMap,
    });
  } catch (err: any) {
    console.error("[PUT /api/settings/phone-access-policies]", err);
    return NextResponse.json(
      { success: false, message: err.message ?? "Internal server error." },
      { status: 500 }
    );
  }
}
