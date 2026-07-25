// app/api/walkin_enquiries/bulk-import/route.ts
// Bulk Excel lead import. Preview (?preview=true) parses and validates without writing;
// without the flag it inserts all valid rows in one transaction.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { parseLeadSheet, RowCapError } from "@/lib/ingestion/parseLeadSheet";
import { bulkInsertLeads } from "@/lib/ingestion/bulkInsertLeads";

export const dynamic = "force-dynamic";

// Accept both underscore and space spellings that exist in the users table.
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
    const auth = await requireRole(ALLOWED_ROLES);
    if (!auth.isAuthorized) {
      return NextResponse.json(
        { success: false, message: auth.error },
        { status: auth.status }
      );
    }

    const session = auth.session;
    const kind = classifyRole(session.role);

    // Sales managers can only upload when the org toggle is enabled.
    if (kind === "sales_manager") {
      const settingRows = await query(
        `SELECT allow_sm_upload FROM organization_settings WHERE organization_id = 1`
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

    // Read the file bytes and parse (RowCapError -> 400, handled in catch).
    const arrayBuf = await (file as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const { validRows, errorRows } = parseLeadSheet(buffer);

    const { searchParams } = new URL(req.url);
    const isPreview = searchParams.get("preview") === "true";

    // Preview only parses/validates — no assignment target needed, no DB write.
    if (isPreview) {
      return NextResponse.json(
        {
          success: true,
          preview: true,
          validRows: validRows.length,
          sample: validRows.slice(0, 5),
          errorRows,
        },
        { status: 200 }
      );
    }

    // Resolve who the leads get assigned to (import only).
    let assignedTo: string;
    if (kind === "sales_manager") {
      // Sales managers always self-assign; any provided assignedTo is ignored.
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

    // overseeing_site_head follows the codebase convention of storing the
    // person's name (same as assigned_to and how it is displayed).
    const overseeingSiteHead = kind === "site_head" ? session.name : null;

    if (validRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No valid rows to import.",
          inserted: 0,
          skipped: [],
          errorRows,
        },
        { status: 400 }
      );
    }

    const { inserted, skipped } = await bulkInsertLeads({
      rows: validRows,
      assignedTo,
      overseeingSiteHead,
      // Feedback follow-ups are attributed to the uploader by name.
      uploadedByName: session.name || "Bulk Import",
    });

    return NextResponse.json(
      {
        success: true,
        inserted,
        skipped,
        errorRows,
      },
      { status: 200 }
    );
  } catch (error: any) {
    // Row-cap rejections are a client error, not a server fault.
    if (error instanceof RowCapError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 }
      );
    }
    console.error("[POST /api/walkin_enquiries/bulk-import]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
