// lib/cpChat.ts — attribution and CP-safe field policy for the Channel Partner chat.
//
// Two things live here because both the API route and the panel need to agree
// on them, and disagreeing would be a data leak rather than a cosmetic bug:
//
//   1. WHO generated a message — resolved from the persisted creator, never
//      from the viewer's UI role.
//   2. WHAT a Channel Partner is allowed to see about a customer or booking.
//
// ── The disclosure rule ─────────────────────────────────────────────────────
// A Channel Partner introduced the customer; they have a commercial interest in
// the deal's progress and none whatsoever in the customer's identity documents,
// contact details or money. So CP-facing cards are built by *allow-list*, never
// by taking a CRM row and deleting fields from it. booking_applications has 121
// columns — primary_aadhaar, primary_pan, primary_mobile, consideration_value,
// loan_amount, signature_data among them — and a deny-list over a table that
// wide is one migration away from leaking whatever column gets added next.
//
// Hence BOOKING_CARD_FIELDS / VISIT_CARD_FIELDS below: the SELECT lists in the
// chat route name these columns and no others, so a new sensitive column cannot
// reach the client by default.

/** Roles as they are spelled in users.role, normalized for comparison. */
export function normalizeRole(role: any): string {
  return (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
}

/**
 * The label shown above a message. Deliberately title-cased from a fixed map
 * rather than echoing users.role, because that column holds "admin" lowercase
 * for the Admin user and "Site Head" title-cased for another — echoing it
 * verbatim would print "admin · Admin".
 */
const ROLE_LABELS: Record<string, string> = {
  "admin": "Admin",
  "receptionist": "Receptionist",
  "sales manager": "Sales Manager",
  "senior sales manager": "Senior Sales Manager",
  "sourcing manager": "Sourcing Manager",
  "site head": "Site Head",
  "caller": "Caller",
};

/**
 * Accent tone per source. The panel maps these to colours; keeping the mapping
 * server-side means a message cannot be styled as one role while being authored
 * by another.
 */
const ROLE_TONES: Record<string, string> = {
  "admin": "neutral",
  "receptionist": "blue",
  "sales manager": "orange",
  "senior sales manager": "orange",
  "sourcing manager": "magenta",
  "site head": "neutral",
  "caller": "blue",
};

export interface CpSender {
  /** Normalized role key, e.g. "sales manager". */
  role: string;
  /** The actual employee name, e.g. "Mayur Acharya". Empty when unresolvable. */
  name: string;
  /** What the UI prints: "Sales Manager · Mayur Acharya". */
  label: string;
  /** Accent key: neutral | blue | orange | magenta | system. */
  tone: string;
  /** True when no human could be resolved and the event is CRM-generated. */
  system: boolean;
}

/**
 * Builds the "Role · Name" attribution.
 *
 * `userRole`/`userName` come from a join against users (authoritative).
 * `storedRole`/`storedName` are the strings the CRM persisted on the event row
 * itself — site_visits.created_by / booking_applications.created_role — used
 * when the name no longer matches a live user, e.g. after an employee leaves.
 *
 * Falls back to "System · CRM" only when nothing identifies a person. A bare
 * "Admin" or "Staff" is never returned: if a name exists it is always shown.
 */
export function resolveSender(
  userRole: any, userName: any, storedRole?: any, storedName?: any
): CpSender {
  const name = (userName ?? storedName ?? "").toString().trim();
  const role = normalizeRole(userRole ?? storedRole);

  if (!name && !role) {
    return { role: "system", name: "", label: "System · CRM", tone: "system", system: true };
  }

  // A recognised role gets its canonical label; an unrecognised one is title-cased
  // rather than dropped, so a role added later still reads sensibly.
  const roleLabel = ROLE_LABELS[role]
    ?? (role ? role.replace(/\b\w/g, c => c.toUpperCase()) : "");

  if (!name) {
    return { role, name: "", label: roleLabel || "System · CRM", tone: ROLE_TONES[role] ?? "system", system: !roleLabel };
  }
  return {
    role,
    name,
    label: roleLabel ? `${roleLabel} · ${name}` : name,
    tone: ROLE_TONES[role] ?? "neutral",
    system: false,
  };
}

/**
 * The ONLY booking columns a Channel Partner card may carry.
 *
 * Floor is included because the existing business flow already prints it on the
 * unit designation the partner quotes ("A-1402, 14th floor") — it identifies the
 * unit, not the buyer. Everything financial, everything identifying and every
 * document reference is absent by construction.
 */
export const BOOKING_CARD_FIELDS = [
  "booking_number", "customer_name", "unit_config", "building", "tower", "wing", "floor",
] as const;

/** The only site-visit columns a CP card may carry. */
export const VISIT_CARD_FIELDS = [
  "customer_name", "lead_ref", "status", "feedback",
] as const;

/**
 * Title-cases the unit configuration, which is typed freehand and arrives as
 * "2BHK", "1Bhk", "2 BHK" and "N/A" in the same column.
 */
export function formatUnitConfig(raw: any): string {
  const s = (raw ?? "").toString().trim();
  if (!s || /^n\/?a$/i.test(s)) return "";
  return s.replace(/^(\d+)\s*bhk$/i, "$1 BHK").replace(/\bbhk\b/gi, "BHK");
}

/** Blank-safe display value; the panel prints an em dash for empty. */
export const clean = (v: any): string => {
  const s = (v ?? "").toString().trim();
  return s && !/^n\/?a$/i.test(s) ? s : "";
};

/** Message kinds the thread understands — mirrors cp_chat_messages.message_type. */
export type CpMessageKind =
  | "text" | "visit" | "customer_update" | "booking_update" | "attachment";
