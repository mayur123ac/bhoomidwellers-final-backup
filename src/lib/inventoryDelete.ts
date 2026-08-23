// lib/inventoryDelete.ts
// Shared guardrail + soft-delete helpers for the three inventory delete tiers
// (row / bulk / whole-building). Soft-delete only — sets deleted_at and writes an
// inventory_unit_history row (new_status='deleted') so the unit's full life story
// survives; a hard DELETE would cascade-remove that history.
import type { PoolClient } from "pg";

// Delete is admin-only (tighter blast radius than Add Unit, which stays sales-manager+).
export function isAdmin(role: string): boolean {
  return (role || "").trim().toLowerCase() === "admin";
}

const ACTIVE_STATUSES = ["booked", "registered", "on_hold"];

/* ══════════════════════════════════════════════════════════════════════════════
   Live booking link vs. booking PROVENANCE
   ══════════════════════════════════════════════════════════════════════════════
   `inventory_units.source` records where a row CAME FROM — 'bulk_generated',
   'manual', or 'booking_sync' when lib/inventorySync.ts had to create the flat
   because the bulk generator never covered it. It is written once and never
   cleared.

   It used to be part of the hard block below, and that was the bug: cancelling a
   booking runs releaseUnitForBooking(), which sets the unit back to 'available'
   and NULLs both lead_id and booking_id — but deliberately leaves `source`
   alone, because the provenance is still true. The flat was then available,
   unlinked, and permanently undeletable, with the rejection message claiming a
   booking link that no longer existed.

   What actually protects a flat is the LIVE link: its lifecycle status, and a
   booking_id pointing at a booking that has not been cancelled. A cancelled
   booking is history, and history is not a dependency — nothing is destroyed by
   removing the flat, because:
     • the delete is a SOFT delete (deleted_at), so inventory_unit_history is
       untouched, and
     • booking_applications carries its own copy of project_name / tower / wing /
       flat_number and has NO foreign key to inventory_units, so the booking
       record stands on its own either way.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Booking statuses that end a booking's claim on its flat. */
const CLOSED_BOOKING_STATUSES = new Set(["cancelled", "canceled"]);

