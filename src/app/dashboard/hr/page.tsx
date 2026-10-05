"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  clearCrmSession,
  getStoredCrmUser,
  installLoggedOutBackGuard,
} from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { useOrgName } from "@/lib/hooks/useOrgName";
import {
  IoGridOutline, IoGrid,
  IoSettingsOutline, IoSettings,
  IoSunnyOutline, IoMoonOutline,
  IoPeopleOutline, IoPeople,
  IoStatsChartOutline, IoStatsChart,
  IoRefreshOutline,
} from "react-icons/io5";
import { FaCircle } from "react-icons/fa";
import AppHeader, { HeaderControl } from "@/components/AppHeader";
import HeaderClock from "@/components/HeaderClock";
import UserAvatar from "@/components/UserAvatar";
import LogoutConfirmDialog from "@/components/LogoutConfirmDialog";

// Recharts dynamic imports (matches admin dashboard pattern for perf)
const HRCharts = dynamic(() => import("./HRCharts"), { ssr: false });

// ─── Types ─────────────────────────────────────────────────────────────────
interface DashboardData {
  trendDays: number;
  attendanceTrend: { date: string; present: number; absent: number }[];
  todayWorkforce: { present: number; absent: number; on_leave: number };
  workforceByRole: { role: string; count: number }[];
  liveWorkforce: { active: number; idle: number; offline: number; logged_out: number };
  workingHoursByRole: { role: string; avgHours: number }[];
  attendanceByRole: { role: string; present: number; absent: number }[];
  liveTable: {
    userId: number;
    name: string;
    role: string;
    loginTime: string | null;
    status: "Active" | "Idle" | "Offline";
    currentModule: string;
    activeLead: string;
    currentAction: string;
    workingHours: number | null;
    attendanceStatus: string;
  }[];
}

// Navigation
const NAV_ITEMS = [
  { id: "overview",  icon: IoGridOutline,      activeIcon: IoGrid,      title: "Overview"  },
  { id: "analytics", icon: IoStatsChartOutline, activeIcon: IoStatsChart, title: "Analytics" },
  { id: "workforce", icon: IoPeopleOutline,     activeIcon: IoPeople,    title: "Live Workforce" },
];

