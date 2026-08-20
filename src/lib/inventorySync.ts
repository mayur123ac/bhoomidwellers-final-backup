// lib/inventorySync.ts
// Keeps inventory_units in step with the booking lifecycle. Every function here runs
// inside the caller's existing DB transaction (it takes the PoolClient), so inventory
// writes commit or roll back atomically with the booking write — a booking must never
// succeed while its inventory link silently fails.
import type { PoolClient } from "pg";
import { resolveHierarchy } from "./inventoryHierarchy";
import { getOrganizationId } from "./tenantContext";

const cleanNum = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? null : n;
};

const toIntOrNull = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.trunc(n);
};

// booking_applications.floor_number is free text; inventory_units.floor is INTEGER.
// Ground variants → 0; otherwise the first integer found in the string; anything
// unparseable → null (the caller rolls the booking back).
export function parseFloor(raw: any): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "g" || low === "gf" || low === "grd" || low.startsWith("ground")) return 0;
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export interface BookingUnitInput {
  bookingId: number;
  leadId: number | string | null;
  actor: string | null;
  project_name?: string | null;
  tower?: string | null;
  wing?: string | null;
  property_type?: string | null;
  floor_number?: string | null;
  flat_number?: string | null;
  carpet_area?: string | null;
}

export interface SyncResult {
  synced: boolean;            // false when skipped (unit not identifiable)
  skippedReason?: string;
  unitId?: number;
  created?: boolean;
}

// Upsert the unit a booking now occupies as 'booked', linking lead + booking.
// Keyed on (project_name, tower, COALESCE(wing,''), floor, flat_no) — the same key
// as the partial unique index. Creates the unit if the bulk generator never covered it.
export async function syncBookingUnit(client: PoolClient, input: BookingUnitInput): Promise<SyncResult> {
  // MT-05: resolved once per call, on the caller's transaction client, and
  // reused by every INSERT below. Never per row.
  const orgId = await getOrganizationId(client);
  const project_name = (input.project_name || "").trim();
  const tower = (input.tower || "").trim();
  const flat_no = (input.flat_number || "").trim();

  // Not enough to identify a unit → nothing to track (the booking still proceeds).
  if (!project_name || !tower || !flat_no) {
    return { synced: false, skippedReason: "incomplete unit (missing project/tower/flat)" };
  }

  const floor = parseFloor(input.floor_number);
  if (floor === null) {
    throw new Error(`Cannot sync inventory: floor "${input.floor_number}" is not a recognizable floor number.`);
  }

  const wing = input.wing && input.wing.trim() ? input.wing.trim() : null;
  const actor = input.actor || "System";
  const bookingId = input.bookingId;
  const leadId = toIntOrNull(input.leadId);

  const existing = await client.query(
    `SELECT id, status, booking_id FROM inventory_units
      WHERE project_name = $1 AND tower = $2 AND COALESCE(wing,'') = COALESCE($3,'')
        AND floor = $4 AND flat_no = $5 AND deleted_at IS NULL
      LIMIT 1`,
    [project_name, tower, wing, floor, flat_no],
  );

  let unitId: number;
  let oldStatus: string | null;
  let created = false;

  if (existing.rows.length) {
    // Refuse to steal a flat that another booking already holds.
    //
    // Without this the UPDATE below simply repointed the unit's booking_id at
    // whoever saved last, so two bookings could both believe they owned the same
    // flat and inventory would only ever show the newer one. The reactivate path
    // in booking-applications/[id] already checked this; keeping the check here
    // means create, flat-change and reactivate all enforce it identically rather
    // than one path being safe by accident.
    //
    // FOR UPDATE is what makes it a real guard: two concurrent bookings for the
    // same flat would otherwise both read booking_id IS NULL and both proceed.
    const held = await client.query(
      `SELECT booking_id FROM inventory_units WHERE id = $1 FOR UPDATE`,
      [existing.rows[0].id],
    );
    const heldBy = held.rows[0]?.booking_id;
    if (heldBy != null && Number(heldBy) !== Number(bookingId)) {
      throw Object.assign(
        new Error(
          `Flat ${flat_no} (${tower}${wing ? "/" + wing : ""}, floor ${floor}) is already held by booking #${heldBy}. ` +
          `Release that booking before assigning this flat.`,
        ),
        { httpStatus: 409 },
      );
    }

    unitId = existing.rows[0].id;
    oldStatus = existing.rows[0].status;
    await client.query(
      `UPDATE inventory_units
          SET status = 'booked', lead_id = $2, booking_id = $3, source = 'booking_sync',
              updated_by = $4, updated_at = NOW()
        WHERE id = $1`,
      [unitId, leadId, bookingId, actor],
    );
  } else {
    // Bulk generator never covered this flat — create it, filling NOT NULL columns
    // from the booking with safe fallbacks (decision: sync-if-keyable).
    const unit_type = (input.property_type || "").trim() || "Unspecified";
    const carpet = cleanNum(input.carpet_area) ?? 0;
    // apartment_name is no longer written — the field is retired on both sides,
    // and the column is nullable, so the fallback that used to copy project_name
    // into it would only manufacture data nobody asked for.
    // Attach the FK hierarchy too, creating the project/tower if this is stock
    // nobody set up yet — the same "sync-if-keyable" decision that lets this
    // branch create the unit at all. Without it the new unit would have a NULL
    // project_id and could never be priced.
    const { projectId, towerId } = await resolveHierarchy(client, project_name, tower, actor);

    const ins = await client.query(
      `INSERT INTO inventory_units (
         project_name, tower, wing, unit_type, floor, flat_no,
         carpet_area_sqft, status, source, lead_id, booking_id, created_by, updated_by,
         project_id, tower_id,
         organization_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'booked','booking_sync',$8,$9,$10,$10,$11,$12,$13)
       RETURNING id`,
      [project_name, tower, wing, unit_type, floor, flat_no, carpet, leadId, bookingId, actor,
       projectId, towerId, orgId],
    );
    unitId = ins.rows[0].id;
    oldStatus = null;
    created = true;
  }

  // History for every status change (skip the no-op re-save of an already-booked unit).
  if (oldStatus !== "booked") {
    await client.query(
      `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
       VALUES ($1, $2, 'booked', $3, $4, $5)`,
      [unitId, oldStatus, actor, `linked to booking #${bookingId}`, orgId],
    );
  }

  return { synced: true, unitId, created };
}

