// app/api/inventory/[id]/cost-sheet/route.ts
// Sell.Do parity, gap 3 — instant, versioned cost sheets for a unit.
//
// GET  → the sheets already issued for this unit (newest first).
// POST → compute a fresh one. `preview: true` computes WITHOUT persisting, which
//        is what the negotiation UI uses while an agent drags the discount around;
//        only an explicit issue writes a row.
//
// Versioning matters here: an issued sheet is a number a customer was quoted.
// Re-issuing supersedes the previous version rather than editing it, so the
// history of what was offered stays intact.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { buildCostSheet } from "@/lib/inventoryPricing";
import { RESOLVE_RULE_SQL } from "../../price-rules/route";

export const dynamic = "force-dynamic";

const UNIT_SQL = `
  SELECT u.*, p.name AS project_label, t.name AS tower_label
    FROM inventory_units u
    LEFT JOIN inventory_projects p ON p.id = u.project_id
    LEFT JOIN inventory_towers   t ON t.id = u.tower_id
   WHERE u.id = $1 AND u.deleted_at IS NULL`;

// ─── GET — issued sheets for this unit ───────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const rows = await query(
      `SELECT cs.*, w.name AS lead_name
         FROM inventory_cost_sheets cs
         LEFT JOIN walkin_enquiries w ON w.id = cs.lead_id
        WHERE cs.unit_id = $1
        ORDER BY cs.version DESC, cs.id DESC`,
      [Number(id)],
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/[id]/cost-sheet]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — compute (and optionally issue) a cost sheet ──────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const preview = body.preview === true;

    const units = await query<any>(UNIT_SQL, [Number(id)]);
    if (!units.length) {
      return NextResponse.json({ success: false, message: "Unit not found." }, { status: 404 });
    }
    const unit = units[0];

    if (!unit.project_id) {
      // Only possible on a unit created before the projects backfill, or one
      // whose project row was removed. Naming the cause beats a null-deref later.
      return NextResponse.json(
        { success: false, message: "This unit is not linked to a project, so no price rule can be resolved." },
        { status: 409 },
      );
    }

    const rules = await query<any>(RESOLVE_RULE_SQL, [unit.project_id, unit.tower_id, unit.unit_type]);
    if (!rules.length) {
      return NextResponse.json(
        {
          success: false,
          message: "No active price rule covers this unit. Set one under Inventory → Pricing first.",
          code: "NO_PRICE_RULE",
        },
        { status: 409 },
      );
    }
    const rule = rules[0];

    const sheet = buildCostSheet(unit, rule, {
      discount_amount: body.discount_amount,
      discount_pct: body.discount_pct,
    });

    if (preview) {
      return NextResponse.json(
        { success: true, data: { ...sheet, price_rule_id: rule.id, preview: true } },
        { status: 200 },
      );
    }

    const actor = gate.session.name || "system";
    const saved = await transaction(async (client) => {
      // Lock the unit so two agents issuing at once cannot both claim version N.
      await client.query(`SELECT id FROM inventory_units WHERE id = $1 FOR UPDATE`, [Number(id)]);

      const prev = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS v FROM inventory_cost_sheets WHERE unit_id = $1`,
        [Number(id)],
      );
      const version = Number(prev.rows[0].v) + 1;

      await client.query(
        `UPDATE inventory_cost_sheets SET status = 'superseded'
          WHERE unit_id = $1 AND status = 'issued'`,
        [Number(id)],
      );

      const ins = await client.query(
        `INSERT INTO inventory_cost_sheets (
           unit_id, lead_id, price_rule_id, version,
           carpet_area_sqft, base_rate_per_sqft, base_amount, floor_rise_amount,
           corner_premium, park_premium, parking_charge, agreement_value,
           club_fee, corpus_fund, legal_charges, maintenance_deposit, other_charges_total,
           gst_rate, gst_amount, stamp_duty_rate, stamp_duty_amount, registration_fee,
           discount_amount, discount_pct, total_amount, breakdown,
           status, valid_until, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                   $18,$19,$20,$21,$22,$23,$24,$25,$26,'issued',$27,$28)
         RETURNING *`,
        [
          Number(id),
          body.lead_id == null || body.lead_id === "" ? null : Number(body.lead_id),
          rule.id, version,
          sheet.carpet_area_sqft, sheet.base_rate_per_sqft, sheet.base_amount, sheet.floor_rise_amount,
          sheet.corner_premium, sheet.park_premium, sheet.parking_charge, sheet.agreement_value,
          sheet.club_fee, sheet.corpus_fund, sheet.legal_charges, sheet.maintenance_deposit, sheet.other_charges_total,
          sheet.gst_rate, sheet.gst_amount, sheet.stamp_duty_rate, sheet.stamp_duty_amount, sheet.registration_fee,
          sheet.discount_amount, sheet.discount_pct, sheet.total_amount,
          JSON.stringify(sheet.lines),
          body.valid_until || null,
          actor,
        ],
      );
      return ins.rows[0];
    });

    return NextResponse.json({ success: true, data: saved }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory/[id]/cost-sheet]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: err?.httpStatus || 500 });
  }
}
