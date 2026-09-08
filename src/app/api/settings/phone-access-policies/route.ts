import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEFAULT_POLICIES = {
  CP_ENQUIRY: { receptionist: true, sales_manager: false, site_head: true, sourcing_manager: true },
  CP_LINKED_LEAD: { receptionist: true, sales_manager: false, site_head: true, sourcing_manager: false },
  LEAD_PHONE: { receptionist: true, sales_manager: true, site_head: true, sourcing_manager: false },
};

// GET /api/settings/phone-access-policies
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    if (orgId) {
      const rows = await query<any>(
        `SELECT phone_access_policies FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
        [orgId]
      );
      if (rows.length > 0 && rows[0].phone_access_policies) {
        return NextResponse.json({
          success: true,
          policies: { ...DEFAULT_POLICIES, ...rows[0].phone_access_policies },
        });
      }
    }

    return NextResponse.json({ success: true, policies: DEFAULT_POLICIES });
  } catch (err: any) {
    console.error("[GET /api/settings/phone-access-policies]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/phone-access-policies
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  if (!orgId) {
    return NextResponse.json({ success: false, message: "No organization context." }, { status: 400 });
  }

  try {
    const body = await req.json();

    await query(
      `INSERT INTO organization_settings (organization_id, phone_access_policies)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (organization_id)
       DO UPDATE SET phone_access_policies = EXCLUDED.phone_access_policies`,
      [orgId, JSON.stringify(body.policies ?? body)]
    );

    return NextResponse.json({ success: true, message: "Phone access policies saved." });
  } catch (err: any) {
    console.error("[POST /api/settings/phone-access-policies]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
