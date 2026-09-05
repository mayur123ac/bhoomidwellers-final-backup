// lib/phoneAccess.ts — canonical server-side phone number access control.
//
// ── Security model ────────────────────────────────────────────────────────────
// Phone access has TWO independent gates:
//
//   Gate 1: role-level policy is ON  (stored in phone_number_access_policies)
//   Gate 2: the employee owns/is assigned the specific record
//
// Both gates must pass for a full phone to be returned.
// Admin is an invariant — always full access, never toggled.
// Unknown/ungoverned roles always receive masked output.
//
// ── Masking format ────────────────────────────────────────────────────────────
// 10-digit: 98••••3210 (first 2, 4 bullets, last 4)
// Other:    first 2 + proportional bullets + last 4
//
// ── Usage pattern ─────────────────────────────────────────────────────────────
// Every API route that returns CP phone fields calls resolvePhones(), which
// applies masking to the whole result set in one pass using a single policy
// DB query per scope+role combination.
//
// The raw phone NEVER reaches an unauthorized client — this layer is the
// only place masking decisions are made.
//
// ── Scopes ───────────────────────────────────────────────────────────────────
// CP_ENQUIRY       channel_partners.phone — CP Enquiry view (pure CP records)
// CP_LINKED_LEAD   cp_phone / partner_phone — CP-sourced walkin_enquiries

import { query } from "@/lib/db";
import { normalizeRole } from "@/lib/cpRbac";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PhoneScope = "CP_ENQUIRY" | "CP_LINKED_LEAD";

export type PhoneRole =
  | "receptionist"
  | "sales_manager"
  | "site_head"
  | "sourcing_manager";

/** Session-like object: the minimum required by all resolution calls. */
export interface PhoneActor {
  _id?: string | number | null;
  name?: string | null;
  role: string;
}

// ─── Role mapping ─────────────────────────────────────────────────────────────

/**
 * Maps a normalized role string (spaces, lowercase) to a PhoneRole DB key.
 * Only these four roles are governed; everything else defaults to DENY.
 */
const ROLE_KEY_MAP: Record<string, PhoneRole> = {
  receptionist: "receptionist",
  "sales manager": "sales_manager",
  "site head": "site_head",
  "sourcing manager": "sourcing_manager",
};

const GOVERNED_ROLES = new Set<string>(Object.keys(ROLE_KEY_MAP));

// ─── Masking ──────────────────────────────────────────────────────────────────

/**
 * Mask a phone number according to the Bhoomi masking format:
 *
 *   10-digit: 9876543210 → 98••••3210 (first 2, 4 bullets, last 4)
 *   Other:    first 2, proportional bullets for middle, last 4
 *
 * Returns "" for empty/null input. Returns the original value unchanged if it
 * is 6 characters or shorter (too short to mask meaningfully without hiding
 * the whole number — e.g. "N/A" or a 4-digit extension).
 */
export function maskPhoneNumber(phone: string | null | undefined): string {
  const s = (phone ?? "").trim();
  if (!s || s === "N/A" || s === "Pending") return s;
  if (s.length <= 6) return s; // too short to apply the 2+bullets+4 format
  if (s.length === 10) {
    return `${s.slice(0, 2)}••••${s.slice(6)}`;
  }
  // Longer numbers (country-code prefix, spaces, etc.): keep first 2 and last 4.
  const maskLen = Math.max(2, s.length - 6);
  return `${s.slice(0, 2)}${"•".repeat(maskLen)}${s.slice(-4)}`;
}

// ─── Policy DB access ─────────────────────────────────────────────────────────

/**
 * Default policy applied when no row exists in the table (e.g. a newly created
 * organization before the seed runs, or an unrecognized role). True = full
 * access, which preserves existing CRM behavior for known roles until an admin
 * deliberately turns a role off.
 *
 * NOTE: this default applies ONLY to the four governed roles. Unknown roles
 * always receive false (masked) regardless of this constant.
 */
const DEFAULT_POLICY = true;

/**
 * Fetch the phone access policy for a single (org, scope, role) combination.
 *
 * Returns true if the role may view full phones in this scope, false otherwise.
 * Fails open (returns DEFAULT_POLICY) on a DB error so a transient outage does
 * not mask phones for everyone — security enforcement is already applied at the
 * DB level by the policy rows; a missing read is less harmful than a service outage.
 */
