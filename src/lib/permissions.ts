// lib/permissions.ts — per-user permission catalogue and helpers.
//
// Architecture note: this does NOT replace the role-string routing in
// middleware.ts and requireRoles(). Those govern which pages and API prefixes a
// role can reach. This layer adds per-employee OVERRIDES on top of the role
// baseline — an admin can grant or revoke specific capabilities for individual
// users without changing their role.
//
// Current permissions
// ───────────────────
//   can_change_password   User may change their own password via self-service
//                         (Account & Security or Members & Team OTP flow).
//                         Default: true for all roles.
//                         When false, both self-service paths are blocked
//                         server-side; an admin can still change the password
//                         via the admin-initiated OTP flow.
//
// Adding a new permission
// ───────────────────────
// 1. Add the column to the CREATE TABLE statement and to DEFAULT_PERMISSIONS.
// 2. Add it to UserPermissions.
// 3. Add the column to the INSERT … ON CONFLICT DO UPDATE in setPermissions().
// 4. Add it to the SELECT in getPermissions().
//
// Table bootstrap
// ───────────────
// `ensureTable()` issues CREATE TABLE IF NOT EXISTS on first access in this
// process. The guard makes it a no-op after the first call, so the cost is
// one extra round trip on a cold start. This follows the pattern already used
// by revenue-intelligence and loan DDL on the request path.

import { query } from "@/lib/db";

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_permissions (
    user_id             INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL,
    can_change_password BOOLEAN     NOT NULL DEFAULT true,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          INTEGER,
    PRIMARY KEY (user_id)
  )
`;

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await query(ENSURE_TABLE_SQL, []);
  tableEnsured = true;
}

export interface UserPermissions {
  can_change_password: boolean;
}

/** Role-based defaults. All permissions default to true (permissive baseline). */
const DEFAULT_PERMISSIONS: UserPermissions = {
  can_change_password: true,
};

/**
 * Returns the effective permissions for a user.
 *
 * If no override row exists the role-default is returned. Callers should treat
 * the return value as the authoritative answer — they must not apply their own
 * fallback logic on top.
 */
export async function getPermissions(userId: number): Promise<UserPermissions> {
  await ensureTable();
  const rows = await query<UserPermissions>(
    `SELECT can_change_password
       FROM user_permissions
      WHERE user_id = $1`,
    [userId]
  );
  if (rows.length === 0) return { ...DEFAULT_PERMISSIONS };
  return { can_change_password: rows[0].can_change_password };
}

/**
 * Convenience wrapper. Returns true/false for a single named permission.
 *
 * Equivalent to `(await getPermissions(userId))[permission]` but reads more
 * naturally when only one check is needed.
 */
export async function hasPermission(
  userId: number,
  permission: keyof UserPermissions
): Promise<boolean> {
  const perms = await getPermissions(userId);
  return perms[permission];
}

/**
 * Upserts the permission row for a user.
 *
 * Caller is responsible for ensuring only an admin in the same org calls this.
 * Any permission key absent from `perms` keeps its current stored value (not
 * the default) because the ON CONFLICT … DO UPDATE only touches the supplied
 * columns.
 */
export async function setPermissions(
  userId: number,
  orgId: string,
  perms: Partial<UserPermissions>,
  updatedBy: number
): Promise<void> {
  await ensureTable();

  // Build a minimal upsert that only touches supplied columns.
  // For now there is only one column; when more are added this function should
  // be revisited to build the SET clause dynamically or split into per-column
  // setters to preserve that guarantee.
  if (perms.can_change_password !== undefined) {
    await query(
      `INSERT INTO user_permissions (user_id, organization_id, can_change_password, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET can_change_password = EXCLUDED.can_change_password,
             updated_at          = now(),
             updated_by          = EXCLUDED.updated_by`,
      [userId, orgId, perms.can_change_password, updatedBy]
    );
  }
}

/**
 * Returns permissions for every active user in an organization.
 *
 * Used by the admin Members & Team view to render one row per employee with
 * all toggles. Left-joins so users without an override row are included (their
 * defaults are substituted in-query).
 */
export async function listPermissions(
  orgId: string
): Promise<Array<{ userId: number; can_change_password: boolean }>> {
  await ensureTable();
  const rows = await query<{ user_id: number; can_change_password: boolean }>(
    `SELECT u.id AS user_id,
            COALESCE(up.can_change_password, true) AS can_change_password
       FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
      WHERE u.organization_id = $1
        AND u.is_active = true
        AND u.deleted_at IS NULL
      ORDER BY u.name`,
    [orgId]
  );
  return rows.map((r) => ({ userId: r.user_id, can_change_password: r.can_change_password }));
}
