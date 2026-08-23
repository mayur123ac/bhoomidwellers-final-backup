// app/api/inventory/towers/[id]/route.ts
// Rename one tower.
//
// Same denormalisation problem as the building rename, one level down:
// inventory_towers.name is canonical, inventory_units.tower is a copy on every
// unit, and booking_applications.tower is a copy on every booking. All three move
// together or the booking-to-unit match in lib/inventorySync.ts breaks and the
// next booking save creates a duplicate unit under the new tower name.
//
// Wing renames live in ../wings — a wing has no table of its own, so it is a
// different shape of operation even though it looks adjacent in the UI.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const nextName = String(body.name ?? "").trim();
    if (!nextName) {
      return NextResponse.json({ success: false, message: "Tower name is required." }, { status: 400 });
    }
    if (nextName.length > 60) {
      return NextResponse.json({ success: false, message: "Tower name is too long (max 60)." }, { status: 400 });
    }

    const actor = gate.session.name || "system";

    const result = await transaction(async (client) => {
      // TENANT: route parameter, so the organization predicate is what turns a
      // foreign tower id into a 404 instead of a rename of someone else's stock.
      const orgId = await getOrganizationId(client);
      const found = await client.query(
        `SELECT t.id, t.name, t.project_id, p.name AS project_name
           FROM inventory_towers t
           JOIN inventory_projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
          WHERE t.id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL
          FOR UPDATE OF t`,
        [Number(id), orgId],
      );
      if (!found.rows.length) return { notFound: true as const };

      const row = found.rows[0];
      const prevName = String(row.name);
      const projectName = String(row.project_name);
      if (prevName.trim().toLowerCase() === nextName.toLowerCase()) {
        return { unchanged: true as const, name: prevName };
      }

      // uq_inventory_towers_name is (project_id, lower(trim(name))) — unique
      // within the building, which is the right scope and already tenant-safe
      // because the project is.
      const clash = await client.query(
        `SELECT id FROM inventory_towers
          WHERE project_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
            AND id <> $3 AND deleted_at IS NULL LIMIT 1`,
        [row.project_id, nextName, Number(id)],
      );
      if (clash.rows.length) return { clash: true as const };

      await client.query(
        `UPDATE inventory_towers SET name = $1, updated_by = $2, updated_at = NOW()
          WHERE id = $3 AND organization_id = $4`,
        [nextName, actor, Number(id), orgId],
      );

      // Units are matched by tower_id where it is set, and by the (project, tower)
      // name pair where it is not — legacy stock predates the FK backfill.
      const units = await client.query(
        `UPDATE inventory_units
            SET tower = $1, updated_by = $2, updated_at = NOW()
          WHERE organization_id = $3
            AND (tower_id = $4
                 OR (LOWER(TRIM(project_name)) = LOWER(TRIM($5)) AND LOWER(TRIM(tower)) = LOWER(TRIM($6))))`,
        [nextName, actor, orgId, Number(id), projectName, prevName],
      );

      const bookings = await client.query(
        `UPDATE booking_applications
            SET tower = $1, updated_at = NOW()
          WHERE organization_id = $2
            AND LOWER(TRIM(project_name)) = LOWER(TRIM($3))
            AND LOWER(TRIM(COALESCE(tower, ''))) = LOWER(TRIM($4))`,
        [nextName, orgId, projectName, prevName],
      );

      return {
        ok: true as const,
        id: Number(id),
        name: nextName,
        previous_name: prevName,
        project_id: row.project_id,
        project_name: projectName,
        units_updated: units.rowCount ?? 0,
        bookings_updated: bookings.rowCount ?? 0,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json({ success: false, message: "Tower not found." }, { status: 404 });
    }
    if ("clash" in result) {
      return NextResponse.json(
        { success: false, code: "NAME_TAKEN", message: "That tower name is already used in this building." },
        { status: 409 },
      );
    }
    if ("unchanged" in result) {
      return NextResponse.json({ success: true, data: { id: Number(id), name: result.name }, unchanged: true }, { status: 200 });
    }
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json(
        { success: false, code: "NAME_TAKEN", message: "That tower name is already used in this building." },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/inventory/towers/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
