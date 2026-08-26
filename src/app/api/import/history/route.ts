// app/api/import/history/route.ts
// Returns paginated import history for the current organization.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getImportHistory } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const result = await getImportHistory(orgId, { limit, offset });

    return NextResponse.json({ success: true, jobs: result }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/import/history]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
