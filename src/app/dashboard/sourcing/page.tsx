"use client";
// Sourcing Manager panel — Channel Partner management only.
//
// Structurally a sibling of the Receptionist panel (same buildTheme tokens, same
// hover-expand sidebar, same header), but with a deliberately minimal nav. This
// role exists to own the Channel Partner master and nothing else: no leads, no
// closed leads, no attendance tab, no AI assistant, and no commission figures.
// The API enforces that last part independently — GET strips
// default_commission_rate for roles without commercial visibility, so it never
// reaches this page even if someone adds a column to the table.
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaThLarge, FaCog, FaEyeSlash, FaCalendarAlt,
  FaBuilding, FaIdCard, FaPlus, FaHandshake, FaClipboardList,
} from "react-icons/fa";
import ChannelPartnerEnquiriesTable from "@/components/ChannelPartnerEnquiriesTable";
import AssignedChannelPartnersView from "@/components/AssignedChannelPartnersView";
import { buildTheme } from "@/lib/crmTheme";
import ChannelPartnerFormModal from "@/components/ChannelPartnerFormModal";
import WhatsAppSettingsCard from "@/components/WhatsAppSettingsCard";
import LoginTimerWidget from "@/components/LoginTimerWidget";
import AttendanceBadge from "@/components/AttendanceBadge";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import UserAvatar from "@/components/UserAvatar";

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

// "My Channel Partners" (partner records assigned to this manager) and
// "My CP Enquiries" (individual client walk-ins routed to them) are deliberately
// separate tabs: they are different units of work. The former is the partner
// relationship this role owns, the latter is one lead at a time.
//
// There is no full-registry tab. A Sourcing Manager sees only the partners
// assigned to them — enforced in GET /api/channel-partners, which forces their own
// id into the WHERE clause — so a second "all partners" tab would now render the
// identical list under a name that promises otherwise.
const NAV_ITEMS = [
  { id: "overview", icon: <FaThLarge className="w-5 h-5" />, title: "Dashboard" },
  { id: "my-cps", icon: <FaHandshake className="w-5 h-5" />, title: "My Channel Partners" },
  { id: "assigned-cps", icon: <FaClipboardList className="w-5 h-5" />, title: "My CP Enquiries" },
];