// Release whatever unit is currently linked to this booking back to 'available',
// unlinking lead + booking. Used on flat-change and cancellation.
export async function releaseUnitForBooking(
  client: PoolClient,
  bookingId: number,
  reason: string,
  actor: string,
): Promise<number[]> {
  // MT-05: resolved once, OUTSIDE the loop below that writes one history row
  // per released unit.
  const orgId = await getOrganizationId(client);
  const linked = await client.query(
    `SELECT id, status FROM inventory_units WHERE booking_id = $1 AND deleted_at IS NULL`,
    [bookingId],
  );
  const released: number[] = [];
  for (const row of linked.rows) {
    await client.query(
      `UPDATE inventory_units
          SET status = 'available', lead_id = NULL, booking_id = NULL,
              updated_by = $2, updated_at = NOW()
        WHERE id = $1`,
      [row.id, actor || "System"],
    );
    if (row.status !== "available") {
      await client.query(
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
         VALUES ($1, $2, 'available', $3, $4, $5)`,
        [row.id, row.status, actor || "System", reason, orgId],
      );
    }
    released.push(row.id);
  }
  return released;
}

// Did the flat identity change between the stored booking and the incoming edit?
export function flatIdentityChanged(oldRow: any, next: any): boolean {
  const norm = (v: any) => String(v ?? "").trim().toLowerCase();
  return (
    norm(oldRow.project_name) !== norm(next.project_name) ||
    norm(oldRow.tower) !== norm(next.tower) ||
    norm(oldRow.wing) !== norm(next.wing) ||
    norm(oldRow.flat_number) !== norm(next.flat_number) ||
    parseFloor(oldRow.floor_number) !== parseFloor(next.floor_number)
  );
}
