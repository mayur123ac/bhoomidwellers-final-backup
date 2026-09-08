import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const INDUSTRIES = ["Real Estate", "Construction", "Property Management", "Commercial Real Estate"];
const CURRENCIES = ["INR", "USD", "AED", "GBP", "EUR"];

// GET /api/settings/workspace
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    let workspace: any = {
      name: "My Workspace",
      slug: "default",
      industry: "Real Estate",
      currency: "INR",
      primaryColor: "#9E217B",
      secondaryColor: "#5B1247",
      lockDashboard: false,
      forceTheme: null,
    };

    if (orgId) {
      const orgRows = await query<any>(
        `SELECT name, slug, industry, currency, primary_color, secondary_color,
                lock_dashboard, force_theme
         FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId]
      );
      if (orgRows.length > 0) {
        const o = orgRows[0];
        workspace = {
          name: o.name ?? workspace.name,
          slug: o.slug ?? workspace.slug,
          industry: o.industry ?? workspace.industry,
          currency: o.currency ?? workspace.currency,
          primaryColor: o.primary_color ?? workspace.primaryColor,
          secondaryColor: o.secondary_color ?? workspace.secondaryColor,
          lockDashboard: Boolean(o.lock_dashboard),
          forceTheme: o.force_theme ?? null,
        };
      }
    }

    // Stats
    const statsQueries = orgId
      ? await Promise.all([
          query<any>(`SELECT COUNT(*)::int AS c FROM walkin_enquiries WHERE organization_id = $1`, [orgId]),
          query<any>(`SELECT COUNT(*)::int AS c FROM bookings WHERE organization_id = $1`, [orgId]),
          query<any>(`SELECT COUNT(*)::int AS c FROM users WHERE organization_id = $1 AND is_active = true`, [orgId]),
          query<any>(`SELECT COUNT(*)::int AS c FROM channel_partners WHERE organization_id = $1`, [orgId]),
        ])
      : await Promise.all([
          query<any>(`SELECT COUNT(*)::int AS c FROM walkin_enquiries`),
          query<any>(`SELECT COUNT(*)::int AS c FROM bookings`),
          query<any>(`SELECT COUNT(*)::int AS c FROM users WHERE is_active = true`),
          query<any>(`SELECT COUNT(*)::int AS c FROM channel_partners`),
        ]);

    const stats = {
      leads: statsQueries[0][0]?.c ?? 0,
      bookings: statsQueries[1][0]?.c ?? 0,
      users: statsQueries[2][0]?.c ?? 0,
      channelPartners: statsQueries[3][0]?.c ?? 0,
    };

    return NextResponse.json({
      success: true,
      workspace,
      stats,
      catalogue: { industries: INDUSTRIES, currencies: CURRENCIES },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/workspace]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/workspace
export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  if (!orgId) {
    return NextResponse.json({ success: false, message: "No organization context." }, { status: 400 });
  }

  try {
    const body = await req.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ success: false, message: "Workspace name is required." }, { status: 400 });
    }

    await query(
      `UPDATE organizations SET
         name = $1,
         industry = $2,
         currency = $3,
         primary_color = $4,
         secondary_color = $5,
         lock_dashboard = $6,
         force_theme = $7
       WHERE id = $8`,
      [
        body.name.trim(),
        body.industry || "Real Estate",
        body.currency || "INR",
        body.primaryColor || "#9E217B",
        body.secondaryColor || "#5B1247",
        Boolean(body.lockDashboard),
        body.forceTheme || null,
        orgId,
      ]
    );

    return NextResponse.json({ success: true, message: "Workspace settings saved." });
  } catch (err: any) {
    console.error("[PATCH /api/settings/workspace]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
