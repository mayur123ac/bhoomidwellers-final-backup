// lib/tenantContext.ts — the single server-side source of tenant identity.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Before MT-02 the tenant was the integer literal `1`, written directly into
// seventeen files. That is not a tenant model; it is the same assumption typed
// out seventeen times, and it silently becomes a cross-tenant data leak the
// moment a second organization exists.
//
// Every tenant-scoped query now gets its organization id from here, and only
// from here. Two rules follow:
//
//   1. The Bhoomi UUID is NEVER hardcoded — not here, not anywhere. It is
//      resolved from public.organizations. Hardcoding it in one file is only
//      marginally better than hardcoding `1` in seventeen.
//   2. The organization id NEVER comes from the client. Not from the body, the
//      query string, a header, a cookie or localStorage. A caller cannot pass
//      one in, because no function here accepts one.
//
// ── Resolution order (MT-05) ────────────────────────────────────────────────
// 1. The signed session's `org` claim, stamped at login from
//    users.organization_id. This is the real answer, and it is per-request.
// 2. Failing that, "the only organization that exists".
//
// Step 2 is not dead code and is not a convenience. Three kinds of caller
// legitimately have no session cookie to read:
//   • login itself — lib/loginNotification.ts resolves the organization while
//     the session is still being minted, so a session-only resolver would
//     break the very request that creates the session;
//   • provider webhooks (Bolna call callbacks), which arrive from outside the
//     browser entirely;
//   • scripts and jobs running outside any request context.
// For those, sole-organization resolution is correct while exactly one
// organization exists, and it refuses to guess the moment that stops being
// true: zero organizations throws, and more than one throws. It does not pick
// the first row, and it does not fall back to legacy_int_id = 1. A hard failure
// at that moment is the entire point — the alternative is serving Bhoomi's data
// to Viraj and never being told.
//
// So after MT-05 the picture is: every request carrying a session is already
// multi-tenant correct; every sessionless path still needs an explicit
// organization before a second tenant can be onboarded. Those paths are listed
// in the MT-05 report.

import type { PoolClient } from "pg";
import { getPool } from "./db";

/** Server-side tenant context. Never constructed from client input. */
export interface TenantContext {
  organizationId: string;
}

export class TenantResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantResolutionError";
  }
}

// Short-lived cache. A TTL rather than a permanent memo on purpose: if a second
// organization is created while the process is running, the cache expires within
// a minute and every tenant-scoped query starts failing loudly. A permanent memo
// would keep happily serving the first tenant's id to the second tenant.
const CACHE_TTL_MS = 60_000;
let cachedId: string | null = null;
let cachedAt = 0;

/** Drop the cached id. Used by tests and after provisioning a new tenant. */
export function clearTenantCache(): void {
  cachedId = null;
  cachedAt = 0;
}

async function resolveSoleOrganization(client?: PoolClient): Promise<string> {
  const sql = `SELECT id FROM public.organizations ORDER BY created_at LIMIT 2`;
  const rows = client
    ? (await client.query(sql)).rows
    : (await getPool().query(sql)).rows;

  if (rows.length === 0) {
    throw new TenantResolutionError(
      "No organization exists. MT-01 must run before any tenant-scoped query."
    );
  }
  if (rows.length > 1) {
    throw new TenantResolutionError(
      "More than one organization exists, but the session carries no organization " +
        "claim, so the tenant cannot be determined. Refusing to guess. " +
        "The session org claim must ship before a second tenant is onboarded."
    );
  }
  return rows[0].id as string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `org` claim from the signed session, or null when there is no usable one.
 *
 * Never throws. A caller with no request context (a script, a job, a webhook)
 * must fall through to sole-organization resolution rather than crash, and
 * `cookies()` throws outside a request scope — hence the catch.
 *
 * The claim is read from the SIGNED payload: `verifySession` has already
 * rejected any cookie whose signature does not match, so a claim that arrives
 * here was minted by this server. The shape check is belt and braces against a
 * malformed-but-correctly-signed payload, so a bad value degrades to the
 * fallback instead of being interpolated into a query as a tenant id.
 */
async function organizationIdFromSession(): Promise<string | null> {
  try {
    const { getServerSession } = await import("./serverAuth");
    const session = await getServerSession();
    const org = (session as { org?: unknown } | null)?.org;
    return typeof org === "string" && UUID_RE.test(org) ? org : null;
  } catch {
    return null;
  }
}

/**
 * The current organization id, as a UUID string.
 *
 * @param client optional PoolClient, so callers already inside a transaction
 *               resolve on the same connection rather than deadlocking against
 *               their own open transaction.
 */
export async function getOrganizationId(client?: PoolClient): Promise<string> {
  // Checked first and NEVER cached in module scope. The sole-organization id
  // below is a property of the database and is safe to memoise; the session
  // claim is a property of *this request*, and caching it in a module variable
  // would serve one signed-in user's organization to the next request that
  // happened to arrive on the same server instance. That is the precise bug
  // this whole phase exists to prevent.
  const fromSession = await organizationIdFromSession();
  if (fromSession) return fromSession;

  const now = Date.now();
  if (cachedId && now - cachedAt < CACHE_TTL_MS) return cachedId;

  const id = await resolveSoleOrganization(client);
  cachedId = id;
  cachedAt = now;
  return id;
}

/** Convenience wrapper for call sites that want the whole context object. */
export async function getTenantContext(client?: PoolClient): Promise<TenantContext> {
  return { organizationId: await getOrganizationId(client) };
}

