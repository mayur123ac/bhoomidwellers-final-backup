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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import type { IconType } from "react-icons";
import {
  FaBell,
  FaBoxOpen,
  FaCalendarAlt,
  FaChartPie,
  FaClipboardList,
  FaCog,
  FaCreditCard,
  FaEnvelope,
  FaEye,
  FaEyeSlash,
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
  FaWhatsapp,
} from "react-icons/fa";
import { FaWandMagicSparkles } from "react-icons/fa6";

import { type AdminNavItem } from "@/components/admin/AdminSidebar";
import RoleSidebar, { type RailTarget } from "@/components/RoleSidebar";
import AttendanceBadge from "@/components/AttendanceBadge";
import CrmUpdatesNotification from "@/components/CrmUpdatesNotification";
import UserAvatar from "@/components/UserAvatar";
import AppHeader, { HeaderControl } from "@/components/AppHeader";
import { clearCrmSession, getStoredCrmUser } from "@/lib/authSession";
import { SectionErrorBoundary, SETTINGS_THEME_CSS, T, ToastProvider } from "./ui";

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
  { id: "ai", icon: FaWandMagicSparkles, label: "Bhoomi AI", link: "/dashboard/employees?tab=ai", pinned: true },
  { id: "settings", icon: FaCog, label: "Settings", link: "/dashboard/settings", pinned: true },
];

/**
 * The ADMIN rail's item list, cut to what each role that gets the admin rail can
 * actually open.
 *
 * A Sales Manager no longer reaches this function at all — they get their own
 * rail via RoleSidebar, which is the point of this change. It still applies to
 * Site Head, Receptionist, Sourcing Manager and Caller, whose own dashboards
 * render their navigation inline exactly as the Sales dashboard used to. Until
 * those are extracted the same way, the cut-down admin rail remains their
 * existing Settings navigation and is deliberately left as-is.
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
    // list, and everything hosted there goes with them.
    const blocked = new Set(["callers", "employees", "notifications", "ai"]);
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
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export default function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
            className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider"
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
                    className={`flex min-h-[42px] items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
                      active ? "" : "st-hover-surface"
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
        className={`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 ${
          isDark ? "text-gray-200" : "text-[#1A1A1A]"
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
          // Settings has no bottom nav bar, so the rail stays on at every width
          // — the body already reserves 72px for it unconditionally.
          hideOnMobile={false}
        />

        {/* ── Main ── */}
        <div className="flex-1 flex flex-col pl-[72px] h-screen overflow-hidden">
          {/* ── Global header ──
              The bar is now the shared AppHeader; only the page context and the
              controls below are Settings' own. Every control keeps the handler
              and popup it already had. */}
          <AppHeader
            isDark={isDark}
            context={`Settings${currentSection ? ` · ${currentSection.label}` : ""}`}
            role={user?.role}
            leading={
              // Opens the Settings local nav on narrow screens, where the
              // sections column is hidden.
              <HeaderControl
                isDark={isDark}
                onClick={() => setDrawerOpen(true)}
                label="Open settings sections"
                className="lg:hidden"
              >
                <FaSlidersH className="w-3.5 h-3.5" />
              </HeaderControl>
            }
          >
            <>
              <AttendanceBadge />

              <HeaderControl
                isDark={isDark}
                onClick={toggleTheme}
                label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <SunIcon /> : <MoonIcon />}
              </HeaderControl>

              {/* The bell used to be a bare glyph between two bordered buttons.
                  Wrapping it gives it the same chrome without touching what it
                  does — the component still owns its own popup and unread
                  count, and renders its badge over this frame. */}
              <div className="relative flex items-center">
                <CrmUpdatesNotification user={user} theme={chrome} isDark={isDark} />
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  aria-label="Account menu"
                  className={`h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden font-semibold text-[13px] cursor-pointer transition-colors duration-150 border ${
                    isDark
                      ? "border-white/10 text-[#e879c4] bg-[#9E217B]/20 hover:bg-[#9E217B]/30"
                      : "border-[#E5E7EB] text-[#9E217B] bg-[#9E217B]/10 hover:bg-[#9E217B]/15"
                  }`}
                >
                  <UserAvatar name={user?.name} fallback="A" alt="" />
                </button>
                {isProfileOpen && (
                  <div
                    className={`absolute top-12 right-0 w-64 border rounded-xl shadow-2xl p-5 z-50 animate-fadeIn ${chrome.dropdown}`}
                  >
                    <div className="mb-4">
                      <h3 className={`font-bold text-lg ${chrome.text}`}>{user?.name || "Account"}</h3>
                      <p className={`text-sm truncate ${chrome.textMuted}`}>
                        {user?.email || ""}
                      </p>
                    </div>
                    <hr className={`mb-4 ${chrome.tableBorder}`} />
                    <div className="space-y-4 mb-6 text-sm">
                      <p className={`flex justify-between items-center ${chrome.textMuted}`}>
                        Role:
                        <span
                          className={`font-bold capitalize px-2 py-0.5 rounded border ${
                            isDark
                              ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/30"
                              : "text-[#9E217B] bg-[#9E217B]/10 border-[#9E217B]/30"
                          }`}
                        >
                          {user?.role || "Member"}
                        </span>
                      </p>
                      <div>
                        <p className={`text-xs mb-1 ${chrome.textMuted}`}>Password</p>
                        <div
                          className={`flex items-center justify-between border p-2 rounded-md ${
                            isDark ? "bg-[#121212] border-[#2a2a2a]" : "bg-white border-indigo-200"
                          }`}
                        >
                          <span className={`font-mono tracking-widest text-xs ${chrome.text}`}>
                            {showPassword ? user?.password || "N/A" : "••••••••"}
                          </span>
                          <button
                            onClick={() => setShowPassword(!showPassword)}
                            className={`${chrome.textMuted} cursor-pointer`}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <FaEyeSlash /> : <FaEye />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className={`w-full py-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                        isDark
                          ? "bg-[#3B1F1F] text-[#F28B82] hover:bg-red-900/40 border border-red-900/30"
                          : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B] hover:text-white border border-[#9E217B]/30"
                      }`}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </>
          </AppHeader>

          {/* ── Settings body ──
              The page shell owns the only vertical scroller; the columns inside
              scroll with it, so there is never a second scrollbar. */}
          <div className={`flex-1 overflow-y-auto ${chrome.scroll}`}>
            <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6">
              {/* Local nav — sections *within* Settings, not application nav. */}
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

              {/* min-w-0 lets wide tables scroll inside their own container
                  instead of stretching the page. Keyed on pathname so a crash in
                  one section clears when the user navigates to another. */}
              <main className="min-w-0 flex-1">
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
            </div>
          </div>
        )}
      </div>
      </ToastProvider>
    </div>
  );
}