export function isBookingClosed(status: unknown): boolean {
  return CLOSED_BOOKING_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/**
 * The shape the guards below need. `booking_status` is NOT a column on
 * inventory_units — it is decorated onto the row by the join in
 * {@link UNITS_WITH_BOOKING_STATUS}.
 */
export interface GuardedUnit {
  id?: number;
  flat_no?: string | null;
  status?: string | null;
  source?: string | null;
  lead_id?: number | null;
  booking_id?: number | null;
  /** From booking_applications. `undefined` = the caller did not join. */
  booking_status?: string | null;
}

/**
 * The FROM clause every delete tier must read units through, so `booking_status`
 * is available to the guards. Alias is `iu`; callers qualify their predicates
 * with it (booking_applications has organization_id and project_name columns of
 * its own, so unqualified names would be ambiguous).
 *
 * The join carries the tenant predicate itself: a booking belonging to another
 * organization must never decide whether this one's flat is deletable.
 */
export const UNITS_WITH_BOOKING_STATUS = `
  FROM inventory_units iu
  LEFT JOIN booking_applications ba
         ON ba.id = iu.booking_id AND ba.organization_id = iu.organization_id`;

/** SELECT list to pair with {@link UNITS_WITH_BOOKING_STATUS}. */
export const UNIT_GUARD_COLUMNS = `iu.*, ba.booking_status`;

/**
 * SQL mirror of {@link isBookingProtected} + {@link isLinkedActive}, for the
 * COUNT(*) preview that must agree exactly with the row-by-row decision made
 * below. Requires the same `iu` / `ba` aliases.
 */
export const GUARDED_UNIT_SQL = `(
  iu.status IN ('booked','registered','on_hold')
  OR iu.lead_id IS NOT NULL
  OR (iu.booking_id IS NOT NULL AND LOWER(TRIM(COALESCE(ba.booking_status,''))) NOT IN ('cancelled','canceled'))
)`;

// ── HARD block: a unit must NEVER be deletable (not even with force=true) while a
// booking has a live claim on it. This protects booking history, the financial
// ledger and revenue reports.
//
// Deliberately NOT keyed on `source` — see the note above. A cancelled booking
// releases the flat; provenance does not.
export function isBookingProtected(u: GuardedUnit): boolean {
  const status = (u.status || "").toLowerCase().trim();
  // The lifecycle statuses only the booking flow can set. Whatever the booking
  // row says, a unit still marked booked/registered is occupied.
  if (status === "booked" || status === "registered") return true;
  if (u.booking_id == null) return false;
  // booking_id is set. `undefined` means the caller read the unit without the
  // booking join, and an unknown booking is treated as live — this fails closed,
  // so a future caller that forgets the join over-protects rather than deleting
  // a sold flat.
  return !isBookingClosed(u.booking_status);
}

// Human phrase for the hard-block rejection message.
export function bookingProtectedReason(u: GuardedUnit): string {
  const status = (u.status || "").toLowerCase().trim();
  if (u.booking_id != null) {
    const state = u.booking_status ? ` (${u.booking_status})` : "";
    return `This inventory unit is linked to booking #${u.booking_id}${state} and cannot be deleted.`;
  }
  if (status === "booked" || status === "registered")
    return `This inventory unit has status "${u.status}" and cannot be deleted.`;
  return "This inventory unit is linked to a booking and cannot be deleted.";
}

/**
 * Did a booking ever touch this unit?
 *
 * True for anything the booking flow created or claimed, even after that booking
 * was cancelled and the link cleared — which is exactly what `source` records
 * and the only question it is fit to answer.
 *
 * Used by the whole-building purge, which is a HARD delete and therefore
 * cascades inventory_unit_history away. A flat with booking history keeps that
 * history: the purge archives it (soft delete + detach) instead of removing it.
 * Contrast isBookingProtected(), which asks the different question of whether a
 * booking still HOLDS the flat.
 */
export function hasBookingHistory(u: GuardedUnit): boolean {
  const source = (u.source || "").toLowerCase().trim();
  return u.booking_id != null || source === "booking_sync" || source === "booking sync";
}

/** SQL mirror of {@link hasBookingHistory}, for `iu`-aliased queries. */
export const HAS_BOOKING_HISTORY_SQL = `(
  iu.booking_id IS NOT NULL OR LOWER(TRIM(iu.source)) IN ('booking_sync','booking sync')
)`;

// A unit is "active/linked" (guarded, but overrideable by admin force) if its status
// is on_hold or it points at a real lead, or at a booking that the hard block let
// through (i.e. a cancelled one). A cancelled booking still on the row is worth an
// explicit override rather than a plain delete.
// NOTE: booking-protected units are caught by isBookingProtected() BEFORE this check.
export function isLinkedActive(u: GuardedUnit): boolean {
  return ACTIVE_STATUSES.includes(String(u.status ?? "")) || u.lead_id != null || u.booking_id != null;
}

// Human phrase describing why a unit is guarded (for skip reasons and warnings).
export function linkDescriptor(u: GuardedUnit): string {
  const parts: string[] = [];
  if (u.booking_id) {
    parts.push(isBookingClosed(u.booking_status)
      ? `cancelled booking #${u.booking_id}`
      : `booking #${u.booking_id}`);
  }
  if (u.lead_id) parts.push(`lead #${u.lead_id}`);
  if (parts.length) return parts.join(" / ");
  if (u.status === "on_hold") return "on hold";
  if (ACTIVE_STATUSES.includes(String(u.status ?? ""))) return String(u.status);
  return "active";
}

// Soft-delete one unit + write its audit-trail row. Caller supplies the reason so
// each tier (single/bulk/building/force) records exactly what happened.
export async function softDeleteUnit(client: PoolClient, unit: any, actor: string, reason: string): Promise<void> {
  await client.query(
    `UPDATE inventory_units SET deleted_at = NOW(), updated_by = $2, updated_at = NOW() WHERE id = $1`,
    [unit.id, actor],
  );
  await client.query(
    `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
     VALUES ($1, $2, 'deleted', $3, $4,
             (SELECT organization_id FROM inventory_units WHERE id = $1))`,
    [unit.id, unit.status, actor, reason],
  );
}
