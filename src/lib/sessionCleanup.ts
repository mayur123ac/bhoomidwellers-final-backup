// lib/sessionCleanup.ts — Centralized stale-session cleanup.
//
// Previously, 6 API routes each ran the identical UPDATE on every request,
// causing row-level lock contention when the dashboard fetched multiple
// user-list endpoints in parallel. This module runs the cleanup at most
// once per organization per THROTTLE_MS, and uses a sargable WHERE clause
// so the partial index on (organization_id, last_heartbeat) WHERE is_active
// can be used by the planner.

import { query } from "./db";

const THROTTLE_MS = 60_000; // 1 minute between cleanups per org
const STALE_SECONDS = 300;  // 5 minutes without heartbeat = stale

// In-memory throttle: org_id -> last cleanup timestamp.
// Stored on globalThis so Next.js HMR does not reset it.
const THROTTLE_KEY = "__bd_session_cleanup_ts";
function getThrottleMap(): Map<string, number> {
  const g = globalThis as Record<string, any>;
  if (!g[THROTTLE_KEY]) g[THROTTLE_KEY] = new Map<string, number>();
  return g[THROTTLE_KEY] as Map<string, number>;
}

/**
 * Expire employee sessions whose last heartbeat is older than 5 minutes.
 *
 * Safe to call from any API route — concurrent calls for the same org
 * within THROTTLE_MS are no-ops. The UPDATE is idempotent: re-running it
 * after the throttle window changes nothing if no new sessions have gone
 * stale.
 *
 * The WHERE clause is sargable: `last_heartbeat < NOW() - INTERVAL '...'`
 * lets PostgreSQL use a B-tree index scan, unlike the previous
 * `EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300` which computed a
 * value per row and forced a filter step.
 */
export async function expireStaleSessionsThrottled(orgId: string): Promise<void> {
  const map = getThrottleMap();
  const last = map.get(orgId) ?? 0;
  if (Date.now() - last < THROTTLE_MS) return;

  // Stamp BEFORE the query so concurrent calls during execution also skip.
  map.set(orgId, Date.now());

  try {
    await query(
      `UPDATE employee_sessions
          SET is_active = false,
              session_end = last_heartbeat
        WHERE is_active = true
          AND organization_id = $1
          AND last_heartbeat < NOW() - INTERVAL '${STALE_SECONDS} seconds'`,
      [orgId]
    );
  } catch (err) {
    // On failure, clear the throttle so the next request retries.
    map.delete(orgId);
    throw err;
  }
}
