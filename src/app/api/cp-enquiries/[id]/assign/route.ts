// api/cp-enquiries/[id]/assign/route.ts — reassign the Sourcing Manager.
//
// Admin only. The Receptionist sets the assignment once at enquiry creation and can
// never change it afterwards (Part 7), and a Sourcing Manager cannot reassign work
// away from themselves — so this is the single mutation path, gated on the session
// cookie rather than on anything the client sends.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { CP_SOURCE_VALUES } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (normalizeRole(session.role) !== "admin") {
    return NextResponse.json(
      { success: false, message: "Only Admins can reassign the Sourcing Manager.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return NextResponse.json({ success: false, message: "Invalid enquiry id." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const raw = body.sourcing_manager_id;
    const smId = Number(raw);

    if (!Number.isInteger(smId)) {
      return NextResponse.json(
        { success: false, message: "sourcing_manager_id must be an active Sourcing Manager id." },
        { status: 400 }
      );
    }

    // Verify the target is actually an active Sourcing Manager. Without this an
    // Admin could park a CP enquiry on a Receptionist or a deactivated account,
    // and it would then be invisible on every Sourcing Manager dashboard.
    const check = await query(
      // smId arrives in the request body. Without the organization predicate an
      // admin could assign the enquiry to a Sourcing Manager in another tenant,
      // who would then see this partner's details on their dashboard.
      `SELECT id FROM users
        WHERE id = $1
          AND organization_id = $2
          AND is_active = true
          AND REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sourcing manager'`,
      [smId, await getOrganizationId()]
    );
    if (check.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "That user is not an active Sourcing Manager.",
          code: "INVALID_ASSIGNEE",
        },
        { status: 400 }
      );
    }

    const actorName = (session.name || "system").toString();
    const actorUserIdRaw = Number(session._id ?? session.id);
    const actorUserId = Number.isInteger(actorUserIdRaw) ? actorUserIdRaw : null;

    const result = await transaction(async (client) => {
      // leadId comes from the URL; resolved once on this client and reused by
      // every statement in the transaction.
      const assignOrgId = await getOrganizationId(client);
      const existing = await client.query(
        `SELECT id, source, sourcing_manager_id,
                sourcing_manager_assigned_at, sourcing_manager_assigned_by
           FROM walkin_enquiries
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [leadId, assignOrgId]
      );

      if (existing.rows.length === 0) {
        return { status: "not-found" as const };
      }

      const row = existing.rows[0];
      if (!(CP_SOURCE_VALUES as readonly string[]).includes((row.source || "").trim())) {
        return { status: "not-cp" as const };
      }

      const previousId = row.sourcing_manager_id ?? null;
      if (String(previousId) === String(smId)) {
        return {
          status: "unchanged" as const,
          row: {
            id: leadId,
            sourcing_manager_id: previousId,
            sourcing_manager_assigned_at: row.sourcing_manager_assigned_at,
            sourcing_manager_assigned_by: row.sourcing_manager_assigned_by,
          },
        };
      }

      const rows = await client.query(
        `UPDATE walkin_enquiries
            SET sourcing_manager_id          = $1,
                sourcing_manager_assigned_at = now(),
                sourcing_manager_assigned_by = $2
          WHERE id = $3 AND organization_id = $4
          RETURNING id, sourcing_manager_id, sourcing_manager_assigned_at, sourcing_manager_assigned_by`,
        [smId, actorName, leadId, assignOrgId]
      );

      await client.query(
        `INSERT INTO cp_assignment_history (
           lead_id,
           previous_sourcing_manager_id,
           new_sourcing_manager_id,
           assigned_by_user_id,
           assigned_by_name,
           assigned_by_role,
           action,
           assigned_at,
           organization_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(),
                   (SELECT organization_id FROM walkin_enquiries WHERE id = $1))`,
        [
          leadId,
          previousId,
          smId,
          actorUserId,
          actorName,
          session.role || null,
          previousId === null ? "assigned" : "reassigned",
        ]
      );

      return { status: "updated" as const, row: rows.rows[0] };
    });

    if (result.status === "not-found") {
      return NextResponse.json(
        { success: false, message: `Enquiry ${id} not found.` },
        { status: 404 }
      );
    }

    if (result.status === "not-cp") {
      return NextResponse.json(
        { success: false, message: "This is not a Channel Partner enquiry." },
        { status: 404 }
      );
    }

    if (result.status === "unchanged") {
      return NextResponse.json(
        {
          success: true,
          message: "Sourcing Manager assignment unchanged.",
          data: result.row,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Sourcing Manager reassigned.",
        data: result.row,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[PATCH /api/cp-enquiries/[id]/assign]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
