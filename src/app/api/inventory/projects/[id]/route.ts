// app/api/inventory/projects/[id]/route.ts
// Rename (PATCH) and permanently delete (DELETE) one building.
//
// ── Why a building rename is not a one-column UPDATE ────────────────────────
// The building name is DENORMALISED. inventory_projects.name is the canonical
// row, but inventory_units.project_name is a free-text copy on every unit, and
// booking_applications.project_name is another copy on every booking. Those
// strings are not decoration: lib/inventorySync.ts matches a booking to its unit
// on (project_name, tower, wing, floor, flat_no), and unique_inventory_unit is
// keyed on the same columns.
//
// So renaming only inventory_projects would leave every unit under the old name.
// The building would keep its old label on the landing page (which groups units
// by project_name), and the next save of any booking in it would fail to find its
// unit and CREATE A DUPLICATE under the new name. All three copies move together,
// inside one transaction, or none of them do.
//
// ── Why DELETE refuses on booked stock ─────────────────────────────────────
// The requirement is a permanent delete with no orphaned records. A flat that is
// sold is not an orphan risk — it is a record of a sale, referenced by
// booking_applications.  Deleting it would leave the booking pointing at nothing
// and destroy the inventory side of a real transaction. So a building with
// booking-linked units is refused with 409 and a list of what is blocking, rather
// than being half-deleted or silently skipping rows.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { isBookingProtected, bookingProtectedReason } from "@/lib/inventoryDelete";

export const dynamic = "force-dynamic";

/** Units of one building, by FK or by name — always within the tenant. */
const UNITS_OF_PROJECT = `
  FROM inventory_units
 WHERE organization_id = $1
   AND deleted_at IS NULL
   AND (project_id = $2 OR LOWER(TRIM(project_name)) = LOWER(TRIM($3)))`;

