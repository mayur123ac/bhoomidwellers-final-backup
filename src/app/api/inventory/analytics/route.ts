// app/api/inventory/analytics/route.ts
// Sell.Do parity, gap 5 — inventory movement, not money.
//
// RevenueIntelligenceView already answers "how much did we collect". This answers
// the different question Sell.Do's inventory reports answer: how much STOCK is
// left, how fast it is moving, and which configurations are actually selling.
//
// Absorption and velocity are derived from inventory_unit_history rather than
// inventory_units.updated_at — updated_at moves on any edit (a price tweak, a
// typo fix), so using it would report edits as sales.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

const SOLD_STATUSES = ["booked", "registered"];

export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");
    const days = Math.min(Math.max(Number(searchParams.get("days") ?? 90), 1), 730);

    const vals: any[] = [];
    // Pushed first so the tenant filter is part of every aggregate below,
    // applied BEFORE grouping rather than to the result.
    vals.push(await getOrganizationId());
    const scope: string[] = ["u.deleted_at IS NULL", `u.organization_id = $${vals.length}`];
    if (projectId) { vals.push(Number(projectId)); scope.push(`u.project_id = $${vals.length}`); }
    const scopeSql = scope.join(" AND ");

    // ── Stock position by status ──
    const byStatus = await query(
      `SELECT u.status, COUNT(*)::int AS count,
              COALESCE(SUM(u.base_price), 0)::numeric AS value
         FROM inventory_units u
        WHERE ${scopeSql}
        GROUP BY u.status ORDER BY count DESC`,
      vals,
    );

    // ── By configuration: what is selling and what is stuck ──
    const byType = await query(
      `SELECT u.unit_type,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE u.status = 'available')::int AS available,
              COUNT(*) FILTER (WHERE u.status = 'on_hold')::int   AS on_hold,
              COUNT(*) FILTER (WHERE u.status IN ('booked','registered'))::int AS sold
         FROM inventory_units u
        WHERE ${scopeSql}
        GROUP BY u.unit_type ORDER BY total DESC`,
      vals,
    );

    // ── By tower ──
    const byTower = await query(
      `SELECT COALESCE(t.name, u.tower) AS tower,
              COALESCE(p.name, u.project_name) AS project,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE u.status = 'available')::int AS available,
              COUNT(*) FILTER (WHERE u.status IN ('booked','registered'))::int AS sold
         FROM inventory_units u
         LEFT JOIN inventory_towers   t ON t.id = u.tower_id
         LEFT JOIN inventory_projects p ON p.id = u.project_id
        WHERE ${scopeSql}
        GROUP BY 1, 2 ORDER BY 2, 1`,
      vals,
    );

    // ── Sales velocity: units that ENTERED a sold status, per week ──
    // Counts transitions INTO booked/registered, not rows in that state, so a
    // unit booked → cancelled → re-booked registers as two sales events, which is
    // what a velocity chart should show.
    const velVals = [...vals, SOLD_STATUSES, days];
    const statusParam = `$${vals.length + 1}`;
    const daysParam = `$${vals.length + 2}`;
    const velocity = await query(
      `SELECT DATE_TRUNC('week', h.changed_at)::date AS week, COUNT(*)::int AS sold
         FROM inventory_unit_history h
         JOIN inventory_units u ON u.id = h.unit_id
        WHERE ${scopeSql}
          AND h.new_status = ANY(${statusParam}::text[])
          AND (h.old_status IS NULL OR h.old_status <> h.new_status)
          AND h.changed_at >= NOW() - (${daysParam}::int * INTERVAL '1 day')
        GROUP BY 1 ORDER BY 1`,
      velVals,
    );

    // ── Headline numbers ──
    const totals = await query<any>(
      `SELECT COUNT(*)::int AS total_units,
              COUNT(*) FILTER (WHERE u.status = 'available')::int AS available,
              COUNT(*) FILTER (WHERE u.status = 'on_hold')::int   AS on_hold,
              COUNT(*) FILTER (WHERE u.status IN ('booked','registered'))::int AS sold,
              COALESCE(SUM(u.base_price) FILTER (WHERE u.status = 'available'), 0)::numeric AS available_value
         FROM inventory_units u
        WHERE ${scopeSql}`,
      vals,
    );
    const t = totals[0] || {};
    const totalUnits = Number(t.total_units || 0);
    const sold = Number(t.sold || 0);

    // ── Ageing: how long available stock has been sitting ──
    const ageing = await query(
      `SELECT
         COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '30 days')::int  AS under_30d,
         COUNT(*) FILTER (WHERE u.created_at <  NOW() - INTERVAL '30 days'
                            AND u.created_at >= NOW() - INTERVAL '90 days')::int  AS d30_90,
         COUNT(*) FILTER (WHERE u.created_at <  NOW() - INTERVAL '90 days')::int  AS over_90d
         FROM inventory_units u
        WHERE ${scopeSql} AND u.status = 'available'`,
      vals,
    );

    // ── Live holds, with their owners (only meaningful since gap 2 was closed) ──
    const holds = await query(
      `SELECT u.id, u.flat_no, u.tower, u.floor, u.held_by, u.hold_expires_at,
              u.held_for_lead_id, w.name AS held_for_lead_name
         FROM inventory_units u
         LEFT JOIN walkin_enquiries w
                ON w.id = u.held_for_lead_id AND w.organization_id = u.organization_id
        WHERE ${scopeSql} AND u.status = 'on_hold'
        ORDER BY u.hold_expires_at ASC NULLS LAST
        LIMIT 100`,
      vals,
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          totals: {
            total_units: totalUnits,
            available: Number(t.available || 0),
            on_hold: Number(t.on_hold || 0),
            sold,
            available_value: Number(t.available_value || 0),
            // Absorption = share of stock sold. Guarded so an empty project
            // reports 0 rather than NaN.
            absorption_pct: totalUnits > 0 ? Math.round((sold / totalUnits) * 1000) / 10 : 0,
          },
          by_status: byStatus,
          by_unit_type: byType,
          by_tower: byTower,
          velocity,
          ageing: ageing[0] || { under_30d: 0, d30_90: 0, over_90d: 0 },
          active_holds: holds,
          window_days: days,
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[GET /api/inventory/analytics]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
