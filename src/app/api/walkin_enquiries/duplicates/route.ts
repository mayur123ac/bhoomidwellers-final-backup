// app/api/walkin_enquiries/duplicates/route.ts
// Returns groups of leads that share the same normalized (last-10-digit) phone number.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRole } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requireRole([
      "admin",
      "site_head",
      "site head",
      "sales_manager",
      "sales manager",
    ]);
    if (!auth.isAuthorized) {
      return NextResponse.json(
        { success: false, message: auth.error },
        { status: auth.status }
      );
    }

    const rows = await query<{
      norm_phone: string;
      lead_ids: number[];
      cnt: number;
    }>(
      `SELECT RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) AS norm_phone,
              array_agg(id) AS lead_ids,
              count(*)::int AS cnt
       FROM walkin_enquiries
       WHERE phone IS NOT NULL AND phone <> ''
         AND organization_id = $1
       GROUP BY norm_phone
       HAVING count(*) > 1`,
      [await getOrganizationId()]
    );

    const duplicateGroups = rows.map((r) => ({
      normPhone: r.norm_phone,
      leadIds: (r.lead_ids || []).map((id) => Number(id)),
      count: r.cnt,
    }));

    // Flat union of every duplicate lead id, for a Set on the client.
    const allDuplicateLeadIds = Array.from(
      new Set(duplicateGroups.flatMap((g) => g.leadIds))
    );

    return NextResponse.json(
      { success: true, duplicateGroups, allDuplicateLeadIds },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[GET /api/walkin_enquiries/duplicates]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
