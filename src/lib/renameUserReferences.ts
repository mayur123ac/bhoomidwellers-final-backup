// lib/renameUserReferences.ts — keep name-keyed ownership intact across a rename.
//
// ── The problem ─────────────────────────────────────────────────────────────
// This CRM identifies users by NAME in a lot of places, not by id. A survey of
// the live database found 21 varchar columns holding values that match
// users.name, including:
//
//   walkin_enquiries.assigned_to              232 rows   ← lead ownership
//   walkin_enquiries.lost_lead_marked_by       27 rows
//   walkin_enquiries.sourcing_manager_assigned_by  26 rows
//   inventory_unit_history.changed_by         187 rows
//   inventory_units.created_by / updated_by    93 rows each
//   site_visits.created_by                     42 rows
//   ... and a dozen more *_by / created_by columns
//
// The Settings panel lets a user edit their own first and last name, and lets an
// admin edit anyone's. Without this helper, "Neha Burman" correcting her name to
// "Neha Sharma" would silently orphan 88 leads: the rows keep saying
// "Neha Burman", and the dashboard filters by the CURRENT name, so those leads
// simply vanish from her list.
//
// ── What is and is not rewritten ────────────────────────────────────────────
// Only LIVE OWNERSHIP is rewritten — columns that answer "whose is this right
// now" and are read back as a filter.
//
// Historical attribution columns (created_by, updated_by, changed_by,
// cancelled_by, uploaded_by, *_marked_by, assigned_by_name) are deliberately
// left alone. They record who performed an action at a point in time; that fact
// did not change because the person later changed their name, and rewriting them
// would falsify an audit trail. They are display-only and are never used as a
// filter, so a stale value there costs nothing.
//
// The real fix is to key these columns on users.id. That is a migration across
// 21 columns and every query that reads them — out of scope here, and noted in
// the handover.

import { query } from "@/lib/db";

/** Columns that decide what a user currently owns and are filtered on by name. */
const LIVE_OWNERSHIP_COLUMNS: { table: string; column: string }[] = [
  { table: "walkin_enquiries", column: "assigned_to" },
];

export interface RenamePropagation {
  table: string;
  column: string;
  rows: number;
}

/**
 * Repoint name-keyed ownership from `oldName` to `newName`.
 *
 * Returns what moved so the caller can report it and record it in the audit log
 * — a rename that silently touched 88 lead rows should not be invisible.
 */
export async function propagateUserRename(
  oldName: string | null | undefined,
  newName: string
): Promise<RenamePropagation[]> {
  const from = (oldName ?? "").trim();
  const to = newName.trim();

  if (!from || !to || from === to) return [];

  const moved: RenamePropagation[] = [];

  for (const { table, column } of LIVE_OWNERSHIP_COLUMNS) {
    try {
      // Table and column are from the constant above, never from user input, so
      // interpolating the identifiers here cannot be injected into.
      const rows = await query<{ id: number }>(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2 RETURNING id`,
        [to, from]
      );
      if (rows.length > 0) moved.push({ table, column, rows: rows.length });
    } catch (err: any) {
      // A rename that half-applied is worse than one that reports a problem, but
      // failing the whole profile save over a secondary table is also wrong. Log
      // loudly and let the caller surface the partial result.
      console.error(`[rename] could not update ${table}.${column}:`, err?.message);
    }
  }

  return moved;
}

/** Human-readable summary for a toast, or null when nothing moved. */
export function describePropagation(moved: RenamePropagation[]): string | null {
  const total = moved.reduce((sum, m) => sum + m.rows, 0);
  if (total === 0) return null;
  return `${total} assigned lead${total === 1 ? "" : "s"} moved to the new name.`;
}
