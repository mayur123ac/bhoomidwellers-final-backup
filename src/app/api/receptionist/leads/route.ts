import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { batchGetVisitDepths } from "@/lib/visitChain";
import { resolvePhones } from "@/lib/phoneAccess";

// GET /api/receptionist/leads?name=Receptionist
export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // Identity comes from the signed session, not from the query string.
    const sessionUserId = getSessionUserId(gate.session);
    const sessionName = String(gate.session.name ?? "").trim();

    const orgId = await getOrganizationId();

    // ID-first: match on assigned_receptionist_user_id when set;
    // fall back to name for rows created before the FK migration.
    const rows = await query(
      `SELECT * FROM walkin_enquiries
       WHERE (
         assigned_receptionist_user_id = $1
         OR (assigned_receptionist_user_id IS NULL AND LOWER(TRIM(assigned_receptionist)) = LOWER(TRIM($2)))
       )
       AND organization_id = $3
       ORDER BY created_at DESC`,
      [sessionUserId, sessionName, orgId]
    );

    // Attach visitNumber — single batch CTE, no N+1.
    const actor = {
      _id: gate.session._id ?? (gate.session as any).id,
      name: gate.session.name,
      role: gate.session.role,
    };
    const leadIds = rows.map((r: any) => r.id as number);
    const [securedRows, visitDepths] = await Promise.all([
      resolvePhones(actor, rows, "LEAD_PHONE", orgId, ["phone", "alt_phone"]),
      batchGetVisitDepths(leadIds, orgId),
    ]);
    const rowsWithVisits = securedRows.map((r: any) => ({
      ...r,
      visitNumber: visitDepths.get(r.id) ?? 1,
    }));

    return NextResponse.json({ success: true, data: rowsWithVisits, total: rowsWithVisits.length }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
