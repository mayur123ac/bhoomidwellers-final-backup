// sales manager

"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useActivityTracker, emitActivity } from "@/hooks/useActivityTracker";
import SalesSidebar, { SALES_NAV } from "@/components/sales/SalesSidebar";
import { useFeaturePrefs } from "@/hooks/useFeaturePrefs";
import { compareLeads } from "@/lib/featurePrefs";
import { useRouter } from "next/navigation";
import AttendanceView from "@/components/AttendanceView";
import dynamic from "next/dynamic";

import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { useShiftTiming } from "@/hooks/useShiftTiming";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, User, Send, BarChart2, AlertTriangle, Landmark, CalendarDays,
  Lightbulb, ClipboardList, Wifi, CheckCircle, XCircle, HelpCircle,
  Clock, MapPin, Zap, TrendingUp, Home, Building2, Globe, Star,
  Share2, Image, Banknote, Users, BadgeCheck, CalendarCheck, Ghost,
  ArrowRight, Target, BrainCircuit, Flame, ChevronLeft, ChevronRight, ChevronDown, Trash2
} from "lucide-react";

import {
  FaThLarge, FaCog, FaFileInvoice,
  FaChevronLeft, FaCheckCircle, FaPaperPlane, FaTimes, FaPhoneAlt,
  FaCalendarAlt, FaUserCircle, FaMicrophone, FaWhatsapp, FaRobot,
  FaEyeSlash, FaEye, FaSearch, FaUniversity, FaUsers, FaFileAlt, FaCheck,
  FaClock, FaBell, FaHandshake, FaClipboardList, FaBuilding, FaEdit
} from "react-icons/fa";

import InventoryManagementView from "@/components/InventoryManagementView";
import InlineContactField from "@/components/InlineContactField";
import { contactFieldSave } from "@/lib/contactFieldSave";
import UploadLeadSheet from "@/components/UploadLeadSheet";
import SelfUploadLeadSheet from "@/components/SelfUploadLeadSheet";
import LoginTimerWidget from "@/components/LoginTimerWidget";
import AttendanceBadge from "@/components/AttendanceBadge";
import { useAttendance } from "@/components/AttendanceContext";
import BookingFormModal from "@/components/BookingFormModal";
import SMAssistantDock from "@/components/SMAssistantDock";
import BookingApplicationView from "@/components/BookingApplicationView";
import ClosedLeadBookingView from "@/components/ClosedLeadBookingView";
import LostLeadModal from "@/components/LostLeadModal";
import PermanentLeadDeleteDialog from "@/components/PermanentLeadDeleteDialog";
import LoanDealForm from "@/components/LoanDealForm";
import LoanDealView from "@/components/LoanDealView";
import BolnaCallWidget from "@/components/BolnaCallWidget";
import CallingButtons from "@/components/CallingButtons";
// import ActivityTimeline from "@/components/ActivityTimeline";
import { handleMarkLostLead as markLostLeadApi, restoreLostLead, updateLeadLostState, useLostLeadEvents } from "@/lib/lostLeadSync";

import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import UserAvatar from "@/components/UserAvatar";
import AppHeader from "@/components/AppHeader";
// The notification queue. Built and organization-scoped on the server — see
// lib/notifications/feed.ts for why it is no longer derived in this file.
import {
  useNotificationFeed,
  openNotificationLead,
  withinNextDay,
  type CrmNotification,
} from "@/lib/hooks/useNotificationFeed";
import NotificationPopover from "@/components/notifications/NotificationPopover";
import NotificationCenterView from "@/components/notifications/NotificationCenterView";

const SiteVisitOverview = dynamic(() => import("../../dashboard/SiteVisitOverview"), { ssr: false });

// PERF: recharts (~8 MB in node_modules) used to be a static import at the top of
// this file, so it sat in the sales route's initial JavaScript and was parsed
// before first paint even for users who never open the Overview charts. Loading
// the chart module on demand keeps it out of that path. ssr: false because
// ResponsiveContainer measures the DOM and has nothing to measure on the server.
const DashboardAnalytics = dynamic(() => import("@/components/sales/SalesDashboardAnalytics"), { ssr: false });
const CARDS_PER_PAGE = 20;
// Views this page can be asked to open by name. Derived from the rail rather
// than retyped, and filtered so a stale or hand-edited `return_tab` cannot set
// activeView to something that renders nothing. "settings" is excluded because
// it is a route, not a view of this page.
const SALES_VIEW_IDS = new Set(SALES_NAV.filter((i) => i.id !== "settings").map((i) => i.id));

// What the header shows for each view. Taken from the rail's own labels rather
// than retyped, so the bar and the sidebar can never disagree about what the
// current page is called. The two entries below are views with no rail item of
// their own: a lead's detail page belongs to Assigned Leads, and "sales" is a
// legacy alias for the overview.
const SALES_CONTEXT: Record<string, string> = {
  ...Object.fromEntries(SALES_NAV.map((i) => [i.id, i.label])),
  detail: "Assigned Leads",
  sales: "Dashboard",
  // No rail item of its own: you arrive here from a popover's "See all N …"
  // footer, not from the sidebar.
  notifications: "Notification Center",
};
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// ─── SUN/MOON ICONS ───────────────────────────────────────────────────────────
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


// ─── THEME TOKEN BUILDER ──────────────────────────────────────────────────────
function buildTheme(isDark: boolean) {
  return {
    // ── Page & Layout ──
    pageWrap: isDark ? "bg-[#0A0A0F] text-white" : "text-[#1A1A1A]",
    mainBg: isDark ? "bg-[#121212]" : "bg-[#F1F5F9]",

    // ── Sidebar (stays dark in both modes, like receptionist) ──
    sidebar: "bg-[#1a1a1a] border-[#2a2a2a]",

    // ── Header ──
    header: isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-[#9CA3AF]",
    headerGlass: isDark ? {} : { boxShadow: "0 1px 0 #9CA3AF, 0 4px 16px rgba(158,33,123,0.06)" },

    // ── Cards (Hover color and shadow only, no size increase) ──
    card: isDark
      ? "bg-[#1a1a1a] border border-[#2a2a2a] transition-all duration-300 hover:border-[#d946a8]/50 hover:bg-[#1e1e1e] hover:shadow-2xl hover:shadow-[#d946a8]/20 flex flex-col h-full"
      : "bg-gradient-to-r from-[#f1f5ff] via-[#eef2ff] to-[#f5f3ff] border border-indigo-300 transition-all duration-300 hover:border-[#9E217B]/50 hover:shadow-2xl hover:shadow-[#9E217B]/20 flex flex-col h-full",
    cardGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.07), 0 12px 28px rgba(0,0,0,0.08)" },
    cardClosing: isDark ? "bg-yellow-900/10 border-yellow-500/30 transition-all duration-300 hover:border-yellow-400/60 hover:shadow-2xl hover:shadow-yellow-500/20 flex flex-col h-full" : "bg-amber-50 border-amber-200 transition-all duration-300 hover:border-amber-400/60 hover:shadow-2xl hover:shadow-[0_0_20px_4px_rgba(251,191,36,0.15)] flex flex-col h-full",

    // ── Tables ──
    tableWrap: isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border border-indigo-300",
    tableGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },
    tableHead: isDark ? "bg-[#222]" : "bg-[#F1F5F9] border border-indigo-300",
    tableRow: isDark ? "hover:bg-[#252525]" : "hover:bg-[#F8FAFC] border border-indigo-200",
    tableDivide: isDark ? "divide-[#2a2a2a]" : "divide-[#E5E7EB]",
    tableBorder: isDark ? "border-[#2a2a2a]" : "border-[#D1D5DB]",

    // ── Inputs ──
    inputBg: isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-white border border-indigo-300",
    inputInner: isDark ? "bg-[#121212] border-[#333]" : "bg-white border border-indigo-300",
    inputFocus: isDark ? "focus:border-[#d946a8]" : "focus:border-[#00AEEF]",

    // ── Inner blocks / settings bg ──
    settingsBg: isDark ? "bg-[#222] border-[#2a2a2a]" : "bg-[#F8FAFC] border border-indigo-300",
    settingsBgGl: isDark ? {} : { boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04)" },
    innerBlock: isDark ? "bg-[#121212] border-[#333]" : "bg-white border-[#D1D5DB]",

    // ── Modals / panels ──
    modalCard: isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border border-indigo-300",
    modalGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(158,33,123,0.08), 0 32px 72px rgba(0,0,0,0.16)" },
    modalInner: isDark ? "bg-[#121212]" : "bg-[#F8FAFC] border border-indigo-300",
    modalHeader: isDark ? "bg-[#151515]" : "bg-[#F1F5F9]",

    // ── Dropdowns / Notifications ──
    dropdown: isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-[#9CA3AF]",
    dropdownGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 20px rgba(158,33,123,0.08), 0 20px 40px rgba(0,0,0,0.10)" },
    dropdownItem: isDark ? "hover:bg-[#222] border-[#222]" : "hover:bg-[#F8FAFC] border-[#F0F0F0]",

    // ── Typography ──
    text: isDark ? "text-white" : "text-[#0f172a]",
    textMuted: isDark ? "text-gray-400" : "text-[#334155]",
    textFaint: isDark ? "text-gray-500" : "text-[#475569]",
    textHeader: isDark ? "text-xs text-gray-500 uppercase" : "text-xs text-[#334155] font-bold uppercase",

    // ── Navigation ──
    navActive: isDark ? "bg-gradient-to-r from-[#9E217B]/40 to-[#7B2FF7]/20 border-[#d946a8]/60 text-[#d946a8]" : "bg-gradient-to-r from-[#9E217B]/40 to-[#7B2FF7]/20 text-[#d946a8] border-transparent",
    navInactive: isDark ? "text-gray-500 hover:text-gray-300 hover:bg-white/5 border-transparent" : "text-[#9CA3AF] hover:bg-[#2A2A2A] hover:text-white border-transparent",
    navIndicator: isDark ? "bg-[#d946a8] shadow-[0_0_10px_2px_rgba(158,33,123,0.5)]" : "bg-[#9E217B] shadow-[0_0_8px_rgba(158,33,123,0.4)]",

    // ── Theme Toggle ──
    toggleWrap: isDark ? "bg-[#1C1C2A] border-[#2A2A38] text-yellow-300" : "bg-[#F1F5F9] border-[#9CA3AF] text-[#1A1A1A]",

    // ── Chat ──
    chatArea: isDark ? "bg-[#0a0a0a]" : "bg-[#EDEFF3]",
    chatBubbleAi: isDark ? "bg-[#141414] border border-[#262626] text-gray-200" : "bg-[#F3F4F6] border border-[#E2E8F0] text-gray-900 font-medium shadow-sm",
    chatBubbleUser: isDark ? "bg-[#9E217B] text-white" : "bg-[#9E217B] text-white shadow-md",
    chatInput: isDark
      ? "bg-[#111] border border-[#2a2a2a] hover:border-[#3a3a3a]"
      : "bg-[#F3F4F6] border border-[#CBD5E1] hover:border-[#64748B] shadow-inner",
    chatInputInner: isDark ? "bg-[#111] border border-[#2a2a2a]" : "bg-white border border-[#E5E7EB]",
    chatPanel: isDark ? "bg-[#1a1a1a] border border-[#2a2a2a]" : "bg-white border border-[#E5E7EB]",
    chatPanelGl: isDark ? {} : { boxShadow: "0 2px 6px rgba(0,0,0,0.05), 0 8px 24px rgba(158,33,123,0.08)" },

    // ── Stat glow orbs ──
    statGlow1: isDark ? "bg-[#d946a8]/10" : "bg-[#00AEEF]/10",
    statGlow2: isDark ? "bg-blue-600/10" : "bg-[#9E217B]/10",
    statGlow3: isDark ? "bg-blue-600/10" : "bg-indigo-400/10",
    statGlow4: isDark ? "bg-yellow-500/10" : "bg-amber-400/10",
    statGlow5: isDark ? "bg-green-600/10" : "bg-emerald-400/10",

    // ── Brand accent ──
    accentText: isDark ? "text-[#d946a8] text-[22px]" : "text-[#00AEEF]",
    accentBg: isDark ? "bg-[#d946a8]/10 text-[#d946a8] border border-[#d946a8]/30" : "bg-[#00AEEF]/10 text-[#00AEEF] border border-[#00AEEF]/30",
    sectionTitle: isDark ? "text-[#d946a8]" : "text-[#9E217B]",
    sectionBorder: isDark ? "border-[#d946a8]/20" : "border-[#9E217B]/25",

    // ── Buttons ─
    btnPrimary: isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-md transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2" : "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-sm transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2",
    btnSecondary: isDark ? "bg-[#00AEEF] hover:bg-[#0088bb] text-white shadow-md transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white shadow-sm transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2",
    btnDanger: isDark ? "bg-[#3B1F1F] text-[#F28B82] hover:bg-[#4f2a2a] border border-red-900/30 transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B]/20 border border-[#9E217B]/30 transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2",
    btnWarning: isDark ? "bg-yellow-600 hover:bg-yellow-700 text-white shadow-md transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2" : "bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-colors duration-200 flex items-center justify-center min-h-[40px] px-4 py-2",
    btnClosingBadge: isDark ? "bg-yellow-900/20 border border-yellow-500/40 text-yellow-400 flex items-center justify-center min-h-[40px] px-4 py-2" : "bg-amber-50 border border-amber-400/60 text-amber-600 flex items-center justify-center min-h-[40px] px-4 py-2",

    // ── Logo ──
    logoBg: isDark ? "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30" : "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30",

    // ── Chart colors ──
    chartColors: isDark
      ? ["#d946a8", "#8b5cf6", "#3b82f6", "#0ea5e9", "#6b7280"]
      : ["#00AEEF", "#9E217B", "#0077b6", "#d4006e", "#9CA3AF"],

    // ── Pie/chart tooltip ──
    tooltipBg: isDark ? "#1a1a1a" : "rgba(255,255,255,0.98)",
    tooltipColor: isDark ? "#fff" : "#1A1A1A",
    tooltipBorder: isDark ? "1px solid rgba(158,33,123,0.3)" : "1px solid #E5E7EB",
    legendColor: isDark ? "#9ca3af" : "#6B7280",

    // ── Follow-up bubble backgrounds ──
    fupDefault: isDark ? "bg-[#1f0a18] border border-[#9E217B]/30" : "bg-indigo-50 border border-indigo-200",
    fupLoan: isDark ? "bg-blue-900/20 border border-blue-600/40" : "bg-blue-50 border border-blue-200",
    fupSalesform: isDark ? "bg-[#222] border border-[#444]" : "bg-white border border-[#D1D5DB]",
    fupClosing: isDark ? "bg-yellow-900/20 border border-yellow-600/40" : "bg-amber-50 border border-amber-300",

    // ── Pill/badge status ──
    statusAssigned: isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50",
    statusNew: isDark ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50",
    statusContacted: isDark ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50",
    statusInterested: isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50",
    statusVisit: isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50",
    statusClosing: isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50",
    statusCompleted: isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50",
    statusLost: isDark ? "text-red-300 border-red-500/30 bg-red-950/30" : "text-red-700 border-red-300 bg-red-50",
    statusNGD: "bg-[rgba(251,146,60,0.12)] text-[#F97316] border border-[rgba(249,115,22,0.4)]",
    cardLost: isDark ? "bg-[#171717] border border-red-900/25 opacity-70 grayscale saturate-50 transition-all duration-300 hover:opacity-90 hover:border-red-500/30 flex flex-col h-full" : "bg-slate-100 border border-red-200 opacity-75 grayscale saturate-50 transition-all duration-300 hover:opacity-90 hover:border-red-300 flex flex-col h-full",
    cardNGD: "bg-[rgba(249,115,22,0.06)] border border-[rgba(249,115,22,0.35)] hover:border-[#F97316] shadow-[0_4px_12px_rgba(249,115,22,0.12)] transition-all duration-300 flex flex-col h-full",
    rowLost: isDark ? "bg-[#151515]/80 text-gray-500 opacity-75 grayscale" : "bg-slate-100/80 text-slate-500 opacity-80 grayscale",
    rowNGD: "bg-[rgba(249,115,22,0.03)]",

    // ── Select / form elements ──
    select: isDark ? "bg-[#121212] border-[#333] text-white focus:border-[#d946a8]" : "bg-white border-[#9CA3AF] text-[#1A1A1A] focus:border-[#00AEEF]",
    selectSmall: isDark ? "bg-[#222] border-[#333] text-white" : "bg-white border-[#D1D5DB] text-[#6B7280]",

    // ── Scroll ──
    scroll: isDark ? "scrollbar-dark" : "scrollbar-light",
  };
}

/* Compiled once per process rather than once per call. `new RegExp` inside the
   per-lead loop below was the single hottest allocation on this page: extractField
   runs ~10 times per lead and several fields are requested twice, so at 500 leads
   that was ~5,000 regex compilations every poll. Mirrors dashboard/page.tsx:204. */
const SALESFORM_FIELD_RE = new Map<string, RegExp>(
  [
    "Property Type", "Location", "Budget", "Use Type", "Planning to Purchase",
    "Decision Maker", "Loan Planned", "Lead Status",
  ].map((f) => [f, new RegExp(`• ${f}: (.*)`)])
);

const EMPTY_FUPS: any[] = [];

/** Poll interval, matching the admin dashboard. Was 5 s here — see useAdminData. */
const SALES_POLL_MS = 30_000;

