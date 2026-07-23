// app/api/inventory/bulk-generate/route.ts
// Commit the (already previewed & edited) matrix from the bulk building generator.
// Idempotent per row via ON CONFLICT DO NOTHING against the partial unique index —
// rows that collide with an existing unit (or a duplicate earlier in the same
// batch) are skipped and reported, the rest are inserted. source = 'bulk_generated'.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";

export const dynamic = "force-dynamic";

function isInventoryManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager"].includes(clean);
}

const cleanNum = (v: any) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? null : n;
};

const MANUAL_STATUSES = ["available", "blocked", "refuge_area", "unfinished"];
const MAX_UNITS = 2000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_name, user_role, units } = body;

    if (!user_name || !user_role)
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    if (!isInventoryManager(user_role))
      return NextResponse.json({ success: false, message: "Only Admin and Sales Managers can generate units." }, { status: 403 });
    if (!Array.isArray(units) || units.length === 0)
      return NextResponse.json({ success: false, message: "No units to create." }, { status: 400 });
    if (units.length > MAX_UNITS)
      return NextResponse.json({ success: false, message: `Too many units (${units.length}). Max ${MAX_UNITS} per batch.` }, { status: 400 });

    const result = await transaction(async (client) => {
      let created = 0;
      const skipped: { flat_no: string; reason: string }[] = [];

      for (const u of units) {
        const apartment_name = String(u.apartment_name || "").trim();
        const project_name = String(u.project_name || "").trim();
        const tower = String(u.tower || "").trim();
        const unit_type = String(u.unit_type || "").trim();
        const flat_no = String(u.flat_no || "").trim();
        const wing = u.wing ? String(u.wing).trim() : null;
        const floor = u.floor === "" || u.floor == null ? NaN : Number(u.floor);
        const carpet = cleanNum(u.carpet_area_sqft);
        let status = String(u.status || "available").toLowerCase().trim();
        if (!MANUAL_STATUSES.includes(status)) status = "available";

        if (!apartment_name || !project_name || !tower || !unit_type || !flat_no || isNaN(floor) || !carpet) {
          skipped.push({ flat_no: flat_no || "(blank)", reason: "missing required fields" });
          continue;
        }

        const ins = await client.query(
          `INSERT INTO inventory_units (
             apartment_name, project_name, tower, wing, unit_type, floor, flat_no,
             carpet_area_sqft, built_up_area_sqft, rate_per_sqft, base_price, facing,
             status, source, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'bulk_generated',$14,$14)
           ON CONFLICT (project_name, tower, COALESCE(wing,''), floor, flat_no) WHERE deleted_at IS NULL
           DO NOTHING
           RETURNING id`,
          [
            apartment_name, project_name, tower, wing, unit_type, floor, flat_no,
            carpet, cleanNum(u.built_up_area_sqft), cleanNum(u.rate_per_sqft),
            cleanNum(u.base_price), u.facing ? String(u.facing).trim() : null,
            status, user_name,
          ],
        );

        if (ins.rows.length) {
          created++;
          await client.query(
            `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
             VALUES ($1, NULL, $2, $3, 'bulk generated')`,
            [ins.rows[0].id, status, user_name],
          );
        } else {
          skipped.push({ flat_no, reason: "already exists" });
        }
      }

      return { created, skipped };
    });

    return NextResponse.json(
      {
        success: true,
        created: result.created,
        skipped: result.skipped.length,
        total: units.length,
        skipped_details: result.skipped,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[POST /api/inventory/bulk-generate]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
