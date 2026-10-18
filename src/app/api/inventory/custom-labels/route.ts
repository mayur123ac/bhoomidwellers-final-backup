// app/api/inventory/custom-labels/route.ts
// Returns the distinct custom_status_label values used by this organization,
// ordered by frequency (most common first). Used to populate the "Other"
// dropdown so users can re-select previously created labels.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const rows = await query<{ label: string; count: number }>(
      `SELECT custom_status_label AS label, COUNT(*)::int AS count
       FROM inventory_units
       WHERE organization_id = $1
         AND custom_status_label IS NOT NULL
         AND deleted_at IS NULL
       GROUP BY custom_status_label
       ORDER BY count DESC, custom_status_label ASC
       LIMIT 50`,
      [orgId],
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET /api/inventory/custom-labels]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
