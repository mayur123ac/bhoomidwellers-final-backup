import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/lead-sorting
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    let enabled = false;
    if (orgId) {
      const rows = await query<any>(
        `SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
        [orgId]
      );
      if (rows.length > 0) {
        enabled = Boolean(rows[0].lead_number_sorting_enabled);
      }
    }

    return NextResponse.json({ success: true, enabled });
  } catch (err: any) {
    console.error("[GET /api/settings/lead-sorting]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/lead-sorting
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  if (!orgId) {
    return NextResponse.json({ success: false, message: "No organization context." }, { status: 400 });
  }

  try {
    const { enabled } = await req.json();

    await query(
      `INSERT INTO organization_settings (organization_id, lead_number_sorting_enabled)
       VALUES ($1, $2)
       ON CONFLICT (organization_id)
       DO UPDATE SET lead_number_sorting_enabled = EXCLUDED.lead_number_sorting_enabled`,
      [orgId, Boolean(enabled)]
    );

    return NextResponse.json({ success: true, message: "Lead number sorting saved." });
  } catch (err: any) {
    console.error("[POST /api/settings/lead-sorting]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
