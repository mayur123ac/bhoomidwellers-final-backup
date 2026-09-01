//dashboard/page.tsx
"use client";

import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { useOrgName } from "@/lib/hooks/useOrgName";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaThLarge, FaClipboardList, FaUsers, FaIdCard,
  FaSearch, FaBell, FaChevronLeft, FaPhoneAlt, FaComments,
  FaCheckCircle, FaCalendarAlt, FaTimes, FaArrowLeft, FaChevronDown,
  FaFileInvoice, FaFileInvoiceDollar, FaPaperPlane, FaMicrophone, FaWhatsapp, FaTable, FaChartPie, FaEyeSlash, FaUniversity, FaHandshake, FaExchangeAlt, FaBriefcase, FaDownload, FaCog, FaMapMarkerAlt, FaSignal, FaUserClock, FaTrashAlt, FaBoxes, FaUserTie
} from "react-icons/fa";
import { BhoomiAiGlyph } from "@/components/bhoomi-ai/BhoomiAiIcon";
import { downloadCSV } from "@/lib/downloadCsv";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminMobileDrawer from "@/components/admin/AdminMobileDrawer";
import LoginTimerWidget from "@/components/LoginTimerWidget";
import AttendanceBadge from "@/components/AttendanceBadge";
import { useAttendance } from "@/components/AttendanceContext";
import BookingFormModal from "@/components/BookingFormModal";
import BookingApplicationView from "@/components/BookingApplicationView";
import ClosedLeadBookingView from "@/components/ClosedLeadBookingView";
import LostLeadModal from "@/components/LostLeadModal";
import CrmUpdatesNotification from "@/components/CrmUpdatesNotification";
import PermanentLeadDeleteDialog from "@/components/PermanentLeadDeleteDialog";
import BulkDeleteLeadsDialog from "@/components/BulkDeleteLeadsDialog";
import LoanDealView from "@/components/LoanDealView";
import ChannelPartnerListView from "@/components/ChannelPartnerListView";
import CpChatPanel from "@/components/CpChatPanel";
import ChannelPartnerEnquiriesTable from "@/components/ChannelPartnerEnquiriesTable";
import { canViewPartners } from "@/lib/cpRbac";
import UploadLeadSheet from "@/components/UploadLeadSheet";
import EnquiryOverviewSection from "@/components/Enquiryoverviewsection";
import InlineContactField from "@/components/InlineContactField";
import BolnaCallWidget from "@/components/BolnaCallWidget";
import CallingButtons from "@/components/CallingButtons";
import { contactFieldSave } from "@/lib/contactFieldSave";
// import ActivityTimeline from "@/components/ActivityTimeline";

import {
  handleMarkLostLead as markLostLeadApi,
  handleRestoreLead as restoreLeadApi,
  updateLeadLostState,
  updateLeadRestoreState,
  useLostLeadEvents,
} from "@/lib/lostLeadSync";
import dynamic from "next/dynamic";
import AttendanceView from "@/components/AttendanceView";
import AdminAssistantDock from "@/components/AdminAssistantDock";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";
import HeaderClock from "@/components/HeaderClock";
import AppHeader from "@/components/AppHeader";
import UserAvatar from "@/components/UserAvatar";
import { FiUser, FiHelpCircle, FiLogOut, FiChevronRight } from "react-icons/fi";
// The notification queue. Built and organization-scoped on the server — see
// lib/notifications/feed.ts for why it is no longer derived in this file.
import {
  useNotificationFeed,
  openNotificationLead,
  type CrmNotification,
} from "@/lib/hooks/useNotificationFeed";
import NotificationPopover from "@/components/notifications/NotificationPopover";
import NotificationCenterView from "@/components/notifications/NotificationCenterView";
import { Settings, Menu } from "lucide-react";

const RevenueIntelligenceView = dynamic(() => import("./RevenueIntelligenceView"), { ssr: false });
const GeoAnalyticsView = dynamic(() => import("./GeoAnalyticsView"), { ssr: false });
const LiveActivityView = dynamic(() => import("./LiveActivityView"), { ssr: false });
const SiteVisitOverview = dynamic(() => import("./SiteVisitOverview"), { ssr: false });

// PERF: recharts (~8 MB in node_modules) used to be a static import at the top of
// this file, so it sat in the admin route's initial JavaScript and was parsed
// before first paint even for users who never look at a chart. The three chart
// components now live in one module reached on demand. ssr: false because
// ResponsiveContainer measures the DOM and has nothing to measure on the server.
const DashboardAnalytics = dynamic(
  () => import("@/components/admin/AdminDashboardCharts").then(m => m.DashboardAnalytics),
  { ssr: false }
);
const ManagerWorkloadChart = dynamic(
  () => import("@/components/admin/AdminDashboardCharts").then(m => m.ManagerWorkloadChart),
  { ssr: false }
);
const SiteVisitsChart = dynamic(
  () => import("@/components/admin/AdminDashboardCharts").then(m => m.SiteVisitsChart),
  { ssr: false }
);

// PERF: same treatment, extended to the four heaviest view/overlay components on
// this route. Every one of them is already rendered behind a condition — an
// `activeView` match or an open-modal flag — so nothing about when they appear
// changes; they simply stop being downloaded and parsed before first paint by
// operators who never open them.
//
// This matters to the Channel Partner screens specifically. CP Management, CP
// Enquiries and CP Chat are `activeView` branches of THIS page, so the whole
// route bundle has to arrive and execute before any of them can draw their first
// row. Trimming it is the part of their load time that no amount of caching or
// memoisation inside those panels could reach.
//
// The CP panels themselves are deliberately NOT lazy: they are the destination,
// and putting a second network round trip between the sidebar click and the
// table would trade a smaller first load for a slower arrival at the thing the
// operator actually asked for.
const InventoryManagementView = dynamic(() => import("@/components/InventoryManagementView"), {
  ssr: false,
  // Holds the view's full height so the surrounding layout doesn't collapse and
  // re-expand while the chunk arrives. Deliberately theme-neutral: `loading`
  // receives no props, and a translucent slate reads correctly on both themes.
  loading: () => (
    <div className="flex-1 m-1 rounded-3xl animate-pulse bg-slate-500/10" aria-hidden />
  ),
});
const BhoomiAiPanel = dynamic(() => import("@/components/bhoomi-ai/BhoomiAiPanel"), { ssr: false });
const WhatsAppConversationPanel = dynamic(
  () => import("@/components/whatsapp/WhatsAppConversationPanel"),
  { ssr: false }
);
const LoanDealForm = dynamic(() => import("@/components/LoanDealForm"), { ssr: false });

// ─── SUN/MOON ICONS ───────────────────────────────────────────────────────────
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

// ─── THEME TOKEN BUILDER — MAGENTA ACCENT ────────────────────────
// ─── THEME TOKEN BUILDER — MAGENTA ACCENT ────────────────────────
function buildTheme(isDark: boolean) {
  return {
    pageWrap: isDark ? "bg-[#0A0A0F] text-white" : "text-[#1A1A1A]",
    mainBg: isDark ? "bg-[#121212]" : "bg-transparent",
    sidebar: "",
    header: isDark ? "bg-[#1a1a1a] border-b border-[#2a2a2a]" : "bg-white border-b border-[#9CA3AF]",
    headerGlass: isDark ? {} : { boxShadow: "0 1px 0 #9CA3AF, 0 4px 16px rgba(158,33,123,0.06)" },
    card: isDark
      ? "bg-[#1a1a1a] border border-[#2a2a2a] hover:border-[#9E217B]/50 hover:bg-[#1e1e1e]"
      : "bg-white border border-indigo-300 hover:border-[#9E217B]/40 hover:shadow-[0_0_16px_rgba(158,33,123,0.15)]",
    cardGlass: isDark
      ? {}
      : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.07), 0 12px 28px rgba(0,0,0,0.08)" },
    cardClosing: isDark ? "bg-yellow-900/10 border border-yellow-500/30 hover:border-yellow-400/60" : "bg-amber-50 border border-amber-200 hover:border-amber-400/60",
    tableWrap: isDark ? "bg-[#1a1a1a] border border-[#2a2a2a]" : "bg-white border border-indigo-300",
    tableGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },
    tableHead: isDark ? "bg-[#222]" : "bg-[#F1F5F9] border-b border-indigo-300",
    tableRow: isDark ? "hover:bg-[#252525]" : "hover:bg-[#F8FAFC] border-b border-indigo-200",
    tableDivide: isDark ? "divide-[#2a2a2a]" : "divide-[#E5E7EB]",
    tableBorder: isDark ? "border-b border-[#2a2a2a]" : "border-b border-[#D1D5DB]",
    tableBorder1: isDark ? "border-t border-[#2a2a2a]" : "border-t border-[#D1D5DB]",
    inputBg: isDark ? "bg-[#1a1a1a] border border-[#333]" : "bg-white border border-indigo-300",
    inputInner: isDark ? "bg-[#121212] border border-[#333]" : "bg-white border border-indigo-300",
    inputFocus: isDark ? "focus:border-[#9E217B]" : "focus:border-[#9E217B]",
    settingsBg: isDark ? "bg-[#222] border border-[#2a2a2a]" : "bg-[#F8FAFC] border border-indigo-300",
    settingsBgGl: isDark ? {} : { boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04)" },
    innerBlock: isDark ? "bg-[#121212] border border-[#333]" : "bg-white border border-indigo-200",
    modalCard: isDark ? "bg-[#1a1a1a] border border-[#2a2a2a]" : "bg-white border border-indigo-300",
    modalGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(158,33,123,0.08), 0 32px 72px rgba(0,0,0,0.16)" },
    modalInner: isDark ? "bg-[#121212] border border-[#333]" : "bg-[#F8FAFC] border border-indigo-300",
    modalHeader: isDark ? "bg-[#151515]" : "bg-[#F1F5F9]",
    dropdown: isDark ? "bg-[#1a1a1a] border border-[#2a2a2a]" : "bg-white border border-indigo-200",
    dropdownGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 20px rgba(158,33,123,0.08), 0 20px 40px rgba(0,0,0,0.10)" },
    dropdownItem: isDark ? "hover:bg-[#222] border-[#222]" : "hover:bg-[#F8FAFC] border-[#F0F0F0]",
    text: isDark ? "text-white" : "text-[#1A1A1A]",
    textMuted: isDark ? "text-gray-400" : "text-[#6B7280]",
    textFaint: isDark ? "text-gray-500" : "text-[#9CA3AF]",
    textHeader: isDark ? "text-xs text-gray-500 uppercase" : "text-xs text-[#6B7280] uppercase",
    navActive: isDark ? "bg-[#9E217B]/20 border-[#9E217B]/60 text-[#d946a8]" : "bg-[#2A2A2A] text-[#9E217B] border-transparent",
    navInactive: isDark ? "text-gray-500 hover:text-gray-300 hover:bg-white/5 border-transparent" : "text-[#9CA3AF] hover:bg-[#2A2A2A] hover:text-white border-transparent",
    navIndicator: isDark ? "bg-[#9E217B] shadow-[0_0_10px_2px_rgba(158,33,123,0.5)]" : "bg-[#9E217B] shadow-[0_0_8px_rgba(158,33,123,0.4)]",
    toggleWrap: isDark ? "bg-[#1C1C2A] border border-[#2A2A38] text-yellow-300" : "bg-white border border-indigo-200 text-[#9E217B]",
    chatArea: isDark ? "bg-[#0a0a0a]" : "bg-[#F8FAFC]",
    chatBubbleAi: isDark ? "bg-[#141414] border border-[#1f1f1f] text-gray-200" : "bg-white border border-[#E5E7EB] text-[#1A1A1A] shadow-sm",
    chatBubbleUser: isDark ? "bg-[#9E217B] text-white" : "bg-[#9E217B] text-white",
    chatInput: isDark ? "bg-[#111] border border-[#222] hover:border-[#333] focus-within:border-[#9E217B]/50" : "bg-white border-[#E5E7EB] hover:border-[#9CA3AF] focus-within:border-[#9E217B]/50",
    chatInputInner: isDark ? "bg-[#111] border border-[#222]" : "bg-white border-[#E5E7EB]",
    chatPanel: isDark ? "bg-[#1a1a1a] border border-[#333]" : "bg-white border-[#D1D5DB]",
    chatPanelGl: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },
    statGlow1: isDark ? "bg-[#9E217B]/10" : "bg-[#9E217B]/10",
    statGlow2: isDark ? "bg-[#d946a8]/10" : "bg-[#d946a8]/10",
    statGlow3: isDark ? "bg-blue-600/10" : "bg-indigo-400/10",
    statGlow4: isDark ? "bg-yellow-500/10" : "bg-amber-400/10",
    statGlow5: isDark ? "bg-green-600/10" : "bg-emerald-400/10",
    accentText: isDark ? "text-[#d946a8]" : "text-[#9E217B]",
    accentBg: isDark ? "bg-[#9E217B]/10 text-[#d946a8] border border-[#9E217B]/30" : "bg-[#9E217B]/10 text-[#9E217B] border border-[#9E217B]/30",
    sectionTitle: isDark ? "text-[#d946a8]" : "text-[#9E217B]",
    sectionBorder: isDark ? "border-[#9E217B]/20" : "border-[#9E217B]/25",
    btnPrimary: isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-md transition-colors duration-200" : "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-sm transition-colors duration-200",
    btnSecondary: isDark ? "bg-[#00AEEF] hover:bg-[#0088bb] text-white shadow-md transition-colors duration-200" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white shadow-sm transition-colors duration-200",
    btnDanger: isDark ? "bg-[#3B1F1F] text-[#F28B82] hover:bg-[#4f2a2a] border border-red-900/30 transition-colors duration-200" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B]/20 border border-[#9E217B]/30 transition-colors duration-200",
    btnWarning: isDark ? "bg-yellow-600 hover:bg-yellow-700 text-white shadow-md transition-colors duration-200" : "bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-colors duration-200",
    btnClosingBadge: isDark ? "bg-yellow-900/20 border border-yellow-500/40 text-yellow-400" : "bg-amber-50 border border-amber-400/60 text-amber-600",
    logoBg: isDark ? "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30" : "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30",
    chartColors: isDark
      ? ["#d946a8", "#e879b8", "#00AEEF", "#f97316", "#4ade80", "#fbbf24", "#60a5fa"]
      : ["#9E217B", "#00AEEF", "#0077b6", "#f97316", "#4ade80", "#fbbf24", "#d946a8"],
    visitPieColors: ["#9E217B", "#00AEEF", "#f97316", "#4ade80", "#fbbf24", "#e879b8", "#60a5fa", "#34d399"],
    tooltipBg: isDark ? "#1a1a1a" : "rgba(255,255,255,0.98)",
    tooltipColor: isDark ? "#fff" : "#1A1A1A",
    tooltipBorder: isDark ? "1px solid rgba(158,33,123,0.3)" : "1px solid #E5E7EB",
    tooltipShadow: isDark ? "0 8px 24px rgba(158, 33, 123, 0.35)" : "0_0_10px_rgba(236,72,153,0.6),0_0_20px_rgba(236,72,153,0.4)",
    legendColor: isDark ? "#9ca3af" : "#6B7280",
    fupDefault: isDark ? "bg-[#1f0a18] border border-[#9E217B]/30" : "bg-pink-50 border border-pink-200",
    fupLoan: isDark ? "bg-blue-900/20 border border-blue-600/40" : "bg-blue-50 border border-blue-200",
    fupSalesform: isDark ? "bg-[#222] border border-[#444]" : "bg-white border border-[#D1D5DB]",
    fupClosing: isDark ? "bg-yellow-900/20 border border-yellow-600/40" : "bg-amber-50 border border-amber-300",
    statusAssigned: isDark ? "text-purple-400 border border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50",
    statusNew: isDark ? "text-blue-400 border border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50",
    statusContacted: isDark ? "text-cyan-400 border border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50",
    statusInterested: isDark ? "text-green-400 border border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50",
    statusVisit: isDark ? "text-orange-400 border border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50",
    statusClosing: isDark ? "text-yellow-400 border border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50",
    statusCompleted: isDark ? "text-emerald-400 border border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50",
    statusLost: isDark ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-red-600 border-red-300 bg-red-50",
    select: isDark ? "bg-[#121212] border border-[#333] text-white focus:border-[#9E217B]" : "bg-white border border-indigo-300 text-[#1A1A1A] focus:border-[#9E217B]",
    selectSmall: isDark ? "bg-[#222] border border-[#333] text-white" : "bg-white border border-indigo-200 text-[#6B7280]",
    lostLeadBadge: isDark ? "bg-red-900/20 border border-red-500/30 text-red-400" : "bg-red-50 border border-red-300 text-red-600",
    lostLeadRow: isDark ? "opacity-50" : "opacity-50 bg-gray-50/50",
    statusNGD: "bg-[rgba(251,146,60,0.12)] text-[#F97316] border border-[rgba(249,115,22,0.4)]",
    cardLost: isDark ? "bg-[#171717] border border-red-900/25 opacity-70 grayscale saturate-50 hover:opacity-90 hover:border-red-500/30" : "bg-slate-100 border border-red-200 opacity-75 grayscale saturate-50 hover:opacity-90 hover:border-red-300",
    cardNGD: "bg-[rgba(249,115,22,0.06)] border border-[rgba(249,115,22,0.35)] hover:border-[#F97316] shadow-[0_4px_12px_rgba(249,115,22,0.12)] transition-all duration-300 flex flex-col h-full",
    rowLost: isDark ? "bg-[#151515]/80 text-gray-500 opacity-75 grayscale" : "bg-slate-100/80 text-slate-500 opacity-80 grayscale",
    rowNGD: "bg-[rgba(249,115,22,0.03)]",
    scroll: isDark ? "scrollbar-dark" : "scrollbar-light",
  };
}

// ============================================================================
// SHARED REAL-TIME DATA HOOK
// ============================================================================

/**
 * Sales-form field patterns, compiled once for the lifetime of the module.
 *
 * These were previously built with `new RegExp()` inside the per-lead merge, so
 * every refresh recompiled them once per field per lead — around 1.3 million
 * compilations at 100,000 leads. Regex construction is not free and none of
 * these patterns vary at runtime.
 */
const SALESFORM_FIELD_RE = new Map<string, RegExp>(
  [
    "Property Type", "Location", "Budget", "Use Type", "Planning to Purchase",
    "Decision Maker", "Loan Planned", "Lead Status",
  ].map((f) => [f, new RegExp(`• ${f}: (.*)`)])
);

/** Shared empty array so leads with no follow-ups don't each allocate one. */
const EMPTY_FUPS: any[] = [];

/**
 * Groups follow-ups by lead id.
 *
 * Four separate places in this file enriched leads by calling
 * `followUps.filter(f => String(f.leadId) === String(lead.id))` from inside a map
 * over every lead. Each of those is a full scan of the follow-up list per lead —
 * O(leads × follow-ups). Measured on 10,000 leads and 40,000 follow-ups, one such
 * pass took 5.8 seconds of blocked main thread; there were four.
 *
 * Building this index costs one linear pass and turns each lookup into O(1).
 * Call it once per memo, not once per lead.
 */
function indexFollowUpsByLead(followUps: any[] | null | undefined): Map<string, any[]> {
  const index = new Map<string, any[]>();
  for (const f of followUps || []) {
    const key = String(f.leadId);
    let bucket = index.get(key);
    if (!bucket) { bucket = []; index.set(key, bucket); }
    bucket.push(f);
  }
  return index;
}

/**
 * How often the admin dashboard re-polls everything.
 *
 * This was 5000 ms. A full refresh re-reads every lead AND every follow-up in the
 * database, so at 100,000 leads that was ~120 MB of JSON and ~1.8 s of database
 * time every five seconds, per open tab, forever — and the merge itself took
 * longer than the interval, so polls overlapped and the tab never caught up.
 *
 * 30 s plus the existing SSE channel (useLostLeadEvents) and the optimistic
 * applyLeadUpdate path keeps the screen current without the treadmill.
 */
const ADMIN_POLL_MS = 30_000;

function useAdminData() {
  const [managers, setManagers] = useState<any[]>([]);
  const [siteHeads, setSiteHeads] = useState<any[]>([]);
  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  // The same follow-ups keyed by lead id, built once per refresh and shared with
  // every child view. Several views independently ran
  // `followUps.filter(f => f.leadId === lead.id)` inside a map over all leads —
  // the same O(leads × follow-ups) scan, repeated per view. They can now do an
  // O(1) lookup against this instead.
  const [fupsByLead, setFupsByLead] = useState<Map<string, any[]>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  // Guards against overlapping polls. At scale one pass can take longer than the
  // poll interval, and without this the requests stack up: each new one adds DB
  // load and a fresh main-thread merge while the previous is still running, so
  // the dashboard gets progressively further behind and never recovers.
  const inFlight = useRef(false);

  const fetchAdminData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // These four are independent, so they go out together rather than in a
      // sequential await chain. Previously each waited for the one before it,
      // making page load the SUM of five round trips instead of the slowest one.
      const [resUsers, resSiteHeads, resRec, resLeads, resFups] = await Promise.all([
        fetch("/api/users/sales-manager"),
        fetch("/api/users/site-head"),
        fetch("/api/users/receptionist"),
        fetch("/api/walkin_enquiries?limit=10000&offset=0", { cache: "no-store" }),
        fetch("/api/followups"),
      ]);

      let smData: any[] = [];
      if (resUsers.ok) { const j = await resUsers.json(); smData = j.data || []; }

      let shData: any[] = [];
      if (resSiteHeads.ok) { const j = await resSiteHeads.json(); shData = j.data || []; }

      let recData: any[] = [];
      if (resRec.ok) { const j = await resRec.json(); recData = j.data || j; }
      else {
        const alt = await fetch("/api/users?role=receptionist");
        if (alt.ok) { const j = await alt.json(); recData = j.data || []; }
      }

      let pgLeads: any[] = [];
      if (resLeads.ok) {
        const j = await resLeads.json();
        pgLeads = Array.isArray(j.data) ? j.data : [];
      }

      let mongoFollowUps: any[] = [];
      if (resFups.ok) { const j = await resFups.json(); mongoFollowUps = Array.isArray(j.data) ? j.data : []; }

      // ── Index the follow-ups by lead once, up front ────────────────────────
      // This used to be `mongoFollowUps.filter(...)` INSIDE the per-lead map,
      // which is O(leads × follow-ups): at 10,000 leads and 40,000 follow-ups
      // that is 4×10^8 string comparisons on the main thread, measured at 5.8
      // SECONDS of frozen UI. Building a Map first makes it O(leads +
      // follow-ups) — the same work, measured at 20 ms. Output is identical.
      const fupsByLead = new Map<string, any[]>();
      for (const f of mongoFollowUps) {
        const key = String(f.leadId);
        let bucket = fupsByLead.get(key);
        if (!bucket) { bucket = []; fupsByLead.set(key, bucket); }
        bucket.push(f);
      }

      const mergedLeads = pgLeads.map((lead: any) => {
        const leadFups = fupsByLead.get(String(lead.id)) || EMPTY_FUPS;
        const salesForms = leadFups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
        const latestFormMsg = salesForms.length > 0 ? salesForms[salesForms.length - 1].message : "";

        // Memoised per lead. extractField is called up to 13 times per lead and
        // several fields (Budget, Use Type) are requested twice, so without this
        // the same message is re-scanned repeatedly. The regexes themselves come
        // from SALESFORM_FIELD_RE so they are compiled once per process rather
        // than once per call — `new RegExp` in a hot loop was ~1.3M compilations
        // per refresh at 100k leads.
        const fieldCache = new Map<string, string>();
        const extractField = (fieldName: string) => {
          if (!latestFormMsg) return "Pending";
          const hit = fieldCache.get(fieldName);
          if (hit !== undefined) return hit;
          const re = SALESFORM_FIELD_RE.get(fieldName) ?? new RegExp(`• ${fieldName}: (.*)`);
          const match = latestFormMsg.match(re);
          const val = match ? match[1].trim() : "Pending";
          fieldCache.set(fieldName, val);
          return val;
        };

        const loanUpdates = leadFups.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
        let loanStatus = "N/A", loanAmtReq = "N/A", loanAmtApp = "N/A", loanRequired = "Pending";
        if (loanUpdates.length > 0) {
          const lm = loanUpdates[loanUpdates.length - 1].message;
          const ms = lm.match(/• Status: (.*)/); if (ms) loanStatus = ms[1].trim();
          const mr = lm.match(/• Amount Requested: (.*)/); if (mr) loanAmtReq = mr[1].trim();
          const ma = lm.match(/• Amount Approved: (.*)/); if (ma) loanAmtApp = ma[1].trim();
          const mlr = lm.match(/• Loan Required: (.*)/); if (mlr) loanRequired = mlr[1].trim();
        }

        const fupsWithDate = leadFups.filter((f: any) => f.siteVisitDate && f.siteVisitDate.trim() !== "");
        const latestVisitDate = fupsWithDate.length > 0 ? fupsWithDate[fupsWithDate.length - 1].siteVisitDate : null;
        const closingFups = leadFups.filter((f: any) => f.message?.includes("✅ Lead Marked as Closing"));
        const reopenFups = leadFups.filter((f: any) => f.message?.includes("↩️ Lead Reopened"));
        const lastReopenAt = reopenFups.length > 0 ? new Date(reopenFups[reopenFups.length - 1].createdAt).getTime() : 0;
        const closingFupsSinceReopen = closingFups.filter((f: any) => new Date(f.createdAt).getTime() > lastReopenAt);
        const closingDate = closingFupsSinceReopen.length > 0 ? closingFupsSinceReopen[closingFupsSinceReopen.length - 1].createdAt : null;
        const activeBudget = extractField("Budget") !== "Pending" ? extractField("Budget") : lead.budget;


        const sfLoanPlanned = extractField("Loan Planned");
        const derivedLoanPlanned =
          sfLoanPlanned !== "Pending" ? sfLoanPlanned :
            loanRequired !== "Pending" ? loanRequired :
              (lead.loan_planned || "Pending");

        return {
          ...lead,
          propType: extractField("Property Type"),
          preferredLocation: extractField("Location"),
          salesBudget: activeBudget,
          useType: extractField("Use Type") !== "Pending" ? extractField("Use Type") : (lead.purpose || "Pending"),
          planningPurchase: extractField("Planning to Purchase"),
          decisionMaker: extractField("Decision Maker"),
          loanPlanned: derivedLoanPlanned,
          leadInterestStatus: extractField("Lead Status"),
          loanStatus, loanAmtReq, loanAmtApp, loanRequired,
          source: lead.source, sourceOther: lead.source_other,
          cpName: lead.cp_name, cpCompany: lead.cp_company, cpPhone: lead.cp_phone,
          // The resolved partner id, not just the free-text CP fields. Without it
          // the booking form cannot tell which partner to attribute commission to
          // and reports "no channel partner on record" even when there is one.
          channelPartnerId: lead.channel_partner_id,
          altPhone: lead.alt_phone, address: lead.address,
          mongoVisitDate: latestVisitDate,
          closingDate,
          status: lead.status === "Closing" || lead.status === "Closed" || !!closingDate
            ? (lead.status === "Closing" || lead.status === "Closed" ? lead.status : "Closing")
            : latestVisitDate ? "Visit Scheduled"
              : (lead.status === "Routed" || lead.status === "ROUTED" ? "Assigned" : lead.status),

        };
      });

      setManagers(smData);
      setSiteHeads(shData);
      setReceptionists(recData);
      setAllLeads(mergedLeads);
      setFollowUps(mongoFollowUps);
      setFupsByLead(fupsByLead);
      setIsLoading(false);
    } catch (e) { console.error("Admin data sync failed", e); }
    finally { inFlight.current = false; }
  }, []);

  const applyLeadUpdate = useCallback((updatedLead: any) => {
    setAllLeads(prev => updateLeadLostState(prev, updatedLead));
  }, []);

  useEffect(() => {
    fetchAdminData();
    // Background tabs are skipped outright. A dashboard left open on a second
    // monitor was previously issuing the same full-database refresh every five
    // seconds all day; nobody was looking at it, and it competed for the same
    // connection pool as the people actually working.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchAdminData();
    }, ADMIN_POLL_MS);
    // Refresh immediately on return to the tab, so pausing costs no freshness
    // at the moment it actually matters — when someone looks at it again.
    const onVisible = () => { if (!document.hidden) fetchAdminData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchAdminData]);

  useLostLeadEvents(applyLeadUpdate, fetchAdminData);

  return { managers, receptionists, siteHeads, allLeads, followUps, fupsByLead, isLoading, refetch: fetchAdminData };
}

// ============================================================================
// HELPER BADGES
// ============================================================================
function InterestBadge({ status, size = "md", isDark }: { status: string; size?: "sm" | "md"; isDark?: boolean }) {
  const colorMap: Record<string, string> = {
    "Interested": isDark ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-green-300 text-green-700 bg-green-50",
    "Not Interested": isDark ? "border-red-500/40 text-red-400 bg-red-500/10" : "border-red-300 text-red-700 bg-red-50",
    "NON GENUINE DEMAND (NGD)": isDark ? "border-orange-500/40 text-orange-400 bg-orange-500/10" : "border-orange-300 text-orange-700 bg-orange-50",
    "Non Qualified lead": isDark ? "border-orange-500/40 text-orange-400 bg-orange-500/10" : "border-orange-300 text-orange-700 bg-orange-50",
  };
  // Shorten long labels for compact display in the Enquiry Overview table
  const labelMap: Record<string, string> = {
    "NON GENUINE DEMAND (NGD)": "NGD",
    "Non Qualified lead": "NGD",
    "Non Qualified Lead": "NGD",
    "Non Qualified Leads": "NGD",
    "Non qualified Lead": "NGD",
  };
  const cls = colorMap[status] ?? (isDark ? "border-[#9E217B]/30 text-[#d946a8] bg-[#9E217B]/10" : "border-[#9E217B]/30 text-[#9E217B] bg-[#9E217B]/10");
  const sz = size === "sm" ? "text-[9px] px-2 py-0.5" : "text-[10px] px-3 py-1";
  const label = labelMap[status] ?? status;
  return (
    <span className={`px-2 py-0.5 rounded-4xl text-[9px] font-bold uppercase tracking-wider border inline-flex items-center justify-center gap-1 flex-shrink-0 leading-none ${cls}`}>
      {label}
    </span>
  );
}


function LoanStatusBadge({ status, isDark }: { status: string; isDark?: boolean }) {
  const s = (status || "").toLowerCase();
  if (!s || s === "n/a") return null;
  let cls = isDark ? "border-gray-500/30 text-gray-400 bg-gray-500/10" : "border-gray-300 text-gray-700 bg-gray-50";
  if (s === "approved") cls = isDark ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-green-300 text-green-700 bg-green-50";
  if (s === "rejected") cls = isDark ? "border-red-500/40 text-red-400 bg-red-500/10" : "border-red-300 text-red-700 bg-red-50";
  if (s === "in progress") cls = isDark ? "border-yellow-500/40 text-yellow-400 bg-yellow-500/10" : "border-yellow-300 text-yellow-700 bg-yellow-50";
  return (
    <span className={`px-2 py-0.5 rounded-4xl text-[9px] font-bold uppercase tracking-wider border flex items-center gap-1 flex-shrink-0 ${cls}`}>
      {status}
    </span>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const formatDate = (ds: string) => {
  if (!ds || ds === "Pending" || ds === "N/A" || ds === "Completed") return "-";
  try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ds; }
};
const formatLeadForExport = (l: any) => ({
  "Lead No.": l.sr_no || l.id,
  "Client Name": l.name,
  "Budget": l.salesBudget || l.budget || "N/A",
  "Configuration": l.propType || l.configuration || "N/A",
  "Purpose": l.useType || l.purpose || "N/A",
  "Phone": l.phone,
  "Alt Phone": l.altPhone || l.alt_phone || "N/A",
  "Source": l.source || "N/A",
  "Status": l.status || "Assigned",
  "Interest Level": l.leadInterestStatus || "N/A",
  "Loan Status": l.loanStatus || "N/A",
  "CP Name": l.cpName || l.cp_name || "N/A",
  "CP Phone": l.cpPhone || l.cp_phone || "N/A",
  "Site Visit Date": l.mongoVisitDate ? new Date(l.mongoVisitDate).toLocaleDateString("en-IN") : "N/A",
  "Assigned Manager": l.assigned_to || "Unassigned",
  "Assigned Date": l.assigned_at ? new Date(l.assigned_at).toLocaleString("en-IN") : "N/A",
  "First Contact Date": l.first_contact_at ? new Date(l.first_contact_at).toLocaleString("en-IN") : "N/A",
  "Last Activity Date": l.last_activity_at ? new Date(l.last_activity_at).toLocaleString("en-IN") : "N/A",
  "Site Visit History": Array.isArray(l.site_visit_history) ? l.site_visit_history.length : (l.site_visit_history || "N/A"),
  "Loan Tracking Info": typeof l.loan_tracking_info === "string" ? l.loan_tracking_info : JSON.stringify(l.loan_tracking_info || {}),
  "Assigned Receptionist": l.assigned_receptionist || "N/A",
  "Created At": l.created_at ? new Date(l.created_at).toLocaleDateString("en-IN") : "N/A",
});
const maskPhone = (phone: any, userRole: string = "admin", isOwner: boolean = true) => {
  if (!phone || phone === "N/A") return "N/A";
  const c = String(phone).replace(/[^a-zA-Z0-9]/g, "");
  if (c.length <= 5) return c;

  // 1. Full visibility for Admin OR if the user is the direct owner of the lead
  if (userRole === "admin" || isOwner) {
    return c;
  }
  // 2. Restricted visibility for Site Head viewing a global/shared lead
  if (userRole === "site_head" && !isOwner) {
    return `${c.slice(0, 2)}XXXXXX${c.slice(-2)}`;
  }
  // 3. Default fallback masking 
  return `${c.slice(0, 2)}*****${c.slice(-3)}`;
};
// ============================================================================
// MAIN LAYOUT SHELL
// ============================================================================
function AdminAtlasDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isMarkedPresent, timeIn } = useAttendance();
  const [activeView, setActiveView] = useState("dashboard");
  // Deep-link target for the Sales view. Two callers want different things once
  // the lead is open: the Inventory drawer wants its booking, a notification
  // wants the Lead Detail panel. `openBooking` is what tells them apart — this
  // used to be a bare lead id and every jump forced the booking view.
  const [invOpenLeadId, setInvOpenLeadId] =
    useState<{ id: number; openBooking?: boolean } | null>(null);
  /** Which tab the Notification Center opens on, set by the footer that sent us there. */
  const [notificationFilter, setNotificationFilter] =
    useState<"all" | "follow_up" | "site_visit" | "new_lead">("all");
  const [invLinkError, setInvLinkError] = useState<string | null>(null);

  // Inventory booking chips carry only a booking id, but every open-lead path in
  // the Sales view is keyed by lead. booking_applications.lead_id is NOT NULL, so
  // resolve it server-side and then reuse the existing lead deep-link.
  const openBookingFromInventory = async (bookingId: number) => {
    try {
      const res = await fetch(`/api/booking-applications/${bookingId}`, { credentials: "include" });
      const json = await res.json();
      const leadId = json?.success ? json?.data?.lead_id : null;
      if (!leadId) throw new Error(json?.message || "No lead linked to this booking");
      setInvOpenLeadId({ id: Number(leadId), openBooking: true });
      setActiveView("sales");
    } catch (err: any) {
      console.error("[inventory→booking deep-link]", err);
      setInvLinkError(`Could not open booking #${bookingId}: ${err?.message || "request failed"}`);
      setTimeout(() => setInvLinkError(null), 4000);
    }
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab) {
      setActiveView(tab === "revenue_pipeline" ? "revenue_intelligence" : tab);
    }
  }, [searchParams]);

  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  // Org name for the sidebar header. Fetched once; null while loading so the
  // sidebar cleanly omits the line instead of flashing stale data.
  const { name: orgName, loading: orgLoading } = useOrgName();
  const sidebarOrgName = orgLoading ? null : orgName;

  // Dismissals moved into useNotificationFeed, keyed by notification id so a
  // lead that raises both a New Lead and a Site Visit reminder can have one
  // dismissed without silencing the other.
  // PERF: this clock has exactly one reader — the `now` prop AttendanceView gets
  // on the "My Attendance" view. Ticking it unconditionally re-rendered this
  // entire component (and every panel it hosts: CP Management's 20-column table,
  // the CP Chat thread, Inventory) once a second, on every view, forever, to
  // update a widget that was not on screen. It now only ticks while the view
  // that reads it is open; the header's own clock is HeaderClock, which has
  // always owned its own tick.
  const [currentTime, setCurrentTime] = useState(new Date());
  const needsClock = activeView === "attendance";
  useEffect(() => {
    if (!needsClock) return;
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [needsClock]);
  const [user, setUser] = useState<any>({ name: "Admin", role: "Admin", email: "", password: "", org: "" });

  const [activePopup, setActivePopup] = useState<"notifications" | "profile" | "updates" | null>(null);
  const topbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (topbarRef.current && !topbarRef.current.contains(event.target as Node)) {
        setActivePopup(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [showPassword, setShowPassword] = useState(false);
  // The shared theme, from lib/theme.ts. One value for the whole CRM: the same
  // one Preferences → Theme writes and every other header toggle reads, so a
  // change anywhere repaints everywhere without a reload.
  const { isDark, toggleTheme } = useCrmTheme();

  // `leadId` is what makes a toast clickable: it is the lead the notification is
  // about, carried through from the server feed so the toast can open the same
  // Lead Detail panel the dropdown row does.
  type CrmNotif = { id: string; line1: string; line2: string; type: "lead" | "visit"; leadId?: number };

  const [notifQueue, setNotifQueue] = useState<CrmNotif[]>([]);
  const [activeNotif, setActiveNotif] = useState<CrmNotif | null>(null);
  const [notifCount, setNotifCount] = useState(0);
  const theme = useMemo(() => buildTheme(isDark), [isDark]);
  const { managers, receptionists, siteHeads, allLeads, followUps, isLoading, refetch } = useAdminData();

  // ── Helper to get accurate Creator Name & Role ──
  const getCreatorInfo = (lead: any) => {
    if (lead.assigned_receptionist) {
      return { name: lead.assigned_receptionist, role: "Receptionist" };
    }
    if (lead.assigned_to) {
      const isSiteHead = siteHeads.some((sh: any) => sh.name === lead.assigned_to);
      return { name: lead.assigned_to, role: isSiteHead ? "Site Head" : "Manager" };
    }
    return { name: "System", role: "Admin" };
  };

  // ── The notification queue ─────────────────────────────────────────────────
  // Built by the server, scoped to this session's organization in SQL. This
  // replaces a useMemo that re-derived the New Lead and Site Visit rules in the
  // browser from a full download of every lead — the same three rules three
  // other files also implemented, each with its own copy of the tenant
  // assumption. See lib/notifications/feed.ts.
  //
  // `notificationHistory` keeps its name so the popover below reads the same,
  // but it is now the server's list: New Leads and Site Visits, newest first.
  const notifications = useNotificationFeed();
  const notificationHistory = useMemo(
    () =>
      [...notifications.newLeads, ...notifications.siteVisits].sort(
        (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
      ),
    [notifications.newLeads, notifications.siteVisits]
  );

  // The shared notification components take their classes as props: this page
  // and /dashboard/sales each build their own theme object, and neither should
  // have to know about the other's token names.
  const notifPopoverTheme = useMemo(
    () => ({
      text: theme.text,
      textMuted: theme.textMuted,
      textFaint: theme.textMuted,
      border: theme.tableBorder,
      itemHover: isDark ? "hover:bg-white/5" : "hover:bg-black/5",
      footer: isDark
        ? "text-[#d946a8] hover:bg-[#9E217B]/10"
        : "text-[#9E217B] hover:bg-[#9E217B]/10",
    }),
    [theme, isDark]
  );

  const notifCenterTheme = useMemo(
    () => ({
      text: theme.text,
      textMuted: theme.textMuted,
      textFaint: theme.textMuted,
      border: theme.tableBorder,
      card: theme.dropdown,
      cardGlass: theme.dropdownGlass,
      itemHover: isDark ? "hover:bg-white/5" : "hover:bg-black/5",
      chipActive: isDark
        ? "bg-[#9E217B]/20 border-[#9E217B]/50 text-[#d946a8]"
        : "bg-[#9E217B]/10 border-[#9E217B]/40 text-[#9E217B]",
      chipIdle: isDark
        ? "border-[#333] text-gray-400 hover:border-[#9E217B]/40"
        : "border-[#E5E7EB] text-[#475569] hover:border-[#9E217B]/40",
    }),
    [theme, isDark]
  );
  // ── Load User & Fetch Live Password ──
  useEffect(() => {
    const cleanupBackGuard = installLoggedOutBackGuard(() => router.replace("/"));
    const parsedUser = getStoredCrmUser();
    if (parsedUser) {
      setUser(parsedUser);

      fetch(`/api/users/update-whatsapp?name=${encodeURIComponent(parsedUser.name)}`)
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setUser((prev: any) => ({ ...prev, whatsapp_number: data.whatsapp_number || "" }));
          }
        })
        .catch(() => { });

      // 👇 THIS IS THE MISSING CODE THAT GETS THE PASSWORD 👇
      const fetchLivePassword = async () => {
        try {
          const res = await fetch("/api/employees");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              const liveUser = data.find((u: any) => u.email === parsedUser.email);
              if (liveUser?.password) {
                setUser((prev: any) => ({ ...prev, password: liveUser.password, whatsapp_number: prev.whatsapp_number || liveUser.whatsapp_number || "" }));
              }
            }
          }
        } catch { }
      };
      fetchLivePassword();
    } else {
      router.replace("/");
    }
    const returnTab = localStorage.getItem("return_tab");
    if (returnTab) { setActiveView(returnTab === "revenue_pipeline" ? "revenue_intelligence" : returnTab); localStorage.removeItem("return_tab"); }
    return cleanupBackGuard;
  }, [router]);

  // ── Toast Notification Queue Populator ──
  //
  // Fed from the same server-built queue as the dropdown, so a toast and the
  // list behind it can no longer disagree about what arrived.
  //
  // The "already shown" set is namespaced by organization. It used to be one
  // flat `crm_shown_notif_ids` key: sign out of Bhoomi, sign in as Viraj on the
  // same machine, and Viraj's genuinely-new leads were silently suppressed
  // because Bhoomi's session had already used those lead ids. Ids are global
  // integers, so the collision was routine, not a corner case.
  useEffect(() => {
    if (!notifications.organizationId) return;
    if (notificationHistory.length === 0) return;

    const storageKey = `crm_shown_notif_ids:${notifications.organizationId}`;
    let storedIds: string[] = [];
    try {
      const item = localStorage.getItem(storageKey);
      storedIds = item ? JSON.parse(item) : [];
      if (!Array.isArray(storedIds)) storedIds = [];
    } catch { storedIds = []; }

    const seenSet = new Set(storedIds);
    const fresh: CrmNotif[] = [];

    for (const n of notificationHistory) {
      if (seenSet.has(n.id)) continue;
      fresh.push({
        id: n.id,
        line1: n.title,
        line2: n.subtitle,
        type: n.kind === "site_visit" ? "visit" : "lead",
        leadId: n.leadId,
      });
      seenSet.add(n.id);
    }

    if (fresh.length > 0) {
      setNotifQueue(prev => [...prev, ...fresh]);
      setNotifCount(c => c + fresh.length);
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(seenSet)));
      } catch { /* quota or private mode; the toast simply repeats */ }
    }
  }, [notificationHistory, notifications.organizationId]);

  // ── Trigger Popup Display (2 Seconds) ──
  useEffect(() => {
    if (activeNotif || notifQueue.length === 0) return;

    const nextNotif = notifQueue[0];
    setActiveNotif(nextNotif);
    setNotifQueue(prev => prev.slice(1));

    const timer = setTimeout(() => {
      setActiveNotif(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [activeNotif, notifQueue]);

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  /**
   * Open a notification's lead in the Lead Detail panel.
   *
   * The server is asked first, every time. It re-reads the organization from
   * the session and re-applies it, so a lead id that came from a stale tab, a
   * hand-made request or another tenant resolves to nothing and the panel does
   * not open. Only after that does the id go to AdminSalesView, which selects
   * the lead from its own organization-scoped list.
   *
   * Note what this is NOT: it does not route to the generic dashboard, and it
   * does not open a blank new-lead form. Both were the old behaviour — the
   * dropdown row had no click handler at all, and the sales-page equivalent
   * switched view without ever selecting a lead.
   */
  const openLeadFromNotification = useCallback(async (leadId?: number) => {
    setActivePopup(null);
    setActiveNotif(null);
    if (!leadId) return;
    const lead = await openNotificationLead(leadId);
    if (!lead) {
      console.warn("[notifications] lead is not available for this organization:", leadId);
      return;
    }
    // openBooking:false — a notification wants the lead, not the booking form.
    setInvOpenLeadId({ id: lead.id, openBooking: false });
    setActiveView("sales");
  }, []);

  const userRole = (user?.role || "").toLowerCase();
  const isAdmin = userRole === "admin";
  const isSiteHead = userRole === "site_head" || userRole === "site head";
  // Same gate InventoryManagementView uses for its manage actions.
  const isSalesManager = ["admin", "sales manager", "sales_manager"].includes(userRole.trim());

  const menuItems = [
    { id: "dashboard", icon: FaThLarge, label: "Overview" },
    { id: "revenue_intelligence", icon: FaFileInvoiceDollar, label: "Revenue Intelligence" },
    { id: "inventory", icon: FaBoxes, label: "Inventory" },
    { id: "channel_partners", icon: FaUserTie, label: "Channel Partners" },
    { id: "cp_management", icon: FaHandshake, label: "CP Management" },
    { id: "cp_chat", icon: FaComments, label: "CP Chat" },
    { id: "receptionist", icon: FaClipboardList, label: "Receptionist" },
    { id: "sales", icon: FaUsers, label: "Sales Managers" },
    { id: "site_head", icon: FaUniversity, label: "Site Heads" },
    { id: "live_activity", icon: FaSignal, label: "Attendance Tracker" },
    { id: "site_visit_overview", icon: FaCalendarAlt, label: "Site Visit Overview" },
    { id: "attendance", icon: FaUserClock, label: "My Attendance" },
    { id: "monitoring", icon: FaChartPie, label: "Daily Monitor" },
    { id: "geo", icon: FaMapMarkerAlt, label: "Geo Analytics" },
    { id: "caller", icon: FaPhoneAlt, label: "Caller Panel" },
    { id: "employees", icon: FaIdCard, label: "Add Employee" },
    // Lives on /dashboard/employees?tab=notifications, like Caller Panel and
    // Add Employee above it. It was present in the employees page's own copy of
    // this list and missing here, so the Admin rail gained and lost a WhatsApp
    // Alerts button depending on which route you happened to be on.
    { id: "notifications", icon: FaWhatsapp, label: "WhatsApp Alerts" },
    // `pinned` entries render in the rail's bottom block, in this order — so
    // Bhoomi AI keeps the place it has always had and Settings is the final
    // button. (This used to be position-based: the sidebar pinned whatever item
    // happened to be last, which made appending anything steal Bhoomi AI's slot.)
    { id: "ai", icon: BhoomiAiGlyph, label: "Bhoomi AI", pinned: true },
    { id: "settings", icon: FaCog, label: "Settings", pinned: true },

  ].filter(item => {
    if (isAdmin) return true;

    // Non-admin roles should only see what's allowed.
    // Admin only panels:
    if (item.id === "revenue_intelligence" || item.id === "geo") {
      return false;
    }

    // Channel Partners holds both business-profile data and commission rates.
    // Read access extends to Site Head; the rate column and the commission
    // drill-down stay behind canSeePartnerCommercials inside the view, and the
    // API strips the rate from the payload for roles that lack it.
    if (item.id === "channel_partners" && !canViewPartners(userRole)) {
      return false;
    }

    // CP Chat is the same conversation the Sourcing Manager sees. It carries
    // client names and follow-up notes, so it rides on the same read gate as
    // the partner registry; the API applies that gate independently.
    if (item.id === "cp_chat" && !canViewPartners(userRole)) {
      return false;
    }

    // CP Management is the assignment/reassignment console — Admin only, since
    // reassigning a Sourcing Manager is an Admin-exclusive right (Part 7).
    if (item.id === "cp_management" && !isAdmin) {
      return false;
    }

    if (isSiteHead && (item.id === "live_activity" || item.id === "settings" || item.id === "ai")) {
      return true;
    }

    // Site head cannot see caller, employees, notifications — all three live on
    // /dashboard/employees, which middleware puts on Site Head's forbidden list.
    // Offering a button that bounces straight back is worse than not offering it.



    // Other non-admin roles logic can be added here
    if (!isAdmin && (item.id === "caller" || item.id === "employees" || item.id === "notifications")) {
      return false;
    }


    return true;
  });

  // Headings shown above the first item of each run in the expanded rail.
  // The two pinned entries (Bhoomi AI, Settings) sit in the bottom block and
  // carry no heading.
  const menuGroups: Record<string, string> = {
    dashboard: "Workspace", revenue_intelligence: "Workspace", inventory: "Workspace", channel_partners: "Workspace",
    cp_management: "Workspace", cp_chat: "Workspace",
    receptionist: "Team", sales: "Team", site_head: "Team", live_activity: "Insights",
    site_visit_overview: "Insights", attendance: "Insights", monitoring: "Insights", geo: "Insights",
    caller: "Admin", employees: "Admin", notifications: "Admin"
  };

  // Bhoomi AI is a VIEW of this page, not a route.
  //
  // It used to be `router.push("/dashboard/employees?tab=ai")`, which worked for
  // an Admin and was a dead click for a Site Head: middleware.ts lists
  // /dashboard/employees among Site Head's forbidden paths and redirects them
  // straight back to /dashboard. The button appeared to do nothing at all,
  // because navigating away and being sent back is indistinguishable from not
  // navigating. Nothing was broken about the panel — it was never reached.
  //
  // Rendering it in place removes the round trip for everyone and removes the
  // dependency on a route Site Head is not allowed to load. The employees page
  // keeps its own `?tab=ai` section; this is simply no longer the way in.
  const handleMenuClick = (itemId: string) => {
    if (itemId === "employees") {
      router.push("/dashboard/employees");
    } else if (itemId === "caller") {
      router.push("/dashboard/employees?tab=callers");
    } else if (itemId === "notifications") {
      // Without this branch the id would fall through to setActiveView() and
      // this page would render nothing — there is no "notifications" view here.
      router.push("/dashboard/employees?tab=notifications");
    } else if (itemId === "settings") {
      router.push("/dashboard/settings");
    } else {
      setActiveView(itemId);
      setIsSidebarHovered(false);
    }
  };

  return (
    <div
      className={`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 ${theme.pageWrap}`}
      style={isDark ? {} : { background: "linear-gradient(135deg, #fdf0f8 0%, #f8fafc 30%, #faf0fb 62%, #f8fafc 78%, #fce8f6 100%)" }}
    >
      {/* ── SIDEBAR ──
          Shared with /dashboard/employees and the Settings panel so the rail
          cannot drift between the three routes. */}
      {/* Desktop rail only — mobile drawer is handled by AdminMobileDrawer below */}
      <AdminSidebar
        items={menuItems}
        activeId={activeView}
        groups={menuGroups}
        isHovered={isSidebarHovered}
        onHoverChange={setIsSidebarHovered}
        onSelect={(item) => { handleMenuClick(item.id); }}
        orgName={sidebarOrgName}
      />

      {/* Mobile drawer — slides from right, matches Sales Manager MobileNavDrawer */}
      <AdminMobileDrawer
        open={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        activeId={activeView}
        onSelect={(item) => { handleMenuClick(item.id); setIsMobileSidebarOpen(false); }}
        isDark={isDark}
        orgName={sidebarOrgName}
        userName={user?.name}
        userRole={user?.role}
        onToggleTheme={toggleTheme}
        isMarkedPresent={isMarkedPresent}
        timeIn={timeIn}
        onLogout={handleLogout}
        menuItems={menuItems}
        groups={menuGroups}
      />

      <style dangerouslySetInnerHTML={{
        __html: `
        .sidebar-scroll::-webkit-scrollbar{width:4px}
        .sidebar-scroll::-webkit-scrollbar-track{background:transparent}
        .sidebar-scroll::-webkit-scrollbar-thumb{background:rgba(217,70,168,0.25);border-radius:10px}
        .sidebar-scroll::-webkit-scrollbar-thumb:hover{background:rgba(217,70,168,0.5)}
      `}} />

      <div className={`flex-1 flex flex-col pl-0 md:pl-[72px] h-screen overflow-hidden ${theme.mainBg}`}>
        <AppHeader
          isDark={isDark}
          context={activeView.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          role={user?.role || "Admin"}
        >
          <div className="flex items-center gap-4 flex-shrink-0 relative z-[50]" ref={topbarRef}>
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

            {/* CRM System Updates */}
            <CrmUpdatesNotification user={user} theme={theme} isDark={isDark} isOpen={activePopup === "updates"} onToggle={() => setActivePopup(activePopup === "updates" ? null : "updates")} />

            <div className="relative">
              <div className="relative cursor-pointer" onClick={() => { setActivePopup(activePopup === "notifications" ? null : "notifications"); setNotifCount(0); }}>
                <FaBell className={`${theme.textMuted} hover:text-[#9E217B] transition-colors w-5 h-5`} />
                {notifCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#9E217B] rounded-full text-[9px] font-black text-white flex items-center justify-center">
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </div>

              <AnimatePresence>
                {activePopup === "notifications" && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`fixed right-4 top-14 md:absolute md:top-12 md:right-0 w-[320px] max-w-[calc(100vw-2rem)] border rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden ${theme.dropdown}`} style={theme.dropdownGlass}
                  >
                    {/* Three at most, newest first, and no internal scrollbar.
                        Clicking a row opens that lead's detail panel; the footer
                        opens the Notification Center with the whole queue. */}
                    <NotificationPopover
                      title="Recent Notifications"
                      caption="New leads and upcoming site visits"
                      items={notificationHistory}
                      footerNoun="notifications"
                      accent="green"
                      theme={notifPopoverTheme}
                      onOpenLead={(n) => openLeadFromNotification(n.leadId)}
                      onDismiss={(n) => notifications.dismiss(n.id)}
                      onSeeAll={() => {
                        setActivePopup(null);
                        setNotificationFilter("all");
                        setActiveView("notification_center");
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Profile icon — desktop only */}
            <div className="relative hidden md:block">
              <div onClick={() => setActivePopup(activePopup === "profile" ? null : "profile")}
                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer shadow-sm hover:opacity-80 transition-opacity border
                  ${isDark ? "border-[#9E217B]/40 text-[#d946a8] bg-[#9E217B]/15" : "border-[#9E217B]/40 text-[#9E217B] bg-[#9E217B]/10"}`}>
                <UserAvatar name={user?.name} fallback="A" alt="" />
              </div>
              <AnimatePresence>
                {activePopup === "profile" && (
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
                        {(user?.name || "Admin").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <p className={`font-semibold text-[14px] tracking-tight truncate leading-tight ${theme.text}`}>{user?.name || "Admin"}</p>
                        <p className={`text-[12px] truncate mt-[1px] ${theme.textMuted}`}>{user?.email || "admin@bhoomi.com"}</p>
                        <p className={`text-[12px] truncate ${theme.textMuted}`}>{orgName || "Bhoomi Dwellers"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mb-4">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${isDark ? "bg-[#9E217B]/10 text-[#d946a8] border-[#9E217B]/30" : "bg-purple-50 text-purple-800 border-purple-200"}`}>
                        {user?.role || "Admin"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                        <span className={`text-[12px] font-medium ${theme.textMuted}`}>Active</span>
                      </div>
                    </div>
                    <hr className={`-mx-4 border-0 border-t ${isDark ? "border-white/10" : "border-black/5"}`} />
                    <div className="flex flex-col py-1.5">
                      <button
                        onClick={() => { setActivePopup(null); router.push("/dashboard/settings/profile"); }}
                        className={`w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl transition-colors cursor-pointer group ${isDark ? "hover:bg-white/5" : "hover:bg-black/[0.04]"}`}
                      >
                        <div className={`flex items-center gap-2.5 ${theme.text}`}>
                          <FiUser className={`w-4 h-4 ${theme.textMuted}`} />
                          <span className="text-[13px] font-medium">Account Settings</span>
                        </div>
                        <FiChevronRight className={`w-3.5 h-3.5 ${theme.textMuted}`} />
                      </button>
                      <hr className={`border-0 border-t my-0.5 ${isDark ? "border-white/10" : "border-black/5"}`} />
                      <button
                        onClick={() => { setActivePopup(null); }}
                        className={`w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl transition-colors cursor-pointer group ${isDark ? "hover:bg-white/5" : "hover:bg-black/[0.04]"}`}
                      >
                        <div className={`flex items-center gap-2.5 ${theme.text}`}>
                          <FiHelpCircle className={`w-4 h-4 ${theme.textMuted}`} />
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

            {/* Hamburger — mobile only, last item to match Sales Manager layout */}
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className={`md:hidden h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0 rounded-full sm:rounded-lg border border-transparent sm:border flex items-center justify-center transition-colors duration-150 cursor-pointer ${isDark ? "bg-white/10 text-[#EBEBF5] sm:bg-[#1C1C2A] sm:border-[#2A2A38] sm:text-yellow-300 hover:bg-white/20" : "bg-black/5 text-[#3C3C43] sm:bg-[#F1F5F9] sm:border-[#9CA3AF] sm:text-[#1A1A1A] hover:bg-black/10"} sm:hover:bg-[inherit]`}
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {/* 👇 NEW: UPDATED POPUP TOAST WITH DYNAMIC ICONS 👇 */}
            {activeNotif && (
              <div className="absolute top-[68px] right-4 z-[999] animate-fadeIn">
                <div
                  role={activeNotif.leadId ? "button" : undefined}
                  tabIndex={activeNotif.leadId ? 0 : undefined}
                  // The toast opens the same Lead Detail panel as its dropdown
                  // row. It carries the lead id from the server feed, so this is
                  // the same authorized open — not a guess from the text.
                  onClick={activeNotif.leadId ? () => openLeadFromNotification(activeNotif.leadId) : undefined}
                  onKeyDown={activeNotif.leadId ? (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLeadFromNotification(activeNotif.leadId); }
                  } : undefined}
                  className={`flex items-start gap-3 px-4 py-3 sm:py-4 rounded-xl shadow-2xl border min-w-[280px] max-w-[360px] ${activeNotif.leadId ? "cursor-pointer" : ""}
                  ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-white border-[#E5E7EB]"}`}
                  style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>

                  {/* Dynamic Icon Box */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${activeNotif.type === "visit" ? "bg-orange-500" : "bg-[#25D366]"}`}>
                    {activeNotif.type === "visit" ? (
                      <FaCalendarAlt className="text-white text-lg" />
                    ) : (
                      <FaBriefcase className="text-white text-lg" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold truncate ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>{activeNotif.line1}</p>
                    <p className={`text-[11px] mt-0.5 truncate ${isDark ? "text-gray-400" : "text-[#6B7280]"}`}>{activeNotif.line2}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setActiveNotif(null); }} className={`flex-shrink-0 mt-0.5 p-0.5 rounded cursor-pointer transition-colors ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>
                    <FaTimes className="text-[10px]" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </AppHeader>

        <main className={`flex-1 overflow-hidden transition-colors duration-300 ${theme.mainBg}`}>
          {/* Bhoomi AI owns its own dark canvas and expects to fill the height it
              is given — `main` is already flex-1/overflow-hidden, so it needs no
              wrapper. The panel handles its own RBAC state: /api/admin/ai/chat
              answers a role it does not serve with a readable message, which the
              panel shows in place of the composer. */}
          {activeView === "ai" && <BhoomiAiPanel isDark={isDark} t={theme} user={user} />}
          {activeView === "dashboard" && <DashboardOverview refetch={refetch} managers={managers} siteHeads={siteHeads} allLeads={allLeads} isLoading={isLoading} user={user} theme={theme} isDark={isDark} receptionists={receptionists} followUps={followUps} onNavigateToSales={(lead: any) => {
            const isSiteHead = siteHeads.some((sh: any) => sh.name === lead.assigned_to);
            const isReceptionist = receptionists.some((r: any) => r.name === lead.assigned_receptionist);
            const targetTab = isSiteHead ? "site_head" : isReceptionist ? "receptionist" : "sales";
            localStorage.setItem("crm_drill_lead", JSON.stringify({ ...lead, _drillTab: targetTab }));
            setActiveView(targetTab);
          }} />}
          {activeView === "revenue_intelligence" && (
            isAdmin ? (
              <RevenueIntelligenceView isDark={isDark} theme={theme} />
            ) : (
              <div className="flex items-center justify-center h-full flex-col gap-2">
                <FaTimes className="text-red-500 w-16 h-16" />
                <h2 className="text-2xl font-bold text-red-500">Access Denied</h2>
                <p className={theme.textMuted}>You do not have permission to access this module.</p>
              </div>
            )
          )}
          {activeView === "inventory" && (
            <div className="flex flex-col h-full overflow-hidden p-2">
              <InventoryManagementView user={user} isDark={isDark} t={theme}
                onOpenLead={(leadId: number) => { setInvOpenLeadId({ id: leadId, openBooking: true }); setActiveView("sales"); }}
                onOpenBooking={openBookingFromInventory} />
            </div>
          )}
          {/* The Channel Partner conversation, rendered from the same component
              the Sourcing Manager panel uses and fed by the same organization-
              scoped endpoints — Admin reads the identical thread: visit cards,
              messages, customer updates and booking updates. */}
          {activeView === "cp_chat" && (
            canViewPartners(userRole) ? (
              <div className="h-full">
                <CpChatPanel user={user} isDark={isDark} t={theme} isAdmin />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full flex-col gap-2">
                <FaTimes className="text-red-500 w-16 h-16" />
                <h2 className="text-2xl font-bold text-red-500">Access Denied</h2>
                <p className={theme.textMuted}>You do not have permission to access this module.</p>
              </div>
            )
          )}
          {activeView === "cp_management" && (
            <div className="h-full">
              <ChannelPartnerEnquiriesTable
                user={user}
                isDark={isDark}
                t={theme}
                title="Channel Partner Management"
                subtitle="Every CP enquiry — filter by Sourcing Manager and reassign"
              />
            </div>
          )}
          {activeView === "channel_partners" && (
            canViewPartners(userRole) ? (
              // Permissions come from the role, not from this panel: Admin gets
              // edit + delete, Sales Manager keeps edit (and the commission
              // columns / rate queue), Site Head is read-only with no commercial
              // figures. The API applies the same gates independently.
              <ChannelPartnerListView user={user} isDark={isDark} t={theme} />
            ) : (
              <div className="flex items-center justify-center h-full flex-col gap-2">
                <FaTimes className="text-red-500 w-16 h-16" />
                <h2 className="text-2xl font-bold text-red-500">Access Denied</h2>
                <p className={theme.textMuted}>You do not have permission to access this module.</p>
              </div>
            )
          )}
          {activeView === "sales" && <AdminSalesView managers={managers} allLeads={allLeads} followUps={followUps} isLoading={isLoading} adminUser={user} refetch={refetch} theme={theme} isDark={isDark} openLeadId={invOpenLeadId} onOpenLeadHandled={() => setInvOpenLeadId(null)} />}
          {activeView === "site_head" && <AdminSiteHeadView siteHeads={siteHeads} allLeads={allLeads} followUps={followUps} isLoading={isLoading} adminUser={user} refetch={refetch} theme={theme} isDark={isDark} />}
          {activeView === "site_visit_overview" && <SiteVisitOverview managers={managers} receptionists={receptionists} allLeads={allLeads} siteHeads={siteHeads} adminUser={user} theme={theme} isDark={isDark} />}
          {activeView === "receptionist" && (
            <ReceptionistView
              receptionists={receptionists}
              allLeads={allLeads}
              followUps={followUps}
              isLoading={isLoading}
              refetch={refetch}
              adminUser={user}
              theme={theme}
              isDark={isDark}
            />
          )}
          {activeView === "attendance" && (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="p-4 md:p-8 overflow-y-auto">
                <AttendanceView adminUser={user} isDark={isDark} t={theme} now={currentTime.getTime()} />
              </div>
            </div>
          )}
          {/* The Notification Center: the COMPLETE queue the bell caps at three.
              The view id is "notification_center", not "notifications" — on this
              page "notifications" is already the rail's WhatsApp Alerts button,
              which navigates to /dashboard/employees?tab=notifications. Reusing
              it here would make the footer navigate away instead of opening the
              queue. (/dashboard/sales has no such clash and uses
              activeView = "notifications" as specified.) */}
          {activeView === "notification_center" && (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="p-4 md:p-8 overflow-y-auto">
                <NotificationCenterView
                  newLeads={notifications.newLeads}
                  siteVisits={notifications.siteVisits}
                  followUps={notifications.followUps}
                  isLoading={notifications.isLoading}
                  theme={notifCenterTheme}
                  initialFilter={notificationFilter}
                  onOpenLead={(n) => openLeadFromNotification(n.leadId)}
                  onDismiss={(n) => notifications.dismiss(n.id)}
                />
              </div>
            </div>
          )}
          {activeView === "live_activity" && (
            <div className="flex flex-col h-full overflow-hidden">
              {(isAdmin || isSiteHead) ? (
                <LiveActivityView theme={theme} isDark={isDark} />
              ) : (
                <div className="flex items-center justify-center h-full flex-col gap-2">
                  <FaTimes className="text-red-500 w-16 h-16" />
                  <h2 className="text-2xl font-bold text-red-500">Access Denied</h2>
                  <p className={theme.textMuted}>You do not have permission to access this module.</p>
                </div>
              )}
            </div>
          )}
          {activeView === "monitoring" && (
            <div className="flex-1 overflow-hidden h-full">
              <DailyMonitoringPanel
                theme={theme}
                isDark={isDark}
                allLeads={allLeads}
                adminUser={user}
              />
            </div>
          )}
          {activeView === "geo" && isAdmin && (
            <div className="flex flex-col h-full overflow-hidden">
              <GeoAnalyticsView allLeads={allLeads} theme={theme} isDark={isDark} />
            </div>
          )}
          {(isAdmin || isSiteHead) && <AdminAssistantDock theme={theme} isDark={isDark} />}
        </main>
      </div>

      {/* Inventory deep-link failure — a dead chip click is the exact bug this wiring fixes,
          so surface the reason instead of silently doing nothing. */}
      {invLinkError && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] px-3 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fadeIn bg-red-600 border border-red-500 text-white">
          <div className="text-lg"><FaTimes /></div>
          <span className="text-sm font-bold">{invLinkError}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DASHBOARD ANALYTICS
// ============================================================================

// ============================================================================
// DASHBOARD OVERVIEW
// ============================================================================

// Assumed imports based on the component's usage:
// import { DashboardAnalytics, TableSearchInput, InterestBadge } from "./your-components"; 
// import { downloadCSV, formatLeadForExport } from "./your-utils";

/**
 * The seven Quick Stats cards, as predicates.
 *
 * Defined once and used for BOTH the number printed on a card and the table
 * filter that card applies when clicked. Writing the condition twice — once in
 * the card, once in the filter — is how a card ends up reading "5 Closing" and
 * filtering to 4 rows, which reads as a data bug rather than a filter bug and is
 * miserable to trace. One definition means they cannot disagree.
 *
 * Each predicate is exactly the expression the card already used, moved here
 * unchanged — including the `|| "Assigned"` default and the two-field check for
 * Interested, which are load-bearing.
 */
export type StatCardFilter =
  | "all" | "active" | "closing" | "lost" | "assigned" | "contacted" | "interested";

const STAT_MATCHERS: Record<StatCardFilter, (l: any) => boolean> = {
  all: () => true,
  active: (l) => !l.is_lost_lead && l.status !== "Closing",
  closing: (l) => l.status === "Closing",
  lost: (l) => !!l.is_lost_lead,
  // A lead with no status is treated as Assigned, matching the card's original
  // `(l.status || "Assigned") === "Assigned"`.
  assigned: (l) => (l.status || "Assigned") === "Assigned",
  contacted: (l) => l.status === "Contacted",
  interested: (l) => l.status === "Interested" || l.leadInterestStatus === "Interested",
};

const STAT_LABELS: Record<StatCardFilter, string> = {
  all: "Total Leads",
  active: "Active Leads",
  closing: "Closing Leads",
  lost: "Lost / Ghosted",
  assigned: "Assigned",
  contacted: "Contacted",
  interested: "Interested",
};

function DashboardOverview({ managers, siteHeads, allLeads, isLoading, user, theme, isDark, receptionists, followUps, onNavigateToSales, refetch }: any) {
  const isAdmin = (user?.role || "").toLowerCase() === "admin";
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadLessRef = useRef<HTMLDivElement>(null);
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState("");
  const [reassignNote, setReassignNote] = useState("");
  const [isReassigning, setIsReassigning] = useState(false);
  const [reassignLead, setReassignLead] = useState<any>(null);
  const [combinedAssignees, setCombinedAssignees] = useState<any[]>([]);
  const [isFetchingManagers, setIsFetchingManagers] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deleteConfirmLead, setDeleteConfirmLead] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletedLeadIds, setDeletedLeadIds] = useState<Set<number | string>>(new Set());

  // ── Duplicate detection (phone-based) ──────────────────────────────────────
  const [duplicateIds, setDuplicateIds] = useState<Set<number>>(new Set());
  // leadId -> all leadIds in its duplicate group (for the tooltip)
  const [dupGroupByLeadId, setDupGroupByLeadId] = useState<Map<number, number[]>>(new Map());
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  useEffect(() => {
    fetch("/api/walkin_enquiries/duplicates")
      .then((r) => r.json())
      .then((data) => {
        if (!data?.success) return;
        setDuplicateIds(new Set((data.allDuplicateLeadIds || []).map((n: any) => Number(n))));
        const map = new Map<number, number[]>();
        for (const g of data.duplicateGroups || []) {
          const ids = (g.leadIds || []).map((n: any) => Number(n));
          for (const id of ids) map.set(id, ids);
        }
        setDupGroupByLeadId(map);
      })
      .catch(() => { });
  }, [allLeads.length]);

  // ── Bulk select + delete ───────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async (reason?: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      const res = await fetch("/api/walkin_enquiries/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, reason }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setBulkDeleteError(json.message || "Bulk delete failed.");
        return;
      }
      const deletedNow: number[] = ids.filter(
        (id) => !json.failed?.some((f: any) => Number(f.id) === id)
      );
      setDeletedLeadIds((prev) => new Set([...prev, ...deletedNow]));
      const failCount = json.failed?.length || 0;
      setToastMsg(
        `Deleted ${json.deleted} lead${json.deleted === 1 ? "" : "s"}.` +
        (failCount ? ` ${failCount} failed.` : "")
      );
      setTimeout(() => setToastMsg(null), 4000);
      setBulkDeleteOpen(false);
      exitSelectMode();
      refetch();
    } catch (e: any) {
      setBulkDeleteError(e.message ?? "Bulk delete failed.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ── Enhanced Reassign Logic ────────────────────────────────────────────────
  const handleReassignLead = async () => {
    if (!reassignLead || !reassignTarget || !reassignNote.trim()) return;

    // Prevent reassigning to the exact same manager
    if (reassignTarget === (reassignLead.assigned_to || reassignLead.assignedTo)) {
      alert("Please select a different manager.");
      return;
    }

    setIsReassigning(true);
    try {
      const res = await fetch("/api/leads/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: reassignLead.id,
          transfer_to: reassignTarget,
          transfer_note: `🔁 Reassigned by ${user?.name || "Admin"} — Reason: ${reassignNote}`,
          transferred_by: user?.name || "Admin",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Reassign failed");
      }

      setIsReassignModalOpen(false);
      setReassignNote("");
      setReassignTarget("");
      setToastMsg(`✅ Lead #${reassignLead.id} reassigned to ${reassignTarget}!`);
      setTimeout(() => setToastMsg(null), 3000);
      refetch();
    } catch (e: any) {
      alert(e.message ?? "Reassign failed. Try again.");
    } finally {
      setIsReassigning(false);
    }
  };

  const handleDeleteLead = async (reason?: string) => {
    if (!deleteConfirmLead) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/walkin_enquiries/${deleteConfirmLead.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE", reason }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setDeleteError(json.message || "Lead deletion failed. No data has been permanently removed.");
        return;
      }
      setToastMsg("Lead permanently deleted successfully.");
      setDeletedLeadIds(prev => new Set([...prev, deleteConfirmLead.id]));
      setTimeout(() => setToastMsg(null), 3000);
      setDeleteConfirmLead(null);
      refetch();
    } catch (e: any) {
      setDeleteError(e.message ?? "Lead deletion failed. No data has been permanently removed.");
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    Promise.all([fetch("/api/users/sales-manager"), fetch("/api/users/site-head")])
      .then(async ([sm, sh]) => {
        const a = sm.ok ? (await sm.json()).data || [] : [];
        const b = sh.ok ? (await sh.json()).data || [] : [];
        setCombinedAssignees([...a, ...b]);
      }).finally(() => setIsFetchingManagers(false));
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, allLeads.length));
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [allLeads.length]);

  useEffect(() => {
    setVisibleCount(20);
  }, [allLeads.length]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount > 20) {
          setVisibleCount(20);
        }
      },
      { threshold: 1.0 }
    );
    if (loadLessRef.current) observer.observe(loadLessRef.current);
    return () => observer.disconnect();
  }, [visibleCount, allLeads.length]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedManagerName, setSelectedManagerName] = useState("");

  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  useEffect(() => {
    if (!hasAutoSelected && managers?.length > 0 && !isLoading) {
      setSelectedManagerName(managers[0].name);
      setHasAutoSelected(true);
    }
  }, [managers, isLoading, hasAutoSelected]);

  const [perfMode, setPerfMode] = useState<"overall" | "manager" | "receptionist" | "site_head">("overall");
  const [selectedSiteHeadName, setSelectedSiteHeadName] = useState("");
  const [hasAutoSelectedSiteHead, setHasAutoSelectedSiteHead] = useState(false);

  useEffect(() => {
    if (!hasAutoSelectedSiteHead && siteHeads?.length > 0 && !isLoading) {
      setSelectedSiteHeadName(siteHeads[0].name);
      setHasAutoSelectedSiteHead(true);
    }
  }, [siteHeads, isLoading, hasAutoSelectedSiteHead]);

  const [selectedReceptionistName, setSelectedReceptionistName] = useState("");
  const [hasAutoSelectedRecep, setHasAutoSelectedRecep] = useState(false);

  // ── Search states — one per table, completely isolated ────────────────────
  const [overviewSearch, setOverviewSearch] = useState("");
  const [overviewSearchColumn, setOverviewSearchColumn] = useState<string>("all");
  const [managerLeadSearch, setManagerLeadSearch] = useState("");
  const [siteHeadLeadSearch, setSiteHeadLeadSearch] = useState("");
  const [recepLeadSearch, setRecepLeadSearch] = useState("");

  // Lost Lead filter states
  const [lostLeadFilter, setLostLeadFilter] = useState<"all" | "active" | "lost">("all");
  const [showLostLeads, setShowLostLeads] = useState(true);
  const [showNGDLeads, setShowNGDLeads] = useState(true);

  // ── Quick Stats card → table filter ───────────────────────────────────────
  const [statCardFilter, setStatCardFilter] = useState<StatCardFilter>("all");
  const overviewTableRef = useRef<HTMLDivElement>(null);

  /**
   * Apply a card's filter and bring the table into view.
   *
   * The other lost-lead controls are reset first, deliberately. Clicking
   * "Lost / Ghosted" while the toolbar's "show lost leads" toggle happened to be
   * off would otherwise filter to lost leads and then hide every one of them —
   * an empty table that looks broken. The card is an explicit instruction, so it
   * wins over whatever the toolbar was left on.
   *
   * Clicking the active card clears it, so the same click both applies and
   * undoes rather than needing a separate reset control.
   */
  const applyStatFilter = useCallback((id: StatCardFilter) => {
    // Computed from the rendered value rather than inside a setState updater:
    // updaters must be pure, and React invokes them twice under StrictMode, so
    // the sibling setState calls belong out here.
    const next: StatCardFilter = statCardFilter === id ? "all" : id;
    setStatCardFilter(next);
    setLostLeadFilter("all");
    setShowLostLeads(true);
    if (next === "lost") setShowNGDLeads(true);
    // After paint, so the table has rendered its new rows before we scroll to it.
    requestAnimationFrame(() => {
      overviewTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // statCardFilter is read above, so it must be a dependency — with an empty
    // array the closure would keep the initial "all" forever and clicking the
    // active card would never toggle it off.
  }, [statCardFilter]);

  // ── Reset search when switching perfMode ──────────────────────────────────
  useEffect(() => {
    setOverviewSearch("");
    setOverviewSearchColumn("all");
    setManagerLeadSearch("");
    setSiteHeadLeadSearch("");
    setRecepLeadSearch("");
  }, [perfMode]);

  /* ── Lead indexes, built once per allLeads change ─────────────────────────
     Everything below this point used to be a bare `allLeads.filter(...)` in the
     render body. There were roughly fifteen of them, plus two loops of the shape
     `people.map(p => allLeads.filter(...))` which are O(people × leads), plus
     seven more inside the stat-card map. None were memoised, so all of them
     re-ran on every render — and this component re-renders on every keystroke in
     the search box, because `overviewSearch` is its own state.

     Grouping by assignee once turns both O(people × leads) loops into O(leads),
     and memoising means a keystroke no longer re-runs any of it. The values are
     unchanged. */
  const leadsByAssignedTo = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const l of allLeads) {
      const key = String(l.assigned_to ?? "");
      let bucket = map.get(key);
      if (!bucket) { bucket = []; map.set(key, bucket); }
      bucket.push(l);
    }
    return map;
  }, [allLeads]);

  const leadsByReceptionist = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const l of allLeads) {
      const key = String(l.assigned_receptionist ?? "");
      let bucket = map.get(key);
      if (!bucket) { bucket = []; map.set(key, bucket); }
      bucket.push(l);
    }
    return map;
  }, [allLeads]);

  // ── Manager stats ──────────────────────────────────────────────────────────
  const managerStats = useMemo(() => managers.map((m: any) => {
    const mLeads = leadsByAssignedTo.get(String(m.name)) ?? EMPTY_FUPS;
    return {
      name: m.name,
      activeLeads: mLeads.length,
      siteVisits: mLeads.filter((l: any) => l.status === "Visit Scheduled" || !!l.mongoVisitDate).length,
    };
  }).sort((a: any, b: any) => b.activeLeads - a.activeLeads), [managers, leadsByAssignedTo]);

  useEffect(() => {
    if (!hasAutoSelectedRecep && receptionists?.length > 0 && !isLoading) {
      setSelectedReceptionistName(receptionists[0].name);
      setHasAutoSelectedRecep(true);
    }
  }, [receptionists, isLoading, hasAutoSelectedRecep]);

  const activeManagerLeads = useMemo(
    () => leadsByAssignedTo.get(String(selectedManagerName)) ?? EMPTY_FUPS,
    [leadsByAssignedTo, selectedManagerName]
  );
  const visitCount = useMemo(
    () => activeManagerLeads.filter((l: any) => l.status === "Visit Scheduled" || !!l.mongoVisitDate).length,
    [activeManagerLeads]
  );

  // ── Receptionist data ──────────────────────────────────────────────────────
  const recepAssignedLeads = useMemo(
    () => leadsByAssignedTo.get(String(selectedReceptionistName)) ?? EMPTY_FUPS,
    [leadsByAssignedTo, selectedReceptionistName]
  );
  const recepSelfLeads = useMemo(
    () => leadsByReceptionist.get(String(selectedReceptionistName)) ?? EMPTY_FUPS,
    [leadsByReceptionist, selectedReceptionistName]
  );
  const recepAllLeads = useMemo(
    () => [...new Map([...recepAssignedLeads, ...recepSelfLeads].map((l: any) => [l.id, l])).values()],
    [recepAssignedLeads, recepSelfLeads]
  );
  const recepClosed = useMemo(
    () => recepAllLeads.filter((l: any) => l.status === "Closing" || l.status === "Closed").length,
    [recepAllLeads]
  );

  const recepStats = useMemo(() => (receptionists || []).map((r: any) => {
    // Union of "assigned to them" and "they took it themselves", deduped by id —
    // the same set the old `l.assigned_to === r.name || l.assigned_receptionist
    // === r.name` predicate produced, but read from the two indexes instead of
    // scanning every lead once per receptionist.
    const rLeads = [
      ...(leadsByAssignedTo.get(String(r.name)) ?? EMPTY_FUPS),
      ...(leadsByReceptionist.get(String(r.name)) ?? EMPTY_FUPS),
    ];
    const unique = [...new Map(rLeads.map((l: any) => [l.id, l])).values()];
    return { name: r.name, activeLeads: unique.length, siteVisits: unique.filter((l: any) => !!l.mongoVisitDate).length };
  }).sort((a: any, b: any) => b.activeLeads - a.activeLeads), [receptionists, leadsByAssignedTo, leadsByReceptionist]);

  // ── Site Head data ─────────────────────────────────────────────────────────
  const activeSiteHeadLeads = useMemo(
    () => leadsByAssignedTo.get(String(selectedSiteHeadName)) ?? EMPTY_FUPS,
    [leadsByAssignedTo, selectedSiteHeadName]
  );
  const siteHeadVisitCount = useMemo(
    () => activeSiteHeadLeads.filter((l: any) => l.status === "Visit Scheduled" || !!l.mongoVisitDate).length,
    [activeSiteHeadLeads]
  );

  /* The seven stat-card counts, computed in ONE pass instead of seven.
     The cards used to call `allLeads.filter(STAT_MATCHERS[id]).length` inside a
     map over the card list, so every render walked the whole lead array seven
     times. */
  const statCounts = useMemo(() => {
    const counts = {} as Record<StatCardFilter, number>;
    for (const key of Object.keys(STAT_MATCHERS) as StatCardFilter[]) counts[key] = 0;
    for (const l of allLeads) {
      for (const key of Object.keys(STAT_MATCHERS) as StatCardFilter[]) {
        if (STAT_MATCHERS[key](l)) counts[key]++;
      }
    }
    return counts;
  }, [allLeads]);

  const lifecycleAssignedCount = statCounts.assigned;
  const lifecycleContactedCount = statCounts.contacted;
  const lifecycleInterestedCount = statCounts.interested;

  const pieData = useMemo(() => managerStats.filter((m: any) => m.siteVisits > 0), [managerStats]);
  const VISIT_COLORS = theme.visitPieColors;

  // ── Filter helper ──────────────────────────────────────────────────────────
  const filterLeads = (leads: any[], q: string, col: string = "all") => {
    if (!q.trim()) return leads;
    const lq = q.toLowerCase();

    const fieldValue = (l: any, field: string): string => {
      switch (field) {
        case "lead_no": return String(l.id || "");
        case "name": return String(l.name || "");
        case "prop_type": return String(l.propType || l.configuration || "");
        case "budget": return String(l.salesBudget || l.budget || "");
        case "source": return String(l.source || "");
        case "cp_name": return String(l.cpName || l.cp_name || "");
        case "cp_phone": return String(l.cpPhone || l.cp_phone || "");
        case "status": return String(l.status || "");
        case "interest": return String(l.leadInterestStatus || "");
        case "site_visit": return String(l.mongoVisitDate || "");
        case "assigned_to": return String(l.assigned_receptionist || l.assigned_to || "");
        default:
          return [
            l.id, l.name, l.phone, l.source, l.propType, l.configuration, l.salesBudget, l.budget,
            l.cpName, l.cp_name, l.cpPhone, l.cp_phone, l.status, l.leadInterestStatus,
            l.mongoVisitDate, l.assigned_receptionist, l.assigned_to
          ].map(v => String(v || "")).join(" ");
      }
    };

    if (col === "all") {
      return leads.filter((l: any) => fieldValue(l, "all").toLowerCase().includes(lq));
    }
    return leads.filter((l: any) => fieldValue(l, col).toLowerCase().includes(lq));
  };

  /* The search box is uncontrolled-feeling but still controlled: the input keeps
     updating on every keystroke, while the expensive filter below reads the
     DEFERRED value. React renders the typed character immediately and re-runs the
     filter at a lower priority, interrupting it if another key arrives first.

     Before this, every keystroke synchronously rebuilt a 17-field concatenated
     string for each lead — the "all" column case — and re-ran the whole filter
     chain before the character appeared on screen. */
  const deferredOverviewSearch = useDeferredValue(overviewSearch);

  const filteredOverviewLeads = useMemo(() => {
    const activeAllLeads = allLeads.filter((l: any) => !deletedLeadIds.has(l.id));
    let leads = filterLeads(activeAllLeads, deferredOverviewSearch, overviewSearchColumn);
    // Applied first, using the same predicate the card counted with — so the
    // number on the card and the row count below it always agree.
    if (statCardFilter !== "all") {
      leads = leads.filter(STAT_MATCHERS[statCardFilter]);
    }
    if (lostLeadFilter === "active") {
      leads = leads.filter((l: any) => !l.is_lost_lead);
    } else if (lostLeadFilter === "lost") {
      leads = leads.filter((l: any) => l.is_lost_lead);
    } else if (!showLostLeads) {
      leads = leads.filter((l: any) => !l.is_lost_lead);
    }
    if (!showNGDLeads) {
      leads = leads.filter((l: any) => {
        const isNGD = l.status === "NON GENUINE DEMAND (NGD)" || l.leadStatus === "NON GENUINE DEMAND (NGD)" || l.leadInterestStatus === "NON GENUINE DEMAND (NGD)" || l.leadInterestStatus === "Non Qualified Lead" || l.leadInterestStatus === "Non Qualified Leads" || l.leadInterestStatus === "Non qualified Lead";
        return !isNGD;
      });
    }
    if (showDuplicatesOnly) {
      leads = leads.filter((l: any) => duplicateIds.has(Number(l.id)));
    }
    // Sort numerically by sr_no descending so Lead No. order is always correct (#119, #118 ... #2, #1)
    leads = [...leads].sort((a: any, b: any) => (Number(b.sr_no) || 0) - (Number(a.sr_no) || 0));
    return leads;
  }, [allLeads, deferredOverviewSearch, overviewSearchColumn, lostLeadFilter, showLostLeads, showNGDLeads, deletedLeadIds, showDuplicatesOnly, duplicateIds, statCardFilter]);

  useEffect(() => {
    CRMContextManager.update({
      module: "Main Dashboard",
      metrics: {
        totalLeads: allLeads.length,
        activeLeads: allLeads.filter((l: any) => !l.is_lost_lead && l.status !== "Closing").length,
        closingLeads: allLeads.filter((l: any) => l.status === "Closing").length,
        lostLeads: allLeads.filter((l: any) => l.is_lost_lead).length,
      },
      filters: {
        search: overviewSearch,
        column: overviewSearchColumn,
        lostFilter: lostLeadFilter,
        showDuplicatesOnly,
        showNGDLeads
      },
      totalRows: filteredOverviewLeads.length,
      rows: filteredOverviewLeads.slice(0, 30).map((l: any) => ({
        id: l.id,
        name: l.name,
        status: l.status,
        manager: l.assigned_to,
        created: l.created_at,
        isLost: l.is_lost_lead
      })),
      selectedRow: null
    });
  }, [allLeads, overviewSearch, overviewSearchColumn, lostLeadFilter, showDuplicatesOnly, showNGDLeads, filteredOverviewLeads]);

  const formatDate = (ds: string) => {
    if (!ds) return "—";
    try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return ds; }
  };

  return (
    <div className={`h-full flex flex-col p-4 sm:p-6 lg:p-8 overflow-y-auto ${theme.scroll}`}>

      {/* ── Welcome banner ── */}
      <div className={`${theme.card} rounded-2xl sm:rounded-3xl p-5 sm:p-6 mb-6 lg:mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4`} style={theme.cardGlass}>
        <h2 className={`text-base sm:text-lg font-bold ${theme.text}`}>Welcome back, {user?.name || "Admin"}!</h2>
        <p className={`text-xs sm:text-sm ${theme.textMuted}`}>Here is what's happening with your team today.</p>
      </div>

      {/* ── Quick Stats ──
          Each card filters the Enquiry Overview table below to its own segment
          and scrolls to it. Counts come from STAT_MATCHERS, the same predicates
          the filter uses, so the number and the filtered rows always match. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2 sm:gap-3 mb-6 lg:mb-8">
        {([
          { id: "all", valueCls: theme.text },
          { id: "active", valueCls: isDark ? "text-green-400" : "text-emerald-600" },
          { id: "closing", valueCls: isDark ? "text-yellow-400" : "text-amber-500" },
          { id: "lost", valueCls: isDark ? "text-red-400" : "text-red-600" },
          { id: "assigned", valueCls: theme.accentText },
          { id: "contacted", valueCls: isDark ? "text-cyan-400" : "text-cyan-700" },
          { id: "interested", valueCls: isDark ? "text-green-400" : "text-emerald-600" },
        ] as Array<{ id: StatCardFilter; valueCls: string }>).map(({ id, valueCls }) => {
          const isActive = statCardFilter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => applyStatFilter(id)}
              aria-pressed={isActive}
              title={isActive
                ? `Showing ${STAT_LABELS[id]} — click again to clear`
                : `Filter the table to ${STAT_LABELS[id]}`}
              className={`${theme.card} rounded-2xl sm:rounded-3xl p-4 sm:p-5 text-left w-full transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-lg ${isActive ? "ring-2 ring-[#9E217B] ring-offset-1 ring-offset-transparent" : ""
                }`}
              style={theme.cardGlass}
            >
              <p className={`crm-eyebrow flex items-center justify-between gap-1 ${theme.textFaint}`}>
                <span className="truncate">{STAT_LABELS[id]}</span>
                {isActive && <FaTimes className="w-2.5 h-2.5 opacity-70 shrink-0" />}
              </p>
              <p className={`text-xl sm:text-2xl font-black mt-1.5 sm:mt-2 ${valueCls}`}>
                {statCounts[id as StatCardFilter]}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── Top performers + site visits ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-3 mb-6 lg:mb-8">
        <div className={`lg:col-span-2 ${theme.card} rounded-2xl sm:rounded-3xl p-5 sm:p-6 flex flex-col`} style={theme.cardGlass}>
          <h2 className={`text-base sm:text-lg font-bold mb-1 flex items-center gap-2 ${theme.text}`}>
            <FaChartPie className="text-[#9E217B]" /> Top Performers
          </h2>
          <p className={`text-xs mb-4 sm:mb-6 ${theme.textFaint}`}>Sales managers ranked by active leads.</p>
          <div className="flex-1 min-h-[250px] sm:min-h-[280px]">
            {isLoading
              ? <div className={`h-full flex items-center justify-center text-sm ${theme.textMuted}`}>Loading...</div>
              : managerStats.length === 0
                ? <div className={`h-full flex items-center justify-center text-sm ${theme.textMuted}`}>No data</div>
                : (
                  <ManagerWorkloadChart managerStats={managerStats} theme={theme} isDark={isDark} />
                )}
          </div>
        </div>

        <div className={`lg:col-span-1 ${theme.card} rounded-2xl sm:rounded-3xl p-5 sm:p-6 flex flex-col`} style={theme.cardGlass}>
          <h2 className={`text-base sm:text-lg font-bold mb-1 flex items-center gap-2 ${theme.text}`}>
            <FaCalendarAlt className="text-orange-500" /> Site Visits
          </h2>
          <p className={`text-xs mb-4 ${theme.textFaint}`}>Upcoming visits by manager.</p>
          <div className="flex-1 min-h-[240px]">
            {isLoading
              ? <div className={`h-full flex items-center justify-center text-sm ${theme.textMuted}`}>Loading...</div>
              : pieData.length === 0
                ? <div className={`h-full flex flex-col items-center justify-center text-sm ${theme.textMuted}`}><FaCalendarAlt className="text-2xl mb-3 opacity-20" />No visits scheduled</div>
                : (
                  <SiteVisitsChart pieData={pieData} theme={theme} visitColors={VISIT_COLORS} />
                )}
          </div>
        </div>
      </div>

      {/* ── Team Performance Card ── */}
      <div className={`${theme.card} rounded-2xl sm:rounded-3xl p-4 sm:p-6 mb-6 lg:mb-8`} style={theme.cardGlass}>
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-5">
          <div className="w-full lg:w-auto">
            <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${theme.text}`}>
              <FaTable className="text-[#9E217B] shrink-0" />
              <span className="truncate">{perfMode === "overall" ? "Team Performance" : "Individual Performance Table"}</span>
            </h2>
            <p className={`text-xs sm:text-sm mt-1 sm:mt-1.5 ${theme.textMuted}`}>
              {perfMode === "overall"
                ? "Viewing analytics and data for all logged in enquiries."
                : perfMode === "manager"
                  ? "Select a sales manager to view their real-time data."
                  : perfMode === "site_head"
                    ? "Select a site head to view their real-time data."
                    : "Select a receptionist to view their real-time data."}
            </p>
          </div>
          <div className="w-full lg:w-72 xl:w-80 relative shrink-0">
            <select
              value={perfMode}
              onChange={(e) => setPerfMode(e.target.value as any)}
              className={`w-full text-sm font-bold rounded-xl px-4 py-3 sm:py-3.5 outline-none cursor-pointer appearance-none border-2 transition-colors ${isDark ? "bg-[#14141B] border-[#9E217B]/40 text-[#d946a8]" : "bg-white border-[#9E217B]/40 text-[#9E217B]"}`}
            >
              <option value="overall">Overall Team Performance</option>
              <option value="manager">Sales Managers</option>
              <option value="site_head">Site Heads</option>
              <option value="receptionist">Receptionists</option>
            </select>
          </div>
        </div>

        {/* Selector dropdowns */}
        {perfMode === "manager" && (
          <div className="w-full sm:w-80 relative mb-4">
            <FaChevronLeft className={`absolute left-4 top-1/2 -translate-y-1/2 text-xs z-10 ${theme.textFaint}`} />
            <select value={selectedManagerName} onChange={e => { setSelectedManagerName(e.target.value); setManagerLeadSearch(""); }}
              className={`w-full text-sm font-bold rounded-xl pl-10 pr-4 py-3 sm:py-3.5 outline-none cursor-pointer appearance-none ${theme.select}`}>
              <option value="" disabled>-- Select Sales Manager --</option>
              {managers.map((m: any) => <option key={m.id || m._id || m.name} value={m.name}>{m.name}</option>)}
            </select>
          </div>
        )}
        {perfMode === "receptionist" && (
          <div className="w-full sm:w-80 relative mb-4">
            <FaChevronLeft className={`absolute left-4 top-1/2 -translate-y-1/2 text-xs z-10 ${theme.textFaint}`} />
            <select value={selectedReceptionistName} onChange={e => { setSelectedReceptionistName(e.target.value); setRecepLeadSearch(""); }}
              className={`w-full text-sm font-bold rounded-xl pl-10 pr-4 py-3 sm:py-3.5 outline-none cursor-pointer appearance-none ${theme.select}`}>
              <option value="" disabled>-- Select Receptionist --</option>
              {(receptionists || []).map((r: any) => <option key={r.id || r._id || r.name} value={r.name}>{r.name}</option>)}
            </select>
          </div>
        )}
        {perfMode === "site_head" && (
          <div className="w-full sm:w-80 relative mb-4">
            <FaChevronLeft className={`absolute left-4 top-1/2 -translate-y-1/2 text-xs z-10 ${theme.textFaint}`} />
            <select value={selectedSiteHeadName} onChange={e => { setSelectedSiteHeadName(e.target.value); setSiteHeadLeadSearch(""); }}
              className={`w-full text-sm font-bold rounded-xl pl-10 pr-4 py-3 sm:py-3.5 outline-none cursor-pointer appearance-none ${theme.select}`}>
              <option value="" disabled>-- Select Site Head --</option>
              {(siteHeads || []).map((sh: any) => <option key={sh.id || sh._id || sh.name} value={sh.name}>{sh.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════
          OVERALL MODE
      ════════════════════════════════════════════════ */}
      {/* Scroll target for the Quick Stats cards. scroll-mt keeps the heading
          clear of the sticky header rather than tucking under it. */}
      <div ref={overviewTableRef} className="scroll-mt-20 sm:scroll-mt-24" />

      {statCardFilter !== "all" && (
        <div className={`mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border px-4 py-3 ${isDark ? "border-[#9E217B]/40 bg-[#9E217B]/10" : "border-[#9E217B]/30 bg-[#9E217B]/5"
          }`}>
          <p className={`text-xs sm:text-sm font-bold ${theme.text}`}>
            Filtered to <span className="text-[#9E217B]">{STAT_LABELS[statCardFilter]}</span>
            <span className={`block sm:inline sm:ml-2 mt-1 sm:mt-0 font-medium ${theme.textMuted}`}>
              {filteredOverviewLeads.length} of {allLeads.length} leads
            </span>
          </p>
          <button
            type="button"
            onClick={() => setStatCardFilter("all")}
            className="w-full sm:w-auto text-[11px] sm:text-xs font-black px-4 py-2 sm:py-1.5 rounded-lg text-white bg-[#9E217B] hover:bg-[#8a1d6b] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <FaTimes className="w-2.5 h-2.5" /> Clear filter
          </button>
        </div>
      )}

      {perfMode === "overall" ? (
        <EnquiryOverviewSection
          allLeads={allLeads}
          filteredOverviewLeads={filteredOverviewLeads}
          isLoading={isLoading}
          theme={theme}
          isDark={isDark}
          isAdmin={isAdmin}
          siteHeads={siteHeads}
          lostLeadFilter={lostLeadFilter}
          setLostLeadFilter={setLostLeadFilter}
          showLostLeads={showLostLeads}
          setShowLostLeads={setShowLostLeads}
          duplicateIds={duplicateIds}
          dupGroupByLeadId={dupGroupByLeadId}
          showDuplicatesOnly={showDuplicatesOnly}
          setShowDuplicatesOnly={setShowDuplicatesOnly}
          overviewSearch={overviewSearch}
          setOverviewSearch={setOverviewSearch}
          overviewSearchColumn={overviewSearchColumn}
          setOverviewSearchColumn={setOverviewSearchColumn}
          selectMode={selectMode}
          setSelectMode={setSelectMode}
          exitSelectMode={exitSelectMode}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          toggleSelectOne={toggleSelectOne}
          onOpenBulkDelete={() => { setBulkDeleteError(null); setBulkDeleteOpen(true); }}
          onToast={setToastMsg}
          onDeleteLead={(lead) => { setDeleteError(null); setDeleteConfirmLead(lead); }}
          onReassign={(lead) => { setReassignLead(lead); setReassignTarget(""); setReassignNote(""); setIsReassignModalOpen(true); }}
          onNavigateToSales={onNavigateToSales}
          refetch={refetch}
          formatDate={formatDate}
          downloadCSV={downloadCSV}
          formatLeadForExport={formatLeadForExport}
          DashboardAnalytics={DashboardAnalytics}
          UploadLeadSheet={UploadLeadSheet}
          InterestBadge={InterestBadge}
        />
      ) : perfMode === "manager" && !selectedManagerName ? (
        <div className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl min-h-[250px] sm:min-h-[300px] p-6 text-center ${theme.textMuted} ${theme.tableBorder}`}>
          <FaTable className="text-3xl sm:text-4xl mb-3 sm:mb-4 opacity-20" />
          <p className="text-sm">Select a manager to view their table.</p>
        </div>

        /* ════════════════════════════════════════════════
            SITE HEAD MODE — no selection yet
        ════════════════════════════════════════════════ */
      ) : perfMode === "site_head" && !selectedSiteHeadName ? (
        <div className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl min-h-[250px] sm:min-h-[300px] p-6 text-center ${theme.textMuted} ${theme.tableBorder}`}>
          <FaTable className="text-3xl sm:text-4xl mb-3 sm:mb-4 opacity-20" />
          <p className="text-sm">Select a site head to view their table.</p>
        </div>

        /* ════════════════════════════════════════════════
            SITE HEAD MODE — selected
        ════════════════════════════════════════════════ */
      ) : perfMode === "site_head" ? (
        <div className="animate-fadeIn space-y-4 sm:space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Total Assigned</p>
              <p className={`text-xl sm:text-2xl font-black ${theme.text}`}>{activeSiteHeadLeads.length}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Site Visits</p>
              <p className="text-xl sm:text-2xl font-black text-orange-500">{siteHeadVisitCount}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Loans Active</p>
              <p className={`text-xl sm:text-2xl font-black ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
                {activeSiteHeadLeads.filter((l: any) => l.loanPlanned === "Yes").length}
              </p>
            </div>
          </div>

          {/* Analytics */}
          {activeSiteHeadLeads.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                <FaChartPie className="text-[#9E217B]" />
                <h3 className={`font-bold text-xs sm:text-sm uppercase tracking-wider truncate ${theme.text}`}>Lead Analytics — {selectedSiteHeadName}</h3>
                <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded border whitespace-nowrap ${theme.settingsBg} ${theme.textMuted}`}>{activeSiteHeadLeads.length} leads</span>
              </div>
              <DashboardAnalytics leads={activeSiteHeadLeads} theme={theme} isDark={isDark} />
            </div>
          )}

          {/* Table */}
          <div className={`${theme.tableWrap} rounded-xl overflow-hidden`} style={theme.tableGlass}>
            <div className={`p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${theme.tableHead}`}>
              <h3 className={`font-bold flex items-center gap-2 text-sm sm:text-base ${theme.text}`}>
                <FaUsers className="text-[#9E217B] shrink-0" /> <span className="truncate">Leads Database ({selectedSiteHeadName})</span>
              </h3>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                <div className="w-full sm:w-auto flex-1">
                  <TableSearchInput value={siteHeadLeadSearch} onChange={setSiteHeadLeadSearch} theme={theme} />
                </div>
                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <button
                    onClick={() => downloadCSV(activeSiteHeadLeads.map(formatLeadForExport), `${selectedSiteHeadName}_Leads.csv`)}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-bold border rounded-lg transition-colors hover:opacity-80 whitespace-nowrap ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
                  >
                    <FaDownload size={12} /> Export
                  </button>
                  <span className={`text-[10px] sm:text-xs px-3 py-1 rounded-full whitespace-nowrap ${theme.btnClosingBadge}`}>
                    {filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).length} leads
                  </span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto w-full">
              <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />
              <table className="w-full text-left text-sm min-w-[1200px]">
                <thead className={`text-[10px] sm:text-xs uppercase whitespace-nowrap ${theme.tableHead} ${theme.textHeader}`}>
                  <tr>
                    {["LEAD NO.", "NAME", "PROP. TYPE", "BUDGET", "SOURCE", "CP NAME", "CP PHONE", "STATUS", "INTEREST", "SITE VISIT", "DATE CREATED", "BACKDATED ENTRY", "ASSIGNED TO", "REASSIGN"].map(h => (
                      <th key={h} className="px-3 sm:px-4 py-2.5 sm:py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${theme.tableDivide}`}>
                  {isLoading ? (
                    <tr><td colSpan={14} className={`text-center py-8 text-xs sm:text-sm ${theme.textMuted}`}>Syncing...</td></tr>
                  ) : filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).length === 0 ? (
                    <tr><td colSpan={14} className={`text-center py-8 text-xs sm:text-sm ${theme.textMuted}`}>
                      {siteHeadLeadSearch ? "No leads match your search." : `No leads for ${selectedSiteHeadName}.`}
                    </td></tr>
                  ) : filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).slice(0, visibleCount).map((lead: any) => {
                    let assignedRole = "Site Head";
                    let assignedName = lead.assigned_receptionist || lead.assigned_to || "";
                    if (lead.assigned_receptionist) assignedRole = "Receptionist";
                    else if (siteHeads?.some((sh: any) => sh.name === lead.assigned_to)) assignedRole = "Site Head";
                    else if (lead.assigned_to) assignedRole = "Sales Manager";

                    return (
                      <tr key={lead.id} className={`transition-colors cursor-pointer ${theme.tableRow}`} onClick={() => onNavigateToSales && onNavigateToSales(lead)}>
                        <td className={`px-3 sm:px-4 py-3 sm:py-4.5 font-bold whitespace-nowrap ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-medium whitespace-nowrap min-w-[140px] ${theme.text}`}>
                          {(lead.assigned_to || lead.assigned_receptionist) ? (
                            <span
                              className={`cursor-pointer hover:underline transition-colors ${isDark ? "hover:text-[#d946a8]" : "hover:text-[#9E217B]"}`}
                              title={`Open lead detail for ${lead.name}`}
                              onClick={(e) => { e.stopPropagation(); onNavigateToSales && onNavigateToSales(lead); }}
                            >
                              {lead.name}
                            </span>
                          ) : (
                            lead.name
                          )}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap ${theme.textMuted}`}>{(lead.propType && lead.propType !== "Pending" && lead.propType !== "N/A" ? lead.propType : lead.configuration && lead.configuration !== "Pending" && lead.configuration !== "N/A" ? lead.configuration : "Pending")}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-semibold whitespace-nowrap ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget || "N/A"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap ${theme.textMuted}`}>{lead.source || "—"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap ${theme.textMuted}`}>{lead.cpName || lead.cp_name || "—"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-mono text-xs whitespace-nowrap ${theme.textMuted}`}>{lead.cpPhone || lead.cp_phone || "—"}</td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border flex-shrink-0 ${lead.status === "Closing" ? theme.statusClosing : lead.status === "Visit Scheduled" ? theme.statusVisit : theme.statusAssigned}`}>
                            {lead.status || "Assigned"}
                          </span>
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                          {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending"
                            ? <InterestBadge status={lead.leadInterestStatus} size="sm" isDark={isDark} />
                            : <span className={`text-xs italic ${theme.textFaint}`}>—</span>}
                        </td>
                        <td className="px-3 sm:px-4 py-3 sm:py-4.5 whitespace-nowrap">
                          {lead.mongoVisitDate
                            ? <span className="text-orange-500 font-medium">{formatDate(lead.mongoVisitDate).split(",")[0]}</span>
                            : <span className={`text-xs italic ${theme.textFaint}`}>Pending</span>}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap min-w-[120px] ${theme.textFaint}`}>
                          {lead.created_at ? formatDate(lead.created_at) : "—"}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap min-w-[120px] ${theme.textFaint}`}>
                          {lead.auto_date_enabled === false && lead.enquiry_date ? formatDate(lead.enquiry_date).split(",")[0] : "—"}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap min-w-[140px] ${theme.textMuted}`}>
                          {assignedName ? (
                            <div className="flex flex-col gap-0.5">
                              <span className={`font-semibold ${theme.text}`}>{assignedName}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border inline-block w-fit ${isDark ? "bg-[#222] border-[#333]" : "bg-gray-50 border-gray-200"}`}>
                                {assignedRole}
                              </span>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          {lead.status === "Closing" || lead.status === "Closed" || !!lead.closingDate ? (
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase border ${isDark ? "text-gray-400 border-gray-600 bg-gray-800/50" : "text-gray-500 border-gray-300 bg-gray-100"}`}>
                              Marked closed
                            </span>
                          ) : (
                            <button className={`text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer ${isDark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-700"}`}
                              onClick={e => { e.stopPropagation(); setReassignLead(lead); setReassignTarget(""); setReassignNote(""); setIsReassignModalOpen(true); }}>
                              <FaExchangeAlt /> Reassign
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {visibleCount < filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).length && (
                <div ref={loadMoreRef} className={`flex items-center justify-center gap-3 py-6 ${theme.textMuted}`}>
                  <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
                  <span className="text-xs font-medium">Loading more… ({visibleCount} of {filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).length})</span>
                </div>
              )}
              {visibleCount >= filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).length && activeSiteHeadLeads.length > 20 && (
                <div className={`text-center py-3 text-xs font-medium ${theme.textFaint}`}>
                  ✓ All {filterLeads(activeSiteHeadLeads, siteHeadLeadSearch).length} leads loaded
                </div>
              )}
            </div>
          </div>
        </div>

        /* ════════════════════════════════════════════════
            RECEPTIONIST MODE — no selection yet
        ════════════════════════════════════════════════ */
      ) : perfMode === "receptionist" && !selectedReceptionistName ? (
        <div className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl min-h-[250px] sm:min-h-[300px] p-6 text-center ${theme.textMuted} ${theme.tableBorder}`}>
          <FaTable className="text-3xl sm:text-4xl mb-3 sm:mb-4 opacity-20" />
          <p className="text-sm">Select a receptionist to view their table.</p>
        </div>

        /* ════════════════════════════════════════════════
            RECEPTIONIST MODE — selected
        ════════════════════════════════════════════════ */
      ) : perfMode === "receptionist" ? (
        <div className="animate-fadeIn space-y-4 sm:space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Total Leads</p>
              <p className={`text-xl sm:text-2xl font-black ${theme.text}`}>{recepAllLeads.length}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Assigned To</p>
              <p className="text-xl sm:text-2xl font-black text-[#00AEEF]">{recepAssignedLeads.length}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Self-Managed</p>
              <p className="text-xl sm:text-2xl font-black text-orange-500">{recepSelfLeads.length}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Closed</p>
              <p className={`text-xl sm:text-2xl font-black ${isDark ? "text-yellow-400" : "text-amber-500"}`}>{recepClosed}</p>
            </div>
          </div>

          {/* Analytics */}
          {recepAllLeads.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                <FaChartPie className="text-[#00AEEF]" />
                <h3 className={`font-bold text-xs sm:text-sm uppercase tracking-wider truncate ${theme.text}`}>Lead Analytics — {selectedReceptionistName}</h3>
                <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded border whitespace-nowrap ${theme.settingsBg} ${theme.textMuted}`}>{recepAllLeads.length} leads</span>
              </div>
              <DashboardAnalytics leads={recepAllLeads} theme={theme} isDark={isDark} />
            </div>
          )}

          {/* Table */}
          <div className={`${theme.tableWrap} rounded-xl overflow-hidden`} style={theme.tableGlass}>
            <div className={`p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${theme.tableHead}`}>
              <h3 className={`font-bold flex items-center gap-2 text-sm sm:text-base ${theme.text}`}>
                <FaClipboardList className="text-[#00AEEF] shrink-0" /> <span className="truncate">All Leads — {selectedReceptionistName}</span>
              </h3>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                <div className="w-full sm:w-auto flex-1">
                  <TableSearchInput value={recepLeadSearch} onChange={setRecepLeadSearch} theme={theme} />
                </div>
                <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 sm:gap-3">
                  <button
                    onClick={() => downloadCSV(recepAllLeads.map(formatLeadForExport), `${selectedReceptionistName}_Leads.csv`)}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-bold border rounded-lg transition-colors hover:opacity-80 whitespace-nowrap ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
                  >
                    <FaDownload size={12} /> Export
                  </button>
                  <span className={`text-[10px] sm:text-xs px-2 py-1 rounded border whitespace-nowrap ${theme.settingsBg} ${theme.textMuted}`}>
                    {recepAssignedLeads.length} assigned · {recepSelfLeads.length} self
                  </span>
                  <span className={`text-[10px] sm:text-xs px-3 py-1 rounded-full whitespace-nowrap ${theme.btnClosingBadge}`}>Live Sync </span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto w-full">
              <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />
              <table className="w-full text-left text-sm min-w-[1200px]">
                <thead className={`text-[10px] sm:text-xs uppercase whitespace-nowrap ${theme.tableHead} ${theme.textHeader}`}>
                  <tr>
                    {["LEAD NO.", "NAME", "PROP. TYPE", "BUDGET", "SOURCE", "CP NAME", "CP PHONE", "STATUS", "INTEREST", "SITE VISIT", "DATE CREATED", "BACKDATED ENTRY", "ASSIGNED TO", "REASSIGN"].map(h => (
                      <th key={h} className="px-3 sm:px-4 py-2.5 sm:py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${theme.tableDivide}`}>
                  {isLoading ? (
                    <tr><td colSpan={14} className={`text-center py-8 text-xs sm:text-sm ${theme.textMuted}`}>Syncing...</td></tr>
                  ) : filterLeads(recepAllLeads, recepLeadSearch).length === 0 ? (
                    <tr><td colSpan={14} className={`text-center py-8 text-xs sm:text-sm ${theme.textMuted}`}>
                      {recepLeadSearch ? "No leads match your search." : `No leads for ${selectedReceptionistName}.`}
                    </td></tr>
                  ) : filterLeads(recepAllLeads, recepLeadSearch).slice(0, visibleCount).map((lead: any) => {
                    let assignedRole = "Receptionist";
                    let assignedName = lead.assigned_receptionist || lead.assigned_to || "";
                    if (lead.assigned_receptionist) assignedRole = "Receptionist";
                    else if (siteHeads?.some((sh: any) => sh.name === lead.assigned_to)) assignedRole = "Site Head";
                    else if (lead.assigned_to) assignedRole = "Sales Manager";

                    return (
                      <tr key={lead.id} className={`transition-colors cursor-pointer ${theme.tableRow}`} onClick={() => onNavigateToSales && onNavigateToSales(lead)}>
                        <td className={`px-3 sm:px-4 py-3 sm:py-4.5 font-bold whitespace-nowrap ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-medium whitespace-nowrap min-w-[140px] ${theme.text}`}>
                          {(lead.assigned_to || lead.assigned_receptionist) ? (
                            <span
                              className={`cursor-pointer hover:underline transition-colors ${isDark ? "hover:text-[#d946a8]" : "hover:text-[#9E217B]"}`}
                              title={`Open lead detail for ${lead.name}`}
                              onClick={(e) => { e.stopPropagation(); onNavigateToSales && onNavigateToSales(lead); }}
                            >
                              {lead.name}
                            </span>
                          ) : (
                            lead.name
                          )}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap ${theme.textMuted}`}>{(lead.propType && lead.propType !== "Pending" && lead.propType !== "N/A" ? lead.propType : lead.configuration && lead.configuration !== "Pending" && lead.configuration !== "N/A" ? lead.configuration : "Pending")}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-semibold whitespace-nowrap ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget || "N/A"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap ${theme.textMuted}`}>{lead.source || "—"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap ${theme.textMuted}`}>{lead.cpName || lead.cp_name || "—"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-mono text-xs whitespace-nowrap ${theme.textMuted}`}>{lead.cpPhone || lead.cp_phone || "—"}</td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border flex-shrink-0 ${lead.status === "Closing" ? theme.statusClosing : lead.status === "Visit Scheduled" ? theme.statusVisit : theme.statusAssigned}`}>
                            {lead.status || "Assigned"}
                          </span>
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                          {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending"
                            ? <InterestBadge status={lead.leadInterestStatus} size="sm" isDark={isDark} />
                            : <span className={`text-xs italic ${theme.textFaint}`}>—</span>}
                        </td>
                        <td className="px-3 sm:px-4 py-3 sm:py-4.5 whitespace-nowrap">
                          {lead.mongoVisitDate
                            ? <span className="text-orange-500 font-medium">{formatDate(lead.mongoVisitDate).split(",")[0]}</span>
                            : <span className={`text-xs italic ${theme.textFaint}`}>Pending</span>}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap min-w-[120px] ${theme.textFaint}`}>
                          {lead.created_at ? formatDate(lead.created_at) : "—"}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap min-w-[120px] ${theme.textFaint}`}>
                          {lead.auto_date_enabled === false && lead.enquiry_date ? formatDate(lead.enquiry_date).split(",")[0] : "—"}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap min-w-[140px] ${theme.textMuted}`}>
                          {assignedName ? (
                            <div className="flex flex-col gap-0.5">
                              <span className={`font-semibold ${theme.text}`}>{assignedName}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border inline-block w-fit ${isDark ? "bg-[#222] border-[#333]" : "bg-gray-50 border-gray-200"}`}>
                                {assignedRole}
                              </span>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          {lead.status === "Closing" || lead.status === "Closed" || !!lead.closingDate ? (
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase border ${isDark ? "text-gray-400 border-gray-600 bg-gray-800/50" : "text-gray-500 border-gray-300 bg-gray-100"}`}>
                              Marked closed
                            </span>
                          ) : (
                            <button className={`text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer ${isDark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-700"}`}
                              onClick={e => { e.stopPropagation(); setReassignLead(lead); setReassignTarget(""); setReassignNote(""); setIsReassignModalOpen(true); }}>
                              <FaExchangeAlt /> Reassign
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {visibleCount < filterLeads(recepAllLeads, recepLeadSearch).length && (
                <div ref={loadMoreRef} className={`flex items-center justify-center gap-3 py-6 ${theme.textMuted}`}>
                  <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
                  <span className="text-xs font-medium">Loading more… ({visibleCount} of {filterLeads(recepAllLeads, recepLeadSearch).length})</span>
                </div>
              )}
              {visibleCount >= filterLeads(recepAllLeads, recepLeadSearch).length && recepAllLeads.length > 20 && (
                <div className={`text-center py-3 text-xs font-medium ${theme.textFaint}`}>
                  ✓ All {filterLeads(recepAllLeads, recepLeadSearch).length} leads loaded
                </div>
              )}
            </div>
          </div>
        </div>

        /* ════════════════════════════════════════════════
            MANAGER MODE — selected
        ════════════════════════════════════════════════ */
      ) : (
        <div className="animate-fadeIn space-y-4 sm:space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Total Assigned</p>
              <p className={`text-xl sm:text-2xl font-black ${theme.text}`}>{activeManagerLeads.length}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Site Visits</p>
              <p className="text-xl sm:text-2xl font-black text-orange-500">{visitCount}</p>
            </div>
            <div className={`${theme.innerBlock} rounded-xl p-4 sm:p-5`} style={theme.settingsBgGl}>
              <p className={`crm-eyebrow mb-1 ${theme.textMuted}`}>Loans Active</p>
              <p className={`text-xl sm:text-2xl font-black ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
                {activeManagerLeads.filter((l: any) => l.loanPlanned === "Yes").length}
              </p>
            </div>
          </div>

          {/* Analytics */}
          {activeManagerLeads.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                <FaChartPie className="text-[#9E217B]" />
                <h3 className={`font-bold text-xs sm:text-sm uppercase tracking-wider truncate ${theme.text}`}>Lead Analytics — {selectedManagerName}</h3>
                <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded border whitespace-nowrap ${theme.settingsBg} ${theme.textMuted}`}>{activeManagerLeads.length} leads</span>
              </div>
              <DashboardAnalytics leads={activeManagerLeads} theme={theme} isDark={isDark} />
            </div>
          )}

          {/* Table */}
          <div className={`${theme.tableWrap} rounded-xl overflow-hidden`} style={theme.tableGlass}>
            <div className={`p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${theme.tableHead}`}>
              <h3 className={`font-bold flex items-center gap-2 text-sm sm:text-base ${theme.text}`}>
                <FaUsers className="text-[#9E217B] shrink-0" /> <span className="truncate">Leads Database ({selectedManagerName})</span>
              </h3>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                <div className="w-full sm:w-auto flex-1">
                  <TableSearchInput value={managerLeadSearch} onChange={setManagerLeadSearch} theme={theme} />
                </div>
                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <button
                    onClick={() => downloadCSV(activeManagerLeads.map(formatLeadForExport), `${selectedManagerName}_Leads.csv`)}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-bold border rounded-lg transition-colors hover:opacity-80 whitespace-nowrap ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
                  >
                    <FaDownload size={12} /> Export
                  </button>
                  <span className={`text-[10px] sm:text-xs px-3 py-1 rounded-full whitespace-nowrap ${theme.btnClosingBadge}`}>
                    {filterLeads(activeManagerLeads, managerLeadSearch).length} leads
                  </span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto w-full">
              <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />
              <table className="w-full text-left text-sm min-w-[1200px]">
                <thead className={`text-[10px] sm:text-xs uppercase whitespace-nowrap ${theme.tableHead} ${theme.textHeader}`}>
                  <tr>
                    {["LEAD NO.", "NAME", "PROP. TYPE", "BUDGET", "SOURCE", "CP NAME", "CP PHONE", "STATUS", "INTEREST", "SITE VISIT", "DATE CREATED", "BACKDATED ENTRY", "ASSIGNED TO", "REASSIGN"].map(h => (
                      <th key={h} className="px-3 sm:px-4 py-2.5 sm:py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${theme.tableDivide}`}>
                  {isLoading ? (
                    <tr><td colSpan={14} className={`text-center py-8 text-xs sm:text-sm ${theme.textMuted}`}>Syncing...</td></tr>
                  ) : filterLeads(activeManagerLeads, managerLeadSearch).length === 0 ? (
                    <tr><td colSpan={14} className={`text-center py-8 text-xs sm:text-sm ${theme.textMuted}`}>
                      {managerLeadSearch ? "No leads match your search." : `No leads for ${selectedManagerName}.`}
                    </td></tr>
                  ) : filterLeads(activeManagerLeads, managerLeadSearch).slice(0, visibleCount).map((lead: any) => {
                    let assignedRole = "Sales Manager";
                    let assignedName = lead.assigned_receptionist || lead.assigned_to || "";
                    if (lead.assigned_receptionist) assignedRole = "Receptionist";
                    else if (siteHeads?.some((sh: any) => sh.name === lead.assigned_to)) assignedRole = "Site Head";
                    else if (lead.assigned_to) assignedRole = "Sales Manager";

                    return (
                      <tr key={lead.id} className={`transition-colors cursor-pointer ${theme.tableRow}`} onClick={() => onNavigateToSales && onNavigateToSales(lead)}>
                        <td className={`px-3 sm:px-4 py-3 sm:py-4.5 font-bold whitespace-nowrap ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-medium whitespace-nowrap min-w-[140px] ${theme.text}`}>
                          {(lead.assigned_to || lead.assigned_receptionist) ? (
                            <span
                              className={`cursor-pointer hover:underline transition-colors ${isDark ? "hover:text-[#d946a8]" : "hover:text-[#9E217B]"}`}
                              title={`Open lead detail for ${lead.name}`}
                              onClick={(e) => { e.stopPropagation(); onNavigateToSales && onNavigateToSales(lead); }}
                            >
                              {lead.name}
                            </span>
                          ) : (
                            lead.name
                          )}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap ${theme.textMuted}`}>{(lead.propType && lead.propType !== "Pending" && lead.propType !== "N/A" ? lead.propType : lead.configuration && lead.configuration !== "Pending" && lead.configuration !== "N/A" ? lead.configuration : "Pending")}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-semibold whitespace-nowrap ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget || "N/A"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap ${theme.textMuted}`}>{lead.source || "—"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap ${theme.textMuted}`}>{lead.cpName || lead.cp_name || "—"}</td>
                        <td className={`px-3 sm:px-4 py-2.5 font-mono text-xs whitespace-nowrap ${theme.textMuted}`}>{lead.cpPhone || lead.cp_phone || "—"}</td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border flex-shrink-0 ${lead.status === "Closing" ? theme.statusClosing : lead.status === "Visit Scheduled" ? theme.statusVisit : theme.statusAssigned}`}>
                            {lead.status || "Assigned"}
                          </span>
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                          {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending"
                            ? <InterestBadge status={lead.leadInterestStatus} size="sm" isDark={isDark} />
                            : <span className={`text-xs italic ${theme.textFaint}`}>—</span>}
                        </td>
                        <td className="px-3 sm:px-4 py-3 sm:py-4.5 whitespace-nowrap">
                          {lead.mongoVisitDate
                            ? <span className="text-orange-500 font-medium">{formatDate(lead.mongoVisitDate).split(",")[0]}</span>
                            : <span className={`text-xs italic ${theme.textFaint}`}>Pending</span>}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap min-w-[120px] ${theme.textFaint}`}>
                          {lead.created_at ? formatDate(lead.created_at) : "—"}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 text-xs whitespace-nowrap min-w-[120px] ${theme.textFaint}`}>
                          {lead.auto_date_enabled === false && lead.enquiry_date ? formatDate(lead.enquiry_date).split(",")[0] : "—"}
                        </td>
                        <td className={`px-3 sm:px-4 py-2.5 whitespace-nowrap min-w-[140px] ${theme.textMuted}`}>
                          {assignedName ? (
                            <div className="flex flex-col gap-0.5">
                              <span className={`font-semibold ${theme.text}`}>{assignedName}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border inline-block w-fit ${isDark ? "bg-[#222] border-[#333]" : "bg-gray-50 border-gray-200"}`}>
                                {assignedRole}
                              </span>
                            </div>
                          ) : "—"}
                        </td>
                        <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          {lead.status === "Closing" || lead.status === "Closed" || !!lead.closingDate ? (
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase border ${isDark ? "text-gray-400 border-gray-600 bg-gray-800/50" : "text-gray-500 border-gray-300 bg-gray-100"}`}>
                              Marked closed
                            </span>
                          ) : (
                            <button className={`text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer ${isDark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-700"}`}
                              onClick={e => { e.stopPropagation(); setReassignLead(lead); setReassignTarget(""); setReassignNote(""); setIsReassignModalOpen(true); }}>
                              <FaExchangeAlt /> Reassign
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {visibleCount < filterLeads(activeManagerLeads, managerLeadSearch).length && (
                <div ref={loadMoreRef} className={`flex items-center justify-center gap-3 py-6 ${theme.textMuted}`}>
                  <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
                  <span className="text-xs font-medium">Loading more… ({visibleCount} of {filterLeads(activeManagerLeads, managerLeadSearch).length})</span>
                </div>
              )}
              {visibleCount >= filterLeads(activeManagerLeads, managerLeadSearch).length && activeManagerLeads.length > 20 && (
                <div className={`text-center py-3 text-xs font-medium ${theme.textFaint}`}>
                  ✓ All {filterLeads(activeManagerLeads, managerLeadSearch).length} leads loaded
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div className={`fixed top-4 sm:top-6 left-1/2 transform -translate-x-1/2 z-[100] px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fadeIn bg-[#9E217B] border-[#b8268f] text-white w-[90%] sm:w-auto max-w-sm`}>
          <div className="text-lg shrink-0"><FaCheckCircle /></div>
          <span className="text-sm font-bold truncate">{toastMsg}</span>
        </div>
      )}

      {isReassignModalOpen && reassignLead && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-4 sm:p-5 lg:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-2xl sm:rounded-xl w-full max-w-lg shadow-2xl border overflow-hidden flex flex-col max-h-[90vh] ${theme.modalCard}`} style={theme.modalGlass}>
            <div className={`p-4 sm:p-5 border-b flex justify-between items-center shrink-0 ${isDark ? "bg-orange-900/20 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
              <div className="min-w-0 pr-4">
                <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 truncate ${isDark ? "text-orange-400" : "text-orange-700"}`}><FaExchangeAlt className="shrink-0" /> Re-assign Lead #{reassignLead.id}</h2>
                <p className={`text-xs mt-1 truncate ${theme.textMuted}`}>Currently assigned to: <strong>{reassignLead.assigned_to || reassignLead.assignedTo || "Unassigned"}</strong></p>
              </div>
              <button onClick={() => { setIsReassignModalOpen(false); setReassignNote(""); setReassignTarget(""); }} className={`p-2 shrink-0 ${theme.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
            </div>
            <div className={`p-4 sm:p-6 overflow-y-auto ${theme.modalInner}`}>
              <div className="mb-4 sm:mb-5">
                <label className={`block text-xs sm:text-sm font-bold mb-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>Assign to *</label>
                <select required value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}
                  className={`w-full rounded-xl p-3.5 sm:p-4 text-sm outline-none transition-colors border-2 cursor-pointer ${isDark ? "bg-[#14141B] border-orange-500/40 text-white" : "bg-white border-orange-300 text-[#1A1A1A]"}`}>
                  <option value="" disabled>-- Select Manager --</option>
                  {isFetchingManagers ? <option disabled>Loading managers…</option> : combinedAssignees.filter((m: any) => m.name !== (reassignLead.assigned_to || reassignLead.assignedTo)).length > 0 ? combinedAssignees.filter((m: any) => m.name !== (reassignLead.assigned_to || reassignLead.assignedTo)).map((m: any, i: number) => (
                    <option key={i} value={m.name}>{m.name} ({String(m.role || "Sales Manager").replace("_", " ")})</option>
                  )) : <option disabled>No other assignees available</option>}
                </select>
              </div>
              <div>
                <label className={`block text-xs sm:text-sm font-bold mb-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>Reason for Re-assign * (min 10 chars)</label>
                <textarea required value={reassignNote} onChange={e => setReassignNote(e.target.value)} rows={4}
                  placeholder="e.g. Wrong manager was selected initially."
                  className={`w-full rounded-xl px-4 py-3 sm:py-4 text-sm outline-none resize-none border-2 transition-colors ${isDark ? "bg-[#14141B] border-orange-500/30 text-white focus:border-orange-500" : "bg-white border-orange-200 text-[#1A1A1A] focus:border-orange-500"}`} />
                {reassignNote.length > 0 && reassignNote.length < 10 && <p className="text-xs text-amber-500 mt-1">⚠ Min 10 characters required.</p>}
              </div>
            </div>
            <div className={`p-4 sm:p-5 border-t flex flex-col-reverse sm:flex-row justify-end gap-3 shrink-0 ${theme.modalHeader} ${theme.tableBorder}`}>
              <button onClick={() => { setIsReassignModalOpen(false); setReassignNote(""); setReassignTarget(""); }}
                className={`w-full sm:w-auto px-4 py-3 sm:py-3 rounded-lg font-bold cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500 bg-gray-100 dark:bg-gray-800 sm:bg-transparent`}>Cancel</button>
              <button onClick={handleReassignLead} disabled={isReassigning || !reassignTarget || !reassignNote.trim()}
                className={`w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${isReassigning || !reassignTarget || !reassignNote.trim() ? "opacity-50 cursor-not-allowed bg-orange-400 text-white" : "cursor-pointer bg-orange-500 hover:bg-orange-400 text-white shadow-lg shadow-orange-500/20"}`}>
                {isReassigning ? "Reassigning…" : <><FaExchangeAlt /> Confirm Re-assign</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION MODAL ── */}
      {false && deleteConfirmLead && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-4 sm:p-5 lg:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-2xl sm:rounded-xl w-full max-w-md shadow-2xl border overflow-hidden flex flex-col max-h-[90vh] ${theme.modalCard}`} style={theme.modalGlass}>
            <div className={`p-4 sm:p-5 border-b flex justify-between items-center shrink-0 ${isDark ? "bg-red-900/20 border-red-500/20" : "bg-red-50 border-red-200"}`}>
              <div className="min-w-0 pr-4">
                <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 truncate ${isDark ? "text-red-400" : "text-red-700"}`}>
                  <FaTrashAlt className="shrink-0" /> Delete Lead #{deleteConfirmLead.id}
                </h2>
                <p className={`text-xs mt-1 truncate ${theme.textMuted}`}>This action is permanent and cannot be undone.</p>
              </div>
              <button onClick={() => setDeleteConfirmLead(null)} className={`p-2 shrink-0 ${theme.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
            </div>
            <div className={`p-4 sm:p-6 overflow-y-auto ${theme.modalInner}`}>
              <p className={`text-sm ${theme.text}`}>
                Are you sure you want to permanently delete <strong>{deleteConfirmLead.name}</strong> (Lead #{deleteConfirmLead.id})? Use this only to remove duplicate / double-entered leads.
              </p>
            </div>
            <div className={`p-4 sm:p-5 border-t flex flex-col-reverse sm:flex-row justify-end gap-3 shrink-0 ${theme.modalHeader} ${theme.tableBorder}`}>
              <button onClick={() => setDeleteConfirmLead(null)}
                className={`w-full sm:w-auto px-4 py-3 sm:py-3 rounded-lg font-bold cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500 bg-gray-100 dark:bg-gray-800 sm:bg-transparent`}>Cancel</button>
              <button onClick={() => handleDeleteLead()} disabled={isDeleting}
                className={`w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${isDeleting ? "opacity-50 cursor-not-allowed bg-red-400 text-white" : "cursor-pointer bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"}`}>
                {isDeleting ? "Deleting…" : <><FaTrashAlt /> Confirm Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
      <PermanentLeadDeleteDialog
        open={!!deleteConfirmLead}
        lead={deleteConfirmLead}
        isDark={isDark}
        isDeleting={isDeleting}
        error={deleteError}
        onClose={() => {
          if (isDeleting) return;
          setDeleteConfirmLead(null);
          setDeleteError(null);
        }}
        onConfirm={handleDeleteLead}
      />

      <BulkDeleteLeadsDialog
        open={bulkDeleteOpen}
        count={selectedIds.size}
        isDark={isDark}
        isDeleting={isBulkDeleting}
        error={bulkDeleteError}
        onClose={() => {
          if (isBulkDeleting) return;
          setBulkDeleteOpen(false);
          setBulkDeleteError(null);
        }}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}

// export default DashboardOverview;

function TableSearchInput({
  value,
  onChange,
  theme,
}: {
  value: string;
  onChange: (v: string) => void;
  theme: any;
}) {
  return (
    <div className="relative">
      <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${theme.textFaint}`} />
      <input
        type="text"
        placeholder="Search"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`pl-9 pr-4 py-1.5 text-sm rounded-lg outline-none border w-56 ${theme.inputInner} ${theme.text} ${theme.inputFocus}`}
      />
    </div>
  );
}

// logAndOpenWhatsApp() lived here: it POSTed to /api/whatsapp-logs and then
// window.open()'d wa.me. Both halves are gone — the CRM now sends through
// the Cloud API and stores the thread in whatsapp_messages.

// WhatsAppSendModal was removed along with the wa.me workflow it served.

// ============================================================================
// ADMIN SALES VIEW
// ============================================================================
// Opens a lead's booking view when the Inventory drawer requests it (by lead id),
// then clears the request. `open` receives the resolved lead object.
// `openLeadId` is { id, openBooking }. Notifications pass openBooking:false —
// they want the Lead Detail panel, not the booking view this was written for.
function useInventoryDeepLink({ openLeadId, allLeads, onOpenLeadHandled, open }: any) {
  useEffect(() => {
    if (openLeadId == null || !Array.isArray(allLeads) || allLeads.length === 0) return;
    const l = allLeads.find((x: any) => String(x.id) === String(openLeadId.id));
    if (l) open(l, openLeadId.openBooking !== false);
    if (onOpenLeadHandled) onOpenLeadHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLeadId, allLeads]);
}

function AdminSalesView({ managers, allLeads, followUps, isLoading, adminUser, refetch, theme, isDark, openLeadId, onOpenLeadHandled }: any) {
  // Deep-link from the Inventory drawer: open the requested lead's booking view.
  // (Effect body resolves the handlers below at run-time, after render.)
  // Deep-link handler — await the fetch, only flip showBookingView once data is confirmed
  useInventoryDeepLink({
    openLeadId, allLeads, onOpenLeadHandled,
    open: async (l: any, openBooking: boolean) => {   // ← now async
      const mgr = managers.find((m: any) => m.name === l.assigned_to);
      if (mgr) setSelectedManager(mgr);

      setSelectedLead(l);
      setSubView("detail");
      try { prefillSalesForm(l); } catch { }

      // Only the Inventory path continues into the booking view. A notification
      // has done what it came to do once the Lead Detail panel is open.
      if (!openBooking) return;
      const hasBooking = await fetchBookingForLead(l.id);   // ← awaited now
      if (hasBooking) setShowBookingView(true);              // ← only set once data exists
    }
  });

  const [selectedManager, setSelectedManager] = useState<any>(null);
  const [searchManager, setSearchManager] = useState("");
  const [activeSection, setActiveSection] = useState<"assignedTable" | "closed">("assignedTable");
  const [subView, setSubView] = useState<"list" | "detail">("list");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<"personal" | "loan">("personal");
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Form States
  const [showSalesForm, setShowSalesForm] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [salesForm, setSalesForm] = useState({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
  const [customNote, setCustomNote] = useState("");
  const [toastMsg, setToastMsg] = useState<{ title: string; icon: any; color: string } | null>(null);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState<"all" | "active" | "lost">("all");
  const [showLostLeads, setShowLostLeads] = useState(true);
  const [showNGDLeads, setShowNGDLeads] = useState(true);
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState("");
  const [isSavingLost, setIsSavingLost] = useState(false);
  const [optimisticLeadOverrides, setOptimisticLeadOverrides] = useState<Record<string, any>>({});
  const [isReopening, setIsReopening] = useState(false);

  // Transfer States
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferNote, setTransferNote] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [salesManagers, setSalesManagers] = useState<any[]>([]);
  const [isFetchingManagers, setIsFetchingManagers] = useState(true);
  // ── Auto-drill into a lead when navigated from Enquiry Overview ──
  useEffect(() => {
    const raw = localStorage.getItem("crm_drill_lead");
    if (!raw) return;
    try {
      const drillLead = JSON.parse(raw);
      if (drillLead._drillTab !== "sales") return;
      localStorage.removeItem("crm_drill_lead");
      const sh = managers.find((s: any) => s.name === drillLead.assigned_to);
      if (sh) {
        setSelectedManager(sh);
        setSelectedLead(drillLead);
        setSubView("detail"); prefillSalesForm(drillLead); setShowSalesForm(false); setShowLoanForm(false);
      }
    } catch { }
  }, [managers]);
  // ── Lazy load state ───────────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadLessRef = useRef<HTMLDivElement>(null);

  const showToast = (title: string, color = "green") => {
    setToastMsg({ title, icon: <FaCheckCircle />, color });
    setTimeout(() => setToastMsg(null), 3000);
  };





  // Fetch managers for the transfer dropdown
  useEffect(() => {
    setIsFetchingManagers(true);
    Promise.all([
      fetch("/api/users/sales-manager"),
      fetch("/api/users/site-head")
    ]).then(async ([resSM, resSH]) => {
      let combined = [];
      if (resSM.ok) { const j = await resSM.json(); combined.push(...(j.data || j || [])); }
      if (resSH.ok) { const j = await resSH.json(); combined.push(...(j.data || j || [])); }
      setSalesManagers(combined);
    }).catch(() => { }).finally(() => setIsFetchingManagers(false));
  }, []);

  const currentLeadFollowUps = useMemo(() =>
    (followUps || []).filter((f: any) => String(f.leadId) === String(selectedLead?.id)),
    [followUps, selectedLead]);
  const isLeadLocked = !!selectedLead && (selectedLead.status === "Closing" || selectedLead.status === "Closed" || !!selectedLead.closingDate || !!selectedLead.is_lost_lead);
  useEffect(() => {
    if (subView === "detail") followUpEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentLeadFollowUps, subView, detailTab]);

  // Enrich Leads with Follow-up Data (Copied exact logic from ReceptionistView)
  const mergedLeads = useMemo(() => {
    const fupIndex = indexFollowUpsByLead(followUps);
    const sourceLeads = updateLeadRestoreState(allLeads, null).map((lead: any) => ({
      ...lead,
      ...(optimisticLeadOverrides[String(lead.id)] || {}),
    }));
    return sourceLeads.map((lead: any) => {
      const lf = fupIndex.get(String(lead.id)) || EMPTY_FUPS;
      const salesForms = lf.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
      const latestMsg = salesForms.length > 0 ? salesForms[salesForms.length - 1].message : "";
      const g = (field: string) => {
        if (!latestMsg) return "Pending";
        const m = latestMsg.match(new RegExp(`• ${field}: (.*)`));
        return m ? m[1].trim() : "Pending";
      };
      const loanUpdates = lf.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
      let loanStatus = "N/A";
      if (loanUpdates.length > 0) {
        const msg = loanUpdates[loanUpdates.length - 1].message;
        const mS = msg.match(/• Status: (.*)/); if (mS) loanStatus = mS[1].trim();
      }
      const visitsWithDate = lf.filter((f: any) => f.siteVisitDate?.trim());
      const mongoVisitDate = visitsWithDate.length > 0 ? visitsWithDate[visitsWithDate.length - 1].siteVisitDate : null;
      const closingFups = lf.filter((f: any) => f.message?.includes("✅ Lead Marked as Closing"));
      const reopenFups = lf.filter((f: any) => f.message?.includes("↩️ Lead Reopened"));
      const lastReopenAt = reopenFups.length > 0 ? new Date(reopenFups[reopenFups.length - 1].createdAt).getTime() : 0;
      const closingFupsSinceReopen = closingFups.filter((f: any) => new Date(f.createdAt).getTime() > lastReopenAt);
      const closingDate = closingFupsSinceReopen.length > 0 ? closingFupsSinceReopen[closingFupsSinceReopen.length - 1].createdAt : null;
      const sfBudget = g("Budget");
      const activeBudget = sfBudget !== "Pending" && sfBudget !== "N/A" ? sfBudget : (lead.budget || "Pending");

      return {
        ...lead,
        propType: (g("Property Type") !== "Pending" && g("Property Type") !== "N/A") ? g("Property Type") : (lead.configuration || "Pending"),
        salesBudget: activeBudget,
        useType: g("Use Type") !== "Pending" ? g("Use Type") : (lead.purpose || "Pending"),
        leadInterestStatus: g("Lead Status"),
        loanStatus, mongoVisitDate, closingDate,
        allFollowUps: lf,
        status: lead.status === "Closing" ? "Closing" : mongoVisitDate ? "Visit Scheduled" : lead.status,
      };
    });
  }, [allLeads, followUps, optimisticLeadOverrides]);

  useEffect(() => {
    if (!selectedLead) return;
    const updated = mergedLeads.find((lead: any) => String(lead.id) === String(selectedLead.id));
    if (updated) setSelectedLead(updated);
  }, [mergedLeads, selectedLead?.id]);

  // Derived Datasets for Tabs
  const managerName = selectedManager?.name ?? "";
  const applyLostVisibility = useCallback((lead: any) => {
    let passNGD = true;
    const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "Non Qualified Lead" || lead.leadInterestStatus === "Non Qualified Leads" || lead.leadInterestStatus === "Non qualified Lead";
    if (!showNGDLeads && isNGD) {
      passNGD = false;
    }
    if (!passNGD) return false;

    if (leadStatusFilter === "lost") return !!lead.is_lost_lead;
    if (leadStatusFilter === "active") return !lead.is_lost_lead;
    return showLostLeads || !lead.is_lost_lead;
  }, [leadStatusFilter, showLostLeads, showNGDLeads]);
  const assignedLeads = useMemo(() => mergedLeads.filter((l: any) => l.assigned_to === managerName && l.status !== "Closing" && !l.closingDate && applyLostVisibility(l)), [mergedLeads, managerName, applyLostVisibility]);
  const closedLeads = useMemo(() => mergedLeads.filter((l: any) => l.assigned_to === managerName && (l.status === "Closing" || l.status === "Closed" || !!l.closingDate)), [mergedLeads, managerName]);
  const filteredManagers = (managers || []).filter((s: any) => s.name?.toLowerCase().includes(searchManager.toLowerCase()));
  // ── Bottom sentinel: load 20 more on scroll down ──────────────────────────────
  useEffect(() => {
    const currentTotal = activeSection === "assignedTable" ? assignedLeads.length : closedLeads.length;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, currentTotal));
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [activeSection, assignedLeads.length, closedLeads.length]);

  // ── Top sentinel: unload back to 20 when scrolled fully back up ───────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount > 20) {
          setVisibleCount(20);
        }
      },
      { threshold: 1.0 }
    );
    if (loadLessRef.current) observer.observe(loadLessRef.current);
    return () => observer.disconnect();
  }, [visibleCount]);

  // ── Reset count when section or site head changes ─────────────────────────────
  useEffect(() => {
    setVisibleCount(20);
  }, [activeSection, selectedManager?.name]);
  // Helpers for Forms
  const prefillSalesForm = (targetLead?: any) => {
    const l = targetLead || selectedLead;
    if (!l) return;
    const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id));
    const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
    if (sf.length === 0) return;
    const msg = sf[sf.length - 1].message;
    const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; };
    setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" });
  };

  const handleSendCustomNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!customNote.trim() || !selectedLead) return;
    const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: "admin", message: customNote, siteVisitDate: null, createdAt: new Date().toISOString() };
    setCustomNote("");
    try { await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }); refetch(); } catch { }
  };

  // handleSendWhatsApp was removed with the wa.me workflow. It logged that a
  // message had been composed and then handed off to another app, so the CRM
  // never learned whether it was delivered or what the customer replied.
  // Sending now goes through WhatsAppConversationPanel →
  // POST /api/whatsapp/conversations/:id/messages.

  const handleSalesFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const msg = `📝 Detailed Salesform Submitted:\n• Property Type: ${salesForm.propertyType || "N/A"}\n• Location: ${salesForm.location || "N/A"}\n• Budget: ${salesForm.budget || "N/A"}\n• Use Type: ${salesForm.useType || "N/A"}\n• Planning to Purchase: ${salesForm.purchaseDate || "N/A"}\n• Loan Planned: ${salesForm.loanPlanned || "N/A"}\n• Lead Status: ${salesForm.leadStatus || "N/A"}\n• Site Visit Requested: ${salesForm.siteVisit ? formatDate(salesForm.siteVisit) : "No"}`;
    const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: "admin", message: msg, siteVisitDate: salesForm.siteVisit || null, createdAt: new Date().toISOString() };
    const ns = salesForm.siteVisit ? "Visit Scheduled" : selectedLead.status;
    setShowSalesForm(false);
    setSalesForm({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: ns }) });
      refetch();
    } catch { }
  };

  const [bookingData, setBookingData] = useState<any>(null);
  const [showBookingView, setShowBookingView] = useState(false);
  const [bookingDetailTab, setBookingDetailTab] = useState<"personal" | "loan" | "booking">("personal");

  const handleBookingSuccess = (booking: any) => {
    setBookingData(booking);
    setBookingDetailTab("booking");
    setToastMsg({ title: `🎉 Booking ${booking.booking_number} created for ${selectedLead?.name}!`, icon: <FaCheckCircle />, color: "green" });
    setTimeout(() => setToastMsg(null), 4000);
    refetch();
  };

  const fetchBookingForLead = async (leadId: string | number) => {
    try {
      const res = await fetch(`/api/booking-applications?lead_id=${leadId}`);
      const json = await res.json();
      if (json.success && json.data?.length > 0) {
        setBookingData(json.data[0]);
        return true;   // ← NEW
      }
      setBookingData(null);
      return false;    // ← NEW
    } catch {
      setBookingData(null);
      return false;    // ← NEW
    }
  };

  // Upgrade the summary held in `bookingData` (see fetchLoanDealData) to the full
  // row, then show the booking view. Routing the button through here keeps the
  // 121-column payload off the lead-detail path without ClosedLeadBookingView ever
  // rendering against the summary.
  const openBookingView = async (leadId: string | number) => {
    const hasBooking = await fetchBookingForLead(leadId);
    if (hasBooking) setShowBookingView(true);
  };

  // Loan & Deal Tracking panel — independent of bookingData/fetchBookingForLead above,
  // which (when wired up) swaps the whole detail view to ClosedLeadBookingView.
  const [loanDealBooking, setLoanDealBooking] = useState<any>(null);
  const [loanDealLatest, setLoanDealLatest] = useState<any>(null);
  // One pass serves both consumers of the booking row.
  //
  // `loanDealBooking` (the Loan & Deal panel) and `bookingData` (the booking view)
  // came from the SAME URL via two separate effects, and both read `data[0]` — the
  // identical row. Browsers do not coalesce concurrent fetches to the same URL, so
  // that was one wasted request and two wasted Neon round trips (~168 ms) per lead
  // open. The loan request also waited on the booking request; they are
  // independent and now run together.
  // PAYLOAD: `view=summary` is BOOKING_LIST_SQL (24 explicit columns, one join).
  // The default `view=full` is BOOKING_SELECT_SQL: 121 columns across 6 joins, 2
  // views and a json_agg, including PAN, Aadhaar, signature data and document URLs.
  // Nothing on the lead-detail screen reads any of that — the summary enables the
  // "View Booking Form" button and feeds LoanDealView/LoanDealForm, which read only
  // `id` and `agreement_value`. openBookingView() loads the full row on click.
  const fetchLoanDealData = useCallback(async (leadId: string | number) => {
    const [bookingOutcome, loanOutcome] = await Promise.allSettled([
      fetch(`/api/booking-applications?lead_id=${leadId}&view=summary`).then((r) => r.json()),
      fetch(`/api/loan?lead_id=${leadId}&latest=1`).then((r) => r.json()),
    ]);

    const bookingJson = bookingOutcome.status === "fulfilled" ? bookingOutcome.value : null;
    const booking =
      bookingJson?.success && bookingJson.data?.length > 0 ? bookingJson.data[0] : null;
    setLoanDealBooking(booking);
    setBookingData(booking);

    const loanJson = loanOutcome.status === "fulfilled" ? loanOutcome.value : null;
    const rows = loanJson?.success ? loanJson.data ?? [] : [];
    setLoanDealLatest(rows.length > 0 ? rows[rows.length - 1] : null);
  }, []);

  // Keyed on the lead ID, not the lead OBJECT. `selectedLead` is rebuilt from the
  // `mergedLeads` memo on every refetch(), so a `[selectedLead]` dependency
  // re-fired this fetch after every follow-up note, sales-form submit and status
  // change while a lead was simply sitting open.
  useEffect(() => {
    if (selectedLead?.id) fetchLoanDealData(selectedLead.id);
    else {
      setLoanDealBooking(null);
      setLoanDealLatest(null);
      setBookingData(null);
      setShowBookingView(false);
    }
  }, [selectedLead?.id, fetchLoanDealData]);

  const handleReopenLead = async () => {
    if (!selectedLead || selectedLead.status !== "Closing") return;
    setIsReopening(true);
    try {
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Interested" }) });
      const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: "admin", message: `↩️ Lead Reopened by ${adminUser.name} (Admin)`, siteVisitDate: null, createdAt: new Date().toISOString() };
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      setToastMsg({ title: `${selectedLead.name} reopened`, icon: <FaCheckCircle />, color: "blue" });
      setTimeout(() => setToastMsg(null), 3000);
      refetch();
    } catch { }
    finally { setIsReopening(false); }
  };
  const openLostLeadModal = (lead = selectedLead) => {
    if (!lead || lead.is_lost_lead) return;
    setSelectedLead(lead);
    setLostReason("");
    setLostError("");
    setShowLostModal(true);
  };

  const handleMarkLostLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const reason = lostReason.trim();
    if (reason.length < 10) {
      setLostError("Reason must be at least 10 characters.");
      return;
    }
    setIsSavingLost(true);
    try {
      const json = await markLostLeadApi({ leadId: selectedLead.id, reason, markedBy: adminUser.name });
      if (!json.success) {
        setLostError(json.message || "Could not mark this lead as lost.");
        return;
      }
      setSelectedLead(json.data);
      setShowLostModal(false);
      showToast(`${selectedLead.name} marked as Lost Lead`, "red");
      refetch();
    } catch {
      setLostError("Network error. Please try again.");
    } finally {
      setIsSavingLost(false);
    }
  };

  const handleTransferLead = async () => {
    if (!selectedLead || !transferTarget || !transferNote.trim()) return;
    setIsTransferring(true);
    try {
      const res = await fetch("/api/leads/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: selectedLead.id, transfer_to: transferTarget, transfer_note: transferNote, transferred_by: adminUser.name }) });
      if (!res.ok) throw new Error("Transfer failed");
      setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget("");
      showToast(`Lead #${selectedLead.sr_no || selectedLead.id} transferred to ${transferTarget}!`);
      setSubView("list"); setSelectedLead(null);
      refetch();
    } catch (e: any) { alert(e.message ?? "Transfer failed."); }
    finally { setIsTransferring(false); }
  };

  const handleRestoreLead = async (lead = selectedLead) => {
    if (!lead || !lead.is_lost_lead || isSavingLost) return;
    const leadId = String(lead.id);
    const optimisticLead = {
      ...lead,
      is_lost_lead: false,
      lost_lead_reason: null,
      lost_lead_marked_at: null,
      lost_lead_marked_by: null,
      lost_reason: null,
      lost_marked_at: null,
      lost_marked_by: null,
    };

    setIsSavingLost(true);
    setOptimisticLeadOverrides(prev => ({ ...prev, [leadId]: optimisticLead }));
    if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(optimisticLead);

    try {
      const json = await restoreLeadApi({ leadId: lead.id, restoredBy: adminUser.name });
      if (!json.success) {
        setOptimisticLeadOverrides(prev => {
          const next = { ...prev };
          delete next[leadId];
          return next;
        });
        if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(lead);
        showToast(json.message || "Could not restore lead", "red");
        return;
      }
      setOptimisticLeadOverrides(prev => ({ ...prev, [leadId]: json.data }));
      if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(json.data);
      showToast(`${lead.name} restored to Active`, "green");
      await refetch();
      setOptimisticLeadOverrides(prev => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
    } catch {
      setOptimisticLeadOverrides(prev => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(lead);
      showToast("Network error while restoring lead", "red");
    } finally {
      setIsSavingLost(false);
    }
  };

  // Status Classes & Sections
  const statusCls = (status: string) => {
    const s = status || "Assigned";
    if (s === "New Lead") return "whitespace-nowrap " + (isDark ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50");
    if (s === "Assigned") return "whitespace-nowrap " + (isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50");
    if (s === "Contacted") return "whitespace-nowrap " + (isDark ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50");
    if (s === "Interested") return "whitespace-nowrap " + (isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50");
    if (s === "Visit Scheduled") return "whitespace-nowrap " + (isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50");
    if (s === "Completed") return "whitespace-nowrap " + (isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50");
    if (s === "Closing" || s === "Closed") return "whitespace-nowrap " + (isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50");
    return "whitespace-nowrap " + (isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50");
  };

  const sections = [
    { key: "assignedTable", label: "Assigned Lead Table", icon: "🗃️", count: assignedLeads.length, desc: `Active pipeline managed by ${managerName}` },
    { key: "closed", label: "Closed Leads", icon: "✅", count: closedLeads.length, desc: `Deals successfully closed by ${managerName}` }
  ] as const;

  // Reusable Table Component
  const renderTable = (leads: any[]) => (
    <div className={`rounded-xl overflow-hidden border ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className="overflow-x-auto custom-scrollbar">
        <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />

        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className={`text-[10px] sm:text-xs uppercase ${theme.tableHead} ${theme.textHeader}`}>
            <tr>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Lead ID</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Client</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Budget</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Phone</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Source</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Status</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Interest</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Site Visit</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Date</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${theme.tableDivide}`}>
            {isLoading ? (
              <tr><td colSpan={9} className={`text-center py-6 sm:py-8 text-xs sm:text-sm ${theme.textMuted}`}>Syncing…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={9} className={`text-center py-8 sm:py-12 text-xs sm:text-sm ${theme.textMuted}`}>No leads found.</td></tr>
            ) : leads.map((lead: any) => {
              const isLost = !!lead.is_lost_lead;
              const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
              return (
                <tr key={lead.id} className={`transition-colors cursor-pointer ${isLost ? theme.rowLost : isNGD ? theme.rowNGD : theme.tableRow}`} onClick={() => { setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(false); setShowLoanForm(false); }}>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-black text-xs sm:text-sm ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-xs sm:text-sm ${theme.text}`}>{lead.name}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-xs sm:text-sm ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget || "N/A"}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-mono text-[10px] sm:text-xs ${theme.textMuted}`}>{maskPhone(lead.phone, adminUser?.role, lead.assigned_to === adminUser?.name)}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs ${theme.textMuted}`}>{lead.source || "—"}</td>
                  <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                    <span className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border flex-shrink-0 ${isLost ? theme.statusLost : isNGD ? theme.statusNGD : statusCls(lead.status)}`}>
                      {isLost ? "Lost" : isNGD ? "NGD" : (lead.status || "Assigned")}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                    {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" ? (
                      <InterestBadge status={lead.leadInterestStatus} size="sm" isDark={isDark} />
                    ) : <span className={`text-[10px] sm:text-xs italic ${theme.textFaint}`}>—</span>}
                  </td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs ${lead.mongoVisitDate ? "text-orange-500 font-semibold" : theme.textFaint}`}>
                    {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : "—"}
                  </td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs whitespace-normal min-w-[100px] sm:min-w-[120px] ${theme.textFaint}`}>
                    {formatDate(lead.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* ── BOTTOM SENTINEL — triggers load more ── */}
        {visibleCount < leads.length && (
          <div ref={loadMoreRef} className={`flex items-center justify-center gap-3 py-6 ${theme.textMuted}`}>
            <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
            <span className="text-xs font-medium">Loading more… ({visibleCount} of {leads.length})</span>
          </div>
        )}
        {visibleCount >= leads.length && leads.length > 20 && (
          <div className={`text-center py-2.5 text-xs font-medium ${theme.textFaint}`}>
            ✓ All {leads.length} leads loaded
          </div>
        )}
      </div>
    </div>
  );
  const [showMobileActions, setShowMobileActions] = useState(false);
  const formInput = `w-full rounded-lg px-4 py-2 text-sm outline-none transition-colors border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;
  const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;

  return (
    <div className="flex relative h-full w-full overflow-hidden">
      {toastMsg && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] px-3 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fadeIn ${toastMsg.color === "green" ? "bg-green-600 border-green-400 text-white" : "bg-[#9E217B] border-[#b8268f] text-white"}`}>
          <div className="text-lg">{toastMsg.icon}</div>
          <span className="text-sm font-bold">{toastMsg.title}</span>
        </div>
      )}

      {/* 1. Sidebar for Managers */}
      {/* MOBILE: 100% width, hidden if a manager is selected. DESKTOP: Always visible, fixed 62 width (approx 250px) */}
      <div
        className={`border-r flex-col h-full flex-shrink-0 z-20 shadow-xl ${theme.innerBlock} w-full md:w-62 ${selectedManager ? 'hidden md:flex' : 'flex'}`}
      >
        <div className={`p-5 border-b ${theme.tableBorder}`}>
          <div className="relative">
            <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${theme.textFaint}`} />
            <input
              type="text"
              placeholder="Search Managers..."
              value={searchManager}
              onChange={e => setSearchManager(e.target.value)}
              className={`w-full rounded-lg pl-9 pr-4 py-2 text-sm outline-none transition-colors ${theme.inputInner} ${theme.text} ${theme.inputFocus}`}
            />
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto custom-scrollbar ${theme.scroll}`} dir="rtl">
          <div dir="ltr" className="min-h-full">
            {isLoading ? (
              <div className={`p-8 text-center text-sm ${theme.textMuted}`}>Loading...</div>
            ) : filteredManagers.length === 0 ? (
              <div className={`p-8 text-center text-sm ${theme.textMuted}`}>No Managers found.</div>
            ) : (
              filteredManagers.map((sh: any) => {
                const isSelected = selectedManager?.id === sh.id || selectedManager?.name === sh.name;
                const count = allLeads.filter((l: any) => l.assigned_to === sh.name).length;

                return (
                  <div
                    key={sh.id || sh.name}
                    onClick={() => {
                      setSelectedManager(sh);
                      setSubView("list");
                      setActiveSection("assignedTable");
                      setSelectedLead(null);
                    }}
                    className={`p-5 flex items-center gap-2 cursor-pointer transition-all border-b ${theme.tableBorder} ${isSelected ? (isDark ? "border-r-4 border-r-[#9E217B] bg-[#9E217B]/10" : "border-r-4 border-r-[#9E217B] bg-pink-50") : "hover:opacity-80 border-r-4 border-r-transparent"}`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm flex-shrink-0 ${isSelected ? "bg-[#9E217B]" : isDark ? "bg-[#333] text-gray-400" : "bg-gray-400"}`}>
                      {sh.name?.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1">
                        <h3 className={`font-bold truncate text-sm ${theme.text}`}>{sh.name}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isDark ? "text-[#d946a8] bg-[#9E217B]/10" : "text-[#9E217B] bg-pink-100"}`}>
                          {count} leads
                        </span>
                      </div>
                      <p className={`text-xs truncate capitalize ${theme.textFaint}`}>Sales Manager</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>


      {/* 2. COMBINED MAIN CONTENT AREA (Leads/Details View) */}
      {/* MOBILE: 100% width, only visible if manager is selected. DESKTOP: Always visible, takes remaining space */}
      <div
        className={`flex-1 flex flex-col h-full min-w-0 overflow-hidden ${theme.mainBg} ${selectedManager ? 'flex' : 'hidden md:flex'}`}
      >
        {/* MOBILE BACK BUTTON: Only shows on small screens when a manager is selected */}
        {/* {selectedManager && (
          <div className={`md:hidden flex items-center p-3 border-b flex-shrink-0 bg-white ${theme.tableBorder} ${theme.header}`}>
            <button
              onClick={() => setSelectedManager(null)}
              className={`flex items-center gap-2 text-sm font-bold hover:opacity-80 ${theme.text}`}
            >
              <FaArrowLeft className={theme.textFaint} />
              Back to Managers
            </button>
          </div>
        )} */}

        {/* Existing Main Content Panel */}
        {!selectedManager ? (
          <div className={`h-full flex flex-col items-center justify-center ${theme.textMuted}`}>
            <FaUsers className="text-4xl mb-4 opacity-20" />
            <p>Select a Sales Manager from the left sidebar.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
            {/* Sub-header */}
            <div className={`p-3 border-b border-gray-300 flex justify-between items-center shadow-sm z-10 flex-shrink-0 gap-1 ${theme.header}`} style={theme.headerGlass}>
              <div>
                <h2 className={`text-md font-bold flex items-center gap-2 ${theme.text}`}>
                  <FaUsers className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"} /> {selectedManager.name}'s Division
                </h2>
              </div>
              <span className={`text-xs px-3 py-1 rounded-full border font-bold flex items-center gap-1.5 ${isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-200 bg-green-50"}`}>
                🟢 Live Sync
              </span>
            </div>

            {/* ── LIST VIEW (Stats + Tables) ── */}
            {subView === "list" && (
              <div className={`flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-4 ${theme.scroll}`}>
                <div className="animate-fadeIn space-y-3 sm:space-y-4 max-w-7xl mx-auto">

                  {/* Tabs / Stats Row */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {sections.map(sec => (
                      <div key={sec.key} onClick={() => setActiveSection(sec.key as any)}
                        className={`rounded-2xl sm:rounded-3xl p-3 sm:p-5 border cursor-pointer transition-all ${activeSection === sec.key ? (isDark ? "bg-[#9E217B]/20 border-[#9E217B]/50" : "bg-[#9E217B]/10 border-[#9E217B]") : `${theme.card} hover:opacity-90`}`}>
                        <div className="flex items-center justify-between mb-1 sm:mb-2">
                          <span className="text-base sm:text-lg">{sec.icon}</span>
                          <span className={`text-md sm:text-2xl font-black ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>{sec.count}</span>
                        </div>
                        <p className={`text-xs sm:text-sm font-bold ${theme.text}`}>{sec.label}</p>
                        <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 leading-tight ${theme.textFaint}`}>{sec.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Table Rendering */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 sm:gap-3 mb-2 sm:mb-4">
                    <h3 className={`text-base sm:text-lg font-bold ${theme.text}`}>
                      {activeSection === "assignedTable" ? "Currently Assigned Leads" : "Successfully Closed Leads"}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {activeSection === "assignedTable" && (
                        <>
                          <select value={leadStatusFilter} onChange={e => setLeadStatusFilter(e.target.value as "all" | "active" | "lost")} className={`rounded-lg px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs outline-none cursor-pointer border ${theme.selectSmall}`}>
                            <option value="all">All Leads</option>
                            <option value="active">Active Leads</option>
                            <option value="lost">Lost Leads</option>
                          </select>
                          <label className={`flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-bold ${theme.textMuted}`}>
                            <input type="checkbox" checked={showLostLeads} onChange={e => setShowLostLeads(e.target.checked)} disabled={leadStatusFilter !== "all"} className="accent-red-500 scale-90 sm:scale-100" />
                            Show Lost
                          </label>
                          <label className={`flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-bold ${theme.textMuted}`}>
                            <input type="checkbox" checked={showNGDLeads} onChange={e => setShowNGDLeads(e.target.checked)} disabled={leadStatusFilter !== "all"} className="accent-[#F97316] scale-90 sm:scale-100" />
                            Show NGD
                          </label>
                        </>
                      )}
                      <button
                        onClick={() => downloadCSV((activeSection === "assignedTable" ? assignedLeads : closedLeads).map(formatLeadForExport), `SiteHead_${activeSection}.csv`)}
                        className={`flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs font-bold border rounded-lg transition-colors hover:opacity-80 ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
                      >
                        <FaDownload size={12} className="sm:w-[14px] sm:h-[14px]" /> Export to CSV
                      </button>
                    </div>
                  </div>
                  {renderTable(activeSection === "assignedTable" ? assignedLeads : closedLeads)}

                </div>
              </div>
            )}

            {/* ── DETAIL VIEW (Full Panel) ── */}
            {subView === "detail" && selectedLead && (
              bookingData && showBookingView ? (
                <div className="animate-fadeIn w-full h-[calc(100vh-130px)] overflow-hidden bg-transparent flex flex-col">
                  <div className="flex items-center p-2 shrink-0 border-b border-white/10 shadow-sm" style={theme.cardGlass}>
                    <button onClick={() => setShowBookingView(false)} className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 border rounded-lg transition-colors cursor-pointer shadow-sm ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                      <FaChevronLeft /> Back to Lead Details
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ClosedLeadBookingView
                      booking={bookingData}
                      lead={selectedLead}
                      isDark={isDark}
                      userRole={adminUser?.role?.toLowerCase() || "admin"}
                      currentUser={adminUser}
                      onRefetch={() => { if (selectedLead) fetchBookingForLead(selectedLead.id); }}
                    />
                  </div>
                </div>
              ) : (
                <div className={`flex-1 overflow-y-auto p-3 ${theme.scroll}`}>
                  <div className="animate-fadeIn max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-130px)]">
                    {/* Detail header — sticky compact action bar */}
                    <div className={`sticky top-0 z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-0 rounded-xl border p-2 shadow-sm flex-shrink-0 ${selectedLead.is_lost_lead ? theme.cardLost : theme.card}`} style={theme.cardGlass}>

                      {/* TITLE ROW: Back Button, Name, and Mobile Toggle */}
                      <div className="flex items-center justify-between w-full sm:w-auto gap-2">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <button onClick={() => { setSubView("list"); setShowSalesForm(false); setShowLoanForm(false); }} className={`w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 flex items-center justify-center border rounded-lg sm:rounded-xl transition-colors cursor-pointer shadow-sm ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                            <FaChevronLeft className="text-[10px] sm:text-xs" />
                          </button>
                          <h1 className={`text-sm sm:text-base lg:text-lg font-bold flex flex-wrap items-center gap-1.5 sm:gap-2 ${theme.text}`}>
                            <span className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"}>#{selectedLead.sr_no || selectedLead.id}</span>
                            <span>{selectedLead.name}</span>
                            {selectedLead.status === "Closing" && (
                              <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusClosing}`}>
                                <FaHandshake className="text-[10px] sm:text-xs" /> Closing
                              </span>
                            )}
                            {selectedLead.is_lost_lead ? (
                              <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusLost}`}>
                                <FaEyeSlash className="text-[10px] sm:text-xs" /> Lost Lead
                              </span>
                            ) : (selectedLead.status === "NON GENUINE DEMAND (NGD)" || selectedLead.leadStatus === "NON GENUINE DEMAND (NGD)" || selectedLead.leadInterestStatus === "NON GENUINE DEMAND (NGD)") ? (
                              <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusNGD}`}>
                                NON GENUINE DEMAND
                              </span>
                            ) : null}
                          </h1>
                        </div>

                        {/* MOBILE TOGGLE BUTTON (Hidden on Desktop) */}
                        <button
                          onClick={() => setShowMobileActions(!showMobileActions)}
                          className={`sm:hidden w-8 h-8 flex-shrink-0 flex items-center justify-center border rounded-lg transition-colors shadow-sm ${showMobileActions ? theme.btnPrimary : `${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}`}
                        >
                          <FaChevronDown className={`text-[10px] transition-transform duration-200 ${showMobileActions ? "rotate-180" : ""}`} />
                        </button>
                      </div>

                      {/* ACTION BUTTONS: Hidden on mobile unless toggled open. Always visible on sm+ */}
                      <div className={`gap-1.5 sm:gap-2 flex-wrap justify-start sm:justify-end mt-1 sm:mt-0 w-full sm:w-auto ${showMobileActions ? "flex animate-fadeIn" : "hidden sm:flex"}`}>
                        {bookingData ? (
                          <button onClick={() => openBookingView(selectedLead.id)} className="font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm whitespace-nowrap">
                            <FaEye />Booking Form
                          </button>
                        ) : (
                          <button disabled title="Booking Form has not been submitted yet." className="font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors opacity-50 cursor-not-allowed bg-indigo-400 text-white shadow-sm whitespace-nowrap">
                            <FaEye />Booking Form
                          </button>
                        )}
                        {isLeadLocked ? (
                          <>
                            <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md border flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 whitespace-nowrap ${selectedLead.is_lost_lead ? theme.statusLost : theme.statusClosing}`}>
                              {selectedLead.is_lost_lead ? <><FaEyeSlash className="text-[10px] sm:text-xs" /> Lost Lead • Read Only</> : <><FaCheckCircle className="text-[10px] sm:text-xs" /> Lead Closed • Read Only</>}
                            </span>
                            {selectedLead.is_lost_lead ? (
                              <button onClick={() => handleRestoreLead()} disabled={isSavingLost} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60 whitespace-nowrap`}>
                                <FaCheckCircle /> Restore Lead
                              </button>
                            ) : (
                              <button onClick={handleReopenLead} disabled={isReopening} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60 whitespace-nowrap`}>
                                ↩️ Reopen Lead
                              </button>
                            )}
                          </>
                        ) : (
                          !showSalesForm && !showLoanForm && (
                            <>
                              <button onClick={() => { prefillSalesForm(); setShowSalesForm(true); setShowLoanForm(false); }} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} whitespace-nowrap`}>
                                <FaFileInvoice /> Fill Salesform
                              </button>
                              <button onClick={() => { setShowLoanForm(true); setShowSalesForm(false); }} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnSecondary} whitespace-nowrap`}>
                                <FaUsers /> Track Loan
                              </button>
                              <button onClick={() => setIsClosingModalOpen(true)} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnWarning} whitespace-nowrap`}>
                                <FaHandshake /> Mark Closing
                              </button>
                              <button onClick={() => openLostLeadModal()} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnDanger} whitespace-nowrap`}>
                                <FaEyeSlash /> Lost Lead
                              </button>
                              <button onClick={() => { setTransferTarget(""); setTransferNote(""); setIsTransferModalOpen(true); }} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${isDark ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"} whitespace-nowrap`}>
                                <FaExchangeAlt /> Transfer
                              </button>
                            </>
                          )
                        )}
                      </div>
                    </div>

                    <div className="mb-3 flex-shrink-0">
                      <BolnaCallWidget
                        leadId={Number(selectedLead.id)}
                        leadName={selectedLead.name}
                        phone={selectedLead.phone}
                        userData={{ project: selectedLead.propType || selectedLead.configuration }}
                        compact
                      />
                    </div>

                    <div className="flex flex-col lg:flex-row gap-2 flex-1 min-h-0 pb-2">
                      <div className="w-full lg:w-[45%] xl:w-[45%] flex flex-col gap-3 h-full pb-2">
                        {showSalesForm ? (
                          <div className={`rounded-xl border p-3 shadow-xl flex-1 overflow-y-auto custom-scrollbar flex flex-col ${theme.modalCard}`} style={theme.modalGlass}>
                            <div className={`flex justify-between items-center mb-3 border-b pb-2 ${theme.tableBorder}`}>
                              <div>
                                <h3 className={`text-base font-bold ${theme.text}`}>Sales Data Form</h3>
                                <p className={`text-xs mt-0.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Admin override — Lead #{selectedLead.id}</p>
                              </div>
                              <button type="button" onClick={() => setShowSalesForm(false)} className={`p-1 ${theme.textMuted} hover:text-red-500`}><FaTimes /></button>
                            </div>
                            <form onSubmit={handleSalesFormSubmit} className="flex flex-col gap-2 flex-1">
                              <div className="grid grid-cols-2 gap-3">
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Property Type?</label><input type="text" placeholder="e.g. 1BHK, 2BHK" value={salesForm.propertyType} onChange={e => setSalesForm({ ...salesForm, propertyType: e.target.value })} className={formInput} /></div>
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Preferred Location?</label><input type="text" placeholder="e.g. Dombivali, Kalyan" value={salesForm.location} onChange={e => setSalesForm({ ...salesForm, location: e.target.value })} className={formInput} /></div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Approximate Budget?</label><input type="text" placeholder="e.g. 5 cr" value={salesForm.budget} onChange={e => setSalesForm({ ...salesForm, budget: e.target.value })} className={formInput} /></div>
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Self-use or Investment?</label>
                                  <select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={formSelect}><option value="">Select</option><option>Self Use</option><option>Investment</option></select>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Planning to Purchase?</label>
                                  <select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={formSelect}><option value="">Select</option><option>Immediate</option><option>Next 3 Months</option></select>
                                </div>
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Loan Planned?</label>
                                  <select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><option value="" disabled>Select Option</option><option>Yes</option><option>No</option><option>Not Sure</option></select>
                                </div>
                              </div>
                              <div className={`border-t pt-2 ${theme.tableBorder}`}>
                                <label className={`block text-xs font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Lead Interest Status *</label>
                                <select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><option value="" disabled>Select Status</option><option>Interested</option><option>Not Interested</option><option>NON GENUINE DEMAND (NGD)</option></select>
                              </div>
                              <div className={`border-t pt-2 ${theme.tableBorder}`}>
                                <label className="text-xs text-orange-400 font-bold mb-1 block">Schedule a Site Visit?</label>
                                <input ref={inputRef} type="datetime-local" value={salesForm.siteVisit} onChange={e => setSalesForm({ ...salesForm, siteVisit: e.target.value })} onClick={() => inputRef.current?.showPicker()} className={`${formInput} focus:border-orange-500`} />
                              </div>
                              <button type="submit" className={`mt-auto w-full font-bold py-2.5 rounded-xl transition-colors text-xs ${theme.btnPrimary}`}>Submit Salesform</button>
                            </form>
                          </div>

                        ) : showLoanForm ? (
                          <LoanDealForm
                            lead={selectedLead}
                            booking={loanDealBooking}
                            loanUpdate={loanDealLatest}
                            user={adminUser}
                            isDark={isDark}
                            t={theme}
                            onCancel={() => setShowLoanForm(false)}
                            onSuccess={() => {
                              setShowLoanForm(false);
                              showToast(`Loan & deal data saved for ${selectedLead.name}`);
                              fetchLoanDealData(selectedLead.id);
                              refetch();
                            }}
                          />
                        ) : (
                          <div className="flex flex-col h-full animate-fadeIn">
                            <div className={`flex items-center gap-2 mb-3 border p-1.5 rounded-xl flex-shrink-0 ${theme.tableWrap}`}>
                              <button onClick={() => setDetailTab("personal")} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? theme.btnPrimary : `${theme.textMuted} hover:opacity-80`}`}>Personal Information</button>
                              <button onClick={() => setDetailTab("loan")} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? theme.btnSecondary : `${theme.textMuted} hover:opacity-80`}`}>Loan Tracking</button>
                            </div>
                            <div className={`flex-1 overflow-y-auto custom-scrollbar rounded-xl p-3 shadow-lg border ${theme.chatPanel}`} style={theme.chatPanelGl}>
                              {detailTab === "personal" ? (
                                <div>
                                  <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                                    <InlineContactField label="Email" value={selectedLead.email} fieldType="email" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Phone" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Alt Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); showToast("Contact details updated successfully."); }} />
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Lead Interest</p>{selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} isDark={isDark} /> : <p className={`font-semibold ${theme.text}`}>Pending</p>}</div>
                                    <div className="col-span-1"><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Loan Status</p>{selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} isDark={isDark} /></div> : <p className={`font-semibold ${theme.text}`}>N/A</p>}</div>
                                    <div className="col-span-1"><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Backdated Entry</p><p className={`font-semibold ${theme.text}`}>{selectedLead.auto_date_enabled === false && selectedLead.enquiry_date ? formatDate(selectedLead.enquiry_date).split(",")[0] : "Null"}</p></div>
                                    <div className="col-span-2"><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Residential Address</p><p className={`font-semibold ${theme.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                                    <div className="col-span-2"><InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); showToast("Contact details updated successfully."); }} /></div>
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Budget</p><p className={`font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Property Type</p><p className={`font-semibold ${theme.text}`}>{selectedLead.propType || "Pending"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Type of Use</p><p className={`font-semibold ${theme.text}`}>{selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Planning to Buy?</p><p className={`font-semibold ${theme.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Loan Required?</p><p className={`font-semibold ${theme.text}`}>{loanDealLatest?.loan_required || selectedLead.loanPlanned || "Pending"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Status</p><span className={`text-sm font-bold ${selectedLead.status === "Closing" ? "text-amber-500" : selectedLead.status === "Visit Scheduled" ? "text-orange-400" : theme.accentText}`}>{selectedLead.status || "Assigned"}</span></div>
                                    <div className={`col-span-2 p-3 rounded-xl border ${theme.settingsBg}`} style={theme.settingsBgGl}>
                                      <p className={`crm-eyebrow mb-0.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>📍 Site Visit Date</p>
                                      <p className={`text-base font-black ${theme.text}`}>{selectedLead.mongoVisitDate ? formatDate(selectedLead.mongoVisitDate) : "Not Scheduled"}</p>
                                    </div>
                                    {selectedLead.is_lost_lead && (
                                      <div className={`col-span-2 p-3 rounded-xl border ${theme.statusLost}`}>
                                        <p className="crm-eyebrow mb-1">Lost Lead Record</p>
                                        <p className={`text-sm leading-relaxed ${theme.textMuted}`}>{selectedLead.lost_lead_reason || "No reason recorded."}</p>
                                        <p className={`text-[10px] mt-2 ${theme.textFaint}`}>Marked by {selectedLead.lost_lead_marked_by || "Unknown"} on {selectedLead.lost_lead_marked_at ? formatDate(selectedLead.lost_lead_marked_at) : "-"}</p>
                                      </div>
                                    )}
                                  </div>
                                  <div className={`mt-3 border rounded-xl p-3 ${theme.settingsBg}`} style={theme.settingsBgGl}>
                                    <h3 className={`crm-eyebrow mb-2 border-b pb-2 ${theme.sectionTitle} ${theme.sectionBorder}`}>
                                      {selectedLead.source && selectedLead.source !== "N/A" ? `${selectedLead.source} Data` : "Source Data"}
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Primary Source</p><p className={`font-medium text-sm ${theme.text}`}>{selectedLead.source || "N/A"}</p></div>
                                      {selectedLead.source === "Others" && (<div><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Specified Name</p><p className={`font-medium text-sm ${theme.text}`}>{selectedLead.sourceOther}</p></div>)}
                                    </div>

                                    {selectedLead.source === "Channel Partner" ? (
                                      <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-3 gap-3 ${theme.tableBorder}`}>
                                        {[{ label: "CP Name", val: selectedLead.cpName || selectedLead.cp_name }, { label: "CP Company", val: selectedLead.cp_company || selectedLead.cpCompany }, { label: "CP Phone", val: selectedLead.cp_phone || selectedLead.cpPhone }].map(({ label, val }) => (
                                          <div key={label}><p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>{label}</p><p className={`font-medium text-sm ${theme.text}`}>{val || "N/A"}</p></div>
                                        ))}
                                      </div>
                                    ) : selectedLead.source === "Referral" && selectedLead.referral_name ? (
                                      <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-3 gap-3 ${theme.tableBorder}`}>
                                        <div>
                                          <p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>Referred By</p>
                                          <p className={`font-medium text-sm ${theme.text}`}>{selectedLead.referral_name}</p>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="mt-3">
                                    <SiteVisitScheduler
                                      lead={selectedLead}
                                      adminUser={adminUser}
                                      isDark={isDark}
                                      theme={theme}
                                      onSuccess={refetch}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <LoanDealView lead={selectedLead} booking={loanDealBooking} loanUpdate={loanDealLatest} isDark={isDark} t={theme} />
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-1 flex-shrink-0">
                              <button className={`border flex flex-col items-center justify-center py-2.5 rounded-xl transition-all cursor-pointer gap-1 ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30 hover:bg-[#9E217B] text-[#d946a8] hover:text-white" : "bg-[#9E217B]/10 border-[#9E217B]/30 hover:bg-[#9E217B] text-[#9E217B] hover:text-white"}`}><FaMicrophone className="text-base" /><span className="font-bold text-[10px]">Browser Call</span></button>
                              <button onClick={() => setIsWaModalOpen(true)} className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-2.5 rounded-xl transition-all cursor-pointer gap-1"><FaWhatsapp className="text-base" /><span className="font-bold text-[10px]">WhatsApp</span></button>
                              <CallingButtons leadId={selectedLead?.id ?? null} phone={selectedLead?.phone} leadName={selectedLead?.name} isDark={isDark} iconClass="text-base" paddingClass="py-2.5" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* RIGHT PANEL: FOLLOW-UPS — 65% on small laptops (lg), 60% on desktop (xl) */}
                      <div className={`w-full lg:w-[58%] xl:w-[55%] flex flex-col rounded-xl overflow-hidden shadow-2xl min-h-[500px] lg:h-full lg:min-h-0 border ${theme.chatPanel}`} style={theme.chatPanelGl}>
                        <div className={`flex-1 p-2 overflow-y-auto custom-scrollbar flex flex-col gap-2 ${theme.chatArea}`}>
                          <div className="flex justify-start">
                            <div className={`rounded-xl rounded-tl-none p-3 max-w-[85%] shadow-md ${theme.fupSalesform}`}>
                              <div className={`flex justify-between items-center mb-2 gap-3`}>
                                <span className={`font-bold text-sm ${theme.accentText}`}>System (Front Desk)</span>
                                <span className={`text-[10px] ${theme.textFaint}`}>{formatDate(selectedLead.created_at)}</span>
                              </div>
                              <p className={`text-sm leading-relaxed ${theme.textMuted}`}>Lead assigned to {selectedLead.assigned_to}. Action required.</p>
                            </div>
                          </div>
                          {currentLeadFollowUps.map((msg: any, idx: number) => {
                            const isLoan = msg.message?.includes("🏦 Loan Update");
                            const isSF = msg.message?.includes("📝 Detailed Salesform Submitted");
                            const isClosing = msg.message?.includes("✅ Lead Marked as Closing");
                            const isTransfer = msg.message?.includes("🔄 Lead Transferred");
                            const bubble = isLoan ? theme.fupLoan : isSF ? theme.fupSalesform : isClosing ? theme.fupClosing : isTransfer ? theme.fupTransfer : theme.fupDefault;
                            return (
                              <div key={idx} className="flex justify-start">
                                <div className={`rounded-xl rounded-tl-none p-3 max-w-[90%] shadow-md ${bubble}`}>
                                  <div className="flex justify-between items-center mb-2 gap-3">
                                    <span className={`font-bold text-sm ${theme.text}`}>
                                      {msg.createdBy === "admin" ? `${msg.salesManagerName || "Admin"} (Admin)` : msg.salesManagerName}
                                    </span>
                                    <span className={`text-[10px] flex-shrink-0 ${theme.textFaint}`}>{formatDate(msg.createdAt)}</span>
                                  </div>
                                  <p className={`text-sm whitespace-pre-wrap leading-relaxed ${theme.textMuted}`}>{msg.message}</p>
                                </div>
                              </div>
                            );
                          })}
                          <div ref={followUpEndRef} />
                        </div>
                        <form onSubmit={handleSendCustomNote} className={`p-3 border-t flex gap-2 items-center flex-shrink-0 ${theme.header} ${theme.tableBorder}`} style={theme.headerGlass}>
                          <input type="text" value={customNote} onChange={e => setCustomNote(e.target.value)} placeholder="Add admin note..."
                            className={`flex-1 rounded-xl px-3 py-2 sm:py-2.5 text-sm outline-none transition-colors border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`} />
                          <button type="submit" className={`w-9 h-9 flex-shrink-0 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg ${isDark ? "bg-[#9E217B] hover:bg-[#b8268f]" : "bg-[#9E217B] hover:bg-[#8a1d6b]"}`}>
                            <FaPaperPlane className="text-xs ml-[-1px]" />
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            {isWaModalOpen && selectedLead && (
              <WhatsAppConversationPanel
                theme={theme}
                isDark={isDark}
                initialLeadId={Number(selectedLead.id)}
                onClose={() => setIsWaModalOpen(false)}
              />
            )}

            {showLostModal && selectedLead && (
              <LostLeadModal
                lead={selectedLead}
                reason={lostReason}
                error={lostError}
                isSaving={isSavingLost}
                isDark={isDark}
                theme={theme}
                onReasonChange={(value) => { setLostReason(value); if (lostError) setLostError(""); }}
                onClose={() => setShowLostModal(false)}
                onSubmit={handleMarkLostLead}
              />
            )}

            <BookingFormModal
              isOpen={isClosingModalOpen}
              onClose={() => setIsClosingModalOpen(false)}
              lead={selectedLead}
              user={adminUser}
              isDark={isDark}
              onSuccess={handleBookingSuccess}
            />

            {isTransferModalOpen && selectedLead && (
              <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-5 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
                <div className={`rounded-xl w-full max-w-lg shadow-2xl border overflow-hidden ${theme.modalCard}`} style={theme.modalGlass}>
                  <div className={`p-5 border-b flex justify-between items-center ${isDark ? "bg-purple-900/20 border-purple-500/20" : "bg-purple-50 border-purple-200"}`}>
                    <div>
                      <h2 className={`text-medium font-bold flex items-center gap-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}><FaExchangeAlt /> Transfer Lead #{selectedLead.sr_no || selectedLead.id}</h2>
                      <p className={`text-xs mt-1 ${theme.textMuted}`}>Transferring: <strong>{selectedLead.name}</strong></p>
                    </div>
                    <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }} className={`p-2 ${theme.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
                  </div>
                  <div className={`p-6 ${theme.modalInner}`}>
                    <div className="mb-5">
                      <label className={`block text-sm font-bold mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Transfer to Manager *</label>
                      <select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}
                        className={`w-full rounded-xl p-5 text-sm outline-none transition-colors border-2 cursor-pointer ${isDark ? "bg-[#14141B] border-purple-500/40 text-white" : "bg-white border-purple-300 text-[#1A1A1A]"}`}>
                        <option value="" disabled>-- Select Manager --</option>
                        {isFetchingManagers ? <option disabled>Loading managers…</option> : salesManagers.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).length > 0 ? salesManagers.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).map((m: any, i: number) => <option key={i} value={m.name}>{m.name} ({String(m.role || "Manager").replace("_", " ")})</option>) : <option disabled>No other assignees available</option>}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm font-bold mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Handover Summary *</label>
                      <textarea required value={transferNote} onChange={e => setTransferNote(e.target.value)} rows={7}
                        placeholder="Summarize actions, discussions, interest level..."
                        className={`w-full rounded-xl px-4 py-3 sm:py-4 text-sm outline-none resize-none leading-relaxed border-2 transition-colors custom-scrollbar ${isDark ? "bg-[#14141B] border-purple-500/30 text-white focus:border-purple-500" : "bg-white border-purple-200 text-[#1A1A1A] focus:border-purple-500"}`} />
                    </div>
                  </div>
                  <div className={`p-5 border-t flex justify-end gap-3 ${theme.modalHeader} ${theme.tableBorder}`}>
                    <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }}
                      className={`px-4 py-3 sm:py-4.5 rounded-lg font-bold cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500`}>Cancel</button>
                    <button onClick={handleTransferLead} disabled={isTransferring || !transferTarget || !transferNote.trim()}
                      className={`px-8 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2 ${isTransferring || !transferTarget || !transferNote.trim() ? "opacity-50 cursor-not-allowed bg-purple-400 text-white" : "cursor-pointer bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"}`}>
                      {isTransferring ? "Transferring…" : <><FaExchangeAlt /> Confirm Transfer</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );



}

// ============================================================================
// ADMIN SITE HEAD VIEW
// ============================================================================
// ============================================================================
// ADMIN SITE HEAD VIEW
// ============================================================================
function AdminSiteHeadView({ siteHeads, allLeads, followUps, isLoading, adminUser, refetch, theme, isDark }: any) {
  const [selectedSiteHead, setSelectedSiteHead] = useState<any>(null);
  const [searchSiteHead, setSearchSiteHead] = useState("");
  const [activeSection, setActiveSection] = useState<"assignedTable" | "closed">("assignedTable");
  const [subView, setSubView] = useState<"list" | "detail">("list");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<"personal" | "loan">("personal");
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Form States
  const [showSalesForm, setShowSalesForm] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [salesForm, setSalesForm] = useState({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
  const [customNote, setCustomNote] = useState("");
  const [toastMsg, setToastMsg] = useState<{ title: string; icon: any; color: string } | null>(null);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState<"all" | "active" | "lost">("all");
  const [showLostLeads, setShowLostLeads] = useState(true);
  const [showNGDLeads, setShowNGDLeads] = useState(true);
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState("");
  const [isSavingLost, setIsSavingLost] = useState(false);
  const [optimisticLeadOverrides, setOptimisticLeadOverrides] = useState<Record<string, any>>({});
  const [isReopening, setIsReopening] = useState(false);

  const [bookingData, setBookingData] = useState<any>(null);
  const [showBookingView, setShowBookingView] = useState(false);

  const fetchBookingForLead = async (leadId: string | number) => {
    try {
      const res = await fetch(`/api/booking-applications?lead_id=${leadId}`);
      const json = await res.json();
      if (json.success && json.data?.length > 0) {
        setBookingData(json.data[0]);
        return true;   // ← NEW
      }
      setBookingData(null);
      return false;    // ← NEW
    } catch {
      setBookingData(null);
      return false;    // ← NEW
    }
  };

  // Upgrade the summary held in `bookingData` (see fetchLoanDealData) to the full
  // row, then show the booking view. Routing the button through here keeps the
  // 121-column payload off the lead-detail path without ClosedLeadBookingView ever
  // rendering against the summary.
  const openBookingView = async (leadId: string | number) => {
    const hasBooking = await fetchBookingForLead(leadId);
    if (hasBooking) setShowBookingView(true);
  };

  // Loan & Deal Tracking panel — independent of bookingData/fetchBookingForLead above,
  // which (when wired up) swaps the whole detail view to ClosedLeadBookingView.
  const [loanDealBooking, setLoanDealBooking] = useState<any>(null);
  const [loanDealLatest, setLoanDealLatest] = useState<any>(null);
  // One pass serves both consumers of the booking row.
  //
  // `loanDealBooking` (the Loan & Deal panel) and `bookingData` (the booking view)
  // came from the SAME URL via two separate effects, and both read `data[0]` — the
  // identical row. Browsers do not coalesce concurrent fetches to the same URL, so
  // that was one wasted request and two wasted Neon round trips (~168 ms) per lead
  // open. The loan request also waited on the booking request; they are
  // independent and now run together.
  // PAYLOAD: `view=summary` is BOOKING_LIST_SQL (24 explicit columns, one join).
  // The default `view=full` is BOOKING_SELECT_SQL: 121 columns across 6 joins, 2
  // views and a json_agg, including PAN, Aadhaar, signature data and document URLs.
  // Nothing on the lead-detail screen reads any of that — the summary enables the
  // "View Booking Form" button and feeds LoanDealView/LoanDealForm, which read only
  // `id` and `agreement_value`. openBookingView() loads the full row on click.
  const fetchLoanDealData = useCallback(async (leadId: string | number) => {
    const [bookingOutcome, loanOutcome] = await Promise.allSettled([
      fetch(`/api/booking-applications?lead_id=${leadId}&view=summary`).then((r) => r.json()),
      fetch(`/api/loan?lead_id=${leadId}&latest=1`).then((r) => r.json()),
    ]);

    const bookingJson = bookingOutcome.status === "fulfilled" ? bookingOutcome.value : null;
    const booking =
      bookingJson?.success && bookingJson.data?.length > 0 ? bookingJson.data[0] : null;
    setLoanDealBooking(booking);
    setBookingData(booking);

    const loanJson = loanOutcome.status === "fulfilled" ? loanOutcome.value : null;
    const rows = loanJson?.success ? loanJson.data ?? [] : [];
    setLoanDealLatest(rows.length > 0 ? rows[rows.length - 1] : null);
  }, []);

  // Keyed on the lead ID, not the lead OBJECT. `selectedLead` is rebuilt from the
  // `mergedLeads` memo on every refetch(), so a `[selectedLead]` dependency
  // re-fired this fetch after every follow-up note, sales-form submit and status
  // change while a lead was simply sitting open.
  useEffect(() => {
    if (selectedLead?.id) fetchLoanDealData(selectedLead.id);
    else {
      setLoanDealBooking(null);
      setLoanDealLatest(null);
      setBookingData(null);
      setShowBookingView(false);
    }
  }, [selectedLead?.id, fetchLoanDealData]);

  // Transfer States
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferNote, setTransferNote] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [salesManagers, setSalesManagers] = useState<any[]>([]);
  const [isFetchingManagers, setIsFetchingManagers] = useState(true);
  // ── Auto-drill into a lead when navigated from Enquiry Overview ──
  useEffect(() => {
    const raw = localStorage.getItem("crm_drill_lead");
    if (!raw) return;
    try {
      const drillLead = JSON.parse(raw);
      if (drillLead._drillTab !== "site_head") return;
      localStorage.removeItem("crm_drill_lead");
      const sh = siteHeads.find((s: any) => s.name === drillLead.assigned_to);
      if (sh) {
        setSelectedSiteHead(sh);
        setSelectedLead(drillLead);
        setSubView("detail"); prefillSalesForm(drillLead); setShowSalesForm(false); setShowLoanForm(false);
      }
    } catch { }
  }, [siteHeads]);
  // ── Lazy load state ───────────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadLessRef = useRef<HTMLDivElement>(null);

  const showToast = (title: string, color = "green") => {
    setToastMsg({ title, icon: <FaCheckCircle />, color });
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleBookingSuccess = async (booking: any) => {
    setIsClosingModalOpen(false);
    showToast(`Booking ${booking.booking_number} confirmed successfully!`, "green");
    if (selectedLead) {
      setOptimisticLeadOverrides(prev => ({
        ...prev,
        [selectedLead.id]: { ...selectedLead, status: "Closing" }
      }));
    }
    await refetch();
  };





  // Fetch managers for the transfer dropdown
  useEffect(() => {
    setIsFetchingManagers(true);
    Promise.all([
      fetch("/api/users/sales-manager"),
      fetch("/api/users/site-head")
    ]).then(async ([resSM, resSH]) => {
      let combined = [];
      if (resSM.ok) { const j = await resSM.json(); combined.push(...(j.data || j || [])); }
      if (resSH.ok) { const j = await resSH.json(); combined.push(...(j.data || j || [])); }
      setSalesManagers(combined);
    }).catch(() => { }).finally(() => setIsFetchingManagers(false));
  }, []);

  const currentLeadFollowUps = useMemo(() =>
    (followUps || []).filter((f: any) => String(f.leadId) === String(selectedLead?.id)),
    [followUps, selectedLead]);

  const isLeadLocked = !!selectedLead && (selectedLead.status === "Closing" || selectedLead.status === "Closed" || !!selectedLead.closingDate || !!selectedLead.is_lost_lead);

  useEffect(() => {
    if (subView === "detail") followUpEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentLeadFollowUps, subView, detailTab]);

  // Enrich Leads with Follow-up Data (Copied exact logic from ReceptionistView)
  const mergedLeads = useMemo(() => {
    const fupIndex = indexFollowUpsByLead(followUps);
    const sourceLeads = updateLeadRestoreState(allLeads, null).map((lead: any) => ({
      ...lead,
      ...(optimisticLeadOverrides[String(lead.id)] || {}),
    }));
    return sourceLeads.map((lead: any) => {
      const lf = fupIndex.get(String(lead.id)) || EMPTY_FUPS;
      const salesForms = lf.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
      const latestMsg = salesForms.length > 0 ? salesForms[salesForms.length - 1].message : "";
      const g = (field: string) => {
        if (!latestMsg) return "Pending";
        const m = latestMsg.match(new RegExp(`• ${field}: (.*)`));
        return m ? m[1].trim() : "Pending";
      };
      const loanUpdates = lf.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
      let loanStatus = "N/A";
      if (loanUpdates.length > 0) {
        const msg = loanUpdates[loanUpdates.length - 1].message;
        const mS = msg.match(/• Status: (.*)/); if (mS) loanStatus = mS[1].trim();
      }
      const visitsWithDate = lf.filter((f: any) => f.siteVisitDate?.trim());
      const mongoVisitDate = visitsWithDate.length > 0 ? visitsWithDate[visitsWithDate.length - 1].siteVisitDate : null;
      const closingFups = lf.filter((f: any) => f.message?.includes("✅ Lead Marked as Closing"));
      const reopenFups = lf.filter((f: any) => f.message?.includes("↩️ Lead Reopened"));
      const lastReopenAt = reopenFups.length > 0 ? new Date(reopenFups[reopenFups.length - 1].createdAt).getTime() : 0;
      const closingFupsSinceReopen = closingFups.filter((f: any) => new Date(f.createdAt).getTime() > lastReopenAt);
      const closingDate = closingFupsSinceReopen.length > 0 ? closingFupsSinceReopen[closingFupsSinceReopen.length - 1].createdAt : null;
      const sfBudget = g("Budget");
      const activeBudget = sfBudget !== "Pending" && sfBudget !== "N/A" ? sfBudget : (lead.budget || "Pending");

      return {
        ...lead,
        propType: (g("Property Type") !== "Pending" && g("Property Type") !== "N/A") ? g("Property Type") : (lead.configuration || "Pending"),
        salesBudget: activeBudget,
        useType: g("Use Type") !== "Pending" ? g("Use Type") : (lead.purpose || "Pending"),
        leadInterestStatus: g("Lead Status"),
        loanStatus, mongoVisitDate, closingDate,
        allFollowUps: lf,
        status: lead.status === "Closing" ? "Closing" : mongoVisitDate ? "Visit Scheduled" : lead.status,
      };
    });
  }, [allLeads, followUps, optimisticLeadOverrides]);

  useEffect(() => {
    if (!selectedLead) return;
    const updated = mergedLeads.find((lead: any) => String(lead.id) === String(selectedLead.id));
    if (updated) setSelectedLead(updated);
  }, [mergedLeads, selectedLead?.id]);

  // Derived Datasets for Tabs
  const siteHeadName = selectedSiteHead?.name ?? "";
  const applyLostVisibility = useCallback((lead: any) => {
    let passNGD = true;
    const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "Non Qualified Lead" || lead.leadInterestStatus === "Non Qualified Leads" || lead.leadInterestStatus === "Non qualified Lead";
    if (!showNGDLeads && isNGD) {
      passNGD = false;
    }
    if (!passNGD) return false;

    if (leadStatusFilter === "lost") return !!lead.is_lost_lead;
    if (leadStatusFilter === "active") return !lead.is_lost_lead;
    return showLostLeads || !lead.is_lost_lead;
  }, [leadStatusFilter, showLostLeads, showNGDLeads]);
  const assignedLeads = useMemo(() => mergedLeads.filter((l: any) => l.assigned_to === siteHeadName && l.status !== "Closing" && !l.closingDate && applyLostVisibility(l)), [mergedLeads, siteHeadName, applyLostVisibility]);
  const closedLeads = useMemo(() => mergedLeads.filter((l: any) => l.assigned_to === siteHeadName && (l.status === "Closing" || l.status === "Closed" || !!l.closingDate)), [mergedLeads, siteHeadName]);
  const filteredSiteHeads = (siteHeads || []).filter((s: any) => s.name?.toLowerCase().includes(searchSiteHead.toLowerCase()));
  // ── Bottom sentinel: load 20 more on scroll down ──────────────────────────────
  useEffect(() => {
    const currentTotal = activeSection === "assignedTable" ? assignedLeads.length : closedLeads.length;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, currentTotal));
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [activeSection, assignedLeads.length, closedLeads.length]);

  // ── Top sentinel: unload back to 20 when scrolled fully back up ───────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount > 20) {
          setVisibleCount(20);
        }
      },
      { threshold: 1.0 }
    );
    if (loadLessRef.current) observer.observe(loadLessRef.current);
    return () => observer.disconnect();
  }, [visibleCount]);

  // ── Reset count when section or site head changes ─────────────────────────────
  useEffect(() => {
    setVisibleCount(20);
  }, [activeSection, selectedSiteHead?.name]);
  // Helpers for Forms
  const prefillSalesForm = (targetLead?: any) => {
    const l = targetLead || selectedLead;
    if (!l) return;
    const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id));
    const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
    if (sf.length === 0) return;
    const msg = sf[sf.length - 1].message;
    const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; };
    setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" });
  };

  const handleSendCustomNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!customNote.trim() || !selectedLead) return;
    const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: "admin", message: customNote, siteVisitDate: null, createdAt: new Date().toISOString() };
    setCustomNote("");
    try { await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }); refetch(); } catch { }
  };

  // handleSendWhatsApp was removed with the wa.me workflow. It logged that a
  // message had been composed and then handed off to another app, so the CRM
  // never learned whether it was delivered or what the customer replied.
  // Sending now goes through WhatsAppConversationPanel →
  // POST /api/whatsapp/conversations/:id/messages.
  const handleSalesFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const msg = `📝 Detailed Salesform Submitted:\n• Property Type: ${salesForm.propertyType || "N/A"}\n• Location: ${salesForm.location || "N/A"}\n• Budget: ${salesForm.budget || "N/A"}\n• Use Type: ${salesForm.useType || "N/A"}\n• Planning to Purchase: ${salesForm.purchaseDate || "N/A"}\n• Loan Planned: ${salesForm.loanPlanned || "N/A"}\n• Lead Status: ${salesForm.leadStatus || "N/A"}\n• Site Visit Requested: ${salesForm.siteVisit ? formatDate(salesForm.siteVisit) : "No"}`;
    const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: "admin", message: msg, siteVisitDate: salesForm.siteVisit || null, createdAt: new Date().toISOString() };
    const ns = salesForm.siteVisit ? "Visit Scheduled" : selectedLead.status;
    setShowSalesForm(false);
    setSalesForm({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: ns }) });
      refetch();
    } catch { }
  };

  // handleBookingSuccess and fetchBookingForLead are defined in the admin panel block above


  const handleReopenLead = async () => {
    if (!selectedLead || selectedLead.status !== "Closing") return;
    setIsReopening(true);
    try {
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Interested" }) });
      const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: "admin", message: `↩️ Lead Reopened by ${adminUser.name} (Admin)`, siteVisitDate: null, createdAt: new Date().toISOString() };
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      setToastMsg({ title: `${selectedLead.name} reopened`, icon: <FaCheckCircle />, color: "blue" });
      setTimeout(() => setToastMsg(null), 3000);
      refetch();
    } catch { }
    finally { setIsReopening(false); }
  };

  const openLostLeadModal = (lead = selectedLead) => {
    if (!lead || lead.is_lost_lead) return;
    setSelectedLead(lead);
    setLostReason("");
    setLostError("");
    setShowLostModal(true);
  };

  const handleMarkLostLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const reason = lostReason.trim();
    if (reason.length < 10) {
      setLostError("Reason must be at least 10 characters.");
      return;
    }
    setIsSavingLost(true);
    try {
      const json = await markLostLeadApi({ leadId: selectedLead.id, reason, markedBy: adminUser.name });
      if (!json.success) {
        setLostError(json.message || "Could not mark this lead as lost.");
        return;
      }
      setSelectedLead(json.data);
      setShowLostModal(false);
      showToast(`${selectedLead.name} marked as Lost Lead`, "red");
      refetch();
    } catch {
      setLostError("Network error. Please try again.");
    } finally {
      setIsSavingLost(false);
    }
  };

  const handleRestoreLead = async (lead = selectedLead) => {
    if (!lead || !lead.is_lost_lead || isSavingLost) return;
    const leadId = String(lead.id);
    const optimisticLead = {
      ...lead,
      is_lost_lead: false,
      lost_lead_reason: null,
      lost_lead_marked_at: null,
      lost_lead_marked_by: null,
      lost_reason: null,
      lost_marked_at: null,
      lost_marked_by: null,
    };

    setIsSavingLost(true);
    setOptimisticLeadOverrides(prev => ({ ...prev, [leadId]: optimisticLead }));
    if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(optimisticLead);

    try {
      const json = await restoreLeadApi({ leadId: lead.id, restoredBy: adminUser.name });
      if (!json.success) {
        setOptimisticLeadOverrides(prev => {
          const next = { ...prev };
          delete next[leadId];
          return next;
        });
        if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(lead);
        showToast(json.message || "Could not restore lead", "red");
        return;
      }
      setOptimisticLeadOverrides(prev => ({ ...prev, [leadId]: json.data }));
      if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(json.data);
      showToast(`${lead.name} restored to Active`, "green");
      await refetch();
      setOptimisticLeadOverrides(prev => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
    } catch {
      setOptimisticLeadOverrides(prev => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(lead);
      showToast("Network error while restoring lead", "red");
    } finally {
      setIsSavingLost(false);
    }
  };

  const handleTransferLead = async () => {
    if (!selectedLead || !transferTarget || !transferNote.trim()) return;
    setIsTransferring(true);
    try {
      const res = await fetch("/api/leads/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: selectedLead.id, transfer_to: transferTarget, transfer_note: transferNote, transferred_by: adminUser.name }) });
      if (!res.ok) throw new Error("Transfer failed");
      setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget("");
      showToast(`Lead #${selectedLead.sr_no || selectedLead.id} transferred to ${transferTarget}!`);
      setSubView("list"); setSelectedLead(null);
      refetch();
    } catch (e: any) { alert(e.message ?? "Transfer failed."); }
    finally { setIsTransferring(false); }
  };

  // Status Classes & Sections
  const statusCls = (status: string) => {
    const s = status || "Assigned";
    if (s === "New Lead") return "whitespace-nowrap " + (isDark ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50");
    if (s === "Assigned") return "whitespace-nowrap " + (isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50");
    if (s === "Contacted") return "whitespace-nowrap " + (isDark ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50");
    if (s === "Interested") return "whitespace-nowrap " + (isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50");
    if (s === "Visit Scheduled") return "whitespace-nowrap " + (isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50");
    if (s === "Completed") return "whitespace-nowrap " + (isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50");
    if (s === "Closing" || s === "Closed") return "whitespace-nowrap " + (isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50");
    return "whitespace-nowrap " + (isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50");
  };

  const sections = [
    { key: "assignedTable", label: "Assigned Lead Table", icon: "🗃️", count: assignedLeads.length, desc: `Active pipeline managed by ${siteHeadName}` },
    { key: "closed", label: "Closed Leads", icon: "✅", count: closedLeads.length, desc: `Deals successfully closed by ${siteHeadName}` }
  ] as const;

  // Reusable Table Component
  const renderTable = (leads: any[]) => (
    <div className={`rounded-xl overflow-hidden border ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className="overflow-x-auto custom-scrollbar">
        <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />

        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className={`text-[10px] sm:text-xs uppercase ${theme.tableHead} ${theme.textHeader}`}>
            <tr>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Lead ID</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Client</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Budget</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Phone</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Source</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Status</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Interest</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Site Visit</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Date</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${theme.tableDivide}`}>
            {isLoading ? (
              <tr><td colSpan={9} className={`text-center py-6 sm:py-8 text-xs sm:text-sm ${theme.textMuted}`}>Syncing…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={9} className={`text-center py-8 sm:py-12 text-xs sm:text-sm ${theme.textMuted}`}>No leads found.</td></tr>
            ) : leads.map((lead: any) => {
              const isLost = !!lead.is_lost_lead;
              const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
              return (
                <tr key={lead.id} className={`transition-colors cursor-pointer ${isLost ? theme.rowLost : isNGD ? theme.rowNGD : theme.tableRow}`} onClick={() => { setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(false); setShowLoanForm(false); }}>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-black text-xs sm:text-sm ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-xs sm:text-sm ${theme.text}`}>{lead.name}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-xs sm:text-sm ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget || "N/A"}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-mono text-[10px] sm:text-xs ${theme.textMuted}`}>{maskPhone(lead.phone, adminUser?.role, lead.assigned_to === adminUser?.name)}</td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs ${theme.textMuted}`}>{lead.source || "—"}</td>
                  <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                    <span className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border flex-shrink-0 ${isLost ? theme.statusLost : isNGD ? theme.statusNGD : statusCls(lead.status)}`}>
                      {isLost ? "Lost" : isNGD ? "NGD" : (lead.status || "Assigned")}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                    {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" ? (
                      <InterestBadge status={lead.leadInterestStatus} size="sm" isDark={isDark} />
                    ) : <span className={`text-[10px] sm:text-xs italic ${theme.textFaint}`}>—</span>}
                  </td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs ${lead.mongoVisitDate ? "text-orange-500 font-semibold" : theme.textFaint}`}>
                    {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : "—"}
                  </td>
                  <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs whitespace-normal min-w-[100px] sm:min-w-[120px] ${theme.textFaint}`}>
                    {formatDate(lead.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* ── BOTTOM SENTINEL — triggers load more ── */}
        {visibleCount < leads.length && (
          <div ref={loadMoreRef} className={`flex items-center justify-center gap-3 py-6 ${theme.textMuted}`}>
            <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
            <span className="text-xs font-medium">Loading more… ({visibleCount} of {leads.length})</span>
          </div>
        )}
        {visibleCount >= leads.length && leads.length > 20 && (
          <div className={`text-center py-2.5 text-xs font-medium ${theme.textFaint}`}>
            ✓ All {leads.length} leads loaded
          </div>
        )}
      </div>
    </div>
  );

  const formInput = `w-full rounded-lg px-4 py-2 text-sm outline-none transition-colors border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;
  const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;
  const [showMobileActions, setShowMobileActions] = useState(false);
  return (
    <div className="flex h-full relative overflow-hidden">
      {toastMsg && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] px-3 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fadeIn ${toastMsg.color === "green" ? "bg-green-600 border-green-400 text-white" : "bg-[#9E217B] border-[#b8268f] text-white"}`}>
          <div className="text-lg">{toastMsg.icon}</div>
          <span className="text-sm font-bold">{toastMsg.title}</span>
        </div>
      )}

      {showLostModal && selectedLead && (
        <LostLeadModal
          lead={selectedLead}
          reason={lostReason}
          error={lostError}
          isSaving={isSavingLost}
          isDark={isDark}
          theme={theme}
          onReasonChange={(value) => { setLostReason(value); if (lostError) setLostError(""); }}
          onClose={() => setShowLostModal(false)}
          onSubmit={handleMarkLostLead}
        />
      )}

      <BookingFormModal
        isOpen={isClosingModalOpen}
        onClose={() => setIsClosingModalOpen(false)}
        lead={selectedLead}
        user={adminUser}
        isDark={isDark}
        onSuccess={handleBookingSuccess}
      />

      {/* Sidebar for Site Heads */}
      {/* MOBILE: 100% width, hidden if a Site Head is selected. DESKTOP: Always visible, fixed 62 width */}
      <div className={`border-r flex-col h-full flex-shrink-0 z-20 shadow-xl ${theme.innerBlock} w-full md:w-62 ${selectedSiteHead ? 'hidden md:flex' : 'flex'}`}>
        <div className={`p-5 border-b ${theme.tableBorder}`}>
          <div className="relative">
            <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${theme.textFaint}`} />
            <input type="text" placeholder="Search Site Heads..." value={searchSiteHead} onChange={e => setSearchSiteHead(e.target.value)}
              className={`w-full rounded-lg pl-9 pr-4 py-2 text-sm outline-none transition-colors ${theme.inputInner} ${theme.text} ${theme.inputFocus}`} />
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${theme.scroll}`} dir="rtl">
          <div dir="ltr" className="min-h-full">
            {isLoading ? <div className={`p-8 text-center text-sm ${theme.textMuted}`}>Loading...</div>
              : filteredSiteHeads.length === 0 ? <div className={`p-8 text-center text-sm ${theme.textMuted}`}>No Site Heads found.</div>
                : filteredSiteHeads.map((sh: any) => {
                  const isSelected = selectedSiteHead?.id === sh.id || selectedSiteHead?.name === sh.name;
                  const count = allLeads.filter((l: any) => l.assigned_to === sh.name).length;
                  return (
                    <div key={sh.id || sh.name} onClick={() => { setSelectedSiteHead(sh); setSubView("list"); setActiveSection("assignedTable"); setSelectedLead(null); }}
                      className={`p-5 flex items-center gap-2 cursor-pointer transition-all border-b ${theme.tableBorder} ${isSelected ? (isDark ? "border-r-4 border-r-[#9E217B] bg-[#9E217B]/10" : "border-r-4 border-r-[#9E217B] bg-pink-50") : "hover:opacity-80 border-r-4 border-r-transparent"}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm flex-shrink-0 ${isSelected ? "bg-[#9E217B]" : isDark ? "bg-[#333] text-gray-400" : "bg-gray-400"}`}>
                        {sh.name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <h3 className={`font-bold truncate text-sm ${theme.text}`}>{sh.name}</h3>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isDark ? "text-[#d946a8] bg-[#9E217B]/10" : "text-[#9E217B] bg-pink-100"}`}>{count} leads</span>
                        </div>
                        <p className={`text-xs truncate capitalize ${theme.textFaint}`}>Site Head</p>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      </div>

      {/* COMBINED MAIN CONTENT AREA */}
      {/* MOBILE: 100% width, only visible if Site Head is selected. DESKTOP: Always visible, takes remaining space */}
      <div className={`flex-1 flex flex-col h-full min-w-0 overflow-hidden ${theme.mainBg} ${selectedSiteHead ? 'flex' : 'hidden md:flex'}`}>

        {/* MOBILE BACK BUTTON */}
        {/* {selectedSiteHead && (
          <div className={`md:hidden flex items-center p-3 border-b flex-shrink-0 bg-white ${theme.tableBorder} ${theme.headerGlass}`}>
            <button
              onClick={() => setSelectedSiteHead(null)}
              className={`flex items-center gap-2 text-sm font-bold hover:opacity-80 ${theme.text}`}
            >
              <FaArrowLeft className={theme.textFaint} />
              Back to Site Heads
            </button>
          </div>
        )} */}

        {!selectedSiteHead ? (
          <div className={`h-full flex flex-col items-center justify-center ${theme.textMuted}`}>
            <FaUniversity className="text-4xl mb-4 opacity-20" />
            <p>Select a Site Head from the left sidebar.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Sub-header */}
            <div className={`p-2 border-b flex justify-between items-center shadow-sm z-10 flex-shrink-0 gap-2 ${theme.header}`} style={theme.headerGlass}>
              <div>
                <h2 className={`text-md font-bold flex items-center gap-2 ${theme.text}`}>
                  <FaUniversity className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"} /> {selectedSiteHead.name}'s Division
                </h2>
              </div>
              <span className={`text-xs px-3 py-1 rounded-full border font-bold flex items-center gap-1.5 ${isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-200 bg-green-50"}`}>
                🟢 Live Sync
              </span>
            </div>

            {/* ── LIST VIEW (Stats + Tables) ── */}
            {subView === "list" && (
              <div className={`flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-6 ${theme.scroll}`}>
                <div className="animate-fadeIn space-y-3 sm:space-y-4 max-w-7xl mx-auto">

                  {/* Tabs / Stats Row */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {sections.map(sec => (
                      <div key={sec.key} onClick={() => setActiveSection(sec.key as any)}
                        className={`rounded-2xl sm:rounded-3xl p-3 sm:p-5 border cursor-pointer transition-all ${activeSection === sec.key ? (isDark ? "bg-[#9E217B]/20 border-[#9E217B]/50" : "bg-[#9E217B]/10 border-[#9E217B]") : `${theme.card} hover:opacity-90`}`}>
                        <div className="flex items-center justify-between mb-1 sm:mb-2">
                          <span className="text-base sm:text-lg">{sec.icon}</span>
                          <span className={`text-md sm:text-2xl font-black ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>{sec.count}</span>
                        </div>
                        <p className={`text-xs sm:text-sm font-bold ${theme.text}`}>{sec.label}</p>
                        <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 leading-tight ${theme.textFaint}`}>{sec.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Table Rendering */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 sm:gap-3 mb-2 sm:mb-4">
                    <h3 className={`text-base sm:text-lg font-bold ${theme.text}`}>
                      {activeSection === "assignedTable" ? "Currently Assigned Leads" : "Successfully Closed Leads"}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {activeSection === "assignedTable" && (
                        <>
                          <select value={leadStatusFilter} onChange={e => setLeadStatusFilter(e.target.value as "all" | "active" | "lost")} className={`rounded-lg px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs outline-none cursor-pointer border ${theme.selectSmall}`}>
                            <option value="all">All Leads</option>
                            <option value="active">Active Leads</option>
                            <option value="lost">Lost Leads</option>
                          </select>
                          <label className={`flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-bold ${theme.textMuted}`}>
                            <input type="checkbox" checked={showLostLeads} onChange={e => setShowLostLeads(e.target.checked)} disabled={leadStatusFilter !== "all"} className="accent-red-500 scale-90 sm:scale-100" />
                            Show Lost
                          </label>
                          <label className={`flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-bold ${theme.textMuted}`}>
                            <input type="checkbox" checked={showNGDLeads} onChange={e => setShowNGDLeads(e.target.checked)} disabled={leadStatusFilter !== "all"} className="accent-[#F97316] scale-90 sm:scale-100" />
                            Show NGD Leads
                          </label>
                        </>
                      )}
                      <button
                        onClick={() => downloadCSV((activeSection === "assignedTable" ? assignedLeads : closedLeads).map(formatLeadForExport), `SiteHead_${activeSection}.csv`)}
                        className={`flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs font-bold border rounded-lg transition-colors hover:opacity-80 ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
                      >
                        <FaDownload size={12} className="sm:w-[14px] sm:h-[14px]" /> Export to CSV
                      </button>
                    </div>
                  </div>
                  {renderTable(activeSection === "assignedTable" ? assignedLeads : closedLeads)}

                </div>
              </div>
            )}

            {/* ── DETAIL VIEW (Full Panel) ── */}
            {subView === "detail" && selectedLead && (
              bookingData && showBookingView ? (
                <div className="animate-fadeIn w-full h-[calc(100vh-130px)] overflow-hidden bg-transparent flex flex-col">
                  <div className="flex items-center p-2 shrink-0 border-b border-white/10 shadow-sm" style={theme.cardGlass}>
                    <button onClick={() => setShowBookingView(false)} className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 border rounded-lg transition-colors cursor-pointer shadow-sm ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                      <FaChevronLeft /> Back to Lead Details
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ClosedLeadBookingView
                      booking={bookingData}
                      lead={selectedLead}
                      isDark={isDark}
                      userRole={adminUser?.role?.toLowerCase() || "admin"}
                      currentUser={adminUser}
                      onRefetch={() => { if (selectedLead) fetchBookingForLead(selectedLead.id); }}
                    />
                  </div>
                </div>
              ) : (
                <div className={`flex-1 overflow-y-auto p-2 ${theme.scroll}`}>
                  <div className="animate-fadeIn max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-130px)]">

                    {/* Detail header with Mobile Toggle */}
                    <div className={`sticky top-0 z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-0 rounded-xl border p-2 shadow-sm flex-shrink-0 ${selectedLead.is_lost_lead ? theme.cardLost : theme.card}`} style={theme.cardGlass}>
                      <div className="flex items-center justify-between w-full sm:w-auto gap-2">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <button onClick={() => { setSubView("list"); setShowSalesForm(false); setShowLoanForm(false); }} className={`w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 flex items-center justify-center border rounded-lg sm:rounded-xl transition-colors cursor-pointer shadow-sm ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                            <FaChevronLeft className="text-[10px] sm:text-xs" />
                          </button>
                          <h1 className={`text-sm sm:text-base lg:text-lg font-bold flex flex-wrap items-center gap-1.5 sm:gap-2 ${theme.text}`}>
                            <span className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"}>#{selectedLead.sr_no || selectedLead.id}</span>
                            <span>{selectedLead.name}</span>
                            {selectedLead.status === "Closing" && (
                              <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusClosing}`}><FaHandshake className="text-[10px] sm:text-xs" /> Closing</span>
                            )}
                            {selectedLead.is_lost_lead ? (
                              <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusLost}`}><FaEyeSlash className="text-[10px] sm:text-xs" /> Lost Lead</span>
                            ) : (selectedLead.status === "NON GENUINE DEMAND (NGD)" || selectedLead.leadStatus === "NON GENUINE DEMAND (NGD)" || selectedLead.leadInterestStatus === "NON GENUINE DEMAND (NGD)") ? (
                              <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusNGD}`}>NON GENUINE DEMAND</span>
                            ) : null}
                          </h1>
                        </div>
                        <button onClick={() => setShowMobileActions(!showMobileActions)} className={`sm:hidden w-8 h-8 flex-shrink-0 flex items-center justify-center border rounded-lg transition-colors shadow-sm ${showMobileActions ? theme.btnPrimary : `${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}`}>
                          <FaChevronDown className={`text-[10px] transition-transform duration-200 ${showMobileActions ? "rotate-180" : ""}`} />
                        </button>
                      </div>

                      <div className={`gap-1.5 sm:gap-2 flex-wrap justify-start sm:justify-end mt-1 sm:mt-0 w-full sm:w-auto pl-9 sm:pl-0 ${showMobileActions ? "flex animate-fadeIn" : "hidden sm:flex"}`}>
                        {bookingData ? (
                          <button onClick={() => openBookingView(selectedLead.id)} className="font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm whitespace-nowrap">
                            <FaEye />Booking Form
                          </button>
                        ) : (
                          <button disabled title="Booking Form has not been submitted yet." className="font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors opacity-50 cursor-not-allowed bg-indigo-400 text-white shadow-sm whitespace-nowrap">
                            <FaEye />Booking Form
                          </button>
                        )}
                        {isLeadLocked ? (
                          <>
                            <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md border flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 whitespace-nowrap ${selectedLead.is_lost_lead ? theme.statusLost : theme.statusClosing}`}>
                              {selectedLead.is_lost_lead ? <><FaEyeSlash className="text-[10px] sm:text-xs" /> Lost Lead • Read Only</> : <><FaCheckCircle className="text-[10px] sm:text-xs" /> Lead Closed • Read Only</>}
                            </span>
                            {selectedLead.is_lost_lead ? (
                              <button onClick={() => handleRestoreLead()} disabled={isSavingLost} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60 whitespace-nowrap`}>
                                <FaCheckCircle /> Restore Lead
                              </button>
                            ) : (
                              <button onClick={handleReopenLead} disabled={isReopening} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60 whitespace-nowrap`}>
                                ↩️ Reopen Lead
                              </button>
                            )}
                          </>
                        ) : (
                          !showSalesForm && !showLoanForm && (
                            <>
                              <button onClick={() => { prefillSalesForm(); setShowSalesForm(true); setShowLoanForm(false); }} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} whitespace-nowrap`}>
                                <FaFileInvoice /> Fill Salesform
                              </button>
                              <button onClick={() => { setShowLoanForm(true); setShowSalesForm(false); }} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnSecondary} whitespace-nowrap`}>
                                <FaUniversity /> Track Loan
                              </button>
                              <button onClick={() => setIsClosingModalOpen(true)} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnWarning} whitespace-nowrap`}>
                                <FaHandshake /> Mark Closing
                              </button>
                              <button onClick={() => openLostLeadModal()} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnDanger} whitespace-nowrap`}>
                                <FaEyeSlash /> Lost Lead
                              </button>
                              <button onClick={() => { setTransferTarget(""); setTransferNote(""); setIsTransferModalOpen(true); }} className={`font-bold px-2 py-1.5 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${isDark ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"} whitespace-nowrap`}>
                                <FaExchangeAlt /> Transfer
                              </button>
                            </>
                          )
                        )}
                      </div>
                    </div>

                    {/* AI voice calling */}
                    <div className="mb-2 mt-2 flex-shrink-0">
                      <BolnaCallWidget
                        leadId={Number(selectedLead.id)}
                        leadName={selectedLead.name}
                        phone={selectedLead.phone}
                        userData={{ project: selectedLead.propType || selectedLead.configuration }}
                        compact
                      />
                    </div>

                    <div className="flex flex-col lg:flex-row gap-2 flex-1 min-h-0 pb-2">
                      {/* LEFT PANEL */}
                      <div className="w-full lg:w-[45%] flex flex-col gap-3 h-full pb-2">
                        {showSalesForm ? (
                          <div className={`rounded-xl border p-5 shadow-xl flex-1 overflow-y-auto custom-scrollbar flex flex-col ${theme.modalCard}`} style={theme.modalGlass}>
                            <div className={`flex justify-between items-center mb-4 border-b pb-3 ${theme.tableBorder}`}>
                              <div>
                                <h3 className={`text-base font-bold ${theme.text}`}>Sales Data Form</h3>
                                <p className={`text-xs mt-0.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Admin override — Lead #{selectedLead.id}</p>
                              </div>
                              <button type="button" onClick={() => setShowSalesForm(false)} className={`p-1 ${theme.textMuted} hover:text-red-500`}><FaTimes /></button>
                            </div>
                            <form onSubmit={handleSalesFormSubmit} className="flex flex-col gap-2 flex-1">
                              <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Property Type?</label><input type="text" placeholder="e.g. 1BHK, 2BHK" value={salesForm.propertyType} onChange={e => setSalesForm({ ...salesForm, propertyType: e.target.value })} className={formInput} /></div>
                              <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Preferred Location?</label><input type="text" placeholder="e.g. Dombivali, Kalyan" value={salesForm.location} onChange={e => setSalesForm({ ...salesForm, location: e.target.value })} className={formInput} /></div>
                              <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Approximate Budget?</label><input type="text" placeholder="e.g. 5 cr" value={salesForm.budget} onChange={e => setSalesForm({ ...salesForm, budget: e.target.value })} className={formInput} /></div>
                              <div className="grid grid-cols-2 gap-3">
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Self-use or Investment?</label>
                                  <select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={formSelect}><option value="">Select</option><option>Self Use</option><option>Investment</option></select>
                                </div>
                                <div><label className={`text-xs mb-1 block ${theme.textMuted}`}>Planning to Purchase?</label>
                                  <select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={formSelect}><option value="">Select</option><option>Immediate</option><option>Next 3 Months</option></select>
                                </div>
                              </div>
                              <div className={`border-t pt-3 ${theme.tableBorder}`}>
                                <label className={`block text-xs font-bold mb-1.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Lead Interest Status *</label>
                                <select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><option value="" disabled>Select Status</option><option>Interested</option><option>Not Interested</option><option>NON GENUINE DEMAND (NGD)</option></select>
                              </div>
                              <div className={`border-t pt-3 ${theme.tableBorder}`}>
                                <label className={`block text-xs font-bold mb-1.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Loan Planned?</label>
                                <select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><option value="" disabled>Select Option</option><option>Yes</option><option>No</option><option>Not Sure</option></select>
                              </div>
                              <div className={`border-t pt-3 ${theme.tableBorder}`}>
                                <label className="text-xs text-orange-400 font-bold mb-1.5 block">Schedule a Site Visit?</label>
                                <input ref={inputRef} type="datetime-local" value={salesForm.siteVisit} onChange={e => setSalesForm({ ...salesForm, siteVisit: e.target.value })} onClick={() => inputRef.current?.showPicker()} className={`${formInput} focus:border-orange-500`} />
                              </div>
                              <button type="submit" className={`mt-auto w-full font-bold py-3 rounded-xl transition-colors ${theme.btnPrimary}`}>Submit Salesform</button>
                            </form>
                          </div>

                        ) : showLoanForm ? (
                          <LoanDealForm
                            lead={selectedLead}
                            booking={loanDealBooking}
                            loanUpdate={loanDealLatest}
                            user={adminUser}
                            isDark={isDark}
                            t={theme}
                            onCancel={() => setShowLoanForm(false)}
                            onSuccess={() => {
                              setShowLoanForm(false);
                              showToast(`Loan & deal data saved for ${selectedLead.name}`);
                              fetchLoanDealData(selectedLead.id);
                              refetch();
                            }}
                          />
                        ) : (
                          <div className="flex flex-col h-full animate-fadeIn">
                            <div className={`flex items-center gap-2 mb-1 border p-1.5 rounded-xl flex-shrink-0 ${theme.tableWrap}`}>
                              <button onClick={() => setDetailTab("personal")} className={`flex-1 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? theme.btnPrimary : `${theme.textMuted} hover:opacity-80`}`}>Personal Information</button>
                              <button onClick={() => setDetailTab("loan")} className={`flex-1 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? theme.btnSecondary : `${theme.textMuted} hover:opacity-80`}`}>Loan Tracking</button>
                            </div>
                            <div className={`flex-1 overflow-y-auto custom-scrollbar rounded-xl p-3 sm:p-6 pt-2 sm:pt-4 pb-4 shadow-lg border ${theme.chatPanel}`} style={theme.chatPanelGl}>
                              {detailTab === "personal" ? (
                                <div>
                                  <div className="grid grid-cols-2 gap-y-3 gap-x-2 sm:gap-x-4 text-xs sm:text-sm">
                                    <InlineContactField label="Email" value={selectedLead.email} fieldType="email" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Phone" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Alt Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); showToast("Contact details updated successfully."); }} />
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Lead Interest</p>{selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} isDark={isDark} /> : <p className={`font-semibold ${theme.text}`}>Pending</p>}</div>
                                    <div className="col-span-1"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Loan Status</p>{selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} isDark={isDark} /></div> : <p className={`font-semibold ${theme.text}`}>N/A</p>}</div>
                                    <div className="col-span-1"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Backdated Entry</p><p className={`font-semibold ${theme.text}`}>{selectedLead.auto_date_enabled === false && selectedLead.enquiry_date ? formatDate(selectedLead.enquiry_date).split(",")[0] : "Null"}</p></div>
                                    <div className="col-span-2"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Residential Address</p><p className={`font-semibold ${theme.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                                    <div className="col-span-2"><InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); showToast("Contact details updated successfully."); }} /></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Budget</p><p className={`font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Property Type</p><p className={`font-semibold ${theme.text}`}>{selectedLead.propType || "Pending"}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Type of Use</p><p className={`font-semibold ${theme.text}`}>{selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Planning to Buy?</p><p className={`font-semibold ${theme.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Loan Required?</p><p className={`font-semibold ${theme.text}`}>{loanDealLatest?.loan_required || selectedLead.loanPlanned || "Pending"}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Status</p><span className={`text-[10px] sm:text-sm font-bold ${selectedLead.status === "Closing" ? "text-amber-500" : selectedLead.status === "Visit Scheduled" ? "text-orange-400" : theme.accentText}`}>{selectedLead.status || "Assigned"}</span></div>
                                    <div className={`col-span-2 p-3 sm:p-5 rounded-xl border ${theme.settingsBg}`} style={theme.settingsBgGl}>
                                      <p className={`crm-eyebrow mb-0.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>📍 Site Visit Date</p>
                                      <p className={`text-sm sm:text-base font-black ${theme.text}`}>{selectedLead.mongoVisitDate ? formatDate(selectedLead.mongoVisitDate) : "Not Scheduled"}</p>
                                    </div>
                                    {selectedLead.is_lost_lead && (
                                      <div className={`col-span-2 p-3 sm:p-5 rounded-xl border ${theme.statusLost}`}>
                                        <p className="crm-eyebrow mb-1">Lost Lead Record</p>
                                        <p className={`text-xs sm:text-sm leading-relaxed ${theme.textMuted}`}>{selectedLead.lost_lead_reason || "No reason recorded."}</p>
                                        <p className={`text-[9px] sm:text-[10px] mt-2 ${theme.textFaint}`}>Marked by {selectedLead.lost_lead_marked_by || "Unknown"} on {selectedLead.lost_lead_marked_at ? formatDate(selectedLead.lost_lead_marked_at) : "-"}</p>
                                      </div>
                                    )}
                                  </div>
                                  <div className={`mt-3 border rounded-xl p-3 sm:p-5 ${theme.settingsBg}`} style={theme.settingsBgGl}>
                                    <h3 className={`crm-eyebrow mb-2 border-b pb-2 ${theme.sectionTitle} ${theme.sectionBorder}`}>
                                      {selectedLead.source && selectedLead.source !== "N/A" ? `${selectedLead.source} Data` : "Source Data"}
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Primary Source</p><p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{selectedLead.source || "N/A"}</p></div>
                                      {selectedLead.source === "Others" && (<div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Specified Name</p><p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{selectedLead.sourceOther}</p></div>)}
                                    </div>

                                    {selectedLead.source === "Channel Partner" ? (
                                      <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 ${theme.tableBorder}`}>
                                        {[{ label: "CP Name", val: selectedLead.cpName || selectedLead.cp_name }, { label: "CP Company", val: selectedLead.cp_company || selectedLead.cpCompany }, { label: "CP Phone", val: selectedLead.cp_phone || selectedLead.cpPhone }].map(({ label, val }) => (
                                          <div key={label}><p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>{label}</p><p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{val || "N/A"}</p></div>
                                        ))}
                                      </div>
                                    ) : selectedLead.source === "Referral" && selectedLead.referral_name ? (
                                      <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 ${theme.tableBorder}`}>
                                        <div>
                                          <p className={`text-[10px] sm:text-xs font-medium mb-1 ${theme.textFaint}`}>Referred By</p>
                                          <p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{selectedLead.referral_name}</p>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="mt-3">
                                    <SiteVisitScheduler
                                      lead={selectedLead}
                                      adminUser={adminUser}
                                      isDark={isDark}
                                      theme={theme}
                                      onSuccess={refetch}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <LoanDealView lead={selectedLead} booking={loanDealBooking} loanUpdate={loanDealLatest} isDark={isDark} t={theme} />
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-2 flex-shrink-0">
                              <button className={`border flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1 ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30 hover:bg-[#9E217B] text-[#d946a8] hover:text-white" : "bg-[#9E217B]/10 border-[#9E217B]/30 hover:bg-[#9E217B] text-[#9E217B] hover:text-white"}`}><FaMicrophone className="text-sm sm:text-lg" /><span className="font-bold text-[9px] sm:text-[10px]">Browser Call</span></button>
                              <button onClick={() => setIsWaModalOpen(true)} className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1"><FaWhatsapp className="text-sm sm:text-lg" /><span className="font-bold text-[9px] sm:text-[10px]">WhatsApp</span></button>
                              <CallingButtons leadId={selectedLead?.id ?? null} phone={selectedLead?.phone} leadName={selectedLead?.name} isDark={isDark} iconClass="text-sm sm:text-lg" paddingClass="py-2 sm:py-3" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* RIGHT PANEL: FOLLOW-UPS (Scrollable and stacked on mobile) */}
                      <div className={`w-full lg:w-[60%] flex flex-col rounded-xl overflow-hidden shadow-2xl min-h-[500px] lg:h-full lg:min-h-0 border ${theme.chatPanel}`} style={theme.chatPanelGl}>
                        <div className={`flex-1 p-3 sm:p-6 overflow-y-auto custom-scrollbar flex flex-col gap-2 sm:gap-3 ${theme.chatArea}`}>
                          {/* System message */}
                          <div className="flex justify-start">
                            <div className={`rounded-xl rounded-tl-none p-3 sm:p-5 max-w-[90%] sm:max-w-[85%] shadow-md ${theme.fupSalesform}`}>
                              <div className={`flex justify-between items-center mb-2 gap-2 sm:gap-3`}>
                                <span className={`font-bold text-[10px] sm:text-sm ${theme.accentText}`}>System (Front Desk)</span>
                                <span className={`text-[9px] sm:text-[10px] ${theme.textFaint}`}>{formatDate(selectedLead.created_at)}</span>
                              </div>
                              <p className={`text-xs sm:text-sm leading-relaxed ${theme.textMuted}`}>Lead assigned to {selectedLead.assigned_to}. Action required.</p>
                            </div>
                          </div>
                          {currentLeadFollowUps.map((msg: any, idx: number) => {
                            const isLoan = msg.message?.includes("🏦 Loan Update");
                            const isSF = msg.message?.includes("📝 Detailed Salesform Submitted");
                            const isClosing = msg.message?.includes("✅ Lead Marked as Closing");
                            const isTransfer = msg.message?.includes("🔄 Lead Transferred");
                            const bubble = isLoan ? theme.fupLoan : isSF ? theme.fupSalesform : isClosing ? theme.fupClosing : isTransfer ? theme.fupTransfer : theme.fupDefault;
                            return (
                              <div key={idx} className="flex justify-start">
                                <div className={`rounded-xl rounded-tl-none p-3 sm:p-5 max-w-[95%] sm:max-w-[90%] shadow-md ${bubble}`}>
                                  <div className="flex justify-between items-center mb-1 sm:mb-2 gap-2 sm:gap-3">
                                    <span className={`font-bold text-xs sm:text-sm ${theme.text}`}>
                                      {msg.createdBy === "admin" ? `${msg.salesManagerName || "Admin"} (Admin)` : msg.salesManagerName}
                                    </span>
                                    <span className={`text-[9px] sm:text-[10px] flex-shrink-0 ${theme.textFaint}`}>{formatDate(msg.createdAt)}</span>
                                  </div>
                                  <p className={`text-xs sm:text-sm whitespace-pre-wrap leading-relaxed ${theme.textMuted}`}>{msg.message}</p>
                                </div>
                              </div>
                            );
                          })}
                          <div ref={followUpEndRef} />
                        </div>
                        <form onSubmit={handleSendCustomNote} className={`p-3 sm:p-5 border-t flex gap-2 sm:gap-3 items-center flex-shrink-0 ${theme.header} ${theme.tableBorder}`} style={theme.headerGlass}>
                          <input type="text" value={customNote} onChange={e => setCustomNote(e.target.value)} placeholder="Add admin note..."
                            className={`flex-1 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 text-[10px] sm:text-sm outline-none transition-colors border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`} />
                          <button type="submit" className={`w-10 h-10 sm:w-12 sm:h-12 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg ${isDark ? "bg-[#9E217B] hover:bg-[#b8268f]" : "bg-[#9E217B] hover:bg-[#8a1d6b]"}`}>
                            <FaPaperPlane className="text-[10px] sm:text-sm ml-[-1px] sm:ml-[-2px]" />
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ── WHATSAPP CONVERSATION PANEL ── */}
            {isWaModalOpen && selectedLead && (
              <WhatsAppConversationPanel
                theme={theme}
                isDark={isDark}
                initialLeadId={Number(selectedLead.id)}
                onClose={() => setIsWaModalOpen(false)}
              />
            )}

            {/* ── TRANSFER MODAL ── */}
            {isTransferModalOpen && selectedLead && (
              <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-5 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
                <div className={`rounded-xl w-full max-w-lg shadow-2xl border overflow-hidden ${theme.modalCard}`} style={theme.modalGlass}>
                  <div className={`p-4 sm:p-5 border-b flex justify-between items-center ${isDark ? "bg-purple-900/20 border-purple-500/20" : "bg-purple-50 border-purple-200"}`}>
                    <div>
                      <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}><FaExchangeAlt /> Transfer Lead #{selectedLead.sr_no || selectedLead.id}</h2>
                      <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 ${theme.textMuted}`}>Transferring: <strong>{selectedLead.name}</strong></p>
                    </div>
                    <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }} className={`p-2 ${theme.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
                  </div>
                  <div className={`p-4 sm:p-6 ${theme.modalInner}`}>
                    <div className="mb-4 sm:mb-5">
                      <label className={`block text-[10px] sm:text-sm font-bold mb-1 sm:mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Transfer to Manager *</label>
                      <select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}
                        className={`w-full rounded-xl p-3 sm:p-5 text-[10px] sm:text-sm outline-none transition-colors border-2 cursor-pointer ${isDark ? "bg-[#14141B] border-purple-500/40 text-white" : "bg-white border-purple-300 text-[#1A1A1A]"}`}>
                        <option value="" disabled>-- Select Manager --</option>
                        {isFetchingManagers ? <option disabled>Loading managers…</option> : salesManagers.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).length > 0 ? salesManagers.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).map((m: any, i: number) => <option key={i} value={m.name}>{m.name} ({String(m.role || "Manager").replace("_", " ")})</option>) : <option disabled>No other assignees available</option>}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-[10px] sm:text-sm font-bold mb-1 sm:mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Handover Summary</label>
                      <textarea required value={transferNote} onChange={e => setTransferNote(e.target.value)} rows={7}
                        placeholder="Summarize actions, discussions, interest level..."
                        className={`w-full rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-[10px] sm:text-sm outline-none resize-none leading-relaxed border-2 transition-colors custom-scrollbar ${isDark ? "bg-[#14141B] border-purple-500/30 text-white focus:border-purple-500" : "bg-white border-purple-200 text-[#1A1A1A] focus:border-purple-500"}`} />
                    </div>
                  </div>
                  <div className={`p-4 sm:p-5 border-t flex justify-end gap-2 sm:gap-3 ${theme.modalHeader} ${theme.tableBorder}`}>
                    <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }}
                      className={`px-3 py-2 sm:px-4 sm:py-3 rounded-lg font-bold text-[10px] sm:text-sm cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500`}>Cancel</button>
                    <button onClick={handleTransferLead} disabled={isTransferring || !transferTarget || !transferNote.trim()}
                      className={`px-4 py-2 sm:px-8 sm:py-2.5 rounded-lg font-bold text-[10px] sm:text-sm transition-colors flex items-center gap-1.5 sm:gap-2 ${isTransferring || !transferTarget || !transferNote.trim() ? "opacity-50 cursor-not-allowed bg-purple-400 text-white" : "cursor-pointer bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"}`}>
                      {isTransferring ? "Transferring…" : <><FaExchangeAlt /> Confirm Transfer</>}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// RECEPTIONIST VIEW
// ============================================================================
function ReceptionistView({ receptionists, allLeads, followUps, isLoading, refetch, theme, isDark, adminUser }: any) {
  const [assignedTableFilter, setAssignedTableFilter] = useState<"working" | "all">("working");
  const [selectedReceptionist, setSelectedReceptionist] = useState<any>(null);
  const [searchRecep, setSearchRecep] = useState("");
  const [activeSection, setActiveSection] = useState<"enquiries" | "assignedTable" | "closed">("enquiries");
  const [subView, setSubView] = useState<"list" | "detail">("list");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Full detail panel state ──────────────────────────────────────────
  const [detailTab, setDetailTab] = useState<"personal" | "loan">("personal");
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [showSalesForm, setShowSalesForm] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [salesForm, setSalesForm] = useState({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
  const [customNote, setCustomNote] = useState("");
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferNote, setTransferNote] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  // ── Reassign state (fix wrong manager on any lead) ──
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState("");
  const [reassignNote, setReassignNote] = useState("");
  const [isReassigning, setIsReassigning] = useState(false);
  const [salesManagers, setSalesManagers] = useState<any[]>([]);
  const [siteHeads, setSiteHeads] = useState<any[]>([]);
  const [isFetchingManagers, setIsFetchingManagers] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState("");
  const [isSavingLost, setIsSavingLost] = useState(false);
  const [optimisticLeadOverrides, setOptimisticLeadOverrides] = useState<Record<string, any>>({});

  const [bookingData, setBookingData] = useState<any>(null);
  const [showBookingView, setShowBookingView] = useState(false);

  const fetchBookingForLead = async (leadId: string | number) => {
    try {
      const res = await fetch(`/api/booking-applications?lead_id=${leadId}`);
      const json = await res.json();
      if (json.success && json.data?.length > 0) {
        setBookingData(json.data[0]);
        return true;   // ← NEW
      }
      setBookingData(null);
      return false;    // ← NEW
    } catch {
      setBookingData(null);
      return false;    // ← NEW
    }
  };

  // Upgrade the summary held in `bookingData` (see fetchLoanDealData) to the full
  // row, then show the booking view. Routing the button through here keeps the
  // 121-column payload off the lead-detail path without ClosedLeadBookingView ever
  // rendering against the summary.
  const openBookingView = async (leadId: string | number) => {
    const hasBooking = await fetchBookingForLead(leadId);
    if (hasBooking) setShowBookingView(true);
  };

  // Loan & Deal Tracking panel — independent of bookingData/fetchBookingForLead above,
  // which (when wired up) swaps the whole detail view to ClosedLeadBookingView.
  const [loanDealBooking, setLoanDealBooking] = useState<any>(null);
  const [loanDealLatest, setLoanDealLatest] = useState<any>(null);
  // One pass serves both consumers of the booking row — see the identical
  // consolidation in the admin panel above. Two effects were fetching the SAME
  // URL concurrently and both reading `data[0]`, and the loan request waited on
  // the booking request for no reason.
  // PAYLOAD: `view=summary` is BOOKING_LIST_SQL (24 explicit columns, one join).
  // The default `view=full` is BOOKING_SELECT_SQL: 121 columns across 6 joins, 2
  // views and a json_agg, including PAN, Aadhaar, signature data and document URLs.
  // Nothing on the lead-detail screen reads any of that — the summary enables the
  // "View Booking Form" button and feeds LoanDealView/LoanDealForm, which read only
  // `id` and `agreement_value`. openBookingView() loads the full row on click.
  const fetchLoanDealData = useCallback(async (leadId: string | number) => {
    const [bookingOutcome, loanOutcome] = await Promise.allSettled([
      fetch(`/api/booking-applications?lead_id=${leadId}&view=summary`).then((r) => r.json()),
      fetch(`/api/loan?lead_id=${leadId}&latest=1`).then((r) => r.json()),
    ]);

    const bookingJson = bookingOutcome.status === "fulfilled" ? bookingOutcome.value : null;
    const booking =
      bookingJson?.success && bookingJson.data?.length > 0 ? bookingJson.data[0] : null;
    setLoanDealBooking(booking);
    setBookingData(booking);

    const loanJson = loanOutcome.status === "fulfilled" ? loanOutcome.value : null;
    const rows = loanJson?.success ? loanJson.data ?? [] : [];
    setLoanDealLatest(rows.length > 0 ? rows[rows.length - 1] : null);
  }, []);

  const handleBookingSuccess = async (booking: any) => {
    setIsClosingModalOpen(false);
    showToast(`Booking ${booking.booking_number} confirmed successfully!`);
    await refetch();
  };

  // Keyed on the lead ID, not the lead OBJECT — `selectedLead` is rebuilt by the
  // mergedLeads memo on every refetch(), which re-fired this on every mutation
  // while a lead sat open.
  useEffect(() => {
    if (selectedLead?.id) fetchLoanDealData(selectedLead.id);
    else {
      setLoanDealBooking(null);
      setLoanDealLatest(null);
      setBookingData(null);
      setShowBookingView(false);
    }
  }, [selectedLead?.id, fetchLoanDealData]);

  // ── Auto-drill into a lead when navigated from Enquiry Overview ──
  useEffect(() => {
    const raw = localStorage.getItem("crm_drill_lead");
    if (!raw) return;
    try {
      const drillLead = JSON.parse(raw);
      if (drillLead._drillTab !== "receptionist") return;
      localStorage.removeItem("crm_drill_lead");
      const recep = receptionists.find((r: any) => r.name === drillLead.assigned_receptionist);
      if (recep) {
        setSelectedReceptionist(recep);
        setActiveSection("assignedTable");
        setSelectedLead(drillLead);
        setIsEnquiryView(false);
        setSubView("detail"); prefillSalesForm(drillLead); setShowSalesForm(false); setShowLoanForm(false);
      }
    } catch { }
  }, [receptionists]);

  // ── Lazy load state ──────────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const combinedAssignees = useMemo(() => {
    return [...salesManagers, ...siteHeads];
  }, [salesManagers, siteHeads]);

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 3000); };

  const openLostLeadModal = (lead = selectedLead) => {
    if (!lead || lead.is_lost_lead) return;
    setSelectedLead(lead);
    setLostReason("");
    setLostError("");
    setShowLostModal(true);
  };

  const handleMarkLostLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const reason = lostReason.trim();
    if (reason.length < 10) {
      setLostError("Reason must be at least 10 characters.");
      return;
    }
    setIsSavingLost(true);
    try {
      const json = await markLostLeadApi({ leadId: selectedLead.id, reason, markedBy: adminUser.name });
      if (!json.success) {
        setLostError(json.message || "Could not mark this lead as lost.");
        return;
      }
      setSelectedLead(json.data);
      setShowLostModal(false);
      showToast(`${selectedLead.name} marked as Lost Lead`);
      refetch();
    } catch {
      setLostError("Network error. Please try again.");
    } finally {
      setIsSavingLost(false);
    }
  };

  const handleRestoreLead = async (lead = selectedLead) => {
    if (!lead || !lead.is_lost_lead || isSavingLost) return;
    const leadId = String(lead.id);
    const optimisticLead = {
      ...lead,
      is_lost_lead: false,
      lost_lead_reason: null,
      lost_lead_marked_at: null,
      lost_lead_marked_by: null,
      lost_reason: null,
      lost_marked_at: null,
      lost_marked_by: null,
    };
    setIsSavingLost(true);
    setOptimisticLeadOverrides(prev => ({ ...prev, [leadId]: optimisticLead }));
    if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(optimisticLead);
    try {
      const json = await restoreLeadApi({ leadId: lead.id, restoredBy: adminUser.name });
      if (!json.success) {
        setOptimisticLeadOverrides(prev => { const next = { ...prev }; delete next[leadId]; return next; });
        if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(lead);
        showToast(json.message || "Could not restore lead");
        return;
      }
      setOptimisticLeadOverrides(prev => ({ ...prev, [leadId]: json.data }));
      if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(json.data);
      showToast(`${lead.name} restored to Active`);
      await refetch();
      setOptimisticLeadOverrides(prev => { const next = { ...prev }; delete next[leadId]; return next; });
    } catch {
      setOptimisticLeadOverrides(prev => { const next = { ...prev }; delete next[leadId]; return next; });
      if (selectedLead && String(selectedLead.id) === leadId) setSelectedLead(lead);
      showToast("Network error while restoring lead");
    } finally {
      setIsSavingLost(false);
    }
  };

  useEffect(() => {
    setIsFetchingManagers(true);
    Promise.all([
      fetch("/api/users/sales-manager"),
      fetch("/api/users/site-head")
    ]).then(async ([resSM, resSH]) => {
      if (resSM.ok) {
        const j = await resSM.json();
        setSalesManagers(j.data || j || []);
      }
      if (resSH.ok) {
        const j = await resSH.json();
        setSiteHeads(j.data || j || []);
      }
    }).catch(() => { })
      .finally(() => setIsFetchingManagers(false));
  }, []);

  const [isEnquiryView, setIsEnquiryView] = useState(false);

  const currentFollowUps = useMemo(
    () => (followUps || []).filter((f: any) => String(f.leadId) === String(selectedLead?.id)),
    [followUps, selectedLead]
  );
  const isLeadLocked = !!selectedLead && (selectedLead.status === "Closing" || selectedLead.status === "Closed" || !!selectedLead.closingDate || !!selectedLead.is_lost_lead);

  const prefillSalesForm = (targetLead?: any) => {
    const l = targetLead || selectedLead;
    if (!l) return;
    const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id));
    const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
    if (sf.length === 0) return;
    const msg = sf[sf.length - 1].message;
    const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; };
    setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" });
  };

  const actorName = adminUser?.name || "Admin";

  const handleSendCustomNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customNote.trim() || !selectedLead) return;
    const nm = { leadId: String(selectedLead.id), salesManagerName: actorName, createdBy: "admin", message: customNote, siteVisitDate: null, createdAt: new Date().toISOString() };
    setCustomNote("");
    try { await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }); refetch(); } catch { }
  };

  // handleSendWhatsApp was removed with the wa.me workflow. It logged that a
  // message had been composed and then handed off to another app, so the CRM
  // never learned whether it was delivered or what the customer replied.
  // Sending now goes through WhatsAppConversationPanel →
  // POST /api/whatsapp/conversations/:id/messages.
  const handleSalesFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    const msg = `📝 Detailed Salesform Submitted:\n• Property Type: ${salesForm.propertyType || "N/A"}\n• Location: ${salesForm.location || "N/A"}\n• Budget: ${salesForm.budget || "N/A"}\n• Use Type: ${salesForm.useType || "N/A"}\n• Planning to Purchase: ${salesForm.purchaseDate || "N/A"}\n• Loan Planned: ${salesForm.loanPlanned || "N/A"}\n• Lead Status: ${salesForm.leadStatus || "N/A"}\n• Site Visit Requested: ${salesForm.siteVisit ? new Date(salesForm.siteVisit).toLocaleString("en-IN") : "No"}`;
    const nm = { leadId: String(selectedLead.id), salesManagerName: actorName, createdBy: "admin", message: msg, siteVisitDate: salesForm.siteVisit || null, createdAt: new Date().toISOString() };
    const ns = salesForm.siteVisit ? "Visit Scheduled" : selectedLead.status;
    setShowSalesForm(false);
    setSalesForm({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: ns }) });
      refetch();
    } catch { }
  };

  // handleBookingSuccess and fetchBookingForLead are defined in the admin panel block above



  const handleReopenLead = async () => {
    if (!selectedLead || selectedLead.status !== "Closing") return;
    setIsReopening(true);
    try {
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Interested" }) });
      const nm = { leadId: String(selectedLead.id), salesManagerName: actorName, createdBy: "admin", message: `↩️ Lead Reopened by ${actorName} (Admin)`, siteVisitDate: null, createdAt: new Date().toISOString() };
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      showToast(`${selectedLead.name} reopened`);
      refetch();
    } catch { }
    finally { setIsReopening(false); }
  };

  const handleTransferLead = async () => {
    if (!selectedLead || !transferTarget || !transferNote.trim()) return;
    setIsTransferring(true);
    try {
      const res = await fetch("/api/leads/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: selectedLead.id, transfer_to: transferTarget, transfer_note: transferNote, transferred_by: actorName }) });
      if (!res.ok) throw new Error("Transfer failed");
      setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget("");
      showToast(`Lead #${selectedLead.sr_no || selectedLead.id} transferred to ${transferTarget}!`);
      setSubView("list"); setSelectedLead(null);
      refetch();
    } catch (e: any) { alert(e.message ?? "Transfer failed."); }
    finally { setIsTransferring(false); }
  };

  const handleReassignLead = async () => {
    if (!selectedLead || !reassignTarget || !reassignNote.trim()) return;
    if (reassignTarget === (selectedLead.assignedTo || selectedLead.assigned_to)) {
      alert("Please select a different manager.");
      return;
    }
    setIsReassigning(true);
    try {
      const res = await fetch("/api/leads/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          transfer_to: reassignTarget,
          transfer_note: `🔁 Reassigned by ${actorName} (Admin) — Reason: ${reassignNote}`,
          transferred_by: actorName,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Reassign failed");
      }
      setIsReassignModalOpen(false);
      setReassignNote("");
      setReassignTarget("");
      showToast(`✅ Lead #${selectedLead.sr_no || selectedLead.id} reassigned to ${reassignTarget}!`);
      refetch();
    } catch (e: any) {
      alert(e.message ?? "Reassign failed. Try again.");
    } finally {
      setIsReassigning(false);
    }
  };

  const formInput = `w-full rounded-lg px-4 py-2 text-sm outline-none transition-colors border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;
  const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;


  const formatDate = (ds: string) => {
    if (!ds) return "—";
    try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return ds; }
  };

  const maskPhone = (phone: any, userRole: string = "admin", isOwner: boolean = true) => {
    if (!phone || phone === "N/A") return "N/A";
    const c = String(phone).replace(/[^a-zA-Z0-9]/g, "");
    if (c.length <= 5) return c;
    if (userRole === "admin" || isOwner) return c;
    if (userRole === "site_head" && !isOwner) return `${c.slice(0, 2)}XXXXXX${c.slice(-2)}`;
    return `${c.slice(0, 2)}*****${c.slice(-3)}`;
  };

  // ── Sidebar filter ──────────────────────────────────────────────────────────
  const filteredRecep = receptionists.filter((r: any) =>
    r.name?.toLowerCase().includes(searchRecep.toLowerCase())
  );

  const recepName = selectedReceptionist?.name ?? "";

  // ── Enrich leads with follow-up data ────────────────────────────────────────
  const mergedLeads = useMemo(() => {
    const fupIndex = indexFollowUpsByLead(followUps);
    const sourceLeads = updateLeadRestoreState(allLeads, null).map((lead: any) => ({
      ...lead,
      ...(optimisticLeadOverrides[String(lead.id)] || {}),
    }));
    return sourceLeads.map((lead: any) => {
      const lf = fupIndex.get(String(lead.id)) || EMPTY_FUPS;
      const salesForms = lf.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
      const latestMsg = salesForms.length > 0 ? salesForms[salesForms.length - 1].message : "";
      const g = (field: string) => {
        if (!latestMsg) return "Pending";
        const m = latestMsg.match(new RegExp(`• ${field}: (.*)`));
        return m ? m[1].trim() : "Pending";
      };
      const loanUpdates = lf.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
      let loanStatus = "N/A";
      if (loanUpdates.length > 0) {
        const msg = loanUpdates[loanUpdates.length - 1].message;
        const mS = msg.match(/• Status: (.*)/); if (mS) loanStatus = mS[1].trim();
      }
      const visitsWithDate = lf.filter((f: any) => f.siteVisitDate?.trim());
      const mongoVisitDate = visitsWithDate.length > 0 ? visitsWithDate[visitsWithDate.length - 1].siteVisitDate : null;
      const closingFups = lf.filter((f: any) => f.message?.includes("✅ Lead Marked as Closing"));
      const reopenFups = lf.filter((f: any) => f.message?.includes("↩️ Lead Reopened"));
      const lastReopenAt = reopenFups.length > 0 ? new Date(reopenFups[reopenFups.length - 1].createdAt).getTime() : 0;
      const closingFupsSinceReopen = closingFups.filter((f: any) => new Date(f.createdAt).getTime() > lastReopenAt);
      const closingDate = closingFupsSinceReopen.length > 0 ? closingFupsSinceReopen[closingFupsSinceReopen.length - 1].createdAt : null;
      const sfBudget = g("Budget");
      const activeBudget = sfBudget !== "Pending" && sfBudget !== "N/A" ? sfBudget : (lead.budget || "Pending");

      return {
        ...lead,
        propType: (g("Property Type") !== "Pending" && g("Property Type") !== "N/A") ? g("Property Type") : (lead.configuration || "Pending"),
        salesBudget: activeBudget,
        useType: g("Use Type") !== "Pending" ? g("Use Type") : (lead.purpose || "Pending"),
        leadInterestStatus: g("Lead Status"),
        loanStatus, mongoVisitDate, closingDate,
        allFollowUps: lf,
        status: lead.status === "Closing" ? "Closing" : mongoVisitDate ? "Visit Scheduled" : lead.status,
      };
    });
  }, [allLeads, followUps, optimisticLeadOverrides]);

  // ── 4 section datasets ───────────────────────────────────────────────────────
  const allEnquiries = mergedLeads;

  const assignedLeads = useMemo(
    () => mergedLeads.filter((l: any) => l.assigned_to === recepName),
    [mergedLeads, recepName]
  );

  const assignedFormLeads = useMemo(
    () => mergedLeads.filter((l: any) => l.assigned_receptionist === recepName),
    [mergedLeads, recepName]
  );

  const closedLeads = useMemo(
    () => mergedLeads.filter((l: any) =>
      l.assigned_receptionist === recepName &&
      (l.status === "Closing" || l.status === "Closed" || !!l.closingDate)
    ),
    [mergedLeads, recepName]
  );

  // ── Total leads in the currently active section ─────────
  const currentSectionTotal = useMemo(() => {
    if (activeSection === "enquiries") return allEnquiries.length;
    if (activeSection === "closed") return closedLeads.length;
    if (activeSection === "assignedTable") {
      return assignedTableFilter === "working"
        ? assignedLeads.filter((l: any) => l.status !== "Closing" && l.status !== "Closed" && !l.closingDate).length
        : assignedLeads.length;
    }
    return 0;
  }, [activeSection, allEnquiries.length, closedLeads.length, assignedLeads, assignedTableFilter]);

  // ── Bottom sentinel: load 20 more on scroll down ──────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, currentSectionTotal)); // Just reliably increase the count
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [activeSection, assignedTableFilter, searchRecep, selectedReceptionist]);

  // ── Reset count when switching sections or searching ─────────────────────────
  useEffect(() => {
    setVisibleCount(20);
  }, [activeSection, selectedReceptionist?.name, assignedTableFilter, searchRecep]);

  // ── Status badge ─────────────────────────────────────────────────────────────
  const statusCls = (status: string) => {
    const s = status || "Assigned";
    if (s === "New Lead") return isDark ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50";
    if (s === "Assigned") return isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50";
    if (s === "Contacted") return isDark ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50";
    if (s === "Interested") return isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50";
    if (s === "Visit Scheduled") return isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50";
    if (s === "Completed") return isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50";
    if (s === "Closing" || s === "Closed") return isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50";
    return isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50";
  };

  // ── Section config ────────────────────────────────────────────────────────────
  const sections = [
    { key: "enquiries", label: "Walk-in Enquiries", icon: "🗒️", count: allEnquiries.length, desc: "All walk-in forms logged in the system" },
    { key: "assignedTable", label: "Assigned Lead Table", icon: "🗃️", count: assignedLeads.length, desc: "Leads where assigned_to = this receptionist" },
    { key: "closed", label: "Closed Leads", icon: "✅", count: closedLeads.length, desc: "Leads closed by this receptionist" },
  ] as const;

  // ── Reusable table renderer ───────────────────────────────────────────────────
  const renderTable = (leads: any[], showAssignedInfo = false, isEnquiryTable = false) => (
    <div className={`rounded-xl overflow-hidden border ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className={`text-[10px] sm:text-xs uppercase ${theme.tableHead} ${theme.textHeader}`}>
            <tr>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Lead ID</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Client</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Budget</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Phone</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Source</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Status</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Interest</th>
              {showAssignedInfo && <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Assigned To</th>}
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Site Visit</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Date</th>
              <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Action</th>
              {isEnquiryTable && <th className="px-2 py-1.5 sm:px-4 sm:py-2.5">Reassign</th>}
            </tr>
          </thead>
          <tbody className={`divide-y ${theme.tableDivide}`}>
            {isLoading ? (
              <tr><td colSpan={12} className={`text-center py-6 sm:py-8 text-xs sm:text-sm ${theme.textMuted}`}>Syncing…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={12} className={`text-center py-8 sm:py-12 text-xs sm:text-sm ${theme.textMuted}`}>
                <FaClipboardList className="text-xl sm:text-2xl mx-auto mb-2 sm:mb-3 opacity-20" />
                <p className="text-xs sm:text-sm">No leads found.</p>
              </td></tr>
            ) : leads.slice(0, visibleCount).map((lead: any) => (
              <tr
                key={lead.id}
                className={`transition-colors ${theme.tableRow} ${!isEnquiryTable ? "cursor-pointer" : ""}`}
                onClick={!isEnquiryTable ? () => { setIsEnquiryView(false); setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(false); setShowLoanForm(false); } : undefined}
              >
                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-black text-xs sm:text-sm ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</td>

                {/* CLIENT NAME */}
                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-xs sm:text-sm whitespace-nowrap ${theme.text}`}>
                  {isEnquiryTable ? (
                    <span
                      className={`cursor-pointer hover:underline ${isDark ? "hover:text-[#d946a8]" : "hover:text-[#9E217B]"} transition-colors`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsEnquiryView(true);
                        setSelectedLead(lead);
                        setSubView("detail");
                        prefillSalesForm(lead);
                        setShowSalesForm(true);
                        setShowLoanForm(false);
                      }}
                    >
                      {lead.name}
                    </span>
                  ) : (
                    lead.name
                  )}
                </td>

                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-semibold text-xs sm:text-sm ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget || "N/A"}</td>
                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 font-mono text-[10px] sm:text-xs ${theme.textMuted}`}>{maskPhone(lead.phone, adminUser?.role, lead.assigned_to === adminUser?.name)}</td>
                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs ${theme.textMuted}`}>{lead.source || "—"}</td>
                <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                  <span className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border flex-shrink-0 whitespace-nowrap ${statusCls(lead.status)}`}>
                    {lead.status || "Assigned"}
                  </span>
                </td>
                <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                  {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" ? (
                    <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-full font-bold border whitespace-nowrap ${lead.leadInterestStatus === "Interested" ? (isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-200 bg-green-50") :
                      lead.leadInterestStatus === "Not Interested" ? (isDark ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-red-700 border-red-200 bg-red-50") :
                        (isDark ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" : "text-yellow-700 border-yellow-200 bg-yellow-50")
                      }`}>{lead.leadInterestStatus}</span>
                  ) : <span className={`text-[10px] sm:text-xs italic ${theme.textFaint}`}>—</span>}
                </td>
                {showAssignedInfo && (
                  <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                    <div className="flex flex-col gap-0.5 sm:gap-1">
                      <span className={`text-[10px] sm:text-xs font-bold whitespace-nowrap ${theme.text}`}>
                        {lead.assigned_to || lead.assignedTo || "Unassigned"}
                      </span>
                      {(lead.assigned_to || lead.assignedTo) && (
                        <span className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded border w-max font-bold uppercase tracking-wider ${siteHeads?.some((sh: any) => sh.name === (lead.assigned_to || lead.assignedTo)) ? (isDark ? "bg-indigo-900/30 text-indigo-300 border-indigo-700/50" : "bg-indigo-50 text-indigo-700 border-indigo-200") : (isDark ? "bg-teal-900/30 text-teal-300 border-teal-700/50" : "bg-teal-50 text-teal-700 border-teal-200")}`}>
                          {siteHeads?.some((sh: any) => sh.name === (lead.assigned_to || lead.assignedTo)) ? "Site Head" : "Sales Manager"}
                        </span>
                      )}
                    </div>
                  </td>
                )}
                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs whitespace-nowrap ${lead.mongoVisitDate ? "text-orange-500 font-semibold" : theme.textFaint}`}>
                  {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : "—"}
                </td>
                <td className={`px-2 py-1.5 sm:px-4 sm:py-2.5 text-[10px] sm:text-xs whitespace-normal min-w-[100px] sm:min-w-[120px] ${theme.textFaint}`}>
                  {formatDate(lead.created_at)}
                </td>
                <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                  <button
                    className={`text-[10px] sm:text-xs font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md sm:rounded-lg cursor-pointer transition-colors ${isDark ? "bg-[#9E217B] text-white hover:bg-[#b8268f]" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B] hover:text-white"}`}
                    onClick={e => {
                      e.stopPropagation();
                      setIsEnquiryView(isEnquiryTable);
                      setSelectedLead(lead);
                      setSubView("detail");
                    }}
                  >
                    View
                  </button>
                </td>
                {isEnquiryTable && (
                  <td className="px-2 py-1.5 sm:px-4 sm:py-2.5">
                    {lead.status === "Closed" || lead.status === "Closing" || !!lead.closingDate ? (
                      <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full uppercase border whitespace-nowrap ${isDark ? "text-gray-400 border-gray-600 bg-gray-800/50" : "text-gray-500 border-gray-300 bg-gray-100"}`}>
                        Marked closed
                      </span>
                    ) : (
                      <button
                        className={`text-[10px] sm:text-xs font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md sm:rounded-lg cursor-pointer flex items-center gap-1 sm:gap-1.5 transition-colors whitespace-nowrap ${isDark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-700"}`}
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedLead(lead);
                          setReassignTarget("");
                          setReassignNote("");
                          setIsReassignModalOpen(true);
                        }}
                      >
                        <FaExchangeAlt className="text-[9px] sm:text-[10px]" /> Reassign
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── BOTTOM SENTINEL — triggers load more ── */}
        {visibleCount < leads.length && (
          <div ref={loadMoreRef} className={`flex items-center justify-center gap-3 py-6 ${theme.textMuted}`}>
            <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
            <span className="text-xs font-medium">Loading more… ({visibleCount} of {leads.length})</span>
          </div>
        )}
        {visibleCount >= leads.length && leads.length > 20 && (
          <div className={`text-center py-2.5 text-xs font-medium ${theme.textFaint}`}>
            ✓ All {leads.length} leads loaded
          </div>
        )}

      </div>
    </div>
  );
  const [showMobileActions, setShowMobileActions] = useState(false);
  return (
    <div className="flex h-full relative overflow-hidden">
      {toastMsg && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] px-3 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fadeIn ${toastMsg.includes("🎉") ? "bg-green-600 border-green-400 text-white" : "bg-[#9E217B] border-[#b8268f] text-white"}`}>
          <div className="text-lg"><FaCheckCircle /></div>
          <span className="text-sm font-bold">{toastMsg}</span>
        </div>
      )}

      {showLostModal && selectedLead && (
        <LostLeadModal
          lead={selectedLead}
          reason={lostReason}
          error={lostError}
          isSaving={isSavingLost}
          isDark={isDark}
          theme={theme}
          onReasonChange={(value) => { setLostReason(value); if (lostError) setLostError(""); }}
          onClose={() => setShowLostModal(false)}
          onSubmit={handleMarkLostLead}
        />
      )}

      <BookingFormModal
        isOpen={isClosingModalOpen}
        onClose={() => setIsClosingModalOpen(false)}
        lead={selectedLead}
        user={adminUser}
        isDark={isDark}
        onSuccess={handleBookingSuccess}
      />

      {/* Sidebar for Receptionists */}
      {/* MOBILE: 100% width, hidden if a Receptionist is selected. DESKTOP: Always visible, fixed 62 width */}
      <div className={`border-r flex-col h-full flex-shrink-0 z-20 shadow-xl ${theme.innerBlock} w-full md:w-62 ${selectedReceptionist ? 'hidden md:flex' : 'flex'}`}>
        <div className={`p-5 border-b ${theme.tableBorder}`}>
          <div className="relative">
            <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${theme.textFaint}`} />
            <input type="text" placeholder="Search Receptionists…" value={searchRecep}
              onChange={e => setSearchRecep(e.target.value)}
              className={`w-full rounded-lg pl-9 pr-4 py-2 text-sm outline-none transition-colors ${theme.inputInner} ${theme.text} ${theme.inputFocus}`} />
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto ${theme.scroll}`} dir="rtl">
          <div dir="ltr" className="min-h-full">
            {isLoading ? (
              <div className={`p-8 text-center text-sm ${theme.textMuted}`}>Loading staff…</div>
            ) : filteredRecep.length === 0 ? (
              <div className={`p-8 text-center text-sm ${theme.textMuted}`}>No receptionists found.</div>
            ) : filteredRecep.map((recep: any) => {
              const isSelected = selectedReceptionist?.id === recep.id || selectedReceptionist?.name === recep.name;
              const recepAssigned = mergedLeads.filter((l: any) => l.assigned_to === recep.name).length;
              const recepCreated = mergedLeads.filter((l: any) => l.assigned_receptionist === recep.name).length;
              const recepClosed = mergedLeads.filter((l: any) => l.assigned_receptionist === recep.name && (l.status === "Closing" || !!l.closingDate)).length;
              return (
                <div key={recep.id || recep.name}
                  onClick={() => { setSelectedReceptionist(recep); setActiveSection("enquiries"); setSubView("list"); setSelectedLead(null); setIsEnquiryView(false); }}
                  className={`p-5 flex items-start gap-3 cursor-pointer transition-all border-b ${theme.tableBorder}
                    ${isSelected
                      ? isDark ? "border-r-4 border-r-[#9E217B] bg-[#9E217B]/10" : "border-r-4 border-r-[#9E217B] bg-pink-50"
                      : "hover:opacity-80 border-r-4 border-r-transparent"}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm flex-shrink-0
                    ${isSelected ? "bg-[#9E217B]" : isDark ? "bg-[#333] text-gray-400" : "bg-gray-400"}`}>
                    {recep.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-bold truncate text-sm mb-0.5 ${theme.text}`}>{recep.name}</h3>
                    <p className={`text-xs capitalize mb-2 ${theme.textFaint}`}>{recep.role?.replace("_", " ")}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/20" : "text-[#9E217B] bg-pink-50 border-pink-200"}`}>
                        {recepAssigned} assigned
                      </span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${isDark ? "text-purple-400 bg-purple-500/10 border-purple-500/20" : "text-purple-700 bg-purple-50 border-purple-200"}`}>
                        {recepCreated} self-mgd
                      </span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${isDark ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" : "text-amber-700 bg-amber-50 border-amber-200"}`}>
                        {recepClosed} closed
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── COMBINED RIGHT CONTENT PANEL ── */}
      {/* MOBILE: 100% width, only visible if Receptionist is selected. DESKTOP: Always visible, takes remaining space */}
      <div className={`flex-1 flex flex-col h-full min-w-0 overflow-hidden ${theme.mainBg} ${selectedReceptionist ? 'flex' : 'hidden md:flex'}`}>

        {/* MOBILE BACK BUTTON */}
        {/* {selectedReceptionist && (
          <div className={`md:hidden flex items-center p-3 border-b flex-shrink-0 bg-white ${theme.tableBorder} ${theme.headerGlass}`}>
            <button
              onClick={() => setSelectedReceptionist(null)}
              className={`flex items-center gap-2 text-sm font-bold hover:opacity-80 ${theme.text}`}
            >
              <FaArrowLeft className={theme.textFaint} />
              Back to Receptionists
            </button>
          </div>
        )} */}

        {!selectedReceptionist ? (
          <div className={`h-full flex flex-col items-center justify-center ${theme.textMuted}`}>
            <FaClipboardList className="text-4xl mb-4 opacity-20" />
            <p>Select a receptionist from the left sidebar.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Sub-header */}
            <div className={`p-2 sm:p-5 border-b flex justify-between items-center shadow-sm z-10 flex-shrink-0 gap-2 ${theme.header}`} style={theme.headerGlass}>
              <div>
                <h2 className={`text-md sm:text-lg font-bold flex items-center gap-2 ${theme.text}`}>
                  <FaClipboardList className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"} />
                  {selectedReceptionist.name}'s Dashboard
                </h2>
                <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 ${theme.textFaint}`}>
                  {subView === "detail" ? `Viewing lead details · Admin acting on behalf of ${selectedReceptionist.name}` : "Admin view — monitor receptionist activity across all sections"}
                </p>
              </div>
              {subView === "list" && (
                <span className={`text-[10px] sm:text-xs px-2 py-1 sm:px-3 sm:py-1 rounded-full border font-bold flex items-center gap-1 sm:gap-1.5 ${isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-200 bg-green-50"}`}>
                  🟢 Live Sync
                </span>
              )}
            </div>

            {/* ── DETAIL VIEW (enquiry-style, read-only) ── */}
            {subView === "detail" && selectedLead && isEnquiryView && (
              <div className="flex-1 overflow-y-auto p-2 sm:p-4 animate-fadeIn">
                <div className={`flex items-center gap-2 mb-4 sm:mb-6 rounded-xl border p-2 sm:p-4 md:p-4 ${theme.card}`}>
                  <button
                    onClick={() => { setSubView("list"); setSelectedLead(null); setIsEnquiryView(false); }}
                    className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center border rounded-lg sm:rounded-xl transition-colors cursor-pointer ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                    <FaChevronLeft className="text-[10px] sm:text-sm" />
                  </button>
                  <h1 className={`text-sm sm:text-lg font-bold flex items-center flex-wrap gap-2 sm:gap-3 ${theme.text}`}>
                    <span className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"}>#{selectedLead.sr_no || selectedLead.id}</span>
                    <span>{selectedLead.name}</span>
                    <span className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-[9px] sm:crm-eyebrow border ${statusCls(selectedLead.status)}`}>
                      {selectedLead.status || "Assigned"}
                    </span>
                  </h1>
                </div>
                <div className={`rounded-xl border p-3 sm:p-6 md:p-8 ${theme.card}`} style={theme.cardGlass}>
                  <div className={`rounded-xl p-3 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4 mb-4 sm:mb-8 text-white ${isDark ? "bg-gradient-to-r from-[#9E217B] to-[#7a1a5e]" : "bg-gradient-to-r from-[#00AEEF] to-[#9E217B]"}`}>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border border-white/30 bg-white/20 flex items-center justify-center font-bold text-sm sm:text-base">
                        {String(selectedLead.assigned_to || "U").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-[9px] sm:text-[10px] text-white/70 font-bold tracking-wider uppercase mb-0.5">Assigned Sales Manager</p>
                        <p className="font-bold text-xs sm:text-base">{selectedLead.assigned_to || "Unassigned"}</p>
                      </div>
                    </div>
                    <div className="sm:text-right mt-2 sm:mt-0">
                      <p className="text-[9px] sm:text-[10px] text-white/70 uppercase tracking-wider font-bold mb-0.5">Source</p>
                      <p className="font-semibold text-[10px] sm:text-sm flex items-center sm:justify-end gap-1.5 sm:gap-2">
                        <FaBriefcase className="opacity-70 text-[10px]" /> {selectedLead.source || "N/A"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-10">
                    <div className="space-y-4">
                      <div>
                        <h3 className={`text-[10px] sm:text-xs font-bold border-b pb-2 mb-3 sm:mb-4 uppercase tracking-widest ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"} ${theme.tableBorder}`}>Contact Information</h3>
                        <div className="space-y-3 sm:space-y-4">
                          <InlineContactField label="Phone Number" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); showToast("Contact details updated successfully."); }} />
                          <InlineContactField label="Alt. Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); showToast("Contact details updated successfully."); }} />
                          <InlineContactField label="Email Address" value={selectedLead.email} fieldType="email" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                          <div>
                            <p className={`text-[9px] sm:text-[10px] font-medium mb-0.5 sm:mb-1 ${theme.textFaint}`}>Residential Address</p>
                            <p className={`font-medium text-[10px] sm:text-xs ${theme.text}`}>{selectedLead.address || "N/A"}</p>
                          </div>
                          <InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4 mt-2 sm:mt-0">
                      <div>
                        <h3 className={`text-[10px] sm:text-xs font-bold border-b pb-2 mb-3 sm:mb-4 uppercase tracking-widest ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"} ${theme.tableBorder}`}>Property Requirements</h3>
                        <div className={`rounded-xl p-3 sm:p-4 space-y-3 sm:space-y-4 border ${theme.settingsBg}`} style={theme.settingsBgGl}>
                          <div>
                            <p className={`text-[9px] sm:text-[10px] font-medium mb-0.5 sm:mb-1 pl-1 sm:pl-2 ${theme.textFaint}`}>Budget</p>
                            <p className={`font-bold text-sm sm:text-base ${isDark ? "text-green-500" : "text-emerald-600"}`}>{selectedLead.salesBudget || selectedLead.budget || "N/A"}</p>
                          </div>
                          <div className={`grid grid-cols-2 gap-2 border-t pt-3 sm:pt-4 ${theme.tableBorder}`}>
                            <div>
                              <p className={`text-[9px] sm:text-[10px] font-medium mb-0.5 sm:mb-1 pl-1 sm:pl-2 ${theme.textFaint}`}>Configuration</p>
                              <p className={`font-medium text-[10px] sm:text-xs ${theme.text}`}>{selectedLead.configuration || selectedLead.propType || "N/A"}</p>
                            </div>
                            <div>
                              <p className={`text-[9px] sm:text-[10px] font-medium mb-0.5 sm:mb-1 pl-1 sm:pl-2 ${theme.textFaint}`}>Purpose</p>
                              <p className={`font-medium text-[10px] sm:text-xs ${theme.text}`}>{selectedLead.purpose || selectedLead.useType || "N/A"}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div>
                        <p className={`text-[9px] sm:text-[10px] font-medium mb-0.5 sm:mb-1 ${theme.textFaint}`}>Loan Planned</p>
                        <p className={`font-semibold text-[10px] sm:text-xs ${theme.text}`}>{selectedLead.loanPlanned || selectedLead.loan_planned || "N/A"}</p>
                      </div>
                    </div>
                  </div>
                  {selectedLead.source === "Channel Partner" && (
                    <div className={`mt-4 sm:mt-6 rounded-xl p-3 sm:p-4 border ${theme.settingsBg}`} style={theme.settingsBgGl}>
                      <h3 className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mb-2 sm:mb-3 border-b pb-2 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"} ${theme.tableBorder}`}>Channel Partner Details</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[{ label: "CP Company", val: selectedLead.cp_company || selectedLead.cpCompany }, { label: "CP Phone", val: selectedLead.cp_phone || selectedLead.cpPhone }].map(({ label, val }) => (
                          <div key={label}>
                            <p className={`text-[9px] sm:text-[10px] font-medium mb-0.5 ${theme.textFaint}`}>{label}</p>
                            <p className={`font-medium text-[10px] sm:text-xs ${theme.text}`}>{val || "N/A"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className={`mt-4 sm:mt-6 pt-3 sm:pt-4 border-t flex justify-end ${theme.tableBorder1}`}>
                    <p className={`text-[9px] sm:text-[10px] ${theme.textFaint}`}>Created: {formatDate(selectedLead.created_at)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── DETAIL VIEW (full panel with follow-ups, mirrors Sales Manager) ── */}
            {subView === "detail" && selectedLead && !isEnquiryView && (
              bookingData && showBookingView ? (
                <div className="animate-fadeIn w-full h-[calc(100vh-130px)] overflow-hidden bg-transparent flex flex-col">
                  <div className="flex items-center p-2 shrink-0 border-b border-white/10 shadow-sm" style={theme.cardGlass}>
                    <button onClick={() => setShowBookingView(false)} className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 border rounded-lg transition-colors cursor-pointer shadow-sm ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                      <FaChevronLeft /> Back to Lead Details
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ClosedLeadBookingView
                      booking={bookingData}
                      lead={selectedLead}
                      isDark={isDark}
                      userRole={adminUser?.role?.toLowerCase() || "admin"}
                      currentUser={adminUser}
                      onRefetch={() => { if (selectedLead) fetchBookingForLead(selectedLead.id); }}
                    />
                  </div>
                </div>
              ) : (
                <div className={`flex-1 overflow-y-auto p-2 sm:p-2 ${theme.scroll}`}>
                  <div className="animate-fadeIn max-w-[1200px] mx-auto flex flex-col min-h-full lg:h-[calc(100vh-130px)]">
                    {(() => {
                      const isNGD = selectedLead.status === "NON GENUINE DEMAND (NGD)" || selectedLead.leadStatus === "NON GENUINE DEMAND (NGD)" || selectedLead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                      return (
                        <div className={`sticky top-0 z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 rounded-xl border p-2 shadow-sm flex-shrink-0 ${selectedLead.is_lost_lead ? theme.cardLost : isNGD ? theme.cardNGD : theme.card}`} style={theme.cardGlass}>
                          <div className="flex items-center justify-between w-full sm:w-auto gap-2">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <button onClick={() => { setSubView("list"); setSelectedLead(null); setIsEnquiryView(false); setShowSalesForm(false); setShowLoanForm(false); }}
                                className={`w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 flex items-center justify-center border rounded-lg sm:rounded-xl transition-colors cursor-pointer shadow-sm ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                                <FaChevronLeft className="text-[10px] sm:text-xs" />
                              </button>
                              <h1 className={`text-sm sm:text-base lg:text-lg font-bold flex flex-wrap items-center gap-1.5 sm:gap-2 ${theme.text}`}>
                                <span className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"}>#{selectedLead.sr_no || selectedLead.id}</span>
                                <span>{selectedLead.name}</span>
                                <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-full border ${theme.settingsBg} ${theme.textFaint}`}>
                                  {selectedLead.assigned_receptionist || selectedReceptionist?.name}
                                </span>
                                {selectedLead.status === "Closing" && (
                                  <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border ${isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50"}`}>
                                    <FaHandshake className="inline mr-1 text-[9px] sm:text-[10px]" />Closing
                                  </span>
                                )}
                                {selectedLead.is_lost_lead && (
                                  <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusLost}`}>
                                    <FaEyeSlash className="text-[10px] sm:text-xs" /> Lost Lead
                                  </span>
                                )}
                                {!selectedLead.is_lost_lead && isNGD && (
                                  <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border flex items-center gap-1 sm:gap-1.5 ${theme.statusNGD}`}>
                                    NON GENUINE DEMAND
                                  </span>
                                )}
                              </h1>
                            </div>
                            <button onClick={() => setShowMobileActions(!showMobileActions)} className={`sm:hidden w-8 h-8 flex-shrink-0 flex items-center justify-center border rounded-lg transition-colors shadow-sm ${showMobileActions ? theme.btnPrimary : `${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}`}>
                              <FaChevronDown className={`text-[10px] transition-transform duration-200 ${showMobileActions ? "rotate-180" : ""}`} />
                            </button>
                          </div>

                          <div className={`gap-1.5 sm:gap-2 flex-wrap justify-start sm:justify-end mt-1 sm:mt-0 w-full sm:w-auto pl-9 sm:pl-0 ${showMobileActions ? "flex animate-fadeIn" : "hidden sm:flex"}`}>
                            {bookingData ? (
                              <button onClick={() => openBookingView(selectedLead.id)} className="font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm whitespace-nowrap">
                                <FaEye /> View Booking Form
                              </button>
                            ) : (
                              <button disabled title="Booking Form has not been submitted yet." className="font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors opacity-50 cursor-not-allowed bg-indigo-400 text-white shadow-sm whitespace-nowrap">
                                <FaEye /> View Booking Form
                              </button>
                            )}
                            {isLeadLocked ? (
                              <>
                                <span className={`text-[9px] sm:text-[11px] font-bold px-2 py-1 sm:px-3 sm:py-1 rounded-full border flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 whitespace-nowrap ${selectedLead.is_lost_lead ? theme.statusLost : theme.statusClosing}`}>
                                  {selectedLead.is_lost_lead ? <><FaEyeSlash className="text-[10px] sm:text-xs" /> Lost Lead • Read Only</> : <><FaCheckCircle className="text-[10px] sm:text-xs" /> Lead Closed • Read Only</>}
                                </span>
                                {selectedLead.is_lost_lead ? (
                                  <button onClick={() => handleRestoreLead()} disabled={isSavingLost}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60 whitespace-nowrap`}>
                                    <FaCheckCircle /> Restore Lead
                                  </button>
                                ) : (
                                  <button onClick={handleReopenLead} disabled={isReopening}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60 whitespace-nowrap`}>
                                    ↩️ Reopen Lead
                                  </button>
                                )}
                              </>
                            ) : (
                              !showSalesForm && !showLoanForm && (
                                <>
                                  <button onClick={() => { prefillSalesForm(); setShowSalesForm(true); setShowLoanForm(false); }}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} whitespace-nowrap`}>
                                    <FaFileInvoice /> Fill Salesform
                                  </button>
                                  <button onClick={() => { setShowLoanForm(true); setShowSalesForm(false); }}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnSecondary} whitespace-nowrap`}>
                                    <FaUniversity /> Track Loan
                                  </button>
                                  <button onClick={() => setIsClosingModalOpen(true)}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnWarning} whitespace-nowrap`}>
                                    <FaHandshake /> Mark Closing
                                  </button>
                                  <button onClick={() => openLostLeadModal()}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${theme.btnDanger} whitespace-nowrap`}>
                                    <FaEyeSlash /> Lost Lead
                                  </button>
                                  <button onClick={() => { setTransferTarget(""); setTransferNote(""); setIsTransferModalOpen(true); }}
                                    className={`font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs flex items-center justify-center flex-1 sm:flex-none min-w-[110px] sm:min-w-[130px] gap-1 sm:gap-1.5 transition-colors cursor-pointer ${isDark ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"} whitespace-nowrap`}>
                                    <FaExchangeAlt /> Transfer
                                  </button>
                                </>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* AI voice calling */}
                    <div className="mb-2 mt-1 sm:mt-2 flex-shrink-0">
                      <BolnaCallWidget
                        leadId={Number(selectedLead.id)}
                        leadName={selectedLead.name}
                        phone={selectedLead.phone}
                        userData={{ project: selectedLead.propType || selectedLead.configuration }}
                        compact
                      />
                    </div>

                    <div className="flex flex-col lg:flex-row gap-2 sm:gap-3 flex-1 min-h-0 pb-2">
                      {/* LEFT PANEL */}
                      <div className="w-full lg:w-[45%] flex flex-col gap-2 lg:h-full pb-2 min-h-0">
                        {showSalesForm ? (
                          <div className={`rounded-xl border p-3 sm:p-5 shadow-xl flex flex-col lg:h-full ${theme.modalCard} ${theme.scroll}`}
                            style={{ ...theme.modalGlass, overflowY: "auto", scrollbarWidth: "thin" }}>
                            <div className={`flex justify-between items-center mb-3 sm:mb-4 border-b pb-2 sm:pb-3 ${theme.tableBorder}`}>
                              <div>
                                <h3 className={`text-base sm:text-lg font-bold ${theme.text}`}>Sales Data Form</h3>
                                <p className={`text-[10px] sm:text-xs mt-0.5 ${theme.accentText}`}>Admin override — Lead #{selectedLead.id}</p>
                              </div>
                              <button type="button" onClick={() => setShowSalesForm(false)} className={`p-1 ${theme.textMuted}`}><FaTimes /></button>
                            </div>
                            <form onSubmit={handleSalesFormSubmit} className="flex flex-col gap-2 flex-1">
                              {[{ label: "Property Type?", key: "propertyType", ph: "e.g. 1BHK, 2BHK" }, { label: "Preferred Location?", key: "location", ph: "e.g. Dombivali, Kalyan" }, { label: "Approximate Budget?", key: "budget", ph: "e.g. 5 cr" }].map(f => (
                                <div key={f.key}><label className={`text-[10px] sm:text-xs mb-1 block ${theme.textMuted}`}>{f.label}</label>
                                  <input type="text" placeholder={f.ph} value={(salesForm as any)[f.key]} onChange={e => setSalesForm({ ...salesForm, [f.key]: e.target.value })} className={`w-full rounded-lg px-3 py-2 sm:px-4 sm:py-2 text-[10px] sm:text-sm outline-none ${theme.inputInner} ${theme.text} ${theme.inputFocus}`} />
                                </div>
                              ))}
                              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                                <div><label className={`text-[10px] sm:text-xs mb-1 block ${theme.textMuted}`}>Self-use or Investment?</label>
                                  <select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={`w-full rounded-lg px-2 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-sm outline-none ${theme.select}`}>
                                    <option value="">Select</option><option>Self Use</option><option>Investment</option>
                                  </select>
                                </div>
                                <div><label className={`text-[10px] sm:text-xs mb-1 block ${theme.textMuted}`}>Planning to Purchase?</label>
                                  <select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={`w-full rounded-lg px-2 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-sm outline-none ${theme.select}`}>
                                    <option value="">Select</option><option>Immediate</option><option>Next 3 Months</option>
                                  </select>
                                </div>
                              </div>
                              <div className={`border-t pt-2 sm:pt-3 mt-1 ${theme.tableBorder}`}>
                                <label className={`block text-[10px] sm:text-xs font-bold mb-1 sm:mb-1.5 ${theme.accentText}`}>Lead Interest Status *</label>
                                <select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={`w-full rounded-lg px-3 py-2 sm:px-4 sm:py-2 text-[10px] sm:text-sm outline-none cursor-pointer ${theme.select}`}>
                                  <option value="" disabled>Select Status</option><option>Interested</option><option>Not Interested</option><option>NON GENUINE DEMAND (NGD)</option>
                                </select>
                              </div>
                              <div className={`border-t pt-2 sm:pt-3 mt-1 ${theme.tableBorder}`}>
                                <label className={`block text-[10px] sm:text-xs font-bold mb-1 sm:mb-1.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Loan Planned?</label>
                                <select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={`w-full rounded-lg px-3 py-2 sm:px-4 sm:py-2 text-[10px] sm:text-sm outline-none cursor-pointer ${theme.select}`}>
                                  <option value="" disabled>Select Option</option><option>Yes</option><option>No</option><option>Not Sure</option>
                                </select>
                              </div>
                              <div className={`mt-2 border-t pt-2 sm:pt-3 ${theme.tableBorder}`}>
                                <label className="text-[10px] sm:text-xs text-orange-500 font-bold mb-1 sm:mb-1.5 block">Schedule a Site Visit?</label>
                                <input ref={inputRef} type="datetime-local" value={salesForm.siteVisit} onChange={e => setSalesForm({ ...salesForm, siteVisit: e.target.value })} onClick={() => inputRef.current?.showPicker()} className={`w-full rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-[10px] sm:text-sm outline-none ${theme.inputInner} ${theme.text} focus:border-orange-500`} />
                              </div>
                              <button type="submit" className={`mt-auto w-full font-bold py-2.5 sm:py-3.5 text-xs sm:text-sm rounded-xl transition-colors flex-shrink-0 ${theme.btnPrimary}`}>Submit Salesform</button>
                            </form>
                          </div>
                        ) : showLoanForm ? (
                          <LoanDealForm
                            lead={selectedLead}
                            booking={loanDealBooking}
                            loanUpdate={loanDealLatest}
                            user={adminUser}
                            isDark={isDark}
                            t={theme}
                            onCancel={() => setShowLoanForm(false)}
                            onSuccess={() => {
                              setShowLoanForm(false);
                              showToast(`Loan & deal data saved for ${selectedLead.name}`);
                              fetchLoanDealData(selectedLead.id);
                              refetch();
                            }}
                          />
                        ) : (
                          <div className="flex flex-col lg:h-full animate-fadeIn">
                            <div className={`flex items-center gap-1 sm:gap-2 mb-2 sm:mb-4 p-1 sm:p-1.5 rounded-xl flex-shrink-0 ${theme.tableWrap}`}>
                              <button onClick={() => setDetailTab("personal")} className={`flex-1 py-1.5 sm:py-2 text-[10px] sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? theme.btnPrimary : `${theme.textMuted} hover:opacity-80`}`}>Personal Information</button>
                              <button onClick={() => setDetailTab("loan")} className={`flex-1 py-1.5 sm:py-2 text-[10px] sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? theme.btnSecondary : `${theme.textMuted} hover:opacity-80`}`}>Loan Tracking</button>
                            </div>
                            <div className={`flex-1 overflow-y-auto custom-scrollbar rounded-xl p-3 sm:p-6 pt-2 sm:pt-4 pb-4 shadow-lg border ${theme.chatPanel}`} style={theme.chatPanelGl}>
                              {detailTab === "personal" ? (
                                <div>
                                  <div className="grid grid-cols-2 gap-y-4 sm:gap-y-6 gap-x-2 sm:gap-x-4 text-xs sm:text-sm">
                                    <InlineContactField label="Email" value={selectedLead.email} fieldType="email" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Phone" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Alt Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); showToast("Contact details updated successfully."); }} />
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Lead Interest</p>
                                      {selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} isDark={isDark} /> : <p className={`font-semibold ${theme.text}`}>Pending</p>}
                                    </div>
                                    <div className="col-span-1"><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Loan Status</p>
                                      {selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} isDark={isDark} /></div> : <p className={`font-semibold ${theme.text}`}>N/A</p>}
                                    </div>
                                    <div className="col-span-1"><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Backdated Entry</p><p className={`font-semibold ${theme.text}`}>{selectedLead.auto_date_enabled === false && selectedLead.enquiry_date ? formatDate(selectedLead.enquiry_date).split(",")[0] : "Null"}</p></div>
                                    <div className="col-span-2"><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Residential Address</p><p className={`font-semibold ${theme.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                                    <div className="col-span-2"><InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={theme} canEdit={adminUser?.role?.toLowerCase() === "admin"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); showToast("Contact details updated successfully."); }} /></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Budget</p><p className="text-green-500 font-bold">{selectedLead.salesBudget && selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Property Type</p><p className={`font-semibold ${theme.text}`}>{selectedLead.propType || "Pending"}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Type of Use</p><p className={`font-semibold ${theme.text}`}>{selectedLead.useType && selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Planning to Buy?</p><p className={`font-semibold ${theme.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Loan Required?</p><p className={`font-semibold ${theme.text}`}>{loanDealLatest?.loan_required || selectedLead.loanPlanned || "Pending"}</p></div>
                                    <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textMuted}`}>Status</p><p className={`font-semibold ${theme.accentText}`}>{selectedLead.status || "Assigned"}</p></div>
                                    <div className={`col-span-2 p-3 sm:p-5 rounded-xl border ${isDark ? "border-[#9E217B]/20" : "border-[#9E217B]/20"} ${theme.settingsBg}`}>
                                      <p className={`crm-eyebrow mb-0.5 sm:mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>📍 Site Visit Date</p>
                                      <p className={`text-base sm:text-lg font-black ${theme.text}`}>{selectedLead.mongoVisitDate ? new Date(selectedLead.mongoVisitDate).toLocaleString("en-IN") : "Not Scheduled"}</p>
                                    </div>
                                    {selectedLead.closingDate && (
                                      <div className={`col-span-2 p-3 sm:p-5 rounded-xl border ${isDark ? "bg-yellow-900/10 border-yellow-500/20" : "bg-amber-50 border-amber-200"}`}>
                                        <p className="text-[10px] sm:text-xs font-bold text-amber-500 uppercase mb-0.5 sm:mb-1">Closing Date</p>
                                        <p className={`text-base sm:text-lg font-black ${theme.text}`}>{new Date(selectedLead.closingDate).toLocaleString("en-IN")}</p>
                                      </div>
                                    )}
                                  </div>
                                  <div className={`mt-3 border rounded-xl p-3 sm:p-5 ${theme.settingsBg}`} style={theme.settingsBgGl}>
                                    <h3 className={`crm-eyebrow mb-2 border-b pb-2 ${theme.sectionTitle} ${theme.sectionBorder}`}>
                                      {selectedLead.source && selectedLead.source !== "N/A" ? `${selectedLead.source} Data` : "Source Data"}
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textFaint}`}>Primary Source</p><p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{selectedLead.source || "N/A"}</p></div>
                                      {selectedLead.source === "Others" && (<div><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textFaint}`}>Specified Name</p><p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{selectedLead.sourceOther}</p></div>)}
                                    </div>

                                    {selectedLead.source === "Channel Partner" ? (
                                      <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 ${theme.tableBorder}`}>
                                        {[{ label: "CP Name", val: selectedLead.cpName || selectedLead.cp_name }, { label: "CP Company", val: selectedLead.cp_company || selectedLead.cpCompany }, { label: "CP Phone", val: selectedLead.cp_phone || selectedLead.cpPhone }].map(({ label, val }) => (
                                          <div key={label}><p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textFaint}`}>{label}</p><p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{val || "N/A"}</p></div>
                                        ))}
                                      </div>
                                    ) : selectedLead.source === "Referral" && selectedLead.referral_name ? (
                                      <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 ${theme.tableBorder}`}>
                                        <div>
                                          <p className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${theme.textFaint}`}>Referred By</p>
                                          <p className={`font-medium text-xs sm:text-sm ${theme.text}`}>{selectedLead.referral_name}</p>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="mt-3">
                                    <SiteVisitScheduler
                                      lead={selectedLead}
                                      adminUser={adminUser}
                                      isDark={isDark}
                                      theme={theme}
                                      onSuccess={refetch}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <LoanDealView lead={selectedLead} booking={loanDealBooking} loanUpdate={loanDealLatest} isDark={isDark} t={theme} />
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-1 sm:mt-2 flex-shrink-0">
                              <button className={`border flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1 ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30 hover:bg-[#9E217B] text-[#d946a8] hover:text-white" : "bg-[#9E217B]/10 border-[#9E217B]/30 hover:bg-[#9E217B] text-[#9E217B] hover:text-white"}`}>
                                <FaMicrophone className="text-sm sm:text-lg" /><span className="font-bold text-[9px] sm:text-[10px]">Browser Call</span>
                              </button>
                              <button onClick={() => setIsWaModalOpen(true)} className="bg-green-50 dark:bg-green-600/10 border border-green-200 dark:border-green-500/30 hover:bg-green-100 dark:hover:bg-green-600 text-green-600 dark:text-green-400 flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1">
                                <FaWhatsapp className="text-sm sm:text-lg" /><span className="font-bold text-[9px] sm:text-[10px]">WhatsApp</span>
                              </button>
                              <CallingButtons leadId={selectedLead?.id ?? null} phone={selectedLead?.phone} leadName={selectedLead?.name} isDark={isDark} iconClass="text-sm sm:text-lg" paddingClass="py-2 sm:py-3" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* RIGHT PANEL: Follow-ups panel (Scrollable and Stacked on Mobile) */}
                      <div className={`w-full lg:w-[50%] flex flex-col border rounded-xl overflow-hidden shadow-2xl min-h-[500px] lg:h-full lg:min-h-0 ${theme.chatPanel}`} style={theme.chatPanelGl}>
                        <div className={`p-3 sm:p-6 flex flex-col gap-2 sm:gap-3 flex-1 ${theme.chatArea} ${theme.scroll}`}
                          style={{ overflowY: "auto", scrollbarWidth: "thin" }}>
                          <div className="flex justify-start">
                            <div className={`border rounded-xl rounded-tl-none p-3 sm:p-5 max-w-[90%] sm:max-w-[85%] shadow-md ${theme.fupDefault}`}>
                              <div className="flex justify-between items-center mb-1 sm:mb-2 gap-2 sm:gap-3">
                                <span className={`font-bold text-[10px] sm:text-sm ${theme.accentText}`}>System (Front Desk)</span>
                                <span className={`text-[9px] sm:text-[10px] ${theme.textFaint}`}>{formatDate(selectedLead.created_at)}</span>
                              </div>
                              <p className={`text-xs sm:text-sm leading-relaxed ${theme.text}`}>Lead assigned to {selectedLead.assigned_to || "Unassigned"}. Status: {selectedLead.status}</p>
                            </div>
                          </div>
                          {currentFollowUps.length === 0
                            ? <p className={`text-center text-xs sm:text-sm py-6 sm:py-8 ${theme.textFaint}`}>No follow-up history yet.</p>
                            : currentFollowUps.map((msg: any, idx: number) => {
                              const isLoan = msg.message?.includes("🏦 Loan Update");
                              const isSF = msg.message?.includes("📝 Detailed Salesform Submitted");
                              const isClosing = msg.message?.includes("✅ Lead Marked as Closing");
                              const bubble = isLoan ? theme.fupLoan : isSF ? theme.fupSalesform : isClosing ? theme.fupClosing : theme.fupDefault;
                              return (
                                <div key={idx} className="flex justify-start">
                                  <div className={`rounded-xl rounded-tl-none p-3 sm:p-5 max-w-[95%] sm:max-w-[85%] shadow-lg ${bubble}`}>
                                    <div className="flex justify-between items-center mb-1 sm:mb-3 gap-2 sm:gap-3">
                                      <span className={`font-bold text-xs sm:text-sm ${theme.text}`}>{msg.createdBy === "admin" ? `${msg.salesManagerName || "Admin"} (Admin)` : msg.createdBy === "receptionist" ? `${msg.salesManagerName} (Receptionist)` : msg.salesManagerName}</span>
                                      <span className={`text-[9px] sm:text-[10px] ${theme.textFaint}`}>{formatDate(msg.createdAt)}</span>
                                    </div>
                                    <p className={`text-xs sm:text-sm whitespace-pre-wrap leading-relaxed ${theme.text}`}>{msg.message}</p>
                                  </div>
                                </div>
                              );
                            })}
                          <div ref={followUpEndRef} />
                        </div>
                        <form onSubmit={handleSendCustomNote} className={`p-3 sm:p-5 border-t flex gap-2 sm:gap-3 items-center flex-shrink-0 ${theme.chatInputInner}`}>
                          <input type="text" value={customNote} onChange={e => setCustomNote(e.target.value)} placeholder="Add admin note..."
                            className={`flex-1 border rounded-xl px-3 py-2.5 sm:px-4 sm:py-4 text-[10px] sm:text-sm outline-none transition-colors shadow-inner ${theme.inputInner} ${theme.text} ${theme.inputFocus}`} />
                          <button type="submit" className={`w-10 h-10 sm:w-12 sm:h-12 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg ${isDark ? "bg-[#9E217B] hover:bg-[#b8268f]" : "bg-[#9E217B] hover:bg-[#8a1d6b]"}`}>
                            <FaPaperPlane className="text-[10px] sm:text-sm ml-[-1px] sm:ml-[-2px]" />
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ── LIST VIEW (sections, stats, tables) ── */}
            {subView === "list" && (
              <div className={`flex-1 overflow-y-auto p-2 sm:p-4 ${theme.scroll}`}>
                <div className="animate-fadeIn space-y-3 sm:space-y-4">
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2">
                    {sections.map(sec => (
                      <div key={sec.key} onClick={() => setActiveSection(sec.key)}
                        className={`rounded-2xl sm:rounded-3xl p-3 sm:p-5 border cursor-pointer transition-all ${activeSection === sec.key ? isDark ? "bg-[#9E217B]/20 border-[#9E217B]/50" : "bg-[#9E217B]/10 border-[#9E217B]" : `${theme.card} hover:opacity-90`}`}
                        style={activeSection !== sec.key ? theme.cardGlass : {}}>
                        <div className="flex items-center justify-between mb-1 sm:mb-2">
                          <span className="text-base sm:text-lg">{sec.icon}</span>
                          <span className={`text-xl sm:text-2xl font-black ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>{sec.count}</span>
                        </div>
                        <p className={`text-[10px] sm:text-xs font-bold ${theme.text}`}>{sec.label}</p>
                        <p className={`text-[9px] sm:text-[10px] mt-0.5 ${theme.textFaint}`}>{sec.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Section tabs */}
                  <div className={`flex gap-1.5 sm:gap-2 p-1 sm:p-1.5 rounded-xl border ${theme.tableWrap}`}>
                    {sections.map(sec => (
                      <button key={sec.key} onClick={() => setActiveSection(sec.key)}
                        className={`flex-1 py-1.5 sm:py-2.5 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5
                          ${activeSection === sec.key ? "bg-[#9E217B] text-white shadow-md" : `${theme.textMuted} hover:opacity-80`}`}>
                        <span>{sec.icon}</span>
                        <span className="hidden sm:inline truncate">{sec.label}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${activeSection === sec.key ? "bg-white/20 text-white" : isDark ? "bg-[#333] text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                          {sec.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Section content */}
                  <div className="animate-fadeIn">
                    {activeSection === "enquiries" && (
                      <div>
                        <div className="flex justify-between items-start w-full mb-3 sm:mb-4">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <span className="text-base sm:text-lg">🗒️</span>
                            <div>
                              <h3 className={`font-bold text-sm sm:text-base ${theme.text}`}>Walk-in Enquiries</h3>
                              <p className={`text-[10px] sm:text-xs ${theme.textFaint}`}>All walk-in forms in the system — {allEnquiries.length} total</p>
                            </div>
                          </div>
                          <button onClick={() => downloadCSV(allEnquiries.map(formatLeadForExport), "All_Enquiries.csv")} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs font-bold border rounded-lg hover:opacity-80 transition-colors ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-[#9E217B]'}`}><FaDownload /> Export</button>
                        </div>
                        {renderTable(allEnquiries, true, true)}
                      </div>
                    )}

                    {activeSection === "assignedTable" && (
                      <div>
                        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4 flex-wrap">

                          <div>
                            <h3 className={`font-bold text-sm sm:text-base ${theme.text}`}>Assigned Lead Table</h3>
                            <p className={`text-[10px] sm:text-xs ${theme.textFaint}`}>Leads assigned to {recepName}</p>
                          </div>
                          <button onClick={() => downloadCSV((assignedTableFilter === "working" ? assignedLeads.filter((l: any) => l.status !== "Closing" && l.status !== "Closed" && !l.closingDate) : assignedLeads).map(formatLeadForExport), "Assigned_Leads.csv")} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs font-bold border rounded-lg hover:opacity-80 transition-colors ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-[#9E217B]'}`}><FaDownload /> Export</button>
                          <div className={`ml-auto flex items-center gap-1 sm:gap-2 p-1 rounded-xl border ${theme.tableWrap}`}>
                            <button onClick={() => setAssignedTableFilter("working")} className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${assignedTableFilter === "working" ? "bg-[#9E217B] text-white shadow-md" : `${theme.textMuted} hover:opacity-80`}`}>
                              🔄 Working Leads <span className={`ml-1 sm:ml-1.5 text-[9px] px-1 sm:px-1.5 py-0.5 rounded-full font-black ${assignedTableFilter === "working" ? "bg-white/20 text-white" : isDark ? "bg-[#333] text-gray-300" : "bg-gray-100 text-gray-600"}`}>{assignedLeads.filter((l: any) => l.status !== "Closing" && l.status !== "Closed" && !l.closingDate).length}</span>
                            </button>
                            <button onClick={() => setAssignedTableFilter("all")} className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${assignedTableFilter === "all" ? "bg-[#9E217B] text-white shadow-md" : `${theme.textMuted} hover:opacity-80`}`}>
                              📋 All Leads <span className={`ml-1 sm:ml-1.5 text-[9px] px-1 sm:px-1.5 py-0.5 rounded-full font-black ${assignedTableFilter === "all" ? "bg-white/20 text-white" : isDark ? "bg-[#333] text-gray-300" : "bg-gray-100 text-gray-600"}`}>{assignedLeads.length}</span>
                            </button>
                          </div>
                        </div>
                        {assignedTableFilter === "all" && (
                          <div className={`rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 border mb-3 sm:mb-4 flex items-center gap-2 text-[10px] sm:text-xs font-medium ${isDark ? "bg-yellow-900/10 border-yellow-500/20 text-yellow-400" : "bg-amber-50 border-amber-200 text-amber-600"}`}>
                            ⚠️ Showing all leads including closed ones.
                          </div>
                        )}
                        {renderTable(assignedTableFilter === "working"
                          ? assignedLeads.filter((l: any) => l.status !== "Closing" && l.status !== "Closed" && !l.closingDate)
                          : assignedLeads)}
                      </div>
                    )}



                    {activeSection === "closed" && (
                      <div>
                        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                          <span className="text-base sm:text-lg">✅</span>
                          <div><h3 className={`font-bold text-sm sm:text-base ${theme.text}`}>Closed Leads by Receptionist</h3><p className={`text-[10px] sm:text-xs ${theme.textFaint}`}>Leads closed by {recepName}</p></div>
                          <div className="ml-auto flex items-center gap-2 sm:gap-3">
                            <button onClick={() => downloadCSV(closedLeads.map(formatLeadForExport), "Closed_Leads.csv")} className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs font-bold border rounded-lg hover:opacity-80 transition-colors ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-[#9E217B]'}`}><FaDownload /> Export</button>
                            <span className={`text-[10px] sm:text-xs px-2 sm:px-3 py-1 rounded-full border font-bold ${isDark ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" : "text-amber-700 border-amber-200 bg-amber-50"}`}>{closedLeads.length} closed</span>
                          </div>
                        </div>
                        {renderTable(closedLeads)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── WHATSAPP CONVERSATION PANEL ── */}
      {isWaModalOpen && selectedLead && (
        <WhatsAppConversationPanel
          theme={theme}
          isDark={isDark}
          initialLeadId={Number(selectedLead.id)}
          onClose={() => setIsWaModalOpen(false)}
        />
      )}

      {/* ── TRANSFER MODAL (Moved to the absolute root level of the component) ── */}
      {isTransferModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-5 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-xl w-full max-w-lg shadow-2xl border overflow-hidden ${theme.modalCard}`} style={theme.modalGlass}>
            <div className={`p-4 sm:p-5 border-b flex justify-between items-center ${isDark ? "bg-purple-900/20 border-purple-500/20" : "bg-purple-50 border-purple-200"}`}>
              <div>
                <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}><FaExchangeAlt /> Transfer Lead #{selectedLead.sr_no || selectedLead.id}</h2>
                <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 ${theme.textMuted}`}>Transferring: <strong>{selectedLead.name}</strong></p>
              </div>
              <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }} className={`p-2 ${theme.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
            </div>
            <div className={`p-4 sm:p-6 ${theme.modalInner}`}>
              <div className="mb-4 sm:mb-5">
                <label className={`block text-[10px] sm:text-sm font-bold mb-1 sm:mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Transfer to Manager *</label>
                <select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}
                  className={`w-full rounded-xl p-3 sm:p-5 text-[10px] sm:text-sm outline-none transition-colors border-2 cursor-pointer ${isDark ? "bg-[#14141B] border-purple-500/40 text-white" : "bg-white border-purple-300 text-[#1A1A1A]"}`}>
                  <option value="" disabled>-- Select Manager --</option>
                  {isFetchingManagers ? <option disabled>Loading managers…</option> : combinedAssignees.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).length > 0 ? combinedAssignees.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).map((m: any, i: number) => <option key={i} value={m.name}>{m.name} ({String(m.role || "Manager").replace("_", " ")})</option>) : <option disabled>No other assignees available</option>}
                </select>
              </div>
              <div>
                <label className={`block text-[10px] sm:text-sm font-bold mb-1 sm:mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Handover Summary</label>
                <textarea required value={transferNote} onChange={e => setTransferNote(e.target.value)} rows={7}
                  placeholder="Summarize actions, discussions, interest level..."
                  className={`w-full rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-[10px] sm:text-sm outline-none resize-none leading-relaxed border-2 transition-colors custom-scrollbar ${isDark ? "bg-[#14141B] border-purple-500/30 text-white focus:border-purple-500" : "bg-white border-purple-200 text-[#1A1A1A] focus:border-purple-500"}`} />
              </div>
            </div>
            <div className={`p-4 sm:p-5 border-t flex justify-end gap-2 sm:gap-3 ${theme.modalHeader} ${theme.tableBorder}`}>
              <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }}
                className={`px-3 py-2 sm:px-4 sm:py-3 rounded-lg font-bold text-[10px] sm:text-sm cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500`}>Cancel</button>
              <button onClick={handleTransferLead} disabled={isTransferring || !transferTarget || !transferNote.trim()}
                className={`px-4 py-2 sm:px-8 sm:py-2.5 rounded-lg font-bold text-[10px] sm:text-sm transition-colors flex items-center gap-1.5 sm:gap-2 ${isTransferring || !transferTarget || !transferNote.trim() ? "opacity-50 cursor-not-allowed bg-purple-400 text-white" : "cursor-pointer bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"}`}>
                {isTransferring ? "Transferring…" : <><FaExchangeAlt /> Confirm Transfer</>}
              </button>
            </div>
          </div>
        </div>

      )}

      {/* ════════════════════════════════════════════════════
         REASSIGN LEAD MODAL (Admin)
      ════════════════════════════════════════════════════ */}
      {isReassignModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-5 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-xl w-full max-w-lg shadow-2xl border overflow-hidden ${theme.modalCard}`} style={theme.modalGlass}>
            <div className={`p-4 sm:p-5 border-b flex justify-between items-center ${isDark ? "bg-orange-900/20 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
              <div>
                <h2 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>
                  <FaExchangeAlt /> Re-assign Lead #{selectedLead.sr_no || selectedLead.id}
                </h2>
                <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 ${theme.textMuted}`}>Currently assigned to: <strong>{selectedLead.assigned_to || selectedLead.assignedTo || "Unassigned"}</strong></p>
              </div>
              <button onClick={() => { setIsReassignModalOpen(false); setReassignNote(""); setReassignTarget(""); }}
                className={`p-2 ${theme.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
            </div>
            <div className={`p-4 sm:p-6 ${theme.modalInner}`}>
              <div className="mb-4 sm:mb-5">
                <label className={`block text-[10px] sm:text-sm font-bold mb-1 sm:mb-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>Assign to *</label>
                <select required value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}
                  className={`w-full rounded-xl p-3 sm:p-5 text-[10px] sm:text-sm outline-none transition-colors border-2 cursor-pointer ${isDark ? "bg-[#14141B] border-orange-500/40 text-white" : "bg-white border-orange-300 text-[#1A1A1A]"}`}>
                  <option value="" disabled>-- Select Manager --</option>
                  {isFetchingManagers ? <option disabled>Loading managers…</option> : combinedAssignees.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).length > 0 ? combinedAssignees.filter((m: any) => m.name !== (selectedLead.assigned_to || selectedLead.assignedTo)).map((m: any, i: number) => (
                    <option key={i} value={m.name}>{m.name} ({String(m.role || "Sales Manager").replace("_", " ")})</option>
                  )) : <option disabled>No other assignees available</option>}
                </select>
              </div>
              <div>
                <label className={`block text-[10px] sm:text-sm font-bold mb-1 sm:mb-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>Reason for Re-assign *</label>
                <textarea
                  required value={reassignNote} onChange={e => setReassignNote(e.target.value)}
                  placeholder="e.g. Wrong manager was selected initially. Reassigning to correct person."
                  rows={4}
                  className={`w-full rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-[10px] sm:text-sm outline-none resize-none border-2 transition-colors ${isDark ? "bg-[#14141B] border-orange-500/30 text-white focus:border-orange-500" : "bg-white border-orange-200 text-[#1A1A1A] focus:border-orange-500"}`}
                />
                {reassignNote.length > 0 && reassignNote.length < 10 && (
                  <p className="text-[10px] sm:text-xs text-amber-500 mt-1">⚠ Please provide a reason (min 10 characters).</p>
                )}
              </div>
            </div>
            <div className={`p-4 sm:p-5 border-t flex justify-end gap-2 sm:gap-3 ${theme.modalHeader} ${theme.tableBorder}`}>
              <button onClick={() => { setIsReassignModalOpen(false); setReassignNote(""); setReassignTarget(""); }}
                className={`px-3 py-2 sm:px-4 sm:py-3 rounded-lg font-bold text-[10px] sm:text-sm cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500`}>Cancel</button>
              <button onClick={handleReassignLead}
                disabled={isReassigning || !reassignTarget || !reassignNote.trim()}
                className={`px-4 py-2 sm:px-8 sm:py-2.5 rounded-lg font-bold text-[10px] sm:text-sm transition-colors flex items-center gap-1.5 sm:gap-2 ${isReassigning || !reassignTarget || !reassignNote.trim()
                  ? "opacity-50 cursor-not-allowed bg-orange-400 text-white"
                  : "cursor-pointer bg-orange-500 hover:bg-orange-400 text-white shadow-lg shadow-orange-500/20"
                  }`}>
                {isReassigning ? "Reassigning…" : <><FaExchangeAlt /> Confirm Re-assign</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  DailyMonitoringPanel  –  with unified "Site Visit Center" accordion
// ─────────────────────────────────────────────────────────────────────────────

function SiteVisitCenter({
  data,
  theme,
  isDark,
  allLeads,
  adminUser,
  expandedVisitLeadId,
  setExpandedVisitLeadId,
  visitActivityRoleFilter,
  setVisitActivityRoleFilter,
  visitActivityFilter,
  setVisitActivityFilter,
  visitActivityPeople,
  filteredSiteVisitActions,
  fetchStats,
}: any) {
  // which accordion panel is open: "today" | "tomorrow" | "logs" | null
  const [openPanel, setOpenPanel] = useState<string | null>("today");

  const toggle = (key: string) =>
    setOpenPanel((prev) => (prev === key ? null : key));

  // ── helpers ──────────────────────────────────────────────────────────────

  const statusBadge = (status: string, variant: "today" | "tomorrow" = "today") => {
    if (status === "completed")
      return "text-green-400 border-green-500/30 bg-green-500/10";
    if (status === "cancelled")
      return "text-red-400 border-red-500/30 bg-red-500/10";
    return variant === "tomorrow"
      ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
      : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
  };

  const countBadge = (n: number, color: string) => (
    <span
      className={`ml-2 text-[10px] font-black px-2 py-0.5 rounded-full border ${color}`}
    >
      {n}
    </span>
  );

  // ── accordion header ──────────────────────────────────────────────────────
  const AccordionHeader = ({
    id,
    icon,
    title,
    badge,
    accentBorder,
  }: {
    id: string;
    icon: string;
    title: string;
    badge: React.ReactNode;
    accentBorder: string;
  }) => {
    const isOpen = openPanel === id;
    return (
      <button
        onClick={() => toggle(id)}
        className={`w-full flex items-center justify-between px-5 py-3.5 transition-all duration-200 group cursor-pointer
          ${isOpen
            ? isDark
              ? "bg-[#1e1e1e]"
              : "bg-indigo-50/80"
            : isDark
              ? "hover:bg-[#1a1a1a]"
              : "hover:bg-[#F8FAFC]"
          }
          ${isOpen ? `border-l-2 ${accentBorder}` : "border-l-2 border-transparent"}
        `}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base leading-none">{icon}</span>
          <span className={`text-sm font-bold ${theme.text}`}>{title}</span>
          {badge}
        </div>
        <span
          className={`text-xs transition-transform duration-300 ${theme.textFaint} ${isOpen ? "rotate-180" : "rotate-0"
            }`}
        >
          ▼
        </span>
      </button>
    );
  };

  // ── accordion body wrapper ────────────────────────────────────────────────
  const AccordionBody = ({
    id,
    children,
  }: {
    id: string;
    children: React.ReactNode;
  }) => {
    const isOpen = openPanel === id;
    return (
      <div
        style={{
          maxHeight: isOpen ? "9999px" : "0px",
          opacity: isOpen ? 1 : 0,
          overflow: "hidden",
          transition: isOpen
            ? "max-height 0.45s ease, opacity 0.3s ease 0.05s"
            : "max-height 0.3s ease, opacity 0.15s ease",
        }}
      >
        <div
          className={`px-4 pb-4 pt-1 ${isDark ? "bg-[#111]" : "bg-[#F8FAFC]"
            }`}
        >
          {children}
        </div>
      </div>
    );
  };

  // ── compact table ─────────────────────────────────────────────────────────
  const CompactTable = ({
    headers,
    children,
    colSpan,
  }: {
    headers: string[];
    children: React.ReactNode;
    colSpan?: number;
  }) => (
    <div className="overflow-x-auto rounded-xl border border-opacity-50 mt-2"
      style={{ borderColor: isDark ? "#2a2a2a" : "#e0e7ef" }}
    >
      <table className="w-full text-left text-xs whitespace-nowrap">
        <thead>
          <tr
            className={`${isDark ? "bg-[#1a1a1a] text-gray-400" : "bg-[#F1F5F9] text-gray-500"
              }`}
          >
            {headers.map((h) => (
              <th
                key={h}
                className={`px-4 py-3 sm:py-4.5 crm-eyebrow border-b ${isDark ? "border-[#2a2a2a]" : "border-indigo-100"
                  }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          className={`divide-y ${isDark ? "divide-[#1e1e1e]" : "divide-indigo-50"
            }`}
        >
          {children}
        </tbody>
      </table>
    </div>
  );

  // ── empty state ───────────────────────────────────────────────────────────
  const EmptyState = ({ msg }: { msg: string }) => (
    <div
      className={`mt-2 rounded-xl border py-6 text-center ${isDark
        ? "border-[#2a2a2a] bg-[#161616]"
        : "border-indigo-100 bg-white"
        }`}
    >
      <p className="text-2xl mb-1">📭</p>
      <p className={`text-xs font-semibold ${theme.textMuted}`}>{msg}</p>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className={`rounded-3xl border overflow-hidden ${isDark ? "bg-[#161616] border-[#2a2a2a]" : "bg-white border-indigo-200"
        }`}
    >
      {/* ── Module header ─────────────────────────────────────────────────── */}
      <div
        className={`px-5 py-2.5 border-b flex items-center justify-between ${isDark
          ? "bg-[#1a1a1a] border-[#2a2a2a]"
          : "bg-white border-indigo-100"
          }`}
      >
        <h3 className={`font-bold text-sm flex items-center gap-2 ${theme.text}`}>
          🗂️ Site Visit Center
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isDark
              ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
              : "text-orange-600 border-orange-200 bg-orange-50"
              }`}
          >
            {data.siteVisitsToday.length + (data.siteVisitsTomorrow ?? []).length} total
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ACCORDION 1 — SITE VISITS TODAY
      ══════════════════════════════════════════════════════════════════════ */}
      <AccordionHeader
        id="today"
        icon="📅"
        title="Site Visits Today"
        badge={countBadge(
          data.siteVisitsToday.length,
          isDark
            ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
            : "text-orange-600 border-orange-200 bg-orange-50"
        )}
        accentBorder="border-orange-500"
      />
      <AccordionBody id="today">
        {data.siteVisitsToday.length === 0 ? (
          <EmptyState msg="No site visits scheduled for today" />
        ) : (
          <CompactTable
            headers={["Lead #", "Client", "Manager", "Time", "Status", ""]}
          >
            {data.siteVisitsToday.map((v: any) => {
              const isOpen = expandedVisitLeadId === v.lead_id;
              const leadObj =
                allLeads?.find((l: any) => l.id === v.lead_id) ?? {
                  id: v.lead_id,
                  name: v.name,
                };
              return (
                <>
                  <tr
                    key={v.id}
                    className={`transition-colors ${isDark ? "hover:bg-[#1e1e1e]" : "hover:bg-indigo-50/40"
                      }`}
                  >
                    <td
                      className={`px-4 py-3 sm:py-4.5 font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"
                        }`}
                    >
                      #{v.lead_id}
                    </td>
                    <td className={`px-4 py-3 sm:py-4.5 font-semibold ${theme.text}`}>
                      {v.name}
                    </td>
                    <td className={`px-4 py-3 sm:py-4.5 ${theme.textMuted}`}>
                      {v.assigned_to || "—"}
                    </td>
                    <td className="px-4 py-3 sm:py-4.5 text-orange-500 font-semibold">
                      {v.visit_date
                        ? new Date(v.visit_date).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 sm:py-4.5">
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${statusBadge(
                          v.status
                        )}`}
                      >
                        {v.status || "Scheduled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 sm:py-4.5">
                      <button
                        onClick={() =>
                          setExpandedVisitLeadId(isOpen ? null : v.lead_id)
                        }
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${isOpen
                          ? isDark
                            ? "bg-orange-600/20 border-orange-500/40 text-orange-400"
                            : "bg-orange-50 border-orange-300 text-orange-600"
                          : isDark
                            ? "bg-[#222] border-[#333] text-gray-400 hover:bg-[#2a2a2a]"
                            : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                          }`}
                      >
                        {isOpen ? "▲ Hide" : "▼ Manage"}
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr key={`expand-${v.id}`}>
                      <td
                        colSpan={6}
                        className={`px-3 py-3 ${isDark ? "bg-[#0e0e0e]" : "bg-indigo-50/60"
                          }`}
                      >
                        <SiteVisitScheduler
                          lead={leadObj}
                          adminUser={adminUser}
                          isDark={isDark}
                          theme={theme}
                          onSuccess={fetchStats}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </CompactTable>
        )}
      </AccordionBody>

      {/* divider */}
      <div className={`h-px ${isDark ? "bg-[#222]" : "bg-indigo-100"}`} />

      {/* ══════════════════════════════════════════════════════════════════════
          ACCORDION 2 — SITE VISITS TOMORROW
      ══════════════════════════════════════════════════════════════════════ */}
      <AccordionHeader
        id="tomorrow"
        icon="📆"
        title="Site Visits Tomorrow"
        badge={countBadge(
          (data.siteVisitsTomorrow ?? []).length,
          isDark
            ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
            : "text-blue-700 border-blue-200 bg-blue-50"
        )}
        accentBorder="border-blue-500"
      />
      <AccordionBody id="tomorrow">
        {(data.siteVisitsTomorrow ?? []).length === 0 ? (
          <EmptyState msg="No site visits scheduled for tomorrow" />
        ) : (
          <CompactTable
            headers={["Lead #", "Client", "Manager", "Time", "Status"]}
          >
            {(data.siteVisitsTomorrow ?? []).map((v: any) => (
              <tr
                key={v.id}
                className={`transition-colors ${isDark ? "hover:bg-[#1e1e1e]" : "hover:bg-indigo-50/40"
                  }`}
              >
                <td
                  className={`px-4 py-3 sm:py-4.5 font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"
                    }`}
                >
                  #{v.lead_id ?? v.id}
                </td>
                <td className={`px-4 py-3 sm:py-4.5 font-semibold ${theme.text}`}>
                  {v.name}
                </td>
                <td className={`px-4 py-3 sm:py-4.5 ${theme.textMuted}`}>
                  {v.assigned_to || "—"}
                </td>
                <td className="px-4 py-3 sm:py-4.5 text-blue-400 font-semibold">
                  {v.visit_date
                    ? new Date(v.visit_date).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "—"}
                </td>
                <td className="px-4 py-3 sm:py-4.5">
                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${statusBadge(
                      v.status,
                      "tomorrow"
                    )}`}
                  >
                    {v.status || "Scheduled"}
                  </span>
                </td>
              </tr>
            ))}
          </CompactTable>
        )}
      </AccordionBody>

      {/* divider */}
      <div className={`h-px ${isDark ? "bg-[#222]" : "bg-indigo-100"}`} />

      {/* ══════════════════════════════════════════════════════════════════════
          ACCORDION 3 — ACTIVITY LOGS
      ══════════════════════════════════════════════════════════════════════ */}
      <AccordionHeader
        id="logs"
        icon="📝"
        title="Activity Logs"
        badge={countBadge(
          filteredSiteVisitActions.length,
          isDark
            ? "text-purple-400 border-purple-500/30 bg-purple-500/10"
            : "text-purple-700 border-purple-200 bg-purple-50"
        )}
        accentBorder="border-purple-500"
      />
      <AccordionBody id="logs">
        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap mb-3 pt-1">
          <span className={`crm-eyebrow ${theme.textFaint}`}>
            Filter
          </span>
          <select
            value={visitActivityRoleFilter}
            onChange={(e) => setVisitActivityRoleFilter(e.target.value)}
            className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none border ${theme.select}`}
          >
            <option value="__all_roles__">All Roles</option>
            <option value="Sales Manager">Sales Manager</option>
            <option value="Receptionist">Receptionist</option>
            <option value="Site Head">Site Head</option>
          </select>
          <select
            value={visitActivityFilter}
            onChange={(e) => setVisitActivityFilter(e.target.value)}
            className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none border ${theme.select}`}
          >
            <option value="__all__">All Employees</option>
            {visitActivityPeople.map((name: string) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {filteredSiteVisitActions.length === 0 ? (
          <EmptyState msg="No activity logs for today" />
        ) : (
          <div className="space-y-2 mt-1">
            {filteredSiteVisitActions.map((a: any, idx: number) => (
              <div
                key={a.id}
                className={`relative pl-8 pr-4 py-3 rounded-xl border transition-colors ${isDark
                  ? "bg-[#1a1a1a] border-[#2a2a2a] hover:bg-[#1e1e1e]"
                  : "bg-white border-indigo-100 hover:bg-indigo-50/40"
                  }`}
              >
                {/* timeline dot */}
                <div
                  className={`absolute left-3 top-4 w-2 h-2 rounded-full border-2 ${isDark
                    ? "bg-purple-500 border-purple-400"
                    : "bg-purple-500 border-purple-300"
                    }`}
                />
                {/* vertical line except last */}
                {idx < filteredSiteVisitActions.length - 1 && (
                  <div
                    className={`absolute left-[14px] top-6 bottom-[-10px] w-px ${isDark ? "bg-[#2e2e2e]" : "bg-indigo-100"
                      }`}
                  />
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-xs font-bold leading-tight ${theme.text}`}>
                      {a.created_by_name || "Unknown"}
                      <span className={`font-normal ${theme.textMuted}`}>
                        {" "}
                        •{" "}
                      </span>
                      <span className={`font-semibold ${theme.textMuted}`}>
                        {a.lead_name || `Lead #${a.lead_id}`}
                      </span>
                    </p>
                    <p
                      className={`text-[11px] mt-1 whitespace-pre-wrap leading-relaxed ${theme.textMuted}`}
                    >
                      {a.message}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap flex-shrink-0 mt-0.5 ${theme.textFaint}`}
                  >
                    {a.created_at
                      ? new Date(a.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </AccordionBody>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main Panel
// ─────────────────────────────────────────────────────────────────────────────
function DailyMonitoringPanel({
  theme,
  isDark,
  allLeads,
  followUps,
  managers,
  siteHeads,
  receptionists,
  adminUser,
}: any) {
  const [data, setData] = useState<any>(null);
  const [expandedVisitLeadId, setExpandedVisitLeadId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "managers" | "visits" | "alerts">("overview");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [visitActivityRoleFilter, setVisitActivityRoleFilter] = useState<string>("__all_roles__");
  const [visitActivityFilter, setVisitActivityFilter] = useState<string>("__all__");

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/monitoring/daily-stats");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setLastUpdated(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchStats();
    }, 30000);
    const onVisible = () => { if (!document.hidden) fetchStats(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!data || visitActivityFilter === "__all__") return;
    const stats = Array.isArray(data.stats) ? data.stats : [];
    const roleFilteredStaff =
      visitActivityRoleFilter === "__all_roles__"
        ? stats
        : stats.filter((s: any) => s.role === visitActivityRoleFilter);
    const people: string[] = Array.from(
      new Set(
        roleFilteredStaff
          .map((s: any) => String(s.name || "").trim())
          .filter((n: string) => n.length > 0)
      )
    );
    if (!people.includes(visitActivityFilter)) {
      setVisitActivityFilter("__all__");
    }
  }, [data, visitActivityRoleFilter, visitActivityFilter]);

  if (isLoading)
    return (
      <div className={`h-full flex items-center justify-center ${theme.textMuted}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
          <p className="text-sm">Loading daily stats...</p>
        </div>
      </div>
    );

  if (!data)
    return (
      <div className={`h-full flex items-center justify-center ${theme.textMuted}`}>
        <p>Failed to load monitoring data.</p>
      </div>
    );

  const salesManagers = data.stats.filter((s: any) => s.role === "Sales Manager");
  const siteHeadStats = data.stats.filter((s: any) => s.role === "Site Head");
  const receptionistStats = data.stats.filter((s: any) => s.role === "Receptionist");
  const allStaff = data.stats;

  const roleFilteredStaff =
    visitActivityRoleFilter === "__all_roles__"
      ? allStaff
      : allStaff.filter((s: any) => s.role === visitActivityRoleFilter);

  const visitActivityPeople: string[] = Array.from(
    new Set(
      roleFilteredStaff
        .map((s: any) => String(s.name || "").trim())
        .filter((n: string) => n.length > 0)
    )
  );

  const filteredSiteVisitActions = (data.siteVisitActionsToday || []).filter(
    (a: any) =>
      visitActivityFilter === "__all__"
        ? true
        : a.created_by_name === visitActivityFilter
  );

  const alertCount = allStaff.filter(
    (s: any) => s.totalLeads > 0 && s.followUpsToday === 0
  ).length;
  const highPending = allStaff.filter((s: any) => s.remainingToday > 5).length;

  const tabs = [
    { key: "overview", label: "📋 Overview" },
    { key: "managers", label: "👤 By Role" },
    { key: "visits", label: "📅 Site Visits" },
    { key: "alerts", label: `🚨 Alerts${alertCount > 0 ? ` (${alertCount})` : ""}` },
  ];

  const getRoleBadge = (role: string) => {
    if (role === "Sales Manager")
      return isDark
        ? "text-[#d946a8] border-[#9E217B]/30 bg-[#9E217B]/10"
        : "text-[#9E217B] border-[#9E217B]/20 bg-[#9E217B]/5";
    if (role === "Site Head")
      return isDark
        ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
        : "text-blue-700 border-blue-200 bg-blue-50";
    return isDark
      ? "text-purple-400 border-purple-500/30 bg-purple-500/10"
      : "text-purple-700 border-purple-200 bg-purple-50";
  };

  const getStatusColor = (done: number, total: number) => {
    if (total === 0) return theme.textFaint;
    const pct = (done / total) * 100;
    if (pct >= 80) return "text-green-500";
    if (pct >= 40) return "text-yellow-500";
    return "text-red-500";
  };

  const getBarColor = (done: number, total: number) => {
    if (total === 0) return "bg-gray-500";
    const pct = (done / total) * 100;
    if (pct >= 80) return "bg-green-500";
    if (pct >= 40) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <div
        className={`p-4 border-b flex-shrink-0 ${theme.header}`}
        style={theme.headerGlass}
      >
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className={`text-lg font-bold flex items-center gap-2 ${theme.text}`}>
              📊 Daily Activity Monitor
            </h2>
            <p className={`text-xs mt-0.5 ${theme.textFaint}`}>
              {data.date} · Last updated: {lastUpdated} · Auto-refreshes every 30s
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {alertCount > 0 && (
              <span
                className={`text-xs font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${isDark
                  ? "text-red-400 border-red-500/30 bg-red-500/10"
                  : "text-red-700 border-red-200 bg-red-50"
                  }`}
              >
                🚨 {alertCount} no activity
              </span>
            )}
            {highPending > 0 && (
              <span
                className={`text-xs font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${isDark
                  ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                  : "text-yellow-700 border-yellow-200 bg-yellow-50"
                  }`}
              >
                ⚠️ {highPending} high pending
              </span>
            )}
            <button
              onClick={fetchStats}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${isDark
                ? "bg-[#222] border-[#333] text-white hover:bg-[#333]"
                : "bg-white border-indigo-200 text-[#9E217B] hover:bg-[#F8FAFC]"
                }`}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === tab.key
                ? "bg-[#9E217B] text-white shadow-md"
                : `${theme.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-[#F1F5F9]"
                }`
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className={`flex-1 overflow-y-auto p-2 ${theme.scroll}`}>

        {/* ════ OVERVIEW TAB ════ */}
        {activeTab === "overview" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Total Staff", value: allStaff.length, glow: theme.statGlow1, color: isDark ? "text-[#d946a8]" : "text-[#9E217B]" },
                { label: "Follow-ups Today", value: data.totalFollowUpsToday, glow: theme.statGlow5, color: isDark ? "text-green-400" : "text-emerald-600" },
                { label: "WhatsApp Sent Today", value: data.totalWaToday, glow: theme.statGlow3, color: isDark ? "text-blue-400" : "text-blue-600" },
                { label: "Site Visits Today", value: data.siteVisitsToday.length, glow: theme.statGlow4, color: isDark ? "text-orange-400" : "text-orange-600" },
              ].map((card, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-5 border relative overflow-hidden ${theme.card}`}
                  style={theme.cardGlass}
                >
                  <div
                    className={`absolute -right-4 -top-4 w-20 h-20 rounded-full blur-2xl pointer-events-none ${card.glow}`}
                  />
                  <p className={`crm-eyebrow mb-2 ${theme.textFaint}`}>
                    {card.label}
                  </p>
                  <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Team Performance Table */}
            <div
              className={`rounded-xl border overflow-hidden ${theme.tableWrap}`}
              style={theme.tableGlass}
            >
              <div
                className={`p-5 border-b flex items-center justify-between ${theme.tableBorder} ${theme.modalHeader}`}
              >
                <h3 className={`font-bold flex items-center gap-2 text-sm ${theme.text}`}>
                  📊 Team Performance Table — Today
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-bold ${isDark
                    ? "text-green-400 border-green-500/30 bg-green-500/10"
                    : "text-green-700 border-green-200 bg-green-50"
                    }`}
                >
                  🟢 Live
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className={`${theme.tableHead} ${theme.textHeader}`}>
                    <tr>
                      {["Sr", "Employee", "Role", "Total Leads", "Follow-ups Today", "WhatsApp Today", "Pending", "Status"].map(
                        (h) => (
                          <th
                            key={h}
                            className={`px-4 py-3 sm:py-4 text-xs font-bold uppercase ${theme.tableBorder}`}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${theme.tableDivide}`}>
                    {allStaff.length === 0 ? (
                      <tr>
                        <td colSpan={8} className={`text-center py-8 ${theme.textMuted}`}>
                          No staff data found.
                        </td>
                      </tr>
                    ) : (
                      allStaff.map((s: any, i: number) => {
                        const hasNoActivity = s.totalLeads > 0 && s.followUpsToday === 0;
                        const isHighPending = s.remainingToday > 5;
                        return (
                          <tr
                            key={s.name}
                            className={`transition-colors ${theme.tableRow} ${hasNoActivity
                              ? isDark
                                ? "bg-red-500/5"
                                : "bg-red-50/50"
                              : ""
                              }`}
                          >
                            <td className={`px-4 py-3 sm:py-4 text-xs font-bold ${theme.textFaint}`}>{i + 1}</td>
                            <td className={`px-4 py-3 sm:py-4 font-bold ${theme.text}`}>{s.name}</td>
                            <td className="px-4 py-3 sm:py-4">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadge(s.role)}`}>
                                {s.role}
                              </span>
                            </td>
                            <td className={`px-4 py-3 sm:py-4 font-bold ${theme.text}`}>{s.totalLeads}</td>
                            <td className="px-4 py-3 sm:py-4">
                              <span className={`font-bold text-sm ${getStatusColor(s.followUpsToday, Math.max(s.totalLeads, 1))}`}>
                                {s.followUpsToday}
                              </span>
                            </td>
                            <td className={`px-4 py-3 sm:py-4 font-bold ${s.waToday > 0 ? "text-green-500" : theme.textFaint}`}>
                              {s.waToday > 0 ? `📱 ${s.waToday}` : "—"}
                            </td>
                            <td className="px-4 py-3 sm:py-4">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full border ${s.remainingToday === 0
                                  ? isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-200 bg-green-50"
                                  : isHighPending
                                    ? isDark ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-red-700 border-red-200 bg-red-50"
                                    : isDark ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" : "text-yellow-700 border-yellow-200 bg-yellow-50"
                                  }`}
                              >
                                {s.remainingToday}
                              </span>
                            </td>
                            <td className="px-4 py-3 sm:py-4">
                              {hasNoActivity ? (
                                <span className="text-xs font-bold text-red-500">⚠️ No activity</span>
                              ) : s.remainingToday === 0 ? (
                                <span className="text-xs font-bold text-green-500">✅ All done</span>
                              ) : (
                                <span className={`text-xs font-bold ${isDark ? "text-yellow-400" : "text-yellow-600"}`}>
                                  🔄 In progress
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════ BY ROLE TAB ════ */}
        {activeTab === "managers" && (
          <div className="space-y-5 animate-fadeIn">
            <div>
              <h3 className={`crm-eyebrow mb-4 flex items-center gap-2 ${theme.text}`}>
                <span className={`w-2 h-2 rounded-full ${isDark ? "bg-[#d946a8]" : "bg-[#9E217B]"}`} />
                Sales Managers — Daily Follow-up Status
              </h3>
              {salesManagers.length === 0 ? (
                <p className={`text-sm ${theme.textFaint}`}>No sales managers found.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {salesManagers.map((s: any) => (
                    <StaffCard key={s.name} s={s} isDark={isDark} theme={theme} getRoleBadge={getRoleBadge} getBarColor={getBarColor} />
                  ))}
                </div>
              )}
            </div>

            {siteHeadStats.length > 0 && (
              <div>
                <h3 className={`crm-eyebrow mb-4 flex items-center gap-2 ${theme.text}`}>
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Site Heads — Daily Follow-up Status
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {siteHeadStats.map((s: any) => (
                    <StaffCard key={s.name} s={s} isDark={isDark} theme={theme} getRoleBadge={getRoleBadge} getBarColor={getBarColor} />
                  ))}
                </div>
              </div>
            )}

            {receptionistStats.length > 0 && (
              <div>
                <h3 className={`crm-eyebrow mb-4 flex items-center gap-2 ${theme.text}`}>
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  Receptionists — Daily Follow-up Status
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {receptionistStats.map((s: any) => (
                    <StaffCard key={s.name} s={s} isDark={isDark} theme={theme} getRoleBadge={getRoleBadge} getBarColor={getBarColor} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ SITE VISITS TAB ════ */}
        {activeTab === "visits" && (
          <div className="space-y-5 animate-fadeIn">
            {/* Stat cards row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Total Today", value: data.siteVisitsToday.length, color: isDark ? "text-[#d946a8]" : "text-[#9E217B]" },
                { label: "Completed", value: data.completedVisitsToday ?? 0, color: "text-green-500" },
                { label: "Pending Today", value: data.pendingVisitsToday ?? 0, color: "text-orange-500" },
                { label: "Tomorrow", value: (data.siteVisitsTomorrow ?? []).length, color: isDark ? "text-blue-400" : "text-blue-600" },
              ].map((c, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-5 border ${theme.card}`}
                  style={theme.cardGlass}
                >
                  <p className={`crm-eyebrow mb-2 ${theme.textFaint}`}>
                    {c.label}
                  </p>
                  <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>

            {/* ── Unified Site Visit Center accordion ── */}
            <SiteVisitCenter
              data={data}
              theme={theme}
              isDark={isDark}
              allLeads={allLeads}
              adminUser={adminUser}
              expandedVisitLeadId={expandedVisitLeadId}
              setExpandedVisitLeadId={setExpandedVisitLeadId}
              visitActivityRoleFilter={visitActivityRoleFilter}
              setVisitActivityRoleFilter={setVisitActivityRoleFilter}
              visitActivityFilter={visitActivityFilter}
              setVisitActivityFilter={setVisitActivityFilter}
              visitActivityPeople={visitActivityPeople}
              filteredSiteVisitActions={filteredSiteVisitActions}
              fetchStats={fetchStats}
            />
          </div>
        )}

        {/* ════ ALERTS TAB ════ */}
        {activeTab === "alerts" && (
          <div className="space-y-4 animate-fadeIn">
            <AlertSection
              title="🚨 No Activity Today"
              subtitle="employees"
              items={allStaff.filter((s: any) => s.totalLeads > 0 && s.followUpsToday === 0)}
              emptyMsg="✅ All employees have activity today!"
              badgeText={(_s: any) => `0 follow-ups`}
              borderColor={isDark ? "border-red-500/20" : "border-red-200"}
              headerBg={isDark ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200"}
              titleColor="text-red-500"
              badgeColor={isDark ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-red-700 border-red-200 bg-red-50"}
              itemBg={isDark ? "bg-red-500/5 border-red-500/20" : "bg-red-50 border-red-100"}
              theme={theme}
              isDark={isDark}
            />
            <AlertSection
              title="⚠️ High Pending Follow-ups"
              subtitle="employees"
              items={allStaff.filter((s: any) => s.remainingToday > 5)}
              emptyMsg="✅ No one has excessive pending follow-ups!"
              badgeText={(s: any) => `${s.remainingToday} pending`}
              borderColor={isDark ? "border-yellow-500/20" : "border-yellow-200"}
              headerBg={isDark ? "bg-yellow-500/10 border-yellow-500/20" : "bg-yellow-50 border-yellow-200"}
              titleColor="text-yellow-500"
              badgeColor={isDark ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" : "text-yellow-700 border-yellow-200 bg-yellow-50"}
              itemBg={isDark ? "bg-yellow-500/5 border-yellow-500/20" : "bg-yellow-50 border-yellow-100"}
              theme={theme}
              isDark={isDark}
            />
            <AlertSection
              title="✅ All Caught Up Today"
              subtitle="employees"
              items={allStaff.filter((s: any) => s.followUpsToday > 0 && s.remainingToday === 0)}
              emptyMsg="No one has completed all follow-ups yet today."
              badgeText={(s: any) => `✅ ${s.followUpsToday} done`}
              borderColor={isDark ? "border-green-500/20" : "border-green-200"}
              headerBg={isDark ? "bg-green-500/10 border-green-500/20" : "bg-green-50 border-green-200"}
              titleColor="text-green-500"
              badgeColor={isDark ? "text-green-400 bg-green-500/10 border-green-500/30" : "text-green-700 border-green-200 bg-green-50"}
              itemBg={isDark ? "bg-green-500/5 border-green-500/20" : "bg-green-50 border-green-100"}
              theme={theme}
              isDark={isDark}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SiteVisitScheduler({
  lead, adminUser, isDark, theme, onSuccess
}: {
  lead: any; adminUser: any; isDark: boolean;
  theme: any; onSuccess: () => void;
}) {
  const [visits, setVisits] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [visitDate, setVisitDate] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editVisit, setEditVisit] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchVisits = async () => {
    try {
      const res = await fetch(`/api/site-visits?lead_id=${lead.id}`);
      const json = await res.json();
      if (json.success) setVisits(json.data);
    } catch { }
  };

  useEffect(() => { fetchVisits(); }, [lead.id]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDate) return;
    setIsSaving(true);
    try {
      const method = editVisit ? "PATCH" : "POST";
      const body = editVisit
        ? { id: editVisit.id, visit_date: visitDate, notes: visitNotes }
        : { lead_id: lead.id, visit_date: visitDate, created_by: adminUser?.name || "Admin", role: adminUser?.role || "admin", notes: visitNotes };

      const res = await fetch("/api/site-visits", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        showToast("❌ " + json.message);
        return;
      }

      const visitLabel = editVisit ? "Re-Site Visit Rescheduled" : visits.length === 0 ? "Site Visit Scheduled" : "Re-Site Visit Scheduled";
      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: adminUser?.name || "Admin",
          createdBy: adminUser?.role === "admin" ? "admin" : adminUser?.role === "receptionist" ? "receptionist" : "sales",
          message: `📅 ${visitLabel}:\n• Date: ${new Date(visitDate).toLocaleString("en-IN")}\n• Notes: ${visitNotes || "N/A"}`,
          siteVisitDate: visitDate,
          createdAt: new Date().toISOString(),
        }),
      });

      showToast(`✅ ${visitLabel}!`);
      setShowModal(false);
      setVisitDate("");
      setVisitNotes("");
      setEditVisit(null);
      fetchVisits();
      onSuccess();
    } catch {
      showToast("❌ Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (visitId: number, status: string) => {
    try {
      const res = await fetch("/api/site-visits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: visitId, status }),
      });
      const json = await res.json();
      if (!json.success) {
        showToast("❌ " + json.message);
        return;
      }

      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: adminUser?.name || "Admin",
          createdBy: adminUser?.role === "admin" ? "admin" : adminUser?.role === "receptionist" ? "receptionist" : "sales",
          message: `🔄 Site Visit marked as ${status.toUpperCase()} by ${adminUser?.name || "Admin"}`,
          siteVisitDate: null,
          createdAt: new Date().toISOString(),
        }),
      });

      showToast(`✅ Visit marked as ${status}`);
      fetchVisits();
      onSuccess();
    } catch {
      showToast("❌ Update failed.");
    }
  };

  const upcomingVisit = visits.find((v: any) => v.status === "scheduled" && new Date(v.visit_date) >= new Date());
  const isClosing = lead.status === "Closing" || !!lead.closingDate;

  const statusBadge = (status: string) => {
    if (status === "completed") return "text-green-400 border-green-500/30 bg-green-500/10";
    if (status === "cancelled") return "text-red-400 border-red-500/30 bg-red-500/10";
    return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
  };

  return (
    <div className={`rounded-xl border p-5 ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200"}`}>
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-xl shadow-lg text-sm font-bold text-white bg-green-600 animate-fadeIn border border-green-400">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className={`font-bold text-sm flex items-center gap-2 ${theme.text}`}>
            <FaCalendarAlt className="text-orange-400" /> Site Visit History
          </h3>
          {upcomingVisit && (
            <p className="text-xs text-orange-400 font-semibold mt-0.5">
              Next: {new Date(upcomingVisit.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        {!isClosing && (
          <button
            onClick={() => { setEditVisit(null); setVisitDate(""); setVisitNotes(""); setShowModal(true); }}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${visits.length === 0
              ? (isDark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-500 hover:bg-orange-400 text-white")
              : (isDark ? "bg-orange-600/20 hover:bg-orange-600 border border-orange-500/30 text-orange-400 hover:text-white" : "bg-orange-50 hover:bg-orange-500 border border-orange-300 text-orange-600 hover:text-white")
              }`}
          >
            <FaCalendarAlt className="text-[10px]" />
            {visits.length === 0 ? "Schedule Visit" : "Re-Site Visit"}
          </button>
        )}
      </div>

      {visits.length === 0 ? (
        <p className={`text-xs text-center py-2.5 ${theme.textFaint}`}>No site visits scheduled yet.</p>
      ) : (
        <div className="relative">
          <div className={`absolute left-3 top-0 bottom-0 w-px ${isDark ? "bg-[#333]" : "bg-indigo-100"}`} />
          <div className="space-y-4 pl-8">
            {visits.map((v: any, i: number) => (
              <div key={v.id} className="relative">
                <div className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full border-2 ${v.status === "completed" ? "bg-green-500 border-green-400" :
                  v.status === "cancelled" ? "bg-red-500 border-red-400" :
                    "bg-yellow-500 border-yellow-400"
                  }`} />

                <div className={`rounded-xl p-5 border ${isDark ? "bg-[#222] border-[#333]" : "bg-[#F8FAFC] border-indigo-100"}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <p className={`text-xs font-bold ${theme.text}`}>
                        Visit {i + 1} - {new Date(v.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                      <p className={`text-[10px] ${theme.textFaint}`}>
                        {new Date(v.visit_date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · by {v.created_by}
                      </p>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-4xl border uppercase flex-shrink-0 ${statusBadge(v.status)}`}>
                      {v.status}
                    </span>
                  </div>
                  {v.notes && <p className={`text-[11px] italic ${theme.textMuted}`}>{v.notes}</p>}

                  {v.status === "scheduled" && !isClosing && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {adminUser?.role?.toLowerCase() !== "receptionist" && (
                        <button onClick={() => handleStatusChange(v.id, "completed")}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500 hover:text-white transition-colors cursor-pointer">
                          ✓ Mark Completed
                        </button>
                      )}
                      <button onClick={() => handleStatusChange(v.id, "cancelled")}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-colors cursor-pointer">
                        ✕ Cancel
                      </button>
                      <button onClick={() => { setEditVisit(v); setVisitDate(v.visit_date.slice(0, 16)); setVisitNotes(v.notes || ""); setShowModal(true); }}
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors cursor-pointer ${isDark ? "bg-[#333] border-[#444] text-gray-300 hover:bg-[#444]" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                        ✎ Reschedule
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex items-center justify-center p-5 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-xl w-full max-w-md shadow-2xl border overflow-hidden ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200"}`}>
            <div className={`p-5 border-b flex items-center justify-between ${isDark ? "bg-orange-900/20 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
              <div>
                <h2 className={`font-bold flex items-center gap-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>
                  <FaCalendarAlt /> {editVisit ? "Reschedule Visit" : visits.length === 0 ? "Schedule Site Visit" : "Schedule Re-Site Visit"}
                </h2>
                <p className={`text-xs mt-0.5 ${theme.textMuted}`}>Lead #{lead.sr_no || lead.id} - {lead.name}</p>
              </div>
              <button onClick={() => { setShowModal(false); setEditVisit(null); }} className={`p-2 ${theme.textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>
            <form onSubmit={handleSchedule} className={`p-5 space-y-4 ${isDark ? "bg-[#121212]" : "bg-[#F8FAFC]"}`}>
              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDark ? "text-orange-400" : "text-orange-700"}`}>
                  Visit Date & Time *
                </label>
                <input
                  ref={inputRef} required type="datetime-local"
                  value={visitDate}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={e => setVisitDate(e.target.value)}
                  onClick={() => inputRef.current?.showPicker()}
                  className={`w-full rounded-xl px-4 py-3 sm:py-4 text-sm outline-none border-2 transition-colors ${isDark ? "bg-[#1a1a1a] border-orange-500/40 text-white focus:border-orange-500" : "bg-white border-orange-300 text-[#1A1A1A] focus:border-orange-500"
                    }`}
                />
              </div>
              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDark ? "text-orange-400" : "text-orange-700"}`}>
                  Notes / Reason
                </label>
                <textarea
                  value={visitNotes} onChange={e => setVisitNotes(e.target.value)} rows={3}
                  placeholder={visits.length > 0 ? "e.g. Customer needs to see the 3BHK units again..." : "e.g. First visit scheduled with customer..."}
                  className={`w-full rounded-xl px-4 py-3 sm:py-4 text-sm outline-none resize-none border-2 transition-colors ${isDark ? "bg-[#1a1a1a] border-orange-500/30 text-white focus:border-orange-500" : "bg-white border-orange-200 text-[#1A1A1A] focus:border-orange-500"
                    }`}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditVisit(null); }}
                  className={`flex-1 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500 border ${isDark ? "border-[#333]" : "border-gray-200"}`}>
                  Cancel
                </button>
                <button type="submit" disabled={isSaving || !visitDate}
                  className={`flex-1 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${isSaving || !visitDate
                    ? "bg-gray-400 text-white cursor-not-allowed"
                    : (isDark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-500 hover:bg-orange-400 text-white")
                    }`}>
                  {isSaving ? "Saving..." : editVisit ? "Reschedule" : "Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffCard({ s, isDark, theme, getRoleBadge, getBarColor }: any) {
  const hasNoActivity = s.totalLeads > 0 && s.followUpsToday === 0;
  const completedPct = s.requiredToday > 0 ? Math.round((s.followUpsToday / s.requiredToday) * 100) : 0;
  return (
    <div className={`rounded-4xl border p-5 transition-all ${hasNoActivity ? (isDark ? "border-red-500/30 bg-red-500/5" : "border-red-200 bg-red-50") : theme.card}`}
      style={!hasNoActivity ? theme.cardGlass : {}}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className={`font-bold text-base ${theme.text}`}>{s.name}</h4>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-4xl border mt-1 inline-block ${getRoleBadge(s.role)}`}>{s.role}</span>
        </div>
        <span className="text-lg">{hasNoActivity ? "⚠️" : completedPct >= 80 ? "✅" : "🔄"}</span>
      </div>

      {hasNoActivity && (
        <div className="mb-3 px-4 py-3 sm:py-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs font-bold">
          ⚠️ No follow-ups done today
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Total", value: s.totalLeads, color: theme.text },
          { label: "Done", value: s.followUpsToday, color: "text-green-500" },
          { label: "Remaining", value: s.remainingToday, color: s.remainingToday > 0 ? "text-red-500" : "text-green-500" },
        ].map(stat => (
          <div key={stat.label} className={`rounded-xl p-2 text-center border ${theme.settingsBg}`}>
            <p className={`text-[10px] font-bold ${theme.textFaint}`}>{stat.label}</p>
            <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className={theme.textFaint}>Progress</span>
          <span className={`font-bold ${completedPct >= 80 ? "text-green-500" : completedPct >= 40 ? "text-yellow-500" : "text-red-500"}`}>{completedPct}%</span>
        </div>
        <div className={`w-full h-2 rounded-4xl ${isDark ? "bg-[#333]" : "bg-gray-200"}`}>
          <div className={`h-2 rounded-4xl transition-all ${getBarColor(s.followUpsToday, s.requiredToday)}`}
            style={{ width: `${Math.min(completedPct, 100)}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={theme.textFaint}>WhatsApp Today</span>
        <span className={`font-bold ${s.waToday > 0 ? "text-green-500" : theme.textFaint}`}>
          {s.waToday > 0 ? `📱 ${s.waToday} sent` : "None"}
        </span>
      </div>

      {s.noFupLeads.length > 0 && (
        <div className={`mt-3 pt-3 border-t ${isDark ? "border-[#333]" : "border-gray-200"}`}>
          <p className={`crm-eyebrow mb-2 ${theme.textFaint}`}>
            Leads needing follow-up ({s.noFupLeads.length})
          </p>
          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
            {s.noFupLeads.slice(0, 5).map((l: any) => (
              <div key={l.id} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${isDark ? "bg-[#222]" : "bg-gray-50"}`}>
                <span className={`font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>#{l.id}</span>
                <span className={theme.textMuted}>{l.name}</span>
              </div>
            ))}
            {s.noFupLeads.length > 5 && (
              <p className={`text-[10px] px-2 ${theme.textFaint}`}>+{s.noFupLeads.length - 5} more...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertSection({ title, subtitle, items, emptyMsg, badgeText, borderColor, headerBg, titleColor, badgeColor, itemBg, theme, isDark }: any) {
  return (
    <div className={`rounded-xl border overflow-hidden ${borderColor}`}>
      <div className={`p-5 border-b flex items-center justify-between ${headerBg}`}>
        <h3 className={`font-bold flex items-center gap-2 ${titleColor}`}>{title}</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-4xl border ${badgeColor}`}>
          {items.length} {subtitle}
        </span>
      </div>
      <div className="p-5 space-y-3">
        {items.length === 0 ? (
          <p className={`text-sm text-center py-2.5 ${theme.textMuted}`}>{emptyMsg}</p>
        ) : items.map((s: any) => (
          <div key={s.name} className={`flex items-center justify-between p-5 rounded-xl border ${itemBg}`}>
            <div>
              <p className={`font-bold text-sm ${theme.text}`}>{s.name}</p>
              <p className={`text-xs ${theme.textFaint}`}>{s.role} · {s.totalLeads} leads assigned</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-4xl border ${badgeColor}`}>
              {badgeText(s)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FaEye import needed for profile panel ──
function FaEye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 576 512" fill="currentColor" width="1em" height="1em">
      <path d="M572.52 241.4C518.29 135.59 410.93 64 288 64S57.68 135.64 3.48 241.41a32.35 32.35 0 0 0 0 29.19C57.71 376.41 165.07 448 288 448s230.32-71.64 284.52-177.41a32.35 32.35 0 0 0 0-29.19zM288 400a144 144 0 1 1 144-144 143.93 143.93 0 0 1-144 144zm0-240a95.31 95.31 0 0 0-25.31 3.79 47.85 47.85 0 0 1-66.9 66.9A95.78 95.78 0 1 0 288 160z" />
    </svg>
  );
}

export default function AdminAtlasDashboard() {
  return (
    <Suspense fallback={<div>Loading Dashboard...</div>}>
      <AdminAtlasDashboardContent />
    </Suspense>
  );
}