export async function getPhonePolicy(
  organizationId: string,
  scope: PhoneScope,
  roleKey: PhoneRole
): Promise<boolean> {
  try {
    const rows = await query<{ can_view_full_phone: boolean }>(
      `SELECT can_view_full_phone
         FROM phone_number_access_policies
        WHERE organization_id = $1
          AND scope            = $2
          AND role             = $3
        LIMIT 1`,
      [organizationId, scope, roleKey]
    );
    if (rows.length === 0) return DEFAULT_POLICY;
    return rows[0].can_view_full_phone;
  } catch {
    return DEFAULT_POLICY;
  }
}

/**
 * Return all policy rows for an organization, in (scope, role) order.
 * Used by the settings page to render current state and by the API route to
 * construct the full policy object in one query.
 */
export async function getAllPoliciesForOrg(
  organizationId: string
): Promise<
  Array<{
    scope: PhoneScope;
    role: PhoneRole;
    can_view_full_phone: boolean;
    updated_at: string | null;
    updated_by: string | null;
  }>
> {
  try {
    const rows = await query<{
      scope: string;
      role: string;
      can_view_full_phone: boolean;
      updated_at: string | null;
      updated_by: string | null;
    }>(
      `SELECT scope, role, can_view_full_phone, updated_at, updated_by
         FROM phone_number_access_policies
        WHERE organization_id = $1
        ORDER BY scope, role`,
      [organizationId]
    );
    return rows as Array<{
      scope: PhoneScope;
      role: PhoneRole;
      can_view_full_phone: boolean;
      updated_at: string | null;
      updated_by: string | null;
    }>;
  } catch {
    return [];
  }
}

/**
 * Upsert a single policy row.
 *
 * The API route enforces admin-only at the HTTP layer; this function does NOT
 * re-check — it is an internal write helper.
 */
export async function setPhonePolicy(
  organizationId: string,
  scope: PhoneScope,
  role: PhoneRole,
  canViewFullPhone: boolean,
  updatedBy: string
): Promise<void> {
  await query(
    `INSERT INTO phone_number_access_policies
       (organization_id, scope, role, can_view_full_phone, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (organization_id, scope, role)
     DO UPDATE SET
       can_view_full_phone = EXCLUDED.can_view_full_phone,
       updated_at          = now(),
       updated_by          = EXCLUDED.updated_by`,
    [organizationId, scope, role, canViewFullPhone, updatedBy]
  );
}

// ─── Ownership checks ─────────────────────────────────────────────────────────
//
// Gate 2 of the authorization model: does this employee actually handle this
// record? The check is per-role and per-scope.
//
// Ownership rules for CP_ENQUIRY (channel_partners rows):
//   sourcing_manager  cp.assigned_sourcing_manager_id = actorId
//   sales_manager     cp.assigned_sales_manager_id    = actorId
//   receptionist      org-wide (no per-CP assignment exists in the schema)
//   site_head         org-wide (no per-CP assignment exists in the schema)
//
// Ownership rules for CP_LINKED_LEAD (walkin_enquiries + cp join rows):
//   sourcing_manager  COALESCE(w.sourcing_manager_id,
//                              cp.assigned_sourcing_manager_id) = actorId
//                     (stored in the row as sourcing_manager_id /
//                      effective_sourcing_manager_id)
//   sales_manager     cp.assigned_sales_manager_id = actorId
//   receptionist      w.assigned_receptionist = actorName  (legacy string)
//   site_head         w.overseeing_site_head = actorName   (legacy string)

function ownsRecordCpEnquiry(
  roleKey: PhoneRole,
  actorId: number | null,
  record: Record<string, unknown>
): boolean {
  switch (roleKey) {
    case "sourcing_manager":
      return (
        actorId !== null &&
        Number(
          record.assigned_sourcing_manager_id ??
            record.effective_sourcing_manager_id
        ) === actorId
      );
    case "sales_manager":
      return (
        actorId !== null &&
        Number(record.assigned_sales_manager_id) === actorId
      );
    case "receptionist":
      // No per-CP assignment — Receptionist has org-wide CP access.
      return true;
    case "site_head":
      // No per-CP assignment — Site Head has org-wide CP access.
      return true;
  }
}

function ownsRecordCpLinkedLead(
  roleKey: PhoneRole,
  actorId: number | null,
  actorName: string | null,
  record: Record<string, unknown>
): boolean {
  switch (roleKey) {
    case "sourcing_manager":
      return (
        actorId !== null &&
        (Number(record.sourcing_manager_id) === actorId ||
          Number(record.effective_sourcing_manager_id) === actorId)
      );
    case "sales_manager":
      return (
        actorId !== null &&
        Number(record.assigned_sales_manager_id) === actorId
      );
    case "receptionist": {
      // Legacy string-based assignment; compare case-insensitively.
      const assigned = ((record.assigned_receptionist as string) ?? "")
        .trim()
        .toLowerCase();
      return (
        !!actorName && !!assigned && assigned === actorName.trim().toLowerCase()
      );
    }
    case "site_head": {
      const overseeing = ((record.overseeing_site_head as string) ?? "")
        .trim()
        .toLowerCase();
      return (
        !!actorName &&
        !!overseeing &&
        overseeing === actorName.trim().toLowerCase()
      );
    }
  }
}

