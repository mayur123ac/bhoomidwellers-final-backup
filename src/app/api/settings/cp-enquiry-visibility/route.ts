import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/cp-enquiry-visibility
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    const defaults = { receptionist: false, site_head: false, sales_manager: true };

    if (orgId) {
      const rows = await query<any>(
        `SELECT cp_enquiry_visibility FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
        [orgId]
      );
      if (rows.length > 0 && rows[0].cp_enquiry_visibility) {
        const v = rows[0].cp_enquiry_visibility;
        return NextResponse.json({
          success: true,
          receptionist: Boolean(v.receptionist),
          site_head: Boolean(v.site_head),
          sales_manager: v.sales_manager !== false,
        });
      }
    }

    return NextResponse.json({ success: true, ...defaults });
  } catch (err: any) {
    console.error("[GET /api/settings/cp-enquiry-visibility]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/cp-enquiry-visibility
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  if (!orgId) {
    return NextResponse.json({ success: false, message: "No organization context." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const visibility = {
      receptionist: Boolean(body.receptionist),
      site_head: Boolean(body.site_head),
      sales_manager: Boolean(body.sales_manager),
    };

    await query(
      `INSERT INTO organization_settings (organization_id, cp_enquiry_visibility)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (organization_id)
       DO UPDATE SET cp_enquiry_visibility = EXCLUDED.cp_enquiry_visibility`,
      [orgId, JSON.stringify(visibility)]
    );

    return NextResponse.json({ success: true, message: "CP enquiry visibility saved." });
  } catch (err: any) {
    console.error("[POST /api/settings/cp-enquiry-visibility]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
