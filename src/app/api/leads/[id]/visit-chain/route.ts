// api/leads/[id]/visit-chain/route.ts
//
// Returns the full visit chain for a lead — all historical visits in order,
// from the original (visit 1) through to the current (visit N).
//
// Authorization:
//   Admin / Site Head:       always allowed
//   Assigned Sales Manager:  allowed (assigned_to_user_id must match session)
//   All others:              403
//
// Security:
//   - No phone numbers returned. Chain entries carry only non-sensitive
//     metadata (leadId, date, assigned name, status, classification).
//   - Tenant-scoped: the recursive CTE guards against cross-org traversal.
//   - Cycle and depth guards are in getLeadVisitChain.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { getLeadVisitChain } from "@/lib/visitChain";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const { id } = await params;
    const leadId = parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json(
        { success: false, message: "Invalid lead id." },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();

    // Fetch the lead (tenant-scoped) — needed both for existence check and SM authorization.
    const rows = await query(
      `SELECT id, assigned_to, assigned_to_user_id
       FROM walkin_enquiries WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [leadId, orgId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 }
      );
    }

    // Authorization: Admin/Site Head always; assigned SM allowed; all others denied.
    const role = normalizeRole(session.role);
    const isAdmin = role === "admin";
    const isSiteHead = role === "site head";

    if (!isAdmin && !isSiteHead) {
      const current = rows[0];
      const sessionUserId = getSessionUserId(session);
      const isAssignedSM = current.assigned_to_user_id != null && sessionUserId != null
        ? Number(current.assigned_to_user_id) === sessionUserId
        : session.name === current.assigned_to;

      if (!isAssignedSM) {
        return NextResponse.json(
          { success: false, message: "Forbidden." },
          { status: 403 }
        );
      }
    }

    const result = await getLeadVisitChain(leadId, orgId);

    return NextResponse.json({
      success: true,
      totalVisits: result.totalVisits,
      revisitCount: result.revisitCount,
      currentVisitNumber: result.currentVisitNumber,
      visits: result.visits,
    });
  } catch (error: any) {
    console.error("GET visit-chain Error:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
