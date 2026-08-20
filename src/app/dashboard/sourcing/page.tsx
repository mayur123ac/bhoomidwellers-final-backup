"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { buildTheme } from "@/lib/crmTheme";
import { motion, AnimatePresence } from "framer-motion";

// Using Io5 for a consistent, recognizable, system-style icon family
import {
  IoGridOutline, IoGrid,
  IoPeopleOutline, IoPeople,
  IoDocumentTextOutline, IoDocumentText,
  IoChatbubbleEllipsesOutline, IoChatbubbleEllipses,
  IoSettingsOutline, IoSettings,
  IoAddOutline, IoRefreshOutline,
  IoMoonOutline, IoSunnyOutline,
  IoChevronForward
} from "react-icons/io5";

import ChannelPartnerEnquiriesTable from "@/components/ChannelPartnerEnquiriesTable";
import CpChatPanel from "@/components/CpChatPanel";
import AssignedChannelPartnersView from "@/components/AssignedChannelPartnersView";
import ChannelPartnerFormModal from "@/components/ChannelPartnerFormModal";
import WhatsAppSettingsCard from "@/components/WhatsAppSettingsCard";
import UserAvatar from "@/components/UserAvatar";
import HeaderClock from "@/components/HeaderClock";
import AppHeader, { HeaderControl, AppLogo } from "@/components/AppHeader";

const NAV_ITEMS = [
  { id: "overview", icon: IoGridOutline, activeIcon: IoGrid, title: "Dashboard" },
  { id: "my-cps", icon: IoPeopleOutline, activeIcon: IoPeople, title: "Channel Partners" },
  { id: "assigned-cps", icon: IoDocumentTextOutline, activeIcon: IoDocumentText, title: "CP Enquiries" },
  { id: "cp-chat", icon: IoChatbubbleEllipsesOutline, activeIcon: IoChatbubbleEllipses, title: "CP Chat" },
];