// ============================================================================
// SHARED REAL-TIME DATA HOOK
// ============================================================================
function useAdminData() {
  const [managers, setManagers] = useState<any[]>([]);
  const [receptionists] = useState<any[]>([]);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /* Guards against overlapping polls. One pass can take longer than the interval,
     and without this the requests stack: each new one adds DB load and a fresh
     main-thread merge while the previous is still running, so the page falls
     progressively further behind and never recovers. */
  const inFlight = useRef(false);

  const fetchAdminData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      /* These three are independent, so they go out together. They used to be a
         sequential await chain, which made every refresh the SUM of three Neon
         round trips (~250 ms) instead of the slowest one. */
      const [resUsers, resLeads, resFups] = await Promise.all([
        fetch("/api/users/sales-manager"),
        fetch("/api/walkin_enquiries?limit=10000&offset=0"),
        fetch("/api/followups"),
      ]);

      let smData: any[] = [];
      if (resUsers.ok) { const json = await resUsers.json(); smData = json.data || []; }

      let pgLeads: any[] = [];
      if (resLeads.ok) { const json = await resLeads.json(); pgLeads = Array.isArray(json.data) ? json.data : []; }

      let mongoFollowUps: any[] = [];
      if (resFups.ok) { const json = await resFups.json(); mongoFollowUps = Array.isArray(json.data) ? json.data : []; }

      /* Index the follow-ups by lead once, up front.
         This used to be `mongoFollowUps.filter(...)` INSIDE the per-lead map,
         which is O(leads × follow-ups). The admin dashboard measured that same
         code at 5.8 SECONDS of frozen UI at scale, and 20 ms once indexed. The
         output is identical — only the lookup changes. */
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

        /* Memoised per lead: extractField is called ~10 times per lead and several
           fields are requested twice, so without the cache the same message is
           re-scanned repeatedly. */
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
        let loanStatus = "N/A", loanAmtReq = "N/A", loanAmtApp = "N/A";
        if (loanUpdates.length > 0) {
          const msg = loanUpdates[loanUpdates.length - 1].message;
          const mS = msg.match(/• Status: (.*)/); if (mS) loanStatus = mS[1].trim();
          const mR = msg.match(/• Amount Requested: (.*)/); if (mR) loanAmtReq = mR[1].trim();
          const mA = msg.match(/• Amount Approved: (.*)/); if (mA) loanAmtApp = mA[1].trim();
        }

        const fupsWithDate = leadFups.filter((f: any) => f.siteVisitDate?.trim() !== "");
        const latestVisitDate = fupsWithDate.length > 0 ? fupsWithDate[fupsWithDate.length - 1].siteVisitDate : null;
        const activeBudget = extractField("Budget") !== "Pending" ? extractField("Budget") : lead.budget;

        const closingFups = leadFups.filter((f: any) => f.message?.includes("✅ Lead Marked as Closing"));
        const reopenFups = leadFups.filter((f: any) => f.message?.includes("↩️ Lead Reopened"));
        const lastReopenAt = reopenFups.length > 0 ? new Date(reopenFups[reopenFups.length - 1].createdAt).getTime() : 0;
        const closingFupsSinceReopen = closingFups.filter((f: any) => new Date(f.createdAt).getTime() > lastReopenAt);
        const closingDate = closingFupsSinceReopen.length > 0 ? closingFupsSinceReopen[closingFupsSinceReopen.length - 1].createdAt : null;

        return {
          ...lead,
          propType: extractField("Property Type") !== "Pending"
            ? extractField("Property Type")
            : (lead.configuration && lead.configuration !== "N/A" ? lead.configuration : "Pending"),
          salesBudget: activeBudget,
          useType: extractField("Use Type") !== "Pending" ? extractField("Use Type") : (lead.purpose || "Pending"),
          planningPurchase: extractField("Planning to Purchase"),
          loanPlanned: extractField("Loan Planned") !== "Pending" ? extractField("Loan Planned") : (lead.loan_planned || "Pending"),
          leadInterestStatus: extractField("Lead Status"),
          loanStatus, loanAmtReq, loanAmtApp,
          source: lead.source, sourceOther: lead.source_other,
          cpName: lead.cp_name, cpCompany: lead.cp_company, cpPhone: lead.cp_phone,
          // See dashboard/page.tsx — the booking form needs the resolved partner id
          // to attribute commission, not just the free-text CP name/phone.
          channelPartnerId: lead.channel_partner_id,
          altPhone: lead.alt_phone, address: lead.address,
          mongoVisitDate: latestVisitDate,
          closingDate,
          status: lead.status === "Closing" ? "Closing" : latestVisitDate ? "Visit Scheduled" : lead.status,
        };
      });

      setManagers(smData);
      setAllLeads(mergedLeads);
      setFollowUps(mongoFollowUps);
      setIsLoading(false);
    } catch (e) { console.error("Admin data sync failed", e); }
    finally { inFlight.current = false; }
  }, []);

  const applyLeadUpdate = useCallback((updatedLead: any) => {
    setAllLeads(prev => updateLeadLostState(prev, updatedLead));
  }, []);

  useEffect(() => {
    fetchAdminData();
    /* Was every 5 seconds, unguarded. That is 12 full refreshes a minute per open
       tab — every lead and every follow-up in the organization, re-merged and
       re-rendered — whether or not anyone was looking, and whether or not
       anything had changed. A tab left open on a second monitor issued the same
       full-database refresh all day while competing for the same 10-connection
       pool as the people actually working.

       Background tabs are now skipped outright, and returning to the tab
       refreshes immediately, so pausing costs no freshness at the only moment it
       matters — when someone looks at it again. This is the pattern the admin
       dashboard already uses (dashboard/page.tsx:412-430). */
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchAdminData();
    }, SALES_POLL_MS);
    const onVisible = () => { if (!document.hidden) fetchAdminData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchAdminData]);

  useLostLeadEvents(applyLeadUpdate, fetchAdminData);

  /* Push one newly-created follow-up into local state, so a mutation that only
     adds a timeline entry does not have to re-download the organization. The
     row comes straight from POST /api/followups, which returns it. */
  const appendFollowUp = useCallback((row: any) => {
    if (!row) return;
    setFollowUps(prev => (prev.some(f => String(f._id) === String(row._id)) ? prev : [...prev, row]));
  }, []);

  return { managers, receptionists, allLeads, followUps, isLoading, refetch: fetchAdminData, appendFollowUp };
}

// ============================================================================
// MAIN DASHBOARD SHELL
// ============================================================================
export default function SalesDashboard() {
  const router = useRouter();
  const { isMarkedPresent, timeIn } = useAttendance();
  useActivityTracker();
  // The shared theme, from lib/theme.ts. This used to be a local useState that
  // reset to light on every navigation and was never stored anywhere; it now
  // reads the same value Preferences → Theme writes.
  const { isDark, toggleTheme } = useCrmTheme();
  const t = buildTheme(isDark);
  const getStatusStyle = (status: string) => {
    const s = status || "Assigned";
    if (s === "New Lead") return t.statusNew;
    if (s === "Assigned") return t.statusAssigned;
    if (s === "Contacted") return t.statusContacted;
    if (s === "Interested") return t.statusInterested;
    if (s === "Visit Scheduled") return t.statusVisit;
    if (s === "Completed") return t.statusCompleted;
    if (s === "Closing" || s === "Closed") return t.statusClosing;
    if (s === "Lost Lead") return t.statusLost;
    return t.statusAssigned;
  };
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [user, setUser] = useState({ name: "Loading...", role: "Sales Manager", email: "", password: "" });
  const [activeView, setActiveView] = useState("overview");
  const [showPassword, setShowPassword] = useState(false);
  // Dismissals now live in the notification feed hook, keyed by notification id
  // rather than lead id — a lead can raise both a follow-up and a site-visit
  // reminder, and dismissing one used to silence the other.
  //
  // `openBooking` distinguishes the two ways a lead gets opened from outside the
  // Assigned Leads list: Inventory wants the booking form, a notification wants
  // the Lead Detail panel. Previously every jump forced the booking view open.
  const [pendingLeadOpen, setPendingLeadOpen] =
    useState<{ id: number; openBooking?: boolean } | null>(null);
  /** Which tab the Notification Center opens on, set by the footer that sent us there. */
  const [notificationFilter, setNotificationFilter] =
    useState<"all" | "follow_up" | "site_visit" | "new_lead">("all");
  const [activePopup, setActivePopup] = useState<"notifications" | "profile" | "visit" | null>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  // ── Attendance: live clock tick ──
  //
  // PERF: this ticked once a second unconditionally, and setNow lives at the top
  // of this multi-thousand-line component — so the ENTIRE sales dashboard
  // re-rendered 60 times a minute whether or not anyone was looking at a clock.
  // `now` has exactly one consumer, <AttendanceView>, which only mounts on the
  // attendance view, so gating the interval on that is behaviour-identical: when
  // the view is closed nothing reads `now`.
  const [now, setNow] = useState(Date.now());
  const clockRunning = activeView === "attendance";
  useEffect(() => {
    if (!clockRunning) return;
    setNow(Date.now());   // resync immediately on open, don't show a stale second
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [clockRunning]);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (topbarRef.current && !topbarRef.current.contains(event.target as Node)) {
        setActivePopup(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { managers, receptionists, allLeads, followUps, isLoading, refetch, appendFollowUp } = useAdminData();

  // Settings → Additional Features. Read once here and passed down, rather than
  // called again inside SalesManagerView, so the two never disagree mid-render.
  const featurePrefs = useFeaturePrefs();

  // Leads scoped to the logged-in user — Admin sees everything,
  // Sales Manager / Site Head only see leads assigned to them.
  // Used to scope the "Site Visits" tab to the logged-in manager's own visits.
  const myOwnLeads = useMemo(() => {
    const role = (user.role || "").toLowerCase().replace("_", " ");
    const isUnrestricted = role === "admin" || role === "site head";
    return isUnrestricted ? allLeads : allLeads.filter((l: any) => l.assigned_to === user.name);
  }, [allLeads, user]);

  // ── The notification queue ─────────────────────────────────────────────────
  // Built by the server, scoped to this session's organization in SQL. The two
  // useMemo blocks this replaces re-derived the same three rules in the browser
  // from a full download of every lead and every follow-up. That was never a
  // leak on its own — /api/walkin_enquiries is organization-scoped — but it left
  // the tenant boundary implicit in four separate files, any of which could add
  // a fetch that forgot it. It is now one SQL predicate, in one module.
  //
  // Settings → Additional Features is passed through, so a disabled reminder
  // empties the queue at the source rather than being hidden client-side.
  const notifications = useNotificationFeed({
    followUpReminders: featurePrefs.toggles.followUpReminders !== false,
    siteVisitAlerts: featurePrefs.toggles.siteVisitAlerts !== false,
  });
  const followUpLeads = notifications.followUps;
  // This bell means "today & tomorrow", which is narrower than the window the
  // feed returns for the Admin bell and the Notification Center. See
  // withinNextDay: a display window, not a tenant filter.
  const visitNotificationLeads = useMemo(
    () => withinNextDay(notifications.siteVisits),
    [notifications.siteVisits]
  );

  /**
   * Open a notification's lead in the Lead Detail panel.
   *
   * Two steps, in this order, and both matter:
   *   1. Ask the server whether this session may open that lead. It re-reads the
   *      organization from the session and re-applies it, so a notification id
   *      or lead id that came from anywhere else — a stale tab, a hand-made
   *      request, another tenant — resolves to nothing.
   *   2. Only then hand the id to SalesManagerView, which selects the lead from
   *      its own organization-scoped list and switches to the detail view.
   *
   * The popover closes either way; leaving it open over a panel that did not
   * change would read as the click having done nothing.
   */
  const openLeadFromNotification = useCallback(async (n: CrmNotification) => {
    setActivePopup(null);
    const lead = await openNotificationLead(n.leadId);
    if (!lead) {
      console.warn("[notifications] lead is not available for this organization:", n.leadId);
      return;
    }
    setPendingLeadOpen({ id: lead.id });
    setActiveView("forms");
  }, []);

  /** Footer of a capped popover: close it and show the whole queue. */
  const seeAllNotifications = useCallback(
    (filter: "all" | "follow_up" | "site_visit" | "new_lead") => {
      setActivePopup(null);
      setNotificationFilter(filter);
      setActiveView("notifications");
    },
    []
  );

  /** Display extras the feed does not carry: property, budget, interest badge. */
  const leadById = useCallback(
    (leadId: number) => allLeads.find((l: any) => Number(l.id) === Number(leadId)),
    [allLeads]
  );

  // The shared notification components take their classes as props: /dashboard
  // and this page each build their own theme object, and neither should have to
  // know about the other's token names.
  const notifPopoverTheme = useMemo(
    () => ({
      text: t.text,
      textMuted: t.textMuted,
      textFaint: t.textFaint,
      border: t.tableBorder,
      itemHover: t.dropdownItem,
      footer: isDark
        ? "text-[#d946a8] hover:bg-[#9E217B]/10"
        : "text-[#9E217B] hover:bg-[#9E217B]/10",
    }),
    [t, isDark]
  );

  const notifCenterTheme = useMemo(
    () => ({
      text: t.text,
      textMuted: t.textMuted,
      textFaint: t.textFaint,
      border: t.tableBorder,
      card: t.dropdown,
      cardGlass: t.dropdownGlass,
      itemHover: t.dropdownItem,
      chipActive: isDark
        ? "bg-[#9E217B]/20 border-[#9E217B]/50 text-[#d946a8]"
        : "bg-[#9E217B]/10 border-[#9E217B]/40 text-[#9E217B]",
      chipIdle: isDark
        ? "border-[#2a2a2a] text-gray-400 hover:border-[#9E217B]/40"
        : "border-[#D1D5DB] text-[#475569] hover:border-[#9E217B]/40",
    }),
    [t, isDark]
  );

  // Restore the view a rail click asked for before it navigated here — the same
  // `return_tab` convention the Admin dashboard has always used. Without it,
  // choosing "Inventory" from the rail inside Settings would land on this page's
  // default Dashboard view instead of Inventory.
  useEffect(() => {
    try {
      const returnTab = localStorage.getItem("return_tab");
      if (returnTab) {
        localStorage.removeItem("return_tab");
        if (SALES_VIEW_IDS.has(returnTab)) setActiveView(returnTab);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const cleanupBackGuard = installLoggedOutBackGuard(() => router.replace("/"));
    const parsedUser = getStoredCrmUser();
    if (parsedUser) {
      try {
        setUser({
          ...parsedUser,
          name: parsedUser.name || "User",
          password: parsedUser.password || "********",
          whatsapp_number: "" // will be fetched below
        });

        // Fetch WhatsApp number from DB
        fetch(`/api/users/update-whatsapp?name=${encodeURIComponent(parsedUser.name)}`)
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              setUser(prev => ({ ...prev, whatsapp_number: data.whatsapp_number || "" }));
            }
          })
          .catch(console.error);

        if (!(["sales manager", "admin", "site_head", "site head"].includes(parsedUser.role?.toLowerCase())))
          router.replace("/dashboard");
      } catch { router.replace("/"); }
    } else { router.replace("/"); }
    return cleanupBackGuard;
  }, [router]);

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  return (
    <div
      className={`flex flex-col md:flex-row h-screen font-sans overflow-hidden relative ${t.pageWrap}`}
      style={isDark ? {} : {
        background: "linear-gradient(135deg, #e8f6fd 0%, #f8fafc 30%, #faf0fb 62%, #f8fafc 78%, #e6fafe 100%)",
      }}
    >
      {/* ── SIDEBAR ──
          The markup now lives in components/sales/SalesSidebar.tsx so the
          Settings panel can mount the SAME rail instead of falling back to the
          Admin one. Here a click switches the in-page view; there it navigates
          back with the view queued. Nothing about the rail itself differs. */}
      <SalesSidebar
        activeId={activeView === "detail" ? "forms" : activeView}
        onSelect={(item) => {
          if (item.id === "settings") { router.push("/dashboard/settings/profile"); return; }
          setActiveView(item.id);
        }}
        expanded={sidebarExpanded}
        onExpandedChange={setSidebarExpanded}
      />

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative md:ml-[72px]">


        {/* HEADER — the shared global bar. Every control below keeps its own
            handler, popup and state; only the frame, the page context and the
            control chrome are now common with the rest of the CRM. */}
        <AppHeader
          isDark={isDark}
          context={SALES_CONTEXT[activeView] ?? SALES_CONTEXT.overview}
          role={user?.role || "Sales Manager"}
        >
          <div className="flex items-center gap-2 relative" ref={topbarRef}>
            {/* <LoginTimerWidget isDark={isDark} /> */}
            {/* Switches to the My Attendance view in place. Without a handler the
                badge navigates to /dashboard?tab=attendance, which middleware
                bounces to /dashboard/sales — dropping the tab and landing the
                user back on Dashboard, so the button appeared to do nothing. */}
            <AttendanceBadge 
              timeIn={timeIn}
              isMarkedPresent={isMarkedPresent}
              onNavigate={() => setActiveView("attendance")} />

            {/* ── Theme Toggle ── */}
            <button
              onClick={toggleTheme}
              aria-pressed={isDark}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={`h-9 w-9 flex-shrink-0 rounded-lg border flex items-center justify-center transition-colors duration-150 cursor-pointer ${t.toggleWrap}`}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* Site Visit Bell */}
            <div className="relative">
              <button
                onClick={() => { setActivePopup(activePopup === "visit" ? null : "visit"); }}
                className={`relative h-9 w-9 flex-shrink-0 rounded-lg border flex items-center justify-center transition-colors duration-150 cursor-pointer ${t.toggleWrap} hover:border-orange-500/50 ${t.textMuted}`}
              >
                <FaCalendarAlt className="text-sm sm:text-base" />
                {visitNotificationLeads.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-orange-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                    {visitNotificationLeads.length > 9 ? "9+" : visitNotificationLeads.length}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {activePopup === "visit" && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`absolute top-12 right-[-40] sm:right-0 w-72 sm:w-80 rounded-xl shadow-2xl z-50 overflow-hidden border ${t.dropdown}`} style={t.dropdownGlass}
                  >
                    {/* Three at most, sorted by the closest visit first, and no
                        internal scrollbar. The footer carries the real count. */}
                    <NotificationPopover
                      title="Site Visit Reminders"
                      caption="Scheduled for today & tomorrow"
                      items={visitNotificationLeads}
                      footerNoun="upcoming site visits"
                      accent="orange"
                      theme={notifPopoverTheme}
                      onOpenLead={openLeadFromNotification}
                      onDismiss={(n) => notifications.dismiss(n.id)}
                      onSeeAll={() => seeAllNotifications("site_visit")}
                      renderDetail={(n) => {
                        // Property and budget are display extras the feed does
                        // not carry; they come from this page's own
                        // organization-scoped lead list, matched by id.
                        const lead: any = leadById(n.leadId);
                        if (!lead) return null;
                        return (
                          <p className={`text-[10px] mt-0.5 truncate ${t.textFaint}`}>
                            {(lead.propType && lead.propType !== "Pending") ? lead.propType : lead.configuration ? lead.configuration : "Property TBD"} · {lead.salesBudget}
                          </p>
                        );
                      }}
                      renderMetric={(n) => (
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${n.visitDiff === 0 ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"}`}>
                          {n.visitDiff === 0 ? "TODAY" : n.visitDiff === 1 ? "TOMORROW" : `IN ${n.visitDiff}D`}
                        </span>
                      )}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Follow-up Bell */}
            <div className="relative">
              <button
                onClick={() => { setActivePopup(activePopup === "notifications" ? null : "notifications"); }}
                className={`relative h-9 w-9 flex-shrink-0 rounded-lg border flex items-center justify-center transition-colors duration-150 cursor-pointer ${t.toggleWrap} hover:border-purple-500/50 ${t.textMuted}`}
              >
                <FaBell className="text-sm sm:text-base" />
                {followUpLeads.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                    {followUpLeads.length > 9 ? "9+" : followUpLeads.length}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {activePopup === "notifications" && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`absolute top-12 right-0 sm:right-0 w-72 sm:w-80 rounded-xl shadow-2xl z-50 overflow-hidden border ${t.dropdown}`} style={t.dropdownGlass}
                  >
                    {/* Three at most, sorted by the highest daysSince first. The
                        list itself no longer scrolls — the footer opens the
                        Notification Center, which does. */}
                    <NotificationPopover
                      title="Follow-up Reminders"
                      caption="Leads with no activity in 2+ days"
                      items={followUpLeads}
                      footerNoun="pending follow-ups"
                      accent="purple"
                      theme={notifPopoverTheme}
                      onOpenLead={openLeadFromNotification}
                      onDismiss={(n) => notifications.dismiss(n.id)}
                      onSeeAll={() => seeAllNotifications("follow_up")}
                      renderDetail={(n) => {
                        // Property and budget are display extras the feed does
                        // not carry; they come from this page's own
                        // organization-scoped lead list, matched by id. The
                        // interest badge DOES come from the feed, so the badge
                        // and the exclusion rule that hides "Not Interested"
                        // leads read the same value.
                        const lead: any = leadById(n.leadId);
                        return (
                          <>
                            {lead && (
                              <p className={`text-[10px] mt-0.5 truncate ${t.textFaint}`}>
                                {(lead.propType && lead.propType !== "Pending") ? lead.propType : lead.configuration ? lead.configuration : "No property set"} · {lead.salesBudget}
                              </p>
                            )}
                            {n.interestStatus && n.interestStatus !== "Pending" && (
                              <span className={`inline-block mt-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${n.interestStatus === "Interested" ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"}`}>
                                {n.interestStatus}
                              </span>
                            )}
                          </>
                        );
                      }}
                      renderMetric={(n) => (
                        <>
                          <div className={`text-xs font-black ${(n.daysSince ?? 0) >= 7 ? "text-red-400" : (n.daysSince ?? 0) >= 4 ? "text-orange-400" : "text-yellow-400"}`}>
                            {n.daysSince}d
                          </div>
                          <p className={`text-[9px] ${t.textFaint}`}>no contact</p>
                        </>
                      )}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Profile */}
            <div className="relative">
              <div
                onClick={() => { setActivePopup(activePopup === "profile" ? null : "profile"); }}
                className={`h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden font-semibold text-[13px] cursor-pointer border transition-colors duration-150 ${isDark
                  ? "border border-purple-500/40 text-purple-400 bg-purple-500/15"
                  : "border border-[#00AEEF]/40 bg-[#9E217B]/20 text-[#d946a8]"
                  }`}
              >
                <UserAvatar name={user?.name} fallbackNode={<FaUserCircle className="text-lg sm:text-lg" />} alt="" />
              </div>
              <AnimatePresence>
                {activePopup === "profile" && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`absolute top-12 right-0 w-64 rounded-xl shadow-2xl p-3 z-50 border ${t.dropdown}`} style={t.dropdownGlass}
                  >
                    <div className="mb-4">
                      <h3 className={`font-bold text-lg ${t.text}`}>{user.name}</h3>
                      <p className={`text-sm truncate ${t.textMuted}`}>{user.email}</p>
                    </div>
                    <hr className={`mb-4 border-0 border-t ${t.tableBorder}`} />
                    <div className="space-y-4 mb-6 text-sm">
                      <p className={`flex justify-between items-center ${t.textMuted}`}>
                        Role:
                        <span className={`font-bold capitalize px-2 py-0.5 rounded text-xs ${isDark ? "text-purple-400 bg-purple-500/10 border border-purple-500/30" : "text-[#00AEEF] bg-[#00AEEF]/10 border border-[#00AEEF]/30"}`}>{user?.role}</span>
                      </p>
                      <div>
                        <p className={`text-xs mb-1 ${t.textFaint}`}>Password</p>
                        <div className={`flex items-center justify-between p-2 rounded-md border ${t.settingsBg}`} style={t.settingsBgGl}>
                          <span className={`font-mono tracking-widest text-xs ${t.text}`}>{showPassword ? user.password : "••••••••"}</span>
                          <button onClick={() => setShowPassword(!showPassword)} className={`${t.textFaint} cursor-pointer hover:text-current`}><FaEyeSlash /></button>
                        </div>
                      </div>
                    </div>
                    <button onClick={handleLogout} className={`w-full py-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${t.btnDanger}`}>Logout</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </AppHeader>

        <main className={`flex-1 overflow-hidden custom-scrollbar ${t.mainBg} ${activeView === "assistant" ? "p-0" : "p-1 sm:p-3 lg:p-3 overflow-y-auto"}`}>
          {(activeView === "sales" || activeView === "overview" || activeView === "forms" || activeView === "detail" || activeView === "closed-leads") ? (
            <SalesManagerView
              managers={managers} allLeads={allLeads} followUps={followUps}
              isLoading={isLoading} adminUser={user} refetch={refetch} appendFollowUp={appendFollowUp}
              initialView={activeView} setMainView={setActiveView}
              isDark={isDark} t={t}
              featurePrefs={featurePrefs}
              pendingLeadOpen={pendingLeadOpen}                              // ← NEW
              onPendingLeadOpenHandled={() => setPendingLeadOpen(null)}
            />
          ) : activeView === "assistant" ? (
            <AssistantView
              allLeads={user.role === "admin" ? allLeads : allLeads.filter((l: any) => l.assigned_to === user.name)}
              isDark={isDark} t={t} user={user}
            />
          ) : activeView === "site_visits" ? (
            <SiteVisitOverview
              allLeads={myOwnLeads}
              receptionists={receptionists}
              managers={managers}
              siteHeads={[]}
              adminUser={user}
              theme={t}
              isDark={isDark}
            />
          ) : activeView === "inventory" ? (
            <InventoryManagementView
              user={user}
              isDark={isDark}
              t={t}
              onOpenLead={(leadId: number) => {
                // Inventory wants the booking form, not just the lead panel.
                setPendingLeadOpen({ id: leadId, openBooking: true });
                setActiveView("forms");   // mounts SalesManagerView so it can pick up pendingLeadOpen
              }}
            />
          ) : activeView === "attendance" ? (
            <AttendanceView
              adminUser={user}
              isDark={isDark}
              t={t}
              now={now}
            />
          ) : activeView === "notifications" ? (
            /* The Notification Center: the COMPLETE queue the popovers cap at
               three. Reached from a "See all N …" footer, which preselects the
               matching tab. */
            <NotificationCenterView
              newLeads={notifications.newLeads}
              siteVisits={notifications.siteVisits}
              followUps={notifications.followUps}
              isLoading={notifications.isLoading}
              theme={notifCenterTheme}
              initialFilter={notificationFilter}
              onOpenLead={openLeadFromNotification}
              onDismiss={(n) => notifications.dismiss(n.id)}
            />
          ) : (
            <div className={`text-center mt-20 ${t.textMuted}`}>...</div>
          )}
        </main>
      </div>

      {/* ── BOTTOM NAV (MOBILE) ── */}
      <nav className={`md:hidden flex w-full h-16 sm:h-20 border-t items-center justify-around flex-shrink-0 z-40 pb-2 sm:pb-0 ${t.sidebar}`}>
        {[
          { view: "overview", icon: <FaThLarge className="w-5 h-5 sm:w-6 sm:h-6" />, title: "Dashboard" },
          { view: "forms", icon: <FaFileInvoice className="w-5 h-5 sm:w-6 sm:h-6" />, title: "Assigned" },
          { view: "closed-leads", icon: <FaCheckCircle className="w-5 h-5 sm:w-6 sm:h-6" />, title: "Closed" },
          { view: "inventory", icon: <FaBuilding className="w-5 h-5 sm:w-6 sm:h-6" />, title: "Inventory" },
          { view: "site_visits", icon: <FaCalendarAlt className="w-5 h-5 sm:w-6 sm:h-6" />, title: "Visits" },
          { view: "attendance", icon: <FaClock className="w-5 h-5" />, title: "My Attendance" },
          { view: "assistant", icon: <FaRobot className="w-5 h-5 sm:w-6 sm:h-6" />, title: "AI" },
        ].map(({ view, icon, title }) => (
          <div key={view} onClick={() => setActiveView(view)} className="relative flex flex-col justify-center items-center h-full flex-1 cursor-pointer" title={title}>
            {(activeView === view || (view === "forms" && activeView === "detail")) &&
              <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b ${t.navIndicator}`} />}
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center transition-colors ${activeView === view || (view === "forms" && activeView === "detail") ? t.navActive : t.navInactive}`}>{icon}</div>
          </div>
        ))}
      </nav>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar{width:5px;height:5px}
          .custom-scrollbar::-webkit-scrollbar-track{background:transparent}
          .custom-scrollbar::-webkit-scrollbar-thumb{background:rgba(120,80,220,0.3);border-radius:10px}
          .custom-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(150,100,240,0.5)}
        
          /* Sidebar animations */
          @keyframes sm-glow-pulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.55; }
          }
        
          /* Nav item hover prep */
          .sm-nav-item { user-select: none; }
        
          /* Sidebar tooltip for collapsed state */
          .sm-nav-item [title]:hover::after {
            content: attr(title);
            position: absolute;
            left: calc(100% + 12px);
            top: 50%;
            transform: translateY(-50%);
            background: #1a1a2e;
            border: 1px solid rgba(217,70,168,0.3);
            color: #e2e8f0;
            font-size: 11px;
            font-weight: 600;
            padding: 5px 10px;
            border-radius: 8px;
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(217,70,168,0.1);
          }
        
          /* Fade-in animation */
          @keyframes fadeIn {
            from { opacity:0; transform:translateY(-6px) }
            to   { opacity:1; transform:translateY(0) }
          }
          .animate-fadeIn { animation: fadeIn 0.2s ease-out }
        
          /* Bounce */
          @keyframes bounce {
            0%,100% { transform:translateY(0) }
            50%     { transform:translateY(-5px) }
          }
          .animate-bounce { animation: bounce 0.7s infinite }
        `}} />
    </div>
  );
}

// ============================================================================
// HELPER BADGES (unchanged logic)
// ============================================================================
function InterestBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const colorMap: Record<string, string> = {
    Interested: "border-green-500/40 text-green-400 bg-green-500/10",
    "Not Interested": "border-red-500/40 text-red-400 bg-red-500/10",
    "NON GENUINE DEMAND (NGD)": "border-orange-500/40 text-orange-600 bg-orange-500/10",
    "Non Qualified lead": "border-orange-500/40 text-orange-600 bg-orange-500/10",
  };
  const cls = colorMap[status] ?? "border-blue-500/30 text-blue-400 bg-blue-500/10";
  const sz = size === "sm" ? "text-[9px] px-2 py-0.5" : "text-[10px] px-3 py-1";
  return <span className={`rounded-full font-bold uppercase tracking-wider border flex-shrink-0 ${sz} ${cls}`}>{status}</span>;
}

function LoanStatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  if (!s || s === "n/a") return null;
  let cls = "border-gray-500/30 text-gray-400 bg-gray-500/10";
  if (s === "approved") cls = "border-green-500/40 text-green-400 bg-green-500/10";
  if (s === "rejected") cls = "border-red-500/40 text-red-400 bg-red-500/10";
  if (s === "in progress") cls = "border-yellow-500/40 text-yellow-400 bg-yellow-500/10";
  return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border flex items-center gap-1 flex-shrink-0 ${cls}`}><FaUniversity className="text-[7px]" />{status}</span>;
}

