//receptionist frontend
"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaThLarge, FaCog, FaBell, FaTimes, FaClipboardList,
  FaChevronLeft, FaRobot, FaPaperPlane, FaCalendarAlt, FaEye, FaEyeSlash,
  FaPhoneAlt, FaUserCircle, FaBriefcase, FaSearch, FaDownload,
  FaFileInvoice, FaHandshake, FaUniversity, FaUsers, FaFileAlt,
  FaCheck, FaClock, FaMicrophone, FaWhatsapp, FaCheckCircle,
  FaExchangeAlt, FaUserTie
} from "react-icons/fa";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Ghost, AlertTriangle } from "lucide-react";
import LoginTimerWidget from "@/components/LoginTimerWidget";
import LostLeadModal from "@/components/LostLeadModal";
import MarkClosingModal from "@/components/MarkClosingModal";
import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import AttendanceView from "@/components/AttendanceView";
import { useActivityTracker } from "@/hooks/useActivityTracker";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
const CARDS_PER_PAGE = 20;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const NAV_ITEMS = [
  { id: "overview", icon: <FaThLarge className="w-5 h-5" />, title: "Dashboard" },
  { id: "forms", icon: <FaClipboardList className="w-5 h-5" />, title: "Forms List" },
  { id: "assigned", icon: <FaFileInvoice className="w-5 h-5" />, title: "Assigned Forms" },
  { id: "recep-leads", icon: <FaUsers className="w-5 h-5" />, title: "Receptionist Leads" },
  { id: "closed-leads", icon: <FaCheckCircle className="w-5 h-5" />, title: "Closed Leads" },
  { id: "attendance", icon: <FaClock className="w-5 h-5" />, title: "My Attendance" },
  { id: "assistant", icon: <FaRobot className="w-5 h-5" />, title: "CRM AI Assistant" },
];

const LEAD_SOURCES = [
  "Advertisement", "Referral", "Exhibition", "Channel Partner", "Website", "Call Center", "Others"
];

const CONFIG_KEYS = ["1 RK", "1 BHK", "2 BHK", "3 BHK", "4 BHK", "4+ BHK", "Other"];

