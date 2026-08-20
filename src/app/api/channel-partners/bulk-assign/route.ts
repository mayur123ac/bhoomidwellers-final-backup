// api/channel-partners/bulk-assign/route.ts
//
// Assign many partners to one Sourcing Manager in a single action.
//
// Exists because the per-partner PATCH is the wrong shape for the job it is
// actually needed for: a registry built up before ownership existed arrives
// entirely unassigned, and dividing it between managers one dialog at a time is
// how it stays unassigned. This is also the honest way to hand over a manager's
// book when they leave.
//
// Admin only, matching /api/cp-enquiries/[id]/assign. A Sourcing Manager cannot
// claim partners or push their own book onto someone else, and a Sales Manager
// owns commercial terms rather than territory.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession } from "@/lib/serverAuth";
import { canAssignPartners } from "@/lib/cpRbac";
import { parseAssignee, isActiveSourcingManager } from "@/lib/sourcingAssignment";

export const dynamic = "force-dynamic";

/** Guards against a runaway or hand-rolled request rewriting the whole registry. */
const MAX_IDS = 500;

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!canAssignPartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Only an Admin can assign channel partners.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const ids = Array.isArray(body.partner_ids)
      ? [...new Set(body.partner_ids.map((v: any) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0))]
      : [];

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, message: "Select at least one channel partner.", code: "NO_PARTNERS" },
        { status: 400 }
      );
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { success: false, message: `Too many partners in one request (max ${MAX_IDS}).`, code: "TOO_MANY" },
        { status: 400 }
      );
    }

    const assignee = parseAssignee(body.assigned_sourcing_manager_id);
    if (assignee.kind === "invalid" || assignee.kind === "absent") {
      return NextResponse.json(
        {
          success: false,
          message: "assigned_sourcing_manager_id must be a Sourcing Manager's user id, or null to unassign.",
          code: "INVALID_SOURCING_MANAGER",
        },
        { status: 400 }
      );
    }
    if (assignee.kind === "id" && !(await isActiveSourcingManager(assignee.id))) {
      return NextResponse.json(
        { success: false, message: "That user is not an active Sourcing Manager.", code: "INVALID_SOURCING_MANAGER" },
        { status: 400 }
      );
    }

    const target = assignee.kind === "id" ? assignee.id : null;
    const actor = (session.name || "system").toString();

    const rows = await transaction(async (client) => {
      // Timestamp and actor move only for partners whose owner actually changes, so
      // re-running the same assignment does not restamp rows that were already correct.
      const res = await client.query(
        `UPDATE channel_partners
            SET assigned_sourcing_manager_id = $1::int,
                assigned_sourcing_manager_at = CASE
                  WHEN $1::int IS NULL THEN NULL
                  WHEN assigned_sourcing_manager_id IS DISTINCT FROM $1::int THEN now()
                  ELSE assigned_sourcing_manager_at END,
                assigned_sourcing_manager_by = CASE
                  WHEN $1::int IS NULL THEN NULL
                  WHEN assigned_sourcing_manager_id IS DISTINCT FROM $1::int THEN $2
                  ELSE assigned_sourcing_manager_by END,
                updated_by = $2
          WHERE id = ANY($3::int[]) AND organization_id = $4
          RETURNING id, name, assigned_sourcing_manager_id`,
        [target, actor, ids, await getOrganizationId(client)]
      );
      return res.rows;
    });

    const missing = ids.filter((id) => !rows.some((r: any) => r.id === id));

    return NextResponse.json(
      {
        success: true,
        updated: rows.length,
        // Reported rather than swallowed: a partner deleted between loading the
        // list and hitting Assign should not look like a silent success.
        notFound: missing,
        message: target === null
          ? `${rows.length} partner${rows.length === 1 ? "" : "s"} unassigned.`
          : `${rows.length} partner${rows.length === 1 ? "" : "s"} assigned.`,
        data: rows,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[POST /api/channel-partners/bulk-assign]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