export default function SourcingManagerDashboard() {
  const router = useRouter();
  const { isDark, toggleTheme } = useCrmTheme();
  const t = buildTheme(isDark);

  const [user, setUser] = useState<any>({ name: "Loading...", role: "Sourcing Manager", email: "", password: "" });
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [activePopup, setActivePopup] = useState<"profile" | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const topbarRef = useRef<HTMLDivElement>(null);

  const [partners, setPartners] = useState<any[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [partnersVersion, setPartnersVersion] = useState(0);

  const fetchPartners = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/channel-partners");
      const json = await res.json();
      if (json.success) setPartners(json.data || []);
    } catch {
      // Non-blocking stats
    } finally {
      setLoadingStats(false);
    }
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
  const now = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const parsed = partners.map(p => ({ ...p, _created: p.created_at ? new Date(p.created_at) : null }));
  const myPartners = parsed.length;
  const activeCps = parsed.filter(p => p.status === "active").length;
  const profileComplete = parsed.filter(p => p.office_address && p.gst_number && p.rera_registration_no && p.owner_contact_person).length;
  const myPartnersNeedingProfile = myPartners - profileComplete;
  const myLeads = parsed.reduce((n, p) => n + Number(p.lead_count || 0), 0);
  const myBookings = parsed.reduce((n, p) => n + Number(p.booking_count || 0), 0);
  const myTopPartners = [...parsed]
    .filter(p => Number(p.lead_count || 0) > 0)
    .sort((a, b) => Number(b.lead_count || 0) - Number(a.lead_count || 0))
    .slice(0, 5);

  // ── Theme Design Tokens ──
  const bgApp = isDark ? "bg-[#000000]" : "bg-[#F5F5F7]";
  const bgSidebar = isDark ? "bg-[#1C1C1E]/90 border-r border-[#38383A]" : "bg-[#F5F5F7]/90 border-r border-[#E5E5EA]";
  const bgCard = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const bgSubtle = isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]";
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textAccent = isDark ? "text-[#FF3797]" : "text-[#9E217B]";
  const bgAccent = isDark ? "bg-[#FF3797]" : "bg-[#9E217B]";

  const isChat = activeTab === "cp-chat";

  return (
    <div className={`flex flex-col md:flex-row h-[100dvh] font-sans overflow-hidden transition-colors duration-300 ${bgApp} ${textPrimary}`}>

      {/* ════════════════════════════════════════════════════
          SIDEBAR (DESKTOP)
      ════════════════════════════════════════════════════ */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className={`hidden md:flex flex-col py-6 px-3 z-50 fixed left-0 top-0 h-full backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${bgSidebar}`}
        style={{ width: sidebarExpanded ? "260px" : "76px" }}
      >
        <div className="flex items-center px-2 mb-8 overflow-hidden h-10">
          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
            <img src="/assets/logobrowser_trans.png" alt="Logo" className="w-9 h-9 min-w-[36px] rounded-xl object-cover flex-shrink-0" />
          </div>
          <div className={`ml-3 flex flex-col whitespace-nowrap transition-opacity duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
            <span className="font-semibold text-[13px] tracking-tight leading-tight">Bhoomi CRM</span>
            <span className={`text-[10px] ${textSecondary}`}>Sourcing Manager</span>
          </div>
        </div>

        <nav className="flex flex-col gap-1.5 w-full flex-1">
          {NAV_ITEMS.map(({ id, icon: Icon, activeIcon: ActiveIcon, title }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors duration-200 border border-transparent ${isActive
                  ? isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-white border-[#E5E5EA] shadow-sm"
                  : `hover:${bgSubtle}`
                  }`}
                title={!sidebarExpanded ? title : undefined}
              >
                <div className={`flex-shrink-0 flex items-center justify-center w-6 h-6 ${isActive ? textAccent : textSecondary}`}>
                  {isActive ? <ActiveIcon size={18} /> : <Icon size={18} />}
                </div>
                <span className={`text-xs font-medium whitespace-nowrap transition-all duration-300 ${isActive ? textPrimary : textSecondary} ${sidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
                  {title}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Settings pinned to bottom */}
        <div className="mt-auto">
          <button
            onClick={() => setActiveTab("settings")}
            className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors duration-200 border border-transparent ${activeTab === "settings"
              ? isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-white border-[#E5E5EA] shadow-sm"
              : `hover:${bgSubtle}`
              }`}
            title={!sidebarExpanded ? "Settings" : undefined}
          >
            <div className={`flex-shrink-0 flex items-center justify-center w-6 h-6 ${activeTab === "settings" ? textAccent : textSecondary}`}>
              {activeTab === "settings" ? <IoSettings size={18} /> : <IoSettingsOutline size={18} />}
            </div>
            <span className={`text-xs font-medium whitespace-nowrap transition-all duration-300 ${activeTab === "settings" ? textPrimary : textSecondary} ${sidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
              Settings
            </span>
          </button>
        </div>
      </aside>

      {/* ── MOBILE NAV ── */}
      <div className={`md:hidden fixed bottom-0 left-0 right-0 z-[100] backdrop-blur-xl border-t flex items-start pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] justify-around ${bgSidebar}`}>
        {[...NAV_ITEMS, { id: "settings", icon: IoSettingsOutline, activeIcon: IoSettings, title: "Settings" }].map(({ id, icon: Icon, activeIcon: ActiveIcon, title }) => {
          const isActive = activeTab === id;
          return (
            <button key={id} onClick={() => setActiveTab(id)} className="flex-1 flex flex-col items-center justify-center gap-1 relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive ? (isDark ? "bg-[#2C2C2E]" : "bg-[#E5E5EA]") : "bg-transparent"}`}>
                {isActive ? <ActiveIcon size={18} className={textAccent} /> : <Icon size={18} className={textSecondary} />}
              </div>
              <span className={`text-[9px] font-medium ${isActive ? textAccent : textSecondary}`}>{title.replace("Channel ", "")}</span>
            </button>
          )
        })}
      </div>

      {/* ════════════════════════════════════════════════════
          MAIN CONTENT
      ════════════════════════════════════════════════════ */}
      <div className={`flex-1 flex flex-col overflow-hidden relative md:ml-[76px]`}>

        {/* ── HEADER BLOCK (Cleaned) ── */}
        <div className={`relative z-15 bg-white/95 ${isChat ? "hidden md:block" : "block"}`}>
          <AppHeader
            isDark={isDark}
            context={NAV_ITEMS.find(n => n.id === activeTab)?.title || "Settings"}
            role={user?.role || "Sourcing Manager"}
          >
            {/* Removed the redundant extra logo and fixed the duplicated wrapper div */}
            <div className="flex items-center gap-1.5 md:gap-2 relative" ref={topbarRef}>
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
                onClick={() => setActivePopup(activePopup === "profile" ? null : "profile")}
                label="Profile"
                className="overflow-hidden p-0"
              >
                <UserAvatar name={user?.name} fallback="U" alt="" />
              </HeaderControl>

              <AnimatePresence>
                {activePopup === "profile" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                    className={`absolute top-12 right-0 w-52 rounded-[1.25rem] shadow-2xl p-4 z-50 border ${isDark ? "bg-[#1C1C1E] border-white/10" : "bg-white border-black/10"}`}
                  >
                    <div className="mb-3">
                      <h3 className="font-semibold text-[13px] tracking-tight leading-tight">{user?.name || "User"}</h3>
                      <p className={`text-[10px] truncate mt-0.5 ${textSecondary}`}>{user?.email || "No email"}</p>
                    </div>

                    <hr className={`mb-3 border-0 border-t ${isDark ? "border-white/10" : "border-black/5"}`} />

                    <div className="space-y-3 mb-4 text-[11px]">
                      <div className="flex justify-between items-center">
                        <span className={textSecondary}>Role</span>
                        <span className={`font-medium px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider ${bgSubtle}`}>{user?.role}</span>
                      </div>
                    </div>

                    <button onClick={handleLogout} className="w-full py-2 rounded-xl font-medium text-[11px] text-red-500 bg-red-50 dark:bg-red-500/10 transition-colors active:scale-95">
                      Log Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </AppHeader>
        </div>
        {/* ── END HEADER BLOCK ── */}

        <main className={`flex-1 flex flex-col overflow-y-auto ${isChat ? "p-0 pb-0" : "p-0 pb-[calc(env(safe-area-inset-bottom)+84px)]"} md:pb-0 custom-scrollbar relative`}>

          {/* ════════════════════════════════════════════════════
              DASHBOARD
          ════════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <div className="animate-fadeIn max-w-7xl mx-auto px-4 md:px-6 z-0">
              <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-3 mb-6 mt-6">
                <div>
                  <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-1">
                    Good morning, {String(user?.name || "User").split(" ")[0]}
                  </h1>
                  <p className={`text-xs md:text-sm ${textSecondary}`}>Your Channel Partner activity overview.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={fetchPartners} className={`w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full transition-colors ${bgSubtle}`}>
                    <IoRefreshOutline size={16} />
                  </button>
                  <button
                    onClick={() => setQuickAddOpen(true)}
                    className={`text-xs md:text-sm font-medium flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-full transition-all text-white ${bgAccent} hover:opacity-90`}
                  >
                    <IoAddOutline size={16} />
                    New CP Entry
                  </button>
                </div>
              </div>

              {/* Metric Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
                {[
                  { label: "Partners", value: myPartners, icon: IoPeopleOutline },
                  { label: "Leads", value: myLeads, icon: IoDocumentTextOutline },
                  { label: "Bookings", value: myBookings, icon: IoGridOutline },
                  { label: "Pending Setup", value: myPartnersNeedingProfile, icon: IoSettingsOutline },
                ].map((c) => (
                  <div key={c.label} onClick={() => setActiveTab("my-cps")} className={`rounded-2xl p-4 md:p-5 cursor-pointer hover:scale-[1.02] transition-transform ${bgCard}`}>
                    <div className={`flex items-center justify-between mb-3`}>
                      <c.icon size={18} className={textAccent} />
                    </div>
                    <p className={`text-xl md:text-2xl font-semibold tracking-tight ${textPrimary}`}>
                      {loadingStats ? "—" : c.value}
                    </p>
                    <p className={`text-[10px] md:text-xs font-medium mt-1 ${textSecondary}`}>{c.label}</p>
                  </div>
                ))}
              </div>

              {/* Detail Panels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

                {/* Registry Health */}
                <div className={`rounded-2xl p-5 ${bgCard}`}>
                  <h3 className="text-xs md:text-sm font-semibold tracking-tight mb-3">Registry Health</h3>
                  <div className="space-y-0">
                    {[
                      { k: "Active partners", v: `${activeCps} / ${myPartners}` },
                      { k: "Full profile completed", v: `${profileComplete} / ${myPartners}` },
                      { k: "Added this month", v: parsed.filter(p => p._created && p._created >= monthStart).length },
                    ].map((r, idx, arr) => (
                      <div key={r.k} className={`flex items-center justify-between py-2.5 ${idx !== arr.length - 1 ? `border-b ${isDark ? 'border-[#38383A]' : 'border-[#E5E5EA]'}` : ''}`}>
                        <p className={`text-xs md:text-sm ${textSecondary}`}>{r.k}</p>
                        <p className={`text-xs md:text-sm font-medium ${textPrimary}`}>{loadingStats ? "—" : r.v}</p>
                      </div>
                    ))}
                  </div>

                  {!loadingStats && myPartnersNeedingProfile > 0 && (
                    <div className={`mt-5 rounded-xl p-3.5 text-[11px] md:text-xs leading-relaxed ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                      <p className={textSecondary}>
                        <strong className={`font-medium ${textPrimary}`}>{myPartnersNeedingProfile} partners</strong> have incomplete profiles. Start a New Entry with their phone number to securely update their information.
                      </p>
                    </div>
                  )}
                </div>

                {/* Top Performers */}
                <div className={`rounded-2xl p-5 ${bgCard}`}>
                  <h3 className="text-xs md:text-sm font-semibold tracking-tight mb-3">Top Performing Partners</h3>
                  {loadingStats ? (
                    <p className={`text-xs ${textSecondary}`}>Loading...</p>
                  ) : myTopPartners.length === 0 ? (
                    <p className={`text-xs ${textSecondary}`}>No lead activity recorded yet.</p>
                  ) : (
                    <div className="space-y-0">
                      {myTopPartners.map((p, i, arr) => {
                        const share = myLeads > 0 ? (Number(p.lead_count || 0) / myLeads) * 100 : 0;
                        return (
                          <div key={p.id} onClick={() => setActiveTab("my-cps")} className={`group cursor-pointer py-2.5 ${i !== arr.length - 1 ? `border-b ${isDark ? 'border-[#38383A]' : 'border-[#E5E5EA]'}` : ''}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`text-[10px] font-semibold w-2.5 ${textSecondary}`}>{i + 1}</span>
                                <div className="min-w-0">
                                  <p className="text-xs md:text-sm font-medium truncate">{p.name}</p>
                                  <p className={`text-[10px] md:text-xs truncate mt-0.5 ${textSecondary}`}>{p.company_name || "Independent"}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs md:text-sm font-semibold">{p.lead_count} <span className={`text-[9px] md:text-[10px] font-normal ${textSecondary}`}>leads</span></span>
                                <IoChevronForward size={12} className={textSecondary} />
                              </div>
                            </div>
                            <div className={`h-1 rounded-full overflow-hidden mt-2.5 ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`}>
                              <div className={`h-full rounded-full transition-all ${bgAccent}`} style={{ width: `${share}%` }} />
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
              MY CHANNEL PARTNERS
          ════════════════════════════════════════════════════ */}
          {activeTab === "my-cps" && (
            <div className="animate-fadeIn h-full flex flex-col">
              <AssignedChannelPartnersView
                isDark={isDark}
                t={{}}
                title="Channel Partners"
                subtitle="Your active network of channel partners"
                onNewEntry={() => setQuickAddOpen(true)}
                refreshKey={partnersVersion}
              />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              CP ENQUIRIES
          ════════════════════════════════════════════════════ */}
          {activeTab === "assigned-cps" && (
            <div className="animate-fadeIn h-full flex flex-col">
              <ChannelPartnerEnquiriesTable
                user={user}
                isDark={isDark}
                t={t}
                title="CP Enquiries"
                subtitle="Walk-in leads associated with your partners"
                showSerial
              />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              CP CHAT
          ════════════════════════════════════════════════════ */}
          {activeTab === "cp-chat" && (
            <div className="animate-fadeIn h-full flex flex-col">
              <CpChatPanel user={user} isDark={isDark} t={t} isAdmin={false} />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              SETTINGS
          ════════════════════════════════════════════════════ */}
          {activeTab === "settings" && (
            <div className="animate-fadeIn max-w-3xl mx-auto px-4 md:px-6 w-full">
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-6 mt-6">Settings</h1>

              <div className="space-y-4 md:space-y-6">
                <div className={`rounded-2xl p-5 ${bgCard}`}>
                  <h3 className="text-[10px] md:text-xs font-semibold tracking-wider mb-4 uppercase">Account Profile</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <p className={`text-[9px] md:text-[10px] font-medium mb-1 uppercase tracking-wide ${textSecondary}`}>Full Name</p>
                      <p className="text-sm md:text-base font-medium">{user?.name}</p>
                    </div>
                    <div>
                      <p className={`text-[9px] md:text-[10px] font-medium mb-1 uppercase tracking-wide ${textSecondary}`}>Email</p>
                      <p className="text-sm md:text-base font-medium">{user?.email || "—"}</p>
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl p-5 ${bgCard}`}>
                  <h3 className="text-[10px] md:text-xs font-semibold tracking-wider mb-4 uppercase">Communication</h3>
                  <WhatsAppSettingsCard user={user} setUser={setUser} isDark={isDark} t={{}} />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <ChannelPartnerFormModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onSaved={info => {
          fetchPartners();
          setPartnersVersion(v => v + 1);
        }}
        partner={null}
        user={user}
        isDark={isDark}
        t={{}}
        variant="office_visit"
      />
    </div>
  );
}