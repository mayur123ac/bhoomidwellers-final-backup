import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalise(val: unknown): string | null {
  if (!val || typeof val !== "string" || val.trim() === "") return null;
  const s = val.trim();
  if (!HEX_RE.test(s)) return undefined as never; // signal invalid
  return s;
}

export async function GET() {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const rows = await query<{
      enquiry_primary_color: string | null;
      enquiry_secondary_color: string | null;
      enquiry_text_color: string | null;
    }>(
      "SELECT enquiry_primary_color, enquiry_secondary_color, enquiry_text_color FROM public.organizations WHERE id = $1 LIMIT 1",
      [orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Organization not found" }, { status: 404 });
    }

    const row = rows[0];
    return NextResponse.json({
      success: true,
      primaryColor: row.enquiry_primary_color || "#18392B",
      secondaryColor: row.enquiry_secondary_color || "#C5A059",
      textColor: row.enquiry_text_color || "#1F2937",
    });
  } catch (err: any) {
    console.error("[GET /api/settings/org-theme]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const { primaryColor, secondaryColor, textColor } = body;

    for (const [key, val] of [["primaryColor", primaryColor], ["secondaryColor", secondaryColor], ["textColor", textColor]]) {
      if (val !== null && val !== undefined && val !== "" && !HEX_RE.test(String(val).trim())) {
        return NextResponse.json(
          { success: false, message: `Invalid hex color for ${key}: ${val}` },
          { status: 400 }
        );
      }
    }

    const primary = normalise(primaryColor);
    const secondary = normalise(secondaryColor);
    const text = normalise(textColor);

    const orgId = await getOrganizationId();
    await query(
      "UPDATE public.organizations SET enquiry_primary_color = $1, enquiry_secondary_color = $2, enquiry_text_color = $3 WHERE id = $4",
      [primary, secondary, text, orgId]
    );

    return NextResponse.json({ success: true, message: "Theme saved." });
  } catch (err: any) {
    console.error("[PATCH /api/settings/org-theme]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
