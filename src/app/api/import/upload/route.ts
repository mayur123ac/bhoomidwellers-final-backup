// app/api/import/upload/route.ts
// Staged Excel lead import — upload & parse into staging tables.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { stageImport } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = [
  "admin",
  "site_head",
  "site head",
  "sales_manager",
  "sales manager",
];

function classifyRole(role: string): "admin" | "site_head" | "sales_manager" | "other" {
  const r = (role || "").toLowerCase();
  if (r === "admin") return "admin";
  if (r.includes("site") && r.includes("head")) return "site_head";
  if (r.includes("sales") && r.includes("manager")) return "sales_manager";
  return "other";
}

export async function POST(req: Request) {
  try {
    const gate = await requireRoles(ALLOWED_ROLES);
    if (!gate.ok) return gate.response;

    const { session } = gate;
    const userId = getSessionUserId(session);
    const kind = classifyRole(session.role);
    const orgId = await getOrganizationId();

    // Sales managers can only upload when the org toggle is enabled.
    if (kind === "sales_manager") {
      const settingRows = await query(
        `SELECT allow_sm_upload FROM organization_settings WHERE organization_id = $1`,
        [orgId]
      );
      const allowed = settingRows[0]?.allow_sm_upload === true;
      if (!allowed) {
        return NextResponse.json(
          {
            success: false,
            message: "Sales Manager bulk upload is disabled by the administrator.",
          },
          { status: 403 }
        );
      }
    }

    // Parse multipart form.
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { success: false, message: "No file uploaded. Expected an .xlsx file under 'file'." },
        { status: 400 }
      );
    }

    const filename = (file as File).name || "";
    if (!/\.xlsx$/i.test(filename)) {
      return NextResponse.json(
        { success: false, message: "Only .xlsx files are supported." },
        { status: 400 }
      );
    }

    // Read the file bytes.
    const arrayBuf = await (file as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // Resolve assignedTo.
    let assignedTo: string;
    if (kind === "sales_manager") {
      assignedTo = session.name;
    } else {
      const provided = form.get("assignedTo");
      assignedTo = typeof provided === "string" ? provided.trim() : "";
      if (!assignedTo) {
        return NextResponse.json(
          { success: false, message: "assignedTo is required." },
          { status: 400 }
        );
      }
    }

    if (userId == null) {
      return NextResponse.json(
        { success: false, message: "Could not resolve user identity." },
        { status: 401 }
      );
    }

    const overseeingSiteHead = kind === "site_head" ? session.name : null;

    // Phase 2: optional sheet name, column mapping, and template id
    const sheetNameField = form.get("sheetName");
    const sheetName = typeof sheetNameField === "string" ? sheetNameField.trim() || undefined : undefined;

    const mappingField = form.get("mapping");
    let mapping: Record<string, string> | undefined;
    if (typeof mappingField === "string" && mappingField.trim()) {
      try {
        mapping = JSON.parse(mappingField);
      } catch {
        return NextResponse.json(
          { success: false, message: "Invalid JSON in 'mapping' field." },
          { status: 400 }
        );
      }
    }

    const templateIdField = form.get("templateId");
    const templateId = typeof templateIdField === "string" ? templateIdField.trim() || undefined : undefined;

    const stageResult = await stageImport({
      buffer,
      filename: (file as File).name,
      orgId,
      uploadedById: userId,
      uploadedByName: session.name,
      assignedTo,
      overseeingSiteHead,
      sheetName,
      mapping,
      templateId,
    });

    return NextResponse.json({ success: true, ...stageResult }, { status: 200 });
  } catch (error: any) {
    console.error("[POST /api/import/upload]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
