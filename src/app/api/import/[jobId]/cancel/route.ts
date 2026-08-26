// app/api/import/[jobId]/cancel/route.ts
// Cancels a pending (staged) import job.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { cancelImport } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const { jobId } = await params;

    await cancelImport(jobId, orgId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("[POST /api/import/[jobId]/cancel]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
