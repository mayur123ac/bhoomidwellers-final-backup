// api/settings/cp-enquiry-visibility/route.ts
// GET: read which roles can see the standalone "CP Enquiry" tab.
// POST: admin-only, update the per-role visibility flags.
//
// Stored as a JSONB column on organization_settings:
//   { "receptionist": bool, "site_head": bool, "sales_manager": bool }
//
// Defaults: sales_manager true (tab already existed), others false.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

const DEFAULTS = { receptionist: false, site_head: false, sales_manager: true };

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const res = await query(
      `SELECT cp_enquiry_visibility FROM organization_settings WHERE organization_id = $1`,
      [orgId]
    );

    const stored = res.length > 0 && res[0].cp_enquiry_visibility
      ? res[0].cp_enquiry_visibility
      : {};

    return NextResponse.json({ ...DEFAULTS, ...stored });
  } catch (error) {
    console.error("[GET /api/settings/cp-enquiry-visibility]", error);
    return NextResponse.json(DEFAULTS);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Admins only" },
        { status: 401 }
      );
    }

    const body = await req.json();

    // Validate: only allow known role keys with boolean values
    const allowed = ["receptionist", "site_head", "sales_manager"];
    const visibility: Record<string, boolean> = {};
    for (const key of allowed) {
      if (key in body && typeof body[key] === "boolean") {
        visibility[key] = body[key];
      }
    }

    if (Object.keys(visibility).length === 0) {
      return NextResponse.json(
        { success: false, message: "Provide at least one of: receptionist, site_head, sales_manager (boolean)" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();

    // Merge with existing values so a partial update doesn't clear others
    const existing = await query(
      `SELECT cp_enquiry_visibility FROM organization_settings WHERE organization_id = $1`,
      [orgId]
    );

    const current = existing.length > 0 && existing[0].cp_enquiry_visibility
      ? existing[0].cp_enquiry_visibility
      : {};

    const merged = { ...DEFAULTS, ...current, ...visibility };

    await query(
      `INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible, cp_enquiry_visibility)
       VALUES ($1, '11:00', '20:00', false, $2)
       ON CONFLICT (organization_id) DO UPDATE
         SET cp_enquiry_visibility = $2,
             updated_at = CURRENT_TIMESTAMP`,
      [orgId, JSON.stringify(merged)]
    );

    return NextResponse.json({
      success: true,
      message: "CP Enquiry tab visibility updated",
      ...merged,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/cp-enquiry-visibility]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
