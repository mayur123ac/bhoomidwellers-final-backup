"use client";

// components/RoleSidebar.tsx — one place that answers "which navigation rail
// does this user get?".
//
// ── The bug this exists to fix ──────────────────────────────────────────────
// The Settings panel used to mount <AdminSidebar> unconditionally and then cut
// the item list down per role, so a Sales Manager who opened Settings watched
// their entire application shell turn into the Admin one: their seven nav items
// were replaced by "Quick jump / Back to workspace / Settings". The rail was
// being chosen by the ROUTE (Settings is an admin-area page, so it got the
// admin rail) when it should be chosen by the USER.
//
// So the decision moves here, above every host, and hosts ask for "the rail for
// this person" instead of naming one. Adding a role-specific rail later is an
// entry in the switch below, not an edit to every page that renders navigation.
//
// ── Why the two rails are not merged ────────────────────────────────────────
// They look similar and are not the same: the Admin rail has Quick Jump and
// group headings, the Sales rail has larger items and a version footer, and the
// two disagree on padding and icon size. Both were shipped and are in daily
// use, so "preserve the existing sidebar" for each role means keeping both
// components. What is shared is this choice, not the markup.

import { useMemo } from "react";
import AdminSidebar, { type AdminNavItem } from "@/components/admin/AdminSidebar";
import SalesSidebar, { SALES_NAV, type SalesNavItem } from "@/components/sales/SalesSidebar";
import ReceptionistSidebar, {
  RECEPTIONIST_NAV,
  type ReceptionistNavItem,
} from "@/components/receptionist/ReceptionistSidebar";
import { useOrgName } from "@/lib/hooks/useOrgName";

/** Underscores and casing vary in the users table — "site_head" and "Site Head". */
export function normalizeRoleName(role: unknown): string {
  return (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
}

/** Which rail component a role gets. Presentation only — RBAC is middleware. */
export type RailKind = "admin" | "sales" | "receptionist";

export function railKindForRole(role: unknown): RailKind {
  const r = normalizeRoleName(role);
  if (r === "sales manager") return "sales";
  // The Receptionist had the same bug this file was created to fix: their eight
  // nav items were replaced by the cut-down admin rail the moment they opened
  // Settings. Now that their rail is a mountable component, they keep it.
  if (r === "receptionist") return "receptionist";
  return "admin";
}

/**
 * A destination expressed the same way by both rails, so a host can handle a
 * click without knowing which rail produced it: `id` identifies the nav item,
 * `link` is where to go, and `tab` (when set) is the in-page view the
 * destination should open on.
 */
export interface RailTarget {
  id: string;
  label: string;
  link: string;
  tab?: string;
}

export interface AdminRailItem extends AdminNavItem {
  link: string;
}

export default function RoleSidebar({
  role,
  activeId,
  onNavigate,
  expanded,
  onExpandedChange,
  adminItems,
  adminGroups,
  adminLogoSrc,
  hideOnMobile,
}: {
  role: unknown;
  /** Nav item id to render active, or null. Ids are per-rail. */
  activeId: string | null;
  onNavigate: (target: RailTarget) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Admin-rail item list. Required for every role that gets the admin rail. */
  adminItems?: AdminRailItem[];
  adminGroups?: Record<string, string>;
  adminLogoSrc?: string;
  /**
   * Only the Sales rail hides itself below `md` (its host has a bottom nav
   * there). The Admin rail has always been visible at every width, so this is
   * ignored for it rather than being made to apply to both — matching the
   * existing behaviour of each is the requirement.
   */
  hideOnMobile?: boolean;
}) {
  const kind = railKindForRole(role);

  // Fetch the organisation name once at this level so all three rails share a
  // single fetch — the hook always runs (React rules), but only one sidebar
  // renders. While loading the name is null and the sidebar simply omits it
  // rather than flashing a stale or incorrect value.
  const { name: orgName, loading: orgLoading } = useOrgName();
  // Pass null while loading so no stale value appears; once loaded pass the name
  // (which may still be null if the org has no name — both are handled gracefully).
  const resolvedOrgName = orgLoading ? null : orgName;

  // The Sales rail's ids double as the dashboard's `activeView` values, so the
  // tab a click should land on is the id itself — except Settings, which is a
  // route of its own rather than a view of the dashboard.
  const salesTargets = useMemo<Record<string, RailTarget>>(() => {
    const map: Record<string, RailTarget> = {};
    for (const item of SALES_NAV) {
      map[item.id] =
        item.id === "settings"
          ? { id: item.id, label: item.label, link: "/dashboard/settings/profile" }
          : { id: item.id, label: item.label, link: "/dashboard/sales", tab: item.id };
    }
    return map;
  }, []);

  // Same shape as salesTargets: rail ids are the dashboard's `activeTab` values,
  // so a click carries its tab home. Settings is the exception in both rails —
  // it is a route, not a tab of the dashboard.
  const receptionistTargets = useMemo<Record<string, RailTarget>>(() => {
    const map: Record<string, RailTarget> = {};
    for (const item of RECEPTIONIST_NAV) {
      map[item.id] =
        item.id === "settings"
          ? { id: item.id, label: item.label, link: "/dashboard/settings/profile" }
          : { id: item.id, label: item.label, link: "/dashboard/receptionist", tab: item.id };
    }
    return map;
  }, []);

  if (kind === "sales") {
    return (
      <SalesSidebar
        activeId={activeId}
        onSelect={(item: SalesNavItem) =>
          onNavigate(
            salesTargets[item.id] ?? { id: item.id, label: item.label, link: "/dashboard/sales" }
          )
        }
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        hideOnMobile={hideOnMobile}
        orgName={resolvedOrgName}
      />
    );
  }

  if (kind === "receptionist") {
    return (
      <ReceptionistSidebar
        activeId={activeId}
        onSelect={(item: ReceptionistNavItem) =>
          onNavigate(
            receptionistTargets[item.id] ?? {
              id: item.id,
              label: item.label,
              link: "/dashboard/receptionist",
            }
          )
        }
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        hideOnMobile={hideOnMobile}
        orgName={resolvedOrgName}
      />
    );
  }

  return (
    <AdminSidebar
      items={adminItems ?? []}
      activeId={activeId}
      onSelect={(item) => onNavigate({ id: item.id, label: item.label, link: item.link })}
      isHovered={expanded}
      onHoverChange={onExpandedChange}
      groups={adminGroups}
      logoSrc={adminLogoSrc}
      orgName={resolvedOrgName}
    />
  );
}
