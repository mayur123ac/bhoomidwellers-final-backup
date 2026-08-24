// lib/whatsappAccess.ts — who may see and act on a WhatsApp conversation.
//
// ── This is not a new permission system  (spec §8) ──────────────────────────
// A conversation is visible exactly when the LEAD behind it is visible. There is
// no per-conversation ACL, no sharing model and no new role vocabulary; this
// module translates the CRM's existing lead-ownership rules into a SQL predicate
// and a matching in-process check.
//
// The ownership columns are the ones already documented in lib/admin-ai/rbac.ts
// OWNERSHIP_COLUMNS, and they are matched on NAME because that is what
// walkin_enquiries stores — assigned_to, assigned_receptionist and
// overseeing_site_head are all varchar names, not user ids.
//
// Two consumers must agree, which is the reason this is one module rather than a
// rule written twice:
//
//   • the list/read routes, which need a WHERE clause;
//   • the SSE broadcaster, which needs to decide per subscriber whether an event
//     may be pushed down an already-open stream.
//
// The SSE side is why the in-process check exists at all. Broadcasting a message
// org-wide and filtering in the browser would put other people's customer
// messages on the wire — the exact class of bug that made three global SSE
// registries leak whole lead rows across tenants.

import { normalizeRole } from "./cpRbac";

/** Sees every conversation in the organization. */
const FULL_ACCESS_ROLES = ["admin", "super admin"];

/**
 * May associate an unmatched or ambiguous thread with a lead (spec §5).
 *
 * Restricted to the two roles that already arbitrate lead ownership. A sales
 * manager attaching an unknown number to one of their own leads is precisely the
 * mis-association the ambiguous state exists to prevent.
 */
const ASSOCIATE_ROLES = ["admin", "super admin", "site head"];

/**
 * Sees threads that belong to no lead yet.
 *
 * Same two roles, plus the reason: an unmatched thread has no owner, so
 * ownership cannot decide who sees it. Somebody has to, and it should be the
 * people who can resolve it.
 */
const UNMATCHED_VISIBILITY_ROLES = ASSOCIATE_ROLES;

export interface Viewer {
  userId: number | null;
  name: string;
  role: string;
  organizationId: string;
}

export const canSeeAllConversations = (role: unknown) =>
  FULL_ACCESS_ROLES.includes(normalizeRole(role));

export const canAssociateConversations = (role: unknown) =>
  ASSOCIATE_ROLES.includes(normalizeRole(role));

export const canSeeUnmatched = (role: unknown) =>
  UNMATCHED_VISIBILITY_ROLES.includes(normalizeRole(role));

/**
 * The lead columns that make a lead "this viewer's".
 *
 * Mirrors OWNERSHIP_COLUMNS in lib/admin-ai/rbac.ts. Sourcing Manager is absent
 * deliberately: their book is channel partners, and sourcing_manager_id is an
 * id-based relationship to a partner, not a name on the lead. Giving them a
 * name-matched predicate here would silently grant them any lead whose
 * assigned_to happened to equal their name.
 */
const OWNERSHIP_COLUMNS: Record<string, readonly string[]> = {
  receptionist: ["assigned_to", "assigned_receptionist"],
  "site head": ["assigned_to", "overseeing_site_head"],
  "sales manager": ["assigned_to"],
};

export function ownershipColumnsFor(role: unknown): readonly string[] {
  return OWNERSHIP_COLUMNS[normalizeRole(role)] ?? [];
}

export interface ScopeClause {
  /** SQL fragment for a WHERE, already parenthesised. Never interpolates user input. */
  sql: string;
  /** Values to append to the caller's parameter list, in order. */
  params: unknown[];
}

/**
 * Builds the visibility predicate for a conversation list query.
 *
 * @param viewer      resolved server-side from the signed session.
 * @param nextParam   the caller's next free $n placeholder index.
 * @param convAlias   alias of whatsapp_conversations in the query.
 * @param leadAlias   alias of the LEFT JOINed walkin_enquiries.
 *
 * Column names come from the table above, never from a request, so the
 * interpolation below cannot carry attacker input. Every VALUE is bound.
 *
 * A role with no ownership columns and no full access gets `false` — it sees
 * nothing. Failing closed matters here: a role added to the CRM later must not
 * silently inherit every customer conversation because nobody remembered to add
 * it to this file.
 */
export function conversationScope(
  viewer: Viewer,
  nextParam: number,
  convAlias = "c",
  leadAlias = "l"
): ScopeClause {
  if (canSeeAllConversations(viewer.role)) {
    return { sql: "TRUE", params: [] };
  }

  const cols = ownershipColumnsFor(viewer.role);
  if (cols.length === 0) {
    return { sql: "FALSE", params: [] };
  }

  const params: unknown[] = [];
  let p = nextParam;

  // Name comparison is trimmed and case-insensitive: the same person appears as
  // "Megha", "megha " and "MEGHA" across leads entered by different people at
  // the front desk, and an exact match silently hides their own leads from them.
  const namePlaceholder = `$${p++}`;
  params.push(viewer.name);

  const owned = cols
    .map((col) => `lower(btrim(${leadAlias}.${col})) = lower(btrim(${namePlaceholder}))`)
    .join(" OR ");

  const parts = [`(${leadAlias}.id IS NOT NULL AND (${owned}))`];

  if (canSeeUnmatched(viewer.role)) {
    parts.push(`(${convAlias}.match_state <> 'matched')`);
  }

  return { sql: `(${parts.join(" OR ")})`, params };
}

/**
 * Visibility predicate for a LEAD, with no conversation in the query.
 *
 * conversationScope's unmatched branch reads c.match_state, so using it where
 * only walkin_enquiries is joined would need a fake conversation alias. This is
 * the same ownership rule with that branch removed — which is correct here, since
 * a lead lookup is by definition a matched case.
 */
export function leadScope(
  viewer: Viewer,
  nextParam: number,
  leadAlias = "l"
): ScopeClause {
  if (canSeeAllConversations(viewer.role)) {
    return { sql: "TRUE", params: [] };
  }

  const cols = ownershipColumnsFor(viewer.role);
  if (cols.length === 0) return { sql: "FALSE", params: [] };

  const placeholder = `$${nextParam}`;
  const owned = cols
    .map((col) => `lower(btrim(${leadAlias}.${col})) = lower(btrim(${placeholder}))`)
    .join(" OR ");

  return { sql: `(${owned})`, params: [viewer.name] };
}

/**
 * The in-process twin of conversationScope, for the SSE broadcaster.
 *
 * Takes the lead's ownership fields as they are at broadcast time rather than
 * re-querying: the broadcaster already holds the lead row, and an SSE fan-out
 * must not issue one database round trip per open connection.
 */
export interface EventVisibility {
  leadId: number | null;
  matchState: string;
  assignedTo?: string | null;
  assignedReceptionist?: string | null;
  overseeingSiteHead?: string | null;
}

const eq = (a: string | null | undefined, b: string) =>
  String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

export function canViewerSee(viewer: Viewer, v: EventVisibility): boolean {
  if (canSeeAllConversations(viewer.role)) return true;

  if (v.matchState !== "matched") return canSeeUnmatched(viewer.role);

  const cols = ownershipColumnsFor(viewer.role);
  if (cols.length === 0) return false;

  const name = viewer.name;
  for (const col of cols) {
    if (col === "assigned_to" && eq(v.assignedTo, name)) return true;
    if (col === "assigned_receptionist" && eq(v.assignedReceptionist, name)) return true;
    if (col === "overseeing_site_head" && eq(v.overseeingSiteHead, name)) return true;
  }
  return false;
}
