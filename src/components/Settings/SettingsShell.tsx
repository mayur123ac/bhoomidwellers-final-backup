"use client";

// components/Settings/SettingsShell.tsx — Settings as a panel of the Admin Panel.
//
// Settings is its own route because the Admin Dashboard file is already large,
// exactly like /dashboard/employees. And like that page, it has to be
// indistinguishable from the dashboard around it: same global rail, same header,
// same theme. So it hosts the shared <AdminSidebar /> and reproduces the Admin
// header, and only the region to the right of the rail differs.
//
// Two levels of navigation live here and must not be confused:
//   * AdminSidebar — global application navigation (Overview, Sales, …, Settings)
//   * The Settings local nav — sections within Settings (Profile, Preferences, …)
//
// Sections are declared once in NAV below. Each carries an `adminOnly` flag and
// an optional `status`, and the local nav renders from that list — so adding a
// section is one entry here, and a section that isn't built yet is visibly
// labelled rather than silently linking to a blank page.
import { FiUser, FiHelpCircle, FiLogOut, FiChevronRight } from "react-icons/fi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import type { IconType } from "react-icons";
import { motion, AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import {
  FaBell,
  FaBoxes,
  FaBoxOpen,
  FaCalendarAlt,
  FaChartPie,
  FaClipboardList,
  FaCog,
  FaComments,
  FaCreditCard,
  FaEnvelope,
  FaEye,
  FaEyeSlash,
  FaFileInvoiceDollar,
  FaHandshake,
  FaHistory,
  FaIdCard,
  FaKey,
  FaLifeRing,
  FaMapMarkerAlt,
  FaPhoneAlt,
  FaPlug,
  FaPuzzlePiece,
  FaSignal,
  FaSlidersH,
  FaThLarge,
  FaTimes,
  FaUniversity,
  FaUserClock,
  FaUserCircle,
  FaUsers,
  FaUsersCog,
  FaUserTie,
  FaWhatsapp,
} from "react-icons/fa";
import { FaWandMagicSparkles } from "react-icons/fa6";

import { BhoomiAiGlyph } from "@/components/bhoomi-ai/BhoomiAiIcon";
import { type AdminNavItem } from "@/components/admin/AdminSidebar";
import AdminMobileDrawer from "@/components/admin/AdminMobileDrawer";
import RoleSidebar, { type RailTarget, railKindForRole } from "@/components/RoleSidebar";
import MobileNavDrawer from "@/components/sales/MobileNavDrawer";
import SalesSettingsBells from "@/components/sales/SalesSettingsBells";
import AttendanceBadge from "@/components/AttendanceBadge";
import { useAttendance } from "@/components/AttendanceContext";
import CrmUpdatesNotification from "@/components/CrmUpdatesNotification";
import UserAvatar from "@/components/UserAvatar";
import AppHeader from "@/components/AppHeader";
import HeaderClock from "@/components/HeaderClock";
import { clearCrmSession, getStoredCrmUser } from "@/lib/authSession";
import { canViewPartners } from "@/lib/cpRbac";
import { SectionErrorBoundary, SETTINGS_THEME_CSS, T, ToastProvider } from "./ui";
import { useOrgName } from "@/lib/hooks/useOrgName";
export interface NavItem {
  href: string;
  label: string;
  icon: IconType;
  adminOnly?: boolean;
  /** "planned" renders a muted badge — the section exists but has no backend. */
  status?: "planned";
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Personal",
    items: [
      { href: "/dashboard/settings/profile", label: "Profile", icon: FaUserCircle },
      { href: "/dashboard/settings/account-security", label: "Account & Security", icon: FaKey },
      { href: "/dashboard/settings/preferences", label: "Preferences", icon: FaSlidersH },
      { href: "/dashboard/settings/notifications", label: "Notifications", icon: FaBell },
      { href: "/dashboard/settings/activity-logs", label: "Activity Logs", icon: FaHistory },
      { href: "/dashboard/settings/additional-features", label: "Additional Features", icon: FaWandMagicSparkles },
    ],
  },
  {
    group: "Integrations & APIs",
    items: [
      // Not adminOnly: this is where a Sales Manager sets the number their own
      // leads are messaged from, and it is the screen that explains why that
      // number stops sending once the Business API is connected.
      { href: "/dashboard/settings/whatsapp-integration", label: "WhatsApp Integration", icon: FaWhatsapp },
      { href: "/dashboard/settings/developer-api", label: "Developer API", icon: FaPlug, adminOnly: true },
      { href: "/dashboard/settings/connected-accounts", label: "Connected Accounts", icon: FaPuzzlePiece, adminOnly: true, status: "planned" },
      { href: "/dashboard/settings/email-senders", label: "Email Senders", icon: FaEnvelope, adminOnly: true, status: "planned" },
      { href: "/dashboard/settings/integrations-hub", label: "Integrations Hub", icon: FaBoxOpen, adminOnly: true, status: "planned" },
    ],
  },
  {
    group: "Control",
    items: [
      { href: "/dashboard/settings/number-control", label: "Number Control", icon: FaPhoneAlt, adminOnly: true },
    ],
  },
  {
    group: "Workspace",
    items: [
      { href: "/dashboard/settings/workspace", label: "Workspace Settings", icon: FaCog, adminOnly: true },
      { href: "/dashboard/settings/employees", label: "Employee Management", icon: FaIdCard, adminOnly: true },
      { href: "/dashboard/settings/members-team", label: "Members & Team", icon: FaUsersCog, adminOnly: true, status: "planned" },
      { href: "/dashboard/settings/plans", label: "Plans", icon: FaClipboardList, adminOnly: true, status: "planned" },
      { href: "/dashboard/settings/billing", label: "Billing", icon: FaCreditCard, adminOnly: true, status: "planned" },
      { href: "/dashboard/settings/support-requests", label: "Support Requests", icon: FaLifeRing, adminOnly: true, status: "planned" },
    ],
  },
];