// ─── PATCH — rename a building ───────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Same gate as creating a building (POST /api/inventory/projects). Renaming
    // is an edit to the same object by the same people; delete below is narrower.
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const nextName = String(body.name ?? "").trim();
    if (!nextName) {
      return NextResponse.json({ success: false, message: "Building name is required." }, { status: 400 });
    }
    if (nextName.length > 120) {
      return NextResponse.json({ success: false, message: "Building name is too long (max 120)." }, { status: 400 });
    }

    const actor = gate.session.name || "system";

    const result = await transaction(async (client) => {
      // TENANT: the id is a route parameter. A project outside this organization
      // matches nothing and the caller gets the same 404 as a nonexistent id.
      const orgId = await getOrganizationId(client);
      const found = await client.query(
        `SELECT id, name FROM inventory_projects
          WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [Number(id), orgId],
      );
      if (!found.rows.length) return { notFound: true as const };

      const prevName = String(found.rows[0].name);
      if (prevName.trim().toLowerCase() === nextName.toLowerCase()) {
        // Same name (possibly re-cased) — nothing to propagate.
        return { unchanged: true as const, name: prevName };
      }

      // Per-tenant uniqueness, checked before the write so the user gets a
      // sentence instead of a constraint violation. uq_inventory_projects_org_name
      // is the real guarantee; this is the readable one.
      const clash = await client.query(
        `SELECT id FROM inventory_projects
          WHERE organization_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
            AND id <> $3 AND deleted_at IS NULL LIMIT 1`,
        [orgId, nextName, Number(id)],
      );
      if (clash.rows.length) return { clash: true as const };

      await client.query(
        `UPDATE inventory_projects SET name = $1, updated_by = $2, updated_at = NOW()
          WHERE id = $3 AND organization_id = $4`,
        [nextName, actor, Number(id), orgId],
      );

      // The denormalised copies. Matched on the OLD name (or the FK), scoped to
      // this tenant so a same-named building belonging to another builder is
      // untouched.
      const units = await client.query(
        `UPDATE inventory_units
            SET project_name = $1, updated_by = $2, updated_at = NOW()
          WHERE organization_id = $3
            AND (project_id = $4 OR LOWER(TRIM(project_name)) = LOWER(TRIM($5)))`,
        [nextName, actor, orgId, Number(id), prevName],
      );

      // Bookings carry their own copy, and syncBookingUnit matches on it. Left
      // stale, the next save of one of these bookings would look for a unit under
      // the old name, find none, and create a duplicate.
      const bookings = await client.query(
        `UPDATE booking_applications
            SET project_name = $1, updated_at = NOW()
          WHERE organization_id = $2 AND LOWER(TRIM(project_name)) = LOWER(TRIM($3))`,
        [nextName, orgId, prevName],
      );

      return {
        ok: true as const,
        id: Number(id),
        name: nextName,
        previous_name: prevName,
        units_updated: units.rowCount ?? 0,
        bookings_updated: bookings.rowCount ?? 0,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json({ success: false, message: "Building not found." }, { status: 404 });
    }
    if ("clash" in result) {
      return NextResponse.json(
        { success: false, code: "NAME_TAKEN", message: "Another building already uses that name." },
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
        { success: false, code: "NAME_TAKEN", message: "Another building already uses that name." },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/inventory/projects/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── DELETE — permanently remove a building and everything under it ──────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Admin only. This is the widest-blast-radius action in the module and it is
    // not reversible — matching `isAdminUser` in InventoryManagementView, which is
    // the gate the Delete control is rendered behind.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const result = await transaction(async (client) => {
      const orgId = await getOrganizationId(client);
      const found = await client.query(
        `SELECT id, name FROM inventory_projects
          WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [Number(id), orgId],
      );
      if (!found.rows.length) return { notFound: true as const };
      const projectName = String(found.rows[0].name);

      const units = (await client.query(
        `SELECT id, flat_no, tower, wing, status, lead_id, booking_id, source ${UNITS_OF_PROJECT}`,
        [orgId, Number(id), projectName],
      )).rows;

      // A sold flat is a record, not debris. Refuse the whole delete rather than
      // partially applying it — a half-deleted building is worse than none.
      const blocking = units
        .filter((u) => isBookingProtected(u))
        .map((u) => ({ id: u.id, flat_no: u.flat_no, reason: bookingProtectedReason(u) }));
      if (blocking.length) {
        return { blocked: true as const, blocking: blocking as { id: number; flat_no: string; reason: string }[], name: projectName };
      }

      // Order matters, and it is dictated by the FK graph:
      //   inventory_units.project_id -> inventory_projects  is NO ACTION
      //   inventory_units.tower_id   -> inventory_towers    is NO ACTION
      // so units MUST go before the project and its towers, or the delete fails
      // with a foreign key violation. Everything hanging off a unit
      // (inventory_cost_sheets, inventory_offers, inventory_unit_history) is
      // ON DELETE CASCADE, as are inventory_towers, inventory_price_rules and
      // inventory_discount_bands off the project — so those clean themselves up
      // and cannot be left orphaned.
      const unitIds = units.map((u) => u.id);
      let deletedUnits = 0;
      if (unitIds.length) {
        const del = await client.query(
          `DELETE FROM inventory_units WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [unitIds, orgId],
        );
        deletedUnits = del.rowCount ?? 0;
      }

      // Soft-deleted units of the same building would otherwise be left behind
      // pointing at a project row that no longer exists.
      const softDel = await client.query(
        `DELETE FROM inventory_units
          WHERE organization_id = $1
            AND deleted_at IS NOT NULL
            AND (project_id = $2 OR LOWER(TRIM(project_name)) = LOWER(TRIM($3)))`,
        [orgId, Number(id), projectName],
      );

      const towers = await client.query(
        `SELECT COUNT(*)::int AS n FROM inventory_towers
          WHERE project_id = $1 AND organization_id = $2`,
        [Number(id), orgId],
      );

      await client.query(
        `DELETE FROM inventory_projects WHERE id = $1 AND organization_id = $2`,
        [Number(id), orgId],
      );

      return {
        ok: true as const,
        id: Number(id),
        name: projectName,
        deleted_units: deletedUnits,
        deleted_archived_units: softDel.rowCount ?? 0,
        deleted_towers: towers.rows[0]?.n ?? 0,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json({ success: false, message: "Building not found." }, { status: 404 });
    }
    if ("blocked" in result && result.blocked) {
      return NextResponse.json(
        {
          success: false,
          code: "BOOKING_LINKED_UNITS",
          message:
            `"${result.name}" has ${result.blocking.length} flat(s) attached to a booking. ` +
            `Cancel or move those bookings before deleting the building.`,
          blocking: result.blocking,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/inventory/projects/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
