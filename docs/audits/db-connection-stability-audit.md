# PostgreSQL / Neon Connection Stability Audit

**Date:** 2026-11-16
**Scope:** `src/lib/db.ts`, `src/lib/dnsFallback.ts`, all 97 files importing `query`/`transaction`/`getPool`
**Production errors observed:**
- Connection timeout errors
- Pool saturation: `pool(total=10 idle=0 waiting=1)`
- 500s on: attendance/status, walkin_enquiries/duplicates, dashboard/overview-kpis, walkin_enquiries?limit=10000
- 30.8s response on POST auth/realtime-token (no DB calls — blocked waiting for pool)

---

## Root Causes (ordered by impact)

### RC-1: Pool size (max=10) vs actual concurrent connection demand — PRIMARY CAUSE

The pool allows 10 simultaneous connections. A single admin dashboard page load triggers:

| Endpoint | Pool checkouts per request |
|---|---|
| `GET /api/dashboard/overview-kpis` (admin) | ~20 (5 pre-flight + 9-11 parallel + 3 sequential DDL + 2 more parallel) |
| `GET /api/walkin_enquiries?limit=10000` | 4 (2 parallel list+count, then 2 parallel phone+visits) |
| `requireSession()` (every gated route) | 1 (revocation check, cached with dedup) |
| `getOrganizationId()` | 0-1 (60s TTL cache) |

**Impact:** `overview-kpis` alone demands ~20 connections via `Promise.all`. With `max: 10`, the first 10 queries get connections instantly; the remaining 10 queue. If a second request arrives concurrently, all 20 pool slots are occupied or waiting, and every other endpoint (`attendance/status`, `realtime-token`, etc.) times out at 15s waiting for a connection.

Two concurrent admin page loads = 40 connection demands against a pool of 10.

**File:** `db.ts:60` (`max: 10`)

### RC-2: Pool not stored on globalThis — HMR creates orphan pools (dev only)

```typescript
let pool: Pool | undefined;  // module-level, not on globalThis
```

In `next dev`, HMR re-evaluates the module. Each re-evaluation creates a new Pool (up to 10 connections) while the old Pool is still alive with its connections open. The keepalive interval IS guarded on `globalThis.__bd_db_keepalive`, but the pool itself is not — so the guard clears the old interval but doesn't `.end()` the old pool.

**Impact:** Developer machines accumulate orphan connection pools. After several HMR cycles, total open connections = cycles x 10, all against a Neon endpoint that may have a 100-connection limit.

**File:** `db.ts:5`

### RC-3: `transaction()` has no connect retry

```typescript
// query() retries once on transient connect errors — good
// transaction() does NOT:
const client = await getPool().connect();  // no retry, no catch
```

A Neon cold-start that fails the first `connect()` crashes every transaction (booking creation, bulk delete, import engine, deal-stage processing).

**File:** `db.ts:187`

### RC-4: `transaction()` ROLLBACK can throw, swallowing the original error

```typescript
} catch (err) {
    await client.query("ROLLBACK");  // if connection is dead, THIS throws
    throw err;                        // never reached
}
```

If the connection drops mid-transaction, ROLLBACK itself throws, and the original error is lost. The caller gets a confusing "Connection terminated unexpectedly" from the ROLLBACK instead of the actual business error.

**File:** `db.ts:193-195`

### RC-5: Broken connections returned to pool

`client.release()` returns the connection to the pool for reuse. `client.release(true)` destroys it. Neither `query()` nor `transaction()` ever calls `release(true)`, so a connection that errored with ECONNRESET goes back to the pool and can be handed to the next `connect()` caller, causing an immediate second failure.

**File:** `db.ts:180`, `db.ts:197`

### RC-6: `mongodb.ts` creates a second unmanaged Pool

```typescript
// src/lib/mongodb.ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
```

Nobody imports this file (confirmed via grep), but if the bundler evaluates it, it creates a second Pool with: no connection timeout, no idle timeout override, no error handler, no DNS fallback, and `rejectUnauthorized: false` in production (weakens TLS).

**File:** `src/lib/mongodb.ts`

### RC-7: Keepalive is counterproductive in serverless

The `SELECT 1` every 4 minutes keeps the Neon compute warm but also:
- Keeps the Node.js event loop alive, preventing Vercel from freezing the function
- The interval fires on thaw, potentially racing a real request for pool connections
- Without `allowExitOnIdle: true` on the Pool, idle connections never drain

**File:** `db.ts:275-283`

### RC-8: `tenantContext.ts` bypasses retry

```typescript
: (await getPool().query(sql)).rows;  // Pool.query() — no retry
```

`Pool.query()` internally does connect-query-release, but without the transient-error retry that `query()` provides. A cold-start failure here crashes tenant resolution for every sessionless path.

**File:** `tenantContext.ts:77`

### RC-9: `overview-kpis` sequential DDL checks are wasteful

5-8 `information_schema` lookups (tableExists/columnExists) run as pre-flight checks for optional tables. These are stable schema facts that don't change between requests. Each burns a pool connection + 82ms Neon RTT.

**File:** `api/dashboard/overview-kpis/route.ts:49-56, 195-237`

### RC-10: No `statement_timeout` safety net

No per-connection or pool-level `statement_timeout`. A runaway query (e.g., the recursive CTE in `batchGetVisitDepths` on malformed data) can hold a connection indefinitely, contributing to pool starvation.

---

## Fixes (Implementation Plan)

| # | Fix | Risk | Files |
|---|---|---|---|
| F1 | Store pool on `globalThis` for HMR safety | Low | db.ts |
| F2 | Increase `max` to 25; add `allowExitOnIdle` | Low | db.ts |
| F3 | Add connect retry to `transaction()` | Low | db.ts |
| F4 | Wrap ROLLBACK in try/catch in `transaction()` | Low | db.ts |
| F5 | Call `release(true)` on connection errors | Low | db.ts |
| F6 | Delete `mongodb.ts` (dead code) | None | mongodb.ts |
| F7 | Conditionalize keepalive (skip in production serverless) | Low | db.ts |
| F8 | Add `statement_timeout: 30000` to pool config | Low | db.ts |
| F9 | Cache DDL metadata in `overview-kpis` | Low | overview-kpis/route.ts |
| F10 | Route `tenantContext` through `query()` | Low | tenantContext.ts |
