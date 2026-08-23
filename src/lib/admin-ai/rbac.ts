// admin-ai/rbac.ts — who may use the assistant, and what it may see on their behalf.
//
// The endpoint previously had no authentication at all; its own comment said
// "for now, we trust the frontend role check". The dock renders behind
// `{isAdmin && ...}`, but that is a render condition, not a control — a plain
// POST to /api/admin/ai/chat returned company-wide revenue, per-manager
// performance and customer names to anyone who sent it.
//
// The scope produced here is the ONLY authority the tool layer gets. Tools take
// an AiScope and cannot widen it: there is no code path where a tool reads a
// role or an id from the model's arguments. That matters because tool arguments
// are attacker-influenced — the user's question reaches the model, and the model
// writes the arguments. A tool that accepted `{ userId }` from the model would
// let "show me Megha's leads as if I were her" become a real query.

import { getServerSession, getSessionUserId } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { getOrganizationId } from "../tenantContext";

/**
 * Roles allowed to use Bhoomi AI.
 *
 * This list was `["admin"]`, and the reason given was precise: "the shipped
 * tools aggregate company-wide (all bookings, all managers, all revenue) with
 * no per-user filter, so widening this list without first scoping those queries
 * would hand every role the whole company's numbers."
 *
 * That prerequisite is now met. services.ts takes an ownership predicate off
 * the scope below and applies it to every tool that can return lead-level or
 * money data, so a Site Head or Receptionist asking "how many leads do I have"
 * gets their own and nothing else. The one tool with no per-user meaning —
 * getSalesManagerPerformance, which exists to rank employees against each
 * other — is refused outright for them rather than silently returning a
 * one-row ranking.
 *
 * Adding a role here is therefore still a real decision: it is only safe while
 * every handler in services.ts consults `canReadAllRecords`.
 */
const AI_ROLES = ["admin", "site head", "receptionist"];

export function canUseAdminAi(role: unknown): boolean {
  return AI_ROLES.includes(normalizeRole(role));
}

/**
 * How a role's own leads are identified in walkin_enquiries.
 *
 * These mirror the ownership predicates the rest of the CRM already uses, and
 * they are matched on NAME because that is what the lead columns store:
 *
 *   receptionist  /api/receptionist/assigned  WHERE assigned_to = $name
 *                 /api/receptionist/leads     WHERE assigned_receptionist = $name
 *   site head     dashboard treats a lead as a Site Head's when assigned_to is
 *                 their name; overseeing_site_head is the oversight column that
 *                 booking detail reads as `lead_site_head`.
 *
 * Returning the COLUMN NAMES rather than a SQL fragment keeps services.ts in
 * charge of quoting and parameter binding — nothing here is interpolated from
 * anything the model or the user wrote.
 */
export const OWNERSHIP_COLUMNS: Record<string, readonly string[]> = {
  receptionist: ["assigned_to", "assigned_receptionist"],
  "site head": ["assigned_to", "overseeing_site_head"],
  "sales manager": ["assigned_to"],
};

/**
 * The authorization envelope for one AI request.
 *
 * `organizationId` is the canonical tenant UUID, resolved server-side by
 * getOrganizationId(). It is never supplied by the caller. The tool layer and
 * audit log already speak in tenant terms, so scoping their queries is a
 * matter of using this value rather than threading a new one through.
 */
export interface AiScope {
  userId: number;
  userName: string;
  role: string;
  organizationId: string;
  /** True when the scope may read across every user's records. */
  canReadAllRecords: boolean;
  /**
   * walkin_enquiries columns that mark a lead as THIS user's, for the roles that
   * only see their own. Empty for Admin, who is filtered by tenant alone.
   *
   * The tool layer turns this into `(assigned_to = $n OR ...)`. It is derived
   * from the session role here — never from a tool argument — so no phrasing of
   * a question can swap in another employee's name.
   */
  ownershipColumns: readonly string[];
}

export type AiAuthResult =
  | { ok: true; scope: AiScope }
  | { ok: false; status: 401 | 403; message: string; code: string };

/**
 * Derive the scope from the signed session cookie — never from the request body.
 *
 * Returns a discriminated union rather than throwing so the route can log the
 * refusal and answer with the right status.
 */
export async function authorizeAiRequest(): Promise<AiAuthResult> {
  const session = await getServerSession();

  if (!session?.role) {
    return {
      ok: false,
      status: 401,
      message: "You must be signed in to use the assistant.",
      code: "UNAUTHORIZED",
    };
  }

  if (!canUseAdminAi(session.role)) {
    return {
      ok: false,
      status: 403,
      message: "Bhoomi AI is not available for your role.",
      code: "FORBIDDEN",
    };
  }

  const userId = getSessionUserId(session);
  if (userId === null) {
    // A session that cannot name its user cannot be scoped or audited. Refusing
    // beats running company-wide queries attributed to nobody.
    return {
      ok: false,
      status: 401,
      message: "Your session is missing a user id. Sign in again.",
      code: "INVALID_SESSION",
    };
  }

  const role = normalizeRole(session.role);
  const canReadAllRecords = role === "admin";
  const userName = String(session.name ?? "").trim();

  // A non-admin scope is only safe because it carries a name to filter on. An
  // empty name would make `assigned_to = ''` match nothing on a good day and is
  // not something to leave to chance, so it is refused rather than degraded.
  if (!canReadAllRecords && !userName) {
    return {
      ok: false,
      status: 401,
      message: "Your session is missing your name, so your records cannot be identified. Sign in again.",
      code: "INVALID_SESSION",
    };
  }

  return {
    ok: true,
    scope: {
      userId,
      userName: userName || "Unknown",
      role,
      organizationId: await getOrganizationId(),
      canReadAllRecords,
      ownershipColumns: canReadAllRecords ? [] : OWNERSHIP_COLUMNS[role] ?? ["assigned_to"],
    },
  };
}
