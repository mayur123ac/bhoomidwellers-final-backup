// app/api/inventory/offers/route.ts
// Sell.Do parity, gap 4 — negotiation with discount-approval bands.
//
// Sell.Do's phrasing is the design brief: discount approvals "follow defined
// bands and are documented on record rather than merely memorised". So the band
// is resolved server-side at request time and FROZEN onto the offer. Re-deriving
// it at decision time would silently re-band an old offer whenever the ladder is
// retuned, which is exactly the memorised-rule problem this replaces.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { resolveApprovalBand } from "@/lib/inventoryPricing";

export const dynamic = "force-dynamic";

const num = (v: any) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ─── GET — offers, filterable by unit / lead / status ────────────────────────
export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const where: string[] = [];
    const vals: any[] = [];

    // Tenant filter joins the dynamic clause list so it is applied inside the
    // query, before ORDER BY and LIMIT.
    vals.push(await getOrganizationId());
    where.push(`o.organization_id = $${vals.length}`);
    for (const [param, col] of [["unit_id", "o.unit_id"], ["lead_id", "o.lead_id"]] as const) {
      const v = searchParams.get(param);
      if (v) { vals.push(Number(v)); where.push(`${col} = $${vals.length}`); }
    }
    const status = searchParams.get("status");
    if (status) { vals.push(status); where.push(`o.status = $${vals.length}`); }

    const rows = await query(
      `SELECT o.*, u.flat_no, u.tower, u.floor, u.project_name, w.name AS lead_name
         FROM inventory_offers o
         JOIN inventory_units u ON u.id = o.unit_id
         LEFT JOIN walkin_enquiries w
                ON w.id = o.lead_id AND w.organization_id = o.organization_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY o.requested_at DESC
        LIMIT 300`,
      vals,
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/offers]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — raise an offer for approval ──────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const unitId = Number(body.unit_id);
    if (!unitId || !Number.isFinite(unitId)) {
      return NextResponse.json({ success: false, message: "unit_id is required." }, { status: 400 });
    }

    const units = await query<any>(
      `SELECT id, flat_no, status, booking_id FROM inventory_units WHERE id = $1 AND deleted_at IS NULL`,
      [unitId],
    );
    if (!units.length) {
      return NextResponse.json({ success: false, message: "Unit not found." }, { status: 404 });
    }
    const unit = units[0];
    if (unit.booking_id != null) {
      return NextResponse.json(
        { success: false, message: `Flat ${unit.flat_no} is already booked — no offer can be raised.` },
        { status: 409 },
      );
    }

    const listPrice = num(body.list_price);
    const offered = num(body.offered_price);
    if (listPrice <= 0 || offered <= 0) {
      return NextResponse.json(
        { success: false, message: "list_price and offered_price must both be greater than zero." },
        { status: 400 },
      );
    }
    if (offered > listPrice) {
      return NextResponse.json(
        { success: false, message: "Offered price cannot exceed the list price." },
        { status: 400 },
      );
    }

    const discountAmount = listPrice - offered;
    const discountPct = Math.round((discountAmount / listPrice) * 100000) / 1000;

    // Project-specific bands win over the global ladder (project_id NULL).
    const bands = await query<any>(
      `SELECT * FROM inventory_discount_bands
        WHERE is_active AND (project_id IS NULL OR project_id = $1)
        ORDER BY (project_id IS NOT NULL) DESC, max_discount_pct ASC`,
      [body.project_id ? Number(body.project_id) : null],
    );

    let requiredRole: string | null = null;
    if (discountPct > 0) {
      const band = resolveApprovalBand(bands, discountPct);
      if (!band) {
        // Fail closed. An unmatched discount must never read as "no approval needed".
        return NextResponse.json(
          {
            success: false,
            message: `No approval band covers a ${discountPct}% discount. Ask an Admin to define one.`,
            code: "NO_APPROVAL_BAND",
          },
          { status: 409 },
        );
      }
      requiredRole = band.approver_role;
    }

    const actor = gate.session.name || "system";
    const rows = await query(
      `INSERT INTO inventory_offers (
         unit_id, lead_id, cost_sheet_id, list_price, offered_price,
         discount_amount, discount_pct, status, required_approver_role,
         requested_by, valid_until, remarks, organization_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 (SELECT organization_id FROM inventory_units WHERE id = $1))
       RETURNING *`,
      [
        unitId,
        body.lead_id == null || body.lead_id === "" ? null : Number(body.lead_id),
        body.cost_sheet_id == null || body.cost_sheet_id === "" ? null : Number(body.cost_sheet_id),
        listPrice, offered, discountAmount, discountPct,
        // A zero-discount offer is at list price and needs nobody's sign-off.
        discountPct > 0 ? "pending" : "approved",
        requiredRole,
        actor,
        body.valid_until || null,
        body.remarks ? String(body.remarks).trim() : null,
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory/offers]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
