// app/api/v1/inventory/units/route.ts — read unit availability.
//
// The likeliest real use of this whole API: a website or a portal feed asking
// "what is available in Tower B". So it defaults to excluding soft-deleted rows
// and supports the three filters that question actually needs.
//
// `held_by` / `hold_reason` / `created_by` / `updated_by` are omitted — who
// inside the company is holding a unit, and why, is internal. `status` already
// tells an external caller everything they need (available / held / booked).

import { withApiKey } from "@/lib/apiV1";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const COLUMNS = `
  id, project_name, tower, wing, unit_type, floor, flat_no,
  carpet_area_sqft, built_up_area_sqft, rate_per_sqft, base_price,
  facing, status, is_corner, is_park_facing, parking_slots,
  hold_expires_at, created_at, updated_at
`;

export const GET = withApiKey("/api/v1/inventory/units", "inventory:read", async (ctx) => {
  const status = ctx.searchParams.get("status");
  const project = ctx.searchParams.get("project");
  const tower = ctx.searchParams.get("tower");

  // inventory_units DOES have deleted_at (unlike walkin_enquiries) — inventory
  // deletion is soft, via lib/inventoryDelete.ts, so deleted rows are real rows
  // that must be excluded rather than absent ones.
  const where: string[] = ["deleted_at IS NULL"];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (project) {
    params.push(project);
    where.push(`project_name = $${params.length}`);
  }
  if (tower) {
    params.push(tower);
    where.push(`tower = $${params.length}`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rows = await query(
    `SELECT ${COLUMNS}
       FROM inventory_units
       ${whereSql}
      ORDER BY project_name, tower, floor, flat_no
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ctx.limit, ctx.offset]
  );

  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM inventory_units ${whereSql}`,
    params
  );

  // A per-status tally, because the caller asking "what is available" almost
  // always also wants "out of how many" and would otherwise page the whole
  // table to compute it.
  const summary = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
       FROM inventory_units
      WHERE deleted_at IS NULL
      GROUP BY status`,
    []
  );

  return {
    data: rows,
    meta: {
      total: Number(totalRows[0]?.count ?? 0),
      countsByStatus: Object.fromEntries(summary.map((r) => [r.status, Number(r.count)])),
    },
  };
});
