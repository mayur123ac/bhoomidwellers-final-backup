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
import { query, transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { isBookingProtected, bookingProtectedReason, hasBookingHistory, UNITS_WITH_BOOKING_STATUS } from "@/lib/inventoryDelete";

export const dynamic = "force-dynamic";

/**
 * Units of one building, by FK or by name — always within the tenant.
 *
 * Read through the booking join so the guard can tell a live booking from a
 * cancelled one; predicates are `iu`-qualified for the same ambiguity reason as
 * in /api/inventory/building.
 */
const UNITS_OF_PROJECT = `
  ${UNITS_WITH_BOOKING_STATUS}
 WHERE iu.organization_id = $1
   AND iu.deleted_at IS NULL
   AND (iu.project_id = $2 OR LOWER(TRIM(iu.project_name)) = LOWER(TRIM($3)))`;

// ─── GET — what deleting this building would touch ───────────────────────────
// Feeds the confirmation modal. Same tenant scoping and the same guard as DELETE,
// so what the operator is shown is what the delete will actually decide — a
// preview that disagrees with the action is worse than no preview.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Gated as admin, matching DELETE: this enumerates a building's stock and
    // which flats are sold, and it previews an admin-only destructive action.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const found = await query<{ id: number; name: string }>(
      `SELECT id, name FROM inventory_projects
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [Number(id), orgId],
    );
    // TENANT: another organization's building is indistinguishable from one that
    // does not exist, so this cannot be used to probe for ids.
    if (!found.length) {
      return NextResponse.json({ success: false, message: "Building not found." }, { status: 404 });
    }
    const projectName = String(found[0].name);

    const [counts, units, towerRows] = await Promise.all([
      query<{ units: number; towers: number; wings: number; floors: number; archived: number }>(
        `SELECT COUNT(*) FILTER (WHERE iu.deleted_at IS NULL)::int          AS units,
                COUNT(DISTINCT iu.tower) FILTER (WHERE iu.deleted_at IS NULL)::int AS towers,
                COUNT(DISTINCT COALESCE(NULLIF(TRIM(iu.wing), ''), '—'))
                  FILTER (WHERE iu.deleted_at IS NULL)::int                 AS wings,
                COUNT(DISTINCT iu.floor) FILTER (WHERE iu.deleted_at IS NULL)::int AS floors,
                COUNT(*) FILTER (WHERE iu.deleted_at IS NOT NULL)::int      AS archived
           FROM inventory_units iu
          WHERE iu.organization_id = $1
            AND (iu.project_id = $2 OR LOWER(TRIM(iu.project_name)) = LOWER(TRIM($3)))`,
        [orgId, Number(id), projectName],
      ),
      query(
        `SELECT iu.id, iu.flat_no, iu.tower, iu.wing, iu.status, iu.lead_id, iu.booking_id, iu.source,
                ba.booking_status ${UNITS_OF_PROJECT}`,
        [orgId, Number(id), projectName],
      ),
      // Towers are their own rows, and a building can have a tower with no stock
      // in it yet — that tower still gets deleted, so it belongs in the preview.
      query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM inventory_towers WHERE project_id = $1 AND organization_id = $2`,
        [Number(id), orgId],
      ),
    ]);

    const blocking = units
      .filter((u: any) => isBookingProtected(u))
      .map((u: any) => ({ id: u.id, flat_no: u.flat_no, reason: bookingProtectedReason(u) }));
    const archivable = units.filter((u: any) => hasBookingHistory(u) && !isBookingProtected(u));

    const c = counts[0] ?? { units: 0, towers: 0, wings: 0, floors: 0, archived: 0 };
    return NextResponse.json({
      success: true,
      data: {
        id: Number(id),
        name: projectName,
        towers: Math.max(c.towers, towerRows[0]?.n ?? 0),
        wings: c.wings,
        floors: c.floors,
        units: c.units,
        archived_units: c.archived,
        // "Active bookings" in the operator's language = flats a booking still holds.
        active_bookings: blocking.length,
        // Flats whose booking was cancelled: not blocking, but their history is
        // kept rather than purged, and the modal says so.
        history_preserved_units: archivable.length,
        blocking,
        deletable: c.units - blocking.length,
      },
    }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/projects/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

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
    const actor = gate.session.name || "admin";

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
        `SELECT iu.id, iu.flat_no, iu.tower, iu.wing, iu.status, iu.lead_id, iu.booking_id, iu.source,
                ba.booking_status ${UNITS_OF_PROJECT}`,
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
      // so every unit must stop referencing the project and its towers before
      // those rows go, or the delete fails with a foreign key violation.
      //
      // ── Purge vs. archive ────────────────────────────────────────────────
      // A hard DELETE of a unit CASCADES inventory_cost_sheets, inventory_offers
      // and inventory_unit_history away with it. For stock that was only ever
      // generated and never sold that is the point — there is nothing to keep.
      // For a flat that a booking once occupied, those history rows ("linked to
      // booking #21", "booking #21 cancelled") are the audit trail of a real
      // transaction, and destroying them to satisfy a foreign key is exactly
      // what must not happen.
      //
      // So the units split in two. Anything a booking ever touched is ARCHIVED:
      // soft-deleted and detached from the project/tower FKs, which both frees
      // the parent rows and leaves the unit and its history intact and
      // queryable. Everything else is purged outright.
      const archivableIds = units.filter(hasBookingHistory).map((u) => u.id);
      const purgeableIds = units.filter((u) => !hasBookingHistory(u)).map((u) => u.id);

      // Units of this building that were ALREADY soft-deleted before this call.
      // Read BEFORE the archive step below, because that step sets deleted_at on
      // rows this query would then match a second time — which double-counted
      // every archived unit and re-ran the detach on it.
      const priorSoftDeleted = (await client.query(
        `SELECT iu.id, iu.source, iu.booking_id
           FROM inventory_units iu
          WHERE iu.organization_id = $1
            AND iu.deleted_at IS NOT NULL
            AND (iu.project_id = $2 OR LOWER(TRIM(iu.project_name)) = LOWER(TRIM($3)))`,
        [orgId, Number(id), projectName],
      )).rows;

      let archivedUnits = 0;
      if (archivableIds.length) {
        const arch = await client.query(
          `UPDATE inventory_units
              SET deleted_at = COALESCE(deleted_at, NOW()),
                  project_id = NULL, tower_id = NULL,
                  updated_by = $3, updated_at = NOW()
            WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [archivableIds, orgId, actor],
        );
        archivedUnits = arch.rowCount ?? 0;
        // One history row per archived unit, so the trail says why the flat left
        // the active inventory rather than just stopping.
        await client.query(
          `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
           SELECT id, status, 'deleted', $2,
                  'building "' || $3 || '" deleted — flat archived (booking history preserved)',
                  organization_id
             FROM inventory_units WHERE id = ANY($1::int[])`,
          [archivableIds, actor, projectName],
        );
      }

      let deletedUnits = 0;
      if (purgeableIds.length) {
        const del = await client.query(
          `DELETE FROM inventory_units WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [purgeableIds, orgId],
        );
        deletedUnits = del.rowCount ?? 0;
      }

      // Those already-soft-deleted units still hold the project/tower FKs, so they
      // get the same treatment: purged when they are plain generated stock,
      // detached when they carry booking history.
      const priorPurge = priorSoftDeleted.filter((u) => !hasBookingHistory(u)).map((u) => u.id);
      const priorDetach = priorSoftDeleted.filter(hasBookingHistory).map((u) => u.id);

      let purgedArchived = 0;
      if (priorPurge.length) {
        const r = await client.query(
          `DELETE FROM inventory_units WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [priorPurge, orgId],
        );
        purgedArchived = r.rowCount ?? 0;
      }
      if (priorDetach.length) {
        const r = await client.query(
          `UPDATE inventory_units SET project_id = NULL, tower_id = NULL, updated_at = NOW()
            WHERE id = ANY($1::int[]) AND organization_id = $2`,
          [priorDetach, orgId],
        );
        archivedUnits += r.rowCount ?? 0;
      }

      const towers = await client.query(
        `SELECT COUNT(*)::int AS n FROM inventory_towers
          WHERE project_id = $1 AND organization_id = $2`,
        [Number(id), orgId],
      );

      // ── The one dependency that archiving creates ────────────────────────
      // Cost sheets of the flats archived above OUTLIVE this building, and each
      // still points at a price rule that is about to cascade away with the
      // project. That is the direct conflict between the two halves of this
      // delete: the project cannot go without its price rules, and an archived
      // flat's issued quotes must not go at all. Left alone it aborted the
      // whole delete with a foreign key violation on
      // inventory_cost_sheets_price_rule_id_fkey — one archived flat with one
      // issued quote made the entire building permanently undeletable.
      //
      // The pointer is what gives. The sheet keeps every number and its
      // rendered `breakdown`, so it still explains its own arithmetic without
      // the rule; price_rule_id is provenance, and the rule it names is being
      // destroyed either way.
      //
      // The FK is also ON DELETE SET NULL now
      // (scripts/migrations/2026-08-23_cost_sheet_price_rule_set_null.sql), so
      // the database would do this on its own. It is done explicitly anyway:
      // the delete must not silently depend on that migration having reached
      // this database, and discarding provenance is a deliberate act worth
      // reporting rather than an invisible cascade side effect.
      const detached = await client.query(
        `UPDATE inventory_cost_sheets cs
            SET price_rule_id = NULL
           FROM inventory_price_rules pr
          WHERE cs.price_rule_id = pr.id
            AND cs.organization_id = $2
            AND pr.organization_id = $2
            AND pr.project_id = $1`,
        [Number(id), orgId],
      );

      // inventory_towers, inventory_price_rules and inventory_discount_bands are
      // ON DELETE CASCADE off the project, so they clean themselves up here and
      // cannot be left orphaned.
      await client.query(
        `DELETE FROM inventory_projects WHERE id = $1 AND organization_id = $2`,
        [Number(id), orgId],
      );

      return {
        ok: true as const,
        id: Number(id),
        name: projectName,
        deleted_units: deletedUnits,
        archived_units: archivedUnits,
        deleted_archived_units: purgedArchived,
        deleted_towers: towers.rows[0]?.n ?? 0,
        detached_cost_sheets: detached.rowCount ?? 0,
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
