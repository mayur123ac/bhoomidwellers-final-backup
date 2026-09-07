// lib/recordingPermissions.ts — organization-level recording deletion permissions.
//
// Controls which roles are allowed to delete voice recordings from follow-ups.
// Admin is always allowed and cannot be disabled. Other roles (site head,
// sales manager, receptionist) can be enabled per organization by an admin.
//
// Follows the same CREATE TABLE IF NOT EXISTS pattern as lib/permissions.ts —
// the table is bootstrapped on first access so no separate migration step is
// required for development environments.

import { query } from "@/lib/db";

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS organization_recording_permissions (
    organization_id   UUID        PRIMARY KEY,
    delete_roles      TEXT[]      NOT NULL DEFAULT ARRAY['admin']::TEXT[],
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        INTEGER
  )
`;

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await query(ENSURE_TABLE_SQL, []);
  tableEnsured = true;
}

/** All roles that CAN be granted recording-delete permission. */
export const ALL_DELETABLE_ROLES = ["admin", "site head", "sales manager", "receptionist"] as const;
export type DeletableRole = (typeof ALL_DELETABLE_ROLES)[number];

/** Normalize role strings the same way serverAuth does. */
function normalizeRole(r: string): string {
  return r.trim().toLowerCase().replace(/_/g, " ");
}

/**
 * Returns the list of roles currently allowed to delete recordings
 * for the given organization. Defaults to ["admin"] if no row exists.
 */
export async function getRecordingDeleteRoles(orgId: string): Promise<string[]> {
  await ensureTable();
  const rows = await query<{ delete_roles: string[] }>(
    `SELECT delete_roles FROM organization_recording_permissions WHERE organization_id = $1`,
    [orgId]
  );
  if (rows.length === 0) return ["admin"];
  return rows[0].delete_roles;
}

/**
 * Saves the list of roles allowed to delete recordings.
 * Admin is always included regardless of input.
 */
export async function setRecordingDeleteRoles(
  orgId: string,
  roles: string[],
  updatedBy: number
): Promise<string[]> {
  await ensureTable();

  // Normalize and deduplicate, always including admin
  const normalized = new Set<string>(["admin"]);
  for (const r of roles) {
    const n = normalizeRole(r);
    if ((ALL_DELETABLE_ROLES as readonly string[]).includes(n)) {
      normalized.add(n);
    }
  }
  const finalRoles = Array.from(normalized);

  await query(
    `INSERT INTO organization_recording_permissions (organization_id, delete_roles, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id) DO UPDATE
       SET delete_roles = EXCLUDED.delete_roles,
           updated_at   = now(),
           updated_by   = EXCLUDED.updated_by`,
    [orgId, finalRoles, updatedBy]
  );

  return finalRoles;
}

/**
 * Checks whether a user with the given role can delete recordings
 * in the given organization. This is the server-side enforcement gate.
 */
export async function canDeleteRecording(orgId: string, userRole: string): Promise<boolean> {
  const roles = await getRecordingDeleteRoles(orgId);
  const normalized = normalizeRole(userRole);
  return roles.includes(normalized);
}
