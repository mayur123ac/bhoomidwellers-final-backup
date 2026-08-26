// app/api/import/[jobId]/errors/route.ts
// Returns validation errors for a staged import job.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getImportErrors } from "@/lib/import/engine";

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

    const errors = await getImportErrors(jobId, orgId);

    return NextResponse.json({ success: true, errors }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/import/[jobId]/errors]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
