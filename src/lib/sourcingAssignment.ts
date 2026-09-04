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
import { getOrganizationId } from "@/lib/tenantContext";
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
  // The id being validated comes from a request (an assignment dropdown), so the
  // organization predicate is what stops a manager from another tenant being
  // accepted as a valid assignee.
  const sql =
    `SELECT id FROM users
      WHERE id = $1
        AND organization_id = $2
        AND is_active = true
        AND ${SOURCING_MANAGER_ROLE_PREDICATE}
      LIMIT 1`;
  const orgId = await getOrganizationId(client);
  if (client) {
    const res = await client.query(sql, [id, orgId]);
    return res.rows.length > 0;
  }
  const rows = await query(sql, [id, orgId]);
  return rows.length > 0;
}

/** Matches "Sales Manager", "sales_manager", " SALES MANAGER " alike. */
export const SALES_MANAGER_ROLE_PREDICATE =
  `REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sales manager'`;

/**
 * True when `id` belongs to an active user whose role is Sales Manager.
 */
export async function isActiveSalesManager(
  id: number,
  client?: PoolClient
): Promise<boolean> {
  const sql =
    `SELECT id FROM users
      WHERE id = $1
        AND organization_id = $2
        AND is_active = true
        AND ${SALES_MANAGER_ROLE_PREDICATE}
      LIMIT 1`;
  const orgId = await getOrganizationId(client);
  if (client) {
    const res = await client.query(sql, [id, orgId]);
    return res.rows.length > 0;
  }
  const rows = await query(sql, [id, orgId]);
  return rows.length > 0;
}

/** How many active Sourcing Managers exist at all. */
export async function countActiveSourcingManagers(client?: PoolClient): Promise<number> {
  // Counts THIS organization's managers. Unscoped, the "no sourcing managers
  // configured" branch would never fire for a tenant that has none, because some
  // other tenant's managers would be counted on their behalf.
  const sql = `SELECT COUNT(*)::int AS c FROM users WHERE is_active = true AND organization_id = $1 AND ${SOURCING_MANAGER_ROLE_PREDICATE}`;
  const orgId = await getOrganizationId(client);
  if (client) {
    const res = await client.query(sql, [orgId]);
    return Number(res.rows[0]?.c ?? 0);
  }
  const rows = await query<{ c: number }>(sql, [orgId]);
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
       JOIN users sm
         ON sm.id = cp.assigned_sourcing_manager_id AND sm.organization_id = cp.organization_id
      WHERE cp.id = $1
        AND cp.organization_id = $2
        AND sm.is_active = true
        AND REPLACE(LOWER(TRIM(sm.role)), '_', ' ') = 'sourcing manager'`,
    [partnerId, await getOrganizationId(client)]
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
        AND organization_id = $4
        AND assigned_sourcing_manager_id IS NULL
      RETURNING assigned_sourcing_manager_id`,
    [sourcingManagerId, assignedBy, partnerId, await getOrganizationId(client)]
  );
  if (res.rows.length > 0) return res.rows[0].assigned_sourcing_manager_id;

  const existing = await client.query(
    `SELECT assigned_sourcing_manager_id FROM channel_partners WHERE id = $1 AND organization_id = $2`,
    [partnerId, await getOrganizationId(client)]
  );
  return existing.rows[0]?.assigned_sourcing_manager_id ?? null;
}
