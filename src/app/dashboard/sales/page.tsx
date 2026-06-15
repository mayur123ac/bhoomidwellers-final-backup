// sales manager
"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useActivityTracker, emitActivity } from "@/hooks/useActivityTracker";
import { useRouter } from "next/navigation";
import AttendanceView from "@/components/AttendanceView";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useShiftTiming } from "@/hooks/useShiftTiming";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, User, Send, BarChart2, AlertTriangle, Landmark, CalendarDays,
  Lightbulb, ClipboardList, Wifi, CheckCircle, XCircle, HelpCircle,
  Clock, MapPin, Zap, TrendingUp, Home, Building2, Globe, Star,
  Share2, Image, Banknote, Users, BadgeCheck, CalendarCheck, Ghost,
  ArrowRight, Target, BrainCircuit, Flame
} from "lucide-react";

import {
  FaThLarge, FaCog, FaFileInvoice,
  FaChevronLeft, FaCheckCircle, FaPaperPlane, FaTimes, FaPhoneAlt,
  FaCalendarAlt, FaUserCircle, FaMicrophone, FaWhatsapp, FaRobot,
  FaEyeSlash, FaSearch, FaUniversity, FaUsers, FaFileAlt, FaCheck,
  FaClock, FaBell, FaHandshake, FaClipboardList
} from "react-icons/fa";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";
import CallButton from "@/components/CallButton";
import CallModal from "@/components/CallModal";
import OnCallBadge from "@/components/OnCallBadge";
import LostLeadModal from "@/components/LostLeadModal";
import MarkClosingModal from "@/components/MarkClosingModal";
import { handleMarkLostLead as markLostLeadApi, restoreLostLead, updateLeadLostState, useLostLeadEvents } from "@/lib/lostLeadSync";

import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";


const CARDS_PER_PAGE = 20;
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
    accentText: isDark ? "text-[#d946a8]" : "text-[#00AEEF]",
    accentBg: isDark ? "bg-[#d946a8]/10 text-[#d946a8] border border-[#d946a8]/30" : "bg-[#00AEEF]/10 text-[#00AEEF] border border-[#00AEEF]/30",
    sectionTitle: isDark ? "text-[#d946a8]" : "text-[#9E217B]",
    sectionBorder: isDark ? "border-[#d946a8]/20" : "border-[#9E217B]/25",

    // ── Buttons ──
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
    statusRouted: isDark ? "text-[#d946a8] border-[#9E217B]/30 bg-[#9E217B]/10" : "text-[#00AEEF] border-[#00AEEF]/30 bg-[#00AEEF]/10",
    statusVisit: isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50",
    statusClosing: isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50",
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

