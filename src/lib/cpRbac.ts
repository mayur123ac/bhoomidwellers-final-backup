// cpRbac.ts — Channel Partner role gates, shared by the API routes and the UI.
//
// Kept in one place because the CP master is now written from four different
// entry points (Receptionist office-visit form, Sourcing Manager panel, Admin
// panel, and auto-creation from lead intake) with four different permission
// levels. Previously `canManagePartners` lived in the route file and covered a
// single admin/sales-manager gate; splitting it into view/create/edit/delete
// means widening create for Receptionist does not accidentally widen edit.
//
// The UI imports these to decide what to render. That is convenience only —
// every route re-derives the role from the `crm_session` cookie, never from the
// request body, so a hand-rolled POST cannot claim a role it does not have.

/**
 * Role strings are inconsistent in the users table: "site_head" and "Site Head"
 * both occur (see middleware.ts, which checks for both). Normalizing underscores
 * to spaces means every gate below only has to spell each role one way.
 */
export function normalizeRole(role: any): string {
  return (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
}

/** Read the CP list and individual CP records. */
const VIEW_ROLES = ["admin", "sales manager", "sourcing manager", "site head", "receptionist"];

/**
 * See the whole partner registry, rather than only the partners assigned to you.
 *
 * Sourcing Manager is the one role excluded: their panel is their own book of
 * partners, and the registry at large is not theirs to browse. This is enforced in
 * GET /api/channel-partners by forcing their own id into the WHERE clause — the
 * same shape /api/cp-enquiries already uses — so the rows never leave the server
 * rather than being filtered out in the UI.
 */
const VIEW_ALL_ROLES = ["admin", "sales manager", "site head", "receptionist"];

/**
 * Change which Sourcing Manager owns a partner.
 *
 * Admin only, matching /api/cp-enquiries/[id]/assign: a Sales Manager works the
 * commercial queue (rates, bank details) but does not decide whose desk a partner
 * sits on, and a Sourcing Manager must not be able to claim partners or push their
 * own book onto someone else. Note this governs *re*assignment — picking an owner
 * while first registering a partner is part of create, gated by CREATE_ROLES.
 */
const ASSIGN_ROLES = ["admin"];

/**
 * Create a CP record. Receptionist and Sourcing Manager are here for the
 * office-visit registration flow; they deliberately do NOT get edit.
 */
const CREATE_ROLES = ["admin", "sales manager", "sourcing manager", "receptionist"];

/**
 * Edit an existing CP. Unchanged from the original `canManagePartners`: commission
 * rates drive real payouts, and the "Needs Rate" queue is worked by Sales Managers.
 */
const EDIT_ROLES = ["admin", "sales manager"];

/** Delete a CP record. Admin only. */
const DELETE_ROLES = ["admin"];

/**
 * See commission rate, lead/booking counts, and the commission drill-down.
 * Sourcing Manager and Site Head are excluded: their remit is the partner's
 * business profile, not the commercial terms.
 */
const COMMERCIAL_ROLES = ["admin", "sales manager"];

export const canViewPartners = (role: any) => VIEW_ROLES.includes(normalizeRole(role));
export const canViewAllPartners = (role: any) => VIEW_ALL_ROLES.includes(normalizeRole(role));
export const canCreatePartners = (role: any) => CREATE_ROLES.includes(normalizeRole(role));
export const canEditPartners = (role: any) => EDIT_ROLES.includes(normalizeRole(role));
export const canDeletePartners = (role: any) => DELETE_ROLES.includes(normalizeRole(role));
export const canAssignPartners = (role: any) => ASSIGN_ROLES.includes(normalizeRole(role));
export const canSeePartnerCommercials = (role: any) => COMMERCIAL_ROLES.includes(normalizeRole(role));

/**
 * Permission bundle for the list view, so the panels each pass one object
 * instead of re-deriving five booleans from the role string.
 */
export interface CpPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canViewAll: boolean;
  canSeeCommercials: boolean;
}

export function cpPermissionsFor(role: any): CpPermissions {
  return {
    canCreate: canCreatePartners(role),
    canEdit: canEditPartners(role),
    canDelete: canDeletePartners(role),
    canAssign: canAssignPartners(role),
    canViewAll: canViewAllPartners(role),
    canSeeCommercials: canSeePartnerCommercials(role),
  };
}

/**
 * Last 10 digits of a phone number — the same key the commission engine's
 * `SQL_NORMALIZED_PHONE` expression index uses, so the dedup check in POST
 * matches whatever `findOrCreateChannelPartner` would have matched.
 */
export function normalizeCpPhone(raw: any): string {
  const digits = (raw ?? "").toString().replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}
