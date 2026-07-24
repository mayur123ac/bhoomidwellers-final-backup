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

// ── HARD block: a unit must NEVER be deletable (not even with force=true) when it is
// booked, registered, linked to a booking application, or created by booking sync.
// This protects booking history, financial ledger, and revenue reports.
export function isBookingProtected(u: any): boolean {
  const status = (u.status || "").toLowerCase().trim();
  const source = (u.source || "").toLowerCase().trim();
  if (status === "booked" || status === "registered") return true;
  if (u.booking_id != null) return true;
  if (source === "booking sync" || source === "booking_sync") return true;
  return false;
}

// Human phrase for the hard-block rejection message.
export function bookingProtectedReason(u: any): string {
  const parts: string[] = [];
  if (u.booking_id) parts.push(`booking #${u.booking_id}`);
  if (parts.length) return `This inventory unit is linked to ${parts.join(" / ")} and cannot be deleted.`;
  const status = (u.status || "").toLowerCase().trim();
  if (status === "booked" || status === "registered") return `This inventory unit has status "${u.status}" and cannot be deleted.`;
  return "This inventory unit is linked to a booking and cannot be deleted.";
}

// A unit is "active/linked" (guarded, but overrideable by admin force) if its status
// is on_hold or it points at a real lead (without a booking reference).
// NOTE: booking-protected units are caught by isBookingProtected() BEFORE this check.
export function isLinkedActive(u: any): boolean {
  return ACTIVE_STATUSES.includes(u.status) || u.lead_id != null || u.booking_id != null;
}

// Human phrase describing why a unit is guarded (for skip reasons and warnings).
export function linkDescriptor(u: any): string {
  const parts: string[] = [];
  if (u.booking_id) parts.push(`booking #${u.booking_id}`);
  if (u.lead_id) parts.push(`lead #${u.lead_id}`);
  if (parts.length) return parts.join(" / ");
  if (u.status === "on_hold") return "on hold";
  if (ACTIVE_STATUSES.includes(u.status)) return u.status;
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
    `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
     VALUES ($1, $2, 'deleted', $3, $4)`,
    [unit.id, unit.status, actor, reason],
  );
}