// ============================================================================
// SHARED REAL-TIME DATA HOOK (unchanged)
// ============================================================================
function useAdminData() {
  const [managers, setManagers] = useState<any[]>([]);
  const [receptionists] = useState<any[]>([]);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAdminData = useCallback(async () => {
    try {
      let smData: any[] = [];
      const resUsers = await fetch("/api/users/sales-manager");
      if (resUsers.ok) { const json = await resUsers.json(); smData = json.data || []; }

      let pgLeads: any[] = [];
      const resLeads = await fetch("/api/walkin_enquiries?limit=1000&offset=0");
      if (resLeads.ok) { const json = await resLeads.json(); pgLeads = Array.isArray(json.data) ? json.data : []; }

      let mongoFollowUps: any[] = [];
      const resFups = await fetch("/api/followups");
      if (resFups.ok) { const json = await resFups.json(); mongoFollowUps = Array.isArray(json.data) ? json.data : []; }

      const mergedLeads = pgLeads.map((lead: any) => {
        const leadFups = mongoFollowUps.filter((f: any) => String(f.leadId) === String(lead.id));
        const salesForms = leadFups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
        const latestFormMsg = salesForms.length > 0 ? salesForms[salesForms.length - 1].message : "";

        const extractField = (fieldName: string) => {
          if (!latestFormMsg) return "Pending";
          const match = latestFormMsg.match(new RegExp(`• ${fieldName}: (.*)`));
          return match ? match[1].trim() : "Pending";
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
        const closingDate = closingFups.length > 0 ? closingFups[closingFups.length - 1].createdAt : null;

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
  }, []);

  const applyLeadUpdate = useCallback((updatedLead: any) => {
    setAllLeads(prev => updateLeadLostState(prev, updatedLead));
  }, []);

  useEffect(() => {
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 5000);
    return () => clearInterval(interval);
  }, [fetchAdminData]);

  useLostLeadEvents(applyLeadUpdate, fetchAdminData);

  return { managers, receptionists, allLeads, followUps, isLoading, refetch: fetchAdminData };
}

// ============================================================================
// MAIN DASHBOARD SHELL
// ============================================================================
export default function SalesDashboard() {
  const router = useRouter();
  useActivityTracker();
  const [isDark, setIsDark] = useState(false);
  const t = buildTheme(isDark);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [user, setUser] = useState({ name: "Loading...", role: "Sales Manager", email: "", password: "" });
  const [activeView, setActiveView] = useState("overview");
  const [showPassword, setShowPassword] = useState(false);
  const [dismissedFollowUps, setDismissedFollowUps] = useState<Set<string>>(new Set());
  const [dismissedVisits, setDismissedVisits] = useState<Set<string>>(new Set());

  const [activePopup, setActivePopup] = useState<"notifications" | "profile" | "visit" | null>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  // ── Attendance: live clock tick ──
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (topbarRef.current && !topbarRef.current.contains(event.target as Node)) {
        setActivePopup(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { managers, receptionists, allLeads, followUps, isLoading, refetch } = useAdminData();

  const followUpLeads = useMemo(() => {
    const now = new Date();
    const myLeads = user.role === "admin" ? allLeads : allLeads.filter((l: any) => l.assigned_to === user.name);
    return myLeads.filter((lead: any) => {
      if (lead.is_lost_lead) return false;
      if (lead.status === "Completed" || lead.status === "Closing") return false;
      if (lead.leadInterestStatus === "Not Interested") return false;
      const leadFups = followUps.filter((f: any) => String(f.leadId) === String(lead.id));
      const lastActivityMs = leadFups.length > 0
        ? Math.max(...leadFups.map((f: any) => new Date(f.createdAt).getTime()))
        : new Date(lead.created_at).getTime();
      return (now.getTime() - lastActivityMs) / (1000 * 60 * 60 * 24) >= 2;
    }).map((lead: any) => {
      const leadFups = followUps.filter((f: any) => String(f.leadId) === String(lead.id));
      const lastActivityMs = leadFups.length > 0
        ? Math.max(...leadFups.map((f: any) => new Date(f.createdAt).getTime()))
        : new Date(lead.created_at).getTime();
      return { ...lead, daysSince: Math.floor((now.getTime() - lastActivityMs) / (1000 * 60 * 60 * 24)) };
    }).sort((a: any, b: any) => b.daysSince - a.daysSince);
  }, [allLeads, followUps, user]);

  const visitNotificationLeads = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const myLeads = user.role === "admin" ? allLeads : allLeads.filter((l: any) => l.assigned_to === user.name);
    return myLeads
      .filter((lead: any) => {
        if (lead.is_lost_lead) return false;
        if (!lead.mongoVisitDate) return false;
        if (dismissedVisits.has(String(lead.id))) return false;
        const visitDay = new Date(lead.mongoVisitDate);
        const visit = new Date(visitDay.getFullYear(), visitDay.getMonth(), visitDay.getDate());
        return Math.round((visit.getTime() - today.getTime()) / 86400000) >= 0 &&
          Math.round((visit.getTime() - today.getTime()) / 86400000) <= 1;
      })
      .map((lead: any) => {
        const visitDay = new Date(lead.mongoVisitDate);
        const visit = new Date(visitDay.getFullYear(), visitDay.getMonth(), visitDay.getDate());
        return { ...lead, visitDiff: Math.round((visit.getTime() - today.getTime()) / 86400000) };
      })
      .sort((a: any, b: any) => a.visitDiff - b.visitDiff);
  }, [allLeads, dismissedVisits]);

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
      {/* ── SIDEBAR (always dark, like receptionist) ── */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className="hidden md:flex flex-col py-5 px-1 z-50 overflow-hidden fixed left-0 top-0 h-full"
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
        <div
          className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full blur-3xl opacity-20 transition-opacity duration-500"
          style={{
            background: "radial-gradient(circle, #9E217B 0%, transparent 70%)",
            opacity: sidebarExpanded ? 0.28 : 0.14,
          }}
        />
        <div className="flex items-center px-3 mb-6 mt-1 overflow-hidden">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black text-white flex-shrink-0 cursor-pointer transition-all duration-300 ${t.logoBg}`}
            style={{
              background: "linear-gradient(135deg, #9E217B 0%, #c7299a 50%, #7B2FF7 100%)",
              boxShadow: "0 4px 16px rgba(158,33,123,0.5), 0 0 0 1px rgba(199,41,154,0.3)",
            }}
          >
            B
          </div>
          <div
            className="ml-3 overflow-hidden transition-all duration-300"
            style={{
              maxWidth: sidebarExpanded ? "130px" : "0px",
              opacity: sidebarExpanded ? 1 : 0,
              transform: sidebarExpanded ? "translateX(0)" : "translateX(-8px)",
            }}
          >
            <p className="text-white font-bold text-[16px] whitespace-nowrap leading-tight">Bhoomi CRM</p>
            <p className="text-[#d946a8] text-[10px] font-semibold whitespace-nowrap opacity-80">Sales Manager</p>
          </div>
        </div>
        <div
          className="mx-3 mb-5 h-px transition-all duration-300"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.4), transparent)",
            opacity: sidebarExpanded ? 1 : 0.4,
          }}
        />
        <nav className="flex flex-col gap-2 w-full px-2 flex-1">
          {/* Main nav items */}
          <div className="flex flex-col gap-2 flex-1">
            {[
              { view: "overview", icon: <FaThLarge className="w-[18px] h-[18px] flex-shrink-0" />, title: "Dashboard" },
              { view: "forms", icon: <FaFileInvoice className="w-[18px] h-[18px] flex-shrink-0" />, title: "Assigned Leads" },
              { view: "closed-leads", icon: <FaCheckCircle className="w-[18px] h-[18px] flex-shrink-0" />, title: "Closed Leads" },
              { view: "attendance", icon: <FaClock className="w-[18px] h-[18px] flex-shrink-0" />, title: "My Attendance" },
              { view: "assistant", icon: <FaRobot className="w-[18px] h-[18px] flex-shrink-0" />, title: "Bhoomi AI" },
            ].map(({ view, icon, title }) => {
              const isActive = activeView === view || (view === "forms" && activeView === "detail");
              return (
                <div
                  key={view}
                  onClick={() => setActiveView(view)}
                  title={!sidebarExpanded ? title : undefined}
                  className="relative cursor-pointer group sm-nav-item"
                >
                  {isActive && (
                    <div
                      className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{
                        background: "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)",
                        animation: "sm-glow-pulse 3s ease-in-out infinite",
                      }}
                    />
                  )}
                  <div
                    className={`flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"}`}
                    style={isActive ? {
                      background: "linear-gradient(135deg, rgba(158,33,123,0.22) 0%, rgba(217,70,168,0.07) 100%)",
                      boxShadow: "inset 0 0 0 1px rgba(217,70,168,0.28), 0 2px 16px rgba(158,33,123,0.12)",
                    } : {}}
                  >
                    {isActive && (
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d946a8]"
                        style={{ boxShadow: "0 0 10px rgba(217,70,168,0.9), 0 0 4px rgba(217,70,168,0.6)" }}
                      />
                    )}
                    {!isActive && (
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.04] transition-colors duration-200" />
                    )}
                    <div
                      className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"}`}
                      style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}
                    >
                      {icon}
                    </div>
                    <span
                      className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"}`}
                      style={{
                        maxWidth: sidebarExpanded ? "140px" : "0px",
                        opacity: sidebarExpanded ? 1 : 0,
                        transform: sidebarExpanded ? "translateX(0)" : "translateX(-6px)",
                        letterSpacing: "0.01em",
                      }}
                    >
                      {title}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Settings pinned to bottom */}
          {(() => {
            const view = "settings";
            const icon = <FaCog className="w-[20px] h-[20px] flex-shrink-0" />;
            const title = "Settings";
            const isActive = activeView === view;
            return (
              <div
                key={view}
                onClick={() => setActiveView(view)}
                title={!sidebarExpanded ? title : undefined}
                className="relative cursor-pointer group sm-nav-item mt-auto"
              >
                {isActive && (
                  <div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      background: "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)",
                      animation: "sm-glow-pulse 3s ease-in-out infinite",
                    }}
                  />
                )}
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"}`}
                  style={isActive ? {
                    background: "linear-gradient(135deg, rgba(158,33,123,0.22) 0%, rgba(217,70,168,0.07) 100%)",
                    boxShadow: "inset 0 0 0 1px rgba(217,70,168,0.28), 0 2px 16px rgba(158,33,123,0.12)",
                  } : {}}
                >
                  {isActive && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d946a8]"
                      style={{ boxShadow: "0 0 10px rgba(217,70,168,0.9), 0 0 4px rgba(217,70,168,0.6)" }}
                    />
                  )}
                  {!isActive && (
                    <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.04] transition-colors duration-200" />
                  )}
                  <div
                    className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"}`}
                    style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}
                  >
                    {icon}
                  </div>
                  <span
                    className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"}`}
                    style={{
                      maxWidth: sidebarExpanded ? "140px" : "0px",
                      opacity: sidebarExpanded ? 1 : 0,
                      transform: sidebarExpanded ? "translateX(0)" : "translateX(-6px)",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {title}
                  </span>
                </div>
              </div>
            );
          })()}
        </nav>
        <div className="px-3 mt-4">
          <div
            className="h-px mb-3"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.35), transparent)",
            }}
          />
          <div
            className="overflow-hidden transition-all duration-300 flex items-center justify-center"
            style={{
              opacity: sidebarExpanded ? 0.5 : 0,
              maxHeight: sidebarExpanded ? "24px" : "0px",
            }}
          >
            <span className="text-[8px] text-gray-300 whitespace-nowrap font-mono tracking-widest uppercase">
              Bhoomi CRM · v2
            </span>
          </div>
        </div>
      </aside>
      {/* ── SIDEBAR BLUR OVERLAY (desktop only, pointer-events off) ── */}
      <div
        className="hidden md:block fixed inset-0 pointer-events-none"
        style={{
          zIndex: 45,
          left: "72px",
          background: "rgba(0, 0, 0, 0.2)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          opacity: sidebarExpanded ? 1 : 0,
          transition: "opacity 320ms ease",
        }}
      />

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative md:ml-[72px]">


        {/* HEADER */}
        <header
          className={`h-16 sm:h-20 border-b flex items-center justify-between px-4 sm:px-6 lg:px-8 flex-shrink-0 z-30 shadow-sm ${t.header}`}
          style={t.headerGlass}
        >
          <h1 className={`font-semibold flex items-center flex-wrap gap-1 sm:gap-2 text-sm sm:text-base lg:text-lg tracking-wide ${t.text}`}>
            <span className="truncate max-w-[140px] sm:max-w-none">Bhoomi Dwellers</span>
            <span className={`text-xs sm:text-sm font-normal ${t.textFaint}`}>— Sales Manager</span>
          </h1>

          <div className="flex items-center gap-2 sm:gap-4 relative" ref={topbarRef}>

            {/* ── Theme Toggle ── */}
            <button
              onClick={() => setIsDark(!isDark)}
              aria-label="Toggle theme"
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm ${t.toggleWrap}`}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* Site Visit Bell */}
            <div className="relative">
              <button
                onClick={() => { setActivePopup(activePopup === "visit" ? null : "visit"); }}
                className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${t.toggleWrap} hover:border-orange-500/50 ${t.textMuted}`}
              >
                <FaCalendarAlt className="text-sm sm:text-base" />
                {visitNotificationLeads.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-orange-500 rounded-full text-[9px] sm:text-[10px] font-black text-white flex items-center justify-center shadow">
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
                    <div className={`p-4 border-b flex items-center justify-between ${t.tableBorder}`}>
                      <div>
                        <h3 className={`font-bold text-sm ${t.text}`}>Site Visit Reminders</h3>
                        <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>Scheduled for today & tomorrow</p>
                      </div>
                      {visitNotificationLeads.length > 0 && <span className="text-[10px] font-bold bg-orange-500/10 border border-orange-500/30 text-orange-400 px-2 py-0.5 rounded-full">{visitNotificationLeads.length} upcoming</span>}
                    </div>
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                      {visitNotificationLeads.length === 0
                        ? <div className={`p-6 text-center text-sm ${t.textFaint}`}><FaCalendarAlt className="text-2xl mb-2 mx-auto opacity-20" />No visits in the next 24 hours!</div>
                        : visitNotificationLeads.map((lead: any) => {
                          const isToday = lead.visitDiff === 0;
                          return (
                            <div key={lead.id} className={`p-4 border-b transition-colors group relative ${t.dropdownItem}`}>
                              <button onClick={e => { e.stopPropagation(); setDismissedVisits(prev => new Set([...prev, String(lead.id)])); }} className={`absolute top-3 right-3 cursor-pointer opacity-0 group-hover:opacity-100 ${t.textFaint} hover:text-red-500`}><FaTimes className="text-xs" /></button>
                              <div className="flex items-start justify-between gap-3 pr-4">
                                <div className="flex-1 min-w-0">
                                  <p className={`font-bold text-xs group-hover:text-orange-400 truncate ${t.text}`}>#{lead.id} — {lead.name}</p>
                                  <p className={`text-[10px] mt-0.5 truncate ${t.textFaint}`}>{lead.propType !== "Pending" ? lead.propType : "Property TBD"} · {lead.salesBudget}</p>
                                  <p className={`text-[10px] mt-1 ${t.textMuted}`}>📅 {new Date(lead.mongoVisitDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                                </div>
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${isToday ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"}`}>{isToday ? "TODAY" : "TOMORROW"}</span>
                              </div>
                            </div>
                          );
                        })
                      }
                    </div>
                    {visitNotificationLeads.length > 0 && <div className={`p-3 border-t ${t.tableBorder}`}><p className={`text-[10px] text-center ${t.textFaint}`}>🗓️ Showing visits within the next 24 hours</p></div>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Follow-up Bell */}
            <div className="relative">
              <button
                onClick={() => { setActivePopup(activePopup === "notifications" ? null : "notifications"); }}
                className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${t.toggleWrap} hover:border-purple-500/50 ${t.textMuted}`}
              >
                <FaBell className="text-sm sm:text-base" />
                {followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-red-500 rounded-full text-[9px] sm:text-[10px] font-black text-white flex items-center justify-center shadow">
                    {followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length > 9 ? "9+" : followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length}
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
                    <div className={`p-4 border-b flex items-center justify-between ${t.tableBorder}`}>
                      <div>
                        <h3 className={`font-bold text-sm ${t.text}`}>Follow-up Reminders</h3>
                        <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>Leads with no activity in 2+ days</p>
                      </div>
                      {followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length > 0 &&
                        <span className="text-[10px] font-bold bg-red-500/10 border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full">
                          {followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length} pending
                        </span>
                      }
                    </div>
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                      {followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length === 0
                        ? <div className={`p-6 text-center text-sm ${t.textFaint}`}><FaBell className="text-2xl mb-2 mx-auto opacity-20" />All leads are up to date!</div>
                        : followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).map((lead: any) => (
                          <div key={lead.id} onClick={() => { setActivePopup(null); setActiveView("detail"); }} className={`p-4 border-b transition-colors cursor-pointer group relative ${t.dropdownItem}`}>
                            <button onClick={e => { e.stopPropagation(); setDismissedFollowUps(prev => new Set([...prev, String(lead.id)])); }} className={`absolute top-3 right-3 cursor-pointer opacity-0 group-hover:opacity-100 ${t.textFaint} hover:text-red-500`}><FaTimes className="text-xs" /></button>
                            <div className="flex items-start justify-between gap-3 pr-4">
                              <div className="flex-1 min-w-0">
                                <p className={`font-bold text-xs group-hover:text-purple-400 truncate ${t.text}`}>#{lead.id} — {lead.name}</p>
                                <p className={`text-[10px] mt-0.5 truncate ${t.textFaint}`}>{lead.propType !== "Pending" ? lead.propType : "No property set"} · {lead.salesBudget}</p>
                                {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" && (
                                  <span className={`inline-block mt-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${lead.leadInterestStatus === "Interested" ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"}`}>{lead.leadInterestStatus}</span>
                                )}
                              </div>
                              <div className="flex-shrink-0 text-right">
                                <div className={`text-xs font-black ${lead.daysSince >= 7 ? "text-red-400" : lead.daysSince >= 4 ? "text-orange-400" : "text-yellow-400"}`}>{lead.daysSince}d</div>
                                <p className={`text-[9px] ${t.textFaint}`}>no contact</p>
                              </div>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                    {followUpLeads.filter((l: any) => !dismissedFollowUps.has(String(l.id))).length > 0 &&
                      <div className={`p-3 border-t ${t.tableBorder}`}><p className={`text-[10px] text-center ${t.textFaint}`}>⚠️ Not Interested & Closing leads excluded</p></div>
                    }
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Profile */}
            <div className="relative">
              <div
                onClick={() => { setActivePopup(activePopup === "profile" ? null : "profile"); }}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-sm sm:text-base cursor-pointer shadow-md hover:scale-105 transition-transform ${isDark
                  ? "border border-purple-500/40 text-purple-400 bg-purple-500/15"
                  : "border border-[#00AEEF]/40 bg-[#9E217B]/20 text-[#d946a8]"
                  }`}
              >
                <FaUserCircle className="text-lg sm:text-xl" />
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
        </header>

        <main className={`flex-1 overflow-hidden custom-scrollbar ${t.mainBg} ${activeView === "assistant" ? "p-0" : "p-4 sm:p-6 lg:p-8 overflow-y-auto"}`}>
          {(activeView === "sales" || activeView === "overview" || activeView === "forms" || activeView === "detail" || activeView === "closed-leads") ? (
            <SalesManagerView
              managers={managers} allLeads={allLeads} followUps={followUps}
              isLoading={isLoading} adminUser={user} refetch={refetch}
              initialView={activeView} setMainView={setActiveView}
              isDark={isDark} t={t}
            />
          ) : activeView === "assistant" ? (
            <AssistantView
              allLeads={user.role === "admin" ? allLeads : allLeads.filter((l: any) => l.assigned_to === user.name)}
              isDark={isDark} t={t}
            />
          ) : activeView === "attendance" ? (
            <AttendanceView
              adminUser={user}
              isDark={isDark}
              t={t}
              now={now}
            />
          ) : activeView === "settings" ? (
            <SettingsView
              adminUser={user}
              isDark={isDark}
              t={t}
              onSaved={(number: string) => setUser(prev => ({ ...prev, whatsapp_number: number }))}
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
function DashboardAnalytics({ leads, isDark, t }: { leads: any[]; isDark: boolean; t: ReturnType<typeof buildTheme> }) {
  const [pieMode, setPieMode] = useState<"interest" | "loan" | "usetype" | "loanrequired" | "visits">("interest");
  const [barMode, setBarMode] = useState<"weekly" | "source">("weekly");

  const interestData = useMemo(() => { const c: Record<string, number> = { Interested: 0, "Not Interested": 0, "NON GENUINE DEMAND (NGD)": 0, Pending: 0 }; leads.forEach(l => { const s = l.leadInterestStatus; if (s === "NON GENUINE DEMAND (NGD)" || s === "Non Qualified Lead" || s === "Non Qualified Leads" || s === "Non qualified Lead") c["NON GENUINE DEMAND (NGD)"]++; else if (s && s !== "Pending" && c[s] !== undefined) c[s]++; else c["Pending"]++; }); return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })); }, [leads]);
  const loanPieData = useMemo(() => { const c: Record<string, number> = { Approved: 0, "In Progress": 0, Rejected: 0, "N/A": 0 }; leads.forEach(l => { const s = l.loanStatus; if (s && c[s] !== undefined) c[s]++; else c["N/A"]++; }); return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })); }, [leads]);
  const useTypeData = useMemo(() => { const c: Record<string, number> = {}; leads.forEach(l => { const ut = (l.useType && l.useType !== "Pending") ? l.useType : (l.purpose || "Unknown"); c[ut] = (c[ut] || 0) + 1; }); return Object.entries(c).filter(([k]) => k !== "Unknown").map(([name, value]) => ({ name, value })); }, [leads]);
  const loanRequiredData = useMemo(() => { const c: Record<string, number> = { Yes: 0, No: 0, "Not Sure": 0, Pending: 0 }; leads.forEach(l => { const lp = l.loanPlanned; if (lp && c[lp] !== undefined) c[lp]++; else c["Pending"]++; }); return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })); }, [leads]);
  const visitData = useMemo(() => { const s = leads.filter(l => l.mongoVisitDate).length; return [{ name: "Scheduled", value: s }, { name: "Pending", value: leads.length - s }]; }, [leads]);
  const weeklyData = useMemo(() => { const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; const counts = [0, 0, 0, 0, 0, 0, 0]; const now = new Date(); leads.forEach(l => { if (!l.created_at) return; const d = new Date(l.created_at); if (Math.floor((now.getTime() - d.getTime()) / 86400000) < 7) counts[d.getDay()]++; }); return days.map((day, i) => ({ day, leads: counts[i] })); }, [leads]);
  const sourceData = useMemo(() => { const c: Record<string, number> = {}; leads.forEach(l => { const src = l.source || "Unknown"; c[src] = (c[src] || 0) + 1; }); return Object.entries(c).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 6); }, [leads]);
  const weeklyTotal = weeklyData.reduce((a, b) => a + b.leads, 0);

  const interestColors: Record<string, string> = { Interested: "#4ade80", "Not Interested": "#f87171", "NON GENUINE DEMAND (NGD)": "#F97316", "Non Qualified Lead": "#F97316", Pending: "#6b7280" };
  const loanColors: Record<string, string> = { Approved: "#4ade80", "In Progress": "#fbbf24", Rejected: "#f87171", "N/A": "#6b7280" };
  const useTypeColors: Record<string, string> = { "Self Use": "#818cf8", Investment: "#34d399", "Personal use": "#f87171", "N/A": "#6b7280" };
  const loanReqColors: Record<string, string> = { Yes: "#60a5fa", No: "#6b7280", "Not Sure": "#fbbf24", Pending: "#374151" };
  const visitColors: Record<string, string> = { Scheduled: "#f97316", Pending: "#374151" };
  const BAR_COLORS = isDark
    ? ["#a855f7", "#818cf8", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#c084fc"]
    : ["#00AEEF", "#9E217B", "#0077b6", "#34d399", "#fbbf24", "#f87171", "#60a5fa"];
  const SRC_COLORS = isDark
    ? ["#a855f7", "#60a5fa", "#4ade80", "#fbbf24", "#f87171", "#34d399"]
    : ["#00AEEF", "#9E217B", "#0077b6", "#4ade80", "#fbbf24", "#f87171"];

  const pieData = pieMode === "interest" ? interestData : pieMode === "loan" ? loanPieData : pieMode === "usetype" ? useTypeData : pieMode === "loanrequired" ? loanRequiredData : visitData;
  const pieColors = pieMode === "interest" ? interestColors : pieMode === "loan" ? loanColors : pieMode === "usetype" ? useTypeColors : pieMode === "loanrequired" ? loanReqColors : visitColors;
  const totalLeads = leads.length;

  const BarTip = ({ active, payload, label }: any) => active && payload?.length
    ? <div className={`rounded-lg px-3 py-2 text-xs shadow-xl border ${t.dropdown}`} style={t.dropdownGlass}><p className={t.textMuted}>{label || payload[0].name}</p><p className={`font-bold ${t.text}`}>{payload[0].value}</p></div>
    : null;
  const PieTip = ({ active, payload }: any) => active && payload?.length
    ? <div className={`rounded-lg px-3 py-2 text-xs shadow-xl border ${t.dropdown}`} style={t.dropdownGlass}><p className={`font-bold ${t.text}`}>{payload[0].name}</p><p className={t.textMuted}>{payload[0].value} leads</p></div>
    : null;

  const axisColor = isDark ? "#9ca3af" : "#6B7280";
  const gridColor = isDark ? "#2a2a2a" : "#E5E7EB";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Bar chart */}
        <div className={`rounded-2xl p-4 sm:p-5 shadow-sm border ${t.tableWrap}`} style={t.tableGlass}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className={`font-bold text-sm lg:text-base ${t.text}`}>{barMode === "weekly" ? "Leads This Week" : "Lead Source Distribution"}</h3>
              {barMode === "weekly" && <p className={`text-xs mt-0.5 font-semibold ${t.accentText}`}>{weeklyTotal} total this week</p>}
            </div>
            <select value={barMode} onChange={e => setBarMode(e.target.value as any)} className={`rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer border w-full sm:w-auto ${t.selectSmall}`}>
              <option value="weekly">Total Leads Assigned</option>
              <option value="source">Lead Source Distribution</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            {barMode === "weekly" ? (
              <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="day" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RTooltip content={<BarTip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="leads" radius={[6, 6, 0, 0]}>{weeklyData.map((_: any, i: number) => <Cell key={i} fill={BAR_COLORS[i % 7]} />)}</Bar>
              </BarChart>
            ) : (
              <BarChart data={sourceData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="source" width={100} tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                <RTooltip content={<BarTip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>{sourceData.map((_: any, i: number) => <Cell key={i} fill={SRC_COLORS[i % 6]} />)}</Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div className={`rounded-2xl p-4 sm:p-5 shadow-sm border ${t.tableWrap}`} style={t.tableGlass}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <h3 className={`font-bold text-sm lg:text-base ${t.text}`}>
              {pieMode === "interest" ? "Lead Interest Breakdown" : pieMode === "loan" ? "Loan Status Breakdown" : pieMode === "usetype" ? "Self-Use vs Investment" : pieMode === "loanrequired" ? "Loan Required?" : "Visit Scheduled vs Pending"}
            </h3>
            <select value={pieMode} onChange={e => setPieMode(e.target.value as any)} className={`rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer border w-full sm:w-auto ${t.selectSmall}`}>
              <option value="interest">Lead Interest</option>
              <option value="loan">Loan Status</option>
              <option value="usetype">Self-Use vs Investment</option>
              <option value="loanrequired">Loan Required?</option>
              <option value="visits">Visit Scheduled vs Pending</option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={200} className="sm:w-[55%]">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {pieData.map((entry: any, i: number) => <Cell key={i} fill={pieColors[entry.name] ?? "#6b7280"} />)}
                </Pie>
                <RTooltip content={<PieTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 w-full sm:w-[45%] flex-1">
              {pieData.map((entry: any) => {
                const color = pieColors[entry.name] ?? "#6b7280";
                const pct = totalLeads > 0 ? Math.round((entry.value / totalLeads) * 100) : 0;
                return (
                  <div key={entry.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} /><span className={`text-[11px] sm:text-xs font-medium ${t.textMuted}`}>{entry.name}</span></div>
                    <div className="flex items-center gap-1.5"><span className={`text-[11px] sm:text-xs font-bold ${t.text}`}>{entry.value}</span><span className={`text-[10px] ${t.textFaint}`}>({pct}%)</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SALES MANAGER MODULE
// ============================================================================
function SalesManagerView({ managers, allLeads, followUps, isLoading, adminUser, refetch, initialView, setMainView, isDark, t }: any) {
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
  const [showSalesForm, setShowSalesForm] = useState(false);
  const [salesForm, setSalesForm] = useState({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanForm, setLoanForm] = useState({ loanRequired: "", status: "", bank: "", amountReq: "", amountApp: "", cibil: "", agent: "", agentContact: "", empType: "", income: "", emi: "", docPan: "Pending", docAadhaar: "Pending", docSalary: "Pending", docBank: "Pending", docProperty: "Pending", notes: "" });
  const [customNote, setCustomNote] = useState("");
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState("");
  const [isSavingLost, setIsSavingLost] = useState(false);

  // ── WhatsApp States ──
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [callHidden, setCallHidden] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [isSendingWa, setIsSendingWa] = useState(false);
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const [toastMsg, setToastMsg] = useState<{ title: string; icon: any; color: string } | null>(null);

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const selectedYear = new Date().getFullYear();

  const [cardsPage, setCardsPage] = useState(1);
  const cardsSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSubView(initialView === "overview" ? "overview" : initialView === "detail" && selectedLead ? "detail" : initialView === "closed-leads" ? "closed-leads" : "cards"); }, [initialView]);
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

  const baseManagerLeads = adminUser.role === "admin" ? allLeads : allLeads.filter((l: any) => l.assigned_to === adminUser.name);
  const currentLeadFollowUps = followUps.filter((f: any) => String(f.leadId) === String(selectedLead?.id));

  const pipelineManagerLeads = baseManagerLeads.filter((l: any) => l.status !== "Closing" && !l.closingDate);
  const lostManagerLeads = pipelineManagerLeads.filter((l: any) => !!l.is_lost_lead);
  const activeManagerLeads = pipelineManagerLeads.filter((l: any) => !l.is_lost_lead);
  const closingLeads = baseManagerLeads.filter((l: any) => l.status === "Closing" || !!l.closingDate);
  const lostRatio = baseManagerLeads.length > 0 ? ((lostManagerLeads.length / baseManagerLeads.length) * 100).toFixed(1) : "0.0";

  const enquiriesAttended = useMemo(() =>
    baseManagerLeads.filter((l: any) => followUps.some((f: any) => String(f.leadId) === String(l.id))).length
    , [baseManagerLeads, followUps]);

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

  const passLostFilter = (lead: any) => {
    let passNGD = true;
    const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "Non Qualified Lead" || lead.leadInterestStatus === "Non Qualified Leads" || lead.leadInterestStatus === "Non qualified Lead";
    if (!showNGDLeads && isNGD) {
      passNGD = false;
    }
    if (!passNGD) return false;

    if (leadStatusFilter === "lost") return !!lead.is_lost_lead;
    if (leadStatusFilter === "active") return !lead.is_lost_lead;
    return showLostLeads || !lead.is_lost_lead;
  };

  const filteredLeads = useMemo(() => {
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
  const filteredDatabaseLeads = useMemo(() => {
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

  const getLatestLoanDetails = () => {
    if (!selectedLead) return null;
    let ex: Record<string, any> = { loanRequired: selectedLead.loanPlanned || "N/A", status: "Pending", bankName: "N/A", amountReq: "N/A", amountApp: "N/A", cibil: "N/A", agent: "N/A", agentContact: "N/A", empType: "N/A", income: "N/A", emi: "N/A", docPan: "Pending", docAadhaar: "Pending", docSalary: "Pending", docBank: "Pending", docProperty: "Pending", notes: "N/A" };
    const lu = currentLeadFollowUps.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
    if (lu.length > 0) { const msg = lu[lu.length - 1].message; const g = (l: string) => { const m = msg.match(new RegExp(`• ${l}: (.*)`)); return m ? m[1].trim() : "N/A"; }; ex = { loanRequired: g("Loan Required"), status: g("Status"), bankName: g("Bank Name"), amountReq: g("Amount Requested"), amountApp: g("Amount Approved"), cibil: g("CIBIL Score"), agent: g("Agent Name"), agentContact: g("Agent Contact"), empType: g("Employment Type"), income: g("Monthly Income"), emi: g("Existing EMIs"), docPan: g("PAN Card"), docAadhaar: g("Aadhaar Card"), docSalary: g("Salary Slips"), docBank: g("Bank Statements"), docProperty: g("Property Docs"), notes: g("Notes") }; }
    return ex;
  };
  const getLoanStatusColor = (s: string) => { const sl = (s || "").toLowerCase(); if (sl === "approved") return isDark ? "bg-green-900/20 text-green-400 border-green-500/30" : "bg-green-50 text-green-700 border-green-300"; if (sl === "rejected") return isDark ? "bg-red-900/20 text-red-400 border-red-500/30" : "bg-red-50 text-red-700 border-red-300"; if (sl === "in progress") return isDark ? "bg-yellow-900/20 text-yellow-400 border-yellow-500/30" : "bg-yellow-50 text-yellow-700 border-yellow-300"; return isDark ? "bg-gray-900/20 text-gray-400 border-gray-500/30" : "bg-gray-50 text-gray-600 border-gray-300"; };
  const formatDate = (ds: string) => { if (!ds || ds === "Pending" || ds === "N/A") return "-"; try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ds; } };
  const maskPhone = (phone: any) => { if (!phone || phone === "N/A") return "N/A"; const c = String(phone).replace(/[^a-zA-Z0-9]/g, ""); if (c.length <= 5) return c; return `${c.slice(0, 2)}*****${c.slice(-3)}`; };

  const handleMarkAsClosing = async () => {
    if (!selectedLead || selectedLead.status === "Closing") return;
    const closingNote = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: adminUser.role === "admin" ? "admin" : "sales", message: `✅ Lead Marked as Closing by ${adminUser.name}`, siteVisitDate: null, createdAt: new Date().toISOString() };
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(closingNote) });
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Closing" }) });
      setToastMsg({ title: `🎉 ${selectedLead.name} marked as Closing!`, icon: <FaHandshake />, color: "green" });
      setTimeout(() => setToastMsg(null), 3500);
      refetch();
    } catch (e) { console.error("[Mark Closing]", e); }
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

  const handleSendCustomNote = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!customNote.trim() || !selectedLead) return; const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: adminUser.role === "admin" ? "admin" : "sales", message: customNote, siteVisitDate: null, createdAt: new Date().toISOString() }; setCustomNote(""); try { await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }); refetch(); } catch (e) { console.log(e); } };
  const handleSalesFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;

    const msg =
      "📝 Detailed Salesform Submitted:\n" +
      "• Property Type: " + (salesForm.propertyType || "N/A") + "\n" +
      "• Location: " + (salesForm.location || "N/A") + "\n" +
      "• Budget: " + (salesForm.budget || "N/A") + "\n" +
      "• Use Type: " + (salesForm.useType || "N/A") + "\n" +
      "• Planning to Purchase: " + (salesForm.purchaseDate || "N/A") + "\n" +
      "• Loan Planned: " + (salesForm.loanPlanned || "N/A") + "\n" +
      "• Lead Status: " + (salesForm.leadStatus || "N/A") + "\n" +
      "• Site Visit Requested: " +
      (salesForm.siteVisit ? formatDate(salesForm.siteVisit) : "No");

    const nm = {
      leadId: String(selectedLead.id),
      salesManagerName: adminUser.name,
      createdBy: adminUser.role === "admin" ? "admin" : "sales",
      message: msg,
      siteVisitDate: salesForm.siteVisit || null,
      createdAt: new Date().toISOString(),
    };

    const ns = salesForm.siteVisit ? "Visit Scheduled" : selectedLead.status;

    try {
      // 1️⃣ Save follow-up
      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nm),
      });

      // 2️⃣ Update lead status
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedLead.name,
          status: ns,
        }),
      });

      // ✅ 3️⃣ NEW: Save into site_visits table (IMPORTANT)
      if (salesForm.siteVisit) {
        await fetch("/api/site-visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_id: selectedLead.id,
            visit_date: salesForm.siteVisit,
            created_by: adminUser.name, // (can switch to id later)
            role: adminUser.role,
            notes: "Scheduled via Salesform",
          }),
        }).catch(() => { }); // don't break flow if it fails
      }

      // 4️⃣ Reset UI (after everything succeeds)
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

    } catch (e) {
      console.log(e);
    }
  };
  const handleLoanFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!selectedLead) return; const msg = "🏦 Loan Update:\n• Loan Required: " + (loanForm.loanRequired || "N/A") + "\n• Status: " + (loanForm.status || "N/A") + "\n• Bank Name: " + (loanForm.bank || "N/A") + "\n• Amount Requested: " + (loanForm.amountReq || "N/A") + "\n• Amount Approved: " + (loanForm.amountApp || "N/A") + "\n• CIBIL Score: " + (loanForm.cibil || "N/A") + "\n• Agent Name: " + (loanForm.agent || "N/A") + "\n• Agent Contact: " + (loanForm.agentContact || "N/A") + "\n• Employment Type: " + (loanForm.empType || "N/A") + "\n• Monthly Income: " + (loanForm.income || "N/A") + "\n• Existing EMIs: " + (loanForm.emi || "N/A") + "\n• PAN Card: " + (loanForm.docPan || "Pending") + "\n• Aadhaar Card: " + (loanForm.docAadhaar || "Pending") + "\n• Salary Slips: " + (loanForm.docSalary || "Pending") + "\n• Bank Statements: " + (loanForm.docBank || "Pending") + "\n• Property Docs: " + (loanForm.docProperty || "Pending") + "\n• Notes: " + (loanForm.notes || "N/A"); const nm = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, createdBy: adminUser.role === "admin" ? "admin" : "sales", message: msg, siteVisitDate: null, createdAt: new Date().toISOString() }; const dbp = { leadId: String(selectedLead.id), salesManagerName: adminUser.name, ...loanForm }; setShowLoanForm(false); setToastMsg({ title: `Loan Data Logged for ${selectedLead.name}`, icon: <FaCheckCircle />, color: "blue" }); setTimeout(() => setToastMsg(null), 3000); try { await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }); await fetch("/api/loan/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dbp) }).catch(() => { }); refetch(); } catch (e) { console.log(e); } };
  const prefillSalesForm = () => { if (!selectedLead) return; const sf = currentLeadFollowUps.filter((f: any) => f.message?.includes("Detailed Salesform Submitted")); if (sf.length === 0) return; const msg = sf[sf.length - 1].message; const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; }; setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" }); };
  const prefillLoanForm = () => { const cur = getLatestLoanDetails(); if (!cur) return; setLoanForm({ loanRequired: cur.loanRequired !== "N/A" ? cur.loanRequired : "", status: cur.status !== "Pending" ? cur.status : "", bank: cur.bankName !== "N/A" ? cur.bankName : "", amountReq: cur.amountReq !== "N/A" ? cur.amountReq : "", amountApp: cur.amountApp !== "N/A" ? cur.amountApp : "", cibil: cur.cibil !== "N/A" ? cur.cibil : "", agent: cur.agent !== "N/A" ? cur.agent : "", agentContact: cur.agentContact !== "N/A" ? cur.agentContact : "", empType: cur.empType !== "N/A" ? cur.empType : "", income: cur.income !== "N/A" ? cur.income : "", emi: cur.emi !== "N/A" ? cur.emi : "", docPan: cur.docPan !== "N/A" ? cur.docPan : "Pending", docAadhaar: cur.docAadhaar !== "N/A" ? cur.docAadhaar : "Pending", docSalary: cur.docSalary !== "N/A" ? cur.docSalary : "Pending", docBank: cur.docBank !== "N/A" ? cur.docBank : "Pending", docProperty: cur.docProperty !== "N/A" ? cur.docProperty : "Pending", notes: cur.notes !== "N/A" ? cur.notes : "" }); };


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
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-4 sm:px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 sm:gap-4 animate-fadeIn border ${toastMsg.color === "green"
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
          <div className="animate-fadeIn space-y-6 sm:space-y-8">
            <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4">
              <h1 className={`text-xl sm:text-2xl md:text-3xl font-bold flex items-center flex-wrap gap-2 sm:gap-3 ${t.text}`}>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 sm:gap-6">
              {[
                { label: "Total Enquiries", value: baseManagerLeads.length, sub: `${activeManagerLeads.length} active`, glow: t.statGlow1, textColor: t.text },
                { label: "Enquiries Attended", value: enquiriesAttended, sub: `of ${activeManagerLeads.length} total`, glow: t.statGlow1, textColor: isDark ? "text-purple-400" : "text-[#00AEEF]" },
                { label: "Enquiries Attended This Month", value: enquiriesThisMonth, sub: `in ${MONTH_NAMES[selectedMonth].slice(0, 3)}`, glow: t.statGlow3, textColor: isDark ? "text-blue-400" : "text-[#9E217B]", monthSelect: true },
                { label: "Closing", value: closingThisMonth > 0 ? closingThisMonth : "—", sub: `${closingLeads.length} total closed`, glow: t.statGlow4, textColor: isDark ? "text-yellow-400" : "text-amber-500", monthSelect: true },
                { label: "Closing Rate", value: `${closingPct}%`, sub: `${closingLeads.length} of ${activeManagerLeads.length} leads`, glow: t.statGlow5, textColor: isDark ? "text-green-400" : "text-emerald-600" },
                { label: "Lost Leads", value: lostManagerLeads.length, sub: `${lostRatio}% lost ratio`, glow: "bg-red-500/10", textColor: isDark ? "text-red-300" : "text-red-600" },
              ].map((stat, i) => (
                <div key={i} className={`rounded-2xl p-4 sm:p-5 shadow-sm border relative overflow-hidden transition-all flex flex-col justify-between ${t.card}`} style={t.cardGlass}>
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
                    <p className={`text-2xl sm:text-3xl font-black ${stat.textColor}`}>{isLoading ? "…" : stat.value}</p>
                    <p className={`text-[10px] mt-1 ${t.textFaint}`}>{stat.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {!isLoading && <DashboardAnalytics leads={baseManagerLeads} isDark={isDark} t={t} />}

            {/* Overview table */}
            <div className={`rounded-2xl border shadow-sm overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
              <div className={`p-4 sm:p-5 border-b flex flex-col gap-3 ${t.tableBorder} ${t.modalHeader}`}>
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
                      {["LEAD NO.", "NAME", "PROP. TYPE", "BUDGET", "STATUS", "LOST STATUS", "LOAN STATUS", "AMT REQ / APP", "SITE VISIT"].map(h => (
                        <th key={h} className={`px-4 sm:px-6 py-3 sm:py-4 font-bold tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${t.tableDivide}`}>
                    {isLoading
                      ? <tr><td colSpan={9} className={`text-center py-8 ${t.textMuted}`}>Loading...</td></tr>
                      : filteredDatabaseLeads.length === 0
                        ? <tr><td colSpan={9} className={`text-center py-8 ${t.textMuted}`}>No leads found.</td></tr>
                        : filteredDatabaseLeads.map((lead: any) => {
                          const isClosed = lead.status === "Closing" || lead.status === "Completed" || lead.status === "Closed" || lead.closingDate;
                          const isLost = !!lead.is_lost_lead;
                          const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                          return (
                            <tr key={lead.id} className={`transition-colors cursor-pointer ${isLost ? t.rowLost : isNGD ? t.rowNGD : t.tableRow}`} onClick={() => { setSelectedLead(lead); setMainView("detail"); setSubView("detail"); }}>
                              <td className={`px-4 sm:px-6 py-3 sm:py-4 font-bold ${t.accentText}`}>#{lead.id}</td>
                              <td className={`px-4 py-3 sm:py-4 font-medium ${t.text}`}>{lead.name}</td>
                              <td className={`px-4 py-3 sm:py-4 ${t.textMuted}`}>{lead.propType || "Pending"}</td>
                              <td className={`px-4 py-3 sm:py-4 font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget}</td>
                              <td className="px-4 py-3 sm:py-4">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border ${isLost
                                  ? t.statusLost
                                  : isNGD
                                    ? t.statusNGD
                                    : isClosed
                                      ? (isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-600 border-emerald-400/40 bg-emerald-50")
                                      : lead.status === "Visit Scheduled" ? t.statusVisit : t.statusRouted
                                  }`}>{isLost ? "LOST" : isNGD ? "NGD" : isClosed ? "CLOSED" : (lead.status || "ROUTED")}</span>
                              </td>
                              <td className="px-4 py-3 sm:py-4">
                                {isLost ? (
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border inline-flex items-center gap-1 ${t.statusLost}`}>
                                    <Ghost className="w-3 h-3" /> Lost Lead
                                  </span>
                                ) : <span className={`text-xs font-semibold ${t.textMuted}`}>Active</span>}
                              </td>
                              <td className="px-4 py-3 sm:py-4">
                                {lead.loanStatus && lead.loanStatus !== "N/A"
                                  ? <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${lead.loanStatus === "Approved" ? "text-green-400 border-green-500/40 bg-green-500/10" : lead.loanStatus === "Rejected" ? "text-red-400 border-red-500/40 bg-red-500/10" : lead.loanStatus === "In Progress" ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-gray-400 border-gray-500/30 bg-gray-500/10"}`}>{lead.loanStatus}</span>
                                  : <span className={`text-xs italic ${t.textFaint}`}>N/A</span>
                                }
                              </td>
                              <td className="px-4 py-3 sm:py-4">
                                {lead.loanAmtReq && lead.loanAmtReq !== "N/A"
                                  ? <div className="flex flex-col gap-0.5"><span className="text-[10px] sm:text-[11px] text-orange-400 font-medium">Req: {lead.loanAmtReq}</span><span className={`text-[10px] sm:text-[11px] font-medium ${isDark ? "text-green-400" : "text-emerald-600"}`}>App: {lead.loanAmtApp !== "N/A" ? lead.loanAmtApp : "—"}</span></div>
                                  : <span className={`text-xs italic ${t.textFaint}`}>N/A</span>
                                }
                              </td>
                              <td className="px-4 sm:px-6 py-3 sm:py-4">{lead.mongoVisitDate ? <span className="text-orange-400 font-medium whitespace-nowrap text-xs sm:text-sm">{formatDate(lead.mongoVisitDate).split(",")[0]}</span> : <span className={`text-xs italic ${t.textFaint}`}>Pending</span>}</td>
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
            <div className={`rounded-2xl border p-4 mb-6 ${t.tableWrap}`} style={t.tableGlass}>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                    {paginatedLeads.map((lead: any) => {
                      const interest = lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" ? lead.leadInterestStatus : null;
                      const loanSt = lead.loanStatus && lead.loanStatus !== "N/A" ? lead.loanStatus : null;
                      const isClosing = lead.status === "Closing";
                      const isLost = !!lead.is_lost_lead;
                      const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                      return (
                        <div
                          key={lead.id}
                          className={`rounded-2xl p-4 sm:p-5 border shadow-sm transition-all group flex flex-col justify-between cursor-pointer h-full ${isLost ? t.cardLost : isClosing ? t.cardClosing : isNGD ? t.cardNGD : t.card}`}
                          style={t.cardGlass}
                          onClick={() => { setSelectedLead(lead); setMainView("detail"); setSubView("detail"); }}
                        >
                          <div>
                            <div className={`flex flex-col sm:flex-row sm:justify-between items-start mb-4 pb-3 sm:mb-5 sm:pb-4 border-b gap-2 ${t.tableBorder}`}>
                              <h3 className={`text-lg sm:text-xl font-bold transition-colors line-clamp-2 pr-2 ${t.text} ${isClosing ? "group-hover:text-amber-500" : isDark ? "group-hover:text-[#d946a8]" : "group-hover:text-[#9E217B]"}`}>
                                <span className={`mr-2 ${t.accentText}`}>#{lead.id}</span>{lead.name}
                              </h3>
                              <span className={`px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 whitespace-nowrap ${isLost ? t.statusLost :
                                isNGD ? t.statusNGD :
                                  isClosing ? t.statusClosing :
                                    lead.status === "Visit Scheduled" ? t.statusVisit : t.statusRouted
                                }`}>{isLost ? "LOST LEAD" : isNGD ? "NGD" : isClosing ? "CLOSING" : (lead.status || "ROUTED")}</span>
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
                              {lead.propType && lead.propType !== "Pending" && (
                                <div>
                                  <p className={`text-xs font-medium ${t.textFaint}`}>Property</p>
                                  <p className={`text-sm font-medium ${t.text}`}>{lead.propType}</p>
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
                            <p className={`text-[9px] sm:text-[10px] flex-shrink-0 ${t.textFaint}`}>{formatDate(lead.created_at).split(",")[0]}</p>
                            <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-colors ${isClosing ? (isDark ? "text-yellow-500 group-hover:text-yellow-400" : "text-amber-500 group-hover:text-amber-400") : (isDark ? "text-gray-500 group-hover:text-[#d946a8]" : "text-[#9CA3AF] group-hover:text-[#9E217B]")}`}>Details →</span>
                          </div>
                        </div>
                      );
                    })}
                    {hasMoreCards && <CardsLoader />}
                    {!hasMoreCards && filteredLeads.length > 0 && (
                      <div className="col-span-full">
                        <p className={`text-center text-xs py-4 ${t.textFaint}`}>All {filteredLeads.length} leads loaded</p>
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
            <div className={`flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6 sm:mb-8 border-b pb-4 sm:pb-6 ${t.tableBorder}`}>
              <div>
                <h1 className={`text-xl sm:text-2xl font-bold ${t.text}`}>Closed Leads</h1>
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

            <div className={`rounded-2xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
              <div className={`p-4 border-b flex justify-between items-center ${t.tableBorder}`}>
                <p className={`text-sm font-semibold ${t.text}`}>{filteredClosedLeads.length} closed leads</p>
              </div>
              <div className="overflow-x-auto w-full custom-scrollbar">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead><tr className={t.tableHead}>
                    {["Lead No.", "Client Name", "Budget", "Property", "Status", "Site Visit", "Closing Date", "Actions"].map(h => (
                      <th key={h} className={`px-4 sm:px-6 py-3 sm:py-4 font-bold uppercase tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
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
                        <tr key={lead.id} className={`transition-colors cursor-pointer ${t.tableRow}`} onClick={() => { setSelectedLead(lead); setMainView("detail"); setSubView("detail"); }}>
                          <td className={`px-4 sm:px-6 py-3 sm:py-4 font-bold ${t.accentText}`}>#{lead.id}</td>
                          <td className={`px-4 py-3 sm:py-4 font-semibold ${t.text}`}>{lead.name}</td>
                          <td className={`px-4 py-3 sm:py-4 font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</td>
                          <td className={`px-4 py-3 sm:py-4 ${t.textMuted}`}>{lead.propType || lead.configuration || "N/A"}</td>
                          <td className="px-4 py-3 sm:py-4">
                            <span className={`px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border ${t.statusClosing}`}>{lead.status}</span>
                          </td>
                          <td className={`px-4 py-3 sm:py-4 text-[10px] sm:text-xs ${lead.mongoVisitDate ? "text-orange-400" : t.textFaint}`}>
                            {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : "—"}
                          </td>
                          <td className={`px-4 py-3 sm:py-4 text-[10px] sm:text-xs ${t.textFaint}`}>
                            {lead.closingDate ? formatDate(lead.closingDate).split(",")[0] : "—"}
                          </td>
                          <td className="px-4 py-3 sm:py-4">
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
          <div className="animate-fadeIn w-full flex flex-col gap-4 pb-4">
            {/* Detail header */}
            <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border p-4 shadow-sm flex-shrink-0 ${selectedLead.is_lost_lead ? t.cardLost : t.card}`} style={t.cardGlass}>
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <button onClick={() => { setMainView("forms"); setSubView("cards"); }} className={`w-9 h-9 sm:w-10 sm:h-10 flex flex-shrink-0 items-center justify-center border rounded-xl transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}><FaChevronLeft className="text-sm" /></button>
                <h1 className={`text-lg sm:text-xl md:text-2xl font-bold flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 ${t.text}`}>
                  <span className={t.accentText}>#{selectedLead.id}</span>
                  <span className="truncate max-w-[200px] sm:max-w-none">{selectedLead.name}</span>
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
                  {callHidden && (
                    <OnCallBadge
                      leadName={selectedLead.name}
                      onClick={() => { setCallHidden(false); setCallOpen(true); }}
                    />
                  )}
                </h1>
              </div>
              <div className="flex gap-2 sm:gap-3 flex-wrap justify-start md:justify-end flex-shrink-0">
                {!showSalesForm && !showLoanForm && (
                  <>
                    <button onClick={() => { prefillSalesForm(); setShowSalesForm(true); setShowLoanForm(false); emitActivity({ type: 'LEAD_INTERACTION', action: 'Editing Closing Form', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Sales Form' }); }}
                      className={`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center ${t.btnPrimary} ${isDark ? "shadow-purple-600/20" : "shadow-[#00AEEF]/20"}`}>
                      <FaFileInvoice /> <span className="hidden sm:inline">Fill</span> Salesform
                    </button>
                    <button onClick={() => { prefillLoanForm(); setShowLoanForm(true); setShowSalesForm(false); emitActivity({ type: 'LEAD_INTERACTION', action: 'Editing Loan Form', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Loan Form' }); }}
                      className={`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center ${t.btnSecondary} ${isDark ? "shadow-blue-600/20" : "shadow-[#00AEEF]/20"}`}>
                      <FaUniversity /> <span className="hidden sm:inline">Track</span> Loan
                    </button>
                    {!selectedLead.is_lost_lead && (
                      <button onClick={openLostLeadModal} className={`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center ${t.btnDanger}`}>
                        <AlertTriangle className="w-4 h-4" /> Mark <span className="hidden sm:inline">as</span> Lost Lead
                      </button>
                    )}
                    {selectedLead.is_lost_lead && (
                      <button onClick={handleRestoreLead} disabled={isSavingLost} className={`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center ${t.btnPrimary} disabled:opacity-60`}>
                        <FaCheckCircle className="text-xs" /> Restore Lead
                      </button>
                    )}
                    {selectedLead.mongoVisitDate && selectedLead.status !== "Closing" && !selectedLead.is_lost_lead && (
                      <button onClick={() => setIsClosingModalOpen(true)} className={`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center ${t.btnWarning} shadow-amber-600/20`}>
                        <FaHandshake /> Mark <span className="hidden sm:inline">as</span> Closing
                      </button>
                    )}
                    {selectedLead.status === "Closing" && (
                      <div className={`font-bold px-4 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 flex-1 sm:flex-none justify-center ${t.btnClosingBadge}`}>
                        <FaCheckCircle className="text-xs" /> Marked as Closing
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* TWO-COLUMN BODY */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 items-start">

              {/* LEFT PANEL */}
              <div className="flex flex-col gap-3">
                {showSalesForm ? (
                  <div className={`rounded-xl border p-4 sm:p-5 shadow-xl overflow-y-auto custom-scrollbar flex flex-col max-h-[80vh] lg:max-h-[calc(100vh-260px)] ${t.modalCard}`} style={t.modalGlass}>
                    <div className={`flex justify-between items-center mb-4 border-b pb-3 ${t.tableBorder}`}>
                      <div>
                        <h3 className={`text-base sm:text-lg font-bold ${t.text}`}>Sales Data Form</h3>
                        <p className={`text-xs mt-0.5 ${t.accentText}`}>For Lead #{selectedLead.id}</p>
                      </div>
                      <button type="button" onClick={() => setShowSalesForm(false)} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
                    </div>
                    <form onSubmit={handleSalesFormSubmit} className="flex flex-col gap-4 flex-1">
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
                      <button type="submit" className={`mt-auto w-full font-bold py-3 sm:py-3.5 rounded-xl shadow-md transition-colors flex-shrink-0 ${t.btnPrimary}`}>Submit Salesform</button>
                    </form>
                  </div>
                ) : showLoanForm ? (
                  <div className={`rounded-xl border p-4 sm:p-5 shadow-xl overflow-y-auto custom-scrollbar flex flex-col animate-fadeIn max-h-[80vh] lg:max-h-[calc(100vh-260px)] ${t.modalCard}`} style={t.modalGlass}>
                    <div className={`flex justify-between items-center mb-4 border-b pb-3 flex-shrink-0 ${t.tableBorder}`}>
                      <div>
                        <h3 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}><FaUniversity /> Loan Tracking Workflow</h3>
                        <p className={`text-xs mt-0.5 ${t.textFaint}`}>For Lead #{selectedLead.id}</p>
                      </div>
                      <button type="button" onClick={() => setShowLoanForm(false)} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
                    </div>
                    <form onSubmit={handleLoanFormSubmit} className="flex flex-col gap-5 sm:gap-6 flex-1">
                      <div>
                        <h4 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 sm:mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>1. Loan Decision</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Loan Required? *</label><select required value={loanForm.loanRequired} onChange={e => setLoanForm({ ...loanForm, loanRequired: e.target.value })} className={formSelect}><option value="">Select</option><option>Yes</option><option>No</option><option>Not Sure</option></select></div>
                          <div>
                            <label className={`text-xs mb-1 block ${t.textMuted}`}>Loan Status *</label>
                            <select required value={loanForm.status} onChange={e => setLoanForm({ ...loanForm, status: e.target.value })} className={formSelect}><option value="">Select Status</option><option>Approved</option><option>In Progress</option><option>Rejected</option></select>
                            {loanForm.status && (<p className={`text-[10px] mt-1.5 font-semibold ${loanForm.status === "Approved" ? "text-green-400" : loanForm.status === "Rejected" ? "text-red-400" : "text-yellow-400"}`}>{loanForm.status === "Approved" && "✅ Loan cleared — schedule closing meeting"}{loanForm.status === "In Progress" && "📄 Follow up on pending documents"}{loanForm.status === "Rejected" && "❌ Loan rejected — suggest co-applicant or other bank"}</p>)}
                          </div>
                        </div>
                      </div>
                      <div className={`border-t pt-3 sm:pt-4 ${t.tableBorder}`}>
                        <h4 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 sm:mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>2. Bank & Loan Details</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[{ label: "Bank Name", k: "bank", ph: "e.g. HDFC" }, { label: "Amount Required", k: "amountReq", ph: "e.g. 60L" }, { label: "Amount Approved", k: "amountApp", ph: "e.g. 55L" }, { label: "CIBIL Score", k: "cibil", ph: "e.g. 750" }, { label: "Agent Name", k: "agent", ph: "Agent Name" }, { label: "Agent Contact", k: "agentContact", ph: "Agent Phone", tel: true }].map(f => (
                            <div key={f.k}><label className={`text-xs mb-1 block ${t.textMuted}`}>{f.label}</label><input type={f.tel ? "tel" : "text"} value={(loanForm as any)[f.k]} onChange={e => setLoanForm({ ...loanForm, [f.k]: e.target.value })} className={formInput} placeholder={f.ph} /></div>
                          ))}
                        </div>
                      </div>
                      <div className={`border-t pt-3 sm:pt-4 ${t.tableBorder}`}>
                        <h4 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 sm:mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>3. Financial Qualification</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Employment</label><select value={loanForm.empType} onChange={e => setLoanForm({ ...loanForm, empType: e.target.value })} className={formSelect}><option value="">Select</option><option>Salaried</option><option>Self-employed</option></select></div>
                          <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Monthly Income</label><input type="text" value={loanForm.income} onChange={e => setLoanForm({ ...loanForm, income: e.target.value })} className={formInput} placeholder="e.g. 1L" /></div>
                          <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Existing EMIs</label><input type="text" value={loanForm.emi} onChange={e => setLoanForm({ ...loanForm, emi: e.target.value })} className={formInput} placeholder="e.g. 15k" /></div>
                        </div>
                      </div>
                      <div className={`border-t pt-3 sm:pt-4 ${t.tableBorder}`}>
                        <h4 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-1 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}><FaFileAlt /> 4. Document Checklist</h4>
                        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border ${t.settingsBg}`} style={t.settingsBgGl}>
                          {["docPan", "docAadhaar", "docSalary", "docBank", "docProperty"].map(docKey => {
                            const label = docKey === "docPan" ? "PAN Card" : docKey === "docAadhaar" ? "Aadhaar Card" : docKey === "docSalary" ? "Salary Slips / ITR" : docKey === "docBank" ? "Bank Statements" : "Property Documents";
                            return (
                              <div key={docKey} className={`flex items-center justify-between border p-2 rounded-lg ${t.innerBlock}`}>
                                <span className={`text-[11px] sm:text-xs font-medium ${t.text}`}>{label}</span>
                                <select value={(loanForm as any)[docKey]} onChange={e => setLoanForm({ ...loanForm, [docKey]: e.target.value })} className={`text-[11px] sm:text-xs font-bold bg-transparent outline-none cursor-pointer ${(loanForm as any)[docKey] === "Uploaded" ? "text-green-400" : "text-gray-500"}`}><option>Pending</option><option>Uploaded</option></select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className={`border-t pt-3 sm:pt-4 ${t.tableBorder}`}>
                        <h4 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 sm:mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>5. Notes / Remarks</h4>
                        <textarea value={loanForm.notes} onChange={e => setLoanForm({ ...loanForm, notes: e.target.value })} className={`w-full rounded-lg px-4 py-2.5 text-sm outline-none resize-none h-20 custom-scrollbar border ${t.inputInner} ${t.text} ${t.inputFocus}`} placeholder="Bank feedback, CIBIL issues, Internal notes..." />
                      </div>
                      <button type="submit" className={`mt-4 flex-shrink-0 w-full font-bold py-3 sm:py-3.5 rounded-xl shadow-md transition-colors cursor-pointer ${t.btnSecondary}`}>Save Loan Tracker Update</button>
                    </form>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 animate-fadeIn">
                    {/* Tab switcher */}
                    <div className={`flex items-center gap-2 border p-1.5 rounded-xl flex-shrink-0 ${t.tableWrap}`}>
                      <button onClick={() => setDetailTab("personal")} className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Personal Info</button>
                      <button onClick={() => setDetailTab("loan")} className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? t.btnSecondary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Loan Tracking</button>
                    </div>

                    <div className={`overflow-y-auto custom-scrollbar rounded-xl p-4 sm:p-6 shadow-lg border max-h-[60vh] lg:max-h-[calc(100vh-380px)] ${t.chatPanel}`} style={t.chatPanelGl}>
                      {detailTab === "personal" ? (
                        <div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 sm:gap-y-4 gap-x-4 text-xs sm:text-sm">
                            {[
                              { label: "Email", val: selectedLead.email !== "N/A" ? selectedLead.email : "Not Provided" },
                              { label: "Phone", val: selectedLead.phone, mono: true },
                              { label: "Alt Phone", val: selectedLead.altPhone && selectedLead.altPhone !== "N/A" ? selectedLead.altPhone : "Not Provided", mono: true },
                            ].map(f => (
                              <div key={f.label}><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>{f.label}</p><p className={`font-semibold ${f.mono ? "font-mono" : ""} break-all ${t.text}`}>{f.val}</p></div>
                            ))}
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Lead Interest</p>{selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} /> : <p className={`font-semibold ${t.text}`}>Pending</p>}</div>
                            <div className="col-span-1 sm:col-span-2"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Loan Status</p>{selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} /></div> : <p className={`font-semibold ${t.text}`}>N/A</p>}</div>
                            <div className="col-span-1 sm:col-span-2"><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Residential Address</p><p className={`font-semibold ${t.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Budget</p><p className={`font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Property Type</p><p className={`font-semibold ${t.text}`}>{selectedLead.propType || "Pending"}</p></div>
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Type of Use</p><p className={`font-semibold ${t.text}`}>{selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Planning to Buy?</p><p className={`font-semibold ${t.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Loan Required?</p><p className={`font-semibold ${t.text}`}>{getLatestLoanDetails()?.loanRequired}</p></div>
                            <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Status</p><span className={`text-xs sm:text-sm font-bold ${selectedLead.status === "Closing" ? "text-amber-500" : selectedLead.status === "Visit Scheduled" ? "text-orange-400" : t.accentText}`}>{selectedLead.status || "Routed"}</span></div>
                            {/* <div className={`col-span-1 sm:col-span-2 p-3 sm:p-4 rounded-xl border ${t.settingsBg}`} style={t.settingsBgGl}>
                              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-0.5 sm:mb-1 ${isDark?"text-[#00AEEF]":"text-[#00AEEF]"}`}>📍 Site Visit Date</p>
                              <p className={`text-sm sm:text-base font-black ${t.text}`}>{selectedLead.mongoVisitDate?formatDate(selectedLead.mongoVisitDate):"Not Scheduled"}</p>
                            </div> */}
                          </div>
                          {selectedLead.is_lost_lead && (
                            <div className={`mt-4 border rounded-xl p-3 sm:p-4 ${t.statusLost}`}>
                              <h3 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Ghost className="w-3.5 h-3.5" /> Lost Lead Record
                              </h3>
                              <p className={`text-xs sm:text-sm leading-relaxed ${t.textMuted}`}>{selectedLead.lost_lead_reason || "No reason recorded."}</p>
                              <p className={`text-[10px] mt-2 ${t.textFaint}`}>
                                Marked by {selectedLead.lost_lead_marked_by || "Unknown"} on {selectedLead.lost_lead_marked_at ? formatDate(selectedLead.lost_lead_marked_at) : "-"}
                              </p>
                            </div>
                          )}
                          <div className={`mt-4 border rounded-xl p-3 sm:p-4 ${t.settingsBg}`} style={t.settingsBgGl}>
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
                        <div>
                          {(() => {
                            const curLoan: any = getLatestLoanDetails() || {};
                            const sColor = getLoanStatusColor(curLoan?.status || "");
                            const isHighProb = curLoan?.status?.toLowerCase() === "approved" && selectedLead.mongoVisitDate;
                            return (
                              <>
                                <h3 className={`text-xs sm:text-sm font-bold border-b pb-2 mb-4 sm:mb-6 uppercase flex items-center justify-between ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"} ${t.tableBorder}`}><span className="flex items-center gap-2"><FaUniversity /> Deal Loan Overview</span></h3>
                                {isHighProb && <div className="mb-4 sm:mb-6 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/50 p-2 sm:p-3 rounded-lg flex items-center justify-center gap-2 text-orange-400 text-xs sm:text-sm font-bold tracking-wide shadow-md text-center">🚀 HIGH PROBABILITY DEAL</div>}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-4 text-xs sm:text-sm">
                                  <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Loan Required?</p><p className={`font-semibold ${t.text}`}>{curLoan?.loanRequired}</p></div>
                                  <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Current Status</p><p className={`font-bold px-2 py-0.5 rounded inline-block border ${sColor}`}>{curLoan?.status}</p></div>
                                  <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Amount Requested</p><p className="text-orange-400 font-semibold">{curLoan?.amountReq}</p></div>
                                  <div><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>Amount Approved</p><p className={`font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{curLoan?.amountApp}</p></div>
                                  {[{ label: "Bank Name", val: curLoan?.bankName }, { label: "CIBIL Score", val: curLoan?.cibil }, { label: "Agent Name", val: curLoan?.agent }, { label: "Agent Contact", val: curLoan?.agentContact }, { label: "Emp Type", val: curLoan?.empType }, { label: "Monthly Income", val: curLoan?.income }, { label: "Existing EMIs", val: curLoan?.emi }].map(f => (
                                    <div key={f.label}><p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>{f.label}</p><p className={`font-semibold ${t.text}`}>{f.val}</p></div>
                                  ))}
                                  <div className="col-span-1 sm:col-span-2 mb-1 sm:mb-2 mt-2"><p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>Document Status</p></div>
                                  {[{ label: "PAN Card", val: curLoan?.docPan }, { label: "Aadhaar", val: curLoan?.docAadhaar }, { label: "Salary/ITR", val: curLoan?.docSalary }, { label: "Bank Stmt", val: curLoan?.docBank }, { label: "Property Docs", val: curLoan?.docProperty }].map((doc, i) => (
                                    <div key={i} className={`flex items-center justify-between p-2 rounded-lg col-span-1 border ${t.innerBlock}`}>
                                      <span className={`text-[10px] sm:text-xs ${t.textMuted}`}>{doc.label}</span>
                                      {doc.val === "Uploaded" ? <FaCheck className="text-green-500 text-xs" /> : <FaClock className={`text-xs ${t.textFaint}`} />}
                                    </div>
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                        </div>


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

                    </div>

                    {/* Call / WhatsApp buttons */}
                    <div className="grid grid-cols-2 gap-3 flex-shrink-0">

                      <button
                        onClick={() => { setCallOpen(true); setCallHidden(false); }}
                        className={`border flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1 min-h-[48px] ${isDark ? "bg-[#00AEEF]/10 border-[#00AEEF]/30 hover:bg-[#00AEEF] text-[#00AEEF] hover:text-white" : "bg-[#00AEEF]/10 border-[#00AEEF]/30 hover:bg-[#00AEEF] text-[#00AEEF] hover:text-white"}`}>
                        <FaMicrophone className="text-base sm:text-lg" />
                        <span className="font-bold text-[10px]">Browser Call</span>
                      </button>
                      <button
                        onClick={() => setIsWaModalOpen(true)}
                        className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl transition-all cursor-pointer gap-1 min-h-[48px]">
                        <FaWhatsapp className="text-lg sm:text-xl" />
                        <span className="font-bold text-[10px]">WhatsApp</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT PANEL: FOLLOW-UPS */}
              <div className={`flex flex-col rounded-2xl overflow-hidden shadow-2xl border h-[500px] lg:h-[calc(100vh-260px)] lg:sticky lg:top-4 ${t.chatPanel}`} style={t.chatPanelGl}>
                <div className={`flex-1 p-4 sm:p-6 overflow-y-auto custom-scrollbar flex flex-col gap-4 sm:gap-6 ${t.chatArea}`}>
                  {/* System message */}
                  <div className="flex justify-start">
                    <div className={`rounded-2xl rounded-tl-none p-3 sm:p-4 max-w-[90%] sm:max-w-[85%] shadow-md ${t.fupSalesform}`}>
                      <div className={`flex justify-between items-start sm:items-center mb-2 gap-2 sm:gap-6 flex-col sm:flex-row`}>
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
                        <div className={`rounded-2xl rounded-tl-none p-3 sm:p-4 max-w-[90%] sm:max-w-[85%] shadow-lg ${bubbleCls}`}>
                          <div className="flex justify-between items-start sm:items-center mb-2 sm:mb-3 gap-2 sm:gap-6 flex-col sm:flex-row">
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
                <form onSubmit={handleSendCustomNote} className={`p-3 sm:p-4 border-t flex gap-2 sm:gap-3 items-center flex-shrink-0 ${t.header} ${t.tableBorder}`} style={t.headerGlass}>
                  <input
                    ref={inputRef}
                    type="text" value={customNote} onChange={e => setCustomNote(e.target.value)}
                    placeholder="Add follow-up note..."
                    className={`flex-1 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm outline-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                  />
                  <button type="submit" className={`w-10 h-10 sm:w-12 sm:h-12 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg flex-shrink-0 ${isDark ? "bg-purple-600 hover:bg-purple-500" : "bg-[#00AEEF] hover:bg-[#0099d4]"}`}><FaPaperPlane className="text-sm ml-[-2px]" /></button>
                </form>
              </div>

            </div>{/* end grid */}
          </div>
        )}
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

        <MarkClosingModal
          isOpen={isClosingModalOpen}
          onClose={() => setIsClosingModalOpen(false)}
          onConfirm={handleMarkAsClosing}
          isDark={isDark}
        />

        {selectedLead && (
          <CallModal
            leadName={selectedLead.name}
            phone={selectedLead.phone || selectedLead.contact_no || ""}
            altPhone={selectedLead.altPhone && selectedLead.altPhone !== "N/A" ? selectedLead.altPhone : undefined}
            isVisible={callOpen && !callHidden}
            onHide={() => { setCallHidden(true); setCallOpen(false); }}
            onClose={() => { setCallOpen(false); setCallHidden(false); }}
          />
        )}
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
      </main>
    </div>
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
    <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-4 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}>
      <div className={`rounded-2xl w-full max-w-lg shadow-2xl border overflow-hidden ${t.modalCard}`}
        style={t.modalGlass}>

        {/* Header */}
        <div className="p-5 border-b border-green-500/20 bg-green-500/10 flex justify-between items-center">
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
          <div className={`p-5 border-t flex justify-end gap-3 ${t.modalHeader} ${t.tableBorder}`}>
            <button type="button" onClick={onClose}
              className={`px-6 py-2.5 rounded-lg font-bold cursor-pointer ${t.textMuted} hover:text-red-500`}>
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
function AssistantView({ allLeads, isDark, t }: { allLeads: any[]; isDark: boolean; t: ReturnType<typeof buildTheme> }) {
  const CACHE_KEY = "crm_ai_chat";
  const CACHE_TTL = 2 * 24 * 60 * 60 * 1000;
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string; ts?: string; typing?: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isLoading]);
  useEffect(() => { try { const raw = localStorage.getItem(CACHE_KEY); if (!raw) return; const { messages, savedAt } = JSON.parse(raw); if (Date.now() - savedAt > CACHE_TTL) { localStorage.removeItem(CACHE_KEY); return; } if (Array.isArray(messages)) setChatMessages(messages); } catch { localStorage.removeItem(CACHE_KEY); } }, []);
  useEffect(() => { if (chatMessages.length === 0) return; try { localStorage.setItem(CACHE_KEY, JSON.stringify({ messages: chatMessages, savedAt: Date.now() })); } catch { } }, [chatMessages]);

  const getTime = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setChatInput("");
    setChatMessages(prev => [...prev, { sender: "user", text, ts: getTime() }]);
    setIsLoading(true);
    setChatMessages(prev => [...prev, { sender: "ai", text: "", ts: getTime(), typing: true }]);
    try {
      const res = await fetch("/api/ai-assistant/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: text, leads: allLeads }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await new Promise(r => setTimeout(r, 500));
      setChatMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.typing ? { sender: "ai", text: data.response, ts: getTime(), typing: false } : m));
    } catch (err) {
      await new Promise(r => setTimeout(r, 500));
      setChatMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.typing ? { sender: "ai", text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`, ts: getTime(), typing: false } : m));
    } finally { setIsLoading(false); inputRef.current?.focus(); }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(chatInput); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); } };

  const suggestions = [
    { icon: <BarChart2 className="w-4 h-4" />, label: "Leads overview", prompt: "Leads overview", color: "text-purple-400" },
    { icon: <Flame className="w-4 h-4" />, label: "High priority leads", prompt: "high priority leads", color: "text-red-400" },
    { icon: <Landmark className="w-4 h-4" />, label: "Loan summary", prompt: "loan summary", color: "text-blue-400" },
    { icon: <CalendarDays className="w-4 h-4" />, label: "Site visits", prompt: "site visits", color: "text-orange-400" },
    { icon: <Lightbulb className="w-4 h-4" />, label: "What should I do next?", prompt: "suggest what should I do next", color: "text-yellow-400" },
    { icon: <ClipboardList className="w-4 h-4" />, label: "Total lead count", prompt: "how many total leads", color: "text-green-400" },
  ];
  const isEmpty = chatMessages.length === 0;

  return (
    <div
      className={`flex flex-col h-full ${t.chatArea}`}
      style={{
        ...((!isDark) ? { background: "linear-gradient(135deg, #e8f6fd 0%, #f8fafc 30%, #faf0fb 62%, #f8fafc 78%, #e6fafe 100%)" } : {}),
      }}
    >
      {/* Chat header */}
      <div className={`flex-shrink-0 flex items-center justify-between px-4 sm:px-8 py-3 sm:py-4 border-b ${t.tableBorder} ${isDark ? "bg-transparent" : "bg-white/60 backdrop-blur-sm"}`}>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0 ${isDark ? "bg-gradient-to-br from-purple-600 to-blue-600" : "bg-gradient-to-br from-[#00AEEF] to-[#9E217B]"}`}><Bot className="text-white w-4 h-4" /></div>
          <div>
            <h2 className={`font-bold text-sm leading-tight ${t.text}`}>CRM AI Assistant</h2>
            <p className={`text-[10px] sm:text-[11px] ${t.textFaint}`}>{allLeads.length > 0 ? `${allLeads.length} leads loaded` : "No leads loaded"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {chatMessages.length > 0 && (
            <button onClick={() => { setChatMessages([]); localStorage.removeItem(CACHE_KEY); }} className={`text-[10px] sm:text-[11px] transition-colors cursor-pointer border px-2 sm:px-3 py-1 rounded-full ${t.textFaint} hover:text-red-400 hover:border-red-500/30 ${t.tableBorder}`}>
              Clear chat
            </button>
          )}
          <div className="flex items-center gap-1 sm:gap-2"><Wifi className="w-3 h-3 text-green-500" /><span className="text-[10px] sm:text-[11px] text-green-500 font-semibold">Online</span></div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-4 sm:px-8 py-8 sm:py-12">
            <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border flex items-center justify-center mb-4 sm:mb-6 ${isDark ? "bg-gradient-to-br from-purple-600/20 to-blue-600/20 border-purple-500/20" : "bg-gradient-to-br from-[#00AEEF]/10 to-[#9E217B]/10 border-[#00AEEF]/20"}`}><Bot className={`w-6 h-6 sm:w-8 sm:h-8 ${t.accentText}`} /></div>
            <h1 className={`text-xl sm:text-2xl font-bold mb-2 text-center ${t.text}`}>How can I help you today?</h1>
            <p className={`text-xs sm:text-sm text-center mb-8 sm:mb-10 max-w-md ${t.textMuted}`}>Ask me about your leads, stats, loan tracking, or type a client name for a full AI analysis.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 w-full max-w-2xl px-4 sm:px-0">
              {suggestions.map(s => (
                <button key={s.prompt} onClick={() => sendMessage(s.prompt)} className={`group flex items-center gap-3 border rounded-xl p-3 sm:p-4 text-left transition-all cursor-pointer ${t.card}`} style={t.cardGlass}>
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${s.color} ${t.settingsBg}`}>
                    {s.prompt === "high priority leads" && (<span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span>)}
                    {s.icon}
                  </div>
                  <span className={`text-[11px] sm:text-xs font-medium leading-tight transition-colors ${t.textMuted} group-hover:${isDark ? "text-white" : "text-[#1A1A1A]"}`}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex gap-2 sm:gap-3 animate-fadeIn ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className="flex-shrink-0 mt-1">
                  {msg.sender === "ai"
                    ? <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shadow-md ${isDark ? "bg-gradient-to-br from-purple-600 to-blue-600" : "bg-gradient-to-br from-[#00AEEF] to-[#9E217B]"}`}><Bot className="text-white w-3.5 h-3.5" /></div>
                    : <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg border flex items-center justify-center ${t.settingsBg} ${t.tableBorder}`}><User className={`w-3.5 h-3.5 ${t.textMuted}`} /></div>
                  }
                </div>
                <div className={`flex flex-col gap-1 ${msg.sender === "user" ? "items-end max-w-[75%] sm:max-w-[65%]" : "items-start max-w-[85%] sm:max-w-[80%]"}`}>
                  <div className={`px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl text-xs sm:text-sm leading-relaxed sm:leading-7 ${msg.sender === "user" ? t.chatBubbleUser + " rounded-tr-sm" : t.chatBubbleAi + " rounded-tl-sm"}`}>
                    {msg.typing ? (
                      <div className="flex items-center gap-2 sm:gap-3 py-0.5">
                        <div className="flex items-end gap-[3px] h-3 sm:h-4">
                          {[0, 100, 200, 100, 0].map((delay, i) => <div key={i} className={`w-[2px] sm:w-[3px] rounded-full animate-pulse ${isDark ? "bg-purple-400" : "bg-[#00AEEF]"}`} style={{ height: `${[6, 10, 14, 10, 6][i]}px`, animationDelay: `${delay}ms`, animationDuration: "0.8s" }} />)}
                        </div>
                        <span className={`text-[10px] sm:text-[11px] italic ${t.textFaint}`}>AI is thinking...</span>
                      </div>
                    ) : <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                  </div>
                  {msg.ts && !msg.typing && <span className={`text-[9px] sm:text-[10px] px-1 ${t.textFaint}`}>{msg.ts}</span>}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className={`flex-shrink-0 border-t px-2 sm:px-4 py-2 sm:py-3 mb-2 sm:mb-0 ${t.tableBorder} ${isDark ? "bg-[#0a0a0a]" : "bg-white/80 backdrop-blur-sm"}`}>
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit}>
            <div className={`flex items-end gap-2 sm:gap-3 rounded-2xl px-3 sm:px-4 py-2 sm:py-3 transition-all border ${t.chatInput}`}>
              <textarea
                ref={inputRef} value={chatInput}
                onChange={e => { setChatInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about leads, loans..."
                disabled={isLoading} rows={1}
                className={`flex-1 bg-transparent text-xs sm:text-sm outline-none resize-none focus:ring-0 placeholder:${t.textFaint} disabled:opacity-50 leading-relaxed self-center pt-1 ${t.text}`}
                style={{ maxHeight: "120px", minHeight: "24px" }}
              />
              <button type="submit" disabled={isLoading || !chatInput.trim()} className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer flex-shrink-0 mb-0.5 ${chatInput.trim() && !isLoading ? (isDark ? "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20" : "bg-[#00AEEF] hover:bg-[#0099d4] text-white shadow-lg shadow-[#00AEEF]/20") : `${t.settingsBg} ${t.textFaint} cursor-not-allowed`}`}>
                <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          </form>
          {!isEmpty && (
            <div className="flex gap-2 mt-2 sm:mt-3 flex-wrap px-1">
              {suggestions.slice(0, 3).map(s => (
                <button key={s.prompt} onClick={() => sendMessage(s.prompt)} disabled={isLoading} className={`relative flex items-center gap-1.5 text-[9px] sm:text-[11px] border px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-40 ${t.textFaint} hover:${isDark ? "text-white" : "text-[#1A1A1A]"} ${t.tableBorder} ${isDark ? "bg-[#111] hover:bg-[#1a1a1a]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                  <span className={`w-2.5 sm:w-3 h-auto flex-shrink-0 ${s.color}`}>{s.icon}</span>
                  <span className="whitespace-nowrap">{s.label}</span>
                </button>
              ))}
            </div>
          )}
          <p className={`text-center text-[9px] sm:text-[10px] mt-1 sm:mt-2 ${t.textFaint}`}>Press Enter to send · Shift+Enter for new line</p>
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
    <div className={`rounded-xl border p-4 ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200"}`}>
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
        <p className={`text-xs text-center py-4 ${t.textFaint}`}>No site visits scheduled yet.</p>
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
                  {v.status === "scheduled" && (
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
        <div className="fixed inset-0 bg-black/75 z-[200] flex items-center justify-center p-4 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-2xl w-full max-w-md shadow-2xl border overflow-hidden ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200"}`}>
            <div className={`p-5 border-b flex items-center justify-between ${isDark ? "bg-orange-900/20 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
              <div>
                <h2 className={`font-bold flex items-center gap-2 ${isDark ? "text-orange-400" : "text-orange-700"}`}>
                  <FaCalendarAlt /> {editVisit ? "Reschedule Visit" : visits.length === 0 ? "Schedule Site Visit" : "Schedule Re-Site Visit"}
                </h2>
                <p className={`text-xs mt-0.5 ${t.textMuted}`}>Lead #{lead.id} — {lead.name}</p>
              </div>
              <button onClick={() => { setShowModal(false); setEditVisit(null); }} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
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
function SettingsView({ adminUser, isDark, t, onSaved }: {
  adminUser: any;
  isDark: boolean;
  t: ReturnType<typeof buildTheme>;
  onSaved: (number: string) => void;
}) {
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    const fetchNumber = async () => {
      try {
        const res = await fetch(`/api/users/update-whatsapp?name=${encodeURIComponent(adminUser.name)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) setWhatsappNumber(data.whatsapp_number || "");
      } catch (e) { console.error(e); }
      finally { setIsLoading(false); }
    };
    if (adminUser.name) fetchNumber();
  }, [adminUser.name]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = whatsappNumber.replace(/\D/g, "");
    if (cleaned.length < 10 || cleaned.length > 15) {
      setToast({ msg: "Enter a valid number with country code (e.g. 918369787919)", ok: false });
      setTimeout(() => setToast(null), 3500);
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/users/update-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: adminUser.name, whatsapp_number: cleaned }),
      });
      if (!res.ok) { setToast({ msg: "❌ Server Error", ok: false }); return; }
      const data = await res.json();
      if (data.success) onSaved(cleaned); // update parent state instantly
      setToast({ msg: data.success ? "✅ WhatsApp number saved!" : "❌ " + data.message, ok: data.success });
      setTimeout(() => setToast(null), 3500);
    } catch {
      setToast({ msg: "❌ Network error. Try again.", ok: false });
      setTimeout(() => setToast(null), 3500);
    } finally { setIsSaving(false); }
  };

  return (
    <div className="animate-fadeIn max-w-xl mx-auto space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-fadeIn border ${toast.ok ? "bg-green-600 border-green-400 text-white" : "bg-red-600 border-red-400 text-white"}`}>
          <span className="text-sm font-bold">{toast.msg}</span>
        </div>
      )}

      <div>
        <h1 className={`text-2xl font-bold ${t.text}`}>Settings</h1>
        <p className={`text-sm mt-1 ${t.textFaint}`}>Manage your personal CRM preferences</p>
      </div>

      {/* WhatsApp Card */}
      <div className={`rounded-2xl border p-6 shadow-sm ${t.card}`} style={t.cardGlass}>
        <div className={`flex items-center gap-3 mb-6 pb-4 border-b ${t.tableBorder}`}>
          <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <FaWhatsapp className="text-green-500 text-lg" />
          </div>
          <div>
            <h2 className={`font-bold text-base ${t.text}`}>My WhatsApp Number</h2>
            <p className={`text-xs ${t.textFaint}`}>Leads will receive messages from this number</p>
          </div>
        </div>

        {isLoading ? (
          <div className={`text-center py-6 text-sm ${t.textMuted}`}>Loading...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">

            {/* Who is saving */}
            <div className={`flex items-center justify-between p-3 rounded-xl border ${t.settingsBg}`}>
              <span className={`text-xs ${t.textFaint}`}>Saving for</span>
              <span className={`text-xs font-bold ${t.text}`}>{adminUser.name}</span>
            </div>

            {/* Number Input */}
            <div>
              <label className={`text-xs font-bold block mb-2 ${t.textMuted}`}>Your WhatsApp Number</label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold ${t.textFaint}`}>+</span>
                <input
                  type="tel"
                  value={whatsappNumber}
                  onChange={e => setWhatsappNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="918369787919"
                  maxLength={15}
                  className={`w-full rounded-xl pl-7 pr-4 py-3 text-sm font-mono outline-none border transition-colors ${t.inputInner} ${t.text} ${t.inputFocus}`}
                />
              </div>
              <p className={`text-[10px] mt-2 ${t.textFaint}`}>
                Include country code, no spaces or symbols.
                Example: <span className="font-mono font-bold">918369787919</span>
              </p>
            </div>

            {/* Live Preview */}
            {whatsappNumber.length >= 10 && (
              <div className="p-3 rounded-xl border border-green-500/20 bg-green-500/5 text-xs">
                <p className="text-green-500 font-bold mb-1">📱 Preview — WhatsApp will open as:</p>
                <p className={`font-mono break-all ${t.textMuted}`}>
                  https://wa.me/{whatsappNumber}?text=...
                </p>
              </div>
            )}

            {/* Current saved number */}
            {adminUser.whatsapp_number && (
              <div className={`p-3 rounded-xl border border-green-500/20 text-xs flex items-center justify-between ${t.settingsBg}`}>
                <span className={t.textFaint}>Currently saved:</span>
                <span className="font-mono font-bold text-green-500">+{adminUser.whatsapp_number}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving || whatsappNumber.length < 10}
              className={`w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 ${isSaving || whatsappNumber.length < 10
                ? "opacity-50 cursor-not-allowed bg-green-600/40 text-white"
                : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/20 cursor-pointer"
                }`}
            >
              <FaWhatsapp />
              {isSaving ? "Saving..." : "Save WhatsApp Number"}
            </button>
          </form>
        )}
      </div>

      {/* Info Box */}
      <div className={`rounded-2xl border p-4 text-xs space-y-2 ${t.settingsBg}`}>
        <p className={`font-bold ${t.textMuted}`}>ℹ️ How this works</p>
        <p className={t.textFaint}>
          When you click "Send WhatsApp" on a lead, it opens WhatsApp Web/App
          using <strong>your personal number</strong>. Each Sales Manager
          sends from their own WhatsApp — not a shared company number.
        </p>
      </div>

    </div>
  );
}
// ============================================================================
// ATTENDANCE VIEW — Sales Manager self-attendance tracker
// ============================================================================
// ============================================================================
// ATTENDANCE VIEW — Sales Manager self-attendance with mark-present checkbox
// ============================================================================


function ReceptionistView() { return null; }
