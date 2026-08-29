"use client";

// app/super-admin/page.tsx — the Super Admin panel shell.
//
// ── Why this route is not under /dashboard ──────────────────────────────────
// Super Admin is platform level: it operates on tenants rather than inside one.
// src/middleware.ts matches `/dashboard/:path*` and confines each tenant role to
// its own subtree, redirecting anything unrecognised back to login. Mounting the
// panel there would have meant editing that gate, which Phase 1 forbids
// ("do not change existing CRM functionality") — and it would have modelled the
// platform as one more tenant role, which is exactly what it is not.
//
// So the panel lives at /super-admin, outside the tenant tree.
//
// ── How it is protected (Phase 2) ───────────────────────────────────────────
// Three independent checks, because any one of them alone has a gap:
//
//   1. src/middleware.ts   — edge gate on /super-admin/:path*, from the signed
//                            cookie. Fast, no database, keeps tenants out.
//   2. app/super-admin/layout.tsx — server component that re-reads the live
//                            users row, so a stale cookie stops working.
//   3. every /api/platform route — requireSuperAdmin() as its first statement,
//                            because a page guard protects the page, not the data.
//
// Data is real and read across all tenants; see lib/superAdmin.ts for why that
// is correct here and why it cannot be reached by a tenant Admin.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IoGridOutline, IoGrid,
  IoBusinessOutline, IoBusiness,
  IoPeopleOutline, IoPeople,
  IoPulseOutline, IoPulse,
  IoMegaphoneOutline, IoMegaphone,
  IoSettingsOutline, IoSettings,
  IoMoonOutline, IoSunnyOutline,
} from "react-icons/io5";

import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { useRouter } from "next/navigation";
import { getStoredCrmUser, clearCrmSession } from "@/lib/authSession";
import AppHeader, { HeaderControl } from "@/components/AppHeader";
import HeaderClock from "@/components/HeaderClock";
import UserAvatar from "@/components/UserAvatar";

import { superAdminTheme, tint } from "@/components/superadmin/theme";
import { usePlatformData } from "@/components/superadmin/usePlatformData";
import DashboardView from "@/components/superadmin/DashboardView";
import OrganizationsView from "@/components/superadmin/OrganizationsView";
import OrganizationDetailView from "@/components/superadmin/OrganizationDetailView";
import SystemUpdatesView from "@/components/superadmin/SystemUpdatesView";
import UsersView from "@/components/superadmin/UsersView";
import ActivityView from "@/components/superadmin/ActivityView";
import SettingsView from "@/components/superadmin/SettingsView";
import AddOrganizationModal, { type CreatedOrg } from "@/components/superadmin/AddOrganizationModal";

type TabId = "dashboard" | "organizations" | "users" | "updates" | "activity" | "settings";

const NAV = [
  { id: "dashboard", icon: IoGridOutline, activeIcon: IoGrid, title: "Dashboard", short: "Home" },
  { id: "organizations", icon: IoBusinessOutline, activeIcon: IoBusiness, title: "Organizations", short: "Orgs" },
  { id: "users", icon: IoPeopleOutline, activeIcon: IoPeople, title: "Users", short: "Users" },
  // System Updates sits with the other platform-wide tools rather than under
  // Settings: it is a thing you DO across the estate, not a preference.
  { id: "updates", icon: IoMegaphoneOutline, activeIcon: IoMegaphone, title: "System Updates", short: "Updates" },
  { id: "activity", icon: IoPulseOutline, activeIcon: IoPulse, title: "Activity", short: "Activity" },
] as const;

const SETTINGS_ITEM = {
  id: "settings", icon: IoSettingsOutline, activeIcon: IoSettings, title: "Settings", short: "Settings",
} as const;

const SUBTITLES: Record<TabId, string> = {
  dashboard: "Platform health across every organization",
  organizations: "Every tenant on the platform",
  users: "Every user, across every organization",
  updates: "Publish announcements and product updates across the CRM.",
  activity: "Platform-wide audit and activity",
  settings: "Platform configuration",
};

