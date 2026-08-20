// lib/tenantGuard.ts — refuse cross-tenant parent/child writes.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// MT-05 Phase 2 stamps organization_id on every INSERT from the authenticated
// session. That alone is not enough for child rows.
//
// Consider POST /api/booking-applications/123/milestones. The session says the
// caller belongs to organization A, so the milestone is stamped A. But `123`
// came from the URL, and nothing has checked that booking 123 belongs to A. A
// caller in organization A could attach a milestone to organization B's booking
// — a row whose organization_id says A hanging off a parent owned by B. The
// tenant column would look correct in isolation and the data would be corrupt.
//
// So wherever a child is written under a parent identified by client-supplied
// input, the parent's organization must be read from the database and compared
// with the session's. Where the parent was created in the same transaction
// there is nothing to check: it was stamped from the same orgId a moment
// earlier, and re-reading it would only be ceremony.
//
// ── Why it throws rather than returning false ───────────────────────────────
// A caller that forgets to branch on a `false` gets a silent cross-tenant
// write, which is the exact failure this prevents. Throwing means the only way
// to ignore the check is to catch it deliberately. Inside `transaction()` the
// throw also rolls the whole thing back, so a half-written child cannot survive.

import type { PoolClient } from "pg";

export class TenantMismatchError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "TenantMismatchError";
  }
}

/**
 * Assert that a parent row exists AND belongs to `orgId`.
 *
 * @param client  the transaction's client, so the check sees uncommitted rows
 *                written earlier in the same transaction.
 * @param table   parent table name. Never interpolated from user input — every
 *                call site passes a string literal.
 * @param id      parent primary key, typically from a route parameter.
 * @param orgId   the session's organization, from getOrganizationId().
 * @param idColumn defaults to "id".
 *
 * @throws TenantMismatchError when the parent is missing, has no organization,
 *         or belongs to a different one.
 *
 * The three cases deliberately produce the SAME message and a 404. Telling a
 * caller "that booking exists but is not yours" confirms the id is real, which
 * turns a blocked cross-tenant write into a working enumeration oracle. "Not
 * found" is all a caller in the wrong tenant is entitled to learn.
 */
export async function assertParentOrganization(
  client: PoolClient,
  table: string,
  id: number | string,
  orgId: string,
  idColumn: string = "id",
): Promise<void> {
  const { rows } = await client.query(
    `SELECT organization_id FROM public.${table} WHERE ${idColumn} = $1`,
    [id],
  );

  if (rows.length === 0) {
    throw new TenantMismatchError(`${table} ${id} was not found.`);
  }

  const parentOrg = rows[0].organization_id as string | null;

  // A NULL parent organization is not "close enough". Until Phase 3 applies
  // NOT NULL, a row written before MT-05 can legitimately have one — and
  // treating that as a match would let the first tenant-ambiguous row become a
  // hole every later write could pass through. Refuse and let it surface.
  if (parentOrg === null || parentOrg !== orgId) {
    throw new TenantMismatchError(`${table} ${id} was not found.`);
  }
}