export function isAdminRole(role: unknown): boolean {
  return (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ") === "admin";
}

/* ── Global rail ────────────────────────────────────────────────────────────
   Mirrors the list on /dashboard/employees. `link` is where the item goes;
   `pinned` puts it in the bottom block, in array order — Bhoomi AI first,
   Settings last. */

type RailItem = AdminNavItem & { link: string };

const RAIL: RailItem[] = [
  { id: "dashboard", icon: FaThLarge, label: "Overview", link: "/dashboard" },
  { id: "revenue_intelligence", icon: FaFileInvoiceDollar, label: "Revenue Intelligence", link: "/dashboard?tab=revenue_intelligence" },
  { id: "inventory", icon: FaBoxes, label: "Inventory", link: "/dashboard?tab=inventory" },
  { id: "cp_chat", icon: FaComments, label: "CP Chat", link: "/dashboard?tab=cp_chat" },
  { id: "receptionist", icon: FaClipboardList, label: "Receptionist", link: "/dashboard?tab=receptionist" },
  { id: "sales", icon: FaUsers, label: "Sales Managers", link: "/dashboard?tab=sales" },
  { id: "site_head", icon: FaUniversity, label: "Site Heads", link: "/dashboard?tab=site_head" },
  { id: "site_visit_overview", icon: FaCalendarAlt, label: "Site Visit Overview", link: "/dashboard?tab=site_visit_overview" },
  { id: "attendance", icon: FaUserClock, label: "My Attendance", link: "/dashboard?tab=attendance" },
  { id: "monitoring", icon: FaChartPie, label: "Daily Monitor", link: "/dashboard?tab=monitoring" },
  { id: "live_activity", icon: FaSignal, label: "Attendance Tracker", link: "/dashboard?tab=live_activity" },
  { id: "geo", icon: FaMapMarkerAlt, label: "Geo Analytics", link: "/dashboard?tab=geo" },
  { id: "callers", icon: FaPhoneAlt, label: "Caller Panel", link: "/dashboard/employees?tab=callers" },
  { id: "employees", icon: FaIdCard, label: "Add Employee", link: "/dashboard/employees" },
  { id: "notifications", icon: FaWhatsapp, label: "WhatsApp Alerts", link: "/dashboard/employees?tab=notifications" },
  { id: "ai", icon: BhoomiAiGlyph, label: "Bhoomi AI", link: "/dashboard/employees?tab=ai", pinned: true },
  { id: "settings", icon: FaCog, label: "Settings", link: "/dashboard/settings", pinned: true },
];

/**
 * The ADMIN rail's item list, cut to what each role that gets the admin rail can
 * actually open.
 *
 * Neither a Sales Manager nor a Receptionist reaches this function any more —
 * both have their own rail component, chosen by RoleSidebar, so opening Settings
 * leaves their navigation intact. It still applies to Site Head, Sourcing
 * Manager and Caller, whose dashboards still render their navigation inline
 * exactly as the Sales dashboard used to. Until those are extracted the same
 * way, the cut-down admin rail remains their existing Settings navigation.
 *
 * Offering someone a "Geo Analytics" button that middleware bounces straight
 * back would be worse than not offering it. This mirrors middleware.ts; that
 * file remains the enforcement, this is only presentation.
 */
function railForRole(role: unknown): RailItem[] {
  const r = (role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
  const settings = RAIL.find((i) => i.id === "settings")!;

  if (r === "admin") return RAIL;

  if (r === "site head") {
    // /dashboard/employees and the caller panel are on Site Head's forbidden
    // list, and everything hosted there goes with them. Revenue Intelligence
    // and CP Management are Admin-only panels on the dashboard itself, and
    // Channel Partners / CP Chat follow the same canViewPartners() gate the
    // dashboard uses — Site Head is in VIEW_ROLES today, but this stays in
    // sync automatically if that ever changes instead of hardcoding "yes".
    const blocked = new Set(["callers", "employees", "notifications", "ai", "revenue_intelligence"]);
    if (!canViewPartners(role)) {
      blocked.add("cp_chat");
    }
    return RAIL.filter((i) => !blocked.has(i.id));
  }

  // Every remaining role is confined to a single path. Give them the way back
  // to it, plus Settings.
  const home: Record<string, string> = {
    receptionist: "/dashboard/receptionist",
    "sourcing manager": "/dashboard/sourcing",
    caller: "/dashboard/caller",
  };
  const path = home[r];
  return [
    ...(path
      ? [{ id: "home", icon: FaThLarge, label: "Back to workspace", link: path }]
      : []),
    settings,
  ];
}


const RAIL_GROUPS: Record<string, string> = {
  dashboard: "Workspace",
  revenue_intelligence: "Workspace",
  inventory: "Workspace",
  cp_chat: "Workspace",
  receptionist: "Team",
  sales: "Team",
  site_head: "Team",
  site_visit_overview: "Insights",
  attendance: "Insights",
  monitoring: "Insights",
  live_activity: "Insights",
  geo: "Insights",
  callers: "Admin",
  employees: "Admin",
  notifications: "Admin",
};

/* ── Header chrome theme ────────────────────────────────────────────────────
   CrmUpdatesNotification takes the dashboard's theme object. It reads six keys;
   these are the same values the Admin/Employee buildTheme() produces for them. */
function buildChromeTheme(isDark: boolean) {
  return {
    dropdown: isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200",
    dropdownGlass: {},
    tableBorder: isDark ? "border-[#222]" : "border-indigo-200",
    text: isDark ? "text-white" : "text-[#1A1A1A]",
    textMuted: isDark ? "text-gray-400" : "text-[#6B7280]",
    scroll: isDark ? "custom-scrollbar" : "custom-scrollbar-light",
  };
}

const SunIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);
const MoonIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export default function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMarkedPresent, timeIn } = useAttendance();
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [adminMobileNavOpen, setAdminMobileNavOpen] = useState(false);
  const { name: orgName, loading: orgLoading } = useOrgName();

  // The one theme preference the whole CRM shares, now owned by lib/theme.ts.
  // Settings has no store of its own, so Dashboard → Employees → Settings never
  // changes appearance mid-journey — and the Preferences → Theme radio group
  // moves this header's toggle on the same tick, because both go through the
  // same module.
  const { isDark, toggleTheme } = useCrmTheme();

  const chrome = useMemo(() => buildChromeTheme(isDark), [isDark]);

  // The whole panel's colour comes from CSS variables scoped to this attribute,
  // so it has to be right — and it is the one thing here that hydration will not
  // fix for us. The server has no localStorage, so it always renders "light";
  // React reconciles the mismatched inline styles on the client but leaves the
  // stale data-* attribute in place, which left the cards light while the header
  // went dark. Writing it imperatively makes the attribute follow `isDark`
  // regardless of what the server sent.
  const hostRef = useRef<HTMLDivElement>(null);
  // `ready` is a dependency because the pre-auth placeholder and the real shell
  // are different elements — without it the attribute would be written to the
  // placeholder and never to the tree that replaces it.
  useEffect(() => {
    hostRef.current?.setAttribute("data-st-theme", isDark ? "dark" : "light");
  }, [isDark, ready]);

  useEffect(() => {
    const stored = getStoredCrmUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    setReady(true);
  }, [router]);

  // Cross-tab sync and the toggle itself now live in lib/theme.ts, reached
  // through useCrmTheme above. The `storage` listener and the local setter that
  // used to be here were one of six near-identical copies.

  // Close the mobile drawer on navigation, or it stays open covering the page
  // the user just chose.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // One handler for either rail. RoleSidebar normalises both rails' clicks into
  // a RailTarget, so this does not need to know which one is mounted — that is
  // what stops "which rail am I on" leaking back into the host.
  const railSelect = (target: RailTarget) => {
    setIsSidebarHovered(false);
    if (target.id === "settings") return; // already here

    // The dashboards restore this on mount, so a rail item that names an
    // in-page view (Assigned Leads, Inventory, …) lands on that view rather
    // than dumping the user on the destination's default tab. The admin rail
    // has always used `id`; the sales rail passes its view id as `tab`.
    try {
      localStorage.setItem("return_tab", target.tab ?? target.id);
    } catch {
      /* ignore */
    }
    router.push(target.link);
  };

  const handleLogout = () => {
    clearCrmSession();
    router.replace("/");
  };

  const pageStyle = isDark
    ? { background: "#0a0a0a" }
    : {
      background:
        "linear-gradient(135deg,#fdf0f8 0%,#f8fafc 30%,#faf0fb 62%,#f8fafc 78%,#fce8f6 100%)",
    };

  if (!ready) {
    return (
      <div
        ref={hostRef}
        className="min-h-screen"
        data-st-theme={isDark ? "dark" : "light"}
        style={pageStyle}
      >
        <style dangerouslySetInnerHTML={{ __html: SETTINGS_THEME_CSS }} />
      </div>
    );
  }

  const admin = isAdminRole(user?.role);
  const isSalesManager = railKindForRole(user?.role) === "sales";
  // The local nav hides what this user cannot use. The API routes enforce it
  // independently — hiding a link is presentation, not access control.
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.adminOnly || admin),
  })).filter((g) => g.items.length > 0);

  const currentSection = groups
    .flatMap((g) => g.items)
    .find((item) => pathname === item.href);

  const localNav = (
    <nav className="p-3" aria-label="Settings sections">
      {groups.map((group) => (
        <div key={group.group} className="mb-5 last:mb-1">
          <p
            className="px-3 pb-2 crm-eyebrow"
            style={{ color: T.muted }}
          >
            {group.group}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[42px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${active ? "" : "st-hover-surface"
                      }`}
                    style={{
                      background: active ? T.accentSoft : "transparent",
                      color: active ? T.teal : T.text,
                      fontWeight: active ? 600 : 400,
                      // Same left indicator the global rail uses for its active
                      // item, at panel scale.
                      boxShadow: active ? `inset 3px 0 0 ${T.teal}` : undefined,
                    }}
                  >
                    <Icon
                      className="h-3.5 w-3.5 flex-shrink-0"
                      style={{ color: active ? T.teal : T.muted }}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.status === "planned" && (
                      <span
                        className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                        style={{ background: T.neutralSoft, color: T.neutralText }}
                      >
                        Soon
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const horizontalLocalNav = (
    <nav className="flex items-center gap-2 overflow-x-auto pb-3 custom-scrollbar-light w-full" aria-label="Settings sections">
      {groups.flatMap(g => g.items).map(item => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm whitespace-nowrap transition-colors flex-shrink-0 border border-transparent ${active ? "" : "st-hover-surface hover:border-gray-200 dark:hover:border-white/10"
              }`}
            style={{
              background: active ? T.accentSoft : "transparent",
              color: active ? T.teal : T.text,
              fontWeight: active ? 600 : 500,
              boxShadow: active ? `inset 0 0 0 1px ${T.teal}` : undefined,
            }}
          >
            <Icon className="h-4 w-4" style={{ color: active ? T.teal : T.muted }} />
            {item.label}
            {item.status === "planned" && (
              <span className="ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: T.neutralSoft, color: T.neutralText }}>
                Soon
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    // The theme host sits outside ToastProvider so the toast stack — which
    // renders as a sibling of the children — resolves the same variables.
    // display:contents keeps it out of the layout entirely.
    <div
      ref={hostRef}
      data-st-theme={isDark ? "dark" : "light"}
      style={{ display: "contents" }}
    >
      <style dangerouslySetInnerHTML={{ __html: SETTINGS_THEME_CSS }} />
      <ToastProvider>
        <div
          className={`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 ${isDark ? "text-gray-200" : "text-[#1A1A1A]"
            }`}
          style={pageStyle}
        >
          {/* ── Global rail, chosen by role rather than by route ──
            A Sales Manager keeps their own rail here; everyone else keeps the
            admin one they already had. `activeId="settings"` is the id of the
            Settings item in BOTH rails, so it highlights either way. */}
          <RoleSidebar
            role={user?.role}
            activeId="settings"
            onNavigate={railSelect}
            expanded={isSidebarHovered}
            onExpandedChange={setIsSidebarHovered}
            adminItems={railForRole(user?.role)}
            adminGroups={RAIL_GROUPS}
            adminLogoSrc="/assets/logobrowser_trans.svg"
            // On mobile, hide the global rail — the settings local nav drawer
            // (opened by the header's leading button) provides navigation instead.
            hideOnMobile={true}
          />

          {/* ── Main ── */}
          <div className="flex-1 flex flex-col md:pl-[72px] h-screen overflow-hidden">
            {/* ── Global header ──
              The bar is now the shared AppHeader; only the page context and the
              controls below are Settings' own. Every control keeps the handler
              and popup it already had. */}
            <AppHeader
              isDark={isDark}
              context={`Settings${currentSection ? ` · ${currentSection.label}` : ""}`}
              role={user?.role}
            /* Settings section selector moved to content area for Admin
               (matching the Sales Manager pattern — no filter icon in header) */
            >
              <div className="flex items-center gap-4 flex-shrink-0 relative z-[50]">
                {/* Desktop-only controls: hidden on mobile */}
                <div className="hidden md:flex items-center gap-4">
                  <HeaderClock isDark={isDark} />
                  <div
                    className={`w-5 h-5 flex items-center justify-center cursor-pointer ${isDark ? "text-gray-400" : "text-[#6B7280]"} hover:text-[#9E217B] transition-colors`}
                    onClick={toggleTheme} role="button"
                    aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}>
                    {isDark ? <SunIcon /> : <MoonIcon />}
                  </div>
                </div>

                {/* Attendance: visible on all screen sizes */}
                <AttendanceBadge
                  timeIn={timeIn}
                  isMarkedPresent={isMarkedPresent}
                  onLogout={handleLogout} />

                {/* System Updates (megaphone) — all roles */}
                <CrmUpdatesNotification user={user} theme={chrome} isDark={isDark} />

                {/* Sales Manager gets Calendar + Bell; Admin gets plain Bell */}
                {isSalesManager ? (
                  <SalesSettingsBells isDark={isDark} />
                ) : (
                  <div className="relative cursor-pointer" onClick={() => router.push("/dashboard?tab=notification_center")}>
                    <FaBell className={`${chrome.textMuted} hover:text-[#9E217B] transition-colors w-5 h-5`} />
                  </div>
                )}

                {/* Profile — desktop only */}
                <div className="relative hidden md:block">
                  <div
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer shadow-sm hover:opacity-80 transition-opacity border
                      ${isDark ? "border-[#9E217B]/40 text-[#d946a8] bg-[#9E217B]/15" : "border-[#9E217B]/40 text-[#9E217B] bg-[#9E217B]/10"}`}
                  >
                    <UserAvatar name={user?.name} fallback={isSalesManager ? "S" : "A"} alt="" />
                  </div>
                  <AnimatePresence>
                    {isProfileOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className={`absolute top-12 right-0 w-[250px] rounded-[20px] p-4 z-[200] border shadow-2xl ${isDark ? "bg-[#1C1C1E]/95 border-white/10" : "bg-white/95 border-black/5"}`}
                        style={{ backdropFilter: "blur(24px) saturate(180%)" }}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[17px] font-semibold flex-shrink-0 ${isDark ? "bg-[#9E217B]/20 text-[#d946a8]" : "bg-purple-100 text-purple-900"}`}>
                            {(user?.name || "Account").charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col overflow-hidden">
                            <p className={`font-semibold text-[14px] tracking-tight truncate leading-tight ${isDark ? "text-white" : "text-black"}`}>
                              {user?.name || "Account"}
                            </p>
                            <p className={`text-[12px] truncate mt-[1px] ${isDark ? "text-white/60" : "text-black/60"}`}>
                              {user?.email || "No email"}
                            </p>
                            <p className={`text-[12px] truncate mt-[1px] ${isDark ? "text-white/60" : "text-black/60"}`}>
                              {orgLoading ? "Loading org name..." : orgName || "No org name"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mb-4">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${isDark ? "bg-[#9E217B]/10 text-[#d946a8] border-[#9E217B]/30" : "bg-purple-50 text-purple-800 border-purple-200"}`}>
                            {user?.role || "Member"}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                            <span className={`text-[12px] font-medium ${isDark ? "text-white/60" : "text-black/60"}`}>Active</span>
                          </div>
                        </div>
                        <hr className={`-mx-4 border-0 border-t ${isDark ? "border-white/10" : "border-black/5"}`} />
                        <div className="flex flex-col py-1.5">
                          <button
                            onClick={() => { setIsProfileOpen(false); router.push("/dashboard/settings/profile"); }}
                            className={`w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl transition-colors cursor-pointer group ${isDark ? "hover:bg-white/5" : "hover:bg-black/[0.04]"}`}
                          >
                            <div className={`flex items-center gap-2.5 ${isDark ? "text-white" : "text-black"}`}>
                              <FiUser className={`w-4 h-4 ${isDark ? "text-white/60" : "text-black/60"}`} />
                              <span className="text-[13px] font-medium">Account Settings</span>
                            </div>
                            <FiChevronRight className={`w-3.5 h-3.5 ${isDark ? "text-white/60" : "text-black/60"}`} />
                          </button>
                          <hr className={`border-0 border-t my-0.5 ${isDark ? "border-white/10" : "border-black/5"}`} />
                          <button
                            onClick={() => { setIsProfileOpen(false); }}
                            className={`w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl transition-colors cursor-pointer group ${isDark ? "hover:bg-white/5" : "hover:bg-black/[0.04]"}`}
                          >
                            <div className={`flex items-center gap-2.5 ${isDark ? "text-white" : "text-black"}`}>
                              <FiHelpCircle className={`w-4 h-4 ${isDark ? "text-white/60" : "text-black/60"}`} />
                              <span className="text-[13px] font-medium">Help & Support</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-small border ${isDark ? "bg-white/10 text-white/60 border-white/10" : "bg-gray-100 text-gray-600 border-gray-200"}`}>Coming Soon</span>
                          </button>
                        </div>
                        <hr className={`-mx-4 border-0 border-t mb-2.5 mt-1 ${isDark ? "border-white/10" : "border-black/5"}`} />
                        <button
                          onClick={handleLogout}
                          className={`w-full flex items-center gap-2.5 py-2.5 px-3 rounded-[12px] font-semibold text-[13px] transition-colors cursor-pointer ${isDark ? "text-red-400 bg-red-500/10 hover:bg-red-500/20" : "text-red-600 bg-red-50 hover:bg-red-100"}`}
                        >
                          <FiLogOut className="w-4 h-4" />
                          Log Out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Hamburger — mobile only */}
                <button
                  onClick={() => isSalesManager ? setMobileNavOpen(true) : setAdminMobileNavOpen(true)}
                  className={`md:hidden h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0 rounded-full sm:rounded-lg border border-transparent sm:border flex items-center justify-center transition-colors duration-150 cursor-pointer ${isDark ? "bg-white/10 text-[#EBEBF5] sm:bg-[#1C1C2A] sm:border-[#2A2A38] sm:text-yellow-300 hover:bg-white/20" : "bg-black/5 text-[#3C3C43] sm:bg-[#F1F5F9] sm:border-[#9CA3AF] sm:text-[#1A1A1A] hover:bg-black/10"} sm:hover:bg-[inherit]`}
                  aria-label="Open navigation menu"
                >
                  <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            </AppHeader>

            {/* ── Settings body ──
              The page shell owns the only vertical scroller; the columns inside
              scroll with it, so there is never a second scrollbar. */}
            <div className={`flex-1 overflow-y-auto ${chrome.scroll}`}>
              <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6">
                {/* Local nav — sections *within* Settings, not application nav. */}
                {!isSalesManager && (
                  <aside
                    className="hidden w-60 flex-shrink-0 self-start rounded-xl border lg:block"
                    style={{
                      background: T.surface,
                      borderColor: T.border,
                      boxShadow: isDark ? "none" : "0 1px 3px rgba(16,24,40,0.06)",
                      position: "sticky",
                      top: 0,
                    }}
                  >
                    {localNav}
                  </aside>
                )}

                {/* min-w-0 lets wide tables scroll inside their own container
                  instead of stretching the page. Keyed on pathname so a crash in
                  one section clears when the user navigates to another. */}
                <main className="min-w-0 flex-1 flex flex-col">
                  {/* Mobile section selector — both Admin and Sales Manager.
                      Admin: visible below lg (desktop has the aside column).
                      Sales Manager: visible below lg (desktop has horizontal tabs). */}
                  <div className={`mb-6 ${isSalesManager ? "" : "lg:hidden"}`}>
                    {/* Mobile Dropdown Trigger */}
                    <div className="lg:hidden">
                      <button
                        onClick={() => setDrawerOpen(true)}
                        className="flex items-center justify-between w-full p-3 rounded-xl border transition-colors"
                        style={{ borderColor: T.border, background: T.surface }}
                      >
                        <div className="flex items-center gap-2">
                          {currentSection && <currentSection.icon className="w-4 h-4" style={{ color: T.teal }} />}
                          <span className="font-semibold text-sm" style={{ color: T.text }}>
                            {currentSection?.label || "Settings"}
                          </span>
                        </div>
                        <FaSlidersH className="w-4 h-4" style={{ color: T.muted }} />
                      </button>
                    </div>

                    {/* Desktop Horizontal Tabs — Sales Manager only */}
                    {isSalesManager && (
                      <div className="hidden lg:block border-b pb-1" style={{ borderColor: T.border }}>
                        {horizontalLocalNav}
                      </div>
                    )}
                  </div>
                  <SectionErrorBoundary key={pathname}>{children}</SectionErrorBoundary>
                </main>
              </div>
            </div>
          </div>

          {/* ── Local-nav drawer (narrow screens) ── */}
          {drawerOpen && (
            <div
              className="fixed inset-0 z-[60] bg-black/50 lg:hidden"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setDrawerOpen(false);
              }}
            >
              <div
                className="ml-auto h-full w-72 overflow-y-auto custom-scrollbar shadow-xl"
                style={{ background: T.surface }}
                role="dialog"
                aria-label="Settings sections"
              >
                <div
                  className="flex items-center justify-between border-b px-4 py-3"
                  style={{ borderColor: T.border }}
                >
                  <span className="text-sm font-semibold" style={{ color: T.text }}>
                    Settings
                  </span>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close settings sections"
                    className="flex h-11 w-11 items-center justify-center rounded-lg"
                    style={{ color: T.muted }}
                  >
                    <FaTimes />
                  </button>
                </div>
                {localNav}
                {/* Mobile: Back to Dashboard link since the global rail is hidden */}
                <div className="md:hidden px-4 py-3 border-t" style={{ borderColor: T.border }}>
                  <Link
                    href={isSalesManager ? "/dashboard/sales" : "/dashboard"}
                    className="flex items-center gap-2 text-sm font-semibold rounded-lg px-3 py-2.5 transition-colors"
                    style={{ color: T.teal }}
                    onClick={() => setDrawerOpen(false)}
                  >
                    ← Back to Dashboard
                  </Link>
                </div>
              </div>
            </div>
          )}

          {isSalesManager && (
            <MobileNavDrawer
              open={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
              activeId="settings"
              onSelect={(item) => {
                if (item.id === "settings") { setMobileNavOpen(false); return; }
                railSelect({ id: item.id, label: item.label, link: "/dashboard/sales", tab: item.id });
              }}
              isDark={isDark}
              userName={user?.name}
              userRole={user?.role}
              onToggleTheme={toggleTheme}
              isMarkedPresent={isMarkedPresent}
              timeIn={timeIn}
              onLogout={handleLogout}
            />
          )}

          {/* Admin mobile drawer — slides from right, matches Sales Manager pattern */}
          {!isSalesManager && (
            <AdminMobileDrawer
              open={adminMobileNavOpen}
              onClose={() => setAdminMobileNavOpen(false)}
              activeId="settings"
              onSelect={(item: any) => {
                setAdminMobileNavOpen(false);
                if (item.id === "settings") return;
                railSelect({ id: item.id, label: item.label, link: item.link, tab: item.id });
              }}
              isDark={isDark}
              orgName={orgLoading ? null : orgName}
              userName={user?.name}
              userRole={user?.role}
              onToggleTheme={toggleTheme}
              isMarkedPresent={isMarkedPresent}
              timeIn={timeIn}
              onLogout={handleLogout}
              menuItems={railForRole(user?.role)}
              groups={RAIL_GROUPS}
            />
          )}
        </div>
      </ToastProvider>
    </div>
  );
}