// ─────────────────────────────────────────────────────────────────────────────
// SVG ICONS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// THEME TOKENS
// ─────────────────────────────────────────────────────────────────────────────
function buildTheme(isDark: boolean) {
  return {
    pageWrap: isDark ? "bg-[#0A0A0F] text-white" : "text-[#1A1A1A]",
    mainBg: isDark ? "bg-[#0A0A0F]" : "bg-transparent",
    sidebar: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#1A1A1A] border-[#2A2A2A]",
    header: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    headerGlass: isDark ? {} : { boxShadow: "0 1px 0 #9CA3AF, 0 4px 16px rgba(0,174,239,0.06)" },

    // ── Cards (No intense glow in light mode, border changes to Magenta on hover) ──
    card: isDark
      ? "bg-[#121218] border-[#2A2A35] transition-all duration-300 hover:border-[#d4006e]/50 hover:shadow-2xl hover:shadow-[#d4006e]/20"
      : "bg-gradient-to-r from-[#f1f5ff] via-[#eef2ff] to-[#f5f3ff] border-[#9CA3AF] transition-all duration-300 hover:border-[#9E217B] hover:shadow-xl",
    cardGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,174,239,0.07)" },

    statusLost: isDark ? "text-red-300 border-red-500/30 bg-red-950/30" : "text-red-700 border-red-300 bg-red-50",
    cardLost: isDark
      ? "bg-[#171717] border border-red-900/25 opacity-70 grayscale saturate-50 transition-all duration-300 hover:opacity-90 hover:border-red-500/30"
      : "bg-slate-100 border border-red-200 opacity-75 grayscale saturate-50 transition-all duration-300 hover:opacity-90 hover:border-red-300",
    rowLost: isDark
      ? "bg-[#151515]/80 text-gray-500 opacity-75 grayscale"
      : "bg-slate-100/80 text-slate-500 opacity-80 grayscale",
    tableWrap: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    tableGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },
    tableHead: isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]",
    tableRow: isDark ? "hover:bg-[#1C1C2A]" : "hover:bg-[#F8FAFC]",
    tableDivide: isDark ? "divide-[#1E1E2A]" : "divide-[#9CA3AF]",
    tableBorder: isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]",
    inputBg: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    modalCard: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    modalGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,174,239,0.08), 0 32px 72px rgba(0,0,0,0.16)" },
    modalInner: isDark ? "bg-[#0A0A0F]" : "bg-[#F8FAFC]",
    modalHeader: isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]",
    modalBlock: isDark ? "bg-[#14141B] border-[#1E1E2A]" : "bg-white border-[#9CA3AF]",
    modalBlockGl: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 3px 8px rgba(0,174,239,0.05)" },
    modalInput: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    settingsBg: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#9CA3AF]",
    settingsBgGl: isDark ? {} : { boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04)" },
    innerBlock: isDark ? "bg-[#121212] border-[#333]" : "bg-white border-[#D1D5DB]",
    inputInner: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    inputFocus: isDark ? "focus:border-[#9E217B]" : "focus:border-[#00AEEF]",
    dropdown: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    dropdownGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 20px rgba(0,174,239,0.08), 0 20px 40px rgba(0,0,0,0.10)" },

    // ── Chat (Gray background, dark border, black text in light mode) ──
    chatArea: isDark ? "bg-[#0A0A0F]" : "bg-[#F1F5F9]",
    chatBubbleAi: isDark ? "bg-[#1A1A28] text-white border border-[#2A2A35]" : "bg-[#F3F4F6] border border-[#CBD5E1] text-gray-900 font-medium shadow-sm",
    chatInput: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F3F4F6] border border-[#64748B] hover:border-[#475569] focus-within:bg-white focus-within:border-[#475569] shadow-inner",
    chatPanel: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border border-[#94A3B8]",
    chatPanelGl: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },

    fupDefault: isDark ? "bg-[#2a2135] border border-[#4c1d95]" : "bg-indigo-50 border border-indigo-200",
    fupLoan: isDark ? "bg-blue-900/20 border border-blue-600/40" : "bg-blue-50 border border-blue-200",
    fupSalesform: isDark ? "bg-[#222] border border-[#444]" : "bg-white border border-[#D1D5DB]",
    fupClosing: isDark ? "bg-yellow-900/20 border border-yellow-600/40" : "bg-amber-50 border border-amber-300",
    fupTransfer: isDark ? "bg-purple-900/20 border border-purple-600/40" : "bg-purple-50 border border-purple-300",

    text: isDark ? "text-white" : "text-[#1A1A1A]",
    textMuted: isDark ? "text-[#888899]" : "text-[#334155]", // Darker text
    textFaint: isDark ? "text-[#55556A]" : "text-[#475569]", // Darker faint
    textHeader: isDark ? "text-xs text-[#B0B0C4]" : "text-xs font-bold text-[#334155]", // Darker headers

    navActive: isDark ? "bg-[#1A1A28] text-white" : "bg-[#2A2A2A] text-[#9E217B]",
    navInactive: isDark ? "text-[#888899] hover:bg-[#1A1A28] hover:text-white" : "text-[#9CA3AF] hover:bg-[#2A2A2A] hover:text-white",
    navIndicator: isDark ? "bg-[#9E217B] shadow-[0_0_10px_2px_rgba(158,33,123,0.5)]" : "bg-[#9E217B] shadow-[0_0_8px_rgba(158,33,123,0.4)]",
    toggleWrap: isDark ? "bg-[#1C1C2A] border-[#2A2A38] text-yellow-300" : "bg-[#F1F5F9] border-[#9CA3AF] text-[#1A1A1A]",

    accentText: isDark ? "text-[#d4006e]" : "text-[#00AEEF]",
    accentBg: isDark ? "bg-[#9E217B]/10 text-[#d4006e] border border-[#9E217B]/30" : "bg-[#00AEEF]/10 text-[#00AEEF] border border-[#00AEEF]/30",
    sectionTitle: isDark ? "text-[#d4006e]" : "text-[#9E217B]",
    sectionBorder: isDark ? "border-[#9E217B]/20" : "border-[#9E217B]/25",

    // ── Buttons (Hover Scale & Shadow Pop-out) ──
    btnPrimary: isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-md transition-colors duration-200" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white shadow-sm transition-colors duration-200",
    btnSecondary: isDark ? "bg-blue-700 hover:bg-blue-800 text-white shadow-md transition-colors duration-200" : "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-sm transition-colors duration-200",
    btnWarning: isDark ? "bg-yellow-600 hover:bg-yellow-700 text-white shadow-md transition-colors duration-200" : "bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-colors duration-200",
    btnDanger: isDark ? "bg-red-500/10 text-red-500 hover:bg-red-600/20 border border-red-500/30 transition-colors duration-200" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B]/20 border border-[#9E217B]/30 transition-colors duration-200",
    btnTransfer: isDark ? "bg-purple-600 hover:bg-purple-700 text-white shadow-md transition-colors duration-200" : "bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-colors duration-200",
    btnClosingBadge: isDark ? "bg-yellow-900/20 border border-yellow-500/40 text-yellow-400" : "bg-amber-50 border border-amber-400/60 text-amber-600",
    scroll: isDark ? "custom-scrollbar" : "custom-scrollbar",
    logoBg: isDark ? "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30" : "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30",

    // ── Stat glow orbs (used by AttendanceView) ──
    statGlow1: isDark ? "bg-[#d4006e]/10" : "bg-[#00AEEF]/10",
    statGlow2: isDark ? "bg-blue-600/10" : "bg-[#9E217B]/10",
    statGlow3: isDark ? "bg-blue-600/10" : "bg-indigo-400/10",
    statGlow4: isDark ? "bg-yellow-500/10" : "bg-amber-400/10",
    statGlow5: isDark ? "bg-green-600/10" : "bg-emerald-400/10",
    selectSmall: isDark ? "bg-[#1A1A28] border-[#2A2A35] text-white" : "bg-white border-[#D1D5DB] text-[#6B7280]",
    chartColors: isDark
      ? ["#d946ef", "#8b5cf6", "#3b82f6", "#0ea5e9", "#6b7280", "#f59e0b", "#10b981"]
      : ["#00AEEF", "#9E217B", "#0077b6", "#d4006e", "#9CA3AF", "#f59e0b", "#10b981"],
    tooltipBg: isDark ? "#1a1a1a" : "rgba(255,255,255,0.98)",
    tooltipColor: isDark ? "#fff" : "#1A1A1A",
    tooltipBorder: isDark ? "1px solid rgba(158,33,123,0.3)" : "1px solid #E5E7EB",
    legendColor: isDark ? "#9ca3af" : "#6B7280",
    exportBtn: isDark ? "border-[#2A2A35] hover:border-[#9E217B] hover:text-[#d4006e] text-[#888899]" : "border-[#9CA3AF] hover:border-[#9E217B] hover:text-[#9E217B] text-[#6B7280]",
    statusAssigned: isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50",
    statusNew: isDark ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50",
    statusContacted: isDark ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50",
    statusInterested: isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50",
    statusVisit: isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50",
    statusClosing: isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50",
    statusCompleted: isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50",
    statusNGD: "bg-[rgba(251,146,60,0.12)] text-[#F97316] border border-[rgba(249,115,22,0.4)]",
    cardNGD: "bg-[rgba(249,115,22,0.06)] border border-[rgba(249,115,22,0.35)] hover:border-[#F97316] shadow-[0_4px_12px_rgba(249,115,22,0.12)] transition-all duration-300 flex flex-col h-full",
    rowNGD: "bg-[rgba(249,115,22,0.03)]",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER BADGES
// ─────────────────────────────────────────────────────────────────────────────
function InterestBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const colorMap: Record<string, string> = {
    Interested: "border-green-500/40 text-green-400 bg-green-500/10",
    "Not Interested": "border-red-500/40 text-red-400 bg-red-500/10",
    "NON GENUINE DEMAND": "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
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
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border flex items-center gap-1 flex-shrink-0 ${cls}`}>
      <FaUniversity className="text-[7px]" />{status}
    </span>
  );
}

function WhatsAppSettingsCard({ user, setUser, isDark, t }: {
  user: any; setUser: any; isDark: boolean; t: any;
}) {
  const [input, setInput] = useState(user.whatsapp_number || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!input.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/users/update-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, whatsapp_number: input.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setUser((prev: any) => ({ ...prev, whatsapp_number: input.trim() }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch { }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className={`text-xs ${t.textFaint}`}>
        This number is used when logging WhatsApp messages to the CRM timeline.
        Include country code without the <code>+</code> sign.
      </p>
      <div className="flex gap-3 items-center">
        <div className="flex-1">
          <label className={`block text-xs mb-1.5 font-medium ${t.textFaint}`}>
            WhatsApp Number (with country code)
          </label>
          <input
            type="tel"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="e.g. 919876543210"
            className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${isDark
              ? "bg-[#14141B] border-[#2A2A35] text-white focus:border-[#9E217B]"
              : "bg-white border-[#9CA3AF] text-[#1A1A1A] focus:border-[#00AEEF]"
              }`}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !input.trim()}
          className={`mt-5 px-5 py-3 rounded-lg font-bold text-sm transition-all ${saved
            ? "bg-green-600 text-white"
            : saving || !input.trim()
              ? "opacity-50 cursor-not-allowed bg-gray-400 text-white"
              : (isDark
                ? "bg-[#9E217B] hover:bg-[#b8268f] text-white"
                : "bg-[#00AEEF] hover:bg-[#0099d4] text-white")
            }`}
        >
          {saved ? "✓ Saved" : saving ? "Saving..." : "Save"}
        </button>
      </div>
      {user.whatsapp_number && (
        <p className={`text-xs flex items-center gap-1.5 ${isDark ? "text-green-400" : "text-green-600"}`}>
          <FaWhatsapp /> Active: +{user.whatsapp_number}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
export default function ReceptionistDashboard() {
  const router = useRouter();
  useActivityTracker();
  const [isDark, setIsDark] = useState(false);
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

  // ── User & UI state ──
  const [user, setUser] = useState<any>({ name: "Loading...", role: "Receptionist", email: "", password: "" });
  const [activeTab, setActiveTab] = useState("overview");
  const [showPassword, setShowPassword] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  // ── Attendance: live clock tick (1-second interval for AttendanceView live timer) ──
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ title: string; color: string } | null>(null);

  const [activePopup, setActivePopup] = useState<"notifications" | "profile" | null>(null);
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

  type CrmNotif = { id: string; line1: string; line2: string; type: "lead" | "visit" };
  const [notifQueue, setNotifQueue] = useState<CrmNotif[]>([]);
  const [activeNotif, setActiveNotif] = useState<CrmNotif | null>(null);
  const [notifCount, setNotifCount] = useState(0);
  const [notificationHistory, setNotificationHistory] = useState<(CrmNotif & { rawDate: number })[]>([]);

  // ── Enquiry (new-entry) modal ──
  const [isEnquiryModalOpen, setIsEnquiryModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const getTodayString = () => new Date().toISOString().split("T")[0];
  const [enquiryForm, setEnquiryForm] = useState({
    fullName: "", mobile: "", altMobile: "", email: "", address: "",
    occupation: "", organization: "", budget: "", configuration: "",
    purpose: "", source: "", assignedTo: "", loanPlanned: "", sourceOther: "", referralName: "",
    cpDetails: { name: "", company: "", phone: "" },
    selfAssign: false,
    enquiryDate: getTodayString(),
  });
  // ── Auto Date toggle (persisted in sessionStorage) ──
  const [autoDate, setAutoDate] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("crm_auto_date");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });
  useEffect(() => {
    sessionStorage.setItem("crm_auto_date", String(autoDate));
    if (autoDate) {
      setEnquiryForm(prev => ({ ...prev, enquiryDate: getTodayString() }));
    }
  }, [autoDate]);
  const [showCpDropdown, setShowCpDropdown] = useState(false);

  // ___Lost Leads
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState("");
  const [isSavingLost, setIsSavingLost] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  // ── Data ──
  const [salesManagers, setSalesManagers] = useState<any[]>([]);

  const [isFetchingManagers, setIsFetchingManagers] = useState(true);
  const [siteHeads, setSiteHeads] = useState<any[]>([]);
  const combinedAssignees = useMemo(() => {
    return [...salesManagers, ...siteHeads];
  }, [salesManagers, siteHeads]);
  const [enquiries, setEnquiries] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [isFetchingEnquiries, setIsFetchingEnquiries] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchRecep, setSearchRecep] = useState("");

  // ── Overview chart state ──
  const [chartMode1, setChartMode1] = useState<"today" | "monthly" | "3months" | "6months" | "yearly" | "inception">("today");
  const [configChartMonth, setConfigChartMonth] = useState(new Date().getMonth());
  const [card2Mode, setCard2Mode] = useState<"today" | "monthly" | "3months" | "6months" | "yearly" | "alltime">("monthly");
  const [selectedMonthCard, setSelectedMonthCard] = useState(new Date().getMonth());
  const [card3Mode, setCard3Mode] = useState<"today" | "monthly" | "3months" | "6months" | "yearly" | "inception">("today");
  const [card3Month, setCard3Month] = useState(new Date().getMonth());
  const [card4Mode, setCard4Mode] = useState<"today" | "monthly" | "3months" | "6months" | "yearly" | "inception">("monthly");
  const [card4Month, setCard4Month] = useState(new Date().getMonth());

  // ── Assigned tab (full Sales-Manager panel) ──
  const [assignedSubView, setAssignedSubView] = useState<"cards" | "detail">("cards");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [detailTab, setDetailTab] = useState<"personal" | "loan">("personal");
  const [showSalesForm, setShowSalesForm] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [salesForm, setSalesForm] = useState({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
  const [loanForm, setLoanForm] = useState({ loanRequired: "", status: "", bank: "", amountReq: "", amountApp: "", cibil: "", agent: "", agentContact: "", empType: "", income: "", emi: "", docPan: "Pending", docAadhaar: "Pending", docSalary: "Pending", docBank: "Pending", docProperty: "Pending", notes: "" });
  const [customNote, setCustomNote] = useState("");
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const [searchAssigned, setSearchAssigned] = useState("");
  const [assignedCardsPage, setAssignedCardsPage] = useState(1);
  const assignedSentinelRef = useRef<HTMLDivElement>(null);

  // ── Transfer modal ──

  // const [transferNote, setTransferNote]       = useState("");
  // const [transferTarget, setTransferTarget]   = useState("");
  // const [isTransferring, setIsTransferring]   = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);  // keep existing

  // Transfer state (Receptionist Lead → Manager)
  const [transferNote, setTransferNote] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  // ── Receptionist Leads tab ──
  // ── Receptionist Leads tab ──
  const [searchRecepLeads, setSearchRecepLeads] = useState("");
  const recepLeadsSentinelRef = useRef<HTMLDivElement>(null);

  // Advanced Filter States
  const [searchColumn, setSearchColumn] = useState<string>("all");
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>("all");
  const [showLostLeads, setShowLostLeads] = useState<boolean>(true);
  const [showNGDLeads, setShowNGDLeads] = useState<boolean>(true);

  // Centralized Search Logic
  const applySearch = useCallback((leads: any[], query: string, col: string) => {
    if (!query.trim()) return leads;
    const lq = query.toLowerCase();

    return leads.filter((l: any) => {
      const getField = (field: string) => {
        switch (field) {
          case "lead_no": return String(l.id || "");
          case "name": return String(l.name || "");
          case "phone": return String(l.phone || "");
          case "budget": return String(l.salesBudget || l.budget || "");
          case "prop_type": return String(l.propType || l.configuration || "");
          case "source": return String(l.source || "");
          case "status": return String(l.status || "");
          default:
            return [
              l.id, l.name, l.phone, l.altPhone, l.alt_phone, l.source,
              l.propType, l.configuration, l.salesBudget, l.budget, l.status, l.assignedTo, l.assignedReceptionist
            ].map(v => String(v || "")).join(" ");
        }
      };
      return getField(col).toLowerCase().includes(lq);
    });
  }, []);
  // ── Closed Leads tab ──
  const [selectedClosedLead, setSelectedClosedLead] = useState<any>(null);
  const [closedLeadView, setClosedLeadView] = useState<"table" | "detail">("table");
  const [searchClosedLeads, setSearchClosedLeads] = useState("");

  // ── Chat ──
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { sender: "ai", text: "Hello! I am your CRM Assistant. Ask me about your total leads, or type a client's name to pull up their details!" }
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const tableSentinelRef = useRef<HTMLDivElement>(null);
  const cardsSentinelRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // DATE CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────
  const dateNow = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const threeMonthsAgo = new Date(dateNow.getFullYear(), dateNow.getMonth() - 2, 1);
  const sixMonthsAgo = new Date(dateNow.getFullYear(), dateNow.getMonth() - 5, 1);
  const yearStart = new Date(dateNow.getFullYear(), 0, 1);

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  const formatDate = (ds: string) => {
    if (!ds) return "N/A";
    try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return "Invalid"; }
  };
  const maskPhone = (phone: any) => {
    if (!phone || phone === "N/A") return "N/A";
    const c = String(phone).replace(/[^a-zA-Z0-9]/g, "");
    if (c.length <= 5) return c;
    return `${c.slice(0, 2)}${"*".repeat(c.length - 5)}${c.slice(-3)}`;
  };
  const showToast = (title: string, color = "green") => {
    setToastMsg({ title, color });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleSendWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !waMessage.trim()) return;

    const phone = String(selectedLead.phone || selectedLead.contact_no || "").replace(/\D/g, "");
    if (!phone) {
      alert("Lead phone number is missing.");
      return;
    }

    setIsSendingWa(true);
    try {
      await fetch("/api/whatsapp-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: String(selectedLead.id),
          sender_name: user.name,
          sender_number: user.whatsapp_number || "",
          recipient_number: selectedLead.phone || selectedLead.contact_no,
          message_preview: waMessage.trim(),
        }),
      });

      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(waMessage.trim())}`, "_blank");
      showToast("WhatsApp opened and logged!");
      setIsWaModalOpen(false);
      setWaMessage("");
      fetchFollowUps();
    } catch {
      alert("Error logging WhatsApp message.");
    } finally {
      setIsSendingWa(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────
  // ── Notification Queue & History Handler ──
  // NOTE: The primary handler is below at the second useEffect (with [enquiries, user.name, siteHeads]).
  // This first block was removed to prevent duplicate notifications.

  // Toast Display Logic (2 Seconds)
  useEffect(() => {
    if (activeNotif || notifQueue.length === 0) return;
    const next = notifQueue[0];
    setActiveNotif(next);
    setNotifQueue(prev => prev.slice(1));
    const timer = setTimeout(() => setActiveNotif(null), 2000);
    return () => clearTimeout(timer);
  }, [activeNotif, notifQueue]);
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === "assistant") chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activeTab]);

  useEffect(() => {
    const cleanupBackGuard = installLoggedOutBackGuard(() => router.replace("/"));
    const p = getStoredCrmUser();
    if (p) {
      try {
        setUser({ ...p, name: p.name || "User", password: p.password || "********" });
        fetch(`/api/users/update-whatsapp?name=${encodeURIComponent(p.name)}`)
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              setUser((prev: any) => ({ ...prev, whatsapp_number: data.whatsapp_number || "" }));
            }
          })
          .catch(() => { });
        const role = (p.role || "").toLowerCase();
        if (role === "receptionist" || role === "admin") {
          fetchSalesManagers();
          initialLoad();
          fetchFollowUps();
        } else { router.replace("/dashboard"); }
      } catch { router.replace("/"); }
    } else { router.replace("/"); }
    return cleanupBackGuard;
  }, [router]);

  // Infinite scroll: table
  useEffect(() => {
    const sentinel = tableSentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isFetchingEnquiries) loadMore();
    }, { threshold: 0.1 });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, isLoadingMore, isFetchingEnquiries, offset]);

  // Infinite scroll: cards
  useEffect(() => {
    const sentinel = cardsSentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isFetchingEnquiries) loadMore();
    }, { threshold: 0.1 });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, isLoadingMore, isFetchingEnquiries, offset]);

  // Assigned forms cards pagination
  useEffect(() => {
    const sentinel = assignedSentinelRef.current;
    if (!sentinel || assignedSubView !== "cards") return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setAssignedCardsPage(p => p + 1);
    }, { threshold: 0.1 });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [assignedSubView, assignedCardsPage]);

  // Follow-up scroll
  useEffect(() => {
    if (assignedSubView === "detail") followUpEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [followUps, assignedSubView, selectedLead, detailTab]);

  // Update selected lead when data changes
  useEffect(() => {
    if (selectedLead) {
      const updated = mergedLeads.find((l: any) => String(l.id) === String(selectedLead.id));
      if (updated) setSelectedLead(updated);
    }
  }, [enquiries, followUps]);

  // ─────────────────────────────────────────────────────────────────────────
  // DATA FETCHING
  // ─────────────────────────────────────────────────────────────────────────
  const fetchPage = async (currentOffset: number, append: boolean) => {
    try {
      const res = await fetch(`/api/walkin_enquiries?limit=${PAGE_SIZE}&offset=${currentOffset}`);
      if (!res.ok) return;
      const json = await res.json();
      const dataArray: any[] = Array.isArray(json) ? json : (json.data ?? []);
      const total: number = json.total ?? (append ? totalCount : dataArray.length);
      const formatted = dataArray.map((item: any) => ({
        ...item,
        assignedTo: item.assigned_to || "Unassigned",
        assignedReceptionist: item.assigned_receptionist || null,
        altPhone: item.alt_phone,
        date: formatDate(item.created_at),
        enquiryDate: item.enquiry_date || item.created_at,
        autoDateEnabled: item.auto_date_enabled ?? true,
        status: (item.status === "Routed" || item.status === "ROUTED" ? "Assigned" : item.status) || "Assigned",
      }));
      setEnquiries(prev => {
        const base = append ? prev : [];
        const merged = [...base, ...formatted];
        const seen = new Set<string>();
        return merged.filter(e => { const k = String(e.id); if (seen.has(k)) return false; seen.add(k); return true; });
      });
      setTotalCount(total);
      setHasMore(formatted.length === PAGE_SIZE && (currentOffset + PAGE_SIZE) < total);
    } catch (e) { console.error("fetchPage error", e); }
  };

  const fetchFollowUps = async () => {
    try {
      const res = await fetch("/api/followups");
      if (res.ok) {
        const json = await res.json();
        setFollowUps(Array.isArray(json.data) ? json.data : []);
      }
    } catch (e) { console.error("fetchFollowUps error", e); }
  };

  const initialLoad = async () => {
    setIsFetchingEnquiries(true);
    setOffset(0); setHasMore(true); setEnquiries([]);
    await fetchPage(0, false);
    setIsFetchingEnquiries(false);
  };

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const next = offset + PAGE_SIZE;
    setOffset(next);
    await fetchPage(next, true);
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore, offset]);

  const fetchSalesManagers = async () => {
    setIsFetchingManagers(true);
    try {
      const [resSM, resSH] = await Promise.all([
        fetch("/api/users/sales-manager"),
        fetch("/api/users/site-head")
      ]);

      if (resSM.ok) {
        const json = await resSM.json();
        const arr = json.data || json;
        if (Array.isArray(arr)) setSalesManagers(arr);
      }
      if (resSH.ok) {
        const json = await resSH.json();
        const arr = json.data || json;
        if (Array.isArray(arr)) setSiteHeads(arr);
      }
    } catch (e) {
      console.error("fetchManagers error", e);
    } finally {
      setIsFetchingManagers(false);
    }
  };

  const refetchAll = async () => {
    await Promise.all([initialLoad(), fetchFollowUps()]);
  };
  // ── Notification Queue & History Handler ──
  useEffect(() => {
    if (isFetchingEnquiries || enquiries.length === 0) return;

    const checkNotifs = () => {
      let storedIds: string[] = [];
      try {
        const item = localStorage.getItem("crm_shown_notif_ids");
        storedIds = item ? JSON.parse(item) : [];
      } catch (e) { storedIds = []; }

      const seenSet = new Set(storedIds);
      const fresh: CrmNotif[] = [];
      const history: (CrmNotif & { rawDate: number })[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      mergedLeads.forEach((lead: any) => {
        const formattedId = String(lead.id).padStart(3, '0');

        // 1. New Lead Notification (1-Day Expiry)
        const createdDate = new Date(lead.created_at || 0);
        createdDate.setHours(0, 0, 0, 0);
        const createdDiffDays = (today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

        if (createdDiffDays <= 1) {
          const leadNotif = {
            id: `lead_${lead.id}`,
            line1: `New Lead · ${formattedId} - ${lead.name}`,
            line2: lead.assigned_receptionist ? `Entered by ${lead.assigned_receptionist} (Receptionist)` : `Entered by ${lead.assignedTo} (Manager)`,
            type: "lead" as const
          };
          history.push({ ...leadNotif, id: `hist_lead_${lead.id}`, rawDate: new Date(lead.created_at || 0).getTime() });
          if (!seenSet.has(leadNotif.id)) {
            fresh.push(leadNotif);
            seenSet.add(leadNotif.id);
          }
        }

        // 2. Site Visit Notification (2 days before, 3 days duration)
        const vDate = lead.mongoVisitDate || lead.siteVisitDate;
        if (vDate && (lead.assignedReceptionist === user.name || lead.assigned_to === user.name)) {
          const visitDateObj = new Date(vDate);
          visitDateObj.setHours(0, 0, 0, 0);
          const diffDays = (visitDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

          if (diffDays >= -3 && diffDays <= 2) {
            const visitDate = new Date(vDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
            const visitNotif = {
              id: `visit_${lead.id}_${vDate}`,
              line1: `Site Visit · ${visitDate}`,
              line2: `${lead.assignedTo} - ${lead.name}`,
              type: "visit" as const
            };
            history.push({ ...visitNotif, id: `hist_visit_${lead.id}`, rawDate: new Date(vDate).getTime() });
            if (!seenSet.has(visitNotif.id)) {
              fresh.push(visitNotif);
              seenSet.add(visitNotif.id);
            }
          }
        }
      });

      setNotificationHistory(history.sort((a, b) => b.rawDate - a.rawDate).slice(0, 20));
      if (fresh.length > 0) {
        setNotifQueue(prev => [...prev, ...fresh]);
        setNotifCount(c => c + fresh.length);
        localStorage.setItem("crm_shown_notif_ids", JSON.stringify(Array.from(seenSet)));
      }
    };
    checkNotifs();
  }, [enquiries, user.name, siteHeads]);

  // Trigger Popup Logic (2 Seconds)
  useEffect(() => {
    if (activeNotif || notifQueue.length === 0) return;
    const next = notifQueue[0];
    setActiveNotif(next);
    setNotifQueue(prev => prev.slice(1));
    const timer = setTimeout(() => setActiveNotif(null), 2000);
    return () => clearTimeout(timer);
  }, [activeNotif, notifQueue]);

  // ─────────────────────────────────────────────────────────────────────────
  // MERGED LEADS (enrich with follow-up data, same as Sales Manager)
  // ─────────────────────────────────────────────────────────────────────────
  const mergedLeads = useMemo(() => {
    return enquiries.map((lead: any) => {
      const lf = followUps.filter((f: any) => String(f.leadId) === String(lead.id));
      const salesForms = lf.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
      const latestMsg = salesForms.length > 0 ? salesForms[salesForms.length - 1].message : "";
      const g = (field: string) => { if (!latestMsg) return "Pending"; const m = latestMsg.match(new RegExp(`• ${field}: (.*)`)); return m ? m[1].trim() : "Pending"; };

      const loanUpdates = lf.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
      let loanStatus = "N/A", loanAmtReq = "N/A", loanAmtApp = "N/A";
      if (loanUpdates.length > 0) {
        const msg = loanUpdates[loanUpdates.length - 1].message;
        const mS = msg.match(/• Status: (.*)/); if (mS) loanStatus = mS[1].trim();
        const mR = msg.match(/• Amount Requested: (.*)/); if (mR) loanAmtReq = mR[1].trim();
        const mA = msg.match(/• Amount Approved: (.*)/); if (mA) loanAmtApp = mA[1].trim();
      }

      const visitsWithDate = lf.filter((f: any) => f.siteVisitDate?.trim());
      const mongoVisitDate = visitsWithDate.length > 0 ? visitsWithDate[visitsWithDate.length - 1].siteVisitDate : null;
      const closingFups = lf.filter((f: any) => f.message?.includes("✅ Lead Marked as Closing"));
      const reopenFups = lf.filter((f: any) => f.message?.includes("↩️ Lead Reopened"));
      const lastReopenAt = reopenFups.length > 0 ? new Date(reopenFups[reopenFups.length - 1].createdAt).getTime() : 0;
      const closingFupsSinceReopen = closingFups.filter((f: any) => new Date(f.createdAt).getTime() > lastReopenAt);
      const closingDate = closingFupsSinceReopen.length > 0 ? closingFupsSinceReopen[closingFupsSinceReopen.length - 1].createdAt : null;
      const sfBudget = g("Budget");
      const activeBudget = (sfBudget !== "Pending" && sfBudget !== "N/A")
        ? sfBudget
        : (lead.budget || "Pending");

      return {
        ...lead,
        propType: (g("Property Type") !== "Pending" && g("Property Type") !== "N/A")
          ? g("Property Type")
          : (lead.configuration && lead.configuration !== "N/A" ? lead.configuration : "Pending"),
        salesBudget: activeBudget,
        useType: (g("Use Type") !== "Pending" && g("Use Type") !== "N/A")
          ? g("Use Type")
          : (lead.purpose || "Pending"),
        planningPurchase: g("Planning to Purchase"),
        loanPlanned: g("Loan Planned") !== "Pending" ? g("Loan Planned") : (lead.loan_planned || "Pending"),
        leadInterestStatus: g("Lead Status"),
        loanStatus, loanAmtReq, loanAmtApp,
        mongoVisitDate, closingDate,
        status: lead.status === "Closing" ? "Closing" : mongoVisitDate ? "Visit Scheduled" : lead.status,
      };
    });
  }, [enquiries, followUps]);

  // Receptionist-owned leads = assigned_receptionist === user.name OR assigned_to === user.name
  // This is already correct — lost leads are NOT excluded here, keep as is:
  const myAssignedLeads = useMemo(() =>
    mergedLeads.filter((l: any) =>
      (l.assignedReceptionist === user.name || l.assigned_to === user.name) &&
      l.status !== "Closing" &&
      !l.closingDate
    )
    , [mergedLeads, user.name]);

  const currentLeadFollowUps = useMemo(() =>
    followUps.filter((f: any) => String(f.leadId) === String(selectedLead?.id))
    , [followUps, selectedLead]);

  const isLeadLocked = !!selectedLead && (
    selectedLead.status === "Closing" || !!selectedLead.closingDate || selectedLead.is_lost_lead
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CSV EXPORT
  // ─────────────────────────────────────────────────────────────────────────
  const downloadCSV = (data: any[], filename: string) => {
    if (!data?.length) { alert("No data to export."); return; }
    const headers = Object.keys(data[0]);
    const rows = data.map(r => headers.map(k => JSON.stringify(r[k] ?? "", null)).join(","));
    const csv = [headers.join(","), ...rows].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.setAttribute("download", filename);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // Closed leads = status Closing OR has a closing follow-up
  const closedLeads = useMemo(() =>
    mergedLeads.filter((l: any) =>
      (l.status === "Closing" || !!l.closingDate) &&
      (l.assignedReceptionist === user.name || l.assigned_to === user.name)
    )
    , [mergedLeads, user.name]);

  const filteredClosedLeads = closedLeads.filter((l: any) =>
    (l.name || "").toLowerCase().includes(searchClosedLeads.toLowerCase()) ||
    String(l.id).includes(searchClosedLeads)
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ENQUIRY SUBMIT
  // ─────────────────────────────────────────────────────────────────────────
  const handleEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const assignTo = enquiryForm.selfAssign ? user.name : enquiryForm.assignedTo;
    const isReceptionist = enquiryForm.selfAssign;

    // Validate enquiry date when Auto Date is OFF
    if (!autoDate && !enquiryForm.enquiryDate) {
      alert("Please select an enquiry date.");
      setIsSubmitting(false);
      return;
    }

    const newEntry = {
      name: enquiryForm.fullName,
      phone: enquiryForm.mobile,
      alt_phone: enquiryForm.altMobile || null,
      email: enquiryForm.email || "N/A",
      address: enquiryForm.address || "N/A",
      occupation: enquiryForm.occupation || "N/A",
      organization: enquiryForm.organization || "N/A",
      budget: enquiryForm.budget || "Pending",
      configuration: enquiryForm.configuration || "N/A",
      purpose: enquiryForm.purpose || "N/A",
      source: enquiryForm.source,
      source_other: enquiryForm.source === "Others" ? enquiryForm.sourceOther : null,
      referral_name: enquiryForm.source === "Referral"
        ? enquiryForm.referralName
        : null,
      cp_name: enquiryForm.source === "Channel Partner" ? enquiryForm.cpDetails.name : null,
      cp_company: enquiryForm.source === "Channel Partner" ? enquiryForm.cpDetails.company : null,
      cp_phone: enquiryForm.source === "Channel Partner" ? enquiryForm.cpDetails.phone : null,
      loan_planned: enquiryForm.loanPlanned || "Pending",
      assignedTo: assignTo,
      assigned_receptionist: isReceptionist ? user.name : null,
      status: "ASSIGNED",
      auto_date_enabled: autoDate,
      enquiry_date: autoDate
        ? new Date().toISOString()
        : new Date(enquiryForm.enquiryDate + "T00:00:00").toISOString(),
    };

    try {
      const res = await fetch("/api/walkin_enquiries", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newEntry),
      });
      if (res.ok) {
        showToast(isReceptionist ? `Lead self-assigned to you!` : `Lead assigned to ${assignTo}!`);
        setIsEnquiryModalOpen(false);
        setEnquiryForm({ fullName: "", mobile: "", altMobile: "", email: "", address: "", occupation: "", organization: "", budget: "", configuration: "", purpose: "", source: "", assignedTo: "", loanPlanned: "", sourceOther: "", referralName: "", cpDetails: { name: "", company: "", phone: "" }, selfAssign: false, enquiryDate: getTodayString() });
        refetchAll();
      } else { alert("Server Error. Please check DB schema."); }
    } catch { alert("Network Error while submitting."); }
    finally { setIsSubmitting(false); }
  };

  const existingCPs = useMemo(() => {
    const map = new Map();
    mergedLeads.forEach((l: any) => {
      if (l.source === "Channel Partner" && l.cp_company && l.cp_company !== "N/A") {
        if (!map.has(l.cp_company)) {
          map.set(l.cp_company, { company: l.cp_company, phone: l.cp_phone || "" });
        }
      }
    });
    return Array.from(map.values());
  }, [mergedLeads]);

  // ─────────────────────────────────────────────────────────────────────────
  // SALES WORKFLOW ACTIONS
  // ─────────────────────────────────────────────────────────────────────────
  const getLatestLoanDetails = () => {
    if (!selectedLead) return null;
    let ex: Record<string, any> = { loanRequired: selectedLead.loanPlanned || "N/A", status: "Pending", bankName: "N/A", amountReq: "N/A", amountApp: "N/A", cibil: "N/A", agent: "N/A", agentContact: "N/A", empType: "N/A", income: "N/A", emi: "N/A", docPan: "Pending", docAadhaar: "Pending", docSalary: "Pending", docBank: "Pending", docProperty: "Pending", notes: "N/A" };
    const lu = currentLeadFollowUps.filter((f: any) => f.message?.includes("🏦 Loan Update:"));
    if (lu.length > 0) {
      const msg = lu[lu.length - 1].message;
      const g = (l: string) => { const m = msg.match(new RegExp(`• ${l}: (.*)`)); return m ? m[1].trim() : "N/A"; };
      ex = { loanRequired: g("Loan Required"), status: g("Status"), bankName: g("Bank Name"), amountReq: g("Amount Requested"), amountApp: g("Amount Approved"), cibil: g("CIBIL Score"), agent: g("Agent Name"), agentContact: g("Agent Contact"), empType: g("Employment Type"), income: g("Monthly Income"), emi: g("Existing EMIs"), docPan: g("PAN Card"), docAadhaar: g("Aadhaar Card"), docSalary: g("Salary Slips"), docBank: g("Bank Statements"), docProperty: g("Property Docs"), notes: g("Notes") };
    }
    return ex;
  };

  const getLoanStatusColor = (s: string) => {
    const sl = (s || "").toLowerCase();
    if (sl === "approved") return isDark ? "bg-green-900/20 text-green-400 border-green-500/30" : "bg-green-50 text-green-700 border-green-300";
    if (sl === "rejected") return isDark ? "bg-red-900/20 text-red-400 border-red-500/30" : "bg-red-50 text-red-700 border-red-300";
    if (sl === "in progress") return isDark ? "bg-yellow-900/20 text-yellow-400 border-yellow-500/30" : "bg-yellow-50 text-yellow-700 border-yellow-300";
    return isDark ? "bg-gray-900/20 text-gray-400 border-gray-500/30" : "bg-gray-50 text-gray-600 border-gray-300";
  };

  const prefillSalesForm = () => {
    if (!selectedLead) return;
    const sf = currentLeadFollowUps.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
    if (sf.length === 0) return;
    const msg = sf[sf.length - 1].message;
    const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; };
    setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" });
  };

  const prefillLoanForm = () => {
    const cur = getLatestLoanDetails();
    if (!cur) return;
    const n = (v: string) => v !== "N/A" ? v : "";
    setLoanForm({ loanRequired: n(cur.loanRequired), status: cur.status !== "Pending" ? cur.status : "", bank: n(cur.bankName), amountReq: n(cur.amountReq), amountApp: n(cur.amountApp), cibil: n(cur.cibil), agent: n(cur.agent), agentContact: n(cur.agentContact), empType: n(cur.empType), income: n(cur.income), emi: n(cur.emi), docPan: cur.docPan !== "N/A" ? cur.docPan : "Pending", docAadhaar: cur.docAadhaar !== "N/A" ? cur.docAadhaar : "Pending", docSalary: cur.docSalary !== "N/A" ? cur.docSalary : "Pending", docBank: cur.docBank !== "N/A" ? cur.docBank : "Pending", docProperty: cur.docProperty !== "N/A" ? cur.docProperty : "Pending", notes: n(cur.notes) });
  };

  const handleSendCustomNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customNote.trim() || !selectedLead) return;
    const nm = { leadId: String(selectedLead.id), salesManagerName: user.name, createdBy: "receptionist", message: customNote, siteVisitDate: null, createdAt: new Date().toISOString() };
    setCustomNote("");
    try { await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }); fetchFollowUps(); } catch (e) { console.error(e); }
  };

  const handleSalesFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    const msg = `📝 Detailed Salesform Submitted:\n• Property Type: ${salesForm.propertyType || "N/A"}\n• Location: ${salesForm.location || "N/A"}\n• Budget: ${salesForm.budget || "N/A"}\n• Use Type: ${salesForm.useType || "N/A"}\n• Planning to Purchase: ${salesForm.purchaseDate || "N/A"}\n• Loan Planned: ${salesForm.loanPlanned || "N/A"}\n• Lead Status: ${salesForm.leadStatus || "N/A"}\n• Site Visit Requested: ${salesForm.siteVisit ? formatDate(salesForm.siteVisit) : "No"}`;
    const nm = { leadId: String(selectedLead.id), salesManagerName: user.name, createdBy: "receptionist", message: msg, siteVisitDate: salesForm.siteVisit || null, createdAt: new Date().toISOString() };
    const ns = salesForm.siteVisit ? "Visit Scheduled" : selectedLead.status;
    setShowSalesForm(false);
    setSalesForm({ propertyType: "", location: "", budget: "", useType: "", purchaseDate: "", loanPlanned: "", siteVisit: "", leadStatus: "" });
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: ns }) });
      refetchAll();
    } catch (e) { console.error(e); }
  };

  const handleLoanFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    const msg = `🏦 Loan Update:\n• Loan Required: ${loanForm.loanRequired || "N/A"}\n• Status: ${loanForm.status || "N/A"}\n• Bank Name: ${loanForm.bank || "N/A"}\n• Amount Requested: ${loanForm.amountReq || "N/A"}\n• Amount Approved: ${loanForm.amountApp || "N/A"}\n• CIBIL Score: ${loanForm.cibil || "N/A"}\n• Agent Name: ${loanForm.agent || "N/A"}\n• Agent Contact: ${loanForm.agentContact || "N/A"}\n• Employment Type: ${loanForm.empType || "N/A"}\n• Monthly Income: ${loanForm.income || "N/A"}\n• Existing EMIs: ${loanForm.emi || "N/A"}\n• PAN Card: ${loanForm.docPan || "Pending"}\n• Aadhaar Card: ${loanForm.docAadhaar || "Pending"}\n• Salary Slips: ${loanForm.docSalary || "Pending"}\n• Bank Statements: ${loanForm.docBank || "Pending"}\n• Property Docs: ${loanForm.docProperty || "Pending"}\n• Notes: ${loanForm.notes || "N/A"}`;
    const nm = { leadId: String(selectedLead.id), salesManagerName: user.name, createdBy: "receptionist", message: msg, siteVisitDate: null, createdAt: new Date().toISOString() };
    setShowLoanForm(false);
    showToast(`Loan Data Logged for ${selectedLead.name}`, "blue");
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      fetchFollowUps();
    } catch (e) { console.error(e); }
  };

  const handleMarkAsClosing = async () => {
    if (!selectedLead || selectedLead.status === "Closing") return;
    const nm = { leadId: String(selectedLead.id), salesManagerName: user.name, createdBy: "receptionist", message: `✅ Lead Marked as Closing by ${user.name} (Receptionist)`, siteVisitDate: null, createdAt: new Date().toISOString() };
    try {
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Closing" }) });
      showToast(`🎉 ${selectedLead.name} marked as Closing!`);
      refetchAll();
    } catch (e) { console.error(e); }
  };
  const openLostLeadModal = () => {
    setLostReason("");
    setLostError("");
    setShowLostModal(true);
  };

  const handleMarkLostLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const reason = lostReason.trim();
    if (reason.length < 10) { setLostError("Reason must be at least 10 characters."); return; }
    setIsSavingLost(true);
    try {
      const res = await fetch("/api/leads/lost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          is_lost_lead: true,
          reason,
          marked_by: user.name,
        }),
      });
      const json = await res.json();
      if (!json.success) { setLostError(json.message || "Could not mark as lost."); return; }
      setSelectedLead((prev: any) => ({ ...prev, ...json.data, is_lost_lead: true }));
      setShowLostModal(false);
      showToast(`${selectedLead.name} marked as Lost Lead`, "red");
      refetchAll();
    } catch { setLostError("Network error. Please try again."); }
    finally { setIsSavingLost(false); }
  };

  const handleRestoreLead = async () => {
    if (!selectedLead) return;
    setIsSavingLost(true);
    try {
      const res = await fetch("/api/leads/lost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          is_lost_lead: false,
          restored_by: user.name,
        }),
      });
      const json = await res.json();
      if (!json.success) { showToast(json.message || "Could not restore lead", "red"); return; }
      setSelectedLead((prev: any) => ({ ...prev, ...json.data, is_lost_lead: false }));
      showToast(`${selectedLead.name} restored to Active`);
      refetchAll();
    } catch { showToast("Network error while restoring", "red"); }
    finally { setIsSavingLost(false); }
  };

  const handleReopenLead = async () => {
    if (!selectedLead || selectedLead.status !== "Closing") return;
    setIsReopening(true);
    try {
      await fetch(`/api/walkin_enquiries/${selectedLead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedLead.name, status: "Interested" }) });
      const nm = { leadId: String(selectedLead.id), salesManagerName: user.name, createdBy: "receptionist", message: `↩️ Lead Reopened by ${user.name} (Receptionist)`, siteVisitDate: null, createdAt: new Date().toISOString() };
      await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) });
      showToast(`${selectedLead.name} reopened`);
      refetchAll();
    } catch { showToast("Error reopening lead", "red"); }
    finally { setIsReopening(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSFER LEAD
  // ─────────────────────────────────────────────────────────────────────────
  const handleTransferLead = async () => {
    if (!selectedLead || !transferTarget || transferNote.trim().length < 50) return;
    setIsTransferring(true);

    try {
      const res = await fetch("/api/leads/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          transfer_to: transferTarget,
          transfer_note: transferNote,
          transferred_by: user.name,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Transfer failed");
      }

      setIsTransferModalOpen(false);
      setTransferNote("");
      setTransferTarget("");
      showToast(`✅ Lead #${selectedLead.id} transferred to ${transferTarget}!`);
      setAssignedSubView("cards");
      refetchAll();
    } catch (e: any) {
      alert(e.message ?? "Transfer failed. Try again.");
    } finally {
      setIsTransferring(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CHAT
  // ─────────────────────────────────────────────────────────────────────────
  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = chatInput.toLowerCase();
    setChatMessages(prev => [...prev, { sender: "user", text: chatInput }]);
    setChatInput("");
    setTimeout(() => {
      let aiResponse = "I can help you analyze your CRM data. Ask me about total leads or interested clients.";
      const matchedClient = mergedLeads.find((l: any) => userMsg.includes((l.name || "").toLowerCase().split(" ")[0]));
      if (matchedClient) {
        aiResponse = `Here is the data for ${matchedClient.name}:\n\n• Phone: ${maskPhone(matchedClient.phone)}\n• Email: ${matchedClient.email !== "N/A" ? matchedClient.email : "Not Provided"}\n• Budget: ${matchedClient.salesBudget}\n• Config: ${matchedClient.propType}\n• Status: ${matchedClient.status}\n• Created On: ${matchedClient.date}\n• Assigned To: ${matchedClient.assignedTo}`;
      } else if (userMsg.includes("total") || userMsg.includes("how many")) {
        aiResponse = `You currently have ${totalCount} total leads in the system. You personally handle ${myAssignedLeads.length} leads.`;
      } else if (userMsg.includes("my leads") || userMsg.includes("assigned")) {
        aiResponse = `You have ${myAssignedLeads.length} leads assigned to you. ${myAssignedLeads.filter((l: any) => l.status === "Visit Scheduled").length} have a site visit scheduled.`;
      }
      setChatMessages(prev => [...prev, { sender: "ai", text: aiResponse }]);
    }, 600);
  };

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  // ─────────────────────────────────────────────────────────────────────────
  // FILTERED SETS
  // ─────────────────────────────────────────────────────────────────────────
  const receptionistLeads = mergedLeads.filter((e: any) =>
    (e.name || "").toLowerCase().includes(searchRecep.toLowerCase()) ||
    String(e.id).includes(searchRecep) ||
    (e.phone || "").includes(searchRecep)
  );

  const filteredAssigned = myAssignedLeads.filter((l: any) =>
    (l.name || "").toLowerCase().includes(searchAssigned.toLowerCase()) ||
    String(l.id).includes(searchAssigned)
  );
  const paginatedAssigned = filteredAssigned.slice(0, assignedCardsPage * CARDS_PER_PAGE);
  const hasMoreAssigned = paginatedAssigned.length < filteredAssigned.length;

  const filteredRecepLeads = myAssignedLeads.filter((l: any) => {
    let passLost = true;
    if (leadStatusFilter === "lost") passLost = !!l.is_lost_lead;
    else if (leadStatusFilter === "active") passLost = !l.is_lost_lead;
    else passLost = showLostLeads || !l.is_lost_lead;

    let passNGD = true;
    const isNGD = l.status === "NON GENUINE DEMAND (NGD)" || l.leadStatus === "NON GENUINE DEMAND (NGD)" || l.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
    if (!showNGDLeads && isNGD) passNGD = false;

    if (!passLost || !passNGD) return false;

    return (
      (l.name || "").toLowerCase().includes(searchRecepLeads.toLowerCase()) ||
      String(l.id).includes(searchRecepLeads) ||
      (l.phone || "").includes(searchRecepLeads)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CHART DATA
  // ─────────────────────────────────────────────────────────────────────────
  const configTodayBarData = useMemo(() => {
    const filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= todayStart);
    const cc: Record<string, number> = {}; CONFIG_KEYS.forEach(k => cc[k] = 0);
    filtered.forEach((item: any) => { const c = String(item.configuration || "").trim(); if (cc[c] !== undefined) cc[c]++; else cc["Other"]++; });
    return CONFIG_KEYS.map((name, i) => ({ name, count: cc[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
  }, [mergedLeads, todayStart, t.chartColors]);

  const configMonthlyBarData = useMemo(() => {
    const filtered = mergedLeads.filter((e: any) => { if (!e.created_at) return false; const d = new Date(e.created_at); return d.getMonth() === configChartMonth && d.getFullYear() === dateNow.getFullYear(); });
    const cc: Record<string, number> = {}; CONFIG_KEYS.forEach(k => cc[k] = 0);
    filtered.forEach((item: any) => { const c = String(item.configuration || "").trim(); if (cc[c] !== undefined) cc[c]++; else cc["Other"]++; });
    return CONFIG_KEYS.map((name, i) => ({ name, count: cc[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
  }, [mergedLeads, configChartMonth, isDark]);

  const configInceptionBarData = useMemo(() => {
    const cc: Record<string, number> = {}; CONFIG_KEYS.forEach(k => cc[k] = 0);
    mergedLeads.forEach((item: any) => { const c = String(item.configuration || "").trim(); if (cc[c] !== undefined) cc[c]++; else cc["Other"]++; });
    return CONFIG_KEYS.map((name, i) => ({ name, count: cc[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
  }, [mergedLeads, t.chartColors]);

  const buildMonthStackedData = (numMonths: number) => {
    return Array.from({ length: numMonths }, (_, i) => numMonths - 1 - i).map(offset => {
      const d = new Date(dateNow.getFullYear(), dateNow.getMonth() - offset, 1);
      const monthIdx = d.getMonth(); const year = d.getFullYear();
      const filtered = mergedLeads.filter((e: any) => { if (!e.created_at) return false; const dd = new Date(e.created_at); return dd.getMonth() === monthIdx && dd.getFullYear() === year; });
      const entry: Record<string, any> = { month: MONTH_NAMES[monthIdx].slice(0, 3) };
      CONFIG_KEYS.forEach(k => { entry[k] = filtered.filter((e: any) => { const c = String(e.configuration || "").trim(); return k === "Other" ? !CONFIG_KEYS.slice(0, -1).includes(c) : c === k; }).length; });
      return entry;
    });
  };

  const config3MonthBarData = useMemo(() => buildMonthStackedData(3), [mergedLeads]);
  const config6MonthBarData = useMemo(() => buildMonthStackedData(6), [mergedLeads]);
  const configYearlyBarData = useMemo(() => buildMonthStackedData(12), [mergedLeads]);

  const enquiriesToday = useMemo(() => mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= todayStart).length, [mergedLeads]);
  const monthlyEnquiriesSelected = useMemo(() => mergedLeads.filter((e: any) => { if (!e.created_at) return false; const d = new Date(e.created_at); return d.getMonth() === selectedMonthCard && d.getFullYear() === dateNow.getFullYear(); }).length, [mergedLeads, selectedMonthCard]);
  const enquiries3Months = useMemo(() => mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= threeMonthsAgo).length, [mergedLeads]);
  const enquiries6Months = useMemo(() => mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= sixMonthsAgo).length, [mergedLeads]);
  const enquiriesYear = useMemo(() => mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= yearStart).length, [mergedLeads]);

  const managerLeadCountsFiltered = useMemo(() => {
    let filtered = mergedLeads;
    if (card3Mode === "today") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= todayStart);
    else if (card3Mode === "monthly") filtered = mergedLeads.filter((e: any) => { if (!e.created_at) return false; const d = new Date(e.created_at); return d.getMonth() === card3Month && d.getFullYear() === dateNow.getFullYear(); });
    else if (card3Mode === "3months") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= threeMonthsAgo);
    else if (card3Mode === "6months") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= sixMonthsAgo);
    else if (card3Mode === "yearly") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= yearStart);
    const c: Record<string, number> = {};
    filtered.forEach((e: any) => { const m = e.assignedTo || "Unassigned"; c[m] = (c[m] || 0) + 1; });
    return Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [mergedLeads, card3Mode, card3Month]);

  const sourceDataFiltered = useMemo(() => {
    let filtered = mergedLeads;
    if (card4Mode === "today") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= todayStart);
    else if (card4Mode === "monthly") filtered = mergedLeads.filter((e: any) => { if (!e.created_at) return false; const d = new Date(e.created_at); return d.getMonth() === card4Month && d.getFullYear() === dateNow.getFullYear(); });
    else if (card4Mode === "3months") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= threeMonthsAgo);
    else if (card4Mode === "6months") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= sixMonthsAgo);
    else if (card4Mode === "yearly") filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= yearStart);
    const counts: Record<string, number> = {}; LEAD_SOURCES.forEach(s => counts[s] = 0);
    filtered.forEach((e: any) => { const s = String(e.source || "Others").trim(); if (counts[s] !== undefined) counts[s]++; else counts["Others"] = (counts["Others"] || 0) + 1; });
    return LEAD_SOURCES.map((name, i) => ({ name, count: counts[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0).sort((a, b) => b.count - a.count);
  }, [mergedLeads, card4Mode, card4Month, t.chartColors]);

  const isConfigChartEmpty = (() => {
    if (chartMode1 === "today") return configTodayBarData.length === 0;
    if (chartMode1 === "monthly") return configMonthlyBarData.length === 0;
    if (chartMode1 === "inception") return configInceptionBarData.length === 0;
    const data = chartMode1 === "3months" ? config3MonthBarData : chartMode1 === "6months" ? config6MonthBarData : configYearlyBarData;
    return !data.some((d: any) => CONFIG_KEYS.some(k => d[k] > 0));
  })();

  const axisColor = isDark ? "#9ca3af" : "#6B7280";

  const CustomTooltip = ({ active, payload, label }: any) => active && payload?.length
    ? <div style={{ background: t.tooltipBg, border: t.tooltipBorder, borderRadius: 8, padding: "8px 12px", color: t.tooltipColor, fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
      <p style={{ color: t.legendColor, marginBottom: 4 }}>{label}</p>
      {payload.map((p: any, i: number) => <p key={i} style={{ fontWeight: 700, color: p.fill || p.color }}>{p.name}: {p.value}</p>)}
    </div>
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  // LOADERS
  // ─────────────────────────────────────────────────────────────────────────
  const LoaderRow = () => (
    <tr><td colSpan={9} className="p-6 text-center">
      <div className={`flex items-center justify-center gap-3 text-sm ${t.textMuted}`}>
        <div className="flex gap-1">{[0, 150, 300].map(d => <span key={d} className={`w-2 h-2 rounded-full animate-bounce ${isDark ? "bg-[#9E217B]" : "bg-[#00AEEF]"}`} style={{ animationDelay: `${d}ms` }} />)}</div>
        Loading more…
      </div>
    </td></tr>
  );

  const CardsLoader = () => (
    <div className={`col-span-full flex items-center justify-center gap-3 text-sm py-10 ${t.textMuted}`}>
      <div className="flex gap-1.5">{[0, 150, 300].map(d => <span key={d} className={`w-2 h-2 rounded-full animate-bounce ${isDark ? "bg-[#9E217B]" : "bg-[#00AEEF]"}`} style={{ animationDelay: `${d}ms` }} />)}</div>
      Loading more leads…
    </div>
  );

  // Shared form input classes
  const formInput = `w-full rounded-lg px-4 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${t.inputInner} ${t.text} ${t.inputFocus}`;

  return (
    <div
      className={`flex flex-col md:flex-row h-screen font-sans overflow-hidden ${t.pageWrap}`}
      style={isDark ? {} : { background: "linear-gradient(135deg, #e8f6fd 0%, #f8fafc 30%, #faf0fb 62%, #f8fafc 78%, #e6fafe 100%)" }}
    >
      {/* ── TOAST ── */}
      {toastMsg && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-xl shadow-lg flex items-center gap-4 animate-fadeIn border ${toastMsg.color === "green" ? "bg-green-600 border-green-400 text-white" : "bg-blue-600 border-blue-400 text-white"
          }`}>
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
          <img
            src="/assets/logobrowser_trans.png"
            alt="Logo"
            className={`w-10 h-10 rounded-xl object-cover flex-shrink-0 cursor-pointer transition-all duration-300`}
          />
          <div
            className="ml-3 overflow-hidden transition-all duration-300"
            style={{
              maxWidth: sidebarExpanded ? "130px" : "0px",
              opacity: sidebarExpanded ? 1 : 0,
              transform: sidebarExpanded ? "translateX(0)" : "translateX(-8px)",
            }}
          >
            <p className="text-white font-bold text-[16px] whitespace-nowrap leading-tight">Bhoomi CRM</p>
            <p className="text-[#d946a8] text-[10px] font-semibold whitespace-nowrap opacity-80">Receptionist</p>
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
          <div className="flex flex-col gap-2 flex-1">
            {NAV_ITEMS.map(({ id, icon, title }) => {
              const isActive = activeTab === id || (id === "forms" && activeTab === "detail");
              return (
                <div
                  key={id}
                  onClick={() => setActiveTab(id)}
                  title={!sidebarExpanded ? title : undefined}
                  className="relative cursor-pointer group"
                >
                  {isActive && (
                    <div
                      className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{
                        background: "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)",
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
            const isActive = activeTab === "settings";
            return (
              <div
                onClick={() => setActiveTab("settings")}
                title={!sidebarExpanded ? "Settings" : undefined}
                className="relative cursor-pointer group mt-auto"
              >
                {isActive && (
                  <div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      background: "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)",
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
                    <FaCog className="w-[20px] h-[20px]" />
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
                    Settings
                  </span>
                </div>
              </div>
            );
          })()}
        </nav>

        {/* Version tag */}
        <div className="px-3 mt-4">
          <div
            className="h-px mb-3"
            style={{ background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.35), transparent)" }}
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
      {/* Sidebar blur overlay — desktop only */}
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

      {/* ════════════════════════════════════════════════════
          MAIN CONTENT
      ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden relative md:ml-[72px]">

        {/* HEADER */}
        <header className={`h-16 border-b flex items-center justify-between px-6 flex-shrink-0 z-30 ${t.header}`} style={t.headerGlass}>
          <img src="/assets/bhoomidwellersLogo_trans.png" alt="Bhoomi CRM" className="h-20 md:h-18 w-auto object-contain" />
          <div className="flex items-center space-x-4 relative" ref={topbarRef}>
            <LoginTimerWidget isDark={isDark} />
            <button onClick={() => setIsDark(!isDark)} aria-label="Toggle theme"
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm ${t.toggleWrap}`}>
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
            {/* ── NOTIFICATION BELL & DROPDOWN ── */}
            <div className="relative">
              <button
                onClick={() => { setActivePopup(activePopup === "notifications" ? null : "notifications"); setNotifCount(0); }}
                className={`${t.textMuted} transition-colors relative cursor-pointer`}
              >
                <FaBell className="w-5 h-5" />
                {notifCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#9E217B] rounded-full text-[9px] font-black text-white flex items-center justify-center">
                    {notifCount > 9 ? "9+" : notifCount}
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
                    className={`absolute top-12 right-0 w-[320px] border rounded-xl shadow-2xl flex flex-col z-50 ${t.dropdown}`} style={t.dropdownGlass}
                  >
                    <div className={`p-4 border-b flex justify-between items-center ${t.tableBorder}`}>
                      <h3 className={`font-bold text-sm flex items-center gap-2 ${t.text}`}>
                        <FaBell className="text-[#9E217B]" /> Recent Notifications
                      </h3>
                      <button onClick={() => setActivePopup(null)} className={`${t.textMuted} hover:text-red-500`}><FaTimes className="text-xs" /></button>
                    </div>
                    <div className={`max-h-[360px] overflow-y-auto ${t.scroll}`}>
                      {notificationHistory.length === 0 ? (
                        <p className={`p-6 text-center text-xs ${t.textMuted}`}>No notifications yet.</p>
                      ) : (
                        notificationHistory.map((n) => (
                          <div key={n.id} className={`p-4 border-b last:border-b-0 transition-colors flex items-start gap-3 ${isDark ? "hover:bg-white/5 border-[#333]" : "hover:bg-black/5 border-[#E5E7EB]"}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white ${n.type === "visit" ? "bg-orange-500" : "bg-[#25D366]"}`}>
                              {n.type === "visit" ? <FaCalendarAlt className="text-[12px]" /> : <FaBriefcase className="text-[12px]" />}
                            </div>
                            <div>
                              <p className={`text-xs font-bold ${t.text}`}>{n.line1}</p>
                              <p className={`text-[10px] mt-1 ${t.textMuted}`}>{n.line2}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {/* {isNotificationsOpen && (
              <div className={`absolute top-12 right-12 w-72 rounded-xl shadow-2xl p-4 z-50 animate-fadeIn border ${t.dropdown}`} style={t.dropdownGlass}>
                <h3 className={`font-bold text-sm mb-3 border-b pb-2 ${t.text} ${t.tableBorder}`}>Notifications</h3>
                {myAssignedLeads.length > 0 ? (
                  <p className={`text-xs font-medium ${t.textMuted}`}>You have <span className={`font-bold ${t.accentText}`}>{myAssignedLeads.length}</span> leads assigned to you.</p>
                ) : (
                  <p className={`text-xs italic ${t.textFaint}`}>All caught up! No new notifications.</p>
                )}
              </div>
            )} */}
            <div onClick={() => setActivePopup(activePopup === "profile" ? null : "profile")}
              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer shadow-md hover:scale-105 transition-transform ${isDark ? "border border-[#9E217B]/40 text-[#d4006e] bg-[#9E217B]/15" : "border border-[#00AEEF]/40 text-[#00AEEF] bg-[#00AEEF]/10"}`}>
              {String(user?.name || "U").charAt(0).toUpperCase()}
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
            {/* ── TOAST NOTIFICATION POPUP ── */}
            {/* 👇 TOAST POPUP 👇 */}
            {activeNotif && (
              <div className="absolute top-[68px] right-0 z-[999] animate-fadeIn">
                <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border min-w-[280px] max-w-[360px] ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-white border-[#E5E7EB]"}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${activeNotif.type === "visit" ? "bg-orange-500" : "bg-[#25D366]"}`}>
                    {activeNotif.type === "visit" ? <FaCalendarAlt className="text-white text-lg" /> : <FaBriefcase className="text-white text-lg" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold truncate ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>{activeNotif.line1}</p>
                    <p className={`text-[11px] mt-0.5 truncate ${isDark ? "text-gray-400" : "text-[#6B7280]"}`}>{activeNotif.line2}</p>
                  </div>
                  <button onClick={() => setActiveNotif(null)} className={`flex-shrink-0 mt-0.5 p-0.5 rounded cursor-pointer ${t.textMuted}`}>
                    <FaTimes className="text-[10px]" />
                  </button>
                </div>
              </div>
            )}
          </div>

        </header>

        {/* ── MAIN SCROLL AREA ── */}
        <main className={`flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative ${t.mainBg}`}>

          {/* ────────────────────────────────────────────────────────────
              SETTINGS
          ──────────────────────────────────────────────────────────── */}
          {activeTab === "settings" && (
            <div className="animate-fadeIn max-w-4xl mx-auto">
              <h1 className={`text-3xl font-bold mb-8 ${t.text}`}>Settings & Profile</h1>
              <div className="w-full lg:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className={`rounded-2xl p-8 border flex flex-col items-center justify-center ${t.card}`} style={t.cardGlass}>
                  <FaCalendarAlt className={`text-5xl mb-4 ${t.accentText}`} />
                  <h2 className={`text-3xl lg:text-4xl font-black tracking-tight mb-2 ${t.text}`}>{currentTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</h2>
                  <p className={`font-medium text-sm lg:text-lg ${t.textMuted}`}>{currentTime.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
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

          {/* ────────────────────────────────────────────────────────────
              AI ASSISTANT
          ──────────────────────────────────────────────────────────── */}
          {activeTab === "assistant" && (
            <div className="animate-fadeIn h-[calc(100vh-130px)] flex flex-col pb-2">
              {/* ── Gemini-style Header ── */}
              <div className="flex items-center gap-4 mb-4 flex-shrink-0">
                <div style={{
                  width: 44, height: 44, borderRadius: 14, flexShrink: 0,
                  background: "linear-gradient(135deg, #4285f4 0%, #34a853 40%, #fbbc04 70%, #ea4335 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, boxShadow: "0 4px 16px rgba(66,133,244,0.35)",
                }}>✦</div>
                <div>
                  <h1 className={`text-xl font-bold tracking-tight ${t.text}`}
                    style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em" }}>
                    CRM AI Assistant
                  </h1>
                  <p className={`text-xs mt-0.5 ${t.textMuted}`}>
                    Ask about leads, stats, or client details
                  </p>
                </div>
                {/* Live indicator */}
                <div className="ml-auto flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full animate-pulse ${isDark ? "bg-green-400" : "bg-green-500"}`} />
                  <span className={`text-[10px] font-semibold uppercase tracking-widest ${t.textMuted}`}>Live</span>
                </div>
              </div>

              {/* ── Chat container ── */}
              <div className="flex-1 flex flex-col overflow-hidden rounded-2xl border min-h-0"
                style={{
                  background: isDark ? "#0f0f11" : "#f8fafc",
                  border: isDark ? "1px solid #1e1e26" : "1px solid #cbd5e1",
                  boxShadow: isDark
                    ? "0 0 0 1px rgba(66,133,244,0.06), 0 8px 32px rgba(0,0,0,0.5)"
                    : "0 2px 8px rgba(0,0,0,0.06), 0 16px 40px rgba(0,0,0,0.08)",
                }}>

                {/* ── Messages area ── */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-6 flex flex-col gap-5"
                  style={{ background: isDark ? "#0f0f11" : "#f8fafc" }}>

                  {chatMessages.map((msg, idx) => {
                    const isUser = msg.sender === "user";
                    return (
                      <div key={idx} className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                        style={{ animation: "fadeUp 0.25s ease both" }}>

                        {/* AI avatar */}
                        {!isUser && (
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                            background: "linear-gradient(135deg,#4285f4,#34a853)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, marginTop: 2,
                            boxShadow: "0 2px 8px rgba(66,133,244,0.3)",
                          }}>✦</div>
                        )}

                        {/* Bubble */}
                        <div style={{
                          maxWidth: "78%",
                          padding: isUser ? "10px 16px" : "14px 18px",
                          borderRadius: isUser
                            ? "18px 18px 4px 18px"
                            : "4px 18px 18px 18px",
                          background: isUser
                            ? (isDark
                              ? "linear-gradient(135deg,#1a73e8,#1558b0)"
                              : "linear-gradient(135deg,#9E217B,#7a1a5e)")
                            : (isDark ? "#1a1a22" : "#ffffff"),
                          border: isUser
                            ? "none"
                            : (isDark ? "1px solid #2a2a35" : "1px solid #e2e8f0"),
                          color: isUser
                            ? "#ffffff"
                            : (isDark ? "#e8eaed" : "#1e293b"),
                          fontSize: 13.5,
                          lineHeight: 1.75,
                          whiteSpace: "pre-wrap",
                          fontFamily: "'DM Sans', sans-serif",
                          fontWeight: isUser ? 500 : 400,
                          boxShadow: isUser
                            ? (isDark ? "0 4px 16px rgba(26,115,232,0.35)" : "0 4px 16px rgba(158,33,123,0.3)")
                            : (isDark ? "0 2px 8px rgba(0,0,0,0.3)" : "0 1px 4px rgba(0,0,0,0.06)"),
                        }}>
                          {/* Bold **text** renderer */}
                          {msg.text.split("\n").map((line, li) => {
                            const parts = line.split(/(\*\*[^*]+\*\*)/g);
                            return (
                              <div key={li} style={{ minHeight: line === "" ? "0.6em" : undefined }}>
                                {parts.map((part, pi) =>
                                  part.startsWith("**") && part.endsWith("**")
                                    ? <span key={pi} style={{
                                      fontWeight: 700,
                                      color: isUser ? "#fff" : (isDark ? "#8ab4f8" : "#9E217B"),
                                    }}>{part.slice(2, -2)}</span>
                                    : <span key={pi}>{part}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* User avatar */}
                        {isUser && (
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                            background: isDark
                              ? "linear-gradient(135deg,#7c3aed,#4f46e5)"
                              : "linear-gradient(135deg,#9E217B,#d4006e)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, marginTop: 2, color: "#fff", fontWeight: 700,
                          }}>
                            {String(user?.name || "U").charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Typing indicator */}
                  {false /* replace with your typing state if needed */ && (
                    <div className="flex gap-3 justify-start">
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: "linear-gradient(135deg,#4285f4,#34a853)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                      }}>✦</div>
                      <div style={{
                        padding: "12px 16px", borderRadius: "4px 18px 18px 18px",
                        background: isDark ? "#1a1a22" : "#ffffff",
                        border: isDark ? "1px solid #2a2a35" : "1px solid #e2e8f0",
                        display: "flex", gap: 5, alignItems: "center",
                      }}>
                        {[0, 1, 2].map(i => (
                          <span key={i} style={{
                            width: 7, height: 7, borderRadius: "50%",
                            background: isDark ? "#8ab4f8" : "#9E217B",
                            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                            display: "block",
                          }} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestion chips — only shown when conversation is fresh */}
                  {chatMessages.length <= 2 && (
                    <div className="mt-2">
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${t.textFaint}`}>
                        Try asking
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          "My assigned leads",
                          "Total leads this week",
                          "How many today?",
                          `Show ${myAssignedLeads[0]?.name?.split(" ")[0] || "a client"}`,
                          "Leads with site visits",
                          "Total all time",
                        ].map(chip => (
                          <button key={chip}
                            onClick={() => {
                              setChatInput(chip);
                              // Directly trigger submit
                              const syntheticEvent = { preventDefault: () => { } } as React.FormEvent;
                              const saved = chatInput;
                              setChatInput(chip);
                              setTimeout(() => {
                                const q = chip;
                                setChatMessages(prev => [...prev, { sender: "user", text: q }]);
                                setChatInput("");
                                setTimeout(() => {
                                  let aiResponse = "I can help you analyze your CRM data. Try asking about total leads or a specific client's name.";
                                  const userMsg = q.toLowerCase();
                                  const matchedClient = mergedLeads.find((l: any) =>
                                    userMsg.includes((l.name || "").toLowerCase().split(" ")[0])
                                  );
                                  if (matchedClient) {
                                    aiResponse = `**Lead Found — ${matchedClient.name}**\n━━━━━━━━━━━━━━━━━\n📅 Entered: ${matchedClient.date}\n📞 Phone: ${maskPhone(matchedClient.phone)}\n💰 Budget: ${matchedClient.salesBudget || matchedClient.budget}\n🏗️ Config: ${matchedClient.propType || matchedClient.configuration || "N/A"}\n📊 Status: ${matchedClient.status}\n👤 Assigned: ${matchedClient.assignedTo}`;
                                  } else if (userMsg.includes("total") || userMsg.includes("how many") || userMsg.includes("all time")) {
                                    aiResponse = `**📊 Lead Count Overview**\n━━━━━━━━━━━━━━━━━\nTotal in system: **${totalCount}**\nAssigned to you: **${myAssignedLeads.length}**\nWith site visits: **${myAssignedLeads.filter((l: any) => l.status === "Visit Scheduled").length}**\nClosing stage: **${closedLeads.length}**`;
                                  } else if (userMsg.includes("my") || userMsg.includes("assigned")) {
                                    aiResponse = `**📋 Your Assigned Leads (${myAssignedLeads.length})**\n━━━━━━━━━━━━━━━━━\n${myAssignedLeads.slice(0, 5).map((l: any, i: number) => `${i + 1}. **${l.name}** — ${l.status} | ${l.salesBudget || l.budget}`).join("\n")}${myAssignedLeads.length > 5 ? `\n…and ${myAssignedLeads.length - 5} more.` : ""}`;
                                  } else if (userMsg.includes("site visit")) {
                                    const sv = myAssignedLeads.filter((l: any) => l.status === "Visit Scheduled");
                                    aiResponse = sv.length > 0
                                      ? `**🏠 Site Visit Leads (${sv.length})**\n━━━━━━━━━━━━━━━━━\n${sv.map((l: any) => `• **${l.name}** — ${formatDate(l.mongoVisitDate)}`).join("\n")}`
                                      : "No site visits currently scheduled.";
                                  } else if (userMsg.includes("week")) {
                                    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
                                    const thisWeek = mergedLeads.filter((l: any) => l.created_at && new Date(l.created_at) >= weekStart);
                                    aiResponse = `**📅 This Week's Activity**\n━━━━━━━━━━━━━━━━━\nLeads entered: **${thisWeek.length}**\nYour leads this week: **${thisWeek.filter((l: any) => l.assignedReceptionist === user.name || l.assigned_to === user.name).length}**`;
                                  }
                                  setChatMessages(prev => [...prev, { sender: "ai", text: aiResponse }]);
                                }, 650);
                              }, 0);
                            }}
                            style={{
                              padding: "7px 14px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: "pointer",
                              transition: "all 0.15s",
                              fontFamily: "'DM Sans', sans-serif",
                              background: isDark ? "rgba(138,180,248,0.08)" : "rgba(0,0,0,0.04)",
                              color: isDark ? "#8ab4f8" : "#475569",
                              border: isDark ? "1px solid rgba(138,180,248,0.15)" : "1px solid #cbd5e1",
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(138,180,248,0.18)" : "#fff";
                              (e.currentTarget as HTMLElement).style.borderColor = isDark ? "rgba(138,180,248,0.4)" : "#9E217B";
                              (e.currentTarget as HTMLElement).style.color = isDark ? "#fff" : "#9E217B";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLElement).style.background = isDark ? "rgba(138,180,248,0.08)" : "rgba(0,0,0,0.04)";
                              (e.currentTarget as HTMLElement).style.borderColor = isDark ? "rgba(138,180,248,0.15)" : "#cbd5e1";
                              (e.currentTarget as HTMLElement).style.color = isDark ? "#8ab4f8" : "#475569";
                            }}
                          >{chip}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* ── Input bar ── */}
                <div style={{
                  padding: "12px 16px 16px",
                  borderTop: isDark ? "1px solid #1e1e26" : "1px solid #e2e8f0",
                  background: isDark ? "rgba(15,15,17,0.98)" : "rgba(248,250,252,0.98)",
                  backdropFilter: "blur(12px)",
                  flexShrink: 0,
                }}>
                  <form onSubmit={handleChatSubmit} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center",
                      background: isDark ? "#1a1a22" : "#ffffff",
                      border: isDark ? "1.5px solid #2a2a35" : "1.5px solid #cbd5e1",
                      borderRadius: 26, padding: "3px 6px 3px 18px",
                      transition: "border-color 0.2s",
                    }}
                      onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = isDark ? "#8ab4f8" : "#9E217B"}
                      onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = isDark ? "#2a2a35" : "#cbd5e1"}
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        placeholder="Ask about leads, stats, or client details…"
                        style={{
                          flex: 1, background: "transparent", border: "none", outline: "none",
                          color: isDark ? "#e8eaed" : "#1e293b",
                          fontSize: 13.5, fontFamily: "'DM Sans', sans-serif",
                          padding: "10px 0",
                        }}
                      />
                      {chatInput && (
                        <button type="button" onClick={() => setChatInput("")}
                          style={{
                            background: "transparent", border: "none", cursor: "pointer",
                            color: isDark ? "#5f6368" : "#94a3b8", fontSize: 15, padding: "0 4px",
                          }}>✕</button>
                      )}
                    </div>

                    {/* Send button */}
                    <button type="submit" disabled={!chatInput.trim()}
                      style={{
                        width: 44, height: 44, borderRadius: "50%", border: "none",
                        cursor: chatInput.trim() ? "pointer" : "not-allowed",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 16, transition: "all 0.2s",
                        background: chatInput.trim()
                          ? (isDark
                            ? "linear-gradient(135deg,#1a73e8,#1558b0)"
                            : "linear-gradient(135deg,#9E217B,#d4006e)")
                          : (isDark ? "#1a1a22" : "#f1f5f9"),
                        color: chatInput.trim() ? "#ffffff" : (isDark ? "#3c3c40" : "#94a3b8"),
                        boxShadow: chatInput.trim()
                          ? (isDark ? "0 4px 16px rgba(26,115,232,0.4)" : "0 4px 16px rgba(158,33,123,0.35)")
                          : "none",
                        transform: chatInput.trim() ? "scale(1)" : "scale(0.95)",
                      }}>
                      <FaPaperPlane style={{ marginLeft: -1 }} />
                    </button>
                  </form>

                  <p style={{
                    textAlign: "center", marginTop: 10, fontSize: 10,
                    color: isDark ? "#3c3c40" : "#94a3b8",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    Phone numbers are masked · Transferred leads show role only
                  </p>
                </div>
              </div>

              {/* Keyframe for fadeUp */}
              <style dangerouslySetInnerHTML={{
                __html: `
                @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
                @keyframes fadeUp {
                  from { opacity: 0; transform: translateY(8px); }
                  to   { opacity: 1; transform: translateY(0); }
                }
              `}} />
            </div>
          )}

          {/* ── SHARED PAGE HEADER ── */}
          {!["settings", "detail", "assistant", "assigned", "recep-leads", "closed-leads", "attendance"].includes(activeTab) && (
            <div className="flex justify-between items-center mb-8">
              <h1 className={`text-xl md:text-3xl font-bold flex items-center flex-wrap gap-2 md:gap-3 ${t.text}`}>
                Hi, {String(user?.name || "User").split(" ")[0]}
                <span className={`text-xs md:text-sm font-medium px-2 py-0.5 md:px-3 md:py-1 rounded-full capitalize ${isDark ? "text-[#9E217B] bg-white/80 border border-[#9E217B]/40" : "text-[#9E217B] bg-[#9E217B]/10 border border-[#9E217B]/20"}`}>Front Desk</span>
              </h1>
              <button onClick={refetchAll} className={`text-white text-xs md:text-sm font-semibold flex items-center gap-1 md:gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-all shadow-sm ${t.btnPrimary}`}>
                <span className="md:hidden">↻ Sync</span>
                <span className="hidden md:inline">↻ Refresh Live Data</span>
              </button>
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              OVERVIEW TAB
          ════════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <div className="animate-fadeIn pb-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

                {/* Card 1: Room Configurations */}
                <div className={`rounded-2xl p-6 border flex flex-col ${t.card}`} style={t.cardGlass}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className={`text-base font-bold ${t.text}`}>Room Configurations</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => {
                        let d: any[] = [];
                        if (chartMode1 === "today") d = configTodayBarData;
                        else if (chartMode1 === "monthly") d = configMonthlyBarData;
                        else if (chartMode1 === "inception") d = configInceptionBarData;
                        else d = (chartMode1 === "3months" ? config3MonthBarData : chartMode1 === "6months" ? config6MonthBarData : configYearlyBarData);
                        downloadCSV(d.map(({ color, monthIdx, year, ...r }: any) => r), `Room_Configurations_${chartMode1}.csv`);
                      }} className={`p-1.5 border rounded-md ${t.exportBtn}`} title="Export CSV"><FaDownload size={12} /></button>
                      {chartMode1 === "monthly" && (
                        <select value={configChartMonth} onChange={e => setConfigChartMonth(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-1 outline-none cursor-pointer border ${t.selectSmall}`}>
                          {MONTH_NAMES.map((m, idx) => <option key={idx} value={idx}>{m}</option>)}
                        </select>
                      )}
                      <select value={chartMode1} onChange={e => setChartMode1(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border ${t.selectSmall}`}>
                        <option value="today">Today</option><option value="monthly">Monthly</option>
                        <option value="3months">Last 3 Months</option><option value="6months">Last 6 Months</option>
                        <option value="yearly">Yearly</option><option value="inception">Inception</option>
                      </select>
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-3 ${t.accentText}`}>
                    {chartMode1 === "today" && `Today — ${dateNow.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                    {chartMode1 === "monthly" && `${MONTH_NAMES[configChartMonth]} ${dateNow.getFullYear()}`}
                    {chartMode1 === "3months" && "Last 3 Months"}{chartMode1 === "6months" && "Last 6 Months"}
                    {chartMode1 === "yearly" && `Year ${dateNow.getFullYear()}`}{chartMode1 === "inception" && "All Time"}
                  </p>
                  {isFetchingEnquiries ? (
                    <div className={`flex-1 flex items-center justify-center text-sm ${t.textMuted} min-h-[230px]`}>Calculating…</div>
                  ) : isConfigChartEmpty ? (
                    <div className={`w-full h-[230px] mt-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed ${isDark ? "border-[#2A2A35]" : "border-gray-200"}`}>
                      <span className={`text-sm font-medium ${t.textMuted}`}>No data available</span>
                    </div>
                  ) : (
                    <div className="w-full h-[230px]">
                      <ResponsiveContainer width="100%" height="100%">
                        {(() => {
                          let pieData: any[] = [];
                          if (chartMode1 === "today") pieData = configTodayBarData;
                          else if (chartMode1 === "monthly") pieData = configMonthlyBarData;
                          else if (chartMode1 === "inception") pieData = configInceptionBarData;
                          else {
                            const src = chartMode1 === "3months" ? config3MonthBarData : chartMode1 === "6months" ? config6MonthBarData : configYearlyBarData;
                            pieData = CONFIG_KEYS.map((key, i) => ({ name: key, count: src.reduce((s: number, item: any) => s + (item[key] || 0), 0), color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
                          }
                          return (
                            <PieChart>
                              <Pie data={pieData} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                                {pieData.map((_: any, i: number) => <Cell key={i} fill={pieData[i].color} />)}
                              </Pie>
                              <Tooltip content={<CustomTooltip />} />
                              <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: "10px", color: t.legendColor, paddingTop: "10px" }} />
                            </PieChart>
                          );
                        })()}
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Card 4: Lead Sources */}
                <div className={`rounded-2xl p-6 border flex flex-col ${t.card}`} style={t.cardGlass}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className={`text-base font-bold ${t.text}`}>Lead Sources</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => downloadCSV(sourceDataFiltered.map(({ color, ...r }: any) => r), `Lead_Sources_${card4Mode}.csv`)} className={`p-1.5 border rounded-md ${t.exportBtn}`} title="Export CSV"><FaDownload size={12} /></button>
                      {card4Mode === "monthly" && (
                        <select value={card4Month} onChange={e => setCard4Month(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-1 outline-none cursor-pointer border ${t.selectSmall}`}>
                          {MONTH_NAMES.map((m, idx) => <option key={idx} value={idx}>{m}</option>)}
                        </select>
                      )}
                      <select value={card4Mode} onChange={e => setCard4Mode(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border ${t.selectSmall}`}>
                        <option value="today">Today</option><option value="monthly">Monthly</option>
                        <option value="3months">Last 3 Months</option><option value="6months">Last 6 Months</option>
                        <option value="yearly">Yearly</option><option value="inception">Inception</option>
                      </select>
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-3 ${t.accentText}`}>
                    {card4Mode === "today" && `Today — ${dateNow.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                    {card4Mode === "monthly" && `${MONTH_NAMES[card4Month]} ${dateNow.getFullYear()}`}
                    {card4Mode === "3months" && "Last 3 Months"}{card4Mode === "6months" && "Last 6 Months"}
                    {card4Mode === "yearly" && `Year ${dateNow.getFullYear()}`}{card4Mode === "inception" && "All Time"}
                  </p>
                  {isFetchingEnquiries ? (
                    <div className={`flex-1 flex items-center justify-center text-sm ${t.textMuted} min-h-[230px]`}>Calculating…</div>
                  ) : sourceDataFiltered.length === 0 ? (
                    <div className={`w-full h-[230px] flex items-center justify-center rounded-xl border-2 border-dashed ${isDark ? "border-[#2A2A35]" : "border-gray-200"}`}>
                      <span className={`text-sm font-medium ${t.textMuted}`}>No data available</span>
                    </div>
                  ) : (
                    <div className="w-full h-[230px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={sourceDataFiltered} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                            {sourceDataFiltered.map((_: any, i: number) => <Cell key={i} fill={sourceDataFiltered[i].color} />)}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: "10px", color: t.legendColor, paddingTop: "10px" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Card 2: Enquiry Details */}
                <div className={`rounded-2xl p-6 border flex flex-col gap-4 ${t.card}`} style={t.cardGlass}>
                  <div className="flex items-center justify-between">
                    <h2 className={`text-base font-bold ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}>Enquiry Details</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => {
                        let f = mergedLeads;
                        if (card2Mode === "today") f = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= todayStart);
                        else if (card2Mode === "monthly") f = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at).getMonth() === selectedMonthCard && new Date(e.created_at).getFullYear() === dateNow.getFullYear());
                        else if (card2Mode === "3months") f = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= threeMonthsAgo);
                        else if (card2Mode === "6months") f = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= sixMonthsAgo);
                        else if (card2Mode === "yearly") f = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= yearStart);
                        downloadCSV(f.map((e: any) => ({ "Lead No": e.id, "Client Name": e.name, "Budget": e.salesBudget || "N/A", "Configuration": e.configuration || "N/A", "Purpose": e.purpose || "N/A", "Source": e.source || "N/A", "Date": e.date, "Assigned To": e.assignedTo || "Unassigned" })), `Enquiries_${card2Mode}.csv`);
                      }} className={`p-1.5 border rounded-md transition-colors ${isDark ? "border-[#9E217B]/30 text-[#d4006e]" : "border-[#9E217B]/30 text-[#9E217B]"}`} title="Export CSV"><FaDownload size={12} /></button>
                      <select value={card2Mode} onChange={e => setCard2Mode(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border ${t.selectSmall}`}>
                        <option value="today">Today</option><option value="monthly">Monthly</option>
                        <option value="3months">Last 3 Months</option><option value="6months">Last 6 Months</option>
                        <option value="yearly">Yearly</option><option value="alltime">Total All Time</option>
                      </select>
                    </div>
                  </div>
                  <div className={`rounded-xl p-5 border flex-1 flex flex-col ${isDark ? "bg-[#9E217B]/5 border-[#9E217B]/20" : "bg-[#9E217B]/5 border-[#9E217B]/20"}`}>
                    <div className="flex items-center justify-between mb-4">
                      <p className={`text-xs font-bold uppercase tracking-wider ${t.textFaint}`}>
                        {card2Mode === "today" && "Today"}{card2Mode === "monthly" && "Monthly"}{card2Mode === "3months" && "Last 3 Months"}
                        {card2Mode === "6months" && "Last 6 Months"}{card2Mode === "yearly" && "Yearly"}{card2Mode === "alltime" && "All Time"}
                      </p>
                      {card2Mode === "monthly" && (
                        <select value={selectedMonthCard} onChange={e => setSelectedMonthCard(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-0.5 outline-none cursor-pointer border ${t.selectSmall}`}>
                          {MONTH_NAMES.map((m, idx) => <option key={idx} value={idx}>{m}</option>)}
                        </select>
                      )}
                    </div>
                    <p className={`text-7xl font-black leading-none ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}>
                      {isFetchingEnquiries ? "…" :
                        card2Mode === "today" ? enquiriesToday :
                          card2Mode === "monthly" ? monthlyEnquiriesSelected :
                            card2Mode === "3months" ? enquiries3Months :
                              card2Mode === "6months" ? enquiries6Months :
                                card2Mode === "yearly" ? enquiriesYear : totalCount
                      }
                    </p>
                    <p className={`text-sm mt-4 font-medium ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}>
                      {card2Mode === "today" && `Enquiries on ${dateNow.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                      {card2Mode === "monthly" && `Enquiries in ${MONTH_NAMES[selectedMonthCard]} ${dateNow.getFullYear()}`}
                      {card2Mode === "3months" && "Enquiries over 3 months"}
                      {card2Mode === "6months" && "Enquiries over 6 months"}
                      {card2Mode === "yearly" && `Enquiries in ${dateNow.getFullYear()}`}
                      {card2Mode === "alltime" && "Total enquiries captured"}
                    </p>
                  </div>
                </div>

                {/* Card 3: Sales Manager Activity */}
                <div className={`rounded-2xl p-6 border flex flex-col ${t.card}`} style={t.cardGlass}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className={`text-base font-bold ${t.text}`}>Sales Manager Activity</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => downloadCSV(managerLeadCountsFiltered.map(m => ({ "Sales Manager": m.name, "Total Enquiries": m.count })), `SM_Activity_${card3Mode}.csv`)} className={`p-1.5 border rounded-md ${t.exportBtn}`} title="Export CSV"><FaDownload size={12} /></button>
                      {card3Mode === "monthly" && (
                        <select value={card3Month} onChange={e => setCard3Month(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-1 outline-none cursor-pointer border ${t.selectSmall}`}>
                          {MONTH_NAMES.map((m, idx) => <option key={idx} value={idx}>{m}</option>)}
                        </select>
                      )}
                      <select value={card3Mode} onChange={e => setCard3Mode(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border ${t.selectSmall}`}>
                        <option value="today">Today</option><option value="monthly">Monthly</option>
                        <option value="3months">Last 3 Months</option><option value="6months">Last 6 Months</option>
                        <option value="yearly">Yearly</option><option value="inception">Inception</option>
                      </select>
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-3 flex items-center justify-between ${t.accentText}`}>
                    <span>{card3Mode === "today" && `Today — ${dateNow.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}{card3Mode === "monthly" && `${MONTH_NAMES[card3Month]} ${dateNow.getFullYear()}`}{card3Mode === "3months" && "Last 3 Months"}{card3Mode === "6months" && "Last 6 Months"}{card3Mode === "yearly" && `Year ${dateNow.getFullYear()}`}{card3Mode === "inception" && "All Time"}</span>
                    <span className={t.textFaint}>{managerLeadCountsFiltered.length} managers</span>
                  </p>
                  <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[250px] pr-2">
                    <table className="w-full text-sm">
                      <thead><tr className={`border-b ${t.tableBorder}`}>
                        <th className={`text-left py-2 px-1 text-xs font-bold uppercase tracking-wider ${t.textFaint}`}>Sales Manager</th>
                        <th className={`text-right py-2 px-1 text-xs font-bold uppercase tracking-wider ${t.textFaint}`}>Enquiries</th>
                      </tr></thead>
                      <tbody className={`divide-y ${t.tableDivide}`}>
                        {isFetchingEnquiries ? (
                          <tr><td colSpan={2} className={`text-center py-4 text-xs ${t.textMuted}`}>Loading...</td></tr>
                        ) : managerLeadCountsFiltered.length === 0 ? (
                          <tr><td colSpan={2} className={`text-center py-4 text-xs ${t.textMuted}`}>No data for this period</td></tr>
                        ) : managerLeadCountsFiltered.map((row: any, i: number) => (
                          <tr key={i} className={`transition-colors ${t.tableRow}`}>
                            <td className={`py-2.5 px-1 font-semibold text-xs ${t.text}`}>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-[#9E217B]">{String(row.name).charAt(0).toUpperCase()}</div>
                                <span className="truncate max-w-[100px]">{row.name}</span>
                              </div>
                            </td>
                            <td className={`py-2.5 px-1 text-right font-black text-sm ${t.accentText}`}>{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Front Desk Log */}
              <div className={`rounded-2xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
                <div className={`p-4 md:p-6 border-b flex justify-between items-center ${t.tableBorder}`}>
                  <div>
                    <h2 className={`text-base md:text-lg font-bold flex items-center gap-3 ${t.text}`}>
                      Front Desk Log

                    </h2>
                    <p className={`text-xs mt-0.5 ${t.textFaint}`}>{receptionistLeads.length} shown · {totalCount} total</p>
                  </div>
                  <div className="flex gap-4 items-center">
                    <div className="relative hidden md:block">
                      <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                      <input type="text" placeholder="Search leads..." value={searchRecep} onChange={e => setSearchRecep(e.target.value)}
                        className={`rounded-lg pl-9 pr-4 py-2 text-sm outline-none w-48 transition-colors border ${t.inputBg} ${t.text}`} />
                    </div>
                    <button onClick={() => setIsEnquiryModalOpen(true)} className={`font-bold py-1.5 px-3 md:py-2 md:px-4 rounded-lg transition-colors text-xs flex items-center gap-2 cursor-pointer ${t.btnPrimary}`}>+ New Entry</button>
                  </div>
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead><tr className={t.tableHead}>
                      {["Lead No.", "Client Name", "CP Name", "CP Company", "CP Phone", "Budget", "Phone", "Alt. Phone", "Date Created", "Backdated Entry", "Sales Manager"].map(h => (
                        <th key={h} className={`px-3 py-3 md:p-4 font-bold uppercase tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className={`${t.tableDivide} divide-y`}>
                      {isFetchingEnquiries ? (
                        <tr><td colSpan={11} className={`p-8 text-center text-sm ${t.textMuted}`}>Fetching data...</td></tr>
                      ) : receptionistLeads.length === 0 ? (
                        <tr><td colSpan={11} className={`p-8 text-center text-sm ${t.textMuted}`}>No leads found.</td></tr>
                      ) : receptionistLeads.map((enquiry: any) => (
                        <tr key={enquiry.id} className={`transition-colors cursor-pointer ${t.tableRow}`} onClick={() => { setSelectedLead(enquiry); setActiveTab("detail"); }}>
                          <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-bold ${t.accentText}`}>#{enquiry.id}</td>
                          <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-semibold ${t.text}`}>{enquiry.name}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm truncate max-w-[100px] ${t.textMuted}`}>{enquiry.cp_name || <span className="italic text-[10px]">—</span>}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm truncate max-w-[100px] ${t.textMuted}`}>{enquiry.cp_company || <span className="italic text-[10px]">—</span>}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm truncate max-w-[100px] ${t.textMuted}`}>{enquiry.cp_phone || <span className="italic text-[10px]">—</span>}</td>
                          <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-bold ${isDark ? "text-green-700" : "text-emerald-600"}`}>{enquiry.salesBudget || enquiry.budget}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm font-mono ${t.text}`}>{maskPhone(enquiry.phone)}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm font-mono ${t.textMuted}`}>{maskPhone(enquiry.altPhone)}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-xs whitespace-normal min-w-[120px] ${t.textFaint}`}>{enquiry.date}</td>
                          <td className={`px-3 py-3 md:p-4 text-[10px] md:text-xs whitespace-normal min-w-[110px] ${t.textFaint}`}>
                            {enquiry.autoDateEnabled === false && enquiry.enquiryDate ? formatDate(enquiry.enquiryDate).split(",")[0] : "-"}
                          </td>
                          <td className="px-3 py-3 md:p-4 text-xs md:text-sm">
                            <span className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-semibold ${t.accentBg}`}>{enquiry.assignedTo || "Unassigned"}</span>
                          </td>
                        </tr>
                      ))}
                      {isLoadingMore && <LoaderRow />}
                      {!hasMore && !isFetchingEnquiries && enquiries.length > 0 && (
                        <tr><td colSpan={11} className={`p-4 text-center text-xs ${t.textFaint}`}>All {totalCount} records loaded</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div ref={tableSentinelRef} className="h-1 w-full" aria-hidden="true" />
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              FORMS TAB (card grid)
          ════════════════════════════════════════════════════ */}
          {activeTab === "forms" && (
            <div className="animate-fadeIn">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                  <h2 className={`text-xl font-bold ${t.text}`}>Recent Enquiries</h2>
                  {hasMore && <p className={`text-xs mt-0.5 ${t.accentText}`}>· scroll for more</p>}
                </div>
                <div className="flex gap-4 items-center">
                  <div className="relative">
                    <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                    <input type="text" placeholder="Search..." value={searchRecep} onChange={e => setSearchRecep(e.target.value)} className={`rounded-lg pl-9 pr-4 py-2 text-sm outline-none w-48 transition-colors border ${t.inputBg} ${t.text}`} />
                  </div>
                  <button
                    onClick={() => setIsEnquiryModalOpen(true)}
                    className={`
                      flex items-center justify-center gap-2
                      font-medium rounded-lg
                      transition-all duration-200
                      cursor-pointer whitespace-nowrap

                      /* Mobile */
                      h-10 px-3 text-sm

                      /* Desktop */
                      sm:h-11 sm:px-5 sm:text-sm

                      /* Colors */
                      ${t.btnPrimary}

                      /* Effects */
                      hover:shadow-md active:scale-95
                    `}
                  >
                    <FaClipboardList className="text-base" />

                    <span className="hidden sm:inline">
                      Add New Form
                    </span>
                  </button>
                </div>
              </div>
              {isFetchingEnquiries ? (
                <div className={`text-center py-10 ${t.textMuted}`}>Fetching live database forms...</div>
              ) : receptionistLeads.length === 0 ? (
                <div className={`text-center py-10 ${t.textMuted}`}>No matching forms found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {receptionistLeads.map((enquiry: any, index: number) => (
                    <div
                      key={enquiry.id ?? index}
                      className={`rounded-2xl p-6 border cursor-pointer group flex flex-col justify-between transition-all ${t.card}`}
                      style={t.cardGlass}
                      onClick={() => { setSelectedLead(enquiry); setActiveTab("detail"); }}
                    >
                      <div>
                        {/* ── Card Header ── */}
                        <div className={`flex justify-between items-start mb-6 border-b pb-4 ${t.tableBorder}`}>
                          <h3 className={`text-xl font-bold transition-colors flex items-center gap-2 ${t.text} ${isDark ? "group-hover:text-[#d4006e]" : "group-hover:text-[#9E217B]"}`}>
                            <span className={`flex-shrink-0 ${t.accentText}`}>#{enquiry.id}</span>
                            <span className="line-clamp-1">{enquiry.name}</span>
                          </h3>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex-shrink-0 border ${getStatusStyle(enquiry.status)}`}>{enquiry.status || "Assigned"}</span>
                        </div>

                        {/* ── Card Body ── */}
                        <div className="space-y-4 mb-6">
                          <div>
                            <p className={`text-xs font-medium ${t.textFaint}`}>Budget</p>
                            <p className={`text-sm font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>
                              {enquiry.salesBudget || enquiry.budget}
                            </p>
                          </div>
                          <div>
                            <p className={`text-xs font-medium ${t.textFaint}`}>Configuration</p>
                            <p className={`text-sm font-semibold ${t.text}`}>
                              {enquiry.propType || enquiry.configuration || "N/A"}
                            </p>
                          </div>
                          <div className={`p-3 rounded-lg border flex flex-col gap-2 ${t.settingsBg}`} style={t.settingsBgGl}>
                            <p className={`text-xs flex items-center gap-2 ${t.textMuted}`}>
                              <FaPhoneAlt className="w-3 h-3" />
                              Primary: <span className={`font-mono ${t.text}`}>{maskPhone(enquiry.phone)}</span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* ── Card Footer ── */}
                      <div
                        className={`pt-4 border-t flex flex-col gap-3 mt-auto ${t.tableBorder}`}
                        onClick={e => e.stopPropagation()} // prevent card click when clicking footer
                      >
                        {/* Assigned Manager Row */}
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full text-white flex items-center justify-center text-xs font-bold ${isDark
                              ? "bg-gradient-to-tr from-[#9E217B] to-[#d4006e]"
                              : "bg-gradient-to-tr from-[#00AEEF] to-[#9E217B]"
                              }`}>
                              {String(enquiry.assignedTo || "U").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className={`text-[9px] uppercase tracking-wider font-bold ${t.textFaint}`}>Assigned To</p>
                              <p className={`text-xs font-semibold ${t.text}`}>{enquiry.assignedTo || "Unassigned"}</p>
                            </div>
                          </div>
                          <p className={`text-xs ${t.textFaint}`}>{enquiry.date}</p>
                        </div>

                        {/* Transfer Button Row */}
                        <div className="flex gap-2">
                          {/* View Details */}
                          <button
                            onClick={() => { setSelectedLead(enquiry); setActiveTab("detail"); }}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${isDark
                              ? "border-[#2A2A35] text-[#888899] hover:border-[#9E217B] hover:text-[#d4006e] hover:bg-[#9E217B]/10"
                              : "border-[#D1D5DB] text-[#6B7280] hover:border-[#9E217B] hover:text-[#9E217B] hover:bg-[#9E217B]/5"
                              }`}
                          >
                            View Details →
                          </button>

                        </div>
                      </div>
                    </div>
                  ))}

                  {isLoadingMore && <div className={`col-span-full text-center py-4 ${t.textMuted}`}>Loading more…</div>}
                </div>
              )}
              <div ref={cardsSentinelRef} className="h-1 w-full mt-4" aria-hidden="true" />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              DETAIL VIEW (from Forms tab)
          ════════════════════════════════════════════════════ */}
          {activeTab === "detail" && selectedLead && (
            <div className="animate-fadeIn max-w-5xl mx-auto">
              <div className={`flex flex-col sm:flex-row sm:items-center gap-4 mb-8 rounded-2xl border p-6 md:p-8 ${t.card}`} style={t.cardGlass}>
                <button onClick={() => setActiveTab("forms")} className={`w-10 h-10 flex items-center justify-center border hover:border-current rounded-xl transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder}`}><FaChevronLeft className="text-sm" /></button>
                <h1 className={`text-xl md:text-3xl font-bold flex flex-wrap items-center gap-3 ${t.text}`}>
                  <span className={t.accentText}>#{selectedLead.id}</span>
                  <span>{selectedLead.name}</span>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStatusStyle(selectedLead.status)
                    }`}>{selectedLead.status || "Assigned"}</span>
                </h1>
              </div>
              <div className={`rounded-2xl border p-6 md:p-8 ${t.card}`} style={t.cardGlass}>
                <div className={`rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 text-white ${isDark ? "bg-gradient-to-r from-[#9E217B] to-[#7a1a5e]" : "bg-gradient-to-r from-[#00AEEF] to-[#9E217B]"}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full border border-white/30 bg-white/20 flex items-center justify-center font-bold text-xl">{String(selectedLead.assignedTo || "U").charAt(0).toUpperCase()}</div>
                    <div>
                      <p className="text-xs text-white/70 font-bold tracking-wider uppercase mb-1">Assigned Sales Manager</p>
                      <p className="font-bold text-lg">{selectedLead.assignedTo}</p>
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-xs text-white/70 uppercase tracking-wider font-bold mb-1">Source</p>
                    <p className="font-semibold flex items-center sm:justify-end gap-2"><FaBriefcase className="opacity-70" /> {selectedLead.source || "N/A"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <div>
                      <h3 className={`text-sm font-bold border-b pb-2 mb-4 uppercase tracking-widest ${t.sectionTitle} ${t.tableBorder}`}>Contact Information</h3>
                      <div className="space-y-4">
                        {[{ label: "Phone Number", val: maskPhone(selectedLead.phone), mono: true }, { label: "Alt. Phone", val: selectedLead.altPhone ? maskPhone(selectedLead.altPhone) : "N/A", mono: true }, { label: "Email Address", val: selectedLead.email }, { label: "Residential Address", val: selectedLead.address }].map(({ label, val, mono }) => (
                          <div key={label}><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>{label}</p><p className={`${mono ? "text-lg tracking-widest font-semibold" : "font-medium"} ${t.text}`}>{val}</p></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <h3 className={`text-sm font-bold border-b pb-2 mb-4 uppercase tracking-widest ${t.sectionTitle} ${t.tableBorder}`}>Property Requirements</h3>
                      <div className={`rounded-xl p-5 space-y-5 border ${t.settingsBg}`} style={t.settingsBgGl}>
                        <div><p className={`text-xs font-medium mb-1 pl-2 ${t.textFaint}`}>Budget</p><p className={`font-bold text-xl ${isDark ? "text-green-500" : "text-emerald-600"}`}>{selectedLead.salesBudget || selectedLead.budget}</p></div>
                        <div className={`grid grid-cols-2 gap-4 border-t pt-5 ${t.tableBorder}`}>
                          <div><p className={`text-xs font-medium mb-1 pl-2 ${t.textFaint}`}>Configuration</p><p className={`font-medium ${t.text}`}>{selectedLead.configuration || selectedLead.propType}</p></div>
                          <div><p className={`text-xs font-medium mb-1 pl-2 ${t.textFaint}`}>Purpose</p><p className={`font-medium ${t.text}`}>{selectedLead.purpose || selectedLead.useType}</p></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Channel Partner Card ── */}

                  {(selectedLead.cp_company || selectedLead.cpCompany) && (
                    <div className={`mt-6 rounded-xl border p-5 ${t.settingsBg}`} style={t.settingsBgGl}>
                      <h3 className={`text-xs font-bold uppercase tracking-widest mb-4 border-b pb-2 ${t.sectionTitle} ${t.tableBorder}`}>
                        Channel Partner Details
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>CP Name</p>
                          <p className={`font-semibold text-sm ${t.text}`}>
                            {selectedLead.cp_name || selectedLead.cpName || "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>CP Company</p>
                          <p className={`font-semibold text-sm ${t.text}`}>
                            {selectedLead.cp_company || selectedLead.cpCompany || "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>CP Phone</p>
                          <p className="font-semibold text-sm font-mono text-orange-400">
                            {selectedLead.cp_phone || selectedLead.cpPhone || "N/A"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── ADD THIS: Referral Card ── */}
                  {selectedLead.source === "Referral" && selectedLead.referral_name && (
                    <div className={`mt-6 rounded-xl border p-5 ${t.settingsBg}`} style={t.settingsBgGl}>
                      <h3 className={`text-xs font-bold uppercase tracking-widest mb-4 border-b pb-2 ${t.sectionTitle} ${t.tableBorder}`}>
                        Referral Details
                      </h3>
                      <div>
                        <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Referred By</p>
                        <p className={`font-semibold text-sm ${t.text}`}>
                          {selectedLead.referral_name}
                        </p>
                      </div>
                    </div>
                  )}


                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              ASSIGNED FORMS TAB — Full Sales Manager Panel
          ════════════════════════════════════════════════════ */}
          {activeTab === "assigned" && (
            <div className="animate-fadeIn">
              {assignedSubView === "cards" && (
                <div>
                  <div className="flex justify-between items-center mb-8">
                    <div>
                      <h1 className={`text-2xl font-bold flex items-center gap-3 ${t.text}`}>
                        Assigned Forms
                        <span className={`text-sm font-medium px-3 py-1 rounded-full border ${isDark ? "text-[#d4006e] border-[#9E217B]/30 bg-[#9E217B]/10" : "text-[#9E217B] bg-[#9E217B]/10 border-[#9E217B]/20"}`}>My Leads</span>
                      </h1>
                      <p className={`text-xs mt-1 ${t.textFaint}`}>{paginatedAssigned.length} shown · {filteredAssigned.length} total{hasMoreAssigned && <span className={` ${t.accentText}`}> · scroll for more</span>}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                        <input type="text" placeholder="Search..." value={searchAssigned} onChange={e => { setSearchAssigned(e.target.value); setAssignedCardsPage(1); }}
                          className={`rounded-lg pl-9 pr-4 py-2 text-sm outline-none w-52 transition-colors border ${t.inputBg} ${t.text}`} />
                      </div>
                      <button onClick={refetchAll} className={`text-sm font-semibold flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${t.btnPrimary}`}>↻ Refresh</button>
                    </div>
                  </div>

                  {isFetchingEnquiries ? (
                    <div className={`text-center py-10 ${t.textMuted}`}>Fetching your leads...</div>
                  ) : myAssignedLeads.length === 0 ? (
                    <div className={`text-center py-20 ${t.textMuted}`}>
                      <FaUserTie className={`text-5xl mx-auto mb-4 ${t.textFaint}`} />
                      <p className="text-lg font-semibold">No leads assigned to you yet.</p>
                      <p className={`text-sm mt-2 ${t.textFaint}`}>Create a new lead and self-assign it from the Forms tab.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {paginatedAssigned.map((lead: any) => {
                        const isClosing = lead.status === "Closing";
                        const isLost = !!lead.is_lost_lead;
                        const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                        return (
                          <div key={lead.id} onClick={() => { setSelectedLead(lead); setAssignedSubView("detail"); setDetailTab("personal"); setShowSalesForm(false); setShowLoanForm(false); }}
                            className={`rounded-2xl p-6 border shadow-sm cursor-pointer group flex flex-col justify-between transition-all duration-300 ${isLost ? t.cardLost :
                              isClosing ? `${isDark ? "bg-yellow-900/10 border-yellow-500/30" : "bg-amber-50 border-amber-200"} hover:-translate-y-1.5 hover:scale-[1.02] hover:border-yellow-400/60 hover:shadow-xl`
                                : isNGD ? t.cardNGD
                                  : t.card
                              }`} style={t.cardGlass}>
                            <div>
                              <div className={`flex justify-between items-start mb-5 pb-4 border-b ${t.tableBorder}`}>
                                <h3 className={`text-xl font-bold transition-colors line-clamp-1 pr-2 ${t.text} ${isDark ? "group-hover:text-[#d4006e]" : "group-hover:text-[#9E217B]"}`}>
                                  <span className={`mr-2 transition-colors ${isDark ? "text-[#d4006e]" : "text-[#00AEEF] group-hover:text-[#9E217B]"}`}>#{lead.id}</span>{lead.name}
                                </h3>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 ${isLost ? t.statusLost :
                                  isNGD ? t.statusNGD : getStatusStyle(lead.status)}`}>{isLost ? "LOST LEAD" : isNGD ? "NON GENUINE DEMAND" : (lead.status || "Assigned")}</span>
                              </div>

                              {/* Lost lead banner — shown immediately after the header */}
                              {isLost && (
                                <div className={`mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 border ${t.statusLost}`}>
                                  <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2">
                                    <Ghost className="w-3.5 h-3.5" /> Lost Lead
                                  </span>
                                  <span className="text-[10px] font-semibold normal-case truncate">
                                    {lead.lost_lead_reason || "Unresponsive"}
                                  </span>
                                </div>
                              )}
                              <div className="space-y-3 mb-5">
                                <div className="flex justify-between items-center">
                                  <div><p className={`text-xs font-medium ${t.textFaint}`}>Budget</p><p className={`text-sm font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</p></div>
                                  {lead.loanStatus && lead.loanStatus !== "N/A" && <LoanStatusBadge status={lead.loanStatus} />}
                                </div>
                                {lead.propType && lead.propType !== "Pending" && (
                                  <div><p className={`text-xs font-medium ${t.textFaint}`}>Property</p><p className={`text-sm font-medium ${t.text}`}>{lead.propType}</p></div>
                                )}
                                <div className={`p-3 rounded-lg border flex flex-col gap-1.5 ${t.settingsBg}`} style={t.settingsBgGl}>
                                  <p className={`text-xs flex items-center gap-2 ${t.textMuted}`}><FaPhoneAlt className="w-3 h-3" /><span>Ph No.</span><span className={`font-mono ${t.text}`}>{maskPhone(lead.phone)}</span></p>
                                </div>
                                {(lead.mongoVisitDate || lead.leadInterestStatus !== "Pending") && (
                                  <div className="flex items-center justify-between gap-2">
                                    {lead.mongoVisitDate && <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-400"><FaCalendarAlt className="text-[10px]" />{formatDate(lead.mongoVisitDate).split(",")[0]}</div>}
                                    {lead.leadInterestStatus && lead.leadInterestStatus !== "Pending" && <InterestBadge status={lead.leadInterestStatus} size="sm" />}
                                  </div>
                                )}
                                {isClosing && (
                                  <div className={`flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 rounded-lg ${isDark ? "text-yellow-400 bg-yellow-500/10 border border-yellow-500/20" : "text-amber-600 bg-amber-50 border border-amber-200"}`}>
                                    <FaHandshake /> Deal in Closing Stage
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className={`pt-4 border-t mt-auto flex justify-between items-center ${t.tableBorder}`}>
                              <p className={`text-[10px] flex-shrink-0 whitespace-normal min-w-[120px] ${t.textFaint}`}>{formatDate(lead.created_at)}</p>
                              <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${isDark ? "text-gray-500 group-hover:text-[#d4006e]" : "text-[#00AEEF] group-hover:text-[#9E217B]"}`}>Details →</span>
                            </div>
                          </div>
                        );
                      })}
                      {hasMoreAssigned && <CardsLoader />}
                      {!hasMoreAssigned && myAssignedLeads.length > 0 && (
                        <div className="col-span-full"><p className={`text-center text-xs py-4 ${t.textFaint}`}>All {filteredAssigned.length} leads loaded</p></div>
                      )}
                    </div>
                  )}
                  <div ref={assignedSentinelRef} className="h-1 w-full mt-4" aria-hidden="true" />
                </div>
              )}

              {/* ── DETAIL VIEW (Assigned Forms) ── */}
              {assignedSubView === "detail" && selectedLead && (
                <div className="animate-fadeIn max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-130px)]">
                  {/* Detail header */}
                  <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 rounded-2xl border p-4 sm:p-5 shadow-sm flex-shrink-0 ${t.card}`} style={t.cardGlass}>
                    <div className="flex items-center gap-4">
                      <button onClick={() => { setAssignedSubView("cards"); }} className={`w-10 h-10 flex items-center justify-center border rounded-xl transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}><FaChevronLeft className="text-sm" /></button>
                      <h1 className={`text-xl md:text-2xl font-bold flex items-center gap-3 ${t.text}`}>
                        <span className={t.accentText}>#{selectedLead.id}</span>
                        <span>{selectedLead.name}</span>
                        {selectedLead.status === "Closing" && (
                          <span className={`text-[11px] font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 ${t.statusClosing}`}><FaHandshake className="text-xs" /> Closing</span>
                        )}
                      </h1>
                    </div>
                    <div className="flex gap-3 flex-wrap justify-end">
                      {isLeadLocked ? (
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`text-xs font-bold px-3 py-1.5 rounded-full border flex items-center gap-2 ${selectedLead.is_lost_lead ? "bg-red-500/10 border-red-500/40 text-red-400" : "bg-yellow-500/10 border-yellow-500/40 text-yellow-400"}`}>
                            {selectedLead.is_lost_lead ? "❌ Lost Lead • Read Only" : "✅ Lead Closed • Read Only"}
                          </span>
                          {selectedLead.is_lost_lead ? (
                            <button onClick={handleRestoreLead} disabled={isSavingLost}
                              className={`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${t.btnPrimary}`}>
                              {isSavingLost ? "Restoring…" : <><FaCheckCircle /> ↩️ Restore Lead</>}
                            </button>
                          ) : (
                            <button onClick={handleReopenLead} disabled={isReopening}
                              className={`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${isDark ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-blue-500 hover:bg-blue-600 text-white"}`}>
                              {isReopening ? "Reopening…" : "↩️ Reopen Lead"}
                            </button>
                          )}
                        </div>
                      ) : (
                        !showSalesForm && !showLoanForm && (
                          <>
                            <button onClick={() => { prefillSalesForm(); setShowSalesForm(true); setShowLoanForm(false); }}
                              className={`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${t.btnPrimary}`}>
                              <FaFileInvoice /> Fill Salesform
                            </button>
                            <button onClick={() => { prefillLoanForm(); setShowLoanForm(true); setShowSalesForm(false); }}
                              className={`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${t.btnSecondary}`}>
                              <FaUniversity /> Track Loan
                            </button>
                            {selectedLead.mongoVisitDate && selectedLead.status !== "Closing" && !selectedLead.is_lost_lead && (
                              <button onClick={() => setIsClosingModalOpen(true)} className={`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${t.btnWarning}`}>
                                <FaHandshake /> Mark Closing
                              </button>
                            )}
                            {!selectedLead.is_lost_lead && (
                              <button onClick={openLostLeadModal}
                                className={`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${t.btnDanger}`}>
                                <AlertTriangle className="w-4 h-4" /> Mark Lost
                              </button>
                            )}
                          </>
                        ))}
                    </div>
                  </div>

                  <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 pb-2">
                    {/* LEFT PANEL */}
                    <div className="w-full lg:w-[50%] flex flex-col gap-3 h-full pb-2">
                      {showSalesForm ? (
                        <div className={`rounded-xl border p-5 shadow-xl flex-1 overflow-y-auto custom-scrollbar flex flex-col ${t.modalCard}`} style={t.modalGlass}>
                          <div className={`flex justify-between items-center mb-4 border-b pb-3 ${t.tableBorder}`}>
                            <div>
                              <h3 className={`text-lg font-bold ${t.text}`}>Sales Data Form</h3>
                              <p className={`text-xs mt-0.5 ${t.accentText}`}>For Lead #{selectedLead.id}</p>
                            </div>
                            <button type="button" onClick={() => setShowSalesForm(false)} className={`p-1 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
                          </div>
                          <form onSubmit={handleSalesFormSubmit} className="flex flex-col gap-4 flex-1">
                            <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Property Type?</label><input type="text" placeholder="e.g. 1BHK, 2BHK" value={salesForm.propertyType} onChange={e => setSalesForm({ ...salesForm, propertyType: e.target.value })} className={formInput} /></div>
                            <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Preferred Location?</label><input type="text" placeholder="e.g. Dombivali, Kalyan" value={salesForm.location} onChange={e => setSalesForm({ ...salesForm, location: e.target.value })} className={formInput} /></div>
                            <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Approximate Budget?</label><input type="text" placeholder="e.g. 5 cr" value={salesForm.budget} onChange={e => setSalesForm({ ...salesForm, budget: e.target.value })} className={formInput} /></div>
                            <div className="grid grid-cols-2 gap-3">
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
                            <button type="submit" className={`mt-auto w-full font-bold py-3.5 rounded-xl shadow-md transition-colors flex-shrink-0 ${t.btnPrimary}`}>Submit Salesform</button>
                          </form>
                        </div>
                      ) : showLoanForm ? (
                        <div className={`rounded-xl border p-5 shadow-xl flex-1 overflow-y-auto custom-scrollbar flex flex-col animate-fadeIn ${t.modalCard}`} style={t.modalGlass}>
                          <div className={`flex justify-between items-center mb-4 border-b pb-3 flex-shrink-0 ${t.tableBorder}`}>
                            <div>
                              <h3 className={`text-lg font-bold flex items-center gap-2 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}><FaUniversity /> Loan Tracking Workflow</h3>
                              <p className={`text-xs mt-0.5 ${t.textFaint}`}>For Lead #{selectedLead.id}</p>
                            </div>
                            <button type="button" onClick={() => setShowLoanForm(false)} className={`p-1 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
                          </div>
                          <form onSubmit={handleLoanFormSubmit} className="flex flex-col gap-6 flex-1">
                            <div>
                              <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>1. Loan Decision</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Loan Required? *</label><select required value={loanForm.loanRequired} onChange={e => setLoanForm({ ...loanForm, loanRequired: e.target.value })} className={formSelect}><option value="">Select</option><option>Yes</option><option>No</option><option>Not Sure</option></select></div>
                                <div>
                                  <label className={`text-xs mb-1 block ${t.textMuted}`}>Loan Status *</label>
                                  <select required value={loanForm.status} onChange={e => setLoanForm({ ...loanForm, status: e.target.value })} className={formSelect}><option value="">Select Status</option><option>Approved</option><option>In Progress</option><option>Rejected</option></select>
                                  {loanForm.status && (<p className={`text-[10px] mt-1.5 font-semibold ${loanForm.status === "Approved" ? "text-green-400" : loanForm.status === "Rejected" ? "text-red-400" : "text-yellow-400"}`}>{loanForm.status === "Approved" && "✅ Loan cleared — schedule closing meeting"}{loanForm.status === "In Progress" && "📄 Follow up on pending documents"}{loanForm.status === "Rejected" && "❌ Loan rejected — suggest co-applicant or other bank"}</p>)}
                                </div>
                              </div>
                            </div>
                            <div className={`border-t pt-4 ${t.tableBorder}`}>
                              <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>2. Bank & Loan Details</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[{ label: "Bank Name", k: "bank", ph: "e.g. HDFC" }, { label: "Amount Required", k: "amountReq", ph: "e.g. 60L" }, { label: "Amount Approved", k: "amountApp", ph: "e.g. 55L" }, { label: "CIBIL Score", k: "cibil", ph: "e.g. 750" }, { label: "Agent Name", k: "agent", ph: "Agent Name" }, { label: "Agent Contact", k: "agentContact", ph: "Agent Phone", tel: true }].map(f => (
                                  <div key={f.k}><label className={`text-xs mb-1 block ${t.textMuted}`}>{f.label}</label><input type={f.tel ? "tel" : "text"} value={(loanForm as any)[f.k]} onChange={e => setLoanForm({ ...loanForm, [f.k]: e.target.value })} className={formInput} placeholder={f.ph} /></div>
                                ))}
                              </div>
                            </div>
                            <div className={`border-t pt-4 ${t.tableBorder}`}>
                              <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>3. Financial Qualification</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Employment</label><select value={loanForm.empType} onChange={e => setLoanForm({ ...loanForm, empType: e.target.value })} className={formSelect}><option value="">Select</option><option>Salaried</option><option>Self-employed</option></select></div>
                                <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Monthly Income</label><input type="text" value={loanForm.income} onChange={e => setLoanForm({ ...loanForm, income: e.target.value })} className={formInput} placeholder="e.g. 1L" /></div>
                                <div><label className={`text-xs mb-1 block ${t.textMuted}`}>Existing EMIs</label><input type="text" value={loanForm.emi} onChange={e => setLoanForm({ ...loanForm, emi: e.target.value })} className={formInput} placeholder="e.g. 15k" /></div>
                              </div>
                            </div>
                            <div className={`border-t pt-4 ${t.tableBorder}`}>
                              <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}><FaFileAlt /> 4. Document Checklist</h4>
                              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border ${t.settingsBg}`} style={t.settingsBgGl}>
                                {["docPan", "docAadhaar", "docSalary", "docBank", "docProperty"].map(docKey => {
                                  const label = docKey === "docPan" ? "PAN Card" : docKey === "docAadhaar" ? "Aadhaar Card" : docKey === "docSalary" ? "Salary Slips / ITR" : docKey === "docBank" ? "Bank Statements" : "Property Documents";
                                  return (
                                    <div key={docKey} className={`flex items-center justify-between border p-2 rounded-lg ${t.innerBlock}`}>
                                      <span className={`text-xs font-medium ${t.text}`}>{label}</span>
                                      <select value={(loanForm as any)[docKey]} onChange={e => setLoanForm({ ...loanForm, [docKey]: e.target.value })} className={`text-xs font-bold bg-transparent outline-none cursor-pointer ${(loanForm as any)[docKey] === "Uploaded" ? "text-green-400" : "text-gray-500"}`}><option>Pending</option><option>Uploaded</option></select>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div className={`border-t pt-4 ${t.tableBorder}`}>
                              <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>5. Notes / Remarks</h4>
                              <textarea value={loanForm.notes} onChange={e => setLoanForm({ ...loanForm, notes: e.target.value })} className={`w-full rounded-lg px-4 py-2.5 text-sm outline-none resize-none h-20 custom-scrollbar border ${t.inputInner} ${t.text} ${t.inputFocus}`} placeholder="Bank feedback, CIBIL issues, Internal notes..." />
                            </div>
                            <button type="submit" className={`mt-4 flex-shrink-0 w-full font-bold py-3.5 rounded-xl shadow-md transition-colors cursor-pointer ${t.btnSecondary}`}>Save Loan Tracker Update</button>
                          </form>
                        </div>
                      ) : (
                        <div className="flex flex-col h-full animate-fadeIn">
                          {/* Tab switcher */}
                          <div className={`flex items-center gap-2 mb-4 border p-1.5 rounded-xl flex-shrink-0 ${t.tableWrap}`}>
                            <button onClick={() => setDetailTab("personal")} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Personal Information</button>
                            <button onClick={() => setDetailTab("loan")} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? t.btnSecondary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Loan Tracking</button>
                          </div>
                          <div className={`flex-1 overflow-y-auto custom-scrollbar rounded-xl p-6 pt-4 pb-4 shadow-lg border ${t.chatPanel}`} style={t.chatPanelGl}>
                            {detailTab === "personal" ? (
                              <div>
                                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                                  {[
                                    { label: "Email", val: selectedLead.email !== "N/A" ? selectedLead.email : "Not Provided" },
                                    { label: "Phone", val: selectedLead.phone, mono: true },
                                    { label: "Alt Phone", val: selectedLead.altPhone && selectedLead.altPhone !== "N/A" ? selectedLead.altPhone : "Not Provided", mono: true },
                                  ].map(f => (
                                    <div key={f.label}><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>{f.label}</p><p className={`font-semibold ${f.mono ? "font-mono" : ""} ${t.text}`}>{f.val}</p></div>
                                  ))}
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Lead Interest</p>{selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} /> : <p className={`font-semibold ${t.text}`}>Pending</p>}</div>
                                  <div className="col-span-1"><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Loan Status</p>{selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} /></div> : <p className={`font-semibold ${t.text}`}>N/A</p>}</div>
                                  <div className="col-span-1"><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Backdated Entry</p><p className={`font-semibold ${t.text}`}>{selectedLead.auto_date_enabled === false && selectedLead.enquiry_date ? formatDate(selectedLead.enquiry_date).split(",")[0] : "Null"}</p></div>
                                  <div className="col-span-2"><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Residential Address</p><p className={`font-semibold ${t.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Budget</p><p className={`font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Property Type</p><p className={`font-semibold ${t.text}`}>{selectedLead.propType || "Pending"}</p></div>
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Type of Use</p><p className={`font-semibold ${t.text}`}>{selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Planning to Buy?</p><p className={`font-semibold ${t.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Loan Required?</p><p className={`font-semibold ${t.text}`}>{getLatestLoanDetails()?.loanRequired}</p></div>
                                  <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Status</p><span className={`text-sm font-bold ${selectedLead.status === "Closing" ? "text-amber-500" : selectedLead.status === "Visit Scheduled" ? "text-orange-400" : t.accentText}`}>{selectedLead.status || "Assigned"}</span></div>
                                  <div className={`col-span-2 p-3 rounded-xl border ${t.settingsBg}`} style={t.settingsBgGl}>
                                    <p className={`text-xs font-bold uppercase tracking-wider mb-0.5 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}>📍 Site Visit Date</p>
                                    <p className={`text-base font-black ${t.text}`}>{selectedLead.mongoVisitDate ? formatDate(selectedLead.mongoVisitDate) : "Not Scheduled"}</p>
                                  </div>
                                  {/* ── Lost Lead Record ── */}
                                  {selectedLead.is_lost_lead && (
                                    <div className="col-span-2 mt-1 border rounded-xl p-3 text-red-300 border-red-500/30 bg-red-950/30">
                                      <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <Ghost className="w-3.5 h-3.5" /> Lost Lead Record
                                      </h3>
                                      <p className="text-xs leading-relaxed">{selectedLead.lost_lead_reason || "No reason recorded."}</p>
                                      <p className="text-[10px] mt-2 text-gray-500">
                                        Marked by {selectedLead.lost_lead_marked_by || "Unknown"} on {selectedLead.lost_lead_marked_at ? formatDate(selectedLead.lost_lead_marked_at) : "-"}
                                      </p>
                                    </div>
                                  )}
                                </div>
                                <div className={`mt-3 border rounded-xl p-3 ${t.settingsBg}`} style={t.settingsBgGl}>
                                  <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 border-b pb-2 ${t.sectionTitle} ${t.sectionBorder}`}>Channel Partner Data</h3>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Primary Source</p><p className={`font-medium text-sm ${t.text}`}>{selectedLead.source || "N/A"}</p></div>
                                    {selectedLead.source === "Others" && (<div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Specified Name</p><p className={`font-medium text-sm ${t.text}`}>{selectedLead.sourceOther}</p></div>)}
                                  </div>
                                  {selectedLead.source === "Channel Partner" && (
                                    <div className={`mt-2 pt-2 border-t grid grid-cols-1 sm:grid-cols-2 gap-3 ${t.tableBorder}`}>
                                      {[{ label: "CP Company", val: selectedLead.cp_company || selectedLead.cpCompany }, { label: "CP Phone", val: selectedLead.cp_phone || selectedLead.cpPhone }].map(({ label, val }) => (
                                        <div key={label}><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>{label}</p><p className={`font-medium text-sm ${t.text}`}>{val || "N/A"}</p></div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div>
                                {(() => {
                                  const curLoan: any = getLatestLoanDetails() || {};
                                  const sColor = getLoanStatusColor(curLoan?.status || "");
                                  const isHighProb = curLoan?.status?.toLowerCase() === "approved" && selectedLead.mongoVisitDate;
                                  return (
                                    <>
                                      <h3 className={`text-sm font-bold border-b pb-2 mb-6 uppercase flex items-center justify-between ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"} ${t.tableBorder}`}><span className="flex items-center gap-2"><FaUniversity /> Deal Loan Overview</span></h3>
                                      {isHighProb && <div className="mb-6 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/50 p-3 rounded-lg flex items-center justify-center gap-2 text-orange-400 font-bold tracking-wide shadow-md">🚀 HIGH PROBABILITY DEAL (Visit Done + Loan Approved)</div>}
                                      <div className="grid grid-cols-2 gap-y-5 gap-x-4 text-sm">
                                        <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Loan Required?</p><p className={`font-semibold ${t.text}`}>{curLoan?.loanRequired}</p></div>
                                        <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Current Status</p><p className={`font-bold px-2 py-0.5 rounded inline-block border ${sColor}`}>{curLoan?.status}</p></div>
                                        <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Amount Requested</p><p className="text-orange-400 font-semibold">{curLoan?.amountReq}</p></div>
                                        <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Amount Approved</p><p className={`font-semibold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{curLoan?.amountApp}</p></div>
                                        {[{ label: "Bank Name", val: curLoan?.bankName }, { label: "CIBIL Score", val: curLoan?.cibil }, { label: "Agent Name", val: curLoan?.agent }, { label: "Agent Contact", val: curLoan?.agentContact }, { label: "Emp Type", val: curLoan?.empType }, { label: "Monthly Income", val: curLoan?.income }, { label: "Existing EMIs", val: curLoan?.emi }].map(f => (
                                          <div key={f.label}><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>{f.label}</p><p className={`font-semibold ${t.text}`}>{f.val}</p></div>
                                        ))}
                                        <div className="col-span-2 mb-2"><p className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>Document Status</p></div>
                                        {[{ label: "PAN Card", val: curLoan?.docPan }, { label: "Aadhaar", val: curLoan?.docAadhaar }, { label: "Salary/ITR", val: curLoan?.docSalary }, { label: "Bank Stmt", val: curLoan?.docBank }, { label: "Property Docs", val: curLoan?.docProperty }].map((doc, i) => (
                                          <div key={i} className={`flex items-center justify-between p-2 rounded-lg col-span-1 border ${t.innerBlock}`}>
                                            <span className={`text-xs ${t.textMuted}`}>{doc.label}</span>
                                            {doc.val === "Uploaded" ? <FaCheck className="text-green-500 text-xs" /> : <FaClock className={`text-xs ${t.textFaint}`} />}
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>



                          <div className="grid grid-cols-2 gap-3 mt-4 flex-shrink-0">
                            <button className={`border flex flex-col items-center justify-center py-3 rounded-xl transition-all cursor-pointer gap-1 ${isDark ? "bg-[#00AEEF]/10 border-[#00AEEF]/30 hover:bg-[#00AEEF] text-[#00AEEF] hover:text-white" : "bg-[#00AEEF]/10 border-[#00AEEF]/30 hover:bg-[#00AEEF] text-[#00AEEF] hover:text-white"}`}><FaMicrophone className="text-lg" /><span className="font-bold text-[10px]">Browser Call</span></button>
                            <button onClick={() => setIsWaModalOpen(true)} className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl transition-all cursor-pointer gap-1"><FaWhatsapp className="text-xl" /><span className="font-bold text-[10px]">WhatsApp</span></button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RIGHT PANEL: FOLLOW-UPS */}
                    <div className={`w-full lg:w-[50%] flex flex-col rounded-2xl overflow-hidden shadow-2xl h-full min-h-0 border ${t.chatPanel}`} style={t.chatPanelGl}>
                      <div className={`flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 ${t.chatArea}`}>
                        {/* System message */}
                        <div className="flex justify-start">
                          <div className={`rounded-2xl rounded-tl-none p-4 max-w-[85%] shadow-md ${t.fupSalesform}`}>
                            <div className={`flex justify-between items-center mb-2 gap-6`}>
                              <span className={`font-bold text-sm ${t.accentText}`}>System (Front Desk)</span>
                              <span className={`text-[10px] ${t.textFaint}`}>{formatDate(selectedLead.created_at)}</span>
                            </div>
                            <p className={`text-sm leading-relaxed ${t.textMuted}`}>Lead assigned to {selectedLead.assigned_to}. Action required.</p>
                          </div>
                        </div>
                        {currentLeadFollowUps.map((msg: any, idx: number) => {
                          const isLoan = msg.message.includes("🏦 Loan Update");
                          const isSF = msg.message.includes("📝 Detailed Salesform Submitted");
                          const isClosing = msg.message.includes("✅ Lead Marked as Closing");
                          const bubbleCls = isLoan ? t.fupLoan : isSF ? t.fupSalesform : isClosing ? t.fupClosing : t.fupDefault;
                          return (
                            <div key={idx} className="flex justify-start">
                              <div className={`rounded-2xl rounded-tl-none p-4 max-w-[85%] shadow-lg ${bubbleCls}`}>
                                <div className="flex justify-between items-center mb-3 gap-6">
                                  <span className={`font-bold text-sm ${t.text}`}>{msg.createdBy === "admin" ? `${msg.salesManagerName || "Admin"} (Admin)` : msg.salesManagerName}</span>
                                  <span className={`text-[10px] ${t.textFaint}`}>{formatDate(msg.createdAt)}</span>
                                </div>
                                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${t.textMuted}`}>{msg.message}</p>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={followUpEndRef} />
                      </div>
                      {isLeadLocked ? (
                        <div className={`p-5 border-t flex items-center justify-center flex-shrink-0 ${t.header} ${t.tableBorder}`} style={t.headerGlass}>
                          <span className={`text-xs font-semibold ${t.textFaint}`}>
                            {selectedLead.is_lost_lead ? "❌ Lost Lead • Read Only — follow-ups disabled" : "✅ Lead Closed • Read Only — follow-ups disabled"}
                          </span>
                        </div>
                      ) : (
                        <form onSubmit={handleSendCustomNote} className={`p-4 border-t flex gap-3 items-center flex-shrink-0 ${t.header} ${t.tableBorder}`} style={t.headerGlass}>
                          <input
                            type="text" value={customNote} onChange={e => setCustomNote(e.target.value)}
                            placeholder="Add follow-up note..."
                            className={`flex-1 rounded-xl px-4 py-3 text-sm outline-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                          />
                          <button type="submit" className={`w-12 h-12 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg ${isDark ? "bg-purple-600 hover:bg-purple-500" : "bg-[#00AEEF] hover:bg-[#0099d4]"}`}><FaPaperPlane className="text-sm ml-[-2px]" /></button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {showLostModal && selectedLead && (
            <LostLeadModal
              lead={selectedLead}
              reason={lostReason}
              error={lostError}
              isSaving={isSavingLost}
              isDark={isDark}
              theme={t}
              onReasonChange={(v) => { setLostReason(v); if (lostError) setLostError(""); }}
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

          {/* ════════════════════════════════════════════════════
              RECEPTIONIST LEADS TAB
          ════════════════════════════════════════════════════ */}
          {activeTab === "recep-leads" && (
            <div className="animate-fadeIn pb-10">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h1 className={`text-xl md:text-3xl font-bold ${t.text}`}>Receptionist Leads</h1>
                  <p className={`text-xs mt-1 ${t.textFaint}`}>Leads you have personally handled or captured</p>
                </div>
                <div className="relative flex items-center gap-4 flex-wrap">
                  <div className="relative">
                    <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 ${t.textFaint}`} />
                    <input type="text" placeholder="Search leads..." value={searchRecepLeads} onChange={e => setSearchRecepLeads(e.target.value)}
                      className={`rounded-lg pl-9 pr-4 py-2 text-sm outline-none w-52 transition-colors border ${t.inputBg} ${t.text}`} />
                  </div>
                  <label className={`flex items-center gap-2 text-xs font-bold ${t.textMuted}`}>
                    <input type="checkbox" checked={showLostLeads} onChange={e => setShowLostLeads(e.target.checked)} disabled={leadStatusFilter !== "all"} className="accent-red-500" />
                    Show Lost
                  </label>
                  <label className={`flex items-center gap-2 text-xs font-bold ${t.textMuted}`}>
                    <input type="checkbox" checked={showNGDLeads} onChange={e => setShowNGDLeads(e.target.checked)} disabled={leadStatusFilter !== "all"} className="accent-[#F97316]" />
                    Show NGD
                  </label>
                  <button onClick={() => downloadCSV(filteredRecepLeads.map((l: any) => ({ "Lead No": l.id, "Client Name": l.name, "CP Company": l.cp_company || "N/A", "Budget": l.salesBudget || l.budget || "N/A", "Phone": l.phone || "N/A", "Alt Phone": l.altPhone || "N/A", "Date Created": l.date, "Assigned to Receptionist": l.assignedReceptionist || user.name, "Status": l.status || "Assigned" })), "Receptionist_Leads.csv")} className={`p-2 border rounded-lg ${t.exportBtn}`} title="Export CSV"><FaDownload size={12} /></button>
                  <button onClick={refetchAll} className={`text-sm font-semibold flex items-center gap-2 px-4 py-2 rounded-lg ${t.btnPrimary}`}>↻ Refresh</button>
                </div>
              </div>

              <div className={`rounded-2xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
                <div className={`p-4 md:p-5 border-b flex justify-between items-center ${t.tableBorder}`}>
                  <p className={`text-sm font-semibold ${t.text}`}>{filteredRecepLeads.length} leads</p>
                  <p className={`text-xs ${t.textFaint}`}>Showing all leads assigned to or handled by you</p>
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead><tr className={t.tableHead}>
                      {["Lead No.", "Client Name", "CP Details", "Budget", "Phone", "Alt. Phone", "Date Created", "Assigned to", "Site Visits", "Status", "Actions"].map(h => (
                        <th key={h} className={`px-3 py-3 md:p-4 font-bold uppercase tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className={`${t.tableDivide} divide-y`}>
                      {isFetchingEnquiries ? (
                        <tr><td colSpan={11} className={`p-8 text-center text-sm ${t.textMuted}`}>Loading your leads...</td></tr>
                      ) : filteredRecepLeads.length === 0 ? (
                        <tr><td colSpan={11} className={`p-12 text-center ${t.textMuted}`}>
                          <FaUserTie className={`text-5xl mx-auto mb-4 ${t.textFaint}`} />
                          <p className="text-lg font-semibold">No leads found.</p>
                          <p className={`text-sm mt-2 ${t.textFaint}`}>Self-assign leads when creating new entries.</p>
                        </td></tr>
                      ) : filteredRecepLeads.map((lead: any) => {
                        const isLost = !!lead.is_lost_lead;
                        const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                        return (
                          <tr key={lead.id}
                            className={`transition-colors ${isLost ? t.rowLost : isNGD ? t.rowNGD : t.tableRow}`}>

                            {/* 1. Lead No. */}
                            <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-bold ${t.accentText}`}>#{lead.id}</td>

                            {/* 2. Client Name */}
                            <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-semibold ${t.text}`}>{lead.name}</td>

                            {/* 3. CP Details */}
                            <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm ${t.textMuted}`}>
                              {(lead.cp_company || lead.cpCompany) ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className={`font-semibold text-xs ${t.text}`}>{lead.cp_company || lead.cpCompany}</span>
                                  {(lead.cp_phone || lead.cpPhone) && (
                                    <span className="font-mono text-[10px] text-orange-400">{lead.cp_phone || lead.cpPhone}</span>
                                  )}
                                </div>
                              ) : <span className="italic text-[10px]">—</span>}
                            </td>

                            {/* 4. Budget */}
                            <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-bold ${isDark ? "text-green-700" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</td>

                            {/* 5. Phone */}
                            <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm font-mono ${t.text}`}>{maskPhone(lead.phone)}</td>

                            {/* 6. Alt Phone */}
                            <td className={`px-3 py-3 md:p-4 text-[10px] md:text-sm font-mono ${t.textMuted}`}>{maskPhone(lead.altPhone)}</td>

                            {/* 7. Date Created */}
                            <td className={`px-3 py-3 md:p-4 text-[10px] md:text-xs whitespace-normal min-w-[120px] ${t.textFaint}`}>{lead.date}</td>

                            {/* 8. Assigned to */}
                            <td className="px-3 py-3 md:p-4">
                              <span className={`px-2 py-1 rounded-md text-[10px] font-semibold ${isDark ? "bg-purple-500/10 text-purple-400 border border-purple-500/30" : "bg-[#9E217B]/10 text-[#9E217B] border border-[#9E217B]/30"}`}>{lead.assignedReceptionist || user.name}</span>
                            </td>

                            {/* Site Visits */}
                            <td className="px-3 py-3 md:p-4">
                              {lead.mongoVisitDate ? (
                                <span className="text-orange-400 font-bold text-[10px]">{formatDate(lead.mongoVisitDate).split(",")[0]}</span>
                              ) : (
                                <span className={`text-[10px] ${t.textFaint}`}>No Visit</span>
                              )}
                            </td>

                            {/* 9. Status */}
                            <td className="px-3 py-3 md:p-4">
                              {lead.is_lost_lead ? (
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border inline-flex items-center gap-1 ${t.statusLost}`}>
                                  <Ghost className="w-3 h-3" /> Lost
                                </span>
                              ) : isNGD ? (
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${t.statusNGD}`}>
                                  NGD
                                </span>
                              ) : (
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${getStatusStyle(lead.status)
                                  }`}>{lead.status || "Assigned"}</span>
                              )}
                            </td>

                            {/* 10. Actions */}
                            <td className="px-3 py-3 md:p-4">
                              <button onClick={() => { setSelectedLead(lead); setAssignedSubView("detail"); setDetailTab("personal"); setShowSalesForm(false); setShowLoanForm(false); setActiveTab("assigned"); }}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${t.btnPrimary}`}>
                                Open
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {/* ════════════════════════════════════════════════════
            CLOSED LEADS TAB
        ════════════════════════════════════════════════════ */}
          {activeTab === "closed-leads" && (
            <div className="animate-fadeIn pb-10">

              {/* ── TABLE VIEW ── */}
              {closedLeadView === "table" && (
                <>
                  <div className="flex justify-between items-center mb-8">
                    <div>
                      <h1 className={`text-xl md:text-3xl font-bold ${t.text}`}>Closed Leads</h1>
                      <p className={`text-xs mt-1 ${t.textFaint}`}>Leads that have reached the Closing stage</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                        <input type="text" placeholder="Search leads..." value={searchClosedLeads}
                          onChange={e => setSearchClosedLeads(e.target.value)}
                          className={`rounded-lg pl-9 pr-4 py-2 text-sm outline-none w-52 transition-colors border ${t.inputBg} ${t.text}`} />
                      </div>
                      <button onClick={() => downloadCSV(filteredClosedLeads.map((l: any) => ({
                        "Lead No": l.id,
                        "Client Name": l.name,
                        "Budget": l.salesBudget || l.budget || "N/A",
                        "Status": l.status,
                        "Assigned To": l.assignedTo || "Unassigned",
                        "Closing Date": l.closingDate ? formatDate(l.closingDate) : "N/A",
                        "Date Created": l.date,
                      })), "Closed_Leads.csv")}
                        className={`p-2 border rounded-lg ${t.exportBtn}`} title="Export CSV">
                        <FaDownload size={12} />
                      </button>
                      <button onClick={refetchAll} className={`text-sm font-semibold flex items-center gap-2 px-4 py-2 rounded-lg ${t.btnPrimary}`}>
                        ↻ Refresh
                      </button>
                    </div>
                  </div>

                  <div className={`rounded-2xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
                    <div className={`p-4 border-b flex justify-between items-center ${t.tableBorder}`}>
                      <p className={`text-sm font-semibold ${t.text}`}>{filteredClosedLeads.length} closed leads</p>
                      <p className={`text-xs ${t.textFaint}`}>Click any row to view full history</p>
                    </div>
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse whitespace-nowrap">
                        <thead><tr className={t.tableHead}>
                          {["Lead No.", "Client Name", "Budget", "Property", "Status", "Assigned To", "Site Visit", "Closing Date", "Actions"].map(h => (
                            <th key={h} className={`px-3 py-3 md:p-4 font-bold uppercase tracking-wider border-b ${t.textHeader} ${t.tableBorder}`}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className={`${t.tableDivide} divide-y`}>
                          {isFetchingEnquiries ? (
                            <tr><td colSpan={9} className={`p-8 text-center text-sm ${t.textMuted}`}>Loading...</td></tr>
                          ) : filteredClosedLeads.length === 0 ? (
                            <tr><td colSpan={9} className={`p-12 text-center ${t.textMuted}`}>
                              <FaHandshake className={`text-5xl mx-auto mb-4 ${t.textFaint}`} />
                              <p className="text-lg font-semibold">No closed leads yet.</p>
                              <p className={`text-sm mt-2 ${t.textFaint}`}>Leads marked as Closing will appear here.</p>
                            </td></tr>
                          ) : filteredClosedLeads.map((lead: any) => (
                            <tr key={lead.id} className={`transition-colors cursor-pointer ${t.tableRow}`}
                              onClick={() => { setSelectedClosedLead(lead); setClosedLeadView("detail"); }}>
                              <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-bold ${t.accentText}`}>#{lead.id}</td>
                              <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-semibold ${t.text}`}>{lead.name}</td>
                              <td className={`px-3 py-3 md:p-4 text-xs md:text-sm font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</td>
                              <td className={`px-3 py-3 md:p-4 text-xs ${t.textMuted}`}>{(lead.propType && lead.propType !== "Pending" && lead.propType !== "N/A" ? lead.propType : lead.configuration && lead.configuration !== "Pending" && lead.configuration !== "N/A" ? lead.configuration : "N/A")}</td>
                              <td className="px-3 py-3 md:p-4">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${t.statusClosing}`}>
                                  {lead.status}
                                </span>
                              </td>
                              <td className={`px-3 py-3 md:p-4 text-xs ${t.textMuted}`}>{lead.assignedTo || "Unassigned"}</td>
                              <td className={`px-3 py-3 md:p-4 text-[10px] ${lead.mongoVisitDate ? "text-orange-400" : t.textFaint}`}>
                                {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : "—"}
                              </td>
                              <td className={`px-3 py-3 md:p-4 text-[10px] ${t.textFaint}`}>
                                {lead.closingDate ? formatDate(lead.closingDate).split(",")[0] : "—"}
                              </td>
                              <td className="px-3 py-3 md:p-4">
                                <button className={`text-xs font-bold px-3 py-1.5 rounded-lg ${t.btnWarning}`}>
                                  View History
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* ── DETAIL / HISTORY VIEW ── */}
              {closedLeadView === "detail" && selectedClosedLead && (() => {
                const leadFollowUps = followUps.filter((f: any) => String(f.leadId) === String(selectedClosedLead.id));
                return (
                  <div className="animate-fadeIn max-w-5xl mx-auto">
                    {/* Header */}
                    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 rounded-2xl border p-5 ${t.card}`} style={t.cardGlass}>
                      <div className="flex items-center gap-4">
                        <button onClick={() => { setClosedLeadView("table"); setSelectedClosedLead(null); }}
                          className={`w-10 h-10 flex items-center justify-center border rounded-xl transition-colors cursor-pointer ${t.textMuted} ${t.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}>
                          <FaChevronLeft className="text-sm" />
                        </button>
                        <div>
                          <h1 className={`text-xl md:text-2xl font-bold flex items-center gap-3 ${t.text}`}>
                            <span className={t.accentText}>#{selectedClosedLead.id}</span>
                            <span>{selectedClosedLead.name}</span>
                            <span className={`text-[11px] font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 ${t.statusClosing}`}>
                              <FaHandshake className="text-xs" /> Closing
                            </span>
                          </h1>
                          <p className={`text-xs mt-1 ${t.textFaint}`}>
                            {selectedClosedLead.closingDate && `Closed on ${formatDate(selectedClosedLead.closingDate)}`}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => downloadCSV(leadFollowUps.map((f: any) => ({
                        "By": f.salesManagerName,
                        "Role": f.createdBy,
                        "Message": f.message,
                        "Date": formatDate(f.createdAt),
                      })), `Lead_${selectedClosedLead.id}_History.csv`)}
                        className={`p-2 border rounded-lg ${t.exportBtn}`} title="Export History">
                        <FaDownload size={12} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Lead Summary Card */}
                      <div className={`rounded-2xl border p-6 space-y-4 ${t.card}`} style={t.cardGlass}>
                        <h3 className={`text-sm font-bold uppercase tracking-wider border-b pb-2 ${t.sectionTitle} ${t.tableBorder}`}>Lead Summary</h3>
                        {[
                          { label: "Client Name", val: selectedClosedLead.name },
                          { label: "Phone", val: maskPhone(selectedClosedLead.phone) },
                          { label: "Budget", val: selectedClosedLead.salesBudget || selectedClosedLead.budget },
                          { label: "Property", val: selectedClosedLead.propType || selectedClosedLead.configuration || "N/A" },
                          { label: "Use Type", val: selectedClosedLead.useType !== "Pending" ? selectedClosedLead.useType : (selectedClosedLead.purpose || "N/A") },
                          { label: "Source", val: selectedClosedLead.source || "N/A" },
                          { label: "Assigned To", val: selectedClosedLead.assignedTo || "Unassigned" },
                          { label: "Interest", val: selectedClosedLead.leadInterestStatus || "N/A" },
                          { label: "Loan Status", val: selectedClosedLead.loanStatus !== "N/A" ? selectedClosedLead.loanStatus : "N/A" },
                          { label: "Backdated Entry", val: selectedClosedLead.auto_date_enabled === false && selectedClosedLead.enquiry_date ? formatDate(selectedClosedLead.enquiry_date).split(",")[0] : "Null" },
                        ].map(({ label, val }) => (
                          <div key={label}>
                            <p className={`text-xs font-medium ${t.textFaint}`}>{label}</p>
                            <p className={`text-sm font-semibold mt-0.5 ${t.text}`}>{val}</p>
                          </div>
                        ))}
                        {selectedClosedLead.mongoVisitDate && (
                          <div className={`p-3 rounded-xl border ${isDark ? "bg-orange-900/10 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
                            <p className="text-xs font-bold text-orange-400 mb-1">📍 Site Visit Date</p>
                            <p className={`text-sm font-bold ${t.text}`}>{formatDate(selectedClosedLead.mongoVisitDate)}</p>
                          </div>
                        )}
                      </div>

                      {/* Follow-up Timeline */}
                      <div className={`lg:col-span-2 rounded-2xl border overflow-hidden flex flex-col ${t.chatPanel}`} style={t.chatPanelGl}>
                        <div className={`p-4 border-b flex items-center gap-3 ${t.modalHeader} ${t.tableBorder}`}>
                          <FaFileAlt className={t.accentText} />
                          <h3 className={`font-bold text-sm ${t.text}`}>Full Lead History</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${t.accentBg}`}>{leadFollowUps.length} entries</span>
                        </div>
                        <div className={`flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col gap-5 max-h-[60vh] ${t.chatArea}`}>
                          {/* System entry */}
                          <div className={`rounded-2xl rounded-tl-none p-4 max-w-[90%] shadow-md ${t.fupSalesform}`}>
                            <div className="flex justify-between items-center mb-2 gap-6">
                              <span className={`font-bold text-sm ${t.accentText}`}>System (Front Desk)</span>
                              <span className={`text-[10px] ${t.textFaint}`}>{formatDate(selectedClosedLead.created_at)}</span>
                            </div>
                            <p className={`text-sm ${t.textMuted}`}>Lead captured. Assigned to: {selectedClosedLead.assigned_to || "Unassigned"}</p>
                          </div>

                          {leadFollowUps.length === 0 ? (
                            <p className={`text-center text-sm py-10 ${t.textFaint}`}>No follow-up history recorded.</p>
                          ) : leadFollowUps.map((msg: any, idx: number) => {
                            const isLoan = msg.message?.includes("🏦 Loan Update");
                            const isSF = msg.message?.includes("📝 Detailed Salesform Submitted");
                            const isClosing = msg.message?.includes("✅ Lead Marked as Closing");
                            const isTransfer = msg.message?.includes("🔄 Lead Transferred");
                            const bubble = isLoan ? t.fupLoan : isSF ? t.fupSalesform : isClosing ? t.fupClosing : isTransfer ? t.fupTransfer : t.fupDefault;
                            return (
                              <div key={idx} className={`rounded-2xl rounded-tl-none p-4 max-w-[90%] shadow-md ${bubble}`}>
                                <div className="flex justify-between items-center mb-2 gap-6">
                                  <span className={`font-bold text-sm ${t.text}`}>
                                    {msg.createdBy === "receptionist"
                                      ? `${msg.salesManagerName || "Receptionist"} (Receptionist)`
                                      : msg.salesManagerName}
                                  </span>
                                  <span className={`text-[10px] flex-shrink-0 ${t.textFaint}`}>{formatDate(msg.createdAt)}</span>
                                </div>
                                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${t.textMuted}`}>{msg.message}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              MY ATTENDANCE TAB
          ════════════════════════════════════════════════════ */}
          {activeTab === "attendance" && (
            <AttendanceView
              adminUser={user}
              isDark={isDark}
              t={t}
              now={now}
            />
          )}
        </main>
      </div>

      {/* ════════════════════════════════════════════════════
          BOTTOM NAV (MOBILE)
      ════════════════════════════════════════════════════ */}
      <nav className={`md:hidden flex w-full h-16 border-t items-center justify-around flex-shrink-0 z-40 ${t.sidebar}`}>
        {NAV_ITEMS.map(({ id, icon, title }) => {
          const active = activeTab === id || (id === "forms" && activeTab === "detail");
          return (
            <div key={id} onClick={() => setActiveTab(id)} className="relative flex justify-center items-center h-full flex-1 cursor-pointer" title={title}>
              {active && <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b ${t.navIndicator}`} />}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${active ? t.navActive : t.navInactive}`}>{icon}</div>
            </div>
          );
        })}
        <div onClick={() => setActiveTab("settings")} className="relative flex justify-center items-center h-full flex-1 cursor-pointer">
          {activeTab === "settings" && <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b ${t.navIndicator}`} />}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === "settings" ? t.navActive : t.navInactive}`}><FaCog className="w-5 h-5" /></div>
        </div>
      </nav>

      {/* ════════════════════════════════════════════════════
          ENQUIRY MODAL (with Self-Assign toggle)
      ════════════════════════════════════════════════════ */}
      {isEnquiryModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex justify-center items-center p-4 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(6px)" }}>
          <div className={`rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border ${t.modalCard}`} style={t.modalGlass}>
            <div className={`p-4 md:p-6 border-b flex justify-between items-center ${t.modalHeader} ${t.tableBorder}`}>
              <div>
                <h2 className={`text-lg md:text-xl font-bold flex items-center gap-2 ${t.text}`}><FaUserCircle className={t.accentText} /> Client Enquiry Form</h2>
                <p className={`text-xs mt-1 ${t.textMuted}`}>Fill all details accurately to route to the Sales Manager.</p>
              </div>
              <button onClick={() => setIsEnquiryModalOpen(false)} className={`hover:text-red-500 transition-colors cursor-pointer p-2 ${t.textMuted}`}><FaTimes className="text-xl" /></button>
            </div>
            <div className={`p-4 md:p-6 overflow-y-auto custom-scrollbar flex-1 ${t.modalInner}`}>
              <form id="enquiryForm" onSubmit={handleEnquirySubmit} className="space-y-6 md:space-y-8">
                <div className={`p-5 md:p-6 rounded-xl border ${t.modalBlock}`} style={t.modalBlockGl}>
                  <h3 className={`text-sm font-bold mb-4 uppercase tracking-wider border-b pb-2 ${t.sectionTitle} ${t.sectionBorder}`}>Personal Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                    <div className="sm:col-span-2">
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Full Name *</label>
                      <input type="text" required value={enquiryForm.fullName} onChange={e => setEnquiryForm({ ...enquiryForm, fullName: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="e.g. Mayur Acharya" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Address</label>
                      <input type="text" value={enquiryForm.address} onChange={e => setEnquiryForm({ ...enquiryForm, address: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="Full residential address" />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Mobile No *</label>
                      <input type="tel" required value={enquiryForm.mobile} onChange={e => setEnquiryForm({ ...enquiryForm, mobile: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="+91 0000000000" />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Alt Mobile No</label>
                      <input type="tel" value={enquiryForm.altMobile} onChange={e => setEnquiryForm({ ...enquiryForm, altMobile: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="+91 0000000000" />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Email ID</label>
                      <input type="email" value={enquiryForm.email} onChange={e => setEnquiryForm({ ...enquiryForm, email: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="email@example.com" />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Occupation</label>
                      <select value={enquiryForm.occupation} onChange={e => setEnquiryForm({ ...enquiryForm, occupation: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border cursor-pointer ${t.modalInput} ${t.text}`}>
                        <option value="" disabled>Select Occupation</option>
                        {["Salaried", "Self Employed", "Business owner", "House maker"].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Loan Planned</label>
                      <select value={enquiryForm.loanPlanned} onChange={e => setEnquiryForm({ ...enquiryForm, loanPlanned: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border cursor-pointer ${t.modalInput} ${t.text}`}>
                        <option value="" disabled>Select Option</option>
                        <option value="Yes">Yes</option><option value="No">No</option>
                      </select>
                    </div>

                    {/* ── Auto Date Toggle + Enquiry Date Picker ── */}
                    <div className="sm:col-span-2">
                      <div className={`rounded-xl p-4 border ${isDark ? "bg-[#14141B]/60 border-[#2A2A35]" : "bg-[#F8FAFC] border-[#D1D5DB]"}`}>
                        {/* Toggle Row */}
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <label className={`block text-xs font-bold ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}>
                              <FaCalendarAlt className="inline mr-1.5 text-[10px]" />
                              Auto Date
                            </label>
                            <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>
                              {autoDate ? "Using today's date automatically." : "Select the original enquiry date."}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAutoDate(!autoDate)}
                            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none cursor-pointer flex-shrink-0"
                            style={{
                              backgroundColor: autoDate
                                ? (isDark ? "#9E217B" : "#00AEEF")
                                : (isDark ? "#2A2A35" : "#D1D5DB"),
                              boxShadow: autoDate
                                ? (isDark ? "0 0 8px rgba(158,33,123,0.5)" : "0 0 8px rgba(0,174,239,0.4)")
                                : "none",
                            }}
                            aria-label="Toggle Auto Date"
                          >
                            <span
                              className="inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-300"
                              style={{
                                transform: autoDate ? "translateX(22px)" : "translateX(4px)",
                              }}
                            />
                          </button>
                        </div>

                        {/* Date Picker */}
                        <div>
                          <label className={`block text-xs mb-1.5 font-medium pl-1 ${t.textMuted}`}>
                            Enquiry Date {!autoDate && <span className={isDark ? "text-red-400" : "text-red-500"}>*</span>}
                          </label>
                          <input
                            type="date"
                            required={!autoDate}
                            disabled={autoDate}
                            value={enquiryForm.enquiryDate}
                            max={getTodayString()}
                            onChange={e => setEnquiryForm({ ...enquiryForm, enquiryDate: e.target.value })}
                            className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text} ${autoDate ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                            style={autoDate ? { pointerEvents: "none" } : {}}
                          />
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                <div className={`p-5 md:p-6 rounded-xl border ${t.modalBlock}`} style={t.modalBlockGl}>
                  <h3 className={`text-sm font-bold mb-4 uppercase tracking-wider border-b pb-2 ${t.sectionTitle} ${t.sectionBorder}`}>Requirement & Budget</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5">
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Budget *</label>
                      <input type="text" required value={enquiryForm.budget} onChange={e => setEnquiryForm({ ...enquiryForm, budget: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="e.g. 80 Lakhs, 1.5 Cr" />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Configuration (BHK)</label>
                      <input
                        type="text"
                        value={enquiryForm.configuration}
                        onChange={e => setEnquiryForm({ ...enquiryForm, configuration: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`}
                        placeholder="e.g. 2 BHK, 3 BHK, Studio"
                      />
                    </div>
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Purpose</label>
                      <select value={enquiryForm.purpose} onChange={e => setEnquiryForm({ ...enquiryForm, purpose: e.target.value })}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border cursor-pointer ${t.modalInput} ${t.text}`}>
                        <option value="" disabled>Select…</option>
                        {["Personal use", "Investment", "Second home"].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className={`p-5 md:p-6 rounded-xl border ${isDark ? "border-[#9E217B]/20" : "border-[#00AEEF]/20"} ${t.modalBlock}`} style={t.modalBlockGl}>
                  <h3 className={`text-sm font-bold mb-4 uppercase tracking-wider border-b pb-2 ${isDark ? "text-[#d4006e] border-[#9E217B]/20" : "text-[#00AEEF] border-[#00AEEF]/20"}`}>Routing & Source</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                    <div>
                      <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Source *</label>
                      <select required value={enquiryForm.source} onChange={e => {
                        const newSource = e.target.value;
                        setEnquiryForm(prev => {
                          let updated = { ...prev, source: newSource };
                          if (newSource === "Channel Partner") {
                            updated.cpDetails = { name: "", company: "", phone: "" };
                          } else {
                            updated.cpDetails = { name: "", company: "", phone: "" };
                          }
                          return updated;
                        });
                      }}
                        className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border cursor-pointer ${t.modalInput} ${t.text}`}>
                        <option value="" disabled>Select Source</option>
                        {["Advertisement", "Referral", "Exhibition", "Channel Partner", "Website", "Call Center", "Others"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {/* SELF-ASSIGN TOGGLE */}
                    <div className={`rounded-xl p-4 border flex flex-col gap-3 ${isDark ? "bg-[#9E217B]/5 border-[#9E217B]/20" : "bg-[#9E217B]/5 border-[#9E217B]/20"}`}>
                      <label className={`block text-xs font-bold ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}>Assignment Option</label>
                      <div className="flex items-center gap-3">
                        <button type="button"
                          onClick={() => { setEnquiryForm({ ...enquiryForm, selfAssign: false }); setShowManagerDropdown(true); }}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-colors border ${!enquiryForm.selfAssign ? (isDark ? "bg-[#9E217B] border-[#9E217B] text-white" : "bg-[#00AEEF] border-[#00AEEF] text-white") : `${t.textMuted} ${t.tableBorder}`}`}>
                          Assign to Manager
                        </button>
                        <button type="button"
                          onClick={() => setEnquiryForm({ ...enquiryForm, selfAssign: true, assignedTo: "" })}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-colors border ${enquiryForm.selfAssign ? (isDark ? "bg-[#9E217B] border-[#9E217B] text-white" : "bg-[#9E217B] border-[#9E217B] text-white") : `${t.textMuted} ${t.tableBorder}`}`}>
                          Self-Assign (Me)
                        </button>
                      </div>
                      {enquiryForm.selfAssign ? (
                        <p className={`text-xs ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}>✓ Lead will be assigned to <strong>{user.name}</strong> (you)</p>
                      ) : (
                        <div className={`w-full rounded-xl border-2 overflow-hidden ${isDark ? "border-purple-500/40" : "border-purple-300"}`}>
                          {isFetchingManagers ? (
                            <div className={`p-3 text-sm ${t.textMuted}`}>Loading managers…</div>
                          ) : combinedAssignees.length === 0 ? (
                            <div className={`p-3 text-sm ${t.textMuted}`}>No assignees available</div>
                          ) : (
                            <>
                              {/* Selected display or placeholder — always visible */}
                              <div
                                onClick={() => setShowManagerDropdown(prev => !prev)}
                                className={`px-4 py-3 text-sm cursor-pointer flex items-center justify-between ${enquiryForm.assignedTo
                                  ? isDark ? "text-white bg-purple-900/30" : "text-purple-800 bg-purple-100 font-semibold"
                                  : isDark ? "text-gray-400" : "text-gray-400"
                                  }`}
                              >
                                <span>
                                  {enquiryForm.assignedTo
                                    ? `${enquiryForm.assignedTo} ✓`
                                    : "-- Select Sales Manager --"}
                                </span>
                                <span className={`text-xs ${t.textFaint}`}>{showManagerDropdown ? "▲" : "▼"}</span>
                              </div>

                              {/* Dropdown list — only shown when open */}
                              {showManagerDropdown && (
                                <div className={`max-h-[200px] overflow-y-auto custom-scrollbar border-t ${isDark ? "border-[#2a2a35]" : "border-gray-100"}`}>
                                  {/* <div
                                    onClick={() => {
                                      setEnquiryForm({ ...enquiryForm, assignedTo: "" });
                                      setShowManagerDropdown(false);
                                    }}
                                    className={`px-4 py-3 text-sm cursor-pointer border-b transition-colors ${
                                      isDark ? "text-gray-500 hover:bg-[#1a1a28] border-[#2a2a35]" : "text-gray-400 hover:bg-gray-50 border-gray-100"
                                    }`}
                                  >
                                    -- Clear Selection --
                                  </div> */}
                                  {combinedAssignees.map((m: any, i: number) => (
                                    <div
                                      key={i}
                                      onClick={() => {
                                        setEnquiryForm({ ...enquiryForm, assignedTo: m.name });
                                        setShowManagerDropdown(false);  // ← closes on click
                                      }}
                                      className={`px-4 py-3 text-sm cursor-pointer border-b transition-colors ${enquiryForm.assignedTo === m.name
                                        ? isDark ? "bg-purple-900/40 text-purple-200 font-bold" : "bg-purple-100 text-purple-800 font-bold"
                                        : isDark ? "text-white hover:bg-[#1a1a28] border-[#2a2a35]" : "text-[#1A1A1A] hover:bg-purple-50 border-gray-100"
                                        }`}
                                    >
                                      <span className="font-semibold">{m.name}</span>
                                      <span className={`ml-2 text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                                        ({String(m.role || "Sales Manager").replace("_", " ")})
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {enquiryForm.source === "Others" && (
                      <div className="sm:col-span-2 mt-2">
                        <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>Specify Source *</label>
                        <input required type="text" value={enquiryForm.sourceOther} onChange={e => setEnquiryForm({ ...enquiryForm, sourceOther: e.target.value })}
                          className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`} placeholder="Please specify the lead source" />
                      </div>
                    )}
                    {enquiryForm.source === "Referral" && (
                      <div className="sm:col-span-2 mt-2">
                        <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>
                          Referred by *
                        </label>
                        <input
                          required
                          type="text"
                          value={enquiryForm.referralName}
                          onChange={e => setEnquiryForm({ ...enquiryForm, referralName: e.target.value })}
                          className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`}
                          placeholder="e.g. Rajesh Sharma (existing client)"
                        />
                      </div>
                    )}
                    {enquiryForm.source === "Channel Partner" && (
                      <div className={`sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2 p-4 rounded-xl border ${t.settingsBg} ${t.tableBorder}`}>
                        <h4 className={`sm:col-span-2 text-xs font-bold mb-1 ${t.accentText}`}>Channel Partner Details</h4>
                        <div>
                          <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>CP Name *</label>
                          <input
                            required
                            type="text"
                            value={enquiryForm.cpDetails.name}
                            onChange={e => setEnquiryForm({ ...enquiryForm, cpDetails: { ...enquiryForm.cpDetails, name: e.target.value } })}
                            className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`}
                            placeholder="Contact Person Name"
                          />
                        </div>

                        {/* Smart Auto-suggest Input for Company */}
                        <div className="relative">
                          <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>CP Company *</label>
                          <input required type="text"
                            value={enquiryForm.cpDetails.company}
                            onChange={e => {
                              setEnquiryForm({ ...enquiryForm, cpDetails: { ...enquiryForm.cpDetails, company: e.target.value } });
                              setShowCpDropdown(true);
                            }}
                            onFocus={() => setShowCpDropdown(true)}
                            onBlur={() => setTimeout(() => setShowCpDropdown(false), 200)} // Delay so click registers
                            className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`}
                            placeholder="Company Name"
                          />

                          {/* Dropdown Menu */}
                          {showCpDropdown && enquiryForm.cpDetails.company && (
                            <div className={`absolute z-50 w-full mt-1 max-h-40 overflow-y-auto rounded-lg shadow-xl border ${t.dropdown}`} style={t.dropdownGlass}>
                              {existingCPs.filter(cp => cp.company.toLowerCase().includes(enquiryForm.cpDetails.company.toLowerCase())).length > 0 ? (
                                existingCPs
                                  .filter(cp => cp.company.toLowerCase().includes(enquiryForm.cpDetails.company.toLowerCase()))
                                  .map((cp, idx) => (
                                    <div key={idx}
                                      onClick={() => {
                                        // Auto-fill company AND phone number
                                        setEnquiryForm({
                                          ...enquiryForm,
                                          cpDetails: { name: "", company: cp.company, phone: cp.phone }
                                        });
                                        setShowCpDropdown(false);
                                      }}
                                      className={`px-4 py-2 text-sm cursor-pointer transition-colors ${t.tableRow} ${t.text}`}
                                    >
                                      <p className="font-bold">{cp.company}</p>
                                      {cp.phone && <p className={`text-[10px] ${t.textFaint}`}>{cp.phone}</p>}
                                    </div>
                                  ))
                              ) : (
                                <div className={`px-4 py-2 text-xs italic ${t.textFaint}`}>Add as new Channel Partner</div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Standard Phone Input (Auto-fills if CP selected above) */}
                        <div>
                          <label className={`block text-xs mb-1.5 font-medium pl-2 ${t.textMuted}`}>CP Contact</label>
                          <input type="text"
                            value={enquiryForm.cpDetails.phone}
                            onChange={e => setEnquiryForm({ ...enquiryForm, cpDetails: { ...enquiryForm.cpDetails, phone: e.target.value } })}
                            className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${t.modalInput} ${t.text}`}
                            placeholder="Phone Number"
                          />
                        </div>

                      </div>
                    )}
                  </div>
                </div>
              </form>
            </div>
            <div className={`p-4 md:p-6 border-t flex flex-col md:flex-row justify-end gap-3 md:gap-4 ${t.modalHeader} ${t.tableBorder}`}>
              <button onClick={() => { setIsEnquiryModalOpen(false); setShowManagerDropdown(false); }} type="button"
                className={`px-6 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${t.textMuted} ${isDark ? "hover:bg-red-500/10 hover:text-red-500" : "hover:bg-[#9E217B]/10 hover:text-[#9E217B]"}`}>Cancel</button>
              <button form="enquiryForm" type="submit" disabled={isSubmitting}
                className={`px-8 py-2.5 rounded-lg font-bold transition-colors ${isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${t.btnPrimary}`}>
                {isSubmitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          TRANSFER LEAD MODAL
      ════════════════════════════════════════════════════ */}
      {isWaModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/75 z-[220] flex justify-center items-center p-4 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-2xl w-full max-w-lg shadow-2xl border overflow-hidden ${t.modalCard}`} style={t.modalGlass}>
            <div className="p-5 border-b border-green-500/20 bg-green-500/10 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-green-500"><FaWhatsapp /> Send WhatsApp</h2>
                <p className={`text-xs mt-1 ${t.textMuted}`}>To: <strong>{selectedLead.name}</strong> ({maskPhone(selectedLead.phone || selectedLead.contact_no || "N/A")})</p>
                {user.whatsapp_number && <p className={`text-[10px] mt-1 ${t.textFaint}`}>Logging sender: +{user.whatsapp_number}</p>}
              </div>
              <button onClick={() => { setIsWaModalOpen(false); setWaMessage(""); }} className={`p-2 ${t.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
            </div>

            <form onSubmit={handleSendWhatsApp}>
              <div className={`p-6 ${t.modalInner}`}>
                <label className={`block text-sm font-bold mb-2 ${isDark ? "text-green-400" : "text-green-600"}`}>
                  Message (will be logged in CRM timeline)
                </label>
                <textarea
                  required
                  value={waMessage}
                  onChange={e => setWaMessage(e.target.value)}
                  rows={6}
                  placeholder="Type your message here..."
                  className={`w-full rounded-xl px-4 py-3 text-sm outline-none resize-none leading-relaxed border-2 transition-colors custom-scrollbar ${isDark ? "bg-[#14141B] border-green-500/30 text-white focus:border-green-500" : "bg-white border-green-200 text-[#1A1A1A] focus:border-green-500"}`}
                />
              </div>

              <div className={`p-5 border-t flex justify-end gap-3 ${t.modalHeader} ${t.tableBorder}`}>
                <button type="button" onClick={() => { setIsWaModalOpen(false); setWaMessage(""); }} className={`px-6 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${t.textMuted} hover:text-red-500`}>Cancel</button>
                <button type="submit" disabled={isSendingWa || !waMessage.trim()} className={`px-8 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2 ${isSendingWa || !waMessage.trim() ? "opacity-50 cursor-not-allowed bg-green-600/40 text-white" : "cursor-pointer bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/20"}`}>
                  {isSendingWa ? "Opening..." : <><FaWhatsapp /> Open WhatsApp</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {isTransferModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-4 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-2xl w-full max-w-lg shadow-2xl border overflow-hidden ${t.modalCard}`} style={t.modalGlass}>
            {/* Header */}
            <div className={`p-5 border-b flex justify-between items-center ${isDark ? "bg-purple-900/20 border-purple-500/20" : "bg-purple-50 border-purple-200"}`}>
              <div>
                <h2 className={`text-lg font-bold flex items-center gap-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>
                  <FaExchangeAlt /> Transfer Lead #{selectedLead.id}
                </h2>
                <p className={`text-xs mt-1 ${t.textMuted}`}>Transferring: <strong>{selectedLead.name}</strong></p>
              </div>
              <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }}
                className={`p-2 ${t.textMuted} hover:text-red-500 transition-colors`}><FaTimes /></button>
            </div>

            {/* Body */}
            <div className={`p-6 ${t.modalInner}`}>
              {/* Transfer target */}
              <div className="mb-5">
                <label className={`block text-sm font-bold mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Transfer to Sales Manager *</label>
                <select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}
                  className={`w-full rounded-xl p-3 text-sm outline-none transition-colors border-2 cursor-pointer ${isDark ? "bg-[#14141B] border-purple-500/40 text-white" : "bg-white border-purple-300 text-[#1A1A1A]"}`}>
                  <option value="" disabled>-- Select Sales Manager --</option>
                  {isFetchingManagers ? <option disabled>Loading managers…</option> : combinedAssignees.length > 0 ? combinedAssignees.map((m: any, i: number) => <option key={i} value={m.name}>{m.name} ({String(m.role || "Sales Manager").replace("_", " ")})</option>) : <option disabled>No assignees available</option>}
                </select>
              </div>

              {/* Handover note */}
              <div>
                <label className={`block text-sm font-bold mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>Handover Summary *</label>
                <p className={`text-xs mb-3 leading-relaxed ${t.textMuted}`}>
                  Please summarize all completed actions, discussions held, current interest level, and any pending tasks so the Sales Manager can seamlessly continue from where you left off.
                </p>
                <textarea
                  required
                  value={transferNote}
                  onChange={e => setTransferNote(e.target.value)}
                  placeholder="e.g. Client was contacted twice. Showed interest in 2BHK under 80L budget. Site visit is being considered. Client has pre-approved loan from HDFC. Next step: schedule site visit and share project brochure."
                  rows={7}
                  className={`w-full rounded-xl px-4 py-3 text-sm outline-none resize-none leading-relaxed border-2 transition-colors custom-scrollbar ${isDark ? "bg-[#14141B] border-purple-500/30 text-white placeholder:text-gray-600 focus:border-purple-500" : "bg-white border-purple-200 text-[#1A1A1A] placeholder:text-gray-400 focus:border-purple-500"}`}
                />
                {transferNote.length > 0 && transferNote.length < 50 && (
                  <p className="text-xs text-amber-500 mt-1.5">⚠ Please provide a more detailed summary (min 50 characters).</p>
                )}
              </div>

              <div className={`mt-4 p-3 rounded-lg border text-xs ${isDark ? "bg-blue-900/10 border-blue-500/20 text-blue-400" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
                <p className="font-bold mb-1">ℹ What happens after transfer:</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li>Lead is reassigned to the selected Sales Manager</li>
                  <li>All your follow-ups and notes remain fully visible</li>
                  <li>Your name is preserved in the lead history</li>
                  <li>Sales Manager will see the full context and continue</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className={`p-5 border-t flex justify-end gap-3 ${t.modalHeader} ${t.tableBorder}`}>
              <button onClick={() => { setIsTransferModalOpen(false); setTransferNote(""); setTransferTarget(""); }}
                className={`px-6 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${t.textMuted} hover:text-red-500`}>Cancel</button>
              <button
                onClick={handleTransferLead}
                disabled={isTransferring || !transferTarget || !transferNote.trim()}
                className={`px-8 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2 ${isTransferring || !transferTarget || transferNote.trim().length < 50
                  ? "opacity-50 cursor-not-allowed bg-purple-400 text-white"
                  : "cursor-pointer bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"
                  }`}>
                {isTransferring ? "Transferring…" : <><FaExchangeAlt /> Confirm Transfer</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STYLES ── */}


      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(158,33,123,0.4); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(158,33,123,0.6); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
        @keyframes bounce { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-6px) } }
        .animate-bounce { animation: bounce 0.8s infinite; }
        input:focus, select:focus, textarea:focus { box-shadow: 0 0 0 3px rgba(0,174,239,0.15); }
      `}} />
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
  t: any; onSuccess: () => void;
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
          createdBy: adminUser.role === "admin" ? "admin" : adminUser.role === "receptionist" ? "receptionist" : "sales",
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
      const json = await res.json();
      if (!json.success) { showToast("❌ " + json.message); return; }

      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: adminUser.name,
          createdBy: adminUser.role === "admin" ? "admin" : adminUser.role === "receptionist" ? "receptionist" : "sales",
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

