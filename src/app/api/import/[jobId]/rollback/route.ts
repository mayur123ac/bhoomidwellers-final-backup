// app/api/import/[jobId]/rollback/route.ts
// Rolls back a previously committed import. Admin-only.
import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { rollbackImport } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const { session } = gate;
    const orgId = await getOrganizationId();
    const { jobId } = await params;

    const rollbackResult = await rollbackImport(jobId, orgId, session.name);

    return NextResponse.json({ success: true, ...rollbackResult }, { status: 200 });
  } catch (error: any) {
    console.error("[POST /api/import/[jobId]/rollback]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