// ============================================================================
// DASHBOARD ANALYTICS
// ============================================================================

// ============================================================================
// SALES MANAGER MODULE
// ============================================================================
function SalesManagerView({
  managers, allLeads, followUps, isLoading, adminUser, refetch, appendFollowUp,
  initialView, setMainView, isDark, t, featurePrefs,
  pendingLeadOpen, onPendingLeadOpenHandled,        // ← NEW
}: any) {
  const getStatusStyle = (status: string) => {
    const s = status || "Assigned";
    if (s === "New Lead") return t.statusNew;
    if (s === "Assigned") return t.statusAssigned;
    if (s === "Contacted") return t.statusContacted;
    if (s === "Interested") return t.statusInterested;
    if (s === "Visit Scheduled") return t.statusVisit;
    if (s === "Completed") return t.statusCompleted;
    if (s === "Closing" || s === "Closed") return t.statusClosing;
    if (s === "Lost Lead") return t.statusLost;
    return t.statusAssigned;
  };
  const [autoOpenBooking, setAutoOpenBooking] = useState(false);
  const [subView, setSubView] = useState<"overview" | "cards" | "detail" | "closed-leads">(
    initialView === "overview" ? "overview" : initialView === "detail" ? "detail" : initialView === "closed-leads" ? "closed-leads" : "cards"
  );
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchClosed, setSearchClosed] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState<"all" | "active" | "lost">("all");
  const [showLostLeads, setShowLostLeads] = useState(true);
  const [showNGDLeads, setShowNGDLeads] = useState(true);
  const [columnFilter, setColumnFilter] = useState<string>("all");
  const [detailTab, setDetailTab] = useState<"personal" | "loan">("personal");
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [bookingData, setBookingData] = useState<any>(null);
  const [showBookingView, setShowBookingView] = useState(false);
  const [bookingDetailTab, setBookingDetailTab] = useState<"personal" | "loan" | "booking">("personal");
  // Loan & Deal Tracking panel — independent of bookingData/fetchBookingForLead above,
  // which (when wired up) swaps the whole detail view to ClosedLeadBookingView.
  const [loanDealBooking, setLoanDealBooking] = useState<any>(null);
  const [loanDealLatest, setLoanDealLatest] = useState<any>(null);
  // One pass serves both consumers of the booking row.
  //
  // `loanDealBooking` (the Loan & Deal panel) and `bookingData` (the booking view)
  // were fetched from the SAME URL by two adjacent effects, and both read
  // `data[0]` — the identical row. Browsers do not coalesce two concurrent fetches
  // to the same URL, so that was one wasted request and two wasted Neon round
  // trips (~168 ms measured) on every single lead open.
  //
  // The loan request also used to wait for the booking request to resolve before
  // it started. The two are independent, so they now run together and the slower
  // one alone sets the floor.
  //
  // PAYLOAD: this eager fetch asks for `view=summary` (BOOKING_LIST_SQL — 24
  // explicit columns, one join). The default `view=full` is BOOKING_SELECT_SQL:
  // 121 columns across 6 joins, 2 views and a json_agg, including PAN, Aadhaar,
  // signature data and document URLs. Nothing on the lead-detail screen reads any
  // of that — the summary is used to enable the "View Booking Form" button, and by
  // LoanDealView/LoanDealForm, which between them read `id` and `agreement_value`.
  // The full row is fetched by openBookingView() below, when the user actually
  // opens the booking.
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
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [showSalesForm, setShowSalesForm] = useState(false);
  const [isSubmittingSalesForm, setIsSubmittingSalesForm] = useState(false);
  const [salesForm, setSalesForm] = useState({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [customNote, setCustomNote] = useState("");
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState("");
  const [isSavingLost, setIsSavingLost] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  // ── WhatsApp States ──
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [isSendingWa, setIsSendingWa] = useState(false);
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const [toastMsg, setToastMsg] = useState<{ title: string; icon: any; color: string } | null>(null);
  const [deleteConfirmLead, setDeleteConfirmLead] = useState<any>(null);
  const [isDeletingLead, setIsDeletingLead] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const selectedYear = new Date().getFullYear();

  const [isEditingBooking, setIsEditingBooking] = useState(false);
  const [cardsPage, setCardsPage] = useState(1);
  const cardsSentinelRef = useRef<HTMLDivElement>(null);
  const isAdmin = String(adminUser?.role || "").toLowerCase() === "admin";

  useEffect(() => { setSubView(initialView === "overview" ? "overview" : initialView === "detail" && selectedLead ? "detail" : initialView === "closed-leads" ? "closed-leads" : "cards"); }, [initialView]);
  // Collapse the AI Assistant panel whenever a different lead is opened
  useEffect(() => {
    setAiPanelOpen(false);
    setShowSalesForm(false);
    setShowLoanForm(false);
    // Reset the tab too. Without this, clicking through leads while parked on
    // "Loan Tracking" keeps that tab mounted, and LoanDealView's lazy children
    // (tranches, lender applications, PDD, financial status) fire on every lead
    // open — four extra requests per lead that nobody asked for.
    setDetailTab("personal");
  }, [selectedLead?.id]);
  // Booking and loan both come from fetchLoanDealData now. The second effect that
  // used to live here fetched /api/booking-applications?lead_id= a SECOND time,
  // concurrently, for the same row.
  useEffect(() => {
    if (selectedLead?.id) fetchLoanDealData(selectedLead.id);
    else {
      setLoanDealBooking(null);
      setLoanDealLatest(null);
      setBookingData(null);
      setShowBookingView(false);
    }
  }, [selectedLead?.id, fetchLoanDealData]);

  // Jump here from elsewhere in the page: Inventory (which also wants the
  // booking form once it loads) or a header notification (which wants the Lead
  // Detail panel and nothing else). `openBooking` is what tells them apart —
  // notifications used to land on the booking view because this always set it.
  useEffect(() => {
    if (pendingLeadOpen == null) return;
    const lead = allLeads.find((l: any) => Number(l.id) === Number(pendingLeadOpen.id));
    if (lead) {
      setSelectedLead(lead);
      setMainView("detail");
      setSubView("detail");
      if (pendingLeadOpen.openBooking) setAutoOpenBooking(true);
    }
    onPendingLeadOpenHandled?.();
  }, [pendingLeadOpen, allLeads]);

  // Once the booking summary for that lead has arrived, load the full row and flip
  // straight to the booking view. `bookingData` is the summary at this point (see
  // fetchLoanDealData), so it answers "does a booking exist?" — openBookingView
  // fetches the shape ClosedLeadBookingView actually needs.
  useEffect(() => {
    if (autoOpenBooking && bookingData) {
      setAutoOpenBooking(false);
      if (selectedLead) openBookingView(selectedLead.id);
    }
    // openBookingView is stable for this purpose; re-running on its identity would
    // re-open the view on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenBooking, bookingData]);
  useEffect(() => {
    if (selectedLead) {
      const u = allLeads.find((l: any) => String(l.id) === String(selectedLead.id));
      if (u && (adminUser.role === "admin" || u.assigned_to === adminUser.name)) {
        setSelectedLead(u);
      } else {
        setSelectedLead(null);
        setSubView("cards");
      }
    }
  }, [allLeads, adminUser]);
  useEffect(() => { setCardsPage(1); }, [searchTerm, leadStatusFilter, showLostLeads, showNGDLeads, columnFilter]);

  /* ── Why these are memoised ───────────────────────────────────────────────
     These are the inputs to every useMemo/useCallback further down. Computed
     inline, they produced a brand-new array (or function) identity on every
     render, which meant every memo below them re-ran every time — the memos were
     present but had never once hit. Since this whole view re-renders on each
     keystroke in the search box and in the sales form, that was roughly eight
     full passes over the lead list, plus two O(n log n) sorts, per character
     typed. Memoising here is what makes the existing memoisation downstream
     actually work; nothing about the values themselves changes. */
  const baseManagerLeads = useMemo(
    () => adminUser.role === "admin" ? allLeads : allLeads.filter((l: any) => l.assigned_to === adminUser.name),
    [allLeads, adminUser.role, adminUser.name]
  );

  /* Follow-ups indexed by lead, built once per followUps change.
     Three separate consumers below each used to scan the whole organization's
     follow-up array: the current lead's timeline, the "enquiries attended"
     count, and — worst — the sort comparator, which ran a full scan on EVERY
     comparison, making the sort O(n log n × m). */
  const fupsByLead = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const f of followUps) {
      const key = String(f.leadId);
      let bucket = map.get(key);
      if (!bucket) { bucket = []; map.set(key, bucket); }
      bucket.push(f);
    }
    return map;
  }, [followUps]);

  const currentLeadFollowUps = useMemo(
    () => fupsByLead.get(String(selectedLead?.id)) ?? EMPTY_FUPS,
    [fupsByLead, selectedLead?.id]
  );
  const isLeadLocked = !!selectedLead && (!!selectedLead.is_lost_lead || selectedLead.status === "Closing" || !!selectedLead.closingDate);

  const pipelineManagerLeads = useMemo(
    () => baseManagerLeads.filter((l: any) => l.status !== "Closing" && !l.closingDate),
    [baseManagerLeads]
  );
  const lostManagerLeads = useMemo(
    () => pipelineManagerLeads.filter((l: any) => !!l.is_lost_lead),
    [pipelineManagerLeads]
  );
  const activeManagerLeads = useMemo(
    () => pipelineManagerLeads.filter((l: any) => !l.is_lost_lead),
    [pipelineManagerLeads]
  );
  const closingLeads = useMemo(
    () => baseManagerLeads.filter((l: any) => l.status === "Closing" || !!l.closingDate),
    [baseManagerLeads]
  );
  const lostRatio = baseManagerLeads.length > 0 ? ((lostManagerLeads.length / baseManagerLeads.length) * 100).toFixed(1) : "0.0";

  const enquiriesAttended = useMemo(() =>
    baseManagerLeads.filter((l: any) => fupsByLead.has(String(l.id))).length
    , [baseManagerLeads, fupsByLead]);

  const enquiriesThisMonth = useMemo(() =>
    baseManagerLeads.filter((l: any) => {
      const d = new Date(l.created_at);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    }).length
    , [baseManagerLeads, selectedMonth, selectedYear]);

  const closingThisMonth = useMemo(() => {
    return closingLeads.filter((l: any) => {
      if (!l.closingDate) return true;
      const d = new Date(l.closingDate);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    }).length;
  }, [closingLeads, selectedMonth, selectedYear]);

  const closingPct = useMemo(() =>
    baseManagerLeads.length > 0
      ? ((closingLeads.length / baseManagerLeads.length) * 100).toFixed(1)
      : "0.0"
    , [closingLeads, baseManagerLeads]);

  /* useCallback because this is a dependency of the filter memos below. As a
     plain function it got a fresh identity on every render and invalidated both
     of them unconditionally. */
  const passLostFilter = useCallback((lead: any) => {
    let passNGD = true;
    const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "Non Qualified Lead" || lead.leadInterestStatus === "Non Qualified Leads" || lead.leadInterestStatus === "Non qualified Lead";
    if (!showNGDLeads && isNGD) {
      passNGD = false;
    }
    if (!passNGD) return false;

    if (leadStatusFilter === "lost") return !!lead.is_lost_lead;
    if (leadStatusFilter === "active") return !lead.is_lost_lead;
    return showLostLeads || !lead.is_lost_lead;
  }, [showNGDLeads, leadStatusFilter, showLostLeads]);

  /* ── Lead ordering ──────────────────────────────────────────────────────
     From Settings → Additional Features → Lead sorting. The comparator lives in
     lib/featurePrefs.ts beside the option list it belongs to; what it cannot
     work out on its own is "when did I last touch this lead", because that means
     scanning the follow-up log — which this component has and that module does
     not, so it is passed in.

     Sorted after filtering rather than before: the filters are the expensive
     part and the sort only has to order what survives them. */
  const leadSort = featurePrefs?.leadSort ?? "newest";
  const compactCards = featurePrefs?.toggles?.compactLeadCards === true;

  /* An O(1) lookup against the index built above, not a scan.
     This function is the comparator's key extractor, so it runs on every single
     comparison. Filtering the whole organization's follow-up array inside it made
     the sort O(n log n × m): under the "stale" lead-sort preference, at 500 leads
     and 5,000 follow-ups, that is tens of millions of string comparisons per
     sort — and the sort runs twice per render, i.e. twice per keystroke.
     Same value, computed once per lead instead of once per comparison. */
  const lastActivityByLead = useMemo(() => {
    const map = new Map<string, number>();
    for (const [leadId, fups] of fupsByLead) {
      let max = 0;
      for (const f of fups) {
        const t = new Date(f.createdAt).getTime();
        if (t > max) max = t;
      }
      map.set(leadId, max);
    }
    return map;
  }, [fupsByLead]);

  const lastActivityAt = useCallback(
    (lead: any) => {
      const hit = lastActivityByLead.get(String(lead?.id));
      return hit !== undefined ? hit : new Date(lead?.created_at ?? 0).getTime();
    },
    [lastActivityByLead]
  );

  const sortLeads = useCallback(
    (leads: any[]) =>
      // A copy, because these arrays are memoised upstream and .sort mutates.
      [...leads].sort((a, b) => compareLeads(a, b, leadSort, lastActivityAt)),
    [leadSort, lastActivityAt]
  );

  const filteredLeadsUnsorted = useMemo(() => {
    let leads = pipelineManagerLeads.filter(passLostFilter);
    if (!searchTerm.trim()) return leads;
    const lq = searchTerm.toLowerCase();
    if (columnFilter === "all") {
      return leads.filter((l: any) =>
        [l.id, l.name, l.phone, l.altPhone, l.alt_phone, l.salesBudget,
        l.budget, l.propType, l.configuration, l.source, l.status,
        l.leadInterestStatus, l.assigned_to]
          .map(v => String(v || "")).join(" ").toLowerCase().includes(lq)
      );
    }
    return leads.filter((l: any) => {
      switch (columnFilter) {
        case "name": return String(l.name || "").toLowerCase().includes(lq);
        case "phone": return [l.phone, l.altPhone, l.alt_phone].map(v => String(v || "")).join(" ").toLowerCase().includes(lq);
        case "budget": return String(l.salesBudget || l.budget || "").toLowerCase().includes(lq);
        case "propType": return String(l.propType || l.configuration || "").toLowerCase().includes(lq);
        case "source": return String(l.source || "").toLowerCase().includes(lq);
        case "status": return String(l.status || "").toLowerCase().includes(lq);
        default: return true;
      }
    });
  }, [pipelineManagerLeads, searchTerm, columnFilter, passLostFilter]);
  const filteredLeads = useMemo(
    () => sortLeads(filteredLeadsUnsorted),
    [filteredLeadsUnsorted, sortLeads]
  );

  const filteredDatabaseLeadsUnsorted = useMemo(() => {
    let leads = baseManagerLeads.filter(passLostFilter);
    if (!searchTerm.trim()) return leads;
    const lq = searchTerm.toLowerCase();
    if (columnFilter === "all") {
      return leads.filter((l: any) =>
        [l.id, l.name, l.phone, l.altPhone, l.alt_phone, l.salesBudget,
        l.budget, l.propType, l.configuration, l.source, l.status,
        l.leadInterestStatus, l.assigned_to]
          .map(v => String(v || "")).join(" ").toLowerCase().includes(lq)
      );
    }
    return leads.filter((l: any) => {
      switch (columnFilter) {
        case "name": return String(l.name || "").toLowerCase().includes(lq);
        case "phone": return [l.phone, l.altPhone, l.alt_phone].map(v => String(v || "")).join(" ").toLowerCase().includes(lq);
        case "budget": return String(l.salesBudget || l.budget || "").toLowerCase().includes(lq);
        case "propType": return String(l.propType || l.configuration || "").toLowerCase().includes(lq);
        case "source": return String(l.source || "").toLowerCase().includes(lq);
        case "status": return String(l.status || "").toLowerCase().includes(lq);
        default: return true;
      }
    });
  }, [baseManagerLeads, searchTerm, columnFilter, passLostFilter]);
  const filteredDatabaseLeads = useMemo(
    () => sortLeads(filteredDatabaseLeadsUnsorted),
    [filteredDatabaseLeadsUnsorted, sortLeads]
  );

  const paginatedLeads = filteredLeads.slice(0, cardsPage * CARDS_PER_PAGE);
  const hasMoreCards = paginatedLeads.length < filteredLeads.length;

  const filteredClosedLeads = closingLeads.filter((lead: any) =>
    (lead.name || "").toLowerCase().includes(searchClosed.toLowerCase()) ||
    String(lead.id).includes(searchClosed)
  );

  useEffect(() => {
    const sentinel = cardsSentinelRef.current;
    if (!sentinel || subView !== "cards") return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && hasMoreCards) setCardsPage(p => p + 1); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreCards, subView, cardsPage]);

  const formatDate = (ds: string) => { if (!ds || ds === "Pending" || ds === "N/A") return "-"; try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ds; } };
  const maskPhone = (phone: any) => { if (!phone || phone === "N/A") return "N/A"; const c = String(phone).replace(/[^a-zA-Z0-9]/g, ""); if (c.length <= 5) return c; return `${c.slice(0, 2)}*****${c.slice(-3)}`; };

  const handleBookingSuccess = (booking: any) => {
    setBookingData(booking);
    setBookingDetailTab("booking");
    const wasEdit = isEditingBooking;
    setIsEditingBooking(false);
    setToastMsg({
      title: wasEdit
        ? `✅ Booking ${booking.booking_number} updated for ${selectedLead?.name}!`
        : `🎉 Booking ${booking.booking_number} created for ${selectedLead?.name}!`,
      icon: <FaHandshake />,
      color: "green",
    });
    setTimeout(() => setToastMsg(null), 4000);
    refetch();
  };

  // The FULL booking row (view=full, the default). Only ClosedLeadBookingView and
  // the booking edit modal need this shape, so it is loaded on demand — see
  // openBookingView — rather than on every lead open.
  const fetchBookingForLead = async (leadId: string | number) => {
    try {
      const res = await fetch(`/api/booking-applications?lead_id=${leadId}`);
      const json = await res.json();
      if (json.success && json.data?.length > 0) setBookingData(json.data[0]);
      else setBookingData(null);
    } catch { setBookingData(null); }
  };

  // Upgrade the summary held in `bookingData` to the full row, then show the
  // booking view. Both entry points (the button and the auto-open deep link) go
  // through here so ClosedLeadBookingView never renders against the summary.
  const openBookingView = async (leadId: string | number) => {
    await fetchBookingForLead(leadId);
    setShowBookingView(true);
  };
  const handleReopenLead = async () => {
    if (!selectedLead || selectedLead.status !== "Closing") return;
    setIsReopening(true);
    try {
      // Unlock FIRST — the status flip is what the backend guard checks for.
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Interested" }) });
      const reopenNote = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: adminUser.role === "admin" ? "admin" : "sales", message: `↩️ Lead Reopened by ${adminUser.name}`, siteVisitDate: null, createdAt: new Date().toISOString() };
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reopenNote) });
      setToastMsg({ title: `${selectedLead.name} reopened`, icon: <FaCheckCircle />, color: "blue" });
      setTimeout(() => setToastMsg(null), 3500);
      refetch();
    } catch (e) { console.error("[Reopen Lead]", e); }
    finally { setIsReopening(false); }
  };
  const openLostLeadModal = () => {
    setLostReason("");
    setLostError("");
    setShowLostModal(true);
    emitActivity({ type: 'LEAD_INTERACTION', action: 'Marking Lead as Lost', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Lost Modal' });
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
      setToastMsg({ title: `${selectedLead.name} marked as Lost Lead`, icon: <Ghost className="w-5 h-5" />, color: "red" });
      setTimeout(() => setToastMsg(null), 3500);
      refetch();
    } catch {
      setLostError("Network error. Please try again.");
    } finally {
      setIsSavingLost(false);
    }
  };

  const handleRestoreLead = async () => {
    if (!selectedLead) return;
    setIsSavingLost(true);
    try {
      const json = await restoreLostLead({ leadId: selectedLead.id, restoredBy: adminUser.name });
      if (!json.success) {
        setToastMsg({ title: json.message || "Could not restore lead", icon: <AlertTriangle className="w-5 h-5" />, color: "red" });
        setTimeout(() => setToastMsg(null), 3500);
        return;
      }
      setSelectedLead(json.data);
      setToastMsg({ title: `${selectedLead.name} restored to Active`, icon: <FaCheckCircle />, color: "green" });
      setTimeout(() => setToastMsg(null), 3500);
      refetch();
    } catch {
      setToastMsg({ title: "Network error while restoring lead", icon: <AlertTriangle className="w-5 h-5" />, color: "red" });
      setTimeout(() => setToastMsg(null), 3500);
    } finally {
      setIsSavingLost(false);
    }
  };

  const openPermanentDeleteDialog = (lead = selectedLead) => {
    if (!isAdmin || !lead) return;
    setDeleteError(null);
    setDeleteConfirmLead(lead);
  };

  const handlePermanentDeleteLead = async (reason?: string) => {
    if (!deleteConfirmLead) return;
    setIsDeletingLead(true);
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

      setToastMsg({ title: "Lead permanently deleted successfully.", icon: <FaCheckCircle />, color: "green" });
      setTimeout(() => setToastMsg(null), 3500);
      setDeleteConfirmLead(null);
      setSelectedLead(null);
      setBookingData(null);
      setSubView("cards");
      setMainView("forms");
      await refetch();
    } catch (error: any) {
      setDeleteError(error?.message || "Lead deletion failed. No data has been permanently removed.");
    } finally {
      setIsDeletingLead(false);
    }
  };

  /* Adding a note used to call refetch(): every lead and every follow-up in the
     organization, re-downloaded and re-merged, to display one line of text the
     user had just typed.

     POST /api/followups already returns the created row, so it is appended to
     local state instead. This is safe for a plain note specifically because a
     note changes nothing else — no lead status, no derived field, no visit date.
     Mutations that DO change derived lead fields (the sales form, marking lost,
     reopening) still refetch, because those fields are computed during the merge
     in fetchAdminData rather than at render time. */
  const handleSendCustomNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!customNote.trim() || !selectedLead) return;
    const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: adminUser.role === "admin" ? "admin" : "sales", message: customNote, siteVisitDate: null, createdAt: new Date().toISOString() };
    setCustomNote("");
    try {
      const res = await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      const json = await res.json().catch(() => null);
      if (json?.success && json.data) {
        appendFollowUp(json.data);
      } else {
        // Could not read the row back — fall back to the full resync rather than
        // leaving the timeline showing something the server may not have stored.
        refetch();
      }
    } catch (e) { console.log(e); }
  };
  const handleSalesFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead || isSubmittingSalesForm) return;
    setIsSubmittingSalesForm(true);

    // Single atomic call — the server builds the follow-up message, writes the
    // normalized columns, updates the lead status, and (if scheduled) inserts the
    // site visit, all inside one transaction. No more partial writes.
    const payload = {
      leadId: String(selectedLead.id),
      salesManagerName: adminUser.name,
      createdBy: adminUser.role === "admin" ? "admin" : "sales",
      formFields: {
        propertyType: salesForm.propertyType,
        location: salesForm.location,
        budget: salesForm.budget,
        useType: salesForm.useType,
        purchaseDate: salesForm.purchaseDate,
        loanPlanned: salesForm.loanPlanned,
        leadStatus: salesForm.leadStatus,
      },
      siteVisitDate: salesForm.siteVisit || null,
    };

    try {
      const res = await fetch("/api/sales-form-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let json: any = {};
      try { json = await res.json(); } catch { /* non-JSON error body */ }

      if (!res.ok || !json.success) {
        // Keep the form open and populated so nothing is lost.
        setToastMsg({
          title: json.message || "Failed to submit sales form",
          icon: <AlertTriangle className="w-5 h-5" />,
          color: "red",
        });
        setTimeout(() => setToastMsg(null), 4000);
        return;
      }

      // Success — reset the form and resync.
      setShowSalesForm(false);
      setSalesForm({
        propertyType: "",
        location: "",
        budget: "",
        useType: "",
        purchaseDate: "",
        loanPlanned: "",
        siteVisit: "",
        leadStatus: "",
      });
      refetch();
    } catch (err) {
      console.log(err);
      setToastMsg({
        title: "Network error while submitting sales form",
        icon: <AlertTriangle className="w-5 h-5" />,
        color: "red",
      });
      setTimeout(() => setToastMsg(null), 4000);
    } finally {
      setIsSubmittingSalesForm(false);
    }
  };
  const prefillSalesForm = (targetLead?: any) => { const l = targetLead || selectedLead; if (!l) return; const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id)); const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted")); if (sf.length === 0) return; const msg = sf[sf.length - 1].message; const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; }; setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" }); };


  const CardsLoader = () => (
    <div className={`col-span-full flex items-center justify-center gap-3 text-sm py-10 ${t.textMuted}`}>
      <div className="flex gap-1.5">
        {[0, 150, 300].map(d => (
          <span key={d} className={`w-2 h-2 rounded-full animate-bounce ${isDark ? "bg-purple-500" : "bg-[#9E217B]"}`} style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
      Loading more leads…
    </div>
  );
  // BEFORE


  // AFTER — accept phone from modal
  const handleSendWhatsApp = async (e: React.FormEvent, chosenPhone: string) => {
    e.preventDefault();
    if (!selectedLead || !waMessage.trim()) return;
    if (!adminUser.whatsapp_number) {
      alert("⚠️ Please set your WhatsApp number in Settings first.");
      return;
    }
    setIsSendingWa(true);
    try {
      await fetch("/api/whatsapp-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: String(selectedLead.id),
          sender_name: adminUser.name,
          sender_number: adminUser.whatsapp_number,
          recipient_number: chosenPhone,           // ← use chosen number
          message_preview: waMessage.trim(),
        }),
      });
      const encoded = encodeURIComponent(waMessage.trim());
      window.open(`https://wa.me/${chosenPhone}?text=${encoded}`, "_blank");
      setToastMsg({ title: "WhatsApp Opened & Logged!", icon: <FaCheckCircle />, color: "green" });
      setTimeout(() => setToastMsg(null), 3000);
      setIsWaModalOpen(false);
      setWaMessage("");
      refetch();
    } catch {
      alert("Error logging WhatsApp message.");
    } finally {
      setIsSendingWa(false);
    }
  };

  // ── Shared input class for forms ──
  const formInput = `w-full rounded-lg px-4 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const formSelect = `w-full rounded-lg px-4 py-2 text-sm sm:py-2.5 outline-none cursor-pointer border ${t.inputInner} ${t.text} ${t.inputFocus}`;

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-4 sm:px-3 py-3 rounded-xl shadow-lg flex items-center gap-3 sm:gap-2 animate-fadeIn border ${toastMsg.color === "green"
          ? "bg-green-600 border-green-400 text-white"
          : toastMsg.color === "red"
            ? "bg-red-600 border-red-400 text-white"
            : "bg-blue-600 border-blue-400 text-white"
          }`}>
          <div className="text-base sm:text-lg">{toastMsg.icon}</div>
          <span className="text-xs sm:text-sm font-bold">{toastMsg.title}</span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto custom-scrollbar">

        {/* ── OVERVIEW ── */}
        {subView === "overview" && (
          <div className="animate-fadeIn space-y-4 sm:space-y-5">
            <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-2">
              <h1 className={`text-lg sm:text-2xl md:text-2xl font-bold flex items-center flex-wrap gap-2 sm:gap-3 ${t.text}`}>
                Hi, {String(adminUser?.name || "User").split(" ")[0]}
                <span className={`text-xs sm:text-sm font-medium px-2 py-0.5 sm:px-3 sm:py-1 rounded-full capitalize border ${isDark
                  ? "text-purple-400 border-purple-500/30 bg-purple-500/10"
                  : "text-[#9E217B] bg-[#9E217B]/10 border border-[#9E217B]/20"
                  }`}>{adminUser.role}</span>
              </h1>
              <button
                className={`text-sm font-semibold flex items-center justify-center w-full sm:w-auto gap-2 cursor-pointer px-4 py-2 rounded-lg transition-all ${t.btnPrimary}`}
                onClick={() => refetch()}
              >↻ Refresh</button>
            </div>

            {/* ── 5-CARD STATS GRID ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
              {[
                { label: "Total Enquiries", value: baseManagerLeads.length, sub: `${activeManagerLeads.length} active`, glow: t.statGlow1, textColor: t.text },
                { label: "Enquiries Attended", value: enquiriesAttended, sub: `of ${activeManagerLeads.length} total`, glow: t.statGlow1, textColor: isDark ? "text-purple-400" : "text-[#00AEEF]" },
                { label: "Enquiries Attended This Month", value: enquiriesThisMonth, sub: `in ${MONTH_NAMES[selectedMonth].slice(0, 3)}`, glow: t.statGlow3, textColor: isDark ? "text-blue-400" : "text-[#9E217B]", monthSelect: true },
                { label: "Closing", value: closingThisMonth > 0 ? closingThisMonth : "—", sub: `${closingLeads.length} total closed`, glow: t.statGlow4, textColor: isDark ? "text-yellow-400" : "text-amber-500", monthSelect: true },
                { label: "Closing Rate", value: `${closingPct}%`, sub: `${closingLeads.length} of ${activeManagerLeads.length} leads`, glow: t.statGlow5, textColor: isDark ? "text-green-400" : "text-emerald-600" },
                { label: "Lost Leads", value: lostManagerLeads.length, sub: `${lostRatio}% lost ratio`, glow: "bg-red-500/10", textColor: isDark ? "text-red-300" : "text-red-600" },
              ].map((stat, i) => (
                <div key={i} className={`rounded-4xl p-4 sm:p-4 shadow-sm border relative overflow-hidden transition-all flex flex-col justify-between ${t.card}`} style={t.cardGlass}>
                  <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl pointer-events-none ${stat.glow}`} />
                  <div className="flex items-start justify-between mb-2">
                    <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider leading-tight ${t.textFaint}`}>{stat.label}</p>
                    {(stat as any).monthSelect && (
                      <select
                        value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}
                        className={`text-[9px] rounded px-1.5 py-0.5 outline-none cursor-pointer border flex-shrink-0 ml-1 ${t.selectSmall}`}
                      >
                        {MONTH_NAMES.map((m, idx) => <option key={idx} value={idx}>{m.slice(0, 3)}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <p className={`text-2xl sm:text-2xl font-black ${stat.textColor}`}>{isLoading ? "…" : stat.value}</p>
                    <p className={`text-[10px] mt-1 ${t.textFaint}`}>{stat.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {!isLoading && <DashboardAnalytics leads={baseManagerLeads} isDark={isDark} t={t} />}

            {/* Overview table */}
            <div className={`rounded-4xl border shadow-sm overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
              <div className={`p-3 sm:p-3 border-b flex flex-col gap-3 ${t.tableBorder} ${t.modalHeader}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className={`font-bold flex items-center gap-2 text-sm sm:text-base ${t.text}`}>
                    <FaClipboardList className={t.accentText} /> Leads Database
                  </h3>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${t.btnClosingBadge}`}>
                    Total: {filteredDatabaseLeads.length}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">

                  <label className={`flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none border rounded-xl px-3 py-2 ${t.selectSmall}`}>
                    <input
                      type="checkbox"
                      checked={showLostLeads}
                      onChange={e => setShowLostLeads(e.target.checked)}
                      disabled={leadStatusFilter !== "all"}
                      className="accent-[#9E217B] w-3.5 h-3.5 cursor-pointer"
                    />
                    Show Lost
                  </label>
                  <select
                    value={columnFilter}
                    onChange={e => setColumnFilter(e.target.value)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer border ${t.select}`}
                  >
                    <option value="all">All Columns</option>
                    <option value="name">Name</option>
                    <option value="phone">Phone</option>
                    <option value="budget">Budget</option>
                    <option value="propType">Property Type</option>
                    <option value="source">Source</option>
                    <option value="status">Status</option>
                  </select>
                  <div className="relative flex-1 min-w-[180px]">
                    <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                    <input
                      type="text"
                      placeholder="Search leads..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className={`w-full rounded-xl pl-9 pr-4 py-2 text-sm outline-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm("")} className={`absolute right-3 top-1/2 -translate-y-1/2 ${t.textFaint} hover:text-red-400`}>
                        <FaTimes className="text-xs" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto w-full custom-scrollbar">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className={t.tableHead}>
                    <tr>
                      {["LEAD NO.", "NAME", "PROP. TYPE", "BUDGET", "SOURCE", "CP NAME", "CP COMPANY", "CP PHONE", "STATUS", "LOST STATUS", "INTEREST", "DATE CREATED", "BACKDATED ENTRY", "SITE VISIT", ...(isAdmin ? ["ACTIONS"] : [])].map(h => (
                        <th key={h} className={`px-4 sm:px-3 py-3 sm:py-2.5 font-bold tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${t.tableDivide}`}>
                    {isLoading
                      ? <tr><td colSpan={isAdmin ? 15 : 14} className={`text-center py-8 ${t.textMuted}`}>Loading...</td></tr>
                      : filteredDatabaseLeads.length === 0
                        ? <tr><td colSpan={isAdmin ? 15 : 14} className={`text-center py-8 ${t.textMuted}`}>No leads found.</td></tr>
                        : filteredDatabaseLeads.map((lead: any) => {
                          const isClosed = lead.status === "Closing" || lead.status === "Completed" || lead.status === "Closed" || lead.closingDate;
                          const isLost = !!lead.is_lost_lead;
                          const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                          return (
                            <tr key={lead.id} className={`transition-colors cursor-pointer ${isLost ? t.rowLost : isNGD ? t.rowNGD : t.tableRow}`} onClick={() => {
                              setSelectedLead(lead);
                              setMainView("detail");
                              setSubView("detail");
                            }}>
                              <td className={`px-4 sm:px-3 py-3 sm:py-2.5 font-bold ${t.accentText}`}>#{lead.sr_no || lead.id}</td>
                              <td className={`px-4 py-3 sm:py-2.5 font-medium ${t.text}`}>{lead.name}</td>
                              <td className={`px-4 py-3 sm:py-2.5 ${t.textMuted}`}>{lead.propType || lead.configuration || "Pending"}</td>
                              <td className={`px-4 py-3 sm:py-2.5 font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget}</td>
                              <td className={`px-4 py-3 sm:py-2.5 text-xs ${t.textMuted}`}>{lead.source || "—"}</td>
                              <td className={`px-4 py-3 sm:py-2.5 ${t.textMuted}`}>{lead.cpName || lead.cp_name || "—"}</td>
                              <td className={`px-4 py-3 sm:py-2.5 ${t.textMuted}`}>{lead.cpCompany || lead.cp_company || "—"}</td>
                              <td className={`px-4 py-3 sm:py-2.5 font-mono text-xs ${t.textMuted}`}>{lead.cpPhone || lead.cp_phone || "—"}</td>
                              <td className="px-4 py-3 sm:py-2.5">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border ${isLost
                                  ? t.statusLost
                                  : isNGD
                                    ? t.statusNGD
                                    : getStatusStyle(lead.status)
                                  }`}>{isLost ? "LOST" : isNGD ? "NGD" : isClosed ? "CLOSED" : (lead.status || "Assigned")}</span>
                              </td>
                              <td className="px-4 py-3 sm:py-2.5">
                                {isLost ? (
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border inline-flex items-center gap-1 ${t.statusLost}`}>
                                    <Ghost className="w-3 h-3" /> Lost Lead
                                  </span>
                                ) : <span className={`text-xs font-semibold ${t.textMuted}`}>Active</span>}
                              </td>
                              <td className="px-4 py-3 sm:py-2.5">
                                {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending"
                                  ? <InterestBadge status={lead.leadInterestStatus} size="sm" />
                                  : <span className={`text-xs italic ${t.textFaint}`}>—</span>}
                              </td>
                              <td className={`px-4 py-3 sm:py-2.5 text-xs whitespace-normal min-w-[120px] ${t.textFaint}`}>
                                {formatDate(lead.created_at)}
                              </td>
                              <td className={`px-4 py-3 sm:py-2.5 text-xs whitespace-normal min-w-[120px] ${t.textFaint}`}>
                                {lead.auto_date_enabled === false && lead.enquiry_date ? formatDate(lead.enquiry_date).split(",")[0] : "-"}
                              </td>
                              <td className="px-4 sm:px-3 py-3 sm:py-2.5">{lead.mongoVisitDate ? <span className="text-orange-400 font-medium whitespace-nowrap text-xs sm:text-sm">{formatDate(lead.mongoVisitDate).split(",")[0]}</span> : <span className={`text-xs italic ${t.textFaint}`}>Pending</span>}</td>
                              {isAdmin && (
                                <td className="px-4 sm:px-3 py-3 sm:py-2.5" onClick={e => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => openPermanentDeleteDialog(lead)}
                                    title="Delete Permanently"
                                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${isDark
                                      ? "bg-red-900/20 text-red-300 hover:bg-red-600 hover:text-white"
                                      : "bg-red-50 text-red-600 hover:bg-red-600 hover:text-white"
                                      }`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── CARDS ── */}
        {subView === "cards" && (
          <div className="animate-fadeIn">
            {/* ── Admin-style Enquiry Toolbar ── */}
            <div className={`rounded-xl border p-3 mb-6 ${t.tableWrap}`} style={t.tableGlass}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className={`font-bold text-base flex items-center gap-2 ${t.text}`}>
                    <FaClipboardList className={t.accentText} /> Leads Overview
                  </h2>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${t.btnClosingBadge}`}>
                    Total: {filteredLeads.length}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Lead Status Filter */}


                  {/* Show Lost Checkbox */}
                  <label className={`flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none border rounded-xl px-3 py-2 ${t.selectSmall}`}>
                    <input
                      type="checkbox"
                      checked={showLostLeads}
                      onChange={e => setShowLostLeads(e.target.checked)}
                      disabled={leadStatusFilter !== "all"}
                      className="accent-[#9E217B] w-3.5 h-3.5 cursor-pointer"
                    />
                    Show Lost
                  </label>

                  {/* Column Filter */}
                  <select
                    value={columnFilter}
                    onChange={e => setColumnFilter(e.target.value)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer border ${t.select}`}
                  >
                    <option value="all">All Columns</option>
                    <option value="name">Name</option>
                    <option value="phone">Phone</option>
                    <option value="budget">Budget</option>
                    <option value="propType">Property Type</option>
                    <option value="source">Source</option>
                    <option value="status">Status</option>
                  </select>

                  {/* Search Bar */}
                  <div className="relative flex-1 min-w-[180px]">
                    <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                    <input
                      type="text"
                      placeholder="Search leads..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className={`w-full rounded-xl pl-9 pr-4 py-2 text-sm outline-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm("")}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 ${t.textFaint} hover:text-red-400`}
                      >
                        <FaTimes className="text-xs" />
                      </button>
                    )}
                  </div>

                  {/* Bulk Excel import — Site Head assigns to any manager; Sales Manager self-uploads (if admin-enabled) */}
                  {(() => {
                    const roleLc = (adminUser?.role || "").toLowerCase().replace(/_/g, " ");
                    if (roleLc === "site head" || roleLc === "admin") {
                      return <UploadLeadSheet mode="assign" isDark={isDark} onImported={refetch} />;
                    }
                    if (roleLc === "sales manager") {
                      return <SelfUploadLeadSheet isDark={isDark} onImported={refetch} />;
                    }
                    return null;
                  })()}
                </div>
                <p className={`text-[10px] ${t.textFaint}`}>
                  {paginatedLeads.length} shown · {filteredLeads.length} filtered
                  {hasMoreCards && <span className={t.accentText}> · scroll for more</span>}
                </p>
              </div>
            </div>

            {isLoading
              ? <div className={`text-center py-10 ${t.textMuted}`}>Fetching leads...</div>
              : filteredLeads.length === 0
                ? <div className={`text-center py-10 ${t.textMuted}`}>No leads available.</div>
                : (
                  <div
                    className={
                      // Settings → Additional Features → "Compact lead cards".
                      // Density only: the same cards, more of them per row. No
                      // information is dropped, so the toggle cannot hide
                      // something a manager needs to see.
                      compactCards
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2"
                        : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3"
                    }
                  >
                    {paginatedLeads.map((lead: any) => {
                      const interest = lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" ? lead.leadInterestStatus : null;
                      const loanSt = lead.loanStatus && lead.loanStatus !== "N/A" ? lead.loanStatus : null;
                      const isClosing = lead.status === "Closing";
                      const isLost = !!lead.is_lost_lead;
                      const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                      return (
                        <div
                          key={lead.id}
                          className={`rounded-3xl p-3 sm:p-3 border shadow-sm transition-all group flex flex-col justify-between cursor-pointer h-full ${isLost ? t.cardLost : isClosing ? t.cardClosing : isNGD ? t.cardNGD : t.card}`}
                          style={t.cardGlass}
                          onClick={() => { setSelectedLead(lead); setMainView("detail"); setSubView("detail"); }}
                        >
                          <div>
                            <div className={`flex flex-col sm:flex-row sm:justify-between items-start mb-4 pb-3 sm:mb-5 sm:pb-4 border-b gap-2 ${t.tableBorder}`}>
                              <h3 className={`text-lg sm:text-lg font-bold transition-colors line-clamp-2 pr-2 ${t.text} ${isClosing ? "group-hover:text-amber-500" : isDark ? "group-hover:text-[#d946a8]" : "group-hover:text-[#9E217B]"}`}>
                                <span className={`mr-2 ${t.accentText}`}>#{lead.sr_no || lead.id}</span>{lead.name}
                              </h3>
                              <span className={`px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 whitespace-nowrap ${isLost ? t.statusLost :
                                isNGD ? t.statusNGD :
                                  isClosing ? t.statusClosing :
                                    getStatusStyle(lead.status)
                                }`}>{isLost ? "LOST LEAD" : isNGD ? "NGD" : isClosing ? "CLOSING" : (lead.status || "Assigned")}</span>
                            </div>
                            {isLost && (
                              <div className={`mb-4 flex items-center justify-between gap-2 rounded-lg px-3 py-2 border ${t.statusLost}`}>
                                <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2"><Ghost className="w-3.5 h-3.5" /> Lost Lead</span>
                                <span className="text-[10px] font-semibold normal-case truncate">{lead.lost_lead_reason || "Unresponsive"}</span>
                              </div>
                            )}
                            <div className="space-y-3 mb-4 sm:mb-5">
                              <div className="flex justify-between items-start gap-2">
                                <div>
                                  <p className={`text-xs font-medium ${t.textFaint}`}>Budget</p>
                                  <p className={`text-sm font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1 text-right">
                                  {loanSt ? <LoanStatusBadge status={loanSt} /> : lead.loanPlanned === "Yes" && (
                                    <div className="bg-[#00AEEF]/10 border border-[#00AEEF]/30 px-2 py-1 rounded text-[#00AEEF] text-[9px] sm:text-[10px] font-bold uppercase flex items-center gap-1"><FaUniversity /> Loan Active</div>
                                  )}
                                </div>
                              </div>
                              {((lead.propType && lead.propType !== "Pending") || (lead.configuration && lead.configuration !== "Pending")) && (
                                <div>
                                  <p className={`text-xs font-medium ${t.textFaint}`}>Property</p>
                                  <p className={`text-sm font-medium ${t.text}`}>{(lead.propType && lead.propType !== "Pending") ? lead.propType : lead.configuration}</p>
                                </div>
                              )}
                              <div className={`p-3 rounded-lg border flex flex-col gap-1.5 ${t.settingsBg}`} style={t.settingsBgGl}>
                                <p className={`text-xs flex items-center gap-2 ${t.textMuted}`}><FaPhoneAlt className="w-3 h-3 flex-shrink-0" /><span>Ph:</span><span className={`font-mono ${t.text} truncate`}>{maskPhone(lead.phone)}</span></p>
                                <p className={`text-xs flex items-center gap-2 ${t.textMuted}`}><FaPhoneAlt className="w-3 h-3 flex-shrink-0" /><span>Alt:</span><span className={`font-mono ${t.text} truncate`}>{maskPhone(lead.altPhone)}</span></p>
                              </div>
                              {(lead.mongoVisitDate || interest) && (
                                <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                                  {lead.mongoVisitDate && <div className="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-orange-400"><FaCalendarAlt className="text-[10px]" />{formatDate(lead.mongoVisitDate).split(",")[0]}</div>}
                                  {interest && <InterestBadge status={interest} size="sm" />}
                                </div>
                              )}
                              {isClosing && (
                                <div className={`flex items-center justify-center gap-2 text-[10px] font-bold px-3 py-1.5 rounded-lg w-full ${isDark ? "text-yellow-400 bg-yellow-500/10 border border-yellow-500/20" : "text-amber-600 bg-amber-50 border border-amber-200"}`}>
                                  <FaHandshake /> Deal in Closing Stage
                                </div>
                              )}
                            </div>
                          </div>
                          <div className={`pt-3 sm:pt-4 border-t mt-auto flex justify-between items-center ${t.tableBorder}`}>
                            <p className={`text-[9px] sm:text-[10px] flex-shrink-0 whitespace-normal min-w-[120px] ${t.textFaint}`}>{formatDate(lead.created_at)}</p>
                            <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-colors ${isClosing ? (isDark ? "text-yellow-500 group-hover:text-yellow-400" : "text-amber-500 group-hover:text-amber-400") : (isDark ? "text-gray-500 group-hover:text-[#d946a8]" : "text-[#9CA3AF] group-hover:text-[#9E217B]")}`}>Details →</span>
                          </div>
                        </div>
                      );
                    })}
                    {hasMoreCards && <CardsLoader />}
                    {!hasMoreCards && filteredLeads.length > 0 && (
                      <div className="col-span-full">
                        <p className={`text-center text-xs py-2.5 ${t.textFaint}`}>All {filteredLeads.length} leads loaded</p>
                      </div>
                    )}
                  </div>
                )
            }
            <div ref={cardsSentinelRef} className="h-1 w-full mt-4" aria-hidden="true" />
          </div>
        )}

        {/* ── CLOSED LEADS ── */}
        {subView === "closed-leads" && (
          <div className="animate-fadeIn">
            <div className={`flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6 sm:mb-8 border-b pb-4 sm:pb-6 ${t.tableBorder}`}>
              <div>
                <h1 className={`text-lg sm:text-2xl font-bold ${t.text}`}>Closed Leads</h1>
                <p className={`text-xs sm:text-sm mt-0.5 ${t.textFaint}`}>Leads successfully closed</p>
              </div>
              <div className="relative w-full sm:w-auto">
                <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                <input
                  type="text" placeholder="Search closed leads..." value={searchClosed}
                  onChange={e => setSearchClosed(e.target.value)}
                  className={`rounded-lg pl-9 pr-4 py-2 text-sm outline-none w-full sm:w-64 transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                />
              </div>
            </div>

            <div className={`rounded-3xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
              <div className={`p-3 border-b flex justify-between items-center ${t.tableBorder}`}>
                <p className={`text-sm font-semibold ${t.text}`}>{filteredClosedLeads.length} closed leads</p>
              </div>
              <div className="overflow-x-auto w-full custom-scrollbar">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead><tr className={t.tableHead}>
                    {["Lead No.", "Client Name", "Budget", "Property", "Status", "Site Visit", "Closing Date", "Actions"].map(h => (
                      <th key={h} className={`px-4 sm:px-3 py-3 sm:py-2.5 font-bold uppercase tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className={`${t.tableDivide} divide-y`}>
                    {isLoading ? <tr><td colSpan={8} className={`p-8 text-center text-sm ${t.textMuted}`}>Loading...</td></tr>
                      : filteredClosedLeads.length === 0 ? (
                        <tr><td colSpan={8} className={`p-12 text-center ${t.textMuted}`}>
                          <FaHandshake className={`text-5xl mx-auto mb-4 ${t.textFaint}`} />
                          <p className="text-lg font-semibold">No closed leads yet.</p>
                        </td></tr>
                      ) : filteredClosedLeads.map((lead: any) => (
                        <tr key={lead.id} className={`transition-colors cursor-pointer ${t.tableRow}`} onClick={() => {
                          setSelectedLead(lead);
                          setMainView("detail");
                          setSubView("detail");
                        }}>
                          <td className={`px-4 sm:px-3 py-3 sm:py-2.5 font-bold ${t.accentText}`}>#{lead.sr_no || lead.id}</td>
                          <td className={`px-4 py-3 sm:py-2.5 font-semibold ${t.text}`}>{lead.name}</td>
                          <td className={`px-4 py-3 sm:py-2.5 font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</td>
                          <td className={`px-4 py-3 sm:py-2.5 ${t.textMuted}`}>{lead.propType || lead.configuration || "N/A"}</td>
                          <td className="px-4 py-3 sm:py-2.5">
                            <span className={`px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border ${t.statusClosing}`}>{lead.status}</span>
                          </td>
                          <td className={`px-4 py-3 sm:py-2.5 text-[10px] sm:text-xs ${lead.mongoVisitDate ? "text-orange-400" : t.textFaint}`}>
                            {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : "—"}
                          </td>
                          <td className={`px-4 py-3 sm:py-2.5 text-[10px] sm:text-xs ${t.textFaint}`}>
                            {lead.closingDate ? formatDate(lead.closingDate).split(",")[0] : "—"}
                          </td>
                          <td className="px-4 py-3 sm:py-2.5">
                            <button className={`text-xs font-bold px-3 py-1.5 rounded-lg w-full sm:w-auto ${t.btnWarning}`}>View History</button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── DETAIL ── */}
        {subView === "detail" && selectedLead && (
          bookingData && showBookingView ? (
            <div className="animate-fadeIn w-full h-[calc(100vh-130px)] overflow-hidden bg-transparent flex flex-col">
              <div className="flex items-center justify-between p-2 shrink-0 border-b border-white/10 shadow-sm" style={t.cardGlass}>
                <button onClick={() => setShowBookingView(false)} className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 border rounded-lg transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                  <FaChevronLeft /> Back to Lead Details
                </button>
                {(() => {
                  // Same rule as BookingApplicationView: admin always, sales only for own lead + not-yet-approved.
                  const role = String(adminUser?.role || "").toLowerCase();
                  const isAdminRole = role === "admin" || role === "site_head";
                  const isOwner = adminUser?.name && selectedLead?.assigned_to === adminUser.name;
                  const notApproved = bookingData?.booking_status !== "Approved";
                  const canEdit = isAdminRole || (isOwner && notApproved);
                  if (!canEdit) return null;
                  // return (
                  //   <button
                  //     onClick={() => setIsEditingBooking(true)}
                  //     className={`px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 rounded-lg transition-colors cursor-pointer shadow-sm text-white ${isDark ? "bg-[#9E217B] hover:bg-[#7a1960]" : "bg-[#00AEEF] hover:bg-[#0088bb]"}`}
                  //   >
                  //     <FaEdit /> Edit Booking Form
                  //   </button>
                  // );
                })()}
              </div>
              <div className="flex-1 overflow-hidden">
                <ClosedLeadBookingView
                  booking={bookingData}
                  lead={selectedLead}
                  isDark={isDark}
                  userRole={adminUser?.role?.toLowerCase() || "sales"}
                  currentUser={adminUser}
                  onRefetch={() => { if (selectedLead) fetchBookingForLead(selectedLead.id); }}
                />
              </div>
            </div>
          ) : (
            <div className="animate-fadeIn w-full flex flex-col gap-2 pb-1">
              {/* Detail header */}
              <div className={`flex flex-col md:flex-row md:items-center justify-between gap-2 rounded-xl border p-3 shadow-sm flex-shrink-0 ${selectedLead.is_lost_lead ? t.cardLost : t.card}`} style={t.cardGlass}>
                <div className="flex items-center gap-3 sm:gap-2 min-w-0">
                  <button onClick={() => { setMainView("forms"); setSubView("cards"); }} className={`w-9 h-9 sm:w-10 sm:h-10 flex flex-shrink-0 items-center justify-center border rounded-xl transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}><FaChevronLeft className="text-sm" /></button>
                  <h1 className={`text-[18px] sm:text-[18px] md:text-[18px] font-bold flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 ${t.text}`}>
                    <span className={t.accentText}>#{selectedLead.sr_no || selectedLead.id}</span>
                    <span className="truncate max-w-[200px] sm:max-w-none text-[18px]">{selectedLead.name}</span>
                    {selectedLead.status === "Closing" && (
                      <span className={`text-[10px] sm:text-[11px] font-bold px-2 sm:px-3 py-1 rounded-full border flex items-center gap-1.5 flex-shrink-0 ${t.statusClosing}`}>
                        <FaHandshake className="text-xs" /> Closing
                      </span>
                    )}
                    {selectedLead.is_lost_lead && (
                      <span className={`text-[10px] sm:text-[11px] font-bold px-2 sm:px-3 py-1 rounded-full border flex items-center gap-1.5 flex-shrink-0 ${t.statusLost}`}>
                        <Ghost className="w-3 h-3" /> Lost Lead
                      </span>
                    )}
                  </h1>
                </div>
                <div className="flex gap-2 sm:gap-3 flex-wrap justify-start md:justify-end flex-shrink-0">
                  {bookingData ? (
                    <button onClick={() => openBookingView(selectedLead.id)} className="font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex-1 sm:flex-none justify-center">
                      <FaEye /> View Booking Form
                    </button>
                  ) : (
                    <button disabled title="Booking Form has not been submitted yet." className="font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors opacity-50 cursor-not-allowed bg-indigo-400 text-white shadow-sm flex-1 sm:flex-none justify-center">
                      <FaEye /> View Booking Form
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openPermanentDeleteDialog()}
                      className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${isDark
                        ? "bg-red-950/50 text-red-200 border border-red-900/50 hover:bg-red-600 hover:text-white"
                        : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-600 hover:text-white"
                        }`}
                    >
                      <Trash2 className="w-4 h-4" /> Delete Permanently
                    </button>
                  )}
                  {isLeadLocked ? (
                    <>
                      <span className={`text-[10px] sm:text-[11px] font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${selectedLead.is_lost_lead ? t.statusLost : t.statusClosing}`}>
                        {selectedLead.is_lost_lead ? <><Ghost className="w-3 h-3" /> Lost Lead • Read Only</> : <><FaCheckCircle className="text-xs" /> Lead Closed • Read Only</>}
                      </span>
                      {selectedLead.is_lost_lead ? (
                        <button onClick={handleRestoreLead} disabled={isSavingLost} className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnPrimary} disabled:opacity-60`}>
                          <FaCheckCircle className="text-xs" /> Restore Lead
                        </button>
                      ) : (
                        <button onClick={handleReopenLead} disabled={isReopening} className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnPrimary} disabled:opacity-60`}>
                          ↩️ Reopen Lead
                        </button>
                      )}
                    </>
                  ) : (
                    !showSalesForm && !showLoanForm && (
                      <>
                        <button onClick={() => { prefillSalesForm(); setShowSalesForm(true); setShowLoanForm(false); emitActivity({ type: 'LEAD_INTERACTION', action: 'Editing Closing Form', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Sales Form' }); }}
                          className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnPrimary} ${isDark ? "shadow-purple-600/20" : "shadow-[#00AEEF]/20"}`}>
                          <FaFileInvoice /> <span className="hidden sm:inline">Fill</span> Salesform
                        </button>
                        <button onClick={() => { setShowLoanForm(true); setShowSalesForm(false); emitActivity({ type: 'LEAD_INTERACTION', action: 'Editing Loan Form', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Loan Form' }); }}
                          className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnSecondary} ${isDark ? "shadow-blue-600/20" : "shadow-[#00AEEF]/20"}`}>
                          <FaUniversity /> <span className="hidden sm:inline">Track</span> Loan
                        </button>
                        <button onClick={openLostLeadModal} className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnDanger}`}>
                          <AlertTriangle className="w-4 h-4" /> Mark <span className="hidden sm:inline">as</span> Lost Lead
                        </button>
                        <button onClick={() => setIsClosingModalOpen(true)} className={`font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnWarning} shadow-amber-600/20`}>
                          <FaHandshake /> Mark <span className="hidden sm:inline">as</span> Closing
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>

              {/* TWO-COLUMN BODY */}
              {/* THREE-PART BODY: Lead Info · Follow-ups · AI Assistant (collapsible) */}
              <div className="flex flex-col lg:flex-row gap-2 lg:gap-3 items-start lg:items-stretch">

                {/* LEFT PANEL */}
                <div className="flex flex-col gap-3 w-full lg:w-0 lg:flex-1 lg:min-w-0">
                  {showSalesForm ? (
                    <div className={`rounded-xl border p-3 sm:p-3 shadow-xl overflow-y-auto custom-scrollbar flex flex-col max-h-[85vh] lg:max-h-[calc(100vh-190px)] ${t.modalCard}`} style={t.modalGlass}>
                      <div className={`flex justify-between items-center mb-4 border-b pb-3 ${t.tableBorder}`}>
                        <div>
                          <h3 className={`text-base sm:text-lg font-bold ${t.text}`}>Sales Data Form</h3>
                          <p className={`text-xs mt-0.5 ${t.accentText}`}>For Lead #{selectedLead.sr_no || selectedLead.id}</p>
                        </div>
                        <button type="button" onClick={() => setShowSalesForm(false)} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
                      </div>
                      <form onSubmit={handleSalesFormSubmit} className="flex flex-col gap-2 flex-1">
                        <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Property Type?</label><input type="text" placeholder="e.g. 1BHK, 2BHK" value={salesForm.propertyType} onChange={e => setSalesForm({ ...salesForm, propertyType: e.target.value })} className={formInput} /></div>
                        <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Preferred Location?</label><input type="text" placeholder="e.g. Dombivali, Kalyan" value={salesForm.location} onChange={e => setSalesForm({ ...salesForm, location: e.target.value })} className={formInput} /></div>
                        <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Approximate Budget?</label><input type="text" placeholder="e.g. 5 cr" value={salesForm.budget} onChange={e => setSalesForm({ ...salesForm, budget: e.target.value })} className={formInput} /></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Self-use or Investment?</label><select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={formSelect}><option value="">Select</option><option>Self Use</option><option>Investment</option></select></div>
                          <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Planning to Purchase?</label><select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={formSelect}><option value="">Select</option><option>Immediate</option><option>Next 3 Months</option></select></div>
                        </div>
                        <div className={`border-t pt-3 mt-1 ${t.tableBorder}`}>
                          <label className={`block text-xs font-bold mb-1.5 ${t.accentText}`}>Lead Interest Status *</label>
                          <select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><option value="" disabled>Select Status</option><option>Interested</option><option>Not Interested</option><option>NON GENUINE DEMAND (NGD)</option></select>
                        </div>
                        <div className={`border-t pt-3 mt-1 ${t.tableBorder}`}>
                          <label className={`block text-xs font-bold mb-1.5 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>Loan Planned?</label>
                          <select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><option value="" disabled>Select Option</option><option>Yes</option><option>No</option><option>Not Sure</option></select>
                        </div>
                        <div className={`mt-2 border-t pt-3 ${t.tableBorder}`}>
                          <label className="text-xs text-orange-400 font-bold mb-1.5 block">Schedule a Site Visit?</label>
                          <input ref={inputRef} type="datetime-local" value={salesForm.siteVisit} onChange={e => setSalesForm({ ...salesForm, siteVisit: e.target.value })} onClick={() => inputRef.current?.showPicker()} className={`${formInput} focus:border-orange-500`} />

                        </div>
                        <button type="submit" disabled={isSubmittingSalesForm} className={`mt-auto w-full font-bold py-3 sm:py-3.5 rounded-xl shadow-md transition-colors flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${t.btnPrimary}`}>
                          {isSubmittingSalesForm ? "Submitting..." : "Submit Salesform"}
                        </button>
                      </form>
                    </div>
                  ) : showLoanForm ? (
                    <LoanDealForm
                      lead={selectedLead}
                      booking={loanDealBooking}
                      loanUpdate={loanDealLatest}
                      user={adminUser}
                      isDark={isDark}
                      t={t}
                      onCancel={() => setShowLoanForm(false)}
                      onSuccess={() => {
                        setShowLoanForm(false);
                        setToastMsg({ title: `Loan & deal data saved for ${selectedLead.name}`, icon: <FaCheckCircle />, color: "blue" });
                        setTimeout(() => setToastMsg(null), 3000);
                        fetchLoanDealData(selectedLead.id);
                        refetch();
                      }}
                    />
                  ) : (
                    <div className="flex flex-col gap-3 animate-fadeIn">
                      {/* Tab switcher */}
                      <div className={`flex items-center gap-2 border p-1.5 rounded-xl flex-shrink-0 ${t.tableWrap}`}>
                        <button onClick={() => setDetailTab("personal")} className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Personal Info</button>
                        <button onClick={() => setDetailTab("loan")} className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? t.btnSecondary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Loan Tracking</button>
                      </div>

                      <div className={`overflow-y-auto custom-scrollbar rounded-xl p-3 sm:p-6 shadow-lg border max-h-[100vh] lg:max-h-[calc(100vh-325px)] ${t.chatPanel}`} style={t.chatPanelGl}>
                        {detailTab === "personal" ? (
                          <div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 sm:gap-y-4 gap-x-4 text-xs sm:text-sm">
                              <InlineContactField label="Email" value={selectedLead.email} fieldType="email" isDark={isDark} theme={t} canEdit={["admin", "sales manager", "site head", "site_head"].includes(adminUser?.role?.toLowerCase() || "")} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); }} />
                              <InlineContactField label="Phone" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={t} canEdit={["admin", "sales manager", "site head", "site_head"].includes(adminUser?.role?.toLowerCase() || "")} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); }} />
                              <InlineContactField label="Alt Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={t} canEdit={["admin", "sales manager", "site head", "site_head"].includes(adminUser?.role?.toLowerCase() || "")} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); }} />
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Lead Interest</p>{selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} /> : <p className={`font-semibold ${t.text}`}>Pending</p>}</div>
                              <div className="col-span-1"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Loan Status</p>{selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} /></div> : <p className={`font-semibold ${t.text}`}>N/A</p>}</div>
                              <div className="col-span-1"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Backdated Entry</p><p className={`font-semibold ${t.text}`}>{selectedLead.auto_date_enabled === false && selectedLead.enquiry_date ? formatDate(selectedLead.enquiry_date).split(",")[0] : "Null"}</p></div>
                              <div className="col-span-1 sm:col-span-2"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Residential Address</p><p className={`font-semibold ${t.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                              <div className="col-span-1 sm:col-span-2"><InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={t} canEdit={["admin", "sales manager", "site head", "site_head"].includes(adminUser?.role?.toLowerCase() || "")} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); }} /></div>
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Budget</p><p className={`font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Property Type</p><p className={`font-semibold ${t.text}`}>{selectedLead.propType || selectedLead.configuration || "Pending"}</p></div>
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Type of Use</p><p className={`font-semibold ${t.text}`}>{selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Planning to Buy?</p><p className={`font-semibold ${t.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Loan Required?</p><p className={`font-semibold ${t.text}`}>{loanDealLatest?.loan_required || selectedLead.loanPlanned || "Pending"}</p></div>
                              <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Status</p><span className={`text-xs sm:text-sm font-bold ${getStatusStyle(selectedLead.status)}`}>{selectedLead.status || "Assigned"}</span></div>
                              {/* <div className={`col-span-1 sm:col-span-2 p-3 sm:p-3 rounded-xl border ${t.settingsBg}`} style={t.settingsBgGl}>
                              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-0.5 sm:mb-1 ${isDark?"text-[#00AEEF]":"text-[#00AEEF]"}`}>📍 Site Visit Date</p>
                              <p className={`text-sm sm:text-base font-black ${t.text}`}>{selectedLead.mongoVisitDate?formatDate(selectedLead.mongoVisitDate):"Not Scheduled"}</p>
                            </div> */}
                            </div>
                            {selectedLead.is_lost_lead && (
                              <div className={`mt-4 border rounded-xl p-3 sm:p-3 ${t.statusLost}`}>
                                <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                  <Ghost className="w-3.5 h-3.5" /> Lost Lead Record
                                </h3>
                                <p className={`text-xs sm:text-sm leading-relaxed ${t.textMuted}`}>{selectedLead.lost_lead_reason || "No reason recorded."}</p>
                                <p className={`text-[10px] mt-2 ${t.textFaint}`}>
                                  Marked by {selectedLead.lost_lead_marked_by || "Unknown"} on {selectedLead.lost_lead_marked_at ? formatDate(selectedLead.lost_lead_marked_at) : "-"}
                                </p>
                              </div>
                            )}
                            <div className={`mt-4 border rounded-xl p-3 sm:p-3 ${t.settingsBg}`} style={t.settingsBgGl}>
                              <h3 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 sm:mb-3 border-b pb-2 ${t.sectionTitle} ${t.sectionBorder}`}>
                                {selectedLead.source && selectedLead.source !== "N/A" ? `${selectedLead.source} Data` : "Source Data"}
                              </h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Primary Source</p><p className={`font-medium text-xs sm:text-sm ${t.text}`}>{selectedLead.source || "N/A"}</p></div>
                                {selectedLead.source === "Others" && (<div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Specified Name</p><p className={`font-medium text-xs sm:text-sm ${t.text}`}>{selectedLead.sourceOther}</p></div>)}
                              </div>
                              {selectedLead.source === "Channel Partner" ? (
                                <div className={`mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-3 gap-3 ${t.tableBorder}`}>
                                  {[
                                    { label: "CP Name", val: selectedLead.cpName },
                                    { label: "CP Company", val: selectedLead.cpCompany },
                                    { label: "CP Phone", val: selectedLead.cpPhone }
                                  ].map(({ label, val }) => (
                                    <div key={label}>
                                      <p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>
                                        {label}
                                      </p>
                                      <p className={`font-medium text-xs sm:text-sm break-all ${t.text}`}>
                                        {val || "N/A"}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : selectedLead.source === "Referral" && selectedLead.referral_name ? (
                                <div className={`mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-3 gap-3 ${t.tableBorder}`}>
                                  <div>
                                    <p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>
                                      Referred By
                                    </p>
                                    <p className={`font-medium text-xs sm:text-sm break-all ${t.text}`}>
                                      {selectedLead.referral_name}
                                    </p>
                                  </div>
                                </div>
                              ) : (selectedLead.status === "NON GENUINE DEMAND (NGD)" || selectedLead.leadStatus === "NON GENUINE DEMAND (NGD)" || selectedLead.leadInterestStatus === "NON GENUINE DEMAND (NGD)") ? (
                                <span className={`text-[10px] sm:text-[11px] font-bold px-2 sm:px-3 py-1 rounded-full border flex items-center gap-1.5 flex-shrink-0 ${t.statusNGD}`}>
                                  NON GENUINE DEMAND
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (selectedLead.status === "NON GENUINE DEMAND (NGD)" || selectedLead.leadStatus === "NON GENUINE DEMAND (NGD)" || selectedLead.leadInterestStatus === "NON GENUINE DEMAND (NGD)") ? (
                          <span className={`text-[10px] sm:text-[11px] font-bold px-2 sm:px-3 py-1 rounded-full border flex items-center gap-1.5 flex-shrink-0 ${t.statusNGD}`}>
                            NON GENUINE DEMAND
                          </span>
                        ) : (
                          <LoanDealView lead={selectedLead} booking={loanDealBooking} loanUpdate={loanDealLatest} isDark={isDark} t={t} />
                        )}
                        {/* Site Visit History — outside with gap */}
                        <div className="mt-3">
                          <SiteVisitScheduler
                            lead={selectedLead}
                            adminUser={adminUser}
                            isDark={isDark}
                            t={t}
                            onSuccess={refetch}
                          />
                        </div>
                        {/* <ActivityTimeline
                        lead={selectedLead}
                        isDark={isDark}
                        theme={t}
                        className="mt-3"
                      /> */}

                      </div>

                      {/* Contact actions. Sits where the Twilio "Browser Call"
                          tile used to be, so the call affordance stays in the
                          place users already reach for. Self-gating: the widget
                          renders nothing when Bolna is unconfigured, and the
                          WhatsApp button below is unaffected either way. */}
                      <div className="flex-shrink-0 mb-3">
                        <BolnaCallWidget
                          leadId={Number(selectedLead.id)}
                          leadName={selectedLead.name}
                          phone={selectedLead.phone}
                          userData={{ project: selectedLead.propType || selectedLead.configuration }}
                          compact
                        />
                      </div>

                      {/* Two columns now that Manual Call and AI Call join the
                          WhatsApp tile. */}
                      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
                        <button
                          onClick={() => setIsWaModalOpen(true)}
                          className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1 min-h-[48px]">
                          <FaWhatsapp className="text-lg sm:text-lg" />
                          <span className="font-bold text-[10px]">WhatsApp</span>
                        </button>
                        <CallingButtons
                          leadId={Number(selectedLead.id)}
                          phone={selectedLead.phone}
                          leadName={selectedLead.name}
                          isDark
                          iconClass="text-lg"
                          paddingClass="py-3"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT PANEL: FOLLOW-UPS */}
                <div className={`flex flex-col rounded-xl overflow-hidden shadow-2xl border h-[540px] lg:h-[calc(100vh-185px)] lg:sticky lg:top-4 w-full lg:w-0 lg:flex-1 ${t.chatPanel}`} style={t.chatPanelGl}>
                  <div className={`flex-1 p-3 sm:p-6 overflow-y-auto custom-scrollbar flex flex-col gap-2 sm:gap-3 ${t.chatArea}`}>
                    {/* System message */}
                    <div className="flex justify-start">
                      <div className={`rounded-xl rounded-tl-none p-3 sm:p-3 max-w-[90%] sm:max-w-[85%] shadow-md ${t.fupSalesform}`}>
                        <div className={`flex justify-between items-start sm:items-center mb-2 gap-2 sm:gap-3 flex-col sm:flex-row`}>
                          <span className={`font-bold text-xs sm:text-sm ${t.accentText}`}>System (Front Desk)</span>
                          <span className={`text-[9px] sm:text-[10px] ${t.textFaint}`}>{formatDate(selectedLead.created_at)}</span>
                        </div>
                        <p className={`text-xs sm:text-sm leading-relaxed ${t.textMuted}`}>Lead assigned to {selectedLead.assigned_to}. Action required.</p>
                      </div>
                    </div>
                    {currentLeadFollowUps.map((msg: any, idx: number) => {
                      const isLoan = msg.message.includes("🏦 Loan Update");
                      const isSF = msg.message.includes("📝 Detailed Salesform Submitted");
                      const isClosing = msg.message.includes("✅ Lead Marked as Closing");
                      const isWA = msg.message.includes("📱 WhatsApp sent by");
                      const bubbleCls = isLoan ? t.fupLoan : isSF ? t.fupSalesform : isClosing ? t.fupClosing : t.fupDefault;
                      return (
                        <div key={idx} className="flex justify-start">
                          <div className={`rounded-xl rounded-tl-none p-3 sm:p-3 max-w-[90%] sm:max-w-[85%] shadow-lg ${bubbleCls}`}>
                            <div className="flex justify-between items-start sm:items-center mb-2 sm:mb-3 gap-2 sm:gap-3 flex-col sm:flex-row">
                              <span className={`font-bold text-xs sm:text-sm ${t.text}`}>{msg.createdBy === "admin" ? `${msg.salesManagerName || "Admin"} (Admin)` : msg.salesManagerName}</span>
                              <span className={`text-[9px] sm:text-[10px] ${t.textFaint}`}>{formatDate(msg.createdAt)}</span>
                            </div>
                            <p className={`text-xs sm:text-sm whitespace-pre-wrap leading-relaxed break-words ${t.textMuted}`}>{msg.message}</p>

                            {/* Log Reply button — only on WhatsApp messages */}
                            {isWA && (
                              <button
                                onClick={() => {
                                  setCustomNote(`📲 WhatsApp Reply from ${selectedLead.name}: `);
                                  setTimeout(() => inputRef.current?.focus(), 50);
                                }}
                                className="mt-2 text-[10px] font-bold text-green-500 hover:text-green-400 border border-green-500/30 hover:border-green-400/50 bg-green-500/5 hover:bg-green-500/10 px-3 py-1 rounded-full transition-all flex items-center gap-1"
                              >
                                <FaWhatsapp className="text-[9px]" /> Log their reply
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={followUpEndRef} />
                  </div>
                  {/* Composer stays open on closed/lost leads — notes are a record of
                      what happened, not an edit to the deal. The Salesform/Loan/Closing
                      buttons above remain gated on isLeadLocked. */}
                  <form onSubmit={handleSendCustomNote} className={`p-3 sm:p-3 border-t flex gap-2 sm:gap-3 items-center flex-shrink-0 ${t.header} ${t.tableBorder}`} style={t.headerGlass}>
                    <input
                      ref={inputRef}
                      type="text" value={customNote} onChange={e => setCustomNote(e.target.value)}
                      placeholder="Add follow-up note..."
                      className={`flex-1 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm outline-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                    />
                    <button type="submit" className={`w-10 h-10 sm:w-12 sm:h-12 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg flex-shrink-0 ${isDark ? "bg-purple-600 hover:bg-purple-500" : "bg-[#00AEEF] hover:bg-[#0099d4]"}`}><FaPaperPlane className="text-sm ml-[-2px]" /></button>
                  </form>
                </div>

              </div>{/* end three-part body */}
            </div>
          )
        )}
        {/* ── AI ASSISTANT (floating, same launcher as the Admin dock) ──
            Mounted here, OUTSIDE the lead-detail branch, on purpose. It used to
            live inside the detail view's three-column body, so it only existed
            once a lead was open — invisible from the lead list and everywhere
            else. It is position:fixed, so where it sits in the tree does not
            affect where it renders; what matters is that it is always mounted.

            /api/sm-ai-chat scopes every query to the signed-in manager in SQL,
            so it answers about this manager's whole book, not just `lead`.
            `lead` only tells it which record is on screen right now. */}
        <SMAssistantDock
          lead={selectedLead}
          isDark={isDark}
          t={t}
          isOpen={aiPanelOpen}
          onOpenLead={(leadId: number) => {
            // What the AI's [#226 Name](lead:226) links call.
            const l = allLeads.find((x: any) => Number(x.id) === Number(leadId));
            if (l) { setSelectedLead(l); setSubView("detail"); }
          }}
          onToggle={() => setAiPanelOpen(o => !o)}
        />

        {/* ── CALL MODAL ── */}
        {showLostModal && selectedLead && (
          <LostLeadModal
            lead={selectedLead}
            reason={lostReason}
            error={lostError}
            isSaving={isSavingLost}
            isDark={isDark}
            theme={t}
            onReasonChange={(value) => { setLostReason(value); if (lostError) setLostError(""); }}
            onClose={() => setShowLostModal(false)}
            onSubmit={handleMarkLostLead}
          />
        )}

        <BookingFormModal
          isOpen={isClosingModalOpen || isEditingBooking}
          onClose={() => { setIsClosingModalOpen(false); setIsEditingBooking(false); }}
          lead={selectedLead}
          user={adminUser}
          isDark={isDark}
          onSuccess={handleBookingSuccess}
          isEditMode={isEditingBooking}
          existingBooking={isEditingBooking ? bookingData : null}
        />

        {/* ── WHATSAPP MODAL ── */}
        {isWaModalOpen && selectedLead && (() => {
          const phoneOptions = (() => {
            const opts: { label: string; value: string }[] = [];
            const primary = String(selectedLead.phone || selectedLead.contact_no || "").replace(/\D/g, "");
            const alt = String(selectedLead.altPhone || selectedLead.alt_phone || "").replace(/\D/g, "");
            if (primary) opts.push({ label: `Primary — ${primary}`, value: primary });
            if (alt && alt !== primary) opts.push({ label: `Alt — ${alt}`, value: alt });
            return opts;
          })();

          return (
            <WaModalWithPicker
              lead={selectedLead}
              adminUser={adminUser}
              waMessage={waMessage}
              setWaMessage={setWaMessage}
              isSendingWa={isSendingWa}
              phoneOptions={phoneOptions}
              isDark={isDark}
              t={t}
              onClose={() => { setIsWaModalOpen(false); setWaMessage(""); }}
              onSubmit={handleSendWhatsApp}
            />
          );
        })()}
        <PermanentLeadDeleteDialog
          open={!!deleteConfirmLead}
          lead={deleteConfirmLead}
          isDark={isDark}
          isDeleting={isDeletingLead}
          error={deleteError}
          onClose={() => {
            if (isDeletingLead) return;
            setDeleteConfirmLead(null);
            setDeleteError(null);
          }}
          onConfirm={handlePermanentDeleteLead}
        />
      </main>
    </div>
  );
}

// ============================================================================
// AI NUDGE — one-per-session pointer at the collapsed AI Assistant tab
// ============================================================================
// Shown once per browser session so people discover the panel, and never again
// in that session. sessionStorage rather than localStorage on purpose: a nudge
// that never returns is easy to miss forever, one that returns every day is
// nagging; per-session is the middle.
//
// The flag is written at the moment the nudge is SHOWN, not on mount. Writing it
// on mount would burn the one showing on a render that never displayed anything
// — e.g. the operator opens the panel during the 3s delay, or navigates away.
function AiNudge({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) return;
    try { if (sessionStorage.getItem("ai_nudge_shown")) return; } catch { return; }

    const showAt = setTimeout(() => {
      try { sessionStorage.setItem("ai_nudge_shown", "1"); } catch { /* private mode */ }
      setVisible(true);
    }, 3000);

    return () => clearTimeout(showAt);
  }, [show]);

  // Auto-dismiss is its own effect keyed on `visible`, so the 5s clock starts when
  // the nudge actually appears rather than 5s after mount.
  useEffect(() => {
    if (!visible) return;
    const hideAt = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(hideAt);
  }, [visible]);

  // The panel opening mid-countdown cancels the whole thing — pointing at a tab
  // that is no longer there would be worse than not nudging at all.
  useEffect(() => { if (!show) setVisible(false); }, [show]);

  // framer-motion rather than the `animate-fadeIn` class used elsewhere in this
  // file: that class has no keyframes defined anywhere in the project, so it
  // animates nothing. motion is already imported here and gives a real exit too.
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ai-nudge"
          role="status"
          onClick={() => setVisible(false)}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          // right-full puts it to the LEFT of the vertical tab, which is what makes
          // a right-pointing arrow coherent — the tab sits at the screen edge, so
          // there is no room on its other side.
          className="hidden lg:block absolute right-full top-3 mr-2 z-30 cursor-pointer select-none"
        >
          <div className="relative bg-purple-600 text-white text-sm rounded-xl px-3 py-2 shadow-lg whitespace-nowrap">
            ✨ Ask AI about this lead!
            {/* Arrow: a square rotated 45° and half-overlapped, so it reads as one
                shape with the bubble rather than a separate triangle. */}
            <span
              aria-hidden
              className="absolute top-1/2 -right-1 -translate-y-1/2 w-2.5 h-2.5 bg-purple-600 rotate-45 rounded-[2px]"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// LEAD AI ASSISTANT PANEL — collapsible, lead-scoped AI helper
// ============================================================================
function LeadAiAssistantPanel({
  lead, followUps, isDark, t, isOpen, onToggle
}: {
  lead: any; followUps: any[]; isDark: boolean;
  t: ReturnType<typeof buildTheme>; isOpen: boolean; onToggle: () => void;
}) {
  const [messages, setMessages] = useState<{ sender: string; text: string; ts?: string; typing?: boolean }[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fresh chat thread whenever the selected lead changes
  useEffect(() => { setMessages([]); setInput(""); }, [lead?.id]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  const getTime = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading || !lead) return;
    setInput("");
    setMessages(prev => [...prev, { sender: "user", text, ts: getTime() }]);
    setIsLoading(true);
    setMessages(prev => [...prev, { sender: "ai", text: "", ts: getTime(), typing: true }]);
    try {
      const res = await fetch("/api/ai-assistant/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Scoped to this single lead — not the manager's whole portfolio
        body: JSON.stringify({ query: text, leads: [lead], followUps }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.typing ? { sender: "ai", text: data.response, ts: getTime(), typing: false } : m));
    } catch (err) {
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.typing ? { sender: "ai", text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`, ts: getTime(), typing: false } : m));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  // The lead's display number. sr_no is what the rest of the CRM shows the
  // operator; id is the database key and only a fallback.
  const leadNo = lead ? (lead.sr_no ?? lead.id) : null;
  const leadName = lead?.name ?? "";

  // ── Quick Ask ──
  // The prompt text is written out in full rather than sent as the chip label:
  // "Deep dive into this lead" alone gives the model no referent, and the digest's
  // CURRENT LEAD IN CONTEXT block is easier to honour when the question names the
  // same lead. Kept short so it reads naturally in the thread as a user message.
  const quickActions = lead ? [
    { label: "🔍 Deep dive into this lead", prompt: `Give me a deep dive on lead #${leadNo} — ${leadName}: status, budget, interest level, what has happened so far, and where it stands.` },
    { label: "📞 Who should I call next?", prompt: `Should I call ${leadName} next, and if so what is the reason and the best time?` },
    { label: "📅 What's the follow-up history?", prompt: `Walk me through the follow-up history for ${leadName} in order, and tell me how long it has been since the last contact.` },
    { label: "💡 Suggest next action", prompt: `What is the single best next action for ${leadName}, and why?` },
    { label: "📊 Lead conversion chances", prompt: `How likely is ${leadName} to convert? Give me the signals for and against, based only on the recorded data.` },
  ] : [];

  if (!isOpen) {
    return (
      <>
        {/* Mobile — collapsed full-width bar */}
        <button
          type="button"
          onClick={onToggle}
          className={`flex lg:hidden items-center justify-between gap-2 w-full rounded-xl border px-3 py-2.5 shadow-sm cursor-pointer transition-colors ${t.chatPanel}`}
          style={t.chatPanelGl}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gradient-to-br from-purple-600 to-blue-600" : "bg-gradient-to-br from-[#00AEEF] to-[#9E217B]"}`}>
              <Bot className="text-white w-3.5 h-3.5" />
            </div>
            <span className={`text-xs font-bold ${t.text}`}>AI Assistant</span>
            <span className={`text-[10px] truncate ${t.textFaint}`}>· tap to ask about {lead?.name || "this lead"}</span>
          </div>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 ${t.textFaint}`} />
        </button>

        {/* Desktop — collapsed vertical strip.
            Wrapped in a relative, sticky container so the nudge can be positioned
            against the tab. The sticky moved off the button and onto the wrapper —
            leaving it on the button would scroll the tab away from its own nudge. */}
        <div className="hidden lg:block relative flex-shrink-0 sticky top-4 h-[calc(100vh-185px)]">
          <AiNudge show={!isOpen && !!lead} />
          <button
            type="button"
            onClick={onToggle}
            title="Open AI Assistant"
            className={`flex flex-col items-center justify-between gap-3 w-12 h-full rounded-xl border shadow-sm cursor-pointer transition-colors py-4 ${t.chatPanel} hover:opacity-90`}
            style={t.chatPanelGl}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gradient-to-br from-purple-600 to-blue-600" : "bg-gradient-to-br from-[#00AEEF] to-[#9E217B]"}`}>
              <Bot className="text-white w-4 h-4" />
            </div>
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${t.accentText}`}
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              AI Assistant
            </span>
            <ChevronLeft className={`w-3.5 h-3.5 flex-shrink-0 ${t.textFaint}`} />
          </button>
        </div>
      </>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        // lg:w-96 (384px) fixed instead of lg:w-0 lg:flex-1: as a flex child it
        // used to absorb whatever the lead detail column left over, so the chat
        // width moved around with the content beside it.
        className={`flex flex-col rounded-xl overflow-hidden shadow-2xl border w-full lg:w-96 flex-shrink-0 h-[540px]  lg:h-[calc(100vh-185px)] lg:sticky lg:top-4 ${t.chatPanel}`}
        style={t.chatPanelGl}
      >
        {/* Header */}
        <div className={`flex items-center justify-between gap-2 px-3 py-3 border-b flex-shrink-0 ${t.tableBorder} ${t.header}`} style={t.headerGlass}>
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gradient-to-br from-purple-600 to-blue-600" : "bg-gradient-to-br from-[#00AEEF] to-[#9E217B]"}`}>
              <Bot className="text-white w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className={`font-bold text-sm leading-tight ${t.text}`}>AI Assistant</h3>
              <p className={`text-[10px] truncate ${t.textFaint}`}>
                {lead ? `Helping with ${lead.name} — #${lead.id}` : "No lead selected"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            title="Collapse"
            className={`w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-[#F1F5F9]"}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* ── Lead context banner ──
            States which record the answers are about. The panel is docked beside a
            list, so it is otherwise easy to read an answer against the wrong lead
            after clicking around. */}
        {lead && (
          <div className={`px-3 pt-2.5 flex-shrink-0`}>
            <div className={`rounded-lg px-3 py-2 text-[11px] truncate ${isDark ? "bg-[#141419] text-[#888899]" : "bg-gray-50 text-gray-500"}`}
              title={`#${leadNo} ${leadName}`}>
              You&apos;re viewing: <span className={`font-semibold ${isDark ? "text-[#c9c9d4]" : "text-gray-700"}`}>#{leadNo} {leadName}</span>
            </div>
          </div>
        )}

        {/* ── Quick Ask ──
            Chips wrap rather than scroll horizontally: at w-96 all five fit in two
            rows, and a horizontal scroller hides the last chips behind an edge
            most people never drag. */}
        <div className={`px-3 py-2 flex-shrink-0 border-b ${t.tableBorder}`}>
          <p className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${t.textFaint}`}>Quick Ask</p>
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map(qa => (
              <button
                key={qa.label}
                type="button"
                // Put the prompt in the input first so the chip's effect is visible,
                // then submit it — the same path a typed question takes.
                onClick={() => { setInput(qa.prompt); sendMessage(qa.prompt); }}
                disabled={isLoading}
                className={`rounded-full text-xs px-3 py-1.5 border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isDark
                  ? "bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20"
                  : "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                  }`}
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chat thread */}
        <div className={`flex-1 p-3 overflow-y-auto custom-scrollbar flex flex-col gap-2 ${t.chatArea}`}>
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-6">
              <Bot className={`w-8 h-8 ${t.textFaint}`} />
              <p className={`text-xs max-w-[220px] ${t.textFaint}`}>
                Ask me anything about {lead?.name || "this lead"} — I can draft messages, suggest next steps, or summarize their status.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-2 ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className="flex-shrink-0 mt-0.5">
                  {msg.sender === "ai"
                    ? <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isDark ? "bg-gradient-to-br from-purple-600 to-blue-600" : "bg-gradient-to-br from-[#00AEEF] to-[#9E217B]"}`}><Bot className="text-white w-3 h-3" /></div>
                    : <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${t.settingsBg} ${t.tableBorder}`}><User className={`w-3 h-3 ${t.textMuted}`} /></div>
                  }
                </div>
                <div className={`flex flex-col gap-1 ${msg.sender === "user" ? "items-end max-w-[80%]" : "items-start max-w-[85%]"}`}>
                  <div className={`px-2.5 py-2 rounded-lg text-[11px] leading-relaxed ${msg.sender === "user" ? t.chatBubbleUser + " rounded-tr-sm" : t.chatBubbleAi + " rounded-tl-sm"}`}>
                    {msg.typing ? (
                      <div className="flex items-center gap-1.5 py-0.5">
                        <div className="flex items-end gap-[2px] h-3">
                          {[0, 100, 200, 100, 0].map((delay, i) => (
                            <div key={i} className={`w-[2px] rounded-full animate-pulse ${isDark ? "bg-purple-400" : "bg-[#00AEEF]"}`} style={{ height: `${[5, 8, 11, 8, 5][i]}px`, animationDelay: `${delay}ms`, animationDuration: "0.8s" }} />
                          ))}
                        </div>
                        <span className={`text-[9px] italic ${t.textFaint}`}>thinking...</span>
                      </div>
                    ) : <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className={`p-2 border-t flex gap-1.5 items-end flex-shrink-0 ${t.header} ${t.tableBorder}`} style={t.headerGlass}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this lead..."
            disabled={isLoading || !lead}
            rows={1}
            className={`flex-1 rounded-lg px-2.5 py-2 text-[11px] outline-none resize-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus} disabled:opacity-50`}
            style={{ maxHeight: "80px" }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || !lead}
            className={`w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center transition-all cursor-pointer ${input.trim() && !isLoading ? (isDark ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-[#00AEEF] hover:bg-[#0099d4] text-white") : `${t.settingsBg} ${t.textFaint} cursor-not-allowed`}`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
        <p className={`text-center text-[9px] px-3 pb-2 leading-relaxed ${t.textFaint}`}>
          AI may make mistakes. Always verify lead info independently.
        </p>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================================
// LUCIDE ICON RESOLVER (unchanged)
// ============================================================================
function LucideIcon({ name, className }: { name: string; className?: string }) {
  const icons: Record<string, React.ReactNode> = {
    "check-circle": <CheckCircle className={className} />, "x-circle": <XCircle className={className} />, "help-circle": <HelpCircle className={className} />, "landmark": <Landmark className={className} />, "clock": <Clock className={className} />, "alert-triangle": <AlertTriangle className={className} />, "banknote": <Banknote className={className} />, "calendar-check": <CalendarCheck className={className} />, "map-pin": <MapPin className={className} />, "calendar": <CalendarDays className={className} />, "zap": <Zap className={className} />, "trending-up": <TrendingUp className={className} />, "home": <Home className={className} />, "building-2": <Building2 className={className} />, "globe": <Globe className={className} />, "star": <Star className={className} />, "share-2": <Share2 className={className} />, "users": <Users className={className} />, "bar-chart-2": <BarChart2 className={className} />, "badge-check": <BadgeCheck className={className} />, "lightbulb": <Lightbulb className={className} />, "target": <Target className={className} />, "brain-circuit": <BrainCircuit className={className} />,
  };
  return <>{icons[name] ?? <ArrowRight className={className} />}</>;
}
function WaModalWithPicker({ lead, adminUser, waMessage, setWaMessage, isSendingWa, phoneOptions, isDark, t, onClose, onSubmit }: {
  lead: any; adminUser: any;
  waMessage: string; setWaMessage: (v: string) => void;
  isSendingWa: boolean;
  phoneOptions: { label: string; value: string }[];
  isDark: boolean; t: any;
  onClose: () => void;
  onSubmit: (e: React.FormEvent, phone: string) => void;
}) {
  const [selectedPhone, setSelectedPhone] = useState(phoneOptions[0]?.value || "");

  return (
    <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-3 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}>
      <div className={`rounded-xl w-full max-w-lg shadow-2xl border overflow-hidden ${t.modalCard}`}
        style={t.modalGlass}>

        {/* Header */}
        <div className="p-3 border-b border-green-500/20 bg-green-500/10 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2 text-green-500">
              <FaWhatsapp /> Send WhatsApp
            </h2>
            <p className={`text-xs mt-1 ${t.textMuted}`}>To: <strong>{lead.name}</strong></p>
            {adminUser.whatsapp_number && (
              <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>From: +{adminUser.whatsapp_number}</p>
            )}
          </div>
          <button onClick={onClose} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
        </div>

        <form onSubmit={e => onSubmit(e, selectedPhone)}>
          <div className={`p-6 space-y-4 ${t.modalInner}`}>

            {/* ── Phone Picker ── */}
            <div>
              <label className={`block text-sm font-bold mb-2 ${isDark ? "text-green-400" : "text-green-600"}`}>
                Send to number
              </label>
              {phoneOptions.length === 0 ? (
                <p className="text-xs text-red-400">No phone number on this lead.</p>
              ) : phoneOptions.length === 1 ? (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border font-mono text-sm ${isDark
                  ? "bg-green-500/10 border-green-500/30 text-green-300"
                  : "bg-green-50 border-green-200 text-green-700"
                  }`}>
                  <FaWhatsapp /> {phoneOptions[0].label}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {phoneOptions.map(opt => (
                    <label key={opt.value}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${selectedPhone === opt.value
                        ? (isDark
                          ? "bg-green-500/15 border-green-500/50 text-green-300"
                          : "bg-green-50 border-green-400 text-green-700")
                        : (isDark
                          ? "bg-transparent border-[#333] text-gray-400 hover:border-green-500/30"
                          : "bg-white border-gray-200 text-gray-500 hover:border-green-300")
                        }`}>
                      <input
                        type="radio"
                        name="wa_phone_sm"
                        value={opt.value}
                        checked={selectedPhone === opt.value}
                        onChange={() => setSelectedPhone(opt.value)}
                        className="accent-green-500"
                      />
                      <FaWhatsapp className={selectedPhone === opt.value ? "text-green-500" : "text-gray-400"} />
                      <span className="font-mono text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* ── Message ── */}
            <div>
              <label className={`block text-sm font-bold mb-2 ${isDark ? "text-green-400" : "text-green-600"}`}>
                Message <span className={`text-xs font-normal ${t.textFaint}`}>(logged in CRM timeline)</span>
              </label>
              <textarea
                required
                value={waMessage}
                onChange={e => setWaMessage(e.target.value)}
                rows={6}
                placeholder="Type your message here..."
                className={`w-full rounded-xl px-4 py-3 text-sm outline-none resize-none leading-relaxed border-2 transition-colors custom-scrollbar ${isDark
                  ? "bg-[#14141B] border-green-500/30 text-white focus:border-green-500"
                  : "bg-white border-green-200 text-[#1A1A1A] focus:border-green-500"
                  }`}
              />
            </div>
          </div>

          {/* Footer */}
          <div className={`p-3 border-t flex justify-end gap-3 ${t.modalHeader} ${t.tableBorder}`}>
            <button type="button" onClick={onClose}
              className={`px-3 py-2.5 rounded-lg font-bold cursor-pointer ${t.textMuted} hover:text-red-500`}>
              Cancel
            </button>
            <button type="submit"
              disabled={isSendingWa || !waMessage.trim() || !selectedPhone}
              className={`px-8 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2 ${isSendingWa || !waMessage.trim() || !selectedPhone
                ? "opacity-50 cursor-not-allowed bg-green-600/40 text-white"
                : "cursor-pointer bg-[#25D366] hover:bg-green-500 text-white shadow-lg shadow-green-600/20"
                }`}>
              {isSendingWa ? "Opening..." : <><FaWhatsapp /> Open WhatsApp</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// ASSISTANT VIEW
// ============================================================================


function AssistantView({ allLeads, isDark, t, user }: {
  allLeads: any[]; isDark: boolean;
  t: ReturnType<typeof buildTheme>; user: any
}) {
  const CACHE_KEY = "crm_sm_ai_chat_v2";
  const CACHE_TTL = 2 * 24 * 60 * 60 * 1000;
  const firstName = (user?.name || "").split(" ")[0] || "there";

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{
    sender: string; text: string; ts?: string; typing?: boolean
  }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isLoading]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const { messages, savedAt } = JSON.parse(raw);
      if (Date.now() - savedAt > CACHE_TTL) {
        localStorage.removeItem(CACHE_KEY); return;
      }
      if (Array.isArray(messages)) setChatMessages(messages);
    } catch { localStorage.removeItem(CACHE_KEY); }
  }, []);

  useEffect(() => {
    if (chatMessages.length === 0) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        messages: chatMessages, savedAt: Date.now()
      }));
    } catch { }
  }, [chatMessages]);

  const getTime = () => new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit"
  });

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setChatInput("");
    setChatMessages(prev => [...prev, { sender: "user", text, ts: getTime() }]);
    setIsLoading(true);
    setChatMessages(prev => [...prev, {
      sender: "ai", text: "", ts: getTime(), typing: true
    }]);
    try {
      const res = await fetch("/api/ai-assistant/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, leads: allLeads })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await new Promise(r => setTimeout(r, 400));
      setChatMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && m.typing
          ? { sender: "ai", text: data.response, ts: getTime(), typing: false }
          : m
      ));
    } catch (err) {
      setChatMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && m.typing
          ? { sender: "ai", text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`, ts: getTime(), typing: false }
          : m
      ));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(chatInput);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput);
    }
  };

  const isEmpty = chatMessages.length === 0;

  const chips = [
    { emoji: "📋", label: "What's my work today?", prompt: "What is my work today? List my follow-ups and priorities." },
    { emoji: "🔥", label: "Show high priority leads", prompt: "Show me my high priority leads" },
    { emoji: "📞", label: "Who should I call next?", prompt: "Who should I call next and why?" },
    { emoji: "📊", label: "My pipeline summary", prompt: "Give me a summary of my lead pipeline" },
  ];

  return (
    <div
      className="flex flex-col h-full relative overflow-hidden"
      style={{ background: isDark ? "#0a0a0f" : "#f8fafc" }}
    >
      {/* Radial glow — fades when chat is active */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-700"
        style={{ opacity: isEmpty ? 1 : 0.35, zIndex: 0 }}
      >
        <div style={{
          width: "640px", height: "420px", borderRadius: "50%",
          background: isDark
            ? "radial-gradient(ellipse at center, rgba(99,102,241,0.22) 0%, rgba(59,130,246,0.10) 40%, transparent 70%)"
            : "radial-gradient(ellipse at center, rgba(0,174,239,0.12) 0%, rgba(158,33,123,0.06) 40%, transparent 70%)",
        }} />
      </div>

      {/* Header bar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-5 py-3 relative z-10"
        style={{
          borderBottom: isDark ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(0,0,0,0.08)",
          background: "rgba(10,10,15,0.8)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div style={{
            width: "34px", height: "34px", borderRadius: "10px", flexShrink: 0,
            background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Bot className="text-white w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-tight">My AI</p>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
              {allLeads.length} leads in scope
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {chatMessages.length > 0 && (
            <button
              onClick={() => { setChatMessages([]); localStorage.removeItem(CACHE_KEY); }}
              className="text-[11px] px-3 py-1 rounded-full cursor-pointer transition-colors"
              style={{
                color: "rgba(255,255,255,0.4)",
                border: "1px solid rgba(255,255,255,0.10)"
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(248,113,113,0.9)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
            >
              Clear chat
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400"
              style={{ boxShadow: "0 0 6px rgba(74,222,128,0.7)" }} />
            <span className="text-[11px] text-green-400 font-semibold">Online</span>
          </div>
        </div>
      </div>

      {/* Scroll area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>

        {isEmpty ? (
          /* ── IDLE / WELCOME STATE ── */
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <h1 className="font-light text-white text-center mb-10"
              style={{ fontSize: "clamp(26px,3.5vw,40px)", letterSpacing: "-0.02em" }}>
              What&apos;s on today, {firstName}?
            </h1>
            <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
              {chips.map(c => (
                <button
                  key={c.prompt}
                  onClick={() => sendMessage(c.prompt)}
                  className="text-left transition-all cursor-pointer"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)",
                    border: isDark ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(0,0,0,0.08)",
                    color: isDark ? "rgba(255,255,255,0.72)" : "#334155",
                    borderRadius: "14px", padding: "14px 16px",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,174,239,0.08)";

                    // FIND (chip hover leave):
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)";
                  }}
                >
                  <span className="block text-lg mb-1">{c.emoji}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── ACTIVE CHAT MESSAGES ── */
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar */}
                <div className="flex-shrink-0 mt-0.5">
                  {msg.sender === "ai" ? (
                    <div style={{
                      width: "30px", height: "30px", borderRadius: "9px", flexShrink: 0,
                      background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Bot className="text-white w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div style={{
                      width: "30px", height: "30px", borderRadius: "9px", flexShrink: 0,
                      background: isDark ? "rgba(255,255,255,0.08)" : "#f1f5f9",
                      border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid #e2e8f0",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <User className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.6)" }} />
                    </div>
                  )}
                </div>

                {/* Bubble */}
                <div className={`flex flex-col gap-1 ${msg.sender === "user" ? "items-end max-w-[72%]" : "items-start max-w-[82%]"}`}>
                  <div
                    className="text-sm leading-relaxed"
                    style={{
                      padding: "10px 14px",
                      borderRadius: msg.sender === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
                      ...(msg.sender === "user" ? {
                        background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                        color: "#fff",
                      } : {
                        background: isDark ? "rgba(255,255,255,0.06)" : "#f1f5f9",
                        border: isDark ? "1px solid rgba(255,255,255,0.10)" : "1px solid #cbd5e1",
                        color: isDark ? "rgba(255,255,255,0.9)" : "#0f172a",
                      }),
                    }}
                  >
                    {msg.typing ? (
                      <div className="flex items-center gap-1.5 py-0.5">
                        {[0, 200, 400].map((d, i) => (
                          <span key={i} className="block w-1.5 h-1.5 rounded-full animate-bounce"
                            style={{ background: "rgba(165,180,252,0.7)", animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    )}
                  </div>
                  {msg.ts && !msg.typing && (
                    <span className="text-[10px] px-1"
                      style={{ color: "rgba(255,255,255,0.22)" }}>
                      {msg.ts}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* ── INPUT BAR ── */}
      <div
        className="flex-shrink-0 relative z-10"
        style={{
          padding: "14px 20px 16px",
          borderTop: isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid #cbd5e1",
          background: isDark ? "rgba(10,10,15,0.92)" : "rgba(255,255,255,0.95)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit}>
            <div className="relative flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={e => {
                  setChatInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your leads, follow-ups..."
                disabled={isLoading}
                rows={1}
                className="flex-1 text-sm outline-none resize-none transition-all"
                style={{
                  background: isDark ? "rgba(255,255,255,0.06)" : "#ffffff",
                  border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid #94a3b8",
                  color: isDark ? "rgba(255,255,255,0.88)" : "#1e293b",
                  borderRadius: "24px",
                  padding: "12px 52px 12px 18px",
                  maxHeight: "120px", minHeight: "48px",
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = "rgba(99,102,241,0.6)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.12)";
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !chatInput.trim()}
                className="absolute right-3 bottom-2.5 flex items-center justify-center cursor-pointer transition-all"
                style={{
                  width: "34px", height: "34px", borderRadius: "50%", border: "none",
                  background: chatInput.trim() && !isLoading ? "#4f46e5" : "rgba(255,255,255,0.08)",
                  opacity: chatInput.trim() && !isLoading ? 1 : 0.4,
                }}
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </form>

          {/* Quick chips */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1"
            style={{ scrollbarWidth: "none" }}>
            {chips.map(c => (
              <button
                key={c.prompt}
                onClick={() => sendMessage(c.prompt)}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer transition-colors flex-shrink-0"
                style={{
                  border: isDark ? "1px solid rgba(255,255,255,0.11)" : "1px solid #94a3b8",
                  borderRadius: "999px",
                  padding: "5px 13px",
                  color: isDark ? "rgba(255,255,255,0.55)" : "#64748b",
                  background: "transparent",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>

          <p className="text-center mt-2 text-[10px]"
            style={{ color: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.25)" }}>
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
// ============================================================================
// SITE VISIT SCHEDULER COMPONENT
// ============================================================================
function SiteVisitScheduler({
  lead, adminUser, isDark, t, onSuccess
}: {
  lead: any; adminUser: any; isDark: boolean;
  t: ReturnType<typeof buildTheme>; onSuccess: () => void;
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
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setVisits(json.data);
    } catch { }
  };

  useEffect(() => { fetchVisits(); }, [lead.id]);

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3000);
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitDate) return;
    setIsSaving(true);
    try {
      const url = editVisit ? `/api/site-visits` : `/api/site-visits`;
      const method = editVisit ? "PATCH" : "POST";
      const body = editVisit
        ? { id: editVisit.id, visit_date: visitDate, notes: visitNotes }
        : { lead_id: lead.id, visit_date: visitDate, created_by: adminUser.name, role: adminUser.role, notes: visitNotes };

      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { showToast("❌ Server error"); return; }
      const json = await res.json();

      if (!json.success) { showToast("❌ " + json.message); return; }

      // Post follow-up note to MongoDB timeline
      const visitLabel = editVisit ? "Re-Site Visit Rescheduled" : visits.length === 0 ? "Site Visit Scheduled" : "Re-Site Visit Scheduled";
      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: adminUser.name,
          createdBy: adminUser.role === "admin" ? "admin" : "sales",
          message: `📅 ${visitLabel}:\n• Date: ${new Date(visitDate).toLocaleString("en-IN")}\n• Notes: ${visitNotes || "N/A"}`,
          siteVisitDate: visitDate,
          createdAt: new Date().toISOString(),
        }),
      });

      showToast(`✅ ${visitLabel}!`);
      setShowModal(false); setVisitDate(""); setVisitNotes(""); setEditVisit(null);
      fetchVisits(); onSuccess();
    } catch { showToast("❌ Something went wrong."); }
    finally { setIsSaving(false); }
  };

  const handleStatusChange = async (visitId: number, status: string) => {
    try {
      const res = await fetch("/api/site-visits", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: visitId, status }) });
      if (!res.ok) { showToast("❌ Server error"); return; }
      const json = await res.json();
      if (!json.success) { showToast("❌ " + json.message); return; }

      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: adminUser.name,
          createdBy: "sales",
          message: `🔄 Site Visit marked as ${status.toUpperCase()} by ${adminUser.name}`,
          siteVisitDate: null,
          createdAt: new Date().toISOString(),
        }),
      });

      showToast(`✅ Visit marked as ${status}`);
      fetchVisits(); onSuccess();
    } catch { showToast("❌ Update failed."); }
  };

  const upcomingVisit = visits.find(v => v.status === "scheduled" && new Date(v.visit_date) >= new Date());
  const isClosing = lead.status === "Closing" || !!lead.closingDate;
  const isLost = !!lead.is_lost_lead;

  const statusBadge = (status: string) => {
    if (status === "completed") return "text-green-400 border-green-500/30 bg-green-500/10";
    if (status === "cancelled") return "text-red-400 border-red-500/30 bg-red-500/10";
    return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
  };

  return (
    <div className={`rounded-xl border p-3 ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200"}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-xl shadow-lg text-sm font-bold text-white bg-green-600 animate-fadeIn border border-green-400">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className={`font-bold text-sm flex items-center gap-2 ${t.text}`}>
            <FaCalendarAlt className="text-orange-400" /> Site Visit History
          </h3>
          {upcomingVisit && (
            <p className="text-xs text-orange-400 font-semibold mt-0.5">
              Next: {new Date(upcomingVisit.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        {!isClosing && !isLost && (
          <button
            onClick={() => { setEditVisit(null); setVisitDate(""); setVisitNotes(""); setShowModal(true); emitActivity({ type: 'LEAD_INTERACTION', action: 'Updating Site Visit', leadId: lead?.id, leadName: lead?.name, module: 'Site Visit Modal' }); }}
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

      {/* Visit Timeline */}
      {visits.length === 0 ? (
        <p className={`text-xs text-center py-2.5 ${t.textFaint}`}>No site visits scheduled yet.</p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className={`absolute left-3 top-0 bottom-0 w-px ${isDark ? "bg-[#333]" : "bg-indigo-100"}`} />
          <div className="space-y-4 pl-8">
            {visits.map((v, i) => (
              <div key={v.id} className="relative">
                {/* Dot */}
                <div className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full border-2 ${v.status === "completed" ? "bg-green-500 border-green-400" :
                  v.status === "cancelled" ? "bg-red-500 border-red-400" :
                    "bg-yellow-500 border-yellow-400"
                  }`} />

                <div className={`rounded-xl p-3 border ${isDark ? "bg-[#222] border-[#333]" : "bg-[#F8FAFC] border-indigo-100"}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <p className={`text-xs font-bold ${t.text}`}>
                        Visit {i + 1} — {new Date(v.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                      <p className={`text-[10px] ${t.textFaint}`}>
                        {new Date(v.visit_date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · by {v.created_by}
                      </p>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase flex-shrink-0 ${statusBadge(v.status)}`}>
                      {v.status}
                    </span>
                  </div>
                  {v.notes && <p className={`text-[11px] italic ${t.textMuted}`}>{v.notes}</p>}

                  {/* Action buttons for scheduled visits */}
                  {v.status === "scheduled" && !isClosing && !isLost && (

                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button onClick={() => handleStatusChange(v.id, "completed")}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500 hover:text-white transition-colors cursor-pointer">
                        ✓ Mark Completed
                      </button>
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

      {/* Schedule Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex items-center justify-center p-3 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-xl w-full max-w-md shadow-2xl border overflow-hidden ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200"}`}>
            <div className={`p-3 border-b flex items-center justify-between ${isDark ? "bg-orange-900/20 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
              <div>
                <h2 className={`font-bold flex items-center gap-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>
                  <FaCalendarAlt /> {editVisit ? "Reschedule Visit" : visits.length === 0 ? "Schedule Site Visit" : "Schedule Re-Site Visit"}
                </h2>
                <p className={`text-xs mt-0.5 ${t.textMuted}`}>Lead #{lead.sr_no || lead.id} — {lead.name}</p>
              </div>
              <button onClick={() => { setShowModal(false); setEditVisit(null); }} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>
            <form onSubmit={handleSchedule} className={`p-3 space-y-4 ${isDark ? "bg-[#121212]" : "bg-[#F8FAFC]"}`}>
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
                  className={`w-full rounded-xl px-4 py-3 text-sm outline-none border-2 transition-colors ${isDark ? "bg-[#1a1a1a] border-orange-500/40 text-white focus:border-orange-500" : "bg-white border-orange-300 text-[#1A1A1A] focus:border-orange-500"
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
                  className={`w-full rounded-xl px-4 py-3 text-sm outline-none resize-none border-2 transition-colors ${isDark ? "bg-[#1a1a1a] border-orange-500/30 text-white focus:border-orange-500" : "bg-white border-orange-200 text-[#1A1A1A] focus:border-orange-500"
                    }`}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditVisit(null); }}
                  className={`flex-1 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${t.textMuted} hover:text-red-500 border ${isDark ? "border-[#333]" : "border-gray-200"}`}>
                  Cancel
                </button>
                <button type="submit" disabled={isSaving || !visitDate}
                  className={`flex-1 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${isSaving || !visitDate
                    ? "opacity-50 cursor-not-allowed bg-orange-400 text-white"
                    : "cursor-pointer bg-orange-500 hover:bg-orange-400 text-white shadow-lg shadow-orange-500/20"
                    }`}>
                  {isSaving ? "Saving..." : <><FaCalendarAlt /> {editVisit ? "Reschedule" : "Schedule"}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
// The Sales Manager Settings view has moved to /dashboard/settings, which the
// Settings item in the rail now links to. It holds Profile, Account & Security,
// Preferences, Notifications, Activity Logs, Additional Features and WhatsApp
// Integration — the WhatsApp number field that used to be here is the last of
// those.
// ============================================================================
// ATTENDANCE VIEW — Sales Manager self-attendance tracker
// ============================================================================
// ============================================================================
// ATTENDANCE VIEW — Sales Manager self-attendance with mark-present checkbox
// ============================================================================


function ReceptionistView() { return null; }