export default function SuperAdminPanel() {
  const router = useRouter();
  const { isDark, toggleTheme } = useCrmTheme();
  const t = superAdminTheme(isDark);

  const [tab, setTab] = useState<TabId>("dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /** Transient success banner after a tenant is created. */
  const [created, setCreated] = useState<CreatedOrg | null>(null);
  const topbarRef = useRef<HTMLDivElement>(null);

  // Phase 2: real data, behind the platform gate. The panel is reached only
  // after middleware and app/super-admin/layout.tsx have both verified the
  // session, and every endpoint below re-verifies independently.
  const { loading, error, metrics, data, reload } = usePlatformData();

  // The signed-in operator, from the session the tenant app already stores.
  const [operator, setOperator] = useState<{ name: string; email: string }>({
    name: "Super Admin", email: "",
  });
  useEffect(() => {
    const stored = getStoredCrmUser();
    if (stored) setOperator({ name: stored.name || "Super Admin", email: stored.email || "" });
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (topbarRef.current && !topbarRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /**
   * Sign out through the CRM's own mechanism — no separate auth path.
   *
   * clearCrmSession() drops the stored user, theme and avatar and POSTs
   * /api/auth/logout, which clears the httpOnly cookie server-side. Once that
   * cookie is gone, middleware and app/super-admin/layout.tsx both refuse
   * /super-admin on the very next request, so a back-button return cannot
   * reopen the panel.
   */
  const handleLogout = () => {
    clearCrmSession();
    router.replace("/");
  };

  const openOrg = data.orgs.find(o => o.id === openOrgId) ?? null;
  const activeTitle = tab === "settings" ? "Settings" : NAV.find(n => n.id === tab)?.title ?? "Dashboard";

  /**
   * Opening an organization from the Dashboard has to switch tabs too — the
   * detail renders inside the Organizations tab, so setting the id alone would
   * leave the operator on a dashboard that appeared not to respond.
   */
  const openOrganization = (id: string) => {
    setOpenOrgId(id);
    setTab("organizations");
  };

  /**
   * Nav clicks. Choosing "Organizations" from the rail while a tenant's detail
   * is open means "take me back to the list" — without this it would look like
   * the nav had stopped working.
   */
  const selectTab = (id: TabId) => {
    if (id === "organizations") setOpenOrgId(null);
    setTab(id);
  };

  const navButton = (
    item: typeof NAV[number] | typeof SETTINGS_ITEM,
    expanded: boolean
  ) => {
    const active = tab === item.id;
    const Icon = active ? item.activeIcon : item.icon;
    return (
      <button
        key={item.id}
        onClick={() => selectTab(item.id as TabId)}
        title={!expanded ? item.title : undefined}
        aria-current={active ? "page" : undefined}
        className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors duration-200"
        style={{
          background: active ? t.raised : "transparent",
          border: `1px solid ${active ? t.border : "transparent"}`,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = t.hover; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span
          className="flex-shrink-0 flex items-center justify-center w-6 h-6"
          style={{ color: active ? t.accent : t.textMuted }}
        >
          <Icon size={18} />
        </span>
        <span
          className="text-[12px] font-medium whitespace-nowrap transition-opacity duration-300"
          style={{ color: active ? t.text : t.textMuted, opacity: expanded ? 1 : 0 }}
        >
          {item.title}
        </span>
      </button>
    );
  };

  return (
    <div
      className="flex flex-col md:flex-row h-[100dvh] font-sans overflow-hidden transition-colors duration-300"
      style={{ background: t.app, color: t.text }}
    >
      {/* ════ SIDEBAR — desktop and tablet ════
          Collapsed to icons by default and expanding on hover, matching the
          tenant panels, so the tablet width gets the compact rail for free. */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className="hidden md:flex flex-col py-6 px-3 z-50 fixed left-0 top-0 h-full transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{
          width: sidebarExpanded ? 248 : 76,
          background: t.surface,
          borderRight: `1px solid ${t.border}`,
        }}
      >
        <div className="flex items-center px-2 mb-8 overflow-hidden h-10">
          <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
            <img src="/assets/logobrowser_trans.png" alt="" className="w-9 h-9 rounded-xl object-cover" />
          </div>
          <div
            className="ml-3 flex flex-col whitespace-nowrap transition-opacity duration-300"
            style={{ opacity: sidebarExpanded ? 1 : 0 }}
          >
            <span className="font-semibold text-[13px] tracking-tight leading-tight">Bhoomi CRM</span>
            <span className="text-[10px]" style={{ color: t.accent }}>Super Admin</span>
          </div>
        </div>

        <nav className="flex flex-col gap-1.5 w-full flex-1">
          {NAV.map(item => navButton(item, sidebarExpanded))}
        </nav>

        {/* Settings pinned to the bottom, as specified. */}
        <div className="mt-auto pt-2" style={{ borderTop: `1px solid ${t.border}` }}>
          {navButton(SETTINGS_ITEM, sidebarExpanded)}
        </div>
      </aside>

      {/* ════ BOTTOM NAV — mobile ════ */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-[100] flex items-start pt-2 justify-around"
        style={{
          background: t.surface,
          borderTop: `1px solid ${t.border}`,
          paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
          backdropFilter: "blur(20px)",
        }}
      >
        {[...NAV, SETTINGS_ITEM].map(item => {
          const active = tab === item.id;
          const Icon = active ? item.activeIcon : item.icon;
          return (
            <button
              key={item.id}
              onClick={() => selectTab(item.id as TabId)}
              className="flex-1 flex flex-col items-center justify-center gap-1"
              aria-current={active ? "page" : undefined}
            >
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: active ? t.raised : "transparent", color: active ? t.accent : t.textMuted }}
              >
                <Icon size={18} />
              </span>
              <span className="text-[9px] font-medium" style={{ color: active ? t.accent : t.textMuted }}>
                {item.short}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ════ MAIN ════ */}
      <div className="flex-1 flex flex-col overflow-hidden relative md:ml-[76px]">
        <AppHeader
          isDark={isDark}
          context={activeTitle}
          surfaceClassName=""
          surfaceStyle={{ background: t.surface, borderBottom: `1px solid ${t.border}` }}
        >
          <div className="flex items-center gap-1.5 md:gap-2 relative" ref={topbarRef}>
            {/* The role badge is rendered here rather than through AppHeader's
                `role` prop so it can carry the platform accent — this is the one
                screen where the badge must not read as a tenant role. */}
            <span
              className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-tight whitespace-nowrap"
              style={{ color: t.accent, background: tint(t.accent, 0.12) }}
            >
              Super Admin
            </span>

            <HeaderClock isDark={isDark} />

            <HeaderControl
              isDark={isDark}
              onClick={toggleTheme}
              label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <IoSunnyOutline size={16} /> : <IoMoonOutline size={16} />}
            </HeaderControl>

            <HeaderControl
              isDark={isDark}
              onClick={() => setProfileOpen(v => !v)}
              label="Profile"
              className="overflow-hidden p-0"
            >
              <UserAvatar name={operator.name} fallback="S" alt="" />
            </HeaderControl>

            <AnimatePresence>
              {profileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="absolute top-12 right-0 w-60 rounded-[1.25rem] p-4 z-50"
                  style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}
                >
                  <p className="font-semibold text-[13px] tracking-tight leading-tight">{operator.name}</p>
                  <p className="text-[10px] truncate mt-0.5" style={{ color: t.textMuted }}>{operator.email}</p>
                  <hr className="my-3 border-0 border-t" style={{ borderColor: t.border }} />
                  <p className="text-[11px] leading-relaxed" style={{ color: t.textMuted }}>
                    Platform-level access. Not a tenant Admin — this account is not scoped
                    to any organization.
                  </p>

                  <button
                    onClick={() => { setProfileOpen(false); setTab("settings"); }}
                    className="w-full mt-3 py-2 rounded-xl font-medium text-[12px] transition-colors"
                    style={{ color: t.text, background: t.raised }}
                  >
                    Account Security
                  </button>

                  {/* Destructive, so it is the only red control in the menu. */}
                  <button
                    onClick={handleLogout}
                    className="w-full mt-2 py-2 rounded-xl font-medium text-[12px] transition-colors"
                    style={{ color: t.danger, background: tint(t.danger, 0.1) }}
                  >
                    Log Out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </AppHeader>

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pt-6 pb-24 md:pb-10">
          <div className="max-w-[1400px] mx-auto">
            <header className="mb-6">
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight" style={{ color: t.text }}>
                {activeTitle}
              </h1>
              <p className="text-[13px] mt-1" style={{ color: t.textMuted }}>{SUBTITLES[tab]}</p>
            </header>

            {/* Success confirmation. Dismissed by hand rather than on a timer —
                it names the admin account that was just created, which is the
                one thing the operator needs to write down or pass on. */}
            <AnimatePresence>
              {created && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mb-5 rounded-2xl px-4 py-3.5 flex items-start gap-3"
                  style={{ background: tint(t.positive, 0.1), border: `1px solid ${tint(t.positive, 0.28)}` }}
                >
                  <span className="mt-[3px] flex-shrink-0" style={{ color: t.positive }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold" style={{ color: t.text }}>
                      {created.name} created
                    </p>
                    <p className="text-[12px] mt-0.5 break-words" style={{ color: t.textMuted }}>
                      Admin <strong style={{ color: t.text }}>{created.adminEmail}</strong> can now sign in.
                      Organization ID <span className="font-mono text-[11px]">{created.id}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setCreated(null)}
                    aria-label="Dismiss"
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ color: t.textMuted }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {error ? (
              /* Surfaced rather than rendered as empty tables — an empty
                 platform and a refused request must not look identical. */
              <div
                className="rounded-2xl px-5 py-6 text-center"
                style={{ background: t.surface, border: `1px solid ${t.border}` }}
              >
                <p className="text-[13px] font-medium" style={{ color: t.danger }}>{error}</p>
                <button
                  onClick={reload}
                  className="mt-4 px-4 py-2 rounded-full text-[13px] font-medium"
                  style={{ background: t.accent, color: "#fff" }}
                >
                  Try again
                </button>
              </div>
            ) : loading ? (
              <div className="space-y-4 animate-pulse">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="h-[104px] rounded-2xl" style={{ background: t.surface }} />
                  ))}
                </div>
                <div className="h-64 rounded-2xl" style={{ background: t.surface }} />
              </div>
            ) : (
              <>
                {tab === "dashboard" && (
                  <DashboardView t={t} data={data} metrics={metrics} onOpenOrg={openOrganization} />
                )}
                {tab === "organizations" && (
                  openOrgId ? (
                    /* The detail replaces the list rather than floating over it: it
                       carries a nine-column user table and a per-row actions menu,
                       which a 440px drawer could not hold without the controls
                       overflowing. Back returns to the list. */
                    <OrganizationDetailView
                      t={t}
                      organizationId={openOrgId}
                      fallbackName={openOrg?.name ?? "Organization"}
                      onBack={() => setOpenOrgId(null)}
                      onOrgChanged={reload}
                    />
                  ) : (
                    <OrganizationsView
                      t={t}
                      orgs={data.orgs}
                      onOpenOrg={setOpenOrgId}
                      onAddOrganization={() => setAddOpen(true)}
                    />
                  )
                )}
                {tab === "users" && <UsersView t={t} users={data.users} />}
                {tab === "updates" && <SystemUpdatesView t={t} />}
                {tab === "activity" && <ActivityView t={t} activity={data.activity} />}
                {tab === "settings" && <SettingsView t={t} onSignedOut={handleLogout} />}
              </>
            )}
          </div>
        </main>
      </div>


      <AddOrganizationModal
        open={addOpen}
        t={t}
        onClose={() => setAddOpen(false)}
        onCreated={org => {
          setCreated(org);
          // Refetch rather than splicing the new row in: the list carries
          // server-computed counts, and a locally-built row would be a guess.
          reload();
          setTab("organizations");
        }}
      />
    </div>
  );
}
