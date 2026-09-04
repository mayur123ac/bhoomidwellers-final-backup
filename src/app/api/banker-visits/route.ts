// api/banker-visits/route.ts — Banker visit records, role-scoped.
//
// POST: Receptionist or Admin creates a banker visit.
// GET:  Sales Manager sees only visits assigned to them.
//       Admin/Receptionist sees all visits for their organization.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { normalizeRole } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

const CREATE_ROLES = ["receptionist", "admin"];
const VIEW_ROLES = ["receptionist", "admin", "sales manager"];

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const role = normalizeRole(gate.session.role);
  if (!CREATE_ROLES.includes(role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot create banker visits." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const orgId = await getOrganizationId();

    // Required fields
    const bankerName = (body.banker_name || "").toString().trim();
    const contactNumber = (body.contact_number || "").toString().trim();
    const bankName = (body.bank_name || "").toString().trim();
    const branchName = (body.branch_name || "").toString().trim();
    const designation = (body.designation || "").toString().trim();

    if (!bankerName || !contactNumber || !bankName || !branchName || !designation) {
      return NextResponse.json(
        { success: false, message: "Banker Name, Contact Number, Bank Name, Branch Name, and Designation are required." },
        { status: 400 }
      );
    }

    // Optional
    const reportingManager = (body.reporting_manager || "").toString().trim() || null;

    // Sales Manager assignment (optional, validated server-side)
    let assignedSalesManagerId: number | null = null;
    const rawSmId = body.assigned_sales_manager_id;
    if (rawSmId !== undefined && rawSmId !== null && rawSmId !== "") {
      const smId = Number(rawSmId);
      if (!Number.isInteger(smId)) {
        return NextResponse.json(
          { success: false, message: "assigned_sales_manager_id must be a valid user id." },
          { status: 400 }
        );
      }
      const check = await query(
        `SELECT id FROM users
          WHERE id = $1
            AND organization_id = $2
            AND is_active = true
            AND REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sales manager'
          LIMIT 1`,
        [smId, orgId]
      );
      if (check.length === 0) {
        return NextResponse.json(
          { success: false, message: "Selected user is not an active Sales Manager in your organization." },
          { status: 400 }
        );
      }
      assignedSalesManagerId = smId;
    }

    // Attended by: defaults to the authenticated user, but the receptionist can
    // override the name when a colleague attended instead.
    const attendedById = Number(gate.session._id);
    const attendedByName = (body.attended_by_name || "").toString().trim() || (gate.session.name || "system").toString();
    if (!Number.isInteger(attendedById)) {
      return NextResponse.json(
        { success: false, message: "Could not determine the attending user." },
        { status: 400 }
      );
    }

    const rows = await query(
      `INSERT INTO banker_visits
         (organization_id, banker_name, contact_number, bank_name, branch_name,
          designation, reporting_manager, assigned_sales_manager_id,
          attended_by_id, attended_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        orgId,
        bankerName,
        contactNumber,
        bankName,
        branchName,
        designation,
        reportingManager,
        assignedSalesManagerId,
        attendedById,
        attendedByName,
      ]
    );

    return NextResponse.json(
      { success: true, data: rows[0], message: "Banker visit recorded." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/banker-visits]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const role = normalizeRole(gate.session.role);
  if (!VIEW_ROLES.includes(role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot view banker visits." },
      { status: 403 }
    );
  }

  try {
    const orgId = await getOrganizationId();
    const params: any[] = [orgId];
    const where = ["bv.organization_id = $1"];

    // Sales Manager: forced scope, no query param override
    if (role === "sales manager") {
      params.push(Number(gate.session._id));
      where.push(`bv.assigned_sales_manager_id = $${params.length}`);
    }

    const rows = await query(
      `SELECT bv.*,
              sm.name AS sales_manager_name,
              sm.username AS sales_manager_username
         FROM banker_visits bv
         LEFT JOIN users sm
           ON sm.id = bv.assigned_sales_manager_id
          AND sm.organization_id = bv.organization_id
        WHERE ${where.join(" AND ")}
        ORDER BY bv.created_at DESC`,
      params
    );

    return NextResponse.json(
      { success: true, data: rows, count: rows.length, scopedToSelf: role === "sales manager" },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/banker-visits]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
