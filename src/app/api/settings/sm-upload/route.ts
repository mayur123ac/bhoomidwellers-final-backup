// app/api/settings/sm-upload/route.ts
// GET: read the "allow sales managers to bulk upload leads" toggle.
// POST: admin-only, set the toggle.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // MT-06: see the note in settings/lead-sorting. Anonymous callers must not
    // reach a tenant-resolved read.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const res = await query(
      `SELECT allow_sm_upload
       FROM organization_settings
       WHERE organization_id = $1`,
      [await getOrganizationId()]
    );

    if (res.length === 0) {
      return NextResponse.json({ enabled: false });
    }

    return NextResponse.json({ enabled: res[0].allow_sm_upload === true });
  } catch (error) {
    console.error("[GET /api/settings/sm-upload]", error);
    return NextResponse.json({ enabled: false });
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
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { success: false, message: "Invalid value: 'enabled' must be a boolean" },
        { status: 400 }
      );
    }

    await query(
      `INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible, allow_sm_upload)
       VALUES ($2, '11:00', '20:00', false, $1)
       ON CONFLICT (organization_id) DO UPDATE
         SET allow_sm_upload = EXCLUDED.allow_sm_upload,
             updated_at = CURRENT_TIMESTAMP`,
      [enabled, await getOrganizationId()]
    );

    return NextResponse.json({
      success: true,
      message: `Sales Manager bulk upload ${enabled ? "enabled" : "disabled"}`,
      enabled,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/sm-upload]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
