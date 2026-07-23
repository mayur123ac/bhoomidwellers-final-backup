// app/api/inventory/route.ts
// Inventory Management — list (filters + pagination) and manual single create.
// Tables (inventory_units, inventory_unit_history) are created manually in pgAdmin
// (see /inventory_schema.sql); this route assumes they already exist.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";

export const dynamic = "force-dynamic";

// Add / delete / bulk-generate are Admin / Sales Manager only (spec §5 RBAC).
// View + filter stay open to all roles, so GET is not gated.
function isInventoryManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager"].includes(clean);
}

const cleanNum = (v: any) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? null : n;
};

// Statuses a human may set at creation time. booked/registered are sync-only;
// on_hold is driven by the hold flow (needs an expiry); cancelled comes from a
// booking cancellation.
const MANUAL_CREATE_STATUSES = ["available", "blocked", "refuge_area", "unfinished"];

const SORTABLE = new Set([
  "tower", "wing", "floor", "flat_no", "status", "unit_type",
  "base_price", "carpet_area_sqft", "created_at", "updated_at",
]);

// Lazily self-heal expired holds so a stale on_hold never blocks a unit even
// without a cron job (spec §2). Cheap — touches only the expired rows.
async function revertExpiredHolds() {
  const expired = await query<{ id: number }>(
    `UPDATE inventory_units
        SET status = 'available', hold_expires_at = NULL, updated_at = NOW()
      WHERE status = 'on_hold' AND hold_expires_at IS NOT NULL
        AND hold_expires_at < NOW() AND deleted_at IS NULL
      RETURNING id`,
  );
  for (const r of expired) {
    await query(
      `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
       VALUES ($1, 'on_hold', 'available', 'System', 'hold expired')`,
      [r.id],
    );
  }
}

// ─── GET — list units (filters + pagination) ──────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await revertExpiredHolds();
    const { searchParams } = new URL(req.url);

    const where: string[] = ["deleted_at IS NULL"];
    const vals: any[] = [];
    const push = (v: any) => { vals.push(v); return `$${vals.length}`; };

    for (const [param, col] of [
      ["project_name", "project_name"],
      ["tower", "tower"],
      ["wing", "wing"],
      ["unit_type", "unit_type"],
      ["status", "status"],
    ] as const) {
      const v = searchParams.get(param);
      if (v) where.push(`${col} = ${push(v)}`);
    }

    const floor = searchParams.get("floor");
    if (floor !== null && floor !== "") where.push(`floor = ${push(Number(floor))}`);

    const minArea = searchParams.get("min_area");
    if (minArea) where.push(`carpet_area_sqft >= ${push(Number(minArea))}`);
    const maxArea = searchParams.get("max_area");
    if (maxArea) where.push(`carpet_area_sqft <= ${push(Number(maxArea))}`);

    const search = searchParams.get("search");
    if (search) {
      const p = push(`%${search}%`);
      where.push(`(flat_no ILIKE ${p} OR apartment_name ILIKE ${p} OR project_name ILIKE ${p})`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const sortBy = searchParams.get("sort_by") || "";
    const sortDir = (searchParams.get("sort_dir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
    const orderSql = SORTABLE.has(sortBy)
      ? `ORDER BY ${sortBy} ${sortDir} NULLS LAST, id ASC`
      : `ORDER BY tower ASC, wing ASC NULLS FIRST, floor ASC, flat_no ASC`;

    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

    const countRows = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM inventory_units ${whereSql}`, vals,
    );
    const total = countRows[0]?.count ?? 0;

    const limP = push(limit);
    const offP = push(offset);
    const rows = await query(
      `SELECT * FROM inventory_units ${whereSql} ${orderSql} LIMIT ${limP} OFFSET ${offP}`,
      vals,
    );

    return NextResponse.json({ success: true, data: rows, total, limit, offset }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — manual single create ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_name, user_role } = body;

    if (!user_name || !user_role)
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    if (!isInventoryManager(user_role))
      return NextResponse.json({ success: false, message: "Only Admin and Sales Managers can add units." }, { status: 403 });

    for (const f of ["apartment_name", "project_name", "tower", "unit_type", "flat_no"]) {
      if (!body[f] || !String(body[f]).trim())
        return NextResponse.json({ success: false, message: `${f.replace(/_/g, " ")} is required` }, { status: 400 });
    }
    if (body.floor === null || body.floor === undefined || body.floor === "")
      return NextResponse.json({ success: false, message: "floor is required" }, { status: 400 });
    const carpet = cleanNum(body.carpet_area_sqft);
    if (carpet === null)
      return NextResponse.json({ success: false, message: "carpet area (sqft) is required" }, { status: 400 });

    const status = String(body.status || "available").toLowerCase().trim();
    if (!MANUAL_CREATE_STATUSES.includes(status))
      return NextResponse.json(
        { success: false, message: `Status "${status}" cannot be set manually. Allowed: ${MANUAL_CREATE_STATUSES.join(", ")}.` },
        { status: 400 },
      );

    const wing = body.wing ? String(body.wing).trim() : null;
    const floor = Number(body.floor);
    const flatNo = String(body.flat_no).trim();
    const tower = String(body.tower).trim();
    const project = String(body.project_name).trim();

    // Friendly duplicate check (mirrors the unique index; nicer than a raw 23505).
    const dup = await query(
      `SELECT id FROM inventory_units
        WHERE project_name = $1 AND tower = $2 AND COALESCE(wing,'') = COALESCE($3,'')
          AND floor = $4 AND flat_no = $5 AND deleted_at IS NULL
        LIMIT 1`,
      [project, tower, wing, floor, flatNo],
    );
    if (dup.length)
      return NextResponse.json(
        { success: false, message: `Unit ${flatNo} already exists in ${tower}${wing ? "/" + wing : ""}, floor ${floor}.` },
        { status: 409 },
      );

    const created = await transaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO inventory_units (
           apartment_name, project_name, tower, wing, unit_type, floor, flat_no,
           carpet_area_sqft, built_up_area_sqft, rate_per_sqft, base_price, facing,
           status, source, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',$14,$14)
         RETURNING *`,
        [
          String(body.apartment_name).trim(), project, tower, wing,
          String(body.unit_type).trim(), floor, flatNo,
          carpet, cleanNum(body.built_up_area_sqft), cleanNum(body.rate_per_sqft),
          cleanNum(body.base_price), body.facing ? String(body.facing).trim() : null,
          status, user_name,
        ],
      );
      const unit = ins.rows[0];
      await client.query(
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
         VALUES ($1, NULL, $2, $3, 'unit created (manual)')`,
        [unit.id, status, user_name],
      );
      return unit;
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory]", err);
    if (err?.code === "23505")
      return NextResponse.json({ success: false, message: "A unit with these details already exists." }, { status: 409 });
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
