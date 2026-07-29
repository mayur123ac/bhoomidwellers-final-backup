// sourcingAssignment.ts — server-side helpers for Sourcing Manager ownership.
//
// Three write paths now assign a Sourcing Manager (CP enquiry intake, CP
// office-visit registration, Admin reassignment) and every one of them has to
// answer the same question: "is this id actually an active Sourcing Manager?".
// Without that check an assignment can be parked on a Receptionist or a
// deactivated account, where it is invisible on every Sourcing Manager panel and
// looks like data loss rather than a bad id.
//
// The role predicate is duplicated as SQL rather than reusing normalizeRole from
// @/lib/cpRbac because it has to run inside the query — the same
// underscore-normalizing comparison /api/users/sourcing-manager uses, so the
// dropdown and the validator can never disagree about who is eligible.
import type { PoolClient } from "pg";
import { query } from "@/lib/db";

/** Matches "Sourcing Manager", "sourcing_manager", " SOURCING MANAGER " alike. */
export const SOURCING_MANAGER_ROLE_PREDICATE =
  `REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sourcing manager'`;

export type ParsedAssignee =
  /** Field absent — the caller expressed no opinion; leave the assignment alone. */
  | { kind: "absent" }
  /** Explicit null/"" — clear the assignment. */
  | { kind: "clear" }
  | { kind: "id"; id: number }
  | { kind: "invalid" };

/**
 * Parses a client-supplied assignee id. "absent" and "clear" are kept distinct
 * because PATCH must be able to tell "don't touch the assignment" from
 * "unassign this partner".
 */
export function parseAssignee(raw: any): ParsedAssignee {
  if (raw === undefined) return { kind: "absent" };
  if (raw === null || raw === "") return { kind: "clear" };
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? { kind: "id", id: n } : { kind: "invalid" };
}

/**
 * True when `id` belongs to an active user whose role is Sourcing Manager.
 * Pass the transaction's client when the caller is inside one, so the check sees
 * the same snapshot as the write it is guarding.
 */
export async function isActiveSourcingManager(
  id: number,
  client?: PoolClient
): Promise<boolean> {
  const sql =
    `SELECT id FROM users
      WHERE id = $1
        AND is_active = true
        AND ${SOURCING_MANAGER_ROLE_PREDICATE}
      LIMIT 1`;
  if (client) {
    const res = await client.query(sql, [id]);
    return res.rows.length > 0;
  }
  const rows = await query(sql, [id]);
  return rows.length > 0;
}

/** How many active Sourcing Managers exist at all. */
export async function countActiveSourcingManagers(client?: PoolClient): Promise<number> {
  const sql = `SELECT COUNT(*)::int AS c FROM users WHERE is_active = true AND ${SOURCING_MANAGER_ROLE_PREDICATE}`;
  if (client) {
    const res = await client.query(sql);
    return Number(res.rows[0]?.c ?? 0);
  }
  const rows = await query<{ c: number }>(sql);
  return Number(rows[0]?.c ?? 0);
}

/**
 * The Sourcing Manager a registered partner already belongs to, if any.
 *
 * This is what makes a CP enquiry route itself: the receptionist types the
 * partner's phone number, that resolves to a partner row, and the partner's
 * existing owner takes the lead — no matter who the form happened to have
 * selected. A partner registered under one manager cannot have their leads
 * quietly land on another manager's desk because of a mis-click at the front desk.
 *
 * Returns null when the partner has no owner, or when the owner is no longer an
 * active Sourcing Manager. That second case matters: routing to a deactivated
 * account would file the lead where no panel displays it, so it falls back to
 * whatever the caller chose instead.
 */
export async function resolvePartnerOwner(
  client: PoolClient,
  partnerId: number
): Promise<{ id: number; name: string } | null> {
  const res = await client.query(
    `SELECT sm.id, sm.name
       FROM channel_partners cp
       JOIN users sm ON sm.id = cp.assigned_sourcing_manager_id
      WHERE cp.id = $1
        AND sm.is_active = true
        AND REPLACE(LOWER(TRIM(sm.role)), '_', ' ') = 'sourcing manager'`,
    [partnerId]
  );
  return res.rows.length > 0 ? { id: res.rows[0].id, name: res.rows[0].name } : null;
}

/**
 * Stamp a partner's owner, but only if they do not already have one.
 *
 * Called from CP enquiry intake: the receptionist picks a Sourcing Manager for
 * the *enquiry*, and the partner behind that enquiry inherits it. A partner who
 * already has an owner keeps them — otherwise every new enquiry would silently
 * move the partner to whoever the receptionist happened to pick this time, and
 * partners would drift between panels with no audit trail.
 *
 * Returns the id now on the record (existing or newly set), or null.
 */
export async function claimPartnerForSourcingManager(
  client: PoolClient,
  partnerId: number,
  sourcingManagerId: number,
  assignedBy: string
): Promise<number | null> {
  const res = await client.query(
    `UPDATE channel_partners
        SET assigned_sourcing_manager_id = $1,
            assigned_sourcing_manager_at = now(),
            assigned_sourcing_manager_by = $2
      WHERE id = $3
        AND assigned_sourcing_manager_id IS NULL
      RETURNING assigned_sourcing_manager_id`,
    [sourcingManagerId, assignedBy, partnerId]
  );
  if (res.rows.length > 0) return res.rows[0].assigned_sourcing_manager_id;

  const existing = await client.query(
    `SELECT assigned_sourcing_manager_id FROM channel_partners WHERE id = $1`,
    [partnerId]
  );
  return existing.rows[0]?.assigned_sourcing_manager_id ?? null;
}
