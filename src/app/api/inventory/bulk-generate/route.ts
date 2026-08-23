// app/api/inventory/bulk-generate/route.ts
// Commit the (already previewed & edited) matrix from the bulk building generator.
// Idempotent per row via ON CONFLICT DO NOTHING against the partial unique index —
// rows that collide with an existing unit (or a duplicate earlier in the same
// batch) are skipped and reported, the rest are inserted. source = 'bulk_generated'.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { resolveHierarchy } from "@/lib/inventoryHierarchy";

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
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

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
      // MT-05: resolved ONCE, outside the generation loop below — not per unit.
      const orgId = await getOrganizationId(client);
      let created = 0;
      const skipped: { flat_no: string; reason: string }[] = [];

      // A batch is one building, so the project/tower resolve once rather than
      // per row — a 500-unit tower would otherwise issue 1000 redundant lookups.
      const hierarchyCache = new Map<string, { projectId: number | null; towerId: number | null }>();

      for (const u of units) {
        // apartment_name retired — no longer sent, required, or written.
        const project_name = String(u.project_name || "").trim();
        const tower = String(u.tower || "").trim();
        const unit_type = String(u.unit_type || "").trim();
        const flat_no = String(u.flat_no || "").trim();
        const wing = u.wing ? String(u.wing).trim() : null;
        const floor = u.floor === "" || u.floor == null ? NaN : Number(u.floor);
        const carpet = cleanNum(u.carpet_area_sqft);
        let status = String(u.status || "available").toLowerCase().trim();
        if (!MANUAL_STATUSES.includes(status)) status = "available";

        if (!project_name || !tower || !unit_type || !flat_no || isNaN(floor) || !carpet) {
          skipped.push({ flat_no: flat_no || "(blank)", reason: "missing required fields" });
          continue;
        }

        const cacheKey = `${project_name.toLowerCase()}|${tower.toLowerCase()}`;
        if (!hierarchyCache.has(cacheKey)) {
          hierarchyCache.set(cacheKey, await resolveHierarchy(client, project_name, tower, user_name));
        }
        const { projectId, towerId } = hierarchyCache.get(cacheKey)!;

        const ins = await client.query(
          `INSERT INTO inventory_units (
             project_name, tower, wing, unit_type, floor, flat_no,
             carpet_area_sqft, built_up_area_sqft, rate_per_sqft, base_price, facing,
             status, source, created_by, updated_by,
             project_id, tower_id, is_corner, is_park_facing, parking_slots,
             organization_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'bulk_generated',$13,$13,$14,$15,$16,$17,$18,$19)
           -- Must match unique_inventory_unit's column list EXACTLY, including
           -- the leading organization_id added by
           -- 2026-08-23_inventory_tenant_isolation.sql. Postgres infers the index
           -- from these columns; a mismatch is not a silent no-op, it is
           -- "no unique or exclusion constraint matching the ON CONFLICT
           -- specification" and the whole batch fails.
           --
           -- The tenant column also makes the idempotency correct rather than
           -- merely working: before, one builder generating "Tower A / 101" would
           -- have been silently skipped because ANOTHER builder already had a flat
           -- by that name in a same-named project.
           ON CONFLICT (organization_id, project_name, tower, COALESCE(wing,''), floor, flat_no) WHERE deleted_at IS NULL
           DO NOTHING
           RETURNING id`,
          [
            project_name, tower, wing, unit_type, floor, flat_no,
            carpet, cleanNum(u.built_up_area_sqft), cleanNum(u.rate_per_sqft),
            cleanNum(u.base_price), u.facing ? String(u.facing).trim() : null,
            status, user_name,
            projectId, towerId,
            u.is_corner === true, u.is_park_facing === true,
            Math.max(0, Math.trunc(cleanNum(u.parking_slots) ?? 0)),
            orgId,
          ],
        );

        if (ins.rows.length) {
          created++;
          await client.query(
            `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
             VALUES ($1, NULL, $2, $3, 'bulk generated',
                     (SELECT organization_id FROM inventory_units WHERE id = $1))`,
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
