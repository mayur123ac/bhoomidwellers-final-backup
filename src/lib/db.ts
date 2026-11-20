// lib/db.ts
import { Pool, PoolClient } from "pg";
import { createResolvingSocket } from "./dnsFallback";

/**
 * Neon endpoints that are PRODUCTION and must never be opened from a developer
 * machine. Endpoint ids only — no credentials, and nothing secret: these are the
 * same identifiers that appear in a Neon dashboard URL.
 *
 * `ep-mute-credit-a1kaw2vj` is a frozen snapshot branch of production and is
 * listed for the same reason.
 */
const PRODUCTION_ENDPOINTS = ["ep-long-cloud-a1d5t8of", "ep-mute-credit-a1kaw2vj"];

/**
 * Refuse to open a production connection from a development process.
 *
 * This exists because a stale `next dev` kept a production DATABASE_URL in
 * memory after .env.local had been corrected, and the mismatch only surfaced as
 * a confusing "column organization_id does not exist" on login — the schema
 * error was the safety net, which is not a safety net at all.
 *
 * It throws BEFORE the Pool is constructed, so no socket is opened. It is scoped
 * to NODE_ENV !== "production" precisely so the deployed application, which is
 * *supposed* to use that endpoint, is unaffected.
 */
function assertNotProductionInDev(connectionString: string | undefined): void {
  if (!connectionString) return;
  if (process.env.NODE_ENV === "production") return;
  if (process.env.ALLOW_PROD_DB_IN_DEV === "1") return; // deliberate, explicit opt-out

  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return; // not a URL we can reason about; leave it alone
  }

  const hit = PRODUCTION_ENDPOINTS.find((ep) => hostname.startsWith(ep));
  if (!hit) return;

  throw new Error(
    `[DB] Refusing to connect: DATABASE_URL points at the PRODUCTION Neon branch (${hit}) ` +
      `while NODE_ENV is "${process.env.NODE_ENV ?? "development"}". ` +
      `Local development must use the test branch. Fix DATABASE_URL in frontend/.env.local ` +
      `and RESTART the dev server — Next.js reads env once at startup, so editing the file ` +
      `is not enough on its own. ` +
      `Set ALLOW_PROD_DB_IN_DEV=1 only if you genuinely intend to read production.`
  );
}

// ── Pool singleton ──────────────────────────────────────────────────────────
// Stored on globalThis so that Next.js HMR in `next dev` reuses the same pool
// instead of creating an orphan pool on every module re-evaluation. Each orphan
// holds up to `max` connections against Neon, which has a finite connection
// limit. In production (serverless) globalThis is per-isolate, so this is a
// no-op there — exactly as intended.
const POOL_KEY = "__bd_pg_pool";

export function getPool(): Pool {
  const g = globalThis as Record<string, any>;
  if (g[POOL_KEY]) return g[POOL_KEY] as Pool;

  assertNotProductionInDev(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // ── Pool sizing ───────────────────────────────────────────────────────
    // Raised from 10 to 25. The overview-kpis endpoint alone fires ~20
    // parallel queries via Promise.all; with max=10, 10 of those get a
    // connection while the other 10 queue, and any concurrent request times
    // out waiting. Neon's pooler (PgBouncer) supports 100+ downstream
    // connections per endpoint, so 25 is well within limits.
    max: 25,
    idleTimeoutMillis: 30_000,
    // 15s, not 5s. Neon suspends an idle compute, and the first connection
    // after that has to wake it, negotiate TLS and authenticate. At 5s that
    // race was lost often enough that the first request against a freshly
    // started server returned `Connection terminated due to connection
    // timeout` — surfacing on the login screen as "Login failed. Something
    // went wrong.", while a retry seconds later succeeded.
    connectionTimeoutMillis: 15_000,
    // Safety net: no single statement should run longer than 30s. Without
    // this, a runaway query (e.g. recursive CTE on malformed data) holds a
    // connection indefinitely, contributing to pool starvation.
    statement_timeout: 30_000,
    // In serverless (Vercel), allow the pool to drain so the function can
    // exit and be reclaimed. Without this, idle connections keep the event
    // loop alive and the function never freezes.
    allowExitOnIdle: true,
    // Socket factory whose only difference from a plain net.Socket is the DNS
    // path: the system resolver is tried first, and public resolvers are used
    // only if it fails. Some networks refuse *.aws.neon.tech outright, which
    // surfaces as `getaddrinfo ENOTFOUND ep-…-pooler…` on every query and
    // looks like the database being down.
    stream: () => createResolvingSocket(),
  });
  pool.on("error", (err) => console.error("[DB] Pool error", err));
  g[POOL_KEY] = pool;
  return pool;
}

