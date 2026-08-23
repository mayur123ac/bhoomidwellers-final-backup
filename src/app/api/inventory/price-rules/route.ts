// app/api/inventory/price-rules/route.ts
// Sell.Do parity, gap 3 — the layered price lives on a rule, not on each unit.
//
// A rule is scoped project-wide (tower_id NULL) or to one tower, and optionally
// to one configuration. Rules are versioned by effective_from and never edited
// in place: a cost sheet issued last month has to keep explaining itself with
// last month's numbers, so a rate change is a NEW row, not an UPDATE.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

const numOr0 = (v: any) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * The rule that applies to a unit, most specific first.
 *
 * Precedence: tower+type → tower → project+type → project. Within the winners,
 * the newest effective_from that is not in the future. Exposed so the cost-sheet
 * route resolves rules exactly the way this endpoint reports them.
 */
export const RESOLVE_RULE_SQL = `
  SELECT * FROM inventory_price_rules
   WHERE is_active
     AND project_id = $1
     AND (tower_id IS NULL OR tower_id = $2)
     AND (unit_type IS NULL OR LOWER(TRIM(unit_type)) = LOWER(TRIM($3)))
     AND effective_from <= CURRENT_DATE
   ORDER BY (tower_id IS NOT NULL) DESC,
            (unit_type IS NOT NULL) DESC,
            effective_from DESC,
            id DESC
   LIMIT 1`;

// ─── GET — list rules ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    // TENANT: $1. Price rules are commercially sensitive — rate per sqft, floor
    // rise, premiums — and this endpoint returned every organization's, joined to
    // their building and tower names. `project_id` is caller-supplied, so the
    // predicate is on the rule itself, not just on the filter.
    const vals: any[] = [await getOrganizationId()];
    const where: string[] = ["r.is_active", "r.organization_id = $1", "p.organization_id = $1"];
    const projectId = searchParams.get("project_id");
    if (projectId) { vals.push(Number(projectId)); where.push(`r.project_id = $${vals.length}`); }

    const rows = await query(
      `SELECT r.*, p.name AS project_name, t.name AS tower_name
         FROM inventory_price_rules r
         JOIN inventory_projects p ON p.id = r.project_id
         LEFT JOIN inventory_towers t
                ON t.id = r.tower_id AND t.organization_id = r.organization_id
        WHERE ${where.join(" AND ")}
        ORDER BY p.name, t.name NULLS FIRST, r.effective_from DESC`,
      vals,
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/price-rules]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create a rule version ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // Pricing is a commercial decision; Sales Manager can set it, same as they
    // can create inventory. Anything narrower would put Admin in every rate change.
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const projectId = Number(body.project_id);
    if (!projectId || !Number.isFinite(projectId)) {
      return NextResponse.json({ success: false, message: "project_id is required." }, { status: 400 });
    }

    // TENANT: project_id is caller-supplied and the INSERT below inherits
    // organization_id FROM that project, so an unchecked id would have written a
    // pricing rule into another builder's project — and their cost sheets resolve
    // rules by project_id.
    const ruleOrgId = await getOrganizationId();
    const ruleProject = await query(
      `SELECT id FROM inventory_projects
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [projectId, ruleOrgId]);
    if (!ruleProject.length) {
      return NextResponse.json({ success: false, message: "Project not found." }, { status: 404 });
    }

    const base = numOr0(body.base_rate_per_sqft);
    if (base <= 0) {
      return NextResponse.json(
        { success: false, message: "base_rate_per_sqft must be greater than zero." },
        { status: 400 },
      );
    }

    // Percentages are bounded so a typo ("50" meaning ₹50 into a % field) cannot
    // silently add a 50% premium to every unit in the tower.
    for (const k of ["corner_premium_pct", "park_facing_premium_pct"]) {
      const v = numOr0(body[k]);
      if (v < 0 || v > 100) {
        return NextResponse.json({ success: false, message: `${k} must be between 0 and 100.` }, { status: 400 });
      }
    }
    for (const k of ["gst_rate", "stamp_duty_rate"]) {
      const v = body[k] === undefined ? null : numOr0(body[k]);
      if (v !== null && (v < 0 || v > 100)) {
        return NextResponse.json({ success: false, message: `${k} must be between 0 and 100.` }, { status: 400 });
      }
    }

    const actor = gate.session.name || "system";
    const rows = await query(
      `INSERT INTO inventory_price_rules (
         project_id, tower_id, unit_type,
         base_rate_per_sqft, floor_rise_per_sqft, floor_rise_from_floor, floor_rise_max_per_sqft,
         corner_premium_pct, park_facing_premium_pct,
         club_fee, corpus_fund, legal_charges, maintenance_deposit, parking_charge_per_slot,
         gst_rate, stamp_duty_rate, registration_fee,
         effective_from, created_by, updated_by, organization_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 COALESCE($18::date, CURRENT_DATE), $19, $19,
                 (SELECT organization_id FROM inventory_projects WHERE id = $1))
       RETURNING *`,
      [
        projectId,
        body.tower_id ? Number(body.tower_id) : null,
        body.unit_type ? String(body.unit_type).trim() : null,
        base,
        numOr0(body.floor_rise_per_sqft),
        numOr0(body.floor_rise_from_floor),
        body.floor_rise_max_per_sqft === "" || body.floor_rise_max_per_sqft == null
          ? null : numOr0(body.floor_rise_max_per_sqft),
        numOr0(body.corner_premium_pct),
        numOr0(body.park_facing_premium_pct),
        numOr0(body.club_fee),
        numOr0(body.corpus_fund),
        numOr0(body.legal_charges),
        numOr0(body.maintenance_deposit),
        numOr0(body.parking_charge_per_slot),
        body.gst_rate === undefined ? 5 : numOr0(body.gst_rate),
        body.stamp_duty_rate === undefined ? 6 : numOr0(body.stamp_duty_rate),
        body.registration_fee === undefined ? 30000 : numOr0(body.registration_fee),
        body.effective_from || null,
        actor,
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory/price-rules]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