// ─── Status badge ──────────────────────────────────────────────────────────
function StatusBadge({ status, isDark }: { status: string; isDark: boolean }) {
  const colors: Record<string, string> = {
    Active:  isDark ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-emerald-100 text-emerald-700 border-emerald-200",
    Idle:    isDark ? "bg-amber-500/15 text-amber-400 border-amber-500/30"       : "bg-amber-100 text-amber-700 border-amber-200",
    Offline: isDark ? "bg-gray-500/15 text-gray-400 border-gray-500/30"          : "bg-gray-100 text-gray-500 border-gray-200",
  };
  const dots: Record<string, string> = {
    Active: "bg-emerald-400", Idle: "bg-amber-400", Offline: "bg-gray-400",
  };
  const s = status in colors ? status : "Offline";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors[s]}`}>
      <FaCircle className={`text-[6px] ${dots[s]}`} />
      {s}
    </span>
  );
}

// ─── Section header ────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle, isDark }: { title: string; subtitle?: string; isDark: boolean }) {
  return (
    <div className="mb-6">
      <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
        HR Dashboard
      </p>
      <h2 className={`text-xl font-black ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>{title}</h2>
      {subtitle && (
        <p className={`text-sm mt-0.5 ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>{subtitle}</p>
      )}
    </div>
  );
}

// ─── KPI card ──────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent, isDark }: {
  label: string; value: string | number; sub?: string; accent: string; isDark: boolean;
}) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  return (
    <div className={`rounded-2xl p-4 flex flex-col gap-1 ${card}`}>
      <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>{label}</span>
      <span className={`text-2xl font-black ${accent}`}>{value}</span>
      {sub && <span className={`text-xs ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>{sub}</span>}
    </div>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────────
function ChartSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className={`rounded-3xl animate-pulse h-64 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────
function EmptyState({ label, isDark }: { label: string; isDark: boolean }) {
  return (
    <div className={`rounded-3xl p-10 flex flex-col items-center text-center gap-3 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
      <IoStatsChartOutline size={32} className={isDark ? "text-[#48484A]" : "text-[#C7C7CC]"} />
      <p className={`text-sm ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>{label}</p>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function HRDashboard() {
  const router = useRouter();
  const { isDark, toggleTheme } = useCrmTheme();
  const { name: orgName, loading: orgLoading } = useOrgName();
  const sidebarOrgName = orgLoading ? null : orgName;

  const [user, setUser] = useState<any>({ name: "Loading...", role: "HR", email: "" });
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [activePopup, setActivePopup] = useState<"profile" | null>(null);
  const topbarRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const [refreshing, setRefreshing] = useState(false);

  // Session guard
  useEffect(() => {
    const cleanup = installLoggedOutBackGuard(() => router.replace("/"));
    const stored = getStoredCrmUser();
    if (!stored) { router.replace("/"); return cleanup; }
    try {
      const role = (stored.role ?? "").toLowerCase().trim().replace(/_/g, " ");
      if (role !== "hr" && role !== "admin") { router.replace("/dashboard"); return cleanup; }
      setUser({ ...stored, name: stored.name || "User" });
    } catch { router.replace("/"); }
    return cleanup;
  }, [router]);

  // Close profile popup on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (topbarRef.current && !topbarRef.current.contains(e.target as Node)) setActivePopup(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Fetch dashboard data
  const fetchData = useCallback(async (days: number, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/dashboard?days=${days}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setData(j.data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load dashboard data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(trendDays); }, [trendDays, fetchData]);

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  // Theme tokens
  const bgApp     = isDark ? "bg-[#000000]"                               : "bg-[#F5F5F7]";
  const bgSidebar = isDark ? "bg-[#1C1C1E]/90 border-r border-[#38383A]"  : "bg-[#F5F5F7]/90 border-r border-[#E5E5EA]";
  const textPrimary   = isDark ? "text-white"     : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textAccent    = isDark ? "text-emerald-400" : "text-emerald-600";

  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeTab);

  // Derived KPIs
  const totalEmployees = data?.workforceByRole.reduce((s, r) => s + r.count, 0) ?? 0;
  const totalPresent   = data?.todayWorkforce.present ?? 0;
  const totalAbsent    = data?.todayWorkforce.absent  ?? 0;
  const activeNow      = data?.liveWorkforce.active   ?? 0;

  return (
    <div className={`flex flex-col md:flex-row h-[100dvh] font-sans overflow-hidden transition-colors duration-300 ${bgApp} ${textPrimary}`}>

      {/* SIDEBAR — DESKTOP */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className={`hidden md:flex flex-col py-6 px-3 z-50 fixed left-0 top-0 h-full backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${bgSidebar}`}
        style={{ width: sidebarExpanded ? "260px" : "76px" }}
      >
        <div className="flex items-center px-2 mb-8 overflow-hidden h-10">
          <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
            <img src="/assets/logobrowser_trans.png" alt="Logo" className="w-9 h-9 min-w-[36px] rounded-xl object-cover" />
          </div>
          <div className={`ml-3 flex flex-col whitespace-nowrap transition-opacity duration-300 ${sidebarExpanded ? "opacity-100" : "opacity-0"}`}>
            <span className="font-semibold text-[13px] tracking-tight leading-tight">Bhoomi CRM</span>
            <span className={`text-[10px] ${textSecondary}`}>HR Panel</span>
            {sidebarOrgName && (
              <span className="text-[9.5px] font-semibold mt-0.5"
                style={{ color: "rgba(255,255,255,0.45)", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={sidebarOrgName}>{sidebarOrgName}</span>
            )}
          </div>
        </div>
        <nav className="flex flex-col gap-1.5 w-full flex-1">
          {NAV_ITEMS.map(({ id, icon: Icon, activeIcon: ActiveIcon, title }) => {
            const isActive = activeTab === id;
            return (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors duration-200 border border-transparent cursor-pointer ${
                  isActive ? isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-white border-[#E5E5EA] shadow-sm" : "hover:bg-[#2C2C2E]/50"
                }`} title={!sidebarExpanded ? title : undefined}>
                <div className={`flex-shrink-0 flex items-center justify-center w-6 h-6 ${isActive ? textAccent : textSecondary}`}>
                  {isActive ? <ActiveIcon size={18} /> : <Icon size={18} />}
                </div>
                <span className={`text-xs font-medium whitespace-nowrap transition-all duration-300 ${isActive ? textPrimary : textSecondary} ${sidebarExpanded ? "opacity-100" : "opacity-0"}`}>{title}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto">
          <button onClick={() => router.push("/dashboard/settings/profile")}
            className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors border border-transparent cursor-pointer hover:bg-[#2C2C2E]/50`}
            title={!sidebarExpanded ? "Settings" : undefined}>
            <div className={`flex-shrink-0 flex items-center justify-center w-6 h-6 ${textSecondary}`}><IoSettingsOutline size={18} /></div>
            <span className={`text-xs font-medium whitespace-nowrap transition-all duration-300 ${textSecondary} ${sidebarExpanded ? "opacity-100" : "opacity-0"}`}>Settings</span>
          </button>
        </div>
      </aside>

      {/* MOBILE BOTTOM NAV */}
      <div className={`md:hidden fixed bottom-0 left-0 right-0 z-[100] backdrop-blur-xl border-t flex items-start pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] justify-around ${bgSidebar}`}>
        {[...NAV_ITEMS, { id: "settings", icon: IoSettingsOutline, activeIcon: IoSettings, title: "Settings" }].map(({ id, icon: Icon, activeIcon: ActiveIcon, title }) => {
          const isActive = activeTab === id;
          return (
            <button key={id} onClick={() => id === "settings" ? router.push("/dashboard/settings/profile") : setActiveTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive ? isDark ? "bg-[#2C2C2E]" : "bg-[#E5E5EA]" : "bg-transparent"}`}>
                {isActive ? <ActiveIcon size={18} className={textAccent} /> : <Icon size={18} className={textSecondary} />}
              </div>
              <span className={`text-[9px] font-medium ${isActive ? textAccent : textSecondary}`}>{title.replace(" Workforce", "")}</span>
            </button>
          );
        })}
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col overflow-hidden relative md:ml-[76px]">
        <AppHeader isDark={isDark} context={activeNavItem?.title ?? "HR Panel"} role={user?.role || "HR"}>
          <div className="flex items-center gap-1.5 md:gap-2 relative" ref={topbarRef}>
            <HeaderClock isDark={isDark} />
            <HeaderControl isDark={isDark} onClick={toggleTheme} label={isDark ? "Light mode" : "Dark mode"}>
              {isDark ? <IoSunnyOutline size={16} /> : <IoMoonOutline size={16} />}
            </HeaderControl>
            <HeaderControl isDark={isDark} onClick={() => { fetchData(trendDays, true); }} label="Refresh">
              <IoRefreshOutline size={16} className={refreshing ? "animate-spin" : ""} />
            </HeaderControl>
            <HeaderControl isDark={isDark} onClick={() => setActivePopup(activePopup === "profile" ? null : "profile")} label="Profile" className="overflow-hidden p-0">
              <UserAvatar name={user?.name} fallback="H" alt="" />
            </HeaderControl>

            {activePopup === "profile" && (
              <div className={`absolute right-0 top-[calc(100%+8px)] w-64 rounded-2xl shadow-2xl z-[200] border overflow-hidden ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]"}`}>
                <div className={`p-4 border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={user?.name} fallback="H" alt="" />
                    <div className="min-w-0">
                      <p className={`text-sm font-bold truncate ${textPrimary}`}>{user?.name}</p>
                      <p className={`text-xs truncate ${textSecondary}`}>{user?.email}</p>
                    </div>
                  </div>
                  <div className={`mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-100 text-emerald-700"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-emerald-500" : "bg-emerald-600"}`} />
                    Human Resources
                  </div>
                </div>
                <div className="p-2">
                  <button onClick={() => { setActivePopup(null); router.push("/dashboard/settings/profile"); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer ${isDark ? "hover:bg-[#2C2C2E] text-white" : "hover:bg-[#F5F5F7] text-[#1D1D1F]"}`}>
                    <IoSettingsOutline size={15} className={textSecondary} /> Settings
                  </button>
                  <button onClick={() => { setActivePopup(null); setShowLogoutConfirm(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer text-red-500 hover:bg-red-500/10">
                    <IoSettingsOutline size={15} /> Log Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </AppHeader>

        <main className="flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+80px)] md:pb-8">
          <div className="p-5 md:p-8 max-w-6xl mx-auto space-y-10">

            {/* Error banner */}
            {error && (
              <div className="rounded-2xl p-4 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium flex items-center justify-between">
                <span>⚠ {error}</span>
                <button onClick={() => fetchData(trendDays)} className="underline cursor-pointer text-xs">Retry</button>
              </div>
            )}

            {/* ── WORKFORCE OVERVIEW ──────────────────────────────── */}
            {(activeTab === "overview" || activeTab === "analytics") && (
              <>
                {activeTab === "overview" && (
                  <>
                    <SectionHeader title="Workforce Overview" subtitle="Charts first — real data from existing CRM attendance system" isDark={isDark} />

                    {/* KPI strip */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <KpiCard label="Total Workforce" value={loading ? "…" : totalEmployees} sub="Active employees" accent={textAccent} isDark={isDark} />
                      <KpiCard label="Present Today" value={loading ? "…" : totalPresent} sub="Marked attendance" accent="text-emerald-500" isDark={isDark} />
                      <KpiCard label="Absent Today" value={loading ? "…" : totalAbsent} sub="Not marked" accent="text-red-400" isDark={isDark} />
                      <KpiCard label="Active Now" value={loading ? "…" : activeNow} sub="Live sessions" accent="text-blue-400" isDark={isDark} />
                    </div>

                    {/* Trend toggle */}
                    <div className="flex items-center gap-2">
                      {([7, 30] as const).map((d) => (
                        <button key={d} onClick={() => setTrendDays(d)}
                          className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
                            trendDays === d
                              ? isDark ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "bg-emerald-100 border-emerald-300 text-emerald-700"
                              : isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#E5E5EA] text-[#86868B] hover:border-[#D1D1D6]"
                          }`}>
                          Last {d} days
                        </button>
                      ))}
                    </div>

                    {/* Charts */}
                    {loading ? (
                      <div className="grid md:grid-cols-2 gap-6">
                        <ChartSkeleton isDark={isDark} />
                        <ChartSkeleton isDark={isDark} />
                        <ChartSkeleton isDark={isDark} />
                        <ChartSkeleton isDark={isDark} />
                      </div>
                    ) : !data ? null : (
                      <HRCharts
                        section="overview"
                        data={data}
                        trendDays={trendDays}
                        isDark={isDark}
                      />
                    )}
                  </>
                )}

                {/* ── ATTENDANCE ANALYTICS ───────────────────────── */}
                {activeTab === "analytics" && (
                  <>
                    <SectionHeader title="Attendance Analytics" subtitle="Working hours and attendance breakdown by role" isDark={isDark} />
                    {loading ? (
                      <div className="grid md:grid-cols-2 gap-6">
                        <ChartSkeleton isDark={isDark} />
                        <ChartSkeleton isDark={isDark} />
                      </div>
                    ) : !data ? null : (
                      <HRCharts
                        section="analytics"
                        data={data}
                        trendDays={trendDays}
                        isDark={isDark}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {/* ── LIVE WORKFORCE TABLE ───────────────────────────── */}
            {activeTab === "workforce" && (
              <>
                <SectionHeader title="Live Workforce" subtitle="Real-time employee session and activity data" isDark={isDark} />

                {/* Live donut KPIs */}
                {!loading && data && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KpiCard label="Active" value={data.liveWorkforce.active} sub="In session" accent="text-emerald-400" isDark={isDark} />
                    <KpiCard label="Idle" value={data.liveWorkforce.idle} sub="No activity >5m" accent="text-amber-400" isDark={isDark} />
                    <KpiCard label="Offline" value={data.liveWorkforce.offline} sub="No session today" accent={isDark ? "text-gray-400" : "text-gray-500"} isDark={isDark} />
                    <KpiCard label="Logged Out" value={data.liveWorkforce.logged_out} sub="Ended session" accent="text-blue-400" isDark={isDark} />
                  </div>
                )}

                {loading ? <ChartSkeleton isDark={isDark} /> : !data ? null : data.liveTable.length === 0 ? (
                  <EmptyState label="No employee session data for today yet." isDark={isDark} />
                ) : (
                  <div className={`rounded-3xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                            {["Employee", "Role", "Login Time", "Status", "Current Module", "Active Lead", "Current Action", "Working Time"].map((h) => (
                              <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.liveTable.map((row, i) => (
                            <tr key={row.userId}
                              className={`border-t transition-colors ${
                                isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"
                              } ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 bg-emerald-600`}>
                                    {row.name.charAt(0).toUpperCase()}
                                  </div>
                                  <span className={`font-semibold text-xs truncate max-w-[100px] ${textPrimary}`}>{row.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs ${textSecondary}`}>{row.role}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-mono ${textSecondary}`}>
                                  {row.loginTime
                                    ? new Date(row.loginTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
                                    : "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={row.status} isDark={isDark} />
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs truncate max-w-[120px] block ${textSecondary}`}>{row.currentModule}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs truncate max-w-[100px] block ${textSecondary}`}>{row.activeLead}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs truncate max-w-[120px] block ${textSecondary}`}>{row.currentAction}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-mono ${textSecondary}`}>
                                  {row.workingHours != null ? `${row.workingHours}h` : "—"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        isDark={isDark}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
}
