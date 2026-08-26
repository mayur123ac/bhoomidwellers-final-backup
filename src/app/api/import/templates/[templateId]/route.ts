// app/api/import/templates/[templateId]/route.ts
// GET: fetch a single template. DELETE: soft-delete (deactivate) a template.
import { NextResponse } from "next/server";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getTemplate, deleteTemplate } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const { templateId } = await params;

    const template = await getTemplate(templateId, orgId);
    if (!template) {
      return NextResponse.json(
        { success: false, message: "Template not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, template }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/import/templates/[templateId]]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

const ALLOWED_ROLES = ["admin", "site_head", "site head"];

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const gate = await requireRoles(ALLOWED_ROLES);
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const { templateId } = await params;

    await deleteTemplate(templateId, orgId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("[DELETE /api/import/templates/[templateId]]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