/**
 * Errors that mean "the connection never became usable", as opposed to "the
 * statement failed".
 *
 * Neon suspends an idle compute and can restart it under us, which drops every
 * pooled socket at once. The next `connect()` then either times out or is handed
 * a socket the server has already closed.
 */
function isTransientConnectError(err: unknown): boolean {
  const message = (err as { message?: string })?.message ?? "";
  return (
    message.includes("Connection terminated due to connection timeout") ||
    message.includes("Connection terminated unexpectedly") ||
    message.includes("terminating connection due to administrator command") ||
    message.includes("ECONNRESET") ||
    message.includes("EPIPE")
  );
}

/**
 * Acquire a pool client, retrying ONCE on transient connect errors.
 *
 * Shared by both `query()` and `transaction()` so that cold-start resilience
 * applies everywhere, not just to plain queries.
 */
async function acquireClient(): Promise<{ client: PoolClient; connectMs: number; retried: boolean }> {
  const t0 = Date.now();
  let retried = false;

  try {
    const c0 = Date.now();
    const client = await getPool().connect();
    return { client, connectMs: Date.now() - c0, retried };
  } catch (err) {
    if (!isTransientConnectError(err)) throw err;
    retried = true;
    const errMsg = (err as Error).message;
    const p = getPool();
    console.warn(
      `[DB] connect failed transiently (${Date.now() - t0}ms), retrying once: ${errMsg}` +
      ` — pool(total=${p.totalCount} idle=${p.idleCount} waiting=${p.waitingCount})`
    );
    await new Promise((resolve) => setTimeout(resolve, 750));
    const c0 = Date.now();
    const client = await getPool().connect();
    const connectMs = Date.now() - c0;
    console.warn(`[DB] retry connect succeeded: connect=${connectMs}ms total-before-exec=${Date.now() - t0}ms`);
    return { client, connectMs, retried };
  }
}

/**
 * Release a client back to the pool. If the query/transaction failed with a
 * connection-level error, destroy the client (`release(true)`) so a broken
 * socket is never handed to the next caller.
 */
function safeRelease(client: PoolClient, err?: unknown): void {
  const destroy = err != null && isTransientConnectError(err);
  try {
    client.release(destroy);
  } catch {
    // release itself can throw if the client is already released or the
    // underlying socket is gone. Swallow — there is nothing useful to do.
  }
}

/**
 * Run a statement, retrying ONCE if the connection could not be established.
 *
 * ── Why the retry is around connect() only ─────────────────────────────────
 * This function runs INSERTs and UPDATEs as well as SELECTs, so a blanket retry
 * would be a correctness bug: a write that failed with "Connection terminated
 * unexpectedly" mid-flight may well have committed, and re-sending it could
 * apply it twice. The retry therefore covers only the window BEFORE any
 * statement is sent — if `connect()` fails, nothing reached the database and
 * replaying is unambiguously safe. Once a client is in hand, a failure is
 * surfaced to the caller exactly as before.
 */
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const t0 = Date.now();
  const { client, connectMs, retried } = await acquireClient();
  let queryErr: unknown;

  try {
    const q0 = Date.now();
    const result = await client.query(text, params);
    const execMs = Date.now() - q0;
    const totalMs = Date.now() - t0;

    if (totalMs > 500) {
      const label = text.replace(/\s+/g, " ").trim().slice(0, 80);
      const p = getPool();
      console.warn(
        `[DB] slow — total=${totalMs}ms connect=${connectMs}ms exec=${execMs}ms` +
        `${retried ? " (retried)" : ""}` +
        ` pool(total=${p.totalCount} idle=${p.idleCount} waiting=${p.waitingCount})` +
        ` — ${label}…`
      );
    }

    return result.rows as T[];
  } catch (err) {
    queryErr = err;
    throw err;
  } finally {
    safeRelease(client, queryErr);
  }
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  // acquireClient gives cold-start retry — previously transaction() had none.
  const { client } = await acquireClient();
  let txErr: unknown;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    txErr = err;
    // ROLLBACK can itself throw if the connection is dead. Wrap so the
    // ORIGINAL error is always what the caller sees, not a confusing
    // "Connection terminated unexpectedly" from the ROLLBACK attempt.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[DB] ROLLBACK failed after error:", rollbackErr);
    }
    throw err;
  } finally {
    safeRelease(client, txErr);
  }
}

