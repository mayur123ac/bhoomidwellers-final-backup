// app/api/inventory/wings/route.ts
// Rename a wing.
//
// ── Why this is not /wings/[id] ─────────────────────────────────────────────
// There is no inventory_wings table and there never was: the 2026-08-04 parity
// migration deliberately left `wing` as free text on inventory_units, because the
// live data spells one wing several ways ("B", "B wing") and the unit-level
// unique index already keys on it. A wing therefore has no id — it is identified
// by the (building, tower, wing-name) triple, which is exactly what this endpoint
// takes.
//
// Renaming one is a bulk update of that free-text column across the matching
// units, plus the same column on any booking that points at them — the copy
// lib/inventorySync.ts matches on.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const projectName = String(body.project_name ?? "").trim();
    const tower = String(body.tower ?? "").trim();
    // An empty wing is a real value — "the un-winged stock of this tower" — so it
    // is distinguished from a missing parameter rather than rejected.
    const prevWing = body.wing == null ? "" : String(body.wing).trim();
    const nextWing = body.new_wing == null ? "" : String(body.new_wing).trim();

    if (!projectName || !tower) {
      return NextResponse.json(
        { success: false, message: "project_name and tower are required." },
        { status: 400 },
      );
    }
    if (nextWing.length > 60) {
      return NextResponse.json({ success: false, message: "Wing name is too long (max 60)." }, { status: 400 });
    }
    if (prevWing.toLowerCase() === nextWing.toLowerCase()) {
      return NextResponse.json({ success: true, data: { wing: nextWing }, unchanged: true }, { status: 200 });
    }

    const actor = gate.session.name || "system";

    const result = await transaction(async (client) => {
      // TENANT: every predicate below is a free-text name, and names repeat across
      // builders. The organization is the only thing that makes this scope mean
      // "MY Tower A", so it leads every statement.
      const orgId = await getOrganizationId(client);

      const matched = await client.query(
        `SELECT id FROM inventory_units
          WHERE organization_id = $1
            AND deleted_at IS NULL
            AND LOWER(TRIM(project_name)) = LOWER(TRIM($2))
            AND LOWER(TRIM(tower)) = LOWER(TRIM($3))
            AND COALESCE(NULLIF(TRIM(wing), ''), '') = $4
          FOR UPDATE`,
        [orgId, projectName, tower, prevWing],
      );
      if (!matched.rows.length) return { notFound: true as const };

      // unique_inventory_unit is (organization_id, project_name, tower,
      // COALESCE(wing,''), floor, flat_no). Renaming a wing onto one that already
      // exists in the same tower would collide on any shared floor/flat pair, so
      // it is refused with a sentence rather than a constraint violation
      // mid-update.
      const collision = await client.query(
        `SELECT u.flat_no, u.floor
           FROM inventory_units u
          WHERE u.organization_id = $1
            AND u.deleted_at IS NULL
            AND LOWER(TRIM(u.project_name)) = LOWER(TRIM($2))
            AND LOWER(TRIM(u.tower)) = LOWER(TRIM($3))
            AND COALESCE(NULLIF(TRIM(u.wing), ''), '') = $4
            AND EXISTS (
              SELECT 1 FROM inventory_units v
               WHERE v.organization_id = u.organization_id
                 AND v.deleted_at IS NULL
                 AND LOWER(TRIM(v.project_name)) = LOWER(TRIM($2))
                 AND LOWER(TRIM(v.tower)) = LOWER(TRIM($3))
                 AND COALESCE(NULLIF(TRIM(v.wing), ''), '') = $5
                 AND v.floor = u.floor AND v.flat_no = u.flat_no
            )
          LIMIT 5`,
        [orgId, projectName, tower, prevWing, nextWing],
      );
      if (collision.rows.length) {
        return { collision: true as const, sample: collision.rows };
      }

      const units = await client.query(
        `UPDATE inventory_units
            SET wing = $1, updated_by = $2, updated_at = NOW()
          WHERE organization_id = $3
            AND deleted_at IS NULL
            AND LOWER(TRIM(project_name)) = LOWER(TRIM($4))
            AND LOWER(TRIM(tower)) = LOWER(TRIM($5))
            AND COALESCE(NULLIF(TRIM(wing), ''), '') = $6`,
        [nextWing || null, actor, orgId, projectName, tower, prevWing],
      );

      const bookings = await client.query(
        `UPDATE booking_applications
            SET wing = $1, updated_at = NOW()
          WHERE organization_id = $2
            AND LOWER(TRIM(project_name)) = LOWER(TRIM($3))
            AND LOWER(TRIM(COALESCE(tower, ''))) = LOWER(TRIM($4))
            AND COALESCE(NULLIF(TRIM(wing), ''), '') = $5`,
        [nextWing || null, orgId, projectName, tower, prevWing],
      );

      return {
        ok: true as const,
        project_name: projectName,
        tower,
        previous_wing: prevWing,
        wing: nextWing,
        units_updated: units.rowCount ?? 0,
        bookings_updated: bookings.rowCount ?? 0,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json({ success: false, message: "No units found for that wing." }, { status: 404 });
    }
    if ("collision" in result && result.collision) {
      return NextResponse.json(
        {
          success: false,
          code: "WING_MERGE_CONFLICT",
          message:
            `Renaming to "${nextWing || "(no wing)"}" would collide with flats that already exist there ` +
            `(for example ${result.sample.map((r: any) => `${r.flat_no} on floor ${r.floor}`).join(", ")}). ` +
            `Rename or move those flats first.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json(
        { success: false, code: "WING_MERGE_CONFLICT", message: "That wing name collides with existing flats in this tower." },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/inventory/wings]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
