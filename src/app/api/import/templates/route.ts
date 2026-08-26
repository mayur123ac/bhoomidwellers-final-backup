// app/api/import/templates/route.ts
// GET: list active templates for the current organization.
// POST: save a new import template (admin / site_head only).
import { NextResponse } from "next/server";
import { requireSession, requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getTemplates, saveTemplate } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const templates = await getTemplates(orgId);

    return NextResponse.json({ success: true, templates }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/import/templates]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

const ALLOWED_ROLES = ["admin", "site_head", "site head"];

export async function POST(req: Request) {
  try {
    const gate = await requireRoles(ALLOWED_ROLES);
    if (!gate.ok) return gate.response;

    const { session } = gate;
    const userId = getSessionUserId(session);
    const orgId = await getOrganizationId();

    if (userId == null) {
      return NextResponse.json(
        { success: false, message: "Could not resolve user identity." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { name, mappings, ignoredColumns, valueMappings, dateFormat, isDefault } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { success: false, message: "Template name is required." },
        { status: 400 }
      );
    }
    if (!mappings || typeof mappings !== "object") {
      return NextResponse.json(
        { success: false, message: "Column mappings object is required." },
        { status: 400 }
      );
    }

    const result = await saveTemplate({
      orgId,
      name: name.trim(),
      mappings,
      ignoredColumns: ignoredColumns || [],
      valueMappings: valueMappings || {},
      dateFormat: dateFormat || "DD/MM/YYYY",
      isDefault: isDefault || false,
      createdById: userId,
      createdByName: session.name,
    });

    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/import/templates]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
