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
 * Roles allowed to use the Admin AI.
 *
 * Admin only, matching the dock's existing render gate and the feature's name.
 * The five shipped tools aggregate company-wide (all bookings, all managers,
 * all revenue) with no per-user filter, so widening this list without first
 * scoping those queries would hand every role the whole company's numbers.
 * `canUseAdminAi` is the single place to change when that day comes.
 */
const AI_ROLES = ["admin"];

export function canUseAdminAi(role: unknown): boolean {
  return AI_ROLES.includes(normalizeRole(role));
}

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
      message: "The AI assistant is available to Admins only.",
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

  return {
    ok: true,
    scope: {
      userId,
      userName: String(session.name ?? "Unknown"),
      role: normalizeRole(session.role),
      organizationId: await getOrganizationId(),
      canReadAllRecords: normalizeRole(session.role) === "admin",
    },
  };
}
