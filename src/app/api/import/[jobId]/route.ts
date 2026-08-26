// app/api/import/[jobId]/route.ts
// Returns job details and a paginated/filterable preview of staged rows.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getImportJob, getImportPreview } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const { jobId } = await params;

    const job = await getImportJob(jobId, orgId);
    if (!job) {
      return NextResponse.json(
        { success: false, message: "Import job not found." },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 500);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);
    const filter = (searchParams.get("filter") || "all") as "all" | "valid" | "invalid";

    const preview = await getImportPreview(jobId, orgId, { limit, offset, filter });

    return NextResponse.json(
      { success: true, job, preview: { rows: preview.rows, total: preview.total } },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[GET /api/import/[jobId]]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
