// app/api/settings/org-name/route.ts — lightweight organisation-name read.
//
// Any authenticated user needs to know the name of their own organisation so
// the sidebar can display it. The full /api/settings/workspace GET is gated
// behind admin-only because it returns counts, preferences, and config the
// non-admin roles must not see. This route answers only the one question any
// user legitimately has: "what is my organisation called?"
//
// Auth: requireSession() — any valid session (admin, sales, receptionist, …).
// Tenant: getOrganizationId() — server-side, from the signed session cookie.
//         The client never sends an org id; the server derives it.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();

    // Use organizations.name — the registration name set by the Super Admin when
    // the tenant was created. This is the authoritative tenant identifier.
    //
    // We deliberately do NOT use organization_settings.workspace_name here.
    // That column defaults to "Bhoomi Dwellers" throughout the codebase (see
    // loginNotification.ts:78, workspace/route.ts:83), so every tenant whose
    // admin has never explicitly overridden it also returns "Bhoomi Dwellers" —
    // which is exactly the cross-tenant display bug being fixed.
    //
    // organizations.name is set at org-creation by the Super Admin via
    // POST /api/platform/organizations and is never defaulted to another
    // tenant's name, making it the correct source of truth for the sidebar.
    const rows = await query<{ name: string | null }>(
      `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );

    const name = rows[0]?.name?.trim() || null;

    return NextResponse.json({ success: true, name }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/settings/org-name]", err);
    // Return a graceful null rather than an error that would break the sidebar.
    return NextResponse.json({ success: false, name: null }, { status: 200 });
  }
}