// ─── Public authorization API ─────────────────────────────────────────────────

/**
 * The canonical authorization check.
 *
 * Returns true if the actor may see the full phone in this scope for this
 * specific record. Admin always returns true. Unknown roles always return false.
 *
 * @param actor         current session { _id, name, role }
 * @param record        database row with ownership FK/name columns
 * @param scope         CP_ENQUIRY or CP_LINKED_LEAD
 * @param organizationId current tenant UUID
 */
export async function canViewFullPhone(
  actor: PhoneActor,
  record: Record<string, unknown>,
  scope: PhoneScope,
  organizationId: string
): Promise<boolean> {
  const role = normalizeRole(actor.role);

  // Admin invariant — never toggled, always full access.
  if (role === "admin") return true;

  // Unknown or ungoverned role — always masked.
  if (!GOVERNED_ROLES.has(role)) return false;

  const roleKey = ROLE_KEY_MAP[role];
  const actorId =
    actor._id != null && actor._id !== "" ? Number(actor._id) : null;
  const actorName =
    typeof actor.name === "string" && actor.name.trim() ? actor.name : null;

  // Gate 1: role-level policy.
  const policyAllows = await getPhonePolicy(organizationId, scope, roleKey);
  if (!policyAllows) return false;

  // Gate 2: record ownership.
  return scope === "CP_ENQUIRY"
    ? ownsRecordCpEnquiry(roleKey, actorId, record)
    : ownsRecordCpLinkedLead(roleKey, actorId, actorName, record);
}

/**
 * Resolve a single phone field for one record.
 *
 * Returns the raw phone when authorized, or the masked version when not.
 * Empty/null values pass through unchanged.
 */
export async function resolvePhone(
  actor: PhoneActor,
  record: Record<string, unknown>,
  scope: PhoneScope,
  organizationId: string,
  phoneValue: string | null | undefined
): Promise<string> {
  if (!phoneValue) return phoneValue ?? "";
  const authorized = await canViewFullPhone(actor, record, scope, organizationId);
  return authorized ? phoneValue : maskPhoneNumber(phoneValue);
}

/**
 * Apply phone masking to an array of records.
 *
 * Fetches the role policy ONCE per call (not per record), then applies the
 * ownership check per record. For Admin, returns the array unchanged.
 *
 * @param actor       current session { _id, name, role }
 * @param records     array of database rows to process
 * @param scope       which scope these records belong to
 * @param orgId       current tenant UUID
 * @param phoneFields names of the columns that contain phone numbers
 */
export async function resolvePhones<T extends Record<string, unknown>>(
  actor: PhoneActor,
  records: T[],
  scope: PhoneScope,
  orgId: string,
  phoneFields: string[]
): Promise<T[]> {
  if (records.length === 0) return records;

  const role = normalizeRole(actor.role);

  // Admin: return as-is, no queries needed.
  if (role === "admin") return records;

  // Unknown/ungoverned role: mask every phone field in every record.
  if (!GOVERNED_ROLES.has(role)) {
    return records.map((r) => maskFields(r, phoneFields));
  }

  const roleKey = ROLE_KEY_MAP[role];
  const actorId =
    actor._id != null && actor._id !== "" ? Number(actor._id) : null;
  const actorName =
    typeof actor.name === "string" && actor.name.trim() ? actor.name : null;

  // Gate 1: one policy query for the whole batch.
  const policyAllows = await getPhonePolicy(orgId, scope, roleKey);

  return records.map((r) => {
    // Gate 2: per-record ownership.
    const owned =
      scope === "CP_ENQUIRY"
        ? ownsRecordCpEnquiry(roleKey, actorId, r as Record<string, unknown>)
        : ownsRecordCpLinkedLead(
            roleKey,
            actorId,
            actorName,
            r as Record<string, unknown>
          );

    return policyAllows && owned ? r : maskFields(r, phoneFields);
  });
}

/** Shallow-clone a record and mask the specified phone columns. */
function maskFields<T extends Record<string, unknown>>(
  record: T,
  fields: string[]
): T {
  const copy = { ...record } as T;
  for (const f of fields) {
    const v = copy[f];
    if (typeof v === "string" && v) {
      (copy as Record<string, unknown>)[f] = maskPhoneNumber(v);
    }
  }
  return copy;
}