export async function recalculateSrNos(client?: PoolClient) {
  // Read toggle from organization_settings (default false = off)
  let backdatedMode = false;
  try {
    // Imported dynamically: tenantContext imports getPool from this module, so a
    // static import here would close the cycle. This is the only such case.
    const { getOrganizationId } = await import("./tenantContext");
    const organizationId = await getOrganizationId(client);
    const SETTING_SQL =
      "SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = $1";
    let settingRows;
    if (client) {
      settingRows = await client.query(SETTING_SQL, [organizationId]);
    } else {
      const c = await getPool().connect();
      try {
        settingRows = await c.query(SETTING_SQL, [organizationId]);
      } finally {
        c.release();
      }
    }
    backdatedMode = settingRows.rows?.[0]?.lead_number_sorting_enabled === true;
  } catch {
    // If table doesn't have column yet, stay in default mode
    backdatedMode = false;
  }

  // OFF mode: purely chronological by creation date (ignore backdated entry)
  // ON mode: backdated entry takes priority, date_created is fallback
  const orderClause = backdatedMode
    ? `CASE
         WHEN auto_date_enabled = false AND enquiry_date IS NOT NULL
         THEN enquiry_date
         ELSE created_at
       END ASC, created_at ASC, id ASC`
    : `created_at ASC, id ASC`;

  // MT-05: sr_no is a per-organization sequence. Unscoped, this CTE renumbers
  // every organization's leads in ONE ordering, interleaving two builders'
  // sequences and rewriting rows that do not belong to the caller. The filter is
  // inside the CTE so the ROW_NUMBER() window is computed per organization —
  // filtering after the window would keep the interleaved numbering.
  //
  // Resolved via the same dynamic import used above: tenantContext imports
  // getPool from this module, so a static import would close the cycle.
  const { getOrganizationId: resolveOrg } = await import("./tenantContext");
  const srNoOrgId = await resolveOrg(client);

  const queryText = `
    WITH sorted_leads AS (
      SELECT id,
        ROW_NUMBER() OVER (ORDER BY ${orderClause}) AS new_sr_no
      FROM walkin_enquiries
      WHERE organization_id = $1
    )
    UPDATE walkin_enquiries
    SET sr_no = sorted_leads.new_sr_no
    FROM sorted_leads
    WHERE walkin_enquiries.id = sorted_leads.id
    AND walkin_enquiries.organization_id = $1
    AND walkin_enquiries.sr_no IS DISTINCT FROM sorted_leads.new_sr_no;
  `;

  if (client) {
    await client.query(queryText, [srNoOrgId]);
  } else {
    await query(queryText, [srNoOrgId]);
  }
}

// ── Keepalive ──────────────────────────────────────────────────────────────
// Prevents Neon from suspending the compute during active use.
//
// DISABLED in production (Vercel serverless): the function is frozen between
// invocations and an interval prevents it from being reclaimed. Combined with
// `allowExitOnIdle: true` above, the pool drains naturally in serverless.
//
// ENABLED in development: keeps the local dev server's Neon compute warm so
// queries don't hit cold-start latency on every save.
//
// Guarded against hot-reload stacking: in `next dev`, module re-evaluation
// would create a new interval without clearing the old one. Storing the id
// in a global ensures at most one interval exists at any time.
const KEEPALIVE_KEY = "__bd_db_keepalive";
if (typeof window === "undefined" && process.env.NODE_ENV !== "production") {
  const g = globalThis as Record<string, any>;
  if (g[KEEPALIVE_KEY]) clearInterval(g[KEEPALIVE_KEY]);
  g[KEEPALIVE_KEY] = setInterval(async () => {
    try {
      await query("SELECT 1");
    } catch {}
  }, 4 * 60 * 1000);
}
