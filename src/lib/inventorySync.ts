// lib/inventorySync.ts
// Keeps inventory_units in step with the booking lifecycle. Every function here runs
// inside the caller's existing DB transaction (it takes the PoolClient), so inventory
// writes commit or roll back atomically with the booking write — a booking must never
// succeed while its inventory link silently fails.
import type { PoolClient } from "pg";

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
  apartment_name?: string | null;
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
    `SELECT id, status FROM inventory_units
      WHERE project_name = $1 AND tower = $2 AND COALESCE(wing,'') = COALESCE($3,'')
        AND floor = $4 AND flat_no = $5 AND deleted_at IS NULL
      LIMIT 1`,
    [project_name, tower, wing, floor, flat_no],
  );

  let unitId: number;
  let oldStatus: string | null;
  let created = false;

  if (existing.rows.length) {
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
    const apartment_name = (input.apartment_name || "").trim() || project_name;
    const carpet = cleanNum(input.carpet_area) ?? 0;
    const ins = await client.query(
      `INSERT INTO inventory_units (
         apartment_name, project_name, tower, wing, unit_type, floor, flat_no,
         carpet_area_sqft, status, source, lead_id, booking_id, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'booked','booking_sync',$9,$10,$11,$11)
       RETURNING id`,
      [apartment_name, project_name, tower, wing, unit_type, floor, flat_no, carpet, leadId, bookingId, actor],
    );
    unitId = ins.rows[0].id;
    oldStatus = null;
    created = true;
  }

  // History for every status change (skip the no-op re-save of an already-booked unit).
  if (oldStatus !== "booked") {
    await client.query(
      `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, 'booked', $3, $4)`,
      [unitId, oldStatus, actor, `linked to booking #${bookingId}`],
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
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, 'available', $3, $4)`,
        [row.id, row.status, actor || "System", reason],
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
