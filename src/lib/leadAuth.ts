// lib/leadAuth.ts — server-side lead authorization helpers.
//
// Centralises ownership checks so every mutation handler that touches a lead
// derives access from the same rules, not from a copy-and-paste predicate.
//
// Design constraints:
//  - All inputs come from the server (session + DB row), never from client body.
//  - "Org-wide" roles (admin, site head) bypass per-record ownership.
//  - ID-first: if the FK column is populated, it is the authority; the name
//    string is only used as a fallback for pre-migration rows where FK = NULL.

import { normalizeRole } from "./cpRbac";

/**
 * Roles that can be the primary assignee (assigned_to) on a lead.
 * Admin is intentionally excluded: admins orchestrate, they don't own leads.
 */
export const LEAD_ASSIGNABLE_ROLES: ReadonlySet<string> = new Set([
  "sales manager",
  "senior sales manager",
  "site head",
  "receptionist",
]);

/** Roles that identify themselves via the receptionist ownership column. */
export const RECEPTIONIST_ROLES: ReadonlySet<string> = new Set(["receptionist"]);

/**
 * Roles that may read/write any lead in the organisation, regardless of who
 * it is assigned to.
 */
export const ORG_WIDE_LEAD_ROLES: ReadonlySet<string> = new Set(["admin", "site head"]);

/**
 * Returns true when `role` is a valid lead assignee.
 * Prevents admins, sourcing managers, or unknown roles being stamped as owners.
 */
export function isAssignableRole(role: unknown): boolean {
  return LEAD_ASSIGNABLE_ROLES.has(normalizeRole(role));
}

/** Returns true when the role uses the receptionist ownership column. */
export function isReceptionistRole(role: unknown): boolean {
  return RECEPTIONIST_ROLES.has(normalizeRole(role));
}

/**
 * Determines whether the calling session may edit a specific lead.
 *
 * A session can edit if:
 *  - Their role is org-wide (admin / site head), OR
 *  - Their user ID matches any of the three ownership FK columns, OR
 *  - The FK column is NULL (pre-migration row) and their display name matches
 *    the corresponding name string column.
 *
 * The lead object must include the six ownership columns below. Callers should
 * SELECT those explicitly (or SELECT *) before calling this function.
 */
export function canEditLead(opts: {
  sessionRole: string;
  sessionUserId: number | null;
  sessionName: string;
  lead: {
    assigned_to_user_id: number | null;
    assigned_receptionist_user_id: number | null;
    overseeing_site_head_user_id: number | null;
    assigned_to: string | null;
    assigned_receptionist: string | null;
    overseeing_site_head: string | null;
  };
}): boolean {
  const role = normalizeRole(opts.sessionRole);

  // Org-wide roles bypass per-record ownership.
  if (ORG_WIDE_LEAD_ROLES.has(role)) return true;

  // A session without a resolvable userId cannot be matched against FKs.
  // Do NOT fall back to name-only matching when the session has no ID — that
  // would let a forged session with a matching name bypass the check.
  if (opts.sessionUserId === null) return false;

  const {
    assigned_to_user_id,
    assigned_receptionist_user_id,
    overseeing_site_head_user_id,
    assigned_to,
    assigned_receptionist,
    overseeing_site_head,
  } = opts.lead;

  // ID-first: trust the FK column when it is populated.
  if (assigned_to_user_id !== null && assigned_to_user_id === opts.sessionUserId) return true;
  if (assigned_receptionist_user_id !== null && assigned_receptionist_user_id === opts.sessionUserId) return true;
  if (overseeing_site_head_user_id !== null && overseeing_site_head_user_id === opts.sessionUserId) return true;

  // Name fallback: only applies when the corresponding FK is NULL
  // (pre-migration row that has never been backfilled).
  const me = opts.sessionName.trim().toLowerCase();
  if (!me) return false;

  if (assigned_to_user_id === null && (assigned_to ?? "").trim().toLowerCase() === me) return true;
  if (assigned_receptionist_user_id === null && (assigned_receptionist ?? "").trim().toLowerCase() === me) return true;
  if (overseeing_site_head_user_id === null && (overseeing_site_head ?? "").trim().toLowerCase() === me) return true;

  return false;
}
