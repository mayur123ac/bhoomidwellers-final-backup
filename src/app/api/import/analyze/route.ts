// app/api/import/analyze/route.ts
// Accepts a multipart .xlsx file and returns workbook analysis (sheets, headers,
// suggested mappings) without staging anything.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { analyzeWorkbook } from "@/lib/ingestion/analyzeWorkbook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // org id is resolved but not used in analysis — kept for audit consistency
    await getOrganizationId();

    // Parse multipart form
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

    const arrayBuf = await (file as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const analysis = await analyzeWorkbook(buffer);

    return NextResponse.json({ success: true, analysis }, { status: 200 });
  } catch (error: any) {
    console.error("[POST /api/import/analyze]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
