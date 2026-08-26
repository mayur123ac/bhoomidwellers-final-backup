// app/api/import/[jobId]/commit/route.ts
// Commits a staged import into production tables.
import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { commitImport } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = [
  "admin",
  "site_head",
  "site head",
  "sales_manager",
  "sales manager",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const gate = await requireRoles(ALLOWED_ROLES);
    if (!gate.ok) return gate.response;

    const { session } = gate;
    const orgId = await getOrganizationId();
    const { jobId } = await params;

    const commitResult = await commitImport(jobId, orgId, session.name);

    return NextResponse.json({ success: true, ...commitResult }, { status: 200 });
  } catch (error: any) {
    console.error("[POST /api/import/[jobId]/commit]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