export default function SourcingManagerDashboard() {
  const router = useRouter();
  useActivityTracker();
  // The shared theme, from lib/theme.ts. This used to be a local useState that
  // reset to light on every navigation and was never stored anywhere; it now
  // reads the same value Preferences → Theme writes.
  const { isDark, toggleTheme } = useCrmTheme();
  const t = buildTheme(isDark);

  const [user, setUser] = useState<any>({ name: "Loading...", role: "Sourcing Manager", email: "", password: "" });
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activePopup, setActivePopup] = useState<"profile" | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const topbarRef = useRef<HTMLDivElement>(null);

  const [partners, setPartners] = useState<any[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Bumped after a registration so the partner table refetches too, not just the
  // overview stats — the new partner should appear without a manual refresh.
  const [partnersVersion, setPartnersVersion] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ title: string; color: string } | null>(null);

  const showToast = (title: string, color = "green") => {
    setToastMsg({ title, color });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const fetchPartners = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/channel-partners");
      const json = await res.json();
      if (json.success) setPartners(json.data || []);
    } catch { /* stats are non-blocking */ } finally { setLoadingStats(false); }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (topbarRef.current && !topbarRef.current.contains(event.target as Node)) setActivePopup(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const cleanupBackGuard = installLoggedOutBackGuard(() => router.replace("/"));
    const p = getStoredCrmUser();
    if (!p) { router.replace("/"); return cleanupBackGuard; }
    try {
      setUser({ ...p, name: p.name || "User", password: p.password || "********" });
      fetch(`/api/users/update-whatsapp?name=${encodeURIComponent(p.name)}`)
        .then(r => r.json())
        .then(data => { if (data.success) setUser((prev: any) => ({ ...prev, whatsapp_number: data.whatsapp_number || "" })); })
        .catch(() => { });
      const role = (p.role || "").toLowerCase().replace(/_/g, " ");
      if (role === "sourcing manager" || role === "admin") {
        fetchPartners();
      } else {
        router.replace("/dashboard");
      }
    } catch { router.replace("/"); }
    return cleanupBackGuard;
  }, [router, fetchPartners]);

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  // ── Stats ──
  // `partners` is already only this manager's book: the API scopes the list for
  // this role, so there is no "mine vs all" split to compute here and no way for
  // another manager's numbers to leak into these totals.
  const now = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const parsed = partners.map(p => ({ ...p, _created: p.created_at ? new Date(p.created_at) : null }));
  const myPartners = parsed.length;
  const addedToday = parsed.filter(p => p._created && p._created >= todayStart).length;
  const addedThisMonth = parsed.filter(p => p._created && p._created >= monthStart).length;
  const activeCps = parsed.filter(p => p.status === "active").length;
  const profileComplete = parsed.filter(p =>
    p.office_address && p.gst_number && p.rera_registration_no && p.owner_contact_person
  ).length;
  const myPartnersNeedingProfile = myPartners - profileComplete;
  const myRegistrations = parsed.filter(p => p.created_by === user.name).length;

  // The headline this role is actually measured on: not how many partners were
  // filed, but how much business those partners brought in.
  const myLeads = parsed.reduce((n, p) => n + Number(p.lead_count || 0), 0);
  const myBookings = parsed.reduce((n, p) => n + Number(p.booking_count || 0), 0);
  const myTopPartners = [...parsed]
    .filter(p => Number(p.lead_count || 0) > 0)
    .sort((a, b) => Number(b.lead_count || 0) - Number(a.lead_count || 0))
    .slice(0, 6);

  const statCards = [
    { label: "Your Partners", value: myPartners, icon: <FaHandshake />, glow: t.statGlow1, tab: "my-cps" },
    { label: "Leads They Brought", value: myLeads, icon: <FaClipboardList />, glow: t.statGlow2, tab: "my-cps" },
    { label: "Bookings Sourced", value: myBookings, icon: <FaBuilding />, glow: t.statGlow3, tab: "my-cps" },
    { label: "Profiles To Complete", value: myPartnersNeedingProfile, icon: <FaIdCard />, glow: t.statGlow4, tab: "my-cps" },
  ];

  return (
    <div
      className={`flex flex-col md:flex-row h-screen font-sans overflow-hidden ${t.pageWrap}`}
      style={isDark ? {} : { background: "linear-gradient(135deg, #e8f6fd 0%, #f8fafc 30%, #faf0fb 62%, #f8fafc 78%, #e6fafe 100%)" }}
    >
      {toastMsg && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-xl shadow-lg flex items-center gap-4 animate-fadeIn border ${toastMsg.color === "green" ? "bg-green-600 border-green-400 text-white" : "bg-blue-600 border-blue-400 text-white"}`}>
          <span className="text-sm font-bold">{toastMsg.title}</span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          SIDEBAR (DESKTOP)
      ════════════════════════════════════════════════════ */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className={`hidden md:flex flex-col py-5 px-1 z-50 overflow-hidden fixed left-0 top-0 h-full ${t.sidebar}`}
        style={{
          width: sidebarExpanded ? "248px" : "72px",
          transition: "width 320ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 320ms ease",
          background: "linear-gradient(180deg, #0f0f1a 0%, #111128 40%, #0f0f1a 100%)",
          borderRight: "1px solid rgba(158,33,123,0.15)",
          boxShadow: sidebarExpanded
            ? "4px 0 24px rgba(0,0,0,0.4), inset -1px 0 0 rgba(158,33,123,0.08)"
            : "2px 0 16px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-center px-3 mb-6 mt-1 overflow-hidden">
          <img src="/assets/logobrowser_trans.svg" alt="Logo"
            className="w-10 h-10 rounded-xl object-cover flex-shrink-0 cursor-pointer transition-all duration-300" />
          <div className="ml-3 overflow-hidden transition-all duration-300"
            style={{
              maxWidth: sidebarExpanded ? "130px" : "0px",
              opacity: sidebarExpanded ? 1 : 0,
              transform: sidebarExpanded ? "translateX(0)" : "translateX(-8px)",
            }}>
            <p className="text-white font-bold text-[16px] whitespace-nowrap leading-tight">Bhoomi CRM</p>
            <p className="text-[#d946a8] text-[10px] font-semibold whitespace-nowrap opacity-80">Sourcing Manager</p>
          </div>
        </div>
        <div className="mx-3 mb-5 h-px transition-all duration-300"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.4), transparent)",
            opacity: sidebarExpanded ? 1 : 0.4,
          }} />

        <nav className="flex flex-col gap-2 w-full px-2 flex-1">
          <div className="flex flex-col gap-2 flex-1">
            {NAV_ITEMS.map(({ id, icon, title }) => {
              const isActive = activeTab === id;
              return (
                <div key={id} onClick={() => setActiveTab(id)} title={!sidebarExpanded ? title : undefined}
                  className="relative cursor-pointer group">
                  {isActive && (
                    <div className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{ background: "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)" }} />
                  )}
                  <div
                    className={`flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"}`}
                    style={isActive ? {
                      background: "linear-gradient(135deg, rgba(158,33,123,0.22) 0%, rgba(217,70,168,0.07) 100%)",
                      boxShadow: "inset 0 0 0 1px rgba(217,70,168,0.28), 0 2px 16px rgba(158,33,123,0.12)",
                    } : {}}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d946a8]"
                        style={{ boxShadow: "0 0 10px rgba(217,70,168,0.9), 0 0 4px rgba(217,70,168,0.6)" }} />
                    )}
                    {!isActive && (
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.04] transition-colors duration-200" />
                    )}
                    <div className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"}`}
                      style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}>
                      {icon}
                    </div>
                    <span className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"}`}
                      style={{
                        maxWidth: sidebarExpanded ? "140px" : "0px",
                        opacity: sidebarExpanded ? 1 : 0,
                        transform: sidebarExpanded ? "translateX(0)" : "translateX(-6px)",
                        letterSpacing: "0.01em",
                      }}>
                      {title}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Settings pinned to bottom */}
          {(() => {
            const isActive = activeTab === "settings";
            return (
              <div onClick={() => setActiveTab("settings")} title={!sidebarExpanded ? "Settings" : undefined}
                className="relative cursor-pointer group mt-auto">
                {isActive && (
                  <div className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ background: "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)" }} />
                )}
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"}`}
                  style={isActive ? {
                    background: "linear-gradient(135deg, rgba(158,33,123,0.22) 0%, rgba(217,70,168,0.07) 100%)",
                    boxShadow: "inset 0 0 0 1px rgba(217,70,168,0.28), 0 2px 16px rgba(158,33,123,0.12)",
                  } : {}}>
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d946a8]"
                      style={{ boxShadow: "0 0 10px rgba(217,70,168,0.9), 0 0 4px rgba(217,70,168,0.6)" }} />
                  )}
                  {!isActive && (
                    <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.04] transition-colors duration-200" />
                  )}
                  <div className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"}`}
                    style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}>
                    <FaCog className="w-[20px] h-[20px]" />
                  </div>
                  <span className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"}`}
                    style={{
                      maxWidth: sidebarExpanded ? "140px" : "0px",
                      opacity: sidebarExpanded ? 1 : 0,
                      transform: sidebarExpanded ? "translateX(0)" : "translateX(-6px)",
                      letterSpacing: "0.01em",
                    }}>
                    Settings
                  </span>
                </div>
              </div>
            );
          })()}
        </nav>

        <div className="px-3 mt-4">
          <div className="h-px mb-3" style={{ background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.35), transparent)" }} />
          <div className="overflow-hidden transition-all duration-300 flex items-center justify-center"
            style={{ opacity: sidebarExpanded ? 0.5 : 0, maxHeight: sidebarExpanded ? "24px" : "0px" }}>
            <span className="text-[8px] text-gray-300 whitespace-nowrap font-mono tracking-widest uppercase">
              Bhoomi CRM · v2
            </span>
          </div>
        </div>
      </aside>

      <div className="hidden md:block fixed inset-0 pointer-events-none"
        style={{
          zIndex: 45, left: "72px",
          background: "rgba(0, 0, 0, 0.2)",
          backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
          opacity: sidebarExpanded ? 1 : 0,
          transition: "opacity 320ms ease",
        }} />

      {/* ── MOBILE NAV ── */}
      <div className={`md:hidden fixed bottom-0 left-0 right-0 h-16 border-t flex items-center justify-around z-50 ${t.sidebar}`}>
        {[...NAV_ITEMS, { id: "settings", icon: <FaCog className="w-5 h-5" />, title: "Settings" }].map(({ id, icon }) => (
          <div key={id} onClick={() => setActiveTab(id)} className="relative cursor-pointer p-2">
            {activeTab === id && <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b ${t.navIndicator}`} />}
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === id ? t.navActive : t.navInactive}`}>
              {icon}
            </div>
          </div>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════
          MAIN CONTENT
      ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden relative md:ml-[72px]">

        <header className={`h-16 border-b flex items-center justify-between px-6 flex-shrink-0 z-30 ${t.header}`} style={t.headerGlass}>
          <img src="/assets/bhoomidwellersLogo_trans.png" alt="Bhoomi CRM" className="h-20 md:h-18 w-auto object-contain" />
          <div className="flex items-center space-x-4 relative" ref={topbarRef}>
            {/* <LoginTimerWidget isDark={isDark} />
            <AttendanceBadge /> */}
            <button onClick={toggleTheme} aria-pressed={isDark}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm ${t.toggleWrap}`}>
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
            <div onClick={() => setActivePopup(activePopup === "profile" ? null : "profile")}
              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer shadow-md hover:scale-105 transition-transform ${isDark ? "border border-[#9E217B]/40 text-[#d4006e] bg-[#9E217B]/15" : "border border-[#00AEEF]/40 text-[#00AEEF] bg-[#00AEEF]/10"}`}>
              <UserAvatar name={user?.name} fallback="U" alt="" />
            </div>
            <AnimatePresence>
              {activePopup === "profile" && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={`absolute top-12 right-0 w-64 rounded-xl shadow-2xl p-5 z-50 border ${t.dropdown}`} style={t.dropdownGlass}
                >
                  <div className="mb-4">
                    <h3 className={`font-bold text-lg ${t.text}`}>{user?.name || "User"}</h3>
                    <p className={`text-sm truncate ${t.textMuted}`}>{user?.email || "No email"}</p>
                  </div>
                  <hr className={`mb-4 border-0 border-t ${t.tableBorder}`} />
                  <div className="space-y-4 mb-6 text-sm">
                    <p className={`flex justify-between items-center ${t.textMuted}`}>Role:
                      <span className={`font-bold capitalize px-2 py-0.5 rounded text-xs ${isDark ? "text-[#d4006e] bg-[#9E217B]/10" : "text-[#00AEEF] bg-[#00AEEF]/10"}`}>{user?.role}</span>
                    </p>
                    <div>
                      <p className={`text-xs mb-1 ${t.textFaint}`}>Password</p>
                      <div className={`flex items-center justify-between p-2 rounded-md border ${t.settingsBg}`} style={t.settingsBgGl}>
                        <span className={`font-mono tracking-widest ${t.text}`}>{showPassword ? user.password : "••••••••••••"}</span>
                        <button onClick={() => setShowPassword(!showPassword)} className={`${t.textMuted} cursor-pointer`}><FaEyeSlash /></button>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleLogout} className={`w-full py-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${t.btnDanger}`}>Logout</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        <main className={`flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6 custom-scrollbar relative ${t.mainBg}`}>

          {/* ════════════════════════════════════════════════════
              OVERVIEW — CP registration stats
          ════════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <div className="animate-fadeIn pb-10">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
                <h1 className={`text-xl md:text-3xl font-bold flex items-center flex-wrap gap-2 md:gap-3 ${t.text}`}>
                  Hi, {String(user?.name || "User").split(" ")[0]}
                  <span className={`text-xs md:text-sm font-medium px-2 py-0.5 md:px-3 md:py-1 rounded-full ${isDark ? "text-[#9E217B] bg-white/80 border border-[#9E217B]/40" : "text-[#9E217B] bg-[#9E217B]/10 border border-[#9E217B]/20"}`}>
                    Sourcing
                  </span>
                </h1>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQuickAddOpen(true)}
                    className={`text-xs md:text-sm font-semibold flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-all shadow-sm ${t.btnPrimary}`}>
                    <FaPlus className="text-[10px]" /> New CP Entry
                  </button>
                  <button onClick={fetchPartners}
                    className={`text-white text-xs md:text-sm font-semibold px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-all shadow-sm ${t.btnSecondary}`}>
                    ↻ Refresh
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-6">
                {statCards.map(c => (
                  <div key={c.label} onClick={() => setActiveTab(c.tab)}
                    className={`relative rounded-2xl border p-5 overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] ${t.card}`} style={t.cardGlass}>
                    <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full blur-2xl ${c.glow}`} />
                    <div className="relative">
                      <div className={`flex items-center gap-2 mb-3 ${t.textMuted}`}>
                        <span className={t.accentText}>{c.icon}</span>
                        <p className="text-[11px] font-bold uppercase tracking-wider">{c.label}</p>
                      </div>
                      <p className={`text-4xl font-black tracking-tight ${t.text}`}>
                        {loadingStats ? "—" : c.value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <div className={`rounded-2xl border p-6 ${t.card}`} style={t.cardGlass}>
                  <h3 className={`text-sm font-bold uppercase tracking-wider border-b pb-2 mb-5 ${t.sectionTitle} ${t.tableBorder}`}>
                    Registry Health
                  </h3>
                  <div className="space-y-4">
                    {[
                      { k: "Partners who have brought a lead", v: `${myTopPartners.length} of ${myPartners}` },
                      { k: "Active partners", v: `${activeCps} of ${myPartners}` },
                      { k: "Full office-visit profile on file", v: `${profileComplete} of ${myPartners}` },
                      { k: "Registered by you", v: myRegistrations },
                      { k: "Assigned to you today / this month", v: `${addedToday} / ${addedThisMonth}` },
                    ].map(r => (
                      <div key={r.k} className="flex items-center justify-between gap-4">
                        <p className={`text-xs ${t.textMuted}`}>{r.k}</p>
                        <p className={`text-sm font-bold ${t.text}`}>{loadingStats ? "—" : r.v}</p>
                      </div>
                    ))}
                  </div>
                  {/* Partners auto-created from Channel Partner enquiries have only a
                      name and phone. That backlog is this role's actual work queue. */}
                  {!loadingStats && myPartnersNeedingProfile > 0 && (
                    <div className={`mt-5 rounded-lg px-3 py-2.5 text-[11px] ${isDark ? "bg-amber-500/10 border border-amber-500/25 text-amber-400" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                      {myPartnersNeedingProfile} of your partner{myPartnersNeedingProfile === 1 ? " has" : "s have"} no
                      full office-visit profile — usually because they were created automatically from a
                      Channel Partner enquiry. Start a New Entry with the same phone number: you&apos;ll be
                      shown the existing partner and can choose to fill in their profile.
                      <button onClick={() => setActiveTab("my-cps")}
                        className={`ml-1 underline font-bold cursor-pointer`}>
                        View partners
                      </button>
                    </div>
                  )}
                </div>

                {/* Which of this manager's partners are actually delivering. Ranked
                    by leads brought, because that is the relationship being managed —
                    a registry sorted by registration date answers a question nobody
                    in this role is asking. */}
                <div className={`rounded-2xl border p-6 ${t.card}`} style={t.cardGlass}>
                  <h3 className={`text-sm font-bold uppercase tracking-wider border-b pb-2 mb-5 ${t.sectionTitle} ${t.tableBorder}`}>
                    Your Top Partners by Leads
                  </h3>
                  {loadingStats ? (
                    <p className={`text-xs ${t.textFaint}`}>Loading…</p>
                  ) : myTopPartners.length === 0 ? (
                    <>
                      <p className={`text-xs ${t.textFaint}`}>
                        {myPartners === 0
                          ? "No partners assigned to you yet."
                          : "None of your partners has brought a lead yet."}
                      </p>
                      <p className={`text-[11px] mt-2 ${t.textMuted}`}>
                        A partner is matched by phone number — when a Receptionist logs an
                        enquiry with your partner&apos;s number, it lands here automatically.
                      </p>
                    </>
                  ) : (
                    <div className="space-y-3">
                      {myTopPartners.map((p, i) => {
                        const share = myLeads > 0 ? (Number(p.lead_count || 0) / myLeads) * 100 : 0;
                        return (
                          <div key={p.id} onClick={() => setActiveTab("my-cps")} className="cursor-pointer group">
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <div className="min-w-0 flex items-center gap-2">
                                <span className={`text-[10px] font-black w-4 flex-shrink-0 ${t.textFaint}`}>#{i + 1}</span>
                                <div className="min-w-0">
                                  <p className={`text-xs font-bold truncate ${t.text}`}>{p.name}</p>
                                  <p className={`text-[10px] truncate ${t.textFaint}`}>
                                    {p.company_name || "No company on file"}
                                    {Number(p.booking_count || 0) > 0 ? ` · ${p.booking_count} booking(s)` : ""}
                                  </p>
                                </div>
                              </div>
                              <p className={`text-xs font-black whitespace-nowrap ${t.accentText}`}>
                                {p.lead_count}
                              </p>
                            </div>
                            <div className={`h-1.5 rounded-full overflow-hidden ml-6 ${isDark ? "bg-[#252525]" : "bg-slate-200"}`}>
                              <div className="h-full rounded-full bg-[#9E217B] transition-all" style={{ width: `${share}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              MY CHANNEL PARTNERS — the partner records this manager owns.
              Scoped in /api/channel-partners, which forces the session user's
              own id into the WHERE clause for this role: another manager's
              partners never reach this page to begin with.
          ════════════════════════════════════════════════════ */}
          {activeTab === "my-cps" && (
            <div className="animate-fadeIn h-[calc(100vh-140px)]">
              <AssignedChannelPartnersView
                isDark={isDark}
                t={t}
                title="My Channel Partners"
                subtitle="Channel Partners assigned to you — click any row for their full profile and history"
                onNewEntry={() => setQuickAddOpen(true)}
                refreshKey={partnersVersion}
              />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              ASSIGNED CP ENQUIRIES
              Scoping is enforced in /api/cp-enquiries, which forces the
              session user's own id into the WHERE clause and ignores any
              sourcing_manager_id param — another manager's rows never
              reach this page to begin with.
          ════════════════════════════════════════════════════ */}
          {activeTab === "assigned-cps" && (
            <div className="animate-fadeIn h-[calc(100vh-140px)]">
              <ChannelPartnerEnquiriesTable
                user={user}
                isDark={isDark}
                t={t}
                title="Assigned CP Enquiries"
                subtitle="Individual Channel Partner enquiries routed to you"
                showSerial
              />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              SETTINGS
          ════════════════════════════════════════════════════ */}
          {activeTab === "settings" && (
            <div className="animate-fadeIn max-w-4xl mx-auto">
              <h1 className={`text-3xl font-bold mb-8 ${t.text}`}>Settings & Profile</h1>
              <div className="w-full lg:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className={`rounded-2xl p-8 border flex flex-col items-center justify-center ${t.card}`} style={t.cardGlass}>
                  <FaCalendarAlt className={`text-5xl mb-4 ${t.accentText}`} />
                  <h2 className={`text-3xl lg:text-4xl font-black tracking-tight mb-2 ${t.text}`}>
                    {currentTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </h2>
                  <p className={`font-medium text-sm lg:text-lg ${t.textMuted}`}>
                    {currentTime.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  </p>
                </div>
                <div className={`rounded-2xl p-8 border ${t.card}`} style={t.cardGlass}>
                  <h3 className={`text-lg font-bold border-b pb-2 mb-6 uppercase tracking-wider ${t.sectionTitle} ${t.tableBorder}`}>Account Details</h3>
                  <div className="space-y-6">
                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Full Name</p><p className={`font-semibold text-lg ${t.text}`}>{user?.name}</p></div>
                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Registered Email</p><p className={`font-medium ${t.text}`}>{user?.email || "No Email"}</p></div>
                    <div>
                      <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>System Password</p>
                      <div className={`flex items-center justify-between p-3 rounded-lg border ${t.settingsBg}`} style={t.settingsBgGl}>
                        <span className={`font-mono tracking-widest ${t.text}`}>{showPassword ? user.password : "••••••••••••"}</span>
                        <button onClick={() => setShowPassword(!showPassword)} className={`${t.textMuted} cursor-pointer`}><FaEyeSlash /></button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className={`rounded-2xl p-8 border ${t.card}`} style={t.cardGlass}>
                  <h3 className={`text-lg font-bold border-b pb-2 mb-6 uppercase tracking-wider ${t.sectionTitle} ${t.tableBorder}`}>
                    WhatsApp Number
                  </h3>
                  <WhatsAppSettingsCard user={user} setUser={setUser} isDark={isDark} t={t} />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Quick-add from the overview tab. The list tab has its own button. */}
      <ChannelPartnerFormModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onSaved={info => {
          if (info) showToast(info.merged ? "Existing partner updated" : "Channel partner registered", info.merged ? "blue" : "green");
          fetchPartners();
          setPartnersVersion(v => v + 1);
        }}
        partner={null}
        user={user}
        isDark={isDark}
        t={t}
        variant="office_visit"
      />
    </div>
  );
}
