import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function logoSrc(row: { logo_key: string | null; logo_url: string | null }): string | null {
  if (row.logo_key) return `/api/r2-proxy?key=${encodeURIComponent(row.logo_key)}`;
  return row.logo_url || null;
}

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const rows = await query<{
      name: string;
      logo_key: string | null;
      logo_url: string | null;
      enquiry_primary_color: string | null;
      enquiry_secondary_color: string | null;
      enquiry_text_color: string | null;
    }>(
      "SELECT name, logo_key, logo_url, enquiry_primary_color, enquiry_secondary_color, enquiry_text_color FROM public.organizations WHERE id = $1 LIMIT 1",
      [orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Organization not found" }, { status: 404 });
    }

    const row = rows[0];
    return NextResponse.json({
      success: true,
      name: row.name,
      logo: logoSrc(row),
      primaryColor: row.enquiry_primary_color || "#18392B",
      secondaryColor: row.enquiry_secondary_color || "#C5A059",
      textColor: row.enquiry_text_color || "#1F2937",
    });
  } catch (err: any) {
    console.error("[GET /api/org-branding]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
