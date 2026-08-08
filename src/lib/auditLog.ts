// lib/auditLog.ts — writes to the `audit_logs` table and reads the unified feed.
//
// Three log tables already exist and each means something different:
//
//   employee_activity_logs  what a user DID in the CRM (opened a module, touched
//                           a lead). Written by hooks/useActivityTracker.
//   admin_audit_logs        a free-text sentence describing an admin action.
//   audit_logs (new)        settings and security events, with before/after
//                           values, IP and user agent.
//
// None of the three is reshaped — other features read them. The Activity Logs
// screen unions all three for display, which is what fetchActivityFeed does.

import { query } from "@/lib/db";

export interface AuditEntry {
  userId: number | null;
  actorName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Extract client IP and user agent from a request. Both are best-effort. */
export function requestContext(req: Request): { ip: string; userAgent: string } {
  const headers = req.headers;
  const ip =
    headers.get("x-forwarded-for") ||
    headers.get("x-real-ip") ||
    "unknown";
  return { ip, userAgent: headers.get("user-agent") || "unknown" };
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Record an auditable event.
 *
 * Never throws. An audit write failing must not turn a successful password
 * change into a 500 — the user would retry a change that already applied. The
 * failure is logged loudly instead, because a silently empty audit trail is its
 * own problem.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs
         (user_id, actor_name, action, entity_type, entity_id,
          old_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.userId,
        entry.actorName ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId != null ? String(entry.entityId) : null,
        serialize(entry.oldValue),
        serialize(entry.newValue),
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
      ]
    );
  } catch (err: any) {
    console.error("[auditLog] failed to record", entry.action, err?.message);
  }
}

/**
 * Diff two flat objects and return only the keys that actually changed.
 * Used so a profile save logs `{ timezone: ... }` rather than the whole record,
 * which makes the Activity Logs table readable instead of a wall of JSON.
 */
export function diffFields<T extends Record<string, any>>(
  before: T,
  after: Partial<T>
): { old: Record<string, any>; next: Record<string, any>; changed: string[] } {
  const old: Record<string, any> = {};
  const next: Record<string, any> = {};
  const changed: string[] = [];

  for (const key of Object.keys(after)) {
    const a = before?.[key];
    const b = after[key];
    // Loose compare: a form posts "1" where the column holds 1, and logging that
    // as a change every save would bury the real ones.
    if (String(a ?? "") !== String(b ?? "")) {
      old[key] = a ?? null;
      next[key] = b ?? null;
      changed.push(key);
    }
  }

  return { old, next, changed };
}

export interface ActivityRow {
  source: "audit" | "activity" | "admin";
  id: number;
  user_id: number | null;
  actor_name: string | null;
  action: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ActivityFeedFilters {
  userId?: number | null;   // null/undefined = all users (admin view)
  action?: string | null;   // matches the normalised action label
  from?: string | null;     // ISO date
  to?: string | null;       // ISO date
  limit?: number;
  offset?: number;
}

/**
 * The unified feed behind /settings/activity-logs.
 *
 * A UNION ALL over the three tables, ordered by time. Each branch normalises to
 * the same seven columns; `details` is assembled per-source because the useful
 * sentence lives in a different column in each.
 */
export async function fetchActivityFeed(
  filters: ActivityFeedFilters
): Promise<{ rows: ActivityRow[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Bound the window even when the caller passes nothing, so an empty filter set
  // cannot ask Postgres for every row ever written.
  const from = filters.from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const to = filters.to || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const userId = filters.userId ?? null;
  const action = filters.action || null;

  const unioned = `
    SELECT 'audit'::text AS source, a.id, a.user_id,
           COALESCE(a.actor_name, u.name) AS actor_name,
           a.action,
           NULLIF(TRIM(CONCAT_WS(' ',
             a.entity_type,
             CASE WHEN a.new_value IS NOT NULL THEN '→ ' || LEFT(a.new_value, 300) END
           )), '') AS details,
           a.ip_address, a.user_agent, a.created_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id

    UNION ALL

    SELECT 'activity'::text, e.id, e.user_id, u.name,
           e.action_type,
           NULLIF(TRIM(CONCAT_WS(' — ', e.module, e.description, e.lead_name)), '') AS details,
           NULL, NULL, e.created_at
    FROM employee_activity_logs e
    LEFT JOIN users u ON u.id = e.user_id

    UNION ALL

    SELECT 'admin'::text, l.id, l.admin_id, u.name,
           'admin.action', l.action, NULL, NULL, l.created_at
    FROM admin_audit_logs l
    LEFT JOIN users u ON u.id = l.admin_id
  `;

  const where = `
    WHERE created_at >= $1::timestamptz
      AND created_at <= $2::timestamptz
      AND ($3::int  IS NULL OR user_id = $3::int)
      AND ($4::text IS NULL OR action ILIKE '%' || $4::text || '%')
  `;

  const params = [from, to, userId, action];

  const rows = await query<ActivityRow>(
    `SELECT * FROM (${unioned}) feed ${where}
     ORDER BY created_at DESC
     LIMIT $5 OFFSET $6`,
    [...params, limit, offset]
  );

  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM (${unioned}) feed ${where}`,
    params
  );

  return { rows, total: Number(totalRows[0]?.count ?? 0) };
}
