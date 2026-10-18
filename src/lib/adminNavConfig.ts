// lib/adminNavConfig.ts — Central navigation configuration for the Admin sidebar.
//
// Both /dashboard and /dashboard/employees import this single definition so the
// rail never drifts between the two routes. Each page calls getAdminNavItems()
// to get the full typed array, then builds its own onSelect handler based on
// whether an item is "local" (set state) or "remote" (router.push).

import type { IconType } from "react-icons";
import {
  FaThLarge, FaFileInvoiceDollar, FaBoxes, FaHandshake, FaComments,
  FaUniversity, FaClipboardList, FaUsers, FaIdCard, FaPhoneAlt,
  FaSignal, FaCalendarAlt, FaUserClock, FaChartPie, FaFileInvoice,
  FaMapMarkerAlt, FaWhatsapp, FaCog, FaMoneyBillWave,
} from "react-icons/fa";
import { BhoomiAiGlyph } from "@/components/bhoomi-ai/BhoomiAiIcon";

export interface AdminNavEntry {
  id: string;
  icon: IconType;
  label: string;
  /** Which group heading this item falls under. */
  group: string;
  /** Pinned items render in the bottom block of the sidebar. */
  pinned?: boolean;
  /**
   * Which route "owns" this item (renders its content in-place):
   *   "dashboard"  → /dashboard renders via activeView
   *   "employees"  → /dashboard/employees renders via activeSection
   *   "settings"   → /dashboard/settings (standalone route)
   *   "local"      → rendered in-place on whichever page is active (e.g. Bhoomi AI)
   */
  owner: "dashboard" | "employees" | "settings" | "local";
  /**
   * For items owned by "employees", the section key used by setActiveSection.
   * Matches the ?tab= value that the employees page reads on mount.
   */
  section?: string;
}

/**
 * The canonical ordered list of all admin navigation entries.
 * Role filtering is applied by the consumer (each page) since it depends on
 * runtime state (user role, cpEnquiryVisible, canViewPartners, etc.).
 */
export function getAdminNavItems(): AdminNavEntry[] {
  return [
    // ── WORKSPACE ──
    { id: "dashboard",              icon: FaThLarge,            label: "Overview",                group: "Workspace",     owner: "dashboard" },
    { id: "revenue_intelligence",   icon: FaFileInvoiceDollar,  label: "Revenue Intelligence",    group: "Workspace",     owner: "dashboard" },
    { id: "inventory",              icon: FaBoxes,              label: "Inventory",               group: "Workspace",     owner: "dashboard" },
    { id: "cp_enquiry",             icon: FaHandshake,          label: "Active CP Info",          group: "Workspace",     owner: "dashboard" },
    { id: "cp_linked_leads",        icon: FaHandshake,          label: "CP's Walk-In Enquiries",  group: "Workspace",     owner: "dashboard" },
    { id: "cp_chat",                icon: FaComments,           label: "CP Chat",                 group: "Workspace",     owner: "dashboard" },
    { id: "banking_info",           icon: FaUniversity,         label: "Bankers Info",            group: "Workspace",     owner: "dashboard" },

    // ── TEAM ──
    { id: "receptionist",           icon: FaClipboardList,      label: "Receptionist",            group: "Team",          owner: "dashboard" },
    { id: "sales",                  icon: FaUsers,              label: "Sales Managers",          group: "Team",          owner: "dashboard" },
    { id: "site_head",              icon: FaUniversity,         label: "Site Heads",              group: "Team",          owner: "dashboard" },
    { id: "callers",                icon: FaPhoneAlt,           label: "Caller Panel",            group: "Team",          owner: "employees", section: "callers" },
    { id: "employees",              icon: FaIdCard,             label: "Add Employee",            group: "Team",          owner: "employees", section: "employees" },

    // ── INSIGHTS ──
    { id: "live_activity",          icon: FaSignal,             label: "Attendance Tracker",      group: "Insights",      owner: "dashboard" },
    { id: "site_visit_overview",    icon: FaCalendarAlt,        label: "Site Visit Overview",     group: "Insights",      owner: "dashboard" },
    { id: "monitoring",             icon: FaChartPie,           label: "Employee Performance",    group: "Insights",      owner: "dashboard" },
    { id: "payroll_approvals",      icon: FaFileInvoice,        label: "Payroll Approvals",       group: "Insights",      owner: "dashboard" },
    { id: "geo",                    icon: FaMapMarkerAlt,       label: "Geo Analytics",           group: "Insights",      owner: "dashboard" },

    // ── MY ACCOUNT ──
    { id: "attendance",             icon: FaUserClock,          label: "My Attendance",           group: "My Account",    owner: "dashboard" },
    { id: "my-salary",              icon: FaMoneyBillWave,      label: "My Salary",               group: "My Account",    owner: "dashboard" },

    // ── ADMIN & TOOLS ──
    { id: "notifications",          icon: FaWhatsapp,           label: "WhatsApp Alerts",         group: "Admin & Tools", owner: "employees", section: "notifications" },
    // ai renders in-place on BOTH pages — owner is "local" so each page treats it as its own view
    { id: "ai",                     icon: BhoomiAiGlyph,        label: "Bhoomi AI",               group: "Admin & Tools", owner: "local",  pinned: true },
    { id: "settings",               icon: FaCog,                label: "Settings",                group: "Admin & Tools", owner: "settings",   pinned: true },
  ];
}

/**
 * Group headings keyed by item id — derived from the canonical list.
 * Consumed by AdminSidebar's `groups` prop.
 */
export function getAdminNavGroups(): Record<string, string> {
  const groups: Record<string, string> = {};
  for (const item of getAdminNavItems()) {
    groups[item.id] = item.group;
  }
  return groups;
}

/**
 * Standard role-based filtering applied to the nav items.
 * Both pages call this with their runtime role info.
 */
export function filterNavByRole(
  items: AdminNavEntry[],
  opts: {
    isAdmin: boolean;
    isSiteHead: boolean;
    userRole: string;
    canViewPartners?: (role: string) => boolean;
  },
): AdminNavEntry[] {
  return items.filter((item) => {
    if (opts.isAdmin) return true;

    // Admin-only items
    if (item.id === "revenue_intelligence" || item.id === "geo" || item.id === "payroll_approvals") return false;
    if (item.id === "settings") return false;

    // CP Chat requires partner-viewing permission
    if (item.id === "cp_chat" && opts.canViewPartners && !opts.canViewPartners(opts.userRole)) return false;

    // Site Head: allowed live_activity, ai, but NOT employees-page items
    // (middleware blocks /dashboard/employees for Site Head)
    if (opts.isSiteHead) {
      if (item.id === "callers" || item.id === "employees" || item.id === "notifications") return false;
      return true;
    }

    // Other non-admin roles: no access to employees-page items
    if (!opts.isAdmin && (item.id === "callers" || item.id === "employees" || item.id === "notifications")) return false;

    return true;
  });
}
