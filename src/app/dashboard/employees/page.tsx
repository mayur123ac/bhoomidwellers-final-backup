//dashboard/employee/page.tsx
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  FaUserTie, FaListUl, FaPlus, FaThLarge, FaCog, FaBell, FaLock, FaIdCard,
  FaClipboardList, FaUsers, FaEyeSlash, FaTrash, FaUserEdit,
  FaPhoneAlt, FaSearch, FaChevronLeft, FaComments, FaUpload, FaDownload,
  FaFileExcel, FaDesktop, FaCheckCircle, FaTimes, FaPaperPlane,
  FaCalendarAlt, FaHeart, FaTimesCircle, FaAngleLeft, FaCommentAlt,
  FaMoneyBillWave, FaMapMarkerAlt, FaBullseye, FaSave, FaUniversity, FaBriefcase, FaChartPie,
  FaExchangeAlt, FaEye, FaExclamationTriangle, FaSignal, FaUserClock
} from "react-icons/fa";
import { FaWandMagicSparkles } from 'react-icons/fa6'
import { useCallerSync } from "@/lib/hooks/useCallerSync";
import CrmUpdatesNotification from "@/components/CrmUpdatesNotification";
import { label } from "framer-motion/client";

import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import LoginTimerWidget from "@/components/LoginTimerWidget";

type RoleType = { _id: string; name: string };
type EmployeeType = {
  _id: string; name: string; username: string;
  email: string; role: string; isActive: boolean; password?: string;
};

// ─── Sun / Moon Icons ─────────────────────────────────────────────────────────
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

// ─── Theme Builder ─────────────────────────────────────────────────────────────
function buildTheme(isDark: boolean) {
  return {
    // ── page shell ──
    pageWrap: isDark ? "bg-[#0a0a0a] text-gray-200" : "text-[#1A1A1A]",
    pageStyle: isDark ? {} : { background: "linear-gradient(135deg,#fdf0f8 0%,#f8fafc 30%,#faf0fb 62%,#f8fafc 78%,#fce8f6 100%)" },
    mainBg: isDark ? "bg-[#0a0a0a]" : "bg-transparent",
    // ── header ──
    header: isDark ? "bg-[#111111]/80 backdrop-blur-md border-[#222]" : "bg-white border-[#9CA3AF]",
    headerTitle: isDark ? "text-white" : "text-[#1A1A1A]",
    headerBadge: isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30 text-[#d946a8]" : "bg-[#9E217B]/10 border-[#9E217B]/30 text-[#9E217B]",
    // ── panels / sections ──
    panel: isDark
      ? "border"
      : "bg-white border",
    panelHead: isDark
      ? "border-b bg-[#0f0f0f]"
      : "border-b bg-[#F8FAFC]",
    inner: isDark ? "bg-[#1a1a1a]" : "bg-[#F8FAFC]",
    innerBorder: isDark ? "border-[#222]" : "border-indigo-200",
    innerBorderSt: isDark ? "border-[#333]" : "border-indigo-300",
    // ── text ──
    text: isDark ? "text-white" : "text-[#1A1A1A]",
    textMuted: isDark ? "text-gray-400" : "text-[#6B7280]",
    textFaint: isDark ? "text-gray-500" : "text-[#9CA3AF]",
    textLight: isDark ? "text-gray-300" : "text-[#374151]",
    textLight2: isDark ? "text-gray-600" : "text-[#9CA3AF]",
    accentText: isDark ? "text-[#d946a8]" : "text-[#9E217B]",
    // ── inputs & selects ──
    inp: isDark
      ? "w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2.5 text-sm text-white focus:border-[#9E217B] outline-none transition-colors placeholder:text-gray-600"
      : "w-full bg-white border border-indigo-300 rounded-lg px-4 py-2.5 text-sm text-[#1A1A1A] focus:border-[#9E217B] outline-none transition-colors placeholder:text-[#9CA3AF]",
    sel: isDark
      ? "w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2.5 text-sm text-gray-300 focus:border-[#9E217B] outline-none cursor-pointer transition-colors"
      : "w-full bg-white border border-indigo-300 rounded-lg px-4 py-2.5 text-sm text-[#374151] focus:border-[#9E217B] outline-none cursor-pointer transition-colors",
    smallSel: isDark
      ? "w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-[#9E217B] cursor-pointer"
      : "w-full bg-white border border-indigo-300 rounded-lg px-3 py-2 text-xs text-[#1A1A1A] outline-none focus:border-[#9E217B] cursor-pointer",
    searchInp: isDark
      ? "w-full bg-[#1a1a1a] border border-[#333] rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:border-[#9E217B] outline-none transition-colors"
      : "w-full bg-white border border-indigo-300 rounded-lg pl-9 pr-4 py-2 text-sm text-[#1A1A1A] focus:border-[#9E217B] outline-none transition-colors",
    // ── table ──
    tableHead: isDark ? "bg-[#1a1a1a]" : "bg-[#F1F5F9]",
    tableHeadText: isDark ? "text-gray-500" : "text-[#6B7280]",
    tableRow: isDark ? "hover:bg-[#151515]" : "hover:bg-[#F8FAFC]",
    tableDivide: isDark ? "divide-[#1a1a1a]" : "divide-[#E5E7EB]",
    tableBorderB: isDark ? "border-b border-[#222]" : "border-b border-indigo-200",
    tableHeadBdr: isDark ? "border-b border-[#222]" : "border-b border-indigo-200",
    // ── caller sidebar ──
    callerSidebar: isDark ? "bg-[#111111] border-r border-[#222]" : "bg-white border-r border-indigo-200",
    callerItemBdr: isDark ? "border-b border-[#1a1a1a]" : "border-b border-indigo-100",
    callerItemSel: isDark ? "bg-[#1a1a1a] border-l-4 border-l-[#9E217B]" : "bg-pink-50 border-l-4 border-l-[#9E217B]",
    callerItemDef: isDark ? "border-l-4 border-l-transparent" : "border-l-4 border-l-transparent",
    callerItemHov: isDark ? "hover:bg-[#151515]" : "hover:bg-pink-50/50",
    callerAvatar: isDark ? "bg-[#333] text-gray-400" : "bg-gray-300 text-gray-600",
    // ── right panel ──
    rightPanel: isDark ? "bg-[#0a0a0a]" : "bg-[#F8FAFC]",
    rightHeader: isDark ? "bg-[#111111] border-b border-[#222]" : "bg-white border-b border-indigo-200",
    // ── batch section ──
    batchTop: isDark ? "border-t border-[#222]" : "border-t border-indigo-200",
    batchLabel: isDark ? "text-gray-500" : "text-[#9CA3AF]",
    batchItemSel: isDark ? "bg-[#9E217B]/10 border border-[#9E217B]/30" : "bg-pink-50 border border-pink-200",
    batchItemDef: isDark ? "hover:bg-[#1a1a1a] border border-transparent" : "hover:bg-pink-50/30 border border-transparent",
    // ── detail view ──
    detailCard: isDark ? "bg-[#111111] border-[#222]" : "bg-white border-indigo-200",
    detailSection: isDark ? "border-b border-[#222] pb-2" : "border-b border-indigo-200 pb-2",
    detailRow: isDark ? "border-[#222]" : "border-indigo-100",
    followBg: isDark ? "bg-[#0a0a0a]" : "bg-[#F8FAFC]",
    followSys: isDark ? "bg-[#1a1a1a] border-[#222]" : "bg-white border-[#E5E7EB]",
    followMsg: isDark ? "bg-[#1f0a18] border-[#9E217B]/30" : "bg-pink-50 border-pink-200",
    chatInputWrap: isDark ? "bg-[#1a1a1a] border-t border-[#222]" : "bg-white border-t border-indigo-200",
    chatInputInner: isDark
      ? "flex-1 bg-[#0a0a0a] border border-[#333] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-[#9E217B] transition-colors"
      : "flex-1 bg-white border border-indigo-300 rounded-xl px-4 py-3 text-sm text-[#1A1A1A] outline-none focus:border-[#9E217B] transition-colors",
    // ── table inline edit ──
    editRow: isDark ? "bg-[#1a1a2e]" : "bg-indigo-50",
    editInp: isDark
      ? "w-full bg-[#0f0f0f] border border-[#9E217B]/50 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none"
      : "w-full bg-white border border-[#9E217B]/50 rounded-lg px-2.5 py-1.5 text-sm text-[#1A1A1A] outline-none",
    editSel: isDark
      ? "w-full bg-[#0f0f0f] border border-[#9E217B]/50 rounded-lg px-2.5 py-1.5 text-sm text-[#d946a8] outline-none cursor-pointer"
      : "w-full bg-white border border-[#9E217B]/50 rounded-lg px-2.5 py-1.5 text-sm text-[#9E217B] outline-none cursor-pointer",
    adminRow: isDark ? "bg-[#9E217B]/5" : "bg-pink-50/30",
    // ── upload msg ──
    uploadSuccess: isDark ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-green-700 bg-green-50 border-green-200",
    uploadError: isDark ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-red-700 bg-red-50 border-red-200",
    uploadInfo: isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/20" : "text-[#9E217B] bg-pink-50 border-pink-200",
    // ── profile dropdown ──
    dropdown: isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-200",
    dropdownInner: isDark ? "bg-[#121212] border-[#2a2a2a]" : "bg-white border-indigo-200",
    profileRole: isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/30" : "text-[#9E217B] bg-[#9E217B]/10 border-[#9E217B]/30",
    profileLogout: isDark ? "bg-[#3B1F1F] text-[#F28B82] hover:bg-red-900/40 border border-red-900/30" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B] hover:text-white border border-[#9E217B]/30",
    // ── toggle button ──
    toggleBtn: isDark ? "bg-[#1C1C2A] border-[#2A2A38] text-yellow-300" : "bg-white border-indigo-200 text-[#9E217B]",
    // ── misc ──
    dividerBar: "bg-[#9E217B]",
    scroll: isDark ? "custom-scrollbar" : "custom-scrollbar-light",
    pillBorder: isDark ? "border-[#333]" : "border-indigo-200",
    pillBg: isDark ? "bg-[#222]" : "bg-[#F1F5F9]",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (ds?: string) => {
  if (!ds) return "—";
  try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ds; }
};
const maskPhone = (p?: string) => {
  if (!p) return "N/A";
  const c = String(p).replace(/\D/g, "");
  return c.length <= 5 ? c : `${c.slice(0, 2)}*****${c.slice(-3)}`;
};
const interestBadge = (status?: string) => {
  if (!status) return <span className="text-[10px] text-gray-600 italic">—</span>;
  const map: Record<string, string> = {
    "Interested": "text-green-400 bg-green-500/10 border-green-500/30",
    "Not Interested": "text-red-400 bg-red-500/10 border-red-500/30",
    "Non Genuine Demand": "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  };
  const short: Record<string, string> = {
    "Interested": "Interested", "Not Interested": "Not Int.", "Non Genuine Demand": "Non Genuine Demand",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap ${map[status] ?? "text-gray-400 bg-gray-500/10 border-gray-500/30"}`}>
      {short[status] ?? status}
    </span>
  );
};

// ─── Template export ───────────────────────────────────────────────────────────
const exportTemplate = () => {
  const headers = ["Sr No.", "Form No.", "Date", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback"];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads Template");
  XLSX.writeFile(wb, "leads_template.xlsx");
};

// ─── Parse Excel ──────────────────────────────────────────────────────────────
const parseExcelFile = (file: File): Promise<any[]> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: false });
      if (json.length === 0) { reject(new Error("Empty file")); return; }
      const cols = Object.keys(json[0]);
      const find = (v: string[]) => cols.find(c => v.some(x => c.toLowerCase().trim().includes(x.toLowerCase()))) || "";
      const nameCol = find(["name", "customer", "client"]);
      const phoneCol = find(["contact no", "phone", "mobile", "contact", "number", "tel"]);
      const emailCol = find(["email", "mail"]);
      const sourceCol = find(["source", "platform", "channel", "medium"]);
      const partnerCol = find(["channel partner", "chanel partner", "partner"]);
      const managerCol = find(["assign manager", "manager", "assigned"]);
      const feedbackCol = find(["feedback", "remarks", "comment"]);
      const srNoCol = find(["sr no", "srno", "s no", "sr."]);
      const formNoCol = find(["form no", "formno", "form number"]);
      const dateCol = find(["date"]);
      const leads = json.map((row, i) => ({
        sr_no: srNoCol ? String(row[srNoCol]) : String(i + 1),
        form_no: formNoCol ? String(row[formNoCol]) : "",
        lead_date: dateCol ? String(row[dateCol]) : "",
        name: String(row[nameCol] || row[cols[0]] || `Lead ${i + 1}`),
        contact_no: String(row[phoneCol] || ""),
        email: emailCol ? String(row[emailCol]) : "",
        source: sourceCol ? String(row[sourceCol]) : "",
        channel_partner: partnerCol ? String(row[partnerCol]) : "",
        assign_manager: managerCol ? String(row[managerCol]) : "",
        feedback: feedbackCol ? String(row[feedbackCol]) : "",
      }));
      resolve(leads);
    } catch (err) { reject(err); }
  };
  reader.onerror = () => reject(new Error("Read failed"));
  reader.readAsArrayBuffer(file);
});

// ─── ADMIN EMAIL CONSTANT ─────────────────────────────────────────────────────
const ADMIN_EMAIL = "admin@bhoomi.com";

// ============================================================================
// MAIN PAGE
// ============================================================================
// ============================================================================
// MAIN PAGE
// ============================================================================
// ============================================================================
// MAIN PAGE
// ============================================================================
export default function EmployeesPage() {
  const router = useRouter();
  useActivityTracker();

  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem("crm_theme") === "dark";
    } catch {
      return false;
    }
  });
  const t = useMemo(() => buildTheme(isDark), [isDark]);

  const [activeSection, setActiveSection] = useState<"employees" | "callers" | "ai">("employees");
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  // ── Employee state ──
  const [empName, setEmpName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [dbRoles, setDbRoles] = useState<RoleType[]>([]);
  const [employees, setEmployees] = useState<EmployeeType[]>([]);
  const [newRoleInput, setNewRoleInput] = useState("");
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EmployeeType>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [selectedManageUserId, setSelectedManageUserId] = useState("");

  // 👇 1. CLEAN NOTIFICATION STATES 👇
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  type CrmNotif = { id: string; line1: string; line2: string; type: "lead" | "visit" };
  const [notifQueue, setNotifQueue] = useState<CrmNotif[]>([]);
  const [activeNotif, setActiveNotif] = useState<CrmNotif | null>(null);
  const [notifCount, setNotifCount] = useState(0);
  const [notificationHistory, setNotificationHistory] = useState<(CrmNotif & { rawDate: number })[]>([]);
  const [dismissedNotifIds, setDismissedNotifIds] = useState<Set<string>>(new Set());

  // ── Password Validation Helpers ──
  const validatePassword = (pwd: string) => {
    return {
      length: pwd.length >= 8,
      upper: /[A-Z]/.test(pwd),
      lower: /[a-z]/.test(pwd),
      number: /\d/.test(pwd),
      special: /[@$!%*?&]/.test(pwd),
    };
  };

  const passwordRules = validatePassword(password);
  const isPasswordValid =
    passwordRules.length &&
    passwordRules.upper &&
    passwordRules.lower &&
    passwordRules.number &&
    passwordRules.special;

  // ── Caller state ──
  const [callers, setCallers] = useState<any[]>([]);


  const [callerLeads, setCallerLeads] = useState<any[]>([]);
  const [batchList, setBatchList] = useState<any[]>([]);
  const [callerLoading, setCallerLoading] = useState(false);
  const [selectedCaller, setSelectedCaller] = useState<any>(null);
  const [callerSearch, setCallerSearch] = useState("");
  const [selectedBatch, setSelectedBatch] = useState("all");
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [callerSubView, setCallerSubView] = useState<"table" | "detail" | "control">("table");

  // ── Upload state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [assignUploadTo, setAssignUploadTo] = useState<string>("");

  // ── Take Control state ──
  const [controlLeads, setControlLeads] = useState<any[]>([]);
  const [controlSaved, setControlSaved] = useState<any[]>([]);

  const [salesManagers, setSalesManagers] = useState<any[]>([]);
  const [siteHeads, setSiteHeads] = useState<any[]>([]);


  const [isFetchingManagers, setIsFetchingManagers] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // ── Transfer Leads state ──
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferFrom, setTransferFrom] = useState<EmployeeType | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferConfirmed, setTransferConfirmed] = useState(false);

  const combinedAssignees = useMemo(() => {
    return [...salesManagers, ...siteHeads];
  }, [salesManagers, siteHeads]);

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 4000); };

  // ── Auth ──
  useEffect(() => {
    const cleanupBackGuard = installLoggedOutBackGuard(() => router.replace("/"));
    const parsed = getStoredCrmUser();
    if (!parsed) {
      router.replace("/");
      return cleanupBackGuard;
    }
    setUser(parsed);

    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "callers") setActiveSection("callers");
    else if (params.get("tab") === "ai") setActiveSection("ai");

    const userRole = parsed.role?.toLowerCase() || "";
    if (userRole === "admin" || userRole === "site head" || userRole === "site_head") {
      setIsAuthorized(true);
      fetchRoles();
      fetchEmployees();
    } else {
      setIsAuthorized(false);
    }
    return cleanupBackGuard;
  }, [router]);

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

  // 👇 2. UPDATED QUEUE & HISTORY POPULATOR (Safe SSR + Formatted Names + Follow-ups attached) 👇
  useEffect(() => {
    const checkNotifs = async () => {
      try {
        let storedIds: string[] = [];
        try {
          const item = localStorage.getItem("crm_shown_notif_ids");
          storedIds = item ? JSON.parse(item) : [];
          if (!Array.isArray(storedIds)) storedIds = [];
        } catch (e) {
          storedIds = [];
        }
        const seenSet = new Set(storedIds);

        // Fetch BOTH leads and followups so we know the exact site visit dates
        const [leadsRes, fupsRes] = await Promise.all([
          fetch("/api/walkin_enquiries"),
          fetch("/api/followups")
        ]);
        if (!leadsRes.ok || !fupsRes.ok) return;

        const leadsJson = await leadsRes.json();
        const fupsJson = await fupsRes.json();
        const leads: any[] = Array.isArray(leadsJson.data) ? leadsJson.data : [];
        const fups: any[] = Array.isArray(fupsJson.data) ? fupsJson.data : [];

        const fresh: CrmNotif[] = [];
        const history: (CrmNotif & { rawDate: number })[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Helper to get exact Name and Role
        const getCreatorInfo = (lead: any) => {
          const assigneeName = lead.assigned_to || lead.assigned_receptionist || "Unassigned";
          let role = "Sales Manager";
          if (siteHeads.some((sh: any) => sh.name === assigneeName)) {
            role = "Site Head";
          } else if (lead.assigned_receptionist && (!lead.assigned_to || lead.assigned_to === "Unassigned" || lead.assigned_to === "unknown")) {
            role = "Receptionist";
          }
          return { name: assigneeName, role };
        };

        leads.forEach((lead: any) => {
          const creatorInfo = getCreatorInfo(lead);
          const formattedId = String(lead.id).padStart(3, '0');

          // 1. Leads (1 Day Expiry)
          const createdDate = new Date(lead.created_at || 0);
          createdDate.setHours(0, 0, 0, 0);
          const createdDiffDays = (today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

          if (createdDiffDays <= 1) { // Today or Yesterday
            const leadNotif = {
              id: `lead_${lead.id}`,
              line1: `New Lead · ${formattedId} - ${lead.name}`,
              line2: `${creatorInfo.name} (${creatorInfo.role})`,
              type: "lead" as const
            };

            history.push({ ...leadNotif, id: `hist_lead_${lead.id}`, rawDate: new Date(lead.created_at || 0).getTime() });

            if (!seenSet.has(leadNotif.id)) {
              fresh.push(leadNotif);
              seenSet.add(leadNotif.id);
            }
          }

          // 2. Site Visits (Visible up to 3 days before, expires 2 days after)
          // Find the latest site visit date from follow-ups OR fallback to column
          const leadFups = fups.filter((f: any) => String(f.leadId) === String(lead.id) && f.siteVisitDate?.trim());
          const vDate = leadFups.length > 0 ? leadFups[leadFups.length - 1].siteVisitDate : lead.site_visit_date;

          if (vDate) {
            const visitDateObj = new Date(vDate);
            visitDateObj.setHours(0, 0, 0, 0);
            const diffDays = (visitDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

            if (diffDays >= -3 && diffDays <= 2) {
              const visitDate = new Date(vDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

              const visitNotif = {
                id: `visit_${lead.id}_${vDate}`,
                line1: `Site Visit · ${visitDate}`,
                line2: `${creatorInfo.name} (${creatorInfo.role}) - ${lead.name}`,
                type: "visit" as const
              };

              history.push({ ...visitNotif, id: `hist_visit_${lead.id}_${vDate}`, rawDate: new Date(vDate).getTime() });

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
          try {
            localStorage.setItem("crm_shown_notif_ids", JSON.stringify(Array.from(seenSet)));
          } catch (e) { }
        }
      } catch { }
    };

    checkNotifs();
    const interval = setInterval(checkNotifs, 10000);
    return () => clearInterval(interval);
  }, [siteHeads]);

  // 👇 3. TRIGGER POPUP LOGIC (Exactly 2 Seconds, Duplicates Removed) 👇
  useEffect(() => {
    if (activeNotif || notifQueue.length === 0) return;
    const nextNotif = notifQueue[0];
    setActiveNotif(nextNotif);
    setNotifQueue(prev => prev.slice(1));
    const t = setTimeout(() => setActiveNotif(null), 2000);
    return () => clearTimeout(t);
  }, [notifQueue, activeNotif]);

  useEffect(() => {
    if (activeSection === "callers") fetchCallerData();
  }, [activeSection]);

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };
  // ── Employee API ──
  // ✅ Add error feedback to fetchRoles
  const fetchRoles = async () => {
    try {
      const r = await fetch("/api/roles");
      if (r.ok) setDbRoles(await r.json());
      else console.error("Failed to fetch roles:", r.status);
    } catch (err) {
      console.error("fetchRoles network error:", err);
    }
  };
  const fetchEmployees = async () => {
    try { const r = await fetch("/api/employees"); if (r.ok) setEmployees(await r.json()); } catch { }
  };

  const handleAddNewRole = async () => {
    if (!newRoleInput.trim()) return;
    const r = await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newRoleInput }) });
    if (r.ok) { setNewRoleInput(""); fetchRoles(); }
    else { const d = await r.json(); alert(`Error: ${d.message}`); }
  };

  // ✅ Fixed — with try-catch + detailed error feedback
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      alert("Password does not meet security requirements");
      return;
    }
    try {
      const r = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: empName,
          username: empName.toLowerCase().replace(/\s+/g, "."),
          email,
          password,
          role,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setEmpName(""); setEmail(""); setPassword(""); setRole("");
        fetchEmployees();
      } else {
        alert(`Error: ${d.message || "Unknown error from server"}`);
      }
    } catch (err: any) {
      alert(`Network/Server Error: ${err.message}`);
      console.error("Add employee error:", err);
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
    const r = await fetch("/api/employees", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, isActive: !currentStatus }) });
    if (r.ok) fetchEmployees();
  };

  const handleDeleteEmployee = async (userId: string, userName: string) => {
    if (!window.confirm(`Delete ${userName}? Cannot be undone.`)) return;
    const r = await fetch("/api/employees", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    if (r.ok) { if (selectedManageUserId === userId) setSelectedManageUserId(""); fetchEmployees(); }
    else { const d = await r.json(); alert(`Error: ${d.message}`); }
  };

  const handleEditStart = (emp: EmployeeType) => { setEditingId(emp._id); setEditError(""); setEditForm({ name: emp.name, email: emp.email, password: emp.password || "", role: emp.role }); };
  const handleEditCancel = () => { setEditingId(null); setEditForm({}); setEditError(""); };
  const handleEditSave = async (userId: string) => {
    setEditSaving(true); setEditError("");
    if (editForm.password) {
      const editRules = validatePassword(editForm.password);
      const isValid = editRules.length && editRules.upper && editRules.lower && editRules.number && editRules.special;
      if (!isValid) {
        setEditError("Password does not meet security requirements");
        setEditSaving(false);
        return;
      }
    }
    try {
      const r = await fetch("/api/employees", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, editData: editForm }) });
      const d = await r.json();
      if (r.ok) { setEditingId(null); setEditForm({}); fetchEmployees(); }
      else setEditError(d.message || "Failed.");
    } catch { setEditError("Something went wrong."); }
    finally { setEditSaving(false); }
  };
  const toggleRowPassword = (id: string) => setRevealedPasswords(p => ({ ...p, [id]: !p[id] }));

  // ── Transfer Leads handler ──
  const handleTransferLeads = async () => {
    if (!transferFrom || !transferTo || !transferConfirmed) return;
    setTransferLoading(true);
    try {
      const res = await fetch("/api/transfer-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": user?.role || "",
        },
        body: JSON.stringify({ from: transferFrom.name, to: transferTo }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const count = data.transferred || 0;
        showToast(count > 0 ? `✅ ${count} lead(s) transferred successfully` : "ℹ️ No leads found to transfer");
        setTransferModalOpen(false);
        setTransferFrom(null);
        setTransferTo("");
        setTransferConfirmed(false);
        fetchEmployees();
      } else {
        showToast(`❌ ${data.message || "Transfer failed"}`);
      }
    } catch (err: any) {
      showToast(`❌ ${err.message || "Transfer failed"}`);
    } finally {
      setTransferLoading(false);
    }
  };

  // ── Caller API ──
  const fetchCallerData = async () => {
    setCallerLoading(true);
    try {
      const [empRes, leadsRes, batchRes] = await Promise.all([
        fetch("/api/employees"),
        fetch("/api/caller-leads"),
        fetch("/api/caller-leads?batches_only=1"),
      ]);
      if (empRes.ok) { const d = await empRes.json(); setCallers(d.filter((u: any) => u.role?.toLowerCase() === "caller")); }
      if (leadsRes.ok) { const j = await leadsRes.json(); setCallerLeads(j.leads || []); }
      if (batchRes.ok) { const j = await batchRes.json(); setBatchList(j.batches || []); }
    } catch (e) { console.error(e); }
    finally { setCallerLoading(false); }
  };

  useCallerSync({
    onLeadsUploaded: () => fetchCallerData(),
    onBatchDeleted: () => fetchCallerData(),
    onLeadUpdated: () => fetchCallerData(),
    onLeadDeleted: (e) => {
      setCallerLeads(prev => {
        const updated = prev.filter((l: any) => l.id !== e.leadId);
        const activeBatchNames = new Set(updated.map((l: any) => l.batch_name).filter(Boolean));
        setBatchList(prev2 => prev2.filter((b: any) => activeBatchNames.has(b.file_name)));
        return updated;
      });
    },
    onFollowupAdded: () => fetchCallerData(),
  });

  // ── Upload Excel ──
  const handleAdminUpload = async (file: File, assignToCaller?: string) => {
    if (!file) return;
    setUploading(true);
    setUploadMsg("Parsing Excel...");
    try {
      const leads = await parseExcelFile(file);
      setUploadMsg(`Saving ${leads.length} leads...`);
      const uploadedBy = assignToCaller || user?.name || "Admin";
      const res = await fetch("/api/caller-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads, fileName: file.name, uploadedBy, assignedTo: uploadedBy }),
      });
      if (!res.ok) throw new Error("Upload failed");
      setUploadMsg(`✓ ${leads.length} leads uploaded${assignToCaller ? ` → ${assignToCaller}` : ""}!`);
      setTimeout(() => setUploadMsg(""), 4000);
      await fetchCallerData();
    } catch (err: any) {
      setUploadMsg(`Error: ${err.message}`);
      setTimeout(() => setUploadMsg(""), 4000);
    } finally { setUploading(false); }
  };

  const handleDeleteBatch = async (batch: any) => {
    if (!window.confirm(`Delete all ${batch.row_count} leads from "${batch.file_name}"? Cannot be undone.`)) return;
    try {
      const res = await fetch("/api/caller-leads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: batch.id }) });
      if (!res.ok) throw new Error("Delete failed");
      await fetchCallerData();
      if (selectedBatch === batch.id) setSelectedBatch("all");
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  const handleDeleteLead = async (leadId: number, leadName: string) => {
    if (!window.confirm(`Delete lead "${leadName}"? Cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/caller-leads/${leadId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setCallerLeads(prev => prev.filter((l: any) => l.id !== leadId));
      if (selectedLead?.id === leadId) { setSelectedLead(null); setCallerSubView("table"); }
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  const handleTakeControl = (callerLeadsToControl: any[]) => {
    const leads = callerLeadsToControl.map(l => ({
      ...l,
      id: String(l.id).padStart(4, "0"),
      dbId: l.id,
      phone: l.contact_no,
      source: l.source,
      channelPartner: l.channel_partner,
      assignManager: l.assign_manager,
      followUps: (l.follow_ups || []).map((f: any) => ({
        id: String(f.id), message: f.message,
        createdAt: f.created_at, createdBy: f.created_by_name || "Admin",
      })),
      status: l.status || "new",
      interestStatus: l.interest_status || null,
      savedAt: l.created_at,
      feedback: l.feedback || "",
      email: l.email || "",
      budget: l.budget || "",
      location: l.location || "",
      siteVisitDate: l.site_visit_date || null,
    }));
    setControlLeads(leads);
    setControlSaved(leads.filter(l => l.status === "saved" || l.status === "not_interested" || l.status === "interested" || !!l.interestStatus));
    setCallerSubView("control");
  };

  const leadBelongsToCaller = (l: any, callerName: string) => {
    const assignedTo = (l.assigned_to || "").toLowerCase().trim();
    const uploadedBy = (l.uploaded_by || "").toLowerCase().trim();
    const name = callerName.toLowerCase().trim();
    if (assignedTo === name || uploadedBy === name) return true;
    const isUnassigned = !assignedTo || assignedTo === "admin" || assignedTo === "unknown";
    const uploadedByAdmin = !uploadedBy || uploadedBy === "admin" || uploadedBy === "unknown";
    return isUnassigned && uploadedByAdmin;
  };

  const filteredCallerLeads = useMemo(() => {
    let leads = callerLeads;
    if (selectedCaller) leads = leads.filter((l: any) => leadBelongsToCaller(l, selectedCaller.name));
    if (selectedBatch !== "all") leads = leads.filter((l: any) => String(l.upload_batch) === selectedBatch);
    if (leadSearch) {
      const s = leadSearch.toLowerCase();
      leads = leads.filter((l: any) =>
        l.name?.toLowerCase().includes(s) || l.contact_no?.includes(s) ||
        String(l.id).includes(s) || l.source?.toLowerCase().includes(s) ||
        l.channel_partner?.toLowerCase().includes(s) || l.assign_manager?.toLowerCase().includes(s) ||
        l.feedback?.toLowerCase().includes(s) || l.batch_name?.toLowerCase().includes(s)
      );
    }
    return leads;
  }, [callerLeads, selectedCaller, selectedBatch, leadSearch]);

  const callerSavedFormLeads = useMemo(() => {
    if (!selectedCaller) return [];
    return filteredCallerLeads.filter((l: any) =>
      l.status === "saved" || l.status === "not_interested" ||
      l.status === "interested" || !!l.interest_status
    );
  }, [filteredCallerLeads, selectedCaller]);

  const callerStats = useMemo(() => callers.map((c: any) => {
    const leads = callerLeads.filter((l: any) => leadBelongsToCaller(l, c.name));
    return { ...c, totalLeads: leads.length, interested: leads.filter((l: any) => l.interest_status === "Interested").length };
  }), [callers, callerLeads]);

  const filteredCallers = callerStats.filter((c: any) => c.name?.toLowerCase().includes(callerSearch.toLowerCase()));

  const menuItems = [
    { id: "dashboard", icon: FaThLarge, label: "Overview", link: "/dashboard", section: null },
    { id: "receptionist", icon: FaClipboardList, label: "Receptionist", link: "/dashboard", section: null },
    { id: "sales", icon: FaUsers, label: "Sales Managers", link: "/dashboard", section: null },
    { id: "site_head", icon: FaUniversity, label: "Site Heads", link: "/dashboard", section: null },
    // ADD THESE THREE — they navigate back to dashboard with the right tab
    { id: "attendance", icon: FaUserClock, label: "My Attendance", link: "/dashboard", section: null },
    { id: "monitoring", icon: FaChartPie, label: "Daily Monitor", link: "/dashboard", section: null },
    { id: "live_activity", icon: FaSignal, label: "Attendance Tracker", link: "/dashboard", section: null },
    { id: "geo", icon: FaMapMarkerAlt, label: "Geo Analytics", link: "/dashboard", section: null },
    { id: "callers", icon: FaPhoneAlt, label: "Caller Panel", link: "/dashboard/employees", section: "callers" as const },
    { id: "employees", icon: FaIdCard, label: "Add Employee", link: "/dashboard/employees", section: "employees" as const },
    { id: "ai", icon: FaWandMagicSparkles, label: "Bhoomi AI", link: "/dashboard/employees", section: "ai" as const },
  ];

  if (isAuthorized === null) return <div className="min-h-screen bg-[#0a0a0a]" />;
  const selectedManageUser = employees.find(e => e._id === selectedManageUserId);

  return (
    <div
      className={`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 ${t.pageWrap}`}
      style={t.pageStyle}
    >
      <AnimatePresence>
        {isSidebarHovered && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-40 pointer-events-none backdrop-blur-[1px]" />
        )}
      </AnimatePresence>

      {/* ── SIDEBAR ── */}
      <motion.aside
        initial={{ width: "72px" }} animate={{ width: isSidebarHovered ? "248px" : "72px" }} transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        onMouseEnter={() => setIsSidebarHovered(true)} onMouseLeave={() => setIsSidebarHovered(false)}
        className="fixed left-0 top-0 h-screen z-50 flex flex-col overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #0f0f1a 0%, #111128 40%, #0f0f1a 100%)",
          borderRight: "1px solid rgba(158,33,123,0.15)",
          boxShadow: "4px 0 24px rgba(0,0,0,0.4), inset -1px 0 0 rgba(158,33,123,0.08)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center px-4 py-5 mb-2 whitespace-nowrap flex-shrink-0">
          <img
            src="/assets/logobrowser_trans.png"
            alt="Logo"
            className="w-10 h-10 min-w-[40px] rounded-xl object-cover flex-shrink-0"
          />
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: isSidebarHovered ? 1 : 0, x: isSidebarHovered ? 0 : -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="ml-3 overflow-hidden"
          >
            <p className="font-black text-white text-[15px] leading-tight tracking-wide whitespace-nowrap">Bhoomi CRM</p>
            <p className="text-[10px] font-medium whitespace-nowrap" style={{ color: "rgba(217,70,168,0.7)" }}>Admin Panel</p>
          </motion.div>
        </div>

        {/* Divider */}
        <div className="mx-4 mb-4 flex-shrink-0" style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.3), transparent)" }} />

        {/* Nav */}
        {/* Nav */}
        <nav className="flex flex-col gap-2 px-2 flex-1 overflow-hidden">
          {/* Main nav items (all except last) */}
          <div className="flex flex-col gap-2 flex-1">
            {menuItems.slice(0, -1).map((item) => {
              const isActive = item.section ? activeSection === item.section : false;
              return (
                <div
                  key={item.id}
                  title={!isSidebarHovered ? item.label : undefined}
                  className="relative cursor-pointer group"
                  onClick={() => {
                    if (item.section) {
                      setActiveSection(item.section!);
                      setIsSidebarHovered(false);
                      if (item.section === "callers" && callerSubView === "control") setCallerSubView("table");
                    } else {
                      localStorage.setItem("return_tab", item.id);
                      router.push(item.link);
                      setIsSidebarHovered(false);
                    }
                  }}
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
                    className={`flex items-center gap-3 px-4.5 py-2.5 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"
                      }`}
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
                      className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"
                        }`}
                      style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}
                    >
                      <item.icon style={{ width: "17px", height: "17px" }} />
                    </div>
                    <span
                      className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"
                        }`}
                      style={{
                        maxWidth: isSidebarHovered ? "140px" : "0px",
                        opacity: isSidebarHovered ? 1 : 0,
                        transform: isSidebarHovered ? "translateX(0)" : "translateX(-6px)",
                        letterSpacing: "0.01em",
                      }}
                    >
                      {item.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Last item (Bhoomi AI) pinned to bottom */}
          {(() => {
            const item = menuItems[menuItems.length - 1];
            const isActive = item.section ? activeSection === item.section : false;
            return (
              <div
                key={item.id}
                title={!isSidebarHovered ? item.label : undefined}
                className="relative cursor-pointer group mt-auto"
                onClick={() => {
                  if (item.section) {
                    setActiveSection(item.section!);
                    setIsSidebarHovered(false);
                  } else {
                    localStorage.setItem("return_tab", item.id);
                    router.push(item.link);
                    setIsSidebarHovered(false);
                  }
                }}
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
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative overflow-hidden ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"
                    }`}
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
                    className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"
                      }`}
                    style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}
                  >
                    <item.icon style={{ width: "17px", height: "17px" }} />
                  </div>
                  <span
                    className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"
                      }`}
                    style={{
                      maxWidth: isSidebarHovered ? "140px" : "0px",
                      opacity: isSidebarHovered ? 1 : 0,
                      transform: isSidebarHovered ? "translateX(0)" : "translateX(-6px)",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {item.label}
                  </span>
                </div>
              </div>
            );
          })()}
        </nav>

        {/* Bottom gradient fade */}
        <div className="flex-shrink-0" style={{ height: "60px", background: "linear-gradient(0deg, #0f0f1a 0%, transparent 100%)" }} />
      </motion.aside>

      {/* ── MAIN ── */}
      <div className={`flex-1 flex flex-col pl-[72px] h-screen overflow-hidden transition-colors duration-300 ${t.mainBg}`}>

        {/* HEADER */}
        <header
          className={`h-16 flex items-center justify-between px-8 z-30 flex-shrink-0 transition-colors duration-300 ${t.header}`}
          style={{
            borderBottom: isDark ? "1px solid rgba(158,33,123,0.12)" : "1px solid rgba(0,0,0,0.08)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            background: isDark ? "rgba(10,10,15,0.85)" : "rgba(255,255,255,0.9)",
          }}
        >
          <h1 className={`font-bold text-lg tracking-wide flex items-center gap-3 ${t.headerTitle}`}>
            <img src="/assets/bhoomidwellersLogo_trans.png" alt="Bhoomi CRM" className="h-20 md:h-18 w-auto object-contain -ml-2" />
            <span className={`text-xs sm:text-sm font-normal ${t.textFaint}`}>— {activeSection === "callers"
              ? callerSubView === "control" ? "Caller Control Mode" : "Caller Panel"
              : activeSection === "ai" ? "Bhoomi AI" : "Add Employee"}</span>
            <span
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
              style={callerSubView === "control"
                ? { background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.3)", color: "#fb923c" }
                : { background: "rgba(158,33,123,0.12)", border: "1px solid rgba(158,33,123,0.3)", color: "#d946a8" }
              }
            >
              {callerSubView === "control" ? "Admin Acting as Caller" : "Admin Root"}
            </span>
          </h1>
          <div className="flex items-center gap-6">
            <LoginTimerWidget isDark={isDark} />
            <button onClick={() => {
              const next = !isDark;
              setIsDark(next);
              try {
                localStorage.setItem("crm_theme", next ? "dark" : "light");
              } catch { }
            }} aria-label="Toggle theme"
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center cursor-pointer justify-center shadow-sm ${t.toggleBtn}`}>
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* System Settings Icon */}
            {user?.role?.toLowerCase() === "admin" && (
              <button onClick={() => router.push("/dashboard/settings")} aria-label="Settings"
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center cursor-pointer justify-center shadow-sm ${t.toggleBtn}`}>
                <FaCog className="w-5 h-5" />
              </button>
            )}

            {/* CRM System Updates */}
            <CrmUpdatesNotification user={user} theme={t} isDark={isDark} />

            <div className="relative">
              <div className="relative cursor-pointer" onClick={() => { setIsNotifOpen(!isNotifOpen); setIsProfileOpen(false); setNotifCount(0); }}>
                <FaBell className={`${t.textMuted} hover:text-[#9E217B] transition-colors w-5 h-5`} />
                {notifCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#9E217B] rounded-full text-[9px] font-black text-white flex items-center justify-center">
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </div>

              {isNotifOpen && (
                <div className={`absolute top-12 right-0 w-[320px] border rounded-xl shadow-2xl flex flex-col z-50 animate-fadeIn ${t.dropdown}`}>
                  <div className={`p-4 border-b flex justify-between items-center ${t.innerBorder}`}>
                    <h3 className={`font-bold text-sm flex items-center gap-2 ${t.text}`}>
                      <FaBell className="text-[#9E217B]" /> Recent Notifications
                    </h3>
                    <button onClick={() => setIsNotifOpen(false)} className={`${t.textMuted} hover:text-red-500`}><FaTimes className="text-xs" /></button>
                  </div>
                  <div className={`max-h-[360px] overflow-y-auto ${t.scroll}`}>
                    {notificationHistory.filter(n => !dismissedNotifIds.has(n.id)).length === 0 ? (
                      <p className={`p-6 text-center text-xs ${t.textMuted}`}>No notifications yet.</p>
                    ) : (
                      notificationHistory.filter(n => !dismissedNotifIds.has(n.id)).map((n) => (
                        <div key={n.id} className={`p-4 border-b last:border-b-0 transition-colors flex items-start gap-3 relative group ${isDark ? "hover:bg-white/5 border-[#333]" : "hover:bg-black/5 border-[#E5E7EB]"}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white ${n.type === "visit" ? "bg-orange-500" : "bg-[#25D366]"}`}>
                            {n.type === "visit" ? <FaCalendarAlt className="text-[12px]" /> : <FaBriefcase className="text-[12px]" />}
                          </div>
                          <div>
                            <p className={`text-xs font-bold ${t.text}`}>{n.line1}</p>
                            <p className={`text-[10px] mt-1 ${t.textMuted}`}>{n.line2}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDismissedNotifIds(prev => new Set([...prev, n.id]));
                            }}
                            className={`absolute right-3 top-3 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all ${t.textMuted} hover:bg-red-500/10 hover:text-red-500 cursor-pointer`}
                            title="Delete Notification"
                          >
                            <FaTimes className="text-[10px]" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <div onClick={() => { setIsProfileOpen(!isProfileOpen); setIsNotifOpen(false); }}
                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer shadow-sm hover:opacity-80 transition-opacity border
                  ${isDark ? "border-[#9E217B]/40 text-[#d946a8] bg-[#9E217B]/15" : "border-[#9E217B]/40 text-[#9E217B] bg-[#9E217B]/10"}`}>
                {String(user?.name || "A").charAt(0).toUpperCase()}
              </div>
              {isProfileOpen && (
                <div className={`absolute top-12 right-0 w-64 border rounded-xl shadow-2xl p-5 z-50 animate-fadeIn ${t.dropdown}`}>
                  <div className="mb-4">
                    <h3 className={`font-bold text-lg ${t.text}`}>{user?.name || "Admin"}</h3>
                    <p className={`text-sm truncate ${t.textMuted}`}>{user?.email || "admin@bhoomi.com"}</p>
                  </div>
                  <hr className={`mb-4 ${t.innerBorder}`} />
                  <div className="space-y-4 mb-6 text-sm">
                    <p className={`flex justify-between items-center ${t.textMuted}`}>Role:
                      <span className={`font-bold capitalize px-2 py-0.5 rounded border ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/30" : "text-[#9E217B] bg-[#9E217B]/10 border-[#9E217B]/30"}`}>{user?.role || "Admin"}</span>
                    </p>
                    <div>
                      <p className={`text-xs mb-1 ${t.textMuted}`}>Password</p>
                      <div className={`flex items-center justify-between border p-2 rounded-md ${t.dropdownInner}`}>
                        <span className={`font-mono tracking-widest text-xs ${t.text}`}>{showPassword ? (user?.password || "N/A") : "••••••••"}</span>
                        <button onClick={() => setShowPassword(!showPassword)} className={`${t.textMuted} cursor-pointer`}>
                          {showPassword ? <FaEyeSlash /> : <FaEye />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleLogout} className={`w-full py-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${t.profileLogout}`}>Logout</button>
                </div>
              )}
            </div>

            {/* 👇 NOTIFICATION POPUP 👇 */}
            {activeNotif && (
              <div className="absolute top-[68px] right-4 z-[999] animate-fadeIn">
                <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border min-w-[280px] max-w-[360px]
                  ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-white border-[#E5E7EB]"}`}
                  style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>

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
                  <button onClick={() => setActiveNotif(null)}
                    className={`flex-shrink-0 mt-0.5 p-0.5 rounded cursor-pointer transition-colors ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>
                    <FaTimes className="text-[10px]" />
                  </button>

                </div>
              </div>
            )}
          </div>

        </header>

        {/* ── CONTENT ── */}
        {!isAuthorized ? (
          <main className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-20 h-20 bg-red-900/20 text-red-500 rounded-full flex items-center justify-center text-4xl mb-6"><FaLock /></div>
            <h1 className={`text-3xl font-bold mb-2 ${t.text}`}>Access Denied</h1>
            <Link href="/dashboard" className="bg-[#9E217B] hover:bg-[#b8268f] text-white font-bold py-3 px-8 rounded-lg transition-colors">Return to Dashboard</Link>
          </main>

        ) : activeSection === "employees" ? (

          /* ════════════ EMPLOYEE SECTION ════════════ */
          <main className={`flex-1 overflow-y-auto p-8 transition-colors duration-300 ${t.mainBg} ${t.scroll}`}>
            <div className="max-w-7xl mx-auto">
              <h1 className={`text-2xl font-bold mb-6 ${t.text}`}>Master Configurations</h1>

              {/* Tab pills */}
              <div className="flex flex-wrap gap-2 mb-8">
                <button className="flex items-center gap-2 bg-[#9E217B] text-white px-5 py-2 rounded-lg border border-[#b8268f] shadow-lg shadow-[#9E217B]/20 font-semibold">
                  <FaUserTie /> Employees
                </button>
              </div>

              {/* ── Add Custom Role ── */}
              <div
                className={`rounded-2xl p-6 mb-6 ${t.panel}`}
                style={{
                  border: isDark ? "1px solid rgba(158,33,123,0.12)" : "1px solid rgba(0,0,0,0.08)",
                  background: isDark ? "rgba(17,17,24,0.8)" : "#ffffff",
                  boxShadow: isDark
                    ? "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)"
                    : "0 2px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                <h2 className={`text-base font-bold mb-4 flex items-center gap-2 ${t.text}`}>
                  <div className={`w-1 h-5 ${t.dividerBar} rounded-full`} />
                  Add a Custom System Role
                </h2>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[260px] max-w-md">
                    <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Role Name</label>
                    <input type="text" value={newRoleInput} onChange={e => setNewRoleInput(e.target.value)}
                      className={t.inp} placeholder="e.g. Marketing Lead" />
                  </div>
                  <button onClick={handleAddNewRole}
                    className={`text-sm font-semibold py-2.5 px-5 rounded-lg border transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap
                      ${isDark ? "bg-[#1a1a1a] hover:bg-[#252525] text-white border-[#333] hover:border-[#9E217B]/50" : "bg-white hover:bg-pink-50 text-[#1A1A1A] border-indigo-300 hover:border-[#9E217B]/60"}`}>
                    <FaPlus className="text-[#9E217B] text-xs" /> Add to Dropdown
                  </button>
                </div>
              </div>

              {/* ── Create Employee Form ── */}
              <div
                className={`rounded-2xl p-6 mb-6 ${t.panel}`}
                style={{
                  border: isDark ? "1px solid rgba(158,33,123,0.12)" : "1px solid rgba(0,0,0,0.08)",
                  background: isDark ? "rgba(17,17,24,0.8)" : "#ffffff",
                  boxShadow: isDark
                    ? "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)"
                    : "0 2px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                <h2 className={`text-base font-bold mb-5 flex items-center gap-2 ${t.text}`}>
                  <div className={`w-1 h-5 ${t.dividerBar} rounded-full`} />
                  Create & Assign Role to Employee
                </h2>
                <form onSubmit={handleAddEmployee} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                  <div>
                    <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Full Name</label>
                    <input type="text" value={empName} onChange={e => setEmpName(e.target.value)} required className={t.inp} placeholder="e.g. John Doe" />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={t.inp} placeholder="email@company.com" />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Password</label>
                    <input type="text" value={password} onChange={e => setPassword(e.target.value)} required className={t.inp} placeholder="Set password" />

                    {/* Password Policy Real-time UI Check */}
                    <div className="text-[10px] mt-2 space-y-1 bg-black/5 p-2 rounded-lg border border-gray-200 dark:border-gray-800 dark:bg-white/5">
                      <p className={passwordRules.length ? "text-green-500 font-semibold" : "text-red-500"}>
                        {passwordRules.length ? "✅" : "❌"} Minimum 8 characters
                      </p>
                      <p className={passwordRules.upper ? "text-green-500 font-semibold" : "text-red-500"}>
                        {passwordRules.upper ? "✅" : "❌"} At least 1 uppercase letter
                      </p>
                      <p className={passwordRules.lower ? "text-green-500 font-semibold" : "text-red-500"}>
                        {passwordRules.lower ? "✅" : "❌"} At least 1 lowercase letter
                      </p>
                      <p className={passwordRules.number ? "text-green-500 font-semibold" : "text-red-500"}>
                        {passwordRules.number ? "✅" : "❌"} At least 1 number
                      </p>
                      <p className={passwordRules.special ? "text-green-500 font-semibold" : "text-red-500"}>
                        {passwordRules.special ? "✅" : "❌"} At least 1 special character
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Assign Role</label>
                    <select value={role} onChange={e => setRole(e.target.value)} required className={t.sel}>
                      <option value="" disabled>-- Choose Role --</option>
                      {dbRoles.map(r => <option key={r._id} value={r.name}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4 flex justify-end mt-2">
                    <button type="submit"
                      className="bg-[#9E217B] hover:bg-[#b8268f] text-white font-bold py-2.5 px-8 rounded-lg transition-all cursor-pointer shadow-lg shadow-[#9E217B]/20 flex items-center gap-2">
                      <FaPlus className="text-xs" /> Add Employee
                    </button>
                  </div>
                </form>
              </div>

              {/* ── Account Activation Management ── */}
              <div
                className={`rounded-2xl p-6 mb-6 ${t.panel}`}
                style={{
                  border: isDark ? "1px solid rgba(158,33,123,0.12)" : "1px solid rgba(0,0,0,0.08)",
                  background: isDark ? "rgba(17,17,24,0.8)" : "#ffffff",
                  boxShadow: isDark
                    ? "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)"
                    : "0 2px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                <h2 className={`text-base font-bold mb-5 flex items-center gap-2 ${t.text}`}>
                  <div className={`w-1 h-5 ${t.dividerBar} rounded-full`} />
                  Account Activation Management
                </h2>
                <div className="flex flex-col md:flex-row items-end gap-5">
                  <div className="flex-1 w-full max-w-md">
                    <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Select Employee</label>
                    <select value={selectedManageUserId} onChange={e => setSelectedManageUserId(e.target.value)} className={t.sel}>
                      <option value="" disabled>-- Select user to manage --</option>
                      {employees.map(emp => (
                        <option key={emp._id} value={emp._id}>{emp.email} ({emp.role})</option>
                      ))}
                    </select>
                  </div>
                  {selectedManageUser ? (
                    <button
                      onClick={() => handleToggleStatus(selectedManageUser._id, selectedManageUser.isActive)}
                      disabled={selectedManageUser.email === ADMIN_EMAIL}
                      className={`py-2.5 px-6 rounded-lg font-bold text-sm transition-colors cursor-pointer ${selectedManageUser.email === ADMIN_EMAIL
                        ? isDark ? "bg-[#222] border border-[#333] text-gray-600 cursor-not-allowed" : "bg-[#F1F5F9] border border-indigo-200 text-[#9CA3AF] cursor-not-allowed"
                        : selectedManageUser.isActive
                          ? "bg-red-600 hover:bg-red-700 text-white border border-red-500"
                          : "bg-green-600 hover:bg-green-700 text-white border border-green-500"
                        }`}
                    >
                      {selectedManageUser.email === ADMIN_EMAIL
                        ? "Protected Account"
                        : selectedManageUser.isActive ? "Deactivate Account" : "Activate Account"}
                    </button>
                  ) : (
                    <button disabled className={`py-2.5 px-6 rounded-lg font-bold text-sm cursor-not-allowed border ${isDark ? "bg-[#222] border-[#333] text-gray-500" : "bg-[#F1F5F9] border-indigo-200 text-[#9CA3AF]"}`}>Select User</button>
                  )}
                </div>
              </div>

              {/* ── Employee Table ── */}
              <div className={`rounded-2xl border overflow-hidden shadow-sm ${t.panel}`}>
                <div className={`p-5 border-b flex items-center justify-between ${t.panelHead}`}>
                  <h2 className={`text-base font-bold flex items-center gap-2 ${t.text}`}>
                    <FaUsers className="text-[#9E217B]" /> Registered Employees Database
                  </h2>
                  <span className={`text-[10px] px-3 py-1 rounded-full border ${t.textFaint} ${t.pillBg} ${t.pillBorder}`}>{employees.length} employees</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className={`text-xs uppercase ${t.tableHead} ${t.tableHeadBdr}`}>
                      <tr>
                        {["Name", "Email", "Password", "Assigned Role", "Status", "Actions"].map(h => (
                          <th key={h} className={`px-6 py-4 font-semibold ${t.tableHeadText} ${h === "Status" || h === "Actions" ? "text-center" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${t.tableDivide}`}>
                      {employees.map(emp => {
                        const isRevealed = revealedPasswords[emp._id] || false;
                        const isEditing = editingId === emp._id;
                        const isAdminUser = emp.email === ADMIN_EMAIL;
                        return (
                          <tr key={emp._id} className={`transition-colors group ${isEditing ? t.editRow : isAdminUser ? t.adminRow : t.tableRow}`}>
                            {/* Name */}
                            <td className={`px-5 py-3.5 font-medium ${t.text}`}>
                              {isEditing
                                ? <input value={editForm.name || ""} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} className={t.editInp} />
                                : <div className="flex items-center gap-2">
                                  {emp.name}
                                  {isAdminUser && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase border ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/30" : "text-[#9E217B] bg-[#9E217B]/10 border-[#9E217B]/30"}`}>Protected</span>}
                                </div>
                              }
                            </td>
                            {/* Email */}
                            <td className={`px-5 py-3.5 ${t.textLight}`}>
                              {isEditing
                                ? <input type="email" value={editForm.email || ""} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} className={t.editInp} />
                                : emp.email
                              }
                            </td>
                            {/* Password */}
                            <td className="px-5 py-3.5">
                              {isEditing
                                ? <input value={editForm.password || ""} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} className={t.editInp} />
                                : <div className="flex items-center gap-3">
                                  <span className={`font-mono tracking-wider ${t.textLight}`}>{isRevealed ? (emp.password || "N/A") : "••••••••"}</span>
                                  <button onClick={() => toggleRowPassword(emp._id)} className={`${t.textMuted} hover:text-[#9E217B] cursor-pointer`}><FaEyeSlash /></button>
                                </div>
                              }
                            </td>
                            {/* Role */}
                            <td className="px-5 py-3.5">
                              {isEditing
                                ? <select value={editForm.role || ""} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))} className={t.editSel}>
                                  {dbRoles.map(r => <option key={r._id} value={r.name}>{r.name}</option>)}
                                </select>
                                : <span className={`font-semibold capitalize ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>{emp.role}</span>
                              }
                            </td>
                            {/* Status */}
                            <td className="px-5 py-3.5 text-center">
                              <span className={`border px-3 py-1 rounded text-xs font-bold uppercase tracking-widest inline-block w-[80px] ${emp.isActive ? "border-green-500/30 text-green-500 bg-green-500/10" : "border-red-500/30 text-red-500 bg-red-500/10"}`}>
                                {emp.isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                            {/* Actions */}
                            <td className="px-5 py-3.5">
                              {isEditing ? (
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className="flex gap-2">
                                    <button onClick={() => handleEditSave(emp._id)} disabled={editSaving}
                                      className="bg-[#9E217B] hover:bg-[#b8268f] disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-colors">
                                      {editSaving ? "Saving..." : "Save"}
                                    </button>
                                    <button onClick={handleEditCancel}
                                      className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer border ${isDark ? "bg-[#2a2a2a] hover:bg-[#333] text-gray-300 border-[#333]" : "bg-[#F1F5F9] hover:bg-[#E5E7EB] text-[#374151] border-indigo-200"}`}>
                                      Cancel
                                    </button>
                                  </div>
                                  {editError && <span className="text-red-400 text-[10px] font-semibold text-center max-w-[140px]">{editError}</span>}
                                </div>
                              ) : isAdminUser ? (
                                <div className="flex items-center justify-center">
                                  <span className={`text-[10px] italic ${t.textLight2}`}>Protected</span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => handleEditStart(emp)}
                                    className={`p-2 rounded-lg transition-colors cursor-pointer ${t.textMuted} hover:text-[#d946a8] hover:bg-[#9E217B]/10`}>
                                    <FaUserEdit />
                                  </button>
                                  {user?.role?.toLowerCase() === "admin" && (
                                    <button
                                      onClick={() => { setTransferFrom(emp); setTransferTo(""); setTransferConfirmed(false); setTransferModalOpen(true); }}
                                      title="Transfer Leads"
                                      className={`p-2 rounded-lg transition-colors cursor-pointer ${isDark ? "text-orange-400/70 hover:text-orange-300 hover:bg-orange-500/10" : "text-orange-500/70 hover:text-orange-600 hover:bg-orange-500/10"}`}>
                                      <FaExchangeAlt />
                                    </button>
                                  )}
                                  <button onClick={() => handleDeleteEmployee(emp._id, emp.name)}
                                    className={`p-2 rounded-lg transition-colors cursor-pointer ${t.textLight2} hover:text-red-500 hover:bg-red-500/10`}>
                                    <FaTrash />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {employees.length === 0 && (
                        <tr><td colSpan={6} className={`px-6 py-8 text-center ${t.textMuted}`}>No employees found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </main>

        ) : activeSection === "ai" ? (

          <main className={`flex-1 flex flex-col h-full overflow-hidden transition-colors duration-300 ${t.mainBg}`}>
            {/* Chat History Area */}
            <div className={`flex-1 overflow-y-auto p-8 ${t.scroll} custom-scrollbar`}>
              <div className="max-w-4xl mx-auto space-y-8 pb-20">

                {/* Intro Greeting */}
                <div className="text-center mt-10">
                  <div className="w-16 h-16 rounded-full bg-[#9E217B]/10 flex items-center justify-center mx-auto mb-4 border border-[#9E217B]/30 shadow-[0_0_30px_rgba(158,33,123,0.3)]">
                    <FaWandMagicSparkles className="text-3xl text-[#d946a8]" />
                  </div>
                  <h1 className={`text-4xl font-black tracking-tight mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                    Hello, {user?.name?.split(' ')[0] || "Admin"}
                  </h1>
                  <p className={`text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-[#d946a8] to-orange-400`}>
                    How can Bhoomi AI assist your sales pipeline today?
                  </p>
                </div>

                {/* Example Mock AI Message (Replace with real state map later) */}
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#9E217B] to-orange-500 flex items-center justify-center flex-shrink-0 shadow-lg">
                    <FaWandMagicSparkles className="text-white text-xs" />
                  </div>
                  <div className={`flex-1 rounded-2xl p-5 shadow-sm leading-relaxed ${isDark ? "bg-[#111111] border border-[#222] text-gray-300" : "bg-white border border-indigo-100 text-gray-700"}`}>
                    <p><strong>System Ready.</strong> I have analyzed your CRM data. Would you like to see the top priority leads for today, or review the employee daily monitor report?</p>
                  </div>
                </div>

              </div>
            </div>

            {/* Gemini-Style Input Bar */}
            <div className={`p-6 flex-shrink-0 flex justify-center ${isDark ? "bg-[#0a0a0a]/80" : "bg-[#F8FAFC]/80"} backdrop-blur-md`}>
              <div className="w-full max-w-4xl relative">
                {/* Magenta Glow Container */}
                <div className={`relative flex items-center rounded-2xl overflow-hidden transition-shadow duration-300
                  ${isDark
                    ? "bg-[#1a1a1a] border border-[#9E217B]/50 shadow-[0_0_20px_rgba(158,33,123,0.25)] focus-within:shadow-[0_0_35px_rgba(158,33,123,0.5)]"
                    : "bg-white border border-[#9E217B]/50 shadow-[0_0_20px_rgba(158,33,123,0.15)] focus-within:shadow-[0_0_35px_rgba(158,33,123,0.4)]"
                  }`}
                >
                  <input
                    type="text"
                    placeholder="Ask Bhoomi AI to analyze leads, check employee tasks, or find a customer..."
                    className={`w-full py-4 pl-6 pr-14 outline-none text-sm font-medium bg-transparent
                      ${isDark ? "text-white placeholder:text-gray-500" : "text-gray-900 placeholder:text-gray-400"}
                    `}
                  />
                  <button className="absolute right-3 w-10 h-10 rounded-xl bg-gradient-to-r from-[#9E217B] to-[#c7299a] text-white flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg">
                    <FaWandMagicSparkles className="text-sm" />
                  </button>
                </div>
                <p className="text-center text-[10px] text-gray-500 mt-3 font-medium">
                  Bhoomi AI may occasionally make mistakes. Always verify critical lead data.
                </p>
              </div>
            </div>
          </main>

        ) : callerSubView === "control" ? (

          <CallerControlMode
            leads={controlLeads}
            savedLeads={controlSaved}
            setSavedLeads={setControlSaved}
            adminName={user?.name || "Admin"}
            onExit={() => { setCallerSubView("table"); fetchCallerData(); }}
          />

        ) : (

          /* ════════════ CALLER PANEL ════════════ */
          <div className="flex flex-1 h-full overflow-hidden">

            {/* Caller Sidebar */}
            <div className={`w-72 flex flex-col h-full flex-shrink-0 shadow-xl transition-colors duration-300 ${t.callerSidebar}`}>
              <div className={`p-4 border-b space-y-3 ${t.innerBorder}`}>
                <div>
                  <label className={`text-[10px] font-bold uppercase tracking-wider mb-1 block ${t.batchLabel}`}>Assign Upload To</label>
                  <select value={assignUploadTo} onChange={e => setAssignUploadTo(e.target.value)} className={t.smallSel}>
                    <option value="">Admin (unassigned)</option>
                    {callers.map((c: any) => <option key={c._id || c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={exportTemplate}
                    className={`flex-1 flex items-center justify-center gap-2 border py-2 rounded-lg text-xs font-bold transition-all cursor-pointer
                      ${isDark ? "bg-[#1a1a1a] hover:bg-[#222] border-[#333] hover:border-green-500/50 text-gray-300 hover:text-green-400" : "bg-white hover:bg-green-50 border-indigo-200 hover:border-green-400/60 text-[#6B7280] hover:text-green-600"}`}>
                    <FaDownload className="text-green-400 text-[10px]" /> Template
                  </button>
                  <label
                    className={`flex-1 flex items-center justify-center gap-2 border py-2 rounded-lg text-xs font-bold transition-all cursor-pointer
                      ${isDark ? "bg-[#1a1a1a] hover:bg-[#222] border-[#333] hover:border-[#9E217B]/50 text-gray-300 hover:text-white" : "bg-white hover:bg-pink-50 border-indigo-200 hover:border-[#9E217B]/50 text-[#6B7280] hover:text-[#9E217B]"}`}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleAdminUpload(f, assignUploadTo || undefined); }}
                  >
                    <FaFileExcel className="text-green-400 text-[10px]" />
                    {uploading ? "Uploading..." : "Upload Excel"}
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" ref={fileInputRef}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleAdminUpload(f, assignUploadTo || undefined); e.target.value = ""; }} />
                  </label>
                </div>
                {uploadMsg && (
                  <div className={`text-[10px] font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${uploadMsg.startsWith("✓") ? t.uploadSuccess : uploadMsg.startsWith("Error") ? t.uploadError : t.uploadInfo}`}>
                    {uploadMsg}
                  </div>
                )}
                <div className="relative">
                  <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                  <input type="text" placeholder="Search Callers..." value={callerSearch} onChange={e => setCallerSearch(e.target.value)} className={t.searchInp} />
                </div>
              </div>

              <div className={`flex-1 overflow-y-auto ${t.scroll}`}>
                {/* All Callers */}
                <div onClick={() => { setSelectedCaller(null); setCallerSubView("table"); setSelectedLead(null); setLeadSearch(""); setSelectedBatch("all"); }}
                  className={`p-4 flex items-center gap-3 cursor-pointer transition-all ${t.callerItemBdr} ${!selectedCaller ? t.callerItemSel : `${t.callerItemDef} ${t.callerItemHov}`}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 ${!selectedCaller ? "bg-[#9E217B]" : isDark ? "bg-[#333] text-gray-400" : "bg-gray-300 text-gray-600"}`}><FaPhoneAlt className="text-sm" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <h3 className={`font-bold text-sm ${t.text}`}>All Callers</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isDark ? "text-[#d946a8] bg-[#9E217B]/10" : "text-[#9E217B] bg-pink-100"}`}>{callerLeads.length} leads</span>
                    </div>
                    <p className={`text-xs ${t.textFaint}`}>{callers.length} callers total</p>
                  </div>
                </div>

                {callerLoading ? <div className={`p-8 text-center text-sm ${t.textMuted}`}>Loading...</div>
                  : filteredCallers.length === 0 ? <div className={`p-8 text-center text-sm ${t.textMuted}`}>{callers.length === 0 ? "No callers. Add user with role 'Caller'." : "No callers match."}</div>
                    : filteredCallers.map((caller: any) => {
                      const isSel = selectedCaller?.name === caller.name;
                      const thisCallerLeads = callerLeads.filter((l: any) => leadBelongsToCaller(l, caller.name));
                      return (
                        <div key={caller._id || caller.name} className={`${t.callerItemBdr} ${isSel ? t.callerItemSel : t.callerItemDef}`}>
                          <div onClick={() => { setSelectedCaller(caller); setCallerSubView("table"); setSelectedLead(null); setLeadSearch(""); setSelectedBatch("all"); }}
                            className={`p-4 flex items-center gap-3 cursor-pointer transition-all ${t.callerItemHov}`}>
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 ${isSel ? "bg-[#9E217B]" : isDark ? "bg-[#333] text-gray-400" : "bg-gray-300 text-gray-600"}`}>
                              {caller.name?.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-center mb-0.5">
                                <h3 className={`font-bold truncate text-sm ${t.text}`}>{caller.name}</h3>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isDark ? "text-[#d946a8] bg-[#9E217B]/10" : "text-[#9E217B] bg-pink-100"}`}>{caller.totalLeads} leads</span>
                              </div>
                              <p className={`text-xs flex items-center gap-2 ${t.textFaint}`}>
                                <span className="text-green-500">{caller.interested} interested</span>
                                <span className={`w-1.5 h-1.5 rounded-full ${caller.isActive ? "bg-green-500" : "bg-red-500"}`} />
                                {caller.isActive ? "Active" : "Inactive"}
                              </p>
                            </div>
                          </div>
                          {isSel && (
                            <div className="px-4 pb-3">
                              <button
                                onClick={e => { e.stopPropagation(); handleTakeControl(thisCallerLeads); }}
                                className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 text-white font-bold px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer shadow-lg shadow-orange-600/20 border border-orange-500">
                                <FaDesktop className="text-xs" /> Take Control of {caller.name.split(" ")[0]}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
              </div>

              {batchList.length > 0 && (
                <div className={`p-3 max-h-52 overflow-y-auto ${t.batchTop} ${t.scroll}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 px-1 ${t.batchLabel}`}>Uploaded Excel Files</p>
                  {batchList.map((b: any) => (
                    <div key={b.id}
                      className={`flex items-center justify-between p-2 rounded-lg mb-1 cursor-pointer transition-colors ${selectedBatch === String(b.id) ? t.batchItemSel : t.batchItemDef}`}
                      onClick={() => setSelectedBatch(String(b.id))}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FaFileExcel className="text-green-500 text-xs flex-shrink-0" />
                        <div className="min-w-0">
                          <p className={`text-xs font-medium truncate max-w-[130px] ${t.text}`}>{b.file_name}</p>
                          <p className={`text-[10px] ${t.textFaint}`}>{b.row_count} leads · {formatDate(b.created_at).split(",")[0]}</p>
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); handleDeleteBatch(b); }}
                        className={`${t.textLight2} hover:text-red-400 p-1 rounded transition-colors cursor-pointer flex-shrink-0 ml-1`}>
                        <FaTrash className="text-[10px]" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Panel */}
            <div className={`flex-1 flex flex-col h-full overflow-hidden transition-colors duration-300 ${t.rightPanel}`}>
              <div className={`p-5 border-b flex justify-between items-center flex-shrink-0 shadow-sm ${t.rightHeader}`}>
                <div>
                  <h2 className={`text-lg font-bold flex items-center gap-2 ${t.text}`}>
                    <FaPhoneAlt className="text-[#9E217B]" />
                    {selectedCaller ? `${selectedCaller.name}'s Saved Forms` : "All Caller Leads"}
                  </h2>
                  <p className={`text-xs mt-1 ${t.textFaint}`}>
                    {selectedCaller
                      ? `${callerSavedFormLeads.length} saved forms · ${filteredCallerLeads.length} total leads`
                      : `${filteredCallerLeads.length} total leads · Live sync active`}
                  </p>
                </div>
                {!selectedCaller && (
                  <div className="flex gap-2 text-xs flex-wrap items-center">
                    <span className="bg-green-500/10 border border-green-500/30 text-green-400 px-3 py-1 rounded-full">{filteredCallerLeads.filter((l: any) => l.interest_status === "Interested").length} Interested</span>
                    <span className="bg-red-500/10 border border-red-500/30 text-red-400 px-3 py-1 rounded-full">{filteredCallerLeads.filter((l: any) => l.interest_status === "Not Interested").length} Not Interested</span>
                    <span className={`px-3 py-1 rounded-full border ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30 text-[#d946a8]" : "bg-pink-50 border-pink-200 text-[#9E217B]"}`}>{filteredCallerLeads.filter((l: any) => l.status === "saved").length} Saved</span>
                  </div>
                )}
                {selectedCaller && (
                  <div className="flex gap-2 text-xs flex-wrap items-center">
                    <span className={`px-3 py-1 rounded-full border ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30 text-[#d946a8]" : "bg-pink-50 border-pink-200 text-[#9E217B]"}`}>{callerSavedFormLeads.length} Forms</span>
                    <span className="bg-green-500/10 border border-green-500/30 text-green-400 px-3 py-1 rounded-full">{callerSavedFormLeads.filter((l: any) => l.interest_status === "Interested").length} Interested</span>
                    <span className="bg-red-500/10 border border-red-500/30 text-red-400 px-3 py-1 rounded-full">{callerSavedFormLeads.filter((l: any) => l.interest_status === "Not Interested").length} Not Int.</span>
                  </div>
                )}
              </div>

              {/* Detail View */}
              {callerSubView === "detail" && selectedLead ? (
                <div className={`flex-1 overflow-y-auto p-6 animate-fadeIn ${t.scroll}`}>
                  <div className={`flex items-center gap-4 mb-6 border rounded-2xl p-5 ${t.detailCard}`}>
                    <button onClick={() => { setCallerSubView("table"); setSelectedLead(null); }}
                      className={`w-10 h-10 flex items-center justify-center border rounded-lg cursor-pointer transition-colors ${isDark ? "bg-[#1a1a1a] hover:bg-[#222] border-[#333] text-gray-400" : "bg-white hover:bg-[#F8FAFC] border-indigo-200 text-[#6B7280]"}`}>
                      <FaChevronLeft />
                    </button>
                    <div className="flex-1">
                      <h1 className={`text-xl font-bold flex items-center gap-3 ${t.text}`}>
                        <span className={t.accentText}>#{selectedLead.id}</span>{selectedLead.name}
                      </h1>
                      <p className={`text-xs mt-0.5 ${t.textFaint}`}>From: <span className={t.textLight}>{selectedLead.batch_name || "—"}</span></p>
                    </div>
                    {interestBadge(selectedLead.interest_status)}
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className={`border rounded-2xl p-6 ${t.detailCard}`}>
                      <h3 className={`text-xs font-bold uppercase tracking-wider mb-4 pb-2 ${t.accentText} ${t.detailSection}`}>Lead Information</h3>
                      <div className="space-y-3 text-sm">
                        {[
                          { label: "Contact No.", value: selectedLead.contact_no },
                          { label: "Email", value: selectedLead.email },
                          { label: "Source", value: selectedLead.source },
                          { label: "Channel Partner", value: selectedLead.channel_partner },
                          { label: "Assign Manager", value: selectedLead.assign_manager },
                          { label: "Budget", value: selectedLead.budget },
                          { label: "Status", value: selectedLead.status },
                          { label: "Uploaded On", value: formatDate(selectedLead.created_at).split(",")[0] },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-start">
                            <p className={`text-xs ${t.textFaint}`}>{label}</p>
                            <p className={`font-medium text-right max-w-[55%] break-words ${t.text}`}>{value || "—"}</p>
                          </div>

                        ))}
                        <div className="flex justify-between items-center pt-1">
                          <p className={`text-xs ${t.textFaint}`}>Interest</p>
                          {interestBadge(selectedLead.interest_status)}
                        </div>
                      </div>
                      {selectedLead.feedback && (
                        <div className="mt-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
                          <p className="text-[10px] text-yellow-400 font-bold uppercase mb-1">Caller Feedback</p>
                          <p className={`text-sm ${t.textLight}`}>{selectedLead.feedback}</p>
                        </div>
                      )}
                      {selectedLead.site_visit_date && (
                        <div className="mt-4 bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-orange-400 font-bold mb-1">Site Visit</p>
                          <p className={`font-bold ${t.text}`}>{formatDate(selectedLead.site_visit_date)}</p>
                        </div>
                      )}
                    </div>
                    <div className={`border rounded-2xl overflow-hidden flex flex-col ${t.detailCard}`} style={{ minHeight: "400px" }}>
                      <div className={`p-4 border-b ${t.panelHead}`}>
                        <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${t.text}`}><FaComments className={t.accentText} /> Follow-up Timeline</h3>
                      </div>
                      <div className={`flex-1 overflow-y-auto p-5 flex flex-col gap-4 ${t.followBg} ${t.scroll}`}>
                        <div className="flex justify-start">
                          <div className={`border rounded-2xl rounded-tl-none p-4 max-w-[85%] ${t.followSys}`}>
                            <div className="flex justify-between items-center mb-2 gap-4">
                              <span className={`font-bold text-xs ${t.accentText}`}>System</span>
                              <span className={`text-[10px] ${t.textFaint}`}>{formatDate(selectedLead.created_at)}</span>
                            </div>
                            <p className={`text-sm ${t.textLight}`}>Lead uploaded to Caller Panel.</p>
                          </div>
                        </div>
                        {(selectedLead.follow_ups || []).length === 0
                          ? <div className={`flex-1 flex flex-col items-center justify-center py-6 ${t.textLight2}`}><FaComments className="text-3xl mb-3 opacity-20" /><p className="text-sm">No follow-ups yet.</p></div>
                          : (selectedLead.follow_ups || []).map((fup: any, idx: number) => (
                            <div key={idx} className="flex justify-start">
                              <div className={`rounded-2xl rounded-tl-none p-4 max-w-[85%] ${t.followMsg}`}>
                                <div className="flex justify-between items-center mb-2 gap-4">
                                  <span className={`font-bold text-xs ${t.text}`}>{fup.created_by_name || "Caller"}</span>
                                  <span className={`text-[10px] ${t.textMuted}`}>{formatDate(fup.created_at)}</span>
                                </div>
                                <p className={`text-sm whitespace-pre-wrap ${t.text}`}>{fup.message}</p>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  </div>
                </div>

              ) : (
                <div className={`flex-1 overflow-y-auto p-6 ${t.scroll}`}>

                  {/* Individual Caller — Saved Forms */}
                  {selectedCaller ? (
                    <div className="space-y-5 animate-fadeIn">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          { label: "Saved Forms", value: callerSavedFormLeads.length, color: "text-[#d946a8]", bg: isDark ? "bg-[#9E217B]/10 border-[#9E217B]/20" : "bg-pink-50 border-pink-200" },
                          { label: "Interested", value: callerSavedFormLeads.filter((l: any) => l.interest_status === "Interested").length, color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
                          { label: "Not Interested", value: callerSavedFormLeads.filter((l: any) => l.interest_status === "Not Interested").length, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                          { label: "Pending Review", value: callerSavedFormLeads.filter((l: any) => !l.interest_status && l.status === "saved").length, color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
                        ].map(s => (
                          <div key={s.label} className={`rounded-2xl p-4 border ${s.bg}`}>
                            <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${t.textFaint}`}>{s.label}</p>
                            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className={`border rounded-2xl overflow-hidden ${t.panel}`}>
                        <div className={`p-4 border-b flex flex-wrap justify-between items-center gap-3 ${t.panelHead}`}>
                          <div>
                            <h3 className={`font-bold text-sm flex items-center gap-2 ${t.text}`}><FaClipboardList className={t.accentText} /> {selectedCaller.name}'s Saved Forms</h3>
                            <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>Only leads this caller has saved or interacted with</p>
                          </div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="relative">
                              <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                              <input type="text" placeholder="Search forms..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)}
                                className={`${t.searchInp} w-44`} />
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded border ${t.textFaint} ${t.pillBg} ${t.pillBorder}`}>{callerSavedFormLeads.length} forms</span>
                            <button onClick={fetchCallerData} className={`text-xs font-bold px-3 py-2 rounded-lg cursor-pointer border transition-colors ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/20 hover:bg-[#9E217B]/20" : "text-[#9E217B] bg-pink-50 border-pink-200 hover:bg-pink-100"}`}>↻ Refresh</button>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className={`text-[11px] uppercase ${t.tableHead} ${t.tableHeadText}`}>
                              <tr>{["#", "Name", "Contact", "Source", "Channel Partner", "Assign Manager", "Feedback", "Interest", "Status", "Site Visit", "Follow-ups", "Saved On", "Action"].map(h => (
                                <th key={h} className={`px-4 py-3 ${t.tableHeadBdr} whitespace-nowrap ${h === "Action" ? "text-center" : ""}`}>{h}</th>
                              ))}</tr>
                            </thead>
                            <tbody className={`divide-y ${t.tableDivide}`}>
                              {callerLoading
                                ? <tr><td colSpan={13} className={`px-4 py-8 text-center ${t.textMuted}`}>Loading...</td></tr>
                                : callerSavedFormLeads.length === 0
                                  ? <tr><td colSpan={13} className="px-4 py-12 text-center">
                                    <FaClipboardList className={`text-4xl mx-auto mb-3 ${t.textLight2}`} />
                                    <p className={`font-semibold ${t.textMuted}`}>{selectedCaller.name} hasn't saved any forms yet.</p>
                                    <p className={`text-xs mt-1 ${t.textLight2}`}>Forms appear here once the caller saves a lead from their panel.</p>
                                  </td></tr>
                                  : callerSavedFormLeads.map((lead: any) => (
                                    <tr key={lead.id} className={`transition-colors group align-middle ${t.tableRow}`}>
                                      <td className={`px-4 py-3 font-mono font-bold ${t.accentText}`}>#{lead.id}</td>
                                      <td className={`px-4 py-3 font-semibold whitespace-nowrap ${t.text}`}>{lead.name}</td>
                                      <td className={`px-4 py-3 font-mono text-sm ${t.textLight}`}>{maskPhone(lead.contact_no)}</td>
                                      <td className={`px-4 py-3 ${t.textLight}`}>{lead.source || "—"}</td>
                                      <td className={`px-4 py-3 whitespace-nowrap ${t.textLight}`}>{lead.channel_partner || "—"}</td>
                                      <td className={`px-4 py-3 whitespace-nowrap ${t.textLight}`}>{lead.assign_manager || "—"}</td>
                                      <td className="px-4 py-3 max-w-[140px]">
                                        {lead.feedback
                                          ? <span className="text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[120px]" title={lead.feedback}>{lead.feedback}</span>
                                          : <span className={`italic text-xs ${t.textLight2}`}>—</span>}
                                      </td>
                                      <td className="px-4 py-3 align-middle">{interestBadge(lead.interest_status)}</td>
                                      <td className="px-4 py-3 whitespace-nowrap">
                                        {lead.status === "saved" || lead.status === "not_interested" || lead.status === "interested" || !!lead.interest_status
                                          ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit border ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/20" : "text-[#9E217B] bg-pink-50 border-pink-200"}`}>
                                            <FaPhoneAlt className="text-[8px]" />
                                            {lead.uploaded_by && lead.uploaded_by !== "admin" && lead.uploaded_by !== "Admin" && lead.uploaded_by !== "unknown"
                                              ? `Caller · ${lead.uploaded_by}`
                                              : lead.assigned_to && lead.assigned_to !== "admin" && lead.assigned_to !== "Admin" && lead.assigned_to !== "unknown"
                                                ? `Caller · ${lead.assigned_to}`
                                                : <span className={`italic ${t.textFaint}`}>Not saved yet</span>}
                                          </span>
                                          : <span className={`text-[10px] italic ${t.textLight2}`}>Not saved yet</span>}
                                      </td>
                                      <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${isDark ? "text-[#d946a8]/70" : "text-[#9E217B]/60"}`}>{lead.batch_name || "—"}</td>
                                      <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${t.textFaint}`}>{formatDate(lead.created_at).split(",")[0]}</td>
                                      <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                          <button onClick={() => { setSelectedLead(lead); setCallerSubView("detail"); }}
                                            className={`text-xs flex items-center gap-1 px-2 py-1 rounded-lg border border-transparent cursor-pointer mx-auto transition-colors ${t.textMuted} hover:text-[#9E217B] hover:bg-[#9E217B]/10 hover:border-[#9E217B]/20`}>
                                            <FaEye className="text-[10px]" /> View
                                          </button>
                                          <button onClick={e => { e.stopPropagation(); handleDeleteLead(lead.id, lead.name); }}
                                            className={`text-xs flex items-center gap-1 px-2 py-1 rounded-lg border border-transparent cursor-pointer transition-colors ${t.textLight2} hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20`}>
                                            <FaTrash className="text-[10px]" />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))
                              }
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                  ) : (
                    /* All Callers — Raw Leads Table */
                    <div className={`border rounded-2xl overflow-hidden ${t.panel}`}>
                      <div className={`p-4 border-b flex flex-wrap justify-between items-center gap-3 ${t.panelHead}`}>
                        <h3 className={`font-bold text-sm flex items-center gap-2 ${t.text}`}><FaPhoneAlt className={t.accentText} /> All Caller Leads</h3>
                        <div className="flex items-center gap-3 flex-wrap">
                          <select value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)} className={t.smallSel}>
                            <option value="all">All Excel Files</option>
                            {batchList.map((b: any) => <option key={b.id} value={String(b.id)}>{b.file_name} ({b.row_count})</option>)}
                          </select>
                          <div className="relative">
                            <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
                            <input type="text" placeholder="Search leads..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)}
                              className={`${t.searchInp} w-44`} />
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded border ${t.textFaint} ${t.pillBg} ${t.pillBorder}`}>{filteredCallerLeads.length} leads</span>
                          <button onClick={fetchCallerData} className={`text-xs font-bold px-3 py-2 rounded-lg cursor-pointer border transition-colors ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/20 hover:bg-[#9E217B]/20" : "text-[#9E217B] bg-pink-50 border-pink-200 hover:bg-pink-100"}`}>↻ Refresh</button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className={`text-[11px] uppercase ${t.tableHead} ${t.tableHeadText}`}>
                            <tr>{["#", "Name", "Contact", "Source", "Channel Partner", "Assign Manager", "Feedback", "Interest", "Saved By", "Excel File", "Uploaded On", "Action"].map(h => (
                              <th key={h} className={`px-4 py-3 ${t.tableHeadBdr} whitespace-nowrap ${h === "Action" ? "text-center" : ""}`}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody className={`divide-y ${t.tableDivide}`}>
                            {callerLoading ? <tr><td colSpan={12} className={`px-4 py-8 text-center ${t.textMuted}`}>Loading...</td></tr>
                              : filteredCallerLeads.length === 0 ? <tr><td colSpan={12} className={`px-4 py-8 text-center ${t.textMuted}`}>No caller leads yet.</td></tr>
                                : filteredCallerLeads.map((lead: any) => (
                                  <tr key={lead.id} className={`transition-colors group align-middle ${t.tableRow}`}>
                                    <td className={`px-4 py-3 font-mono font-bold ${t.accentText}`}>#{lead.id}</td>
                                    <td className={`px-4 py-3 font-semibold whitespace-nowrap ${t.text}`}>{lead.name}</td>
                                    <td className={`px-4 py-3 font-mono text-sm ${t.textLight}`}>{maskPhone(lead.contact_no)}</td>
                                    <td className={`px-4 py-3 ${t.textLight}`}>{lead.source || "—"}</td>
                                    <td className={`px-4 py-3 whitespace-nowrap ${t.textLight}`}>{lead.channel_partner || "—"}</td>
                                    <td className={`px-4 py-3 whitespace-nowrap ${t.textLight}`}>{lead.assign_manager || "—"}</td>
                                    <td className="px-4 py-3 max-w-[150px]">
                                      {lead.feedback
                                        ? <span className="text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[130px]" title={lead.feedback}>{lead.feedback}</span>
                                        : <span className={`italic text-xs ${t.textLight2}`}>—</span>}
                                    </td>
                                    <td className="px-4 py-3 align-middle">{interestBadge(lead.interest_status)}</td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      {lead.status === "saved" || lead.status === "not_interested" || lead.status === "interested" || !!lead.interest_status
                                        ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit border ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/20" : "text-[#9E217B] bg-pink-50 border-pink-200"}`}>
                                          <FaPhoneAlt className="text-[8px]" />
                                          {lead.uploaded_by && lead.uploaded_by !== "admin" && lead.uploaded_by !== "Admin" && lead.uploaded_by !== "unknown"
                                            ? `Caller · ${lead.uploaded_by}`
                                            : lead.assigned_to && lead.assigned_to !== "admin" && lead.assigned_to !== "Admin" && lead.assigned_to !== "unknown"
                                              ? `Caller · ${lead.assigned_to}`
                                              : <span className={`italic ${t.textFaint}`}>Not saved yet</span>}
                                        </span>
                                        : <span className={`text-[10px] italic ${t.textLight2}`}>Not saved yet</span>}
                                    </td>
                                    <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${isDark ? "text-[#d946a8]/70" : "text-[#9E217B]/60"}`}>{lead.batch_name || "—"}</td>
                                    <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${t.textFaint}`}>{formatDate(lead.created_at).split(",")[0]}</td>
                                    <td className="px-4 py-3 text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        <button onClick={() => { setSelectedLead(lead); setCallerSubView("detail"); }}
                                          className={`text-xs flex items-center gap-1 px-2 py-1 rounded-lg border border-transparent cursor-pointer transition-colors ${t.textMuted} hover:text-[#9E217B] hover:bg-[#9E217B]/10 hover:border-[#9E217B]/20`}>
                                          <FaEye className="text-[10px]" /> View
                                        </button>
                                        <button onClick={e => { e.stopPropagation(); handleDeleteLead(lead.id, lead.name); }}
                                          className={`text-xs flex items-center gap-1 px-2 py-1 rounded-lg border border-transparent cursor-pointer transition-colors ${t.textLight2} hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20`}>
                                          <FaTrash className="text-[10px]" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                            }
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── TRANSFER LEADS MODAL ── */}
      <AnimatePresence>
        {transferModalOpen && transferFrom && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!transferLoading) { setTransferModalOpen(false); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md mx-4 rounded-2xl border shadow-2xl overflow-hidden ${t.panel}`}
              style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }}
            >
              {/* Header */}
              <div className={`px-6 py-5 border-b flex items-center gap-3 ${t.panelHead}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-orange-500/15" : "bg-orange-50"}`}>
                  <FaExchangeAlt className={`text-lg ${isDark ? "text-orange-400" : "text-orange-500"}`} />
                </div>
                <div>
                  <h2 className={`font-bold text-base ${t.text}`}>Transfer All Leads</h2>
                  <p className={`text-[11px] ${t.textFaint}`}>Reassign workload between employees</p>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5">
                {/* From */}
                <div>
                  <label className={`block text-xs mb-1.5 font-semibold ${t.textMuted}`}>🔄 Transfer From</label>
                  <div className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold border ${isDark ? "bg-[#1a1a1a] border-[#333] text-gray-300" : "bg-[#F8FAFC] border-indigo-200 text-[#374151]"}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${isDark ? "bg-[#9E217B]" : "bg-[#9E217B]"}`}>
                        {transferFrom.name.charAt(0).toUpperCase()}
                      </div>
                      {transferFrom.name}
                      <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${isDark ? "text-[#d946a8] bg-[#9E217B]/10 border-[#9E217B]/30" : "text-[#9E217B] bg-[#9E217B]/10 border-[#9E217B]/30"}`}>{transferFrom.role}</span>
                    </div>
                  </div>
                </div>

                {/* To */}
                <div>
                  <label className={`block text-xs mb-1.5 font-semibold ${t.textMuted}`}>🔁 Transfer To</label>
                  <select
                    value={transferTo}
                    onChange={e => setTransferTo(e.target.value)}
                    className={t.sel}
                  >
                    <option value="" disabled>-- Select target employee --</option>
                    {employees
                      .filter(emp => emp._id !== transferFrom._id && emp.isActive && emp.email !== ADMIN_EMAIL)
                      .map(emp => (
                        <option key={emp._id} value={emp.name}>{emp.name} ({emp.role})</option>
                      ))}
                  </select>
                </div>

                {/* Warning */}
                <div className={`flex items-start gap-3 rounded-xl p-3.5 border ${isDark ? "bg-orange-500/5 border-orange-500/20" : "bg-orange-50 border-orange-200"}`}>
                  <FaExclamationTriangle className={`text-sm mt-0.5 flex-shrink-0 ${isDark ? "text-orange-400" : "text-orange-500"}`} />
                  <p className={`text-xs leading-relaxed ${isDark ? "text-orange-300/80" : "text-orange-700"}`}>
                    This will transfer <strong>ALL</strong> leads currently assigned to <strong>{transferFrom.name}</strong> to the selected employee.
                  </p>
                </div>

                {/* Confirm checkbox */}
                <label className={`flex items-center gap-3 cursor-pointer select-none group`}>
                  <input
                    type="checkbox"
                    checked={transferConfirmed}
                    onChange={e => setTransferConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded border-2 accent-[#9E217B] cursor-pointer"
                  />
                  <span className={`text-xs ${t.textMuted} group-hover:${t.text}`}>
                    I understand this action cannot be undone
                  </span>
                </label>
              </div>

              {/* Footer */}
              <div className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${t.innerBorder}`}>
                <button
                  onClick={() => { setTransferModalOpen(false); setTransferFrom(null); setTransferTo(""); setTransferConfirmed(false); }}
                  disabled={transferLoading}
                  className={`text-sm font-semibold px-5 py-2.5 rounded-lg cursor-pointer border transition-colors ${isDark ? "bg-[#1a1a1a] hover:bg-[#222] border-[#333] text-gray-300" : "bg-white hover:bg-[#F8FAFC] border-indigo-200 text-[#374151]"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleTransferLeads}
                  disabled={!transferTo || !transferConfirmed || transferLoading}
                  className={`text-sm font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-all flex items-center gap-2 shadow-lg
                    ${!transferTo || !transferConfirmed || transferLoading
                      ? isDark ? "bg-[#222] border border-[#333] text-gray-600 cursor-not-allowed shadow-none" : "bg-[#F1F5F9] border border-indigo-200 text-[#9CA3AF] cursor-not-allowed shadow-none"
                      : "bg-orange-600 hover:bg-orange-500 text-white border border-orange-500 shadow-orange-600/20"
                    }`}
                >
                  {transferLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Transferring...
                    </>
                  ) : (
                    <>
                      <FaExchangeAlt className="text-xs" /> Transfer Now
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── TOAST NOTIFICATION ── */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className={`fixed bottom-6 right-6 z-[9999] px-5 py-3 rounded-xl shadow-2xl border text-sm font-semibold flex items-center gap-2 max-w-md
              ${toastMsg.startsWith("✅") ? isDark ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-green-50 border-green-200 text-green-700"
                : toastMsg.startsWith("ℹ️") ? isDark ? "bg-blue-500/10 border-blue-500/30 text-blue-400" : "bg-blue-50 border-blue-200 text-blue-700"
                  : isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-700"}`}
          >
            {toastMsg}
            <button onClick={() => setToastMsg(null)} className="ml-2 opacity-60 hover:opacity-100 cursor-pointer"><FaTimes className="text-xs" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar{width:5px;height:5px}
        .custom-scrollbar::-webkit-scrollbar-track{background:transparent}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:rgba(158,33,123,0.3);border-radius:10px}
        .custom-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(158,33,123,0.55)}
        .custom-scrollbar-light::-webkit-scrollbar{width:5px;height:5px}
        .custom-scrollbar-light::-webkit-scrollbar-track{background:transparent}
        .custom-scrollbar-light::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.1);border-radius:10px}
        .custom-scrollbar-light::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.2)}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        .animate-fadeIn{animation:fadeIn 0.25s cubic-bezier(0.4,0,0.2,1)}
        @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .animate-slideUp{animation:slideUp 0.3s cubic-bezier(0.4,0,0.2,1)}
        @keyframes sm-glow-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}} />
    </div>
  );
}

// ============================================================================
// CALLER CONTROL MODE  (orange-themed — unchanged)
// ============================================================================
function CallerControlMode({ leads, savedLeads, setSavedLeads, adminName, onExit }: {
  leads: any[]; savedLeads: any[];
  setSavedLeads: React.Dispatch<React.SetStateAction<any[]>>;
  adminName: string; onExit: () => void;
}) {
  const [section, setSection] = useState<"dashboard" | "forms" | "interested" | "not_interested">("dashboard");
  const [detailLead, setDetailLead] = useState<any>(null);
  const [ticketLead, setTicketLead] = useState<any>(null);
  const [noteInput, setNoteInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // ── Lazy load state ───────────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadLessRef = useRef<HTMLDivElement>(null);

  const fmtDate = (ds?: string) => {
    if (!ds) return "—";
    try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return ds; }
  };
  const mPhone = (p?: string) => {
    if (!p) return "N/A";
    const c = String(p).replace(/\D/g, "");
    return c.length <= 5 ? c : `${c.slice(0, 2)}*****${c.slice(-3)}`;
  };
  const iBadge = (status?: string) => {
    if (!status) return <span className="text-[10px] text-gray-600 italic">—</span>;
    const map: Record<string, string> = {
      "Interested": "text-green-400 bg-green-500/10 border-green-500/30",
      "Not Interested": "text-red-400 bg-red-500/10 border-red-500/30",
      "Non Genuine Demand": "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    };
    const short: Record<string, string> = { "Interested": "Interested", "Not Interested": "Not Int.", "Non Genuine Demand": "Non Genuine Demand" };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap ${map[status] ?? "text-gray-400 bg-gray-500/10 border-gray-500/30"}`}>{short[status] ?? status}</span>;
  };

  const isLeadSaved = (id: string) => savedLeads.some(l => l.id === id);

  const saveLead = (lead: any) => {
    if (isLeadSaved(lead.id)) return;
    setSavedLeads(prev => [...prev, { ...lead, savedAt: new Date().toISOString(), followUps: lead.followUps || [], status: "saved" }]);
    if (lead.dbId) fetch(`/api/caller-leads/${lead.dbId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "saved" }) }).catch(() => { });
  };

  const setInterest = async (lead: any, status: "Interested" | "Not Interested" | "Non Genuine Demand") => {
    setSavedLeads(prev => prev.map(l => l.id === lead.id ? { ...l, interestStatus: status, status: status === "Not Interested" ? "not_interested" : "saved" } : l));
    if (detailLead?.id === lead.id) setDetailLead((p: any) => ({ ...p, interestStatus: status }));
    if (lead.dbId) await fetch(`/api/caller-leads/${lead.dbId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interest_status: status, status: status === "Not Interested" ? "not_interested" : "saved" }) }).catch(() => { });
  };

  const sendNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim() || !detailLead) return;
    const fu = { id: Date.now().toString(), message: noteInput, createdAt: new Date().toISOString(), createdBy: adminName + " (Admin)" };
    setSavedLeads(prev => prev.map(l => l.id === detailLead.id ? { ...l, followUps: [...(l.followUps || []), fu] } : l));
    setDetailLead((p: any) => ({ ...p, followUps: [...(p.followUps || []), fu] }));
    setNoteInput("");
    if (detailLead.dbId) {
      await fetch(`/api/caller-leads/${detailLead.dbId}/follow-ups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: noteInput.trim(), created_by: adminName + " (Admin)" }) }).catch(() => { });
    }
  };

  const revertLead = async (id: string) => {
    setSavedLeads(prev => prev.map(l => l.id === id ? { ...l, status: "saved", interestStatus: undefined } : l));
    const lead = savedLeads.find(l => l.id === id);
    if (lead?.dbId) await fetch(`/api/caller-leads/${lead.dbId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "saved", interest_status: null }) }).catch(() => { });
  };

  const formLeads = savedLeads.filter(l => l.status !== "not_interested");
  const interestedLeads = savedLeads.filter(l => l.interestStatus === "Interested");
  const notIntLeads = savedLeads.filter(l => l.status === "not_interested");
  const filtered = leads.filter(l => (l.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || String(l.id).includes(searchTerm));
  // ── Current section total (drives the bottom sentinel) ───────────────────────
  const currentSectionTotal = useMemo(() => {
    if (section === "dashboard") return filtered.length;
    if (section === "forms") return formLeads.length;
    if (section === "interested") return interestedLeads.length;
    if (section === "not_interested") return notIntLeads.length;
    return 0;
  }, [section, filtered.length, formLeads.length, interestedLeads.length, notIntLeads.length]);

  // ── Bottom sentinel: load 20 more on scroll down ──────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, currentSectionTotal));
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [currentSectionTotal]);

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

  // ── Reset count when section changes ─────────────────────────────────────────
  useEffect(() => {
    setVisibleCount(20);
  }, [section]);
  const sidebarItems = [
    { id: "dashboard", icon: FaThLarge, label: "Dashboard", badge: null, dot: "bg-orange-500" },
    { id: "forms", icon: FaClipboardList, label: "Forms", badge: formLeads.length, dot: "bg-orange-500" },
    { id: "interested", icon: FaHeart, label: "Interested", badge: interestedLeads.length, dot: "bg-green-500" },
    { id: "not_interested", icon: FaTimesCircle, label: "Not Interested", badge: notIntLeads.length, dot: "bg-red-500" },
  ];

  const sectionActive = (id: string) => ({
    dashboard: "text-orange-400 bg-orange-500/10",
    forms: "text-orange-400 bg-orange-500/10",
    interested: "text-green-400 bg-green-500/10",
    not_interested: "text-red-400 bg-red-500/10",
  }[id] || "text-orange-400 bg-orange-500/10");

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-[#0a0a0a]">
      {/* Ticket Modal */}
      {ticketLead && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setTicketLead(null)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-[10px] text-orange-400 font-bold uppercase tracking-wider mb-1">Admin Control — Lead Ticket</p>
                <h2 className="text-xl font-bold text-white">{ticketLead.name}</h2>
              </div>
              <button onClick={() => setTicketLead(null)} className="text-gray-500 hover:text-white p-1 cursor-pointer"><FaTimes /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="col-span-2 bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Contact No.</p><p className="text-white font-mono font-semibold">{ticketLead.contact_no || ticketLead.phone || "N/A"}</p></div>
              {ticketLead.email && <div className="col-span-2 bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Email</p><p className="text-white text-sm truncate">{ticketLead.email}</p></div>}
              {ticketLead.channel_partner && <div className="bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Channel Partner</p><p className="text-white text-sm">{ticketLead.channel_partner}</p></div>}
              {ticketLead.assign_manager && <div className="bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Assign Manager</p><p className="text-white text-sm">{ticketLead.assign_manager}</p></div>}
              <div className="col-span-2 flex justify-between bg-[#222] rounded-xl p-3 border border-[#333]">
                <div><p className="text-[10px] text-gray-500 mb-1">Source</p><p className="text-white">{ticketLead.source || "—"}</p></div>
                <div className="text-right"><p className="text-[10px] text-gray-500 mb-1">Lead ID</p><p className="text-orange-400 font-bold font-mono">#{ticketLead.id}</p></div>
              </div>
              {ticketLead.feedback && (
                <div className="col-span-2 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
                  <p className="text-[10px] text-yellow-400 font-bold uppercase mb-1">Feedback</p>
                  <p className="text-sm text-gray-300">{ticketLead.feedback}</p>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setTicketLead(null)} className="flex-1 bg-[#222] hover:bg-[#333] border border-[#333] text-gray-300 font-semibold py-2.5 rounded-xl cursor-pointer text-sm">Close</button>
              <button onClick={() => { saveLead(ticketLead); setTicketLead(null); }} disabled={isLeadSaved(ticketLead.id)}
                className={`flex-1 flex items-center justify-center gap-2 font-bold py-2.5 rounded-xl cursor-pointer text-sm ${isLeadSaved(ticketLead.id) ? "bg-green-800/30 border border-green-600/30 text-green-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-500 text-white"}`}>
                {isLeadSaved(ticketLead.id) ? <><FaCheckCircle /> Saved</> : <><FaSave /> Save to Forms</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control Mode Sidebar */}
      <aside className="w-20 bg-[#111111] border-r border-[#222] flex flex-col items-center py-6 flex-shrink-0">
        <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center text-xl font-bold text-white mb-8 cursor-pointer hover:bg-orange-500 transition-colors" title="Exit" onClick={onExit}>✕</div>
        <nav className="flex flex-col gap-2 w-full px-2">
          {sidebarItems.map(({ id, icon: Icon, label, badge, dot }) => (
            <div key={id} onClick={() => { setSection(id as any); setDetailLead(null); }} title={label}
              className={`relative flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer transition-colors ${section === id ? sectionActive(id) : "text-gray-500 hover:bg-[#1a1a1a] hover:text-gray-300"}`}>
              {section === id && <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 ${dot} rounded-r-full`} />}
              <Icon className="w-4 h-4" />
              {badge !== null && badge! > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-600 rounded-full text-[9px] font-black text-white flex items-center justify-center">{badge! > 9 ? "9+" : badge}</span>
              )}
            </div>
          ))}
        </nav>
        <div className="mt-auto px-2 w-full">
          <button onClick={onExit} title="Exit" className="w-full flex flex-col items-center py-3 rounded-xl text-orange-500 hover:bg-orange-500/10 cursor-pointer transition-colors">
            <FaDesktop className="w-4 h-4" />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-12 bg-orange-600/10 border-b border-orange-500/30 flex items-center justify-between px-6 flex-shrink-0">
          <p className="text-orange-400 font-bold text-sm flex items-center gap-2"><FaDesktop className="text-xs" /> Admin Control Mode — Acting as Caller</p>
          <button onClick={onExit} className="text-orange-400 hover:text-white text-xs font-bold border border-orange-500/30 hover:bg-orange-600 px-4 py-1.5 rounded-lg cursor-pointer transition-colors">Exit Control Mode</button>
        </div>

        <main className="flex-1 overflow-y-auto p-6 bg-[#0a0a0a] custom-scrollbar">

          {/* DASHBOARD */}

          {section === "dashboard" && !detailLead && (
            <div className="animate-fadeIn space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Leads", value: leads.length, color: "text-white", bg: "bg-orange-500/10 border-orange-500/20" },
                  { label: "Saved to Forms", value: savedLeads.length, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
                  { label: "Interested", value: interestedLeads.length, color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
                  { label: "Not Interested", value: notIntLeads.length, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                ].map(s => (
                  <div key={s.label} className={`rounded-2xl p-5 border ${s.bg}`}>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">{s.label}</p>
                    <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
                <input type="text" placeholder="Search leads..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#222] rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:border-orange-500 outline-none" />
              </div>
              <div className="bg-[#111111] border border-[#222] rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-[#222] bg-[#151515] flex justify-between items-center">
                  <h3 className="font-bold text-white text-sm flex items-center gap-2"><FaUpload className="text-orange-400" /> Uploaded Leads</h3>
                  <span className="text-[10px] text-gray-500 bg-[#222] px-2 py-0.5 rounded border border-[#333]">{filtered.length} leads · Click any row to open ticket</span>
                </div>
                <div className="overflow-x-auto">

                  {/* ── TOP SENTINEL ── */}
                  <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />

                  <table className="w-full text-left text-sm text-gray-400">
                    <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                      <tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Interest", "Status"].map(h => (
                        <th key={h} className="px-4 py-3 border-b border-[#222] whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {filtered.length === 0
                        ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-600">No leads found.</td></tr>
                        : filtered.slice(0, visibleCount).map((lead: any) => {
                          const saved = isLeadSaved(lead.id);
                          const sl = savedLeads.find(l => l.id === lead.id);
                          return (
                            <tr key={lead.id} onClick={() => setTicketLead(lead)} className="hover:bg-[#1a1a1a] transition-colors cursor-pointer group align-middle">
                              <td className="px-4 py-3 font-mono text-orange-400 font-bold">#{lead.id}</td>
                              <td className="px-4 py-3 text-white font-semibold group-hover:text-orange-300 whitespace-nowrap">{lead.name}</td>
                              <td className="px-4 py-3 font-mono text-sm">{mPhone(lead.contact_no || lead.phone)}</td>
                              <td className="px-4 py-3 text-gray-300">{lead.source || "—"}</td>
                              <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.channel_partner || "—"}</td>
                              <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.assign_manager || lead.assignManager || "—"}</td>
                              <td className="px-4 py-3 max-w-[150px]">
                                {lead.feedback
                                  ? <span className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[130px]" title={lead.feedback}>{lead.feedback}</span>
                                  : <span className="text-gray-600 italic text-xs">—</span>}
                              </td>
                              <td className="px-4 py-3 align-middle">{iBadge(sl?.interestStatus)}</td>
                              <td className="px-4 py-3">
                                {saved
                                  ? <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded-full">Saved</span>
                                  : <span className="text-[10px] font-bold text-gray-500 bg-[#222] border border-[#333] px-2 py-0.5 rounded-full">New</span>}
                              </td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                  </table>

                  {/* ── BOTTOM SENTINEL ── */}
                  {visibleCount < filtered.length && (
                    <div ref={loadMoreRef} className="flex items-center justify-center gap-3 py-6 text-gray-500">
                      <div className="w-4 h-4 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                      <span className="text-xs font-medium">Loading more… ({visibleCount} of {filtered.length})</span>
                    </div>
                  )}
                  {visibleCount >= filtered.length && filtered.length > 20 && (
                    <div className="text-center py-4 text-xs font-medium text-gray-600">
                      ✓ All {filtered.length} leads loaded
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

          {/* FORMS — card grid with slice */}
          {section === "forms" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaClipboardList className="text-orange-400" /> Saved Forms</h2>
                <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{formLeads.length} leads</span>
              </div>
              {formLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaSave className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold mb-1">No saved leads yet</p></div>
                : <>
                  {/* ── TOP SENTINEL ── */}
                  <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {formLeads.slice(0, visibleCount).map((lead: any) => (
                      <div key={lead.id} onClick={() => setDetailLead(lead)}
                        className="bg-[#1a1a1a] border border-[#2a2a2a] hover:border-orange-500/50 rounded-2xl p-5 cursor-pointer transition-all group">
                        <div className="flex justify-between items-start mb-4 pb-3 border-b border-[#2a2a2a]">
                          <div>
                            <p className="text-[10px] text-orange-400 font-bold mb-1">#{lead.id}</p>
                            <h3 className="text-white font-bold group-hover:text-orange-300 transition-colors">{lead.name}</h3>
                          </div>
                          {lead.interestStatus ? iBadge(lead.interestStatus) : <span className="text-[10px] font-bold text-gray-500 bg-[#222] border border-[#333] px-2 py-0.5 rounded-full">Pending</span>}
                        </div>
                        <div className="space-y-2 text-sm">
                          <p className="text-gray-400 flex items-center gap-2 text-xs"><FaPhoneAlt className="text-[10px]" />{mPhone(lead.contact_no || lead.phone)}</p>
                          {(lead.channel_partner || lead.channelPartner) && <p className="text-gray-400 text-xs flex items-center gap-2"><FaUserTie className="text-[10px]" />{lead.channel_partner || lead.channelPartner}</p>}
                          {lead.feedback && <p className="text-yellow-400 text-xs truncate">{lead.feedback}</p>}
                          {lead.siteVisitDate && <p className="text-orange-400 text-xs flex items-center gap-1"><FaCalendarAlt className="text-[9px]" />{fmtDate(lead.siteVisitDate).split(",")[0]}</p>}
                          {(lead.followUps || []).length > 0 && <p className="text-[#d946a8] text-xs">{lead.followUps.length} follow-up{lead.followUps.length > 1 ? "s" : ""}</p>}
                        </div>
                        <div className="mt-4 pt-3 border-t border-[#2a2a2a] flex justify-between items-center">
                          <span className="text-[10px] text-gray-600">{fmtDate(lead.savedAt).split(",")[0]}</span>
                          <span className="text-[10px] font-bold text-gray-500 group-hover:text-orange-400 transition-colors">Open →</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── BOTTOM SENTINEL ── */}
                  {visibleCount < formLeads.length && (
                    <div ref={loadMoreRef} className="flex items-center justify-center gap-3 py-6 text-gray-500 mt-4">
                      <div className="w-4 h-4 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                      <span className="text-xs font-medium">Loading more… ({visibleCount} of {formLeads.length})</span>
                    </div>
                  )}
                  {visibleCount >= formLeads.length && formLeads.length > 20 && (
                    <div className="text-center py-4 text-xs font-medium text-gray-600 mt-2">
                      ✓ All {formLeads.length} leads loaded
                    </div>
                  )}
                </>
              }
            </div>
          )}

          {/* INTERESTED */}
          {section === "interested" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaHeart className="text-green-400" /> Interested Leads</h2>
                <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{interestedLeads.length} leads</span>
              </div>
              {interestedLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaHeart className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold">No interested leads yet</p></div>
                : <div className="bg-[#111111] border border-[#222] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">

                    {/* ── TOP SENTINEL ── */}
                    <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />

                    <table className="w-full text-left text-sm text-gray-400">
                      <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                        <tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Follow-ups", "Site Visit", "Saved On", "Actions"].map(h => (
                          <th key={h} className={`px-4 py-3 border-b border-[#222] whitespace-nowrap ${h === "Actions" ? "text-center" : ""}`}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a]">
                        {interestedLeads.slice(0, visibleCount).map((lead: any) => (
                          <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors group align-middle">
                            <td className="px-4 py-3 font-mono text-green-400 font-bold">#{lead.id}</td>
                            <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{lead.name}</td>
                            <td className="px-4 py-3 font-mono text-sm">{mPhone(lead.contact_no || lead.phone)}</td>
                            <td className="px-4 py-3 text-gray-300">{lead.source || "—"}</td>
                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.channel_partner || lead.channelPartner || "—"}</td>
                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.assign_manager || lead.assignManager || "—"}</td>
                            <td className="px-4 py-3 max-w-[150px]">
                              {lead.feedback ? <span className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[130px]" title={lead.feedback}>{lead.feedback}</span> : <span className="text-gray-600 italic text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3"><span className="text-[10px] bg-[#222] border border-[#333] px-2 py-0.5 rounded-full font-bold">{(lead.followUps || []).length} notes</span></td>
                            <td className="px-4 py-3 text-[11px]">{lead.siteVisitDate ? <span className="text-orange-400">{fmtDate(lead.siteVisitDate).split(",")[0]}</span> : <span className="text-gray-600">—</span>}</td>
                            <td className="px-4 py-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(lead.savedAt).split(",")[0]}</td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => setDetailLead(lead)} className="text-gray-500 hover:text-green-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-500/10 border border-transparent hover:border-green-500/20 mx-auto">
                                <FaEye className="text-[10px]" /> View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* ── BOTTOM SENTINEL ── */}
                    {visibleCount < interestedLeads.length && (
                      <div ref={loadMoreRef} className="flex items-center justify-center gap-3 py-6 text-gray-500">
                        <div className="w-4 h-4 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
                        <span className="text-xs font-medium">Loading more… ({visibleCount} of {interestedLeads.length})</span>
                      </div>
                    )}
                    {visibleCount >= interestedLeads.length && interestedLeads.length > 20 && (
                      <div className="text-center py-4 text-xs font-medium text-gray-600">
                        ✓ All {interestedLeads.length} leads loaded
                      </div>
                    )}

                  </div>
                </div>
              }
            </div>
          )}

          {/* NOT INTERESTED */}
          {section === "not_interested" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaTimesCircle className="text-red-400" /> Not Interested</h2>
                <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{notIntLeads.length} leads</span>
              </div>
              {notIntLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaTimesCircle className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold">No rejected leads</p></div>
                : <div className="bg-[#111111] border border-[#222] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">

                    {/* ── TOP SENTINEL ── */}
                    <div ref={loadLessRef} style={{ height: "1px", width: "100%" }} />

                    <table className="w-full text-left text-sm text-gray-400">
                      <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                        <tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Follow-ups", "Saved On", "Actions"].map(h => (
                          <th key={h} className={`px-5 py-3 border-b border-[#222] whitespace-nowrap ${h === "Actions" ? "text-center" : ""}`}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a]">
                        {notIntLeads.slice(0, visibleCount).map((lead: any) => (
                          <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors group">
                            <td className="px-5 py-3 font-mono text-red-400 font-bold">#{lead.id}</td>
                            <td className="px-5 py-3 text-white font-semibold whitespace-nowrap">{lead.name}</td>
                            <td className="px-5 py-3 font-mono text-sm">{mPhone(lead.contact_no || lead.phone)}</td>
                            <td className="px-5 py-3 text-gray-300">{lead.source || "—"}</td>
                            <td className="px-5 py-3 text-gray-300 whitespace-nowrap">{lead.channel_partner || lead.channelPartner || "—"}</td>
                            <td className="px-5 py-3 text-gray-300 whitespace-nowrap">{lead.assign_manager || lead.assignManager || "—"}</td>
                            <td className="px-5 py-3 max-w-[150px] truncate text-yellow-300 text-xs">{lead.feedback || "—"}</td>
                            <td className="px-5 py-3"><span className="text-[10px] bg-[#222] border border-[#333] px-2 py-0.5 rounded-full font-bold">{(lead.followUps || []).length} notes</span></td>
                            <td className="px-5 py-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(lead.savedAt).split(",")[0]}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2 justify-center">
                                <button onClick={() => setDetailLead(lead)} className="text-gray-500 hover:text-[#d946a8] cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#9E217B]/10 border border-transparent hover:border-[#9E217B]/20">
                                  <FaEye className="text-[10px]" /> View
                                </button>
                                <button onClick={() => revertLead(lead.id)} className="text-gray-500 hover:text-green-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-500/10 border border-transparent hover:border-green-500/20">
                                  <FaAngleLeft className="text-[10px]" /> Revert
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* ── BOTTOM SENTINEL ── */}
                    {visibleCount < notIntLeads.length && (
                      <div ref={loadMoreRef} className="flex items-center justify-center gap-3 py-6 text-gray-500">
                        <div className="w-4 h-4 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
                        <span className="text-xs font-medium">Loading more… ({visibleCount} of {notIntLeads.length})</span>
                      </div>
                    )}
                    {visibleCount >= notIntLeads.length && notIntLeads.length > 20 && (
                      <div className="text-center py-4 text-xs font-medium text-gray-600">
                        ✓ All {notIntLeads.length} leads loaded
                      </div>
                    )}

                  </div>
                </div>
              }
            </div>
          )}

          {/* FORMS */}
          {section === "forms" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaClipboardList className="text-orange-400" /> Saved Forms</h2>
                <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{formLeads.length} leads</span>
              </div>
              {formLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaSave className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold mb-1">No saved leads yet</p></div>
                : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {formLeads.map((lead: any) => (
                    <div key={lead.id} onClick={() => setDetailLead(lead)}
                      className="bg-[#1a1a1a] border border-[#2a2a2a] hover:border-orange-500/50 rounded-2xl p-5 cursor-pointer transition-all group">
                      <div className="flex justify-between items-start mb-4 pb-3 border-b border-[#2a2a2a]">
                        <div>
                          <p className="text-[10px] text-orange-400 font-bold mb-1">#{lead.id}</p>
                          <h3 className="text-white font-bold group-hover:text-orange-300 transition-colors">{lead.name}</h3>
                        </div>
                        {lead.interestStatus ? iBadge(lead.interestStatus) : <span className="text-[10px] font-bold text-gray-500 bg-[#222] border border-[#333] px-2 py-0.5 rounded-full">Pending</span>}
                      </div>
                      <div className="space-y-2 text-sm">
                        <p className="text-gray-400 flex items-center gap-2 text-xs"><FaPhoneAlt className="text-[10px]" />{mPhone(lead.contact_no || lead.phone)}</p>
                        {(lead.channel_partner || lead.channelPartner) && <p className="text-gray-400 text-xs flex items-center gap-2"><FaUserTie className="text-[10px]" />{lead.channel_partner || lead.channelPartner}</p>}
                        {lead.feedback && <p className="text-yellow-400 text-xs truncate">{lead.feedback}</p>}
                        {lead.siteVisitDate && <p className="text-orange-400 text-xs flex items-center gap-1"><FaCalendarAlt className="text-[9px]" />{fmtDate(lead.siteVisitDate).split(",")[0]}</p>}
                        {(lead.followUps || []).length > 0 && <p className="text-[#d946a8] text-xs">{lead.followUps.length} follow-up{lead.followUps.length > 1 ? "s" : ""}</p>}
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#2a2a2a] flex justify-between items-center">
                        <span className="text-[10px] text-gray-600">{fmtDate(lead.savedAt).split(",")[0]}</span>
                        <span className="text-[10px] font-bold text-gray-500 group-hover:text-orange-400 transition-colors">Open →</span>
                      </div>
                    </div>
                  ))}
                </div>
              }
            </div>
          )}

          {/* INTERESTED */}
          {section === "interested" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaHeart className="text-green-400" /> Interested Leads</h2>
                <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{interestedLeads.length} leads</span>
              </div>
              {interestedLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaHeart className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold">No interested leads yet</p></div>
                : <div className="bg-[#111111] border border-[#222] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                      <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                        <tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Follow-ups", "Site Visit", "Saved On", "Actions"].map(h => (
                          <th key={h} className={`px-4 py-3 border-b border-[#222] whitespace-nowrap ${h === "Actions" ? "text-center" : ""}`}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a]">
                        {interestedLeads.map((lead: any) => (
                          <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors group align-middle">
                            <td className="px-4 py-3 font-mono text-green-400 font-bold">#{lead.id}</td>
                            <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{lead.name}</td>
                            <td className="px-4 py-3 font-mono text-sm">{mPhone(lead.contact_no || lead.phone)}</td>
                            <td className="px-4 py-3 text-gray-300">{lead.source || "—"}</td>
                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.channel_partner || lead.channelPartner || "—"}</td>
                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.assign_manager || lead.assignManager || "—"}</td>
                            <td className="px-4 py-3 max-w-[150px]">
                              {lead.feedback ? <span className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[130px]" title={lead.feedback}>{lead.feedback}</span> : <span className="text-gray-600 italic text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3"><span className="text-[10px] bg-[#222] border border-[#333] px-2 py-0.5 rounded-full font-bold">{(lead.followUps || []).length} notes</span></td>
                            <td className="px-4 py-3 text-[11px]">{lead.siteVisitDate ? <span className="text-orange-400">{fmtDate(lead.siteVisitDate).split(",")[0]}</span> : <span className="text-gray-600">—</span>}</td>
                            <td className="px-4 py-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(lead.savedAt).split(",")[0]}</td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => setDetailLead(lead)} className="text-gray-500 hover:text-green-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-500/10 border border-transparent hover:border-green-500/20 mx-auto">
                                <FaEye className="text-[10px]" /> View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </div>
          )}

          {/* NOT INTERESTED */}
          {section === "not_interested" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaTimesCircle className="text-red-400" /> Not Interested</h2>
                <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{notIntLeads.length} leads</span>
              </div>
              {notIntLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaTimesCircle className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold">No rejected leads</p></div>
                : <div className="bg-[#111111] border border-[#222] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                      <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                        <tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Follow-ups", "Saved On", "Actions"].map(h => (
                          <th key={h} className={`px-5 py-3 border-b border-[#222] whitespace-nowrap ${h === "Actions" ? "text-center" : ""}`}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a]">
                        {notIntLeads.map((lead: any) => (
                          <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors group">
                            <td className="px-5 py-3 font-mono text-red-400 font-bold">#{lead.id}</td>
                            <td className="px-5 py-3 text-white font-semibold whitespace-nowrap">{lead.name}</td>
                            <td className="px-5 py-3 font-mono text-sm">{mPhone(lead.contact_no || lead.phone)}</td>
                            <td className="px-5 py-3 text-gray-300">{lead.source || "—"}</td>
                            <td className="px-5 py-3 text-gray-300 whitespace-nowrap">{lead.channel_partner || lead.channelPartner || "—"}</td>
                            <td className="px-5 py-3 text-gray-300 whitespace-nowrap">{lead.assign_manager || lead.assignManager || "—"}</td>
                            <td className="px-5 py-3 max-w-[150px] truncate text-yellow-300 text-xs">{lead.feedback || "—"}</td>
                            <td className="px-5 py-3"><span className="text-[10px] bg-[#222] border border-[#333] px-2 py-0.5 rounded-full font-bold">{(lead.followUps || []).length} notes</span></td>
                            <td className="px-5 py-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(lead.savedAt).split(",")[0]}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2 justify-center">
                                <button onClick={() => setDetailLead(lead)} className="text-gray-500 hover:text-[#d946a8] cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#9E217B]/10 border border-transparent hover:border-[#9E217B]/20">
                                  <FaEye className="text-[10px]" /> View
                                </button>
                                <button onClick={() => revertLead(lead.id)} className="text-gray-500 hover:text-green-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-500/10 border border-transparent hover:border-green-500/20">
                                  <FaAngleLeft className="text-[10px]" /> Revert
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </div>
          )}

          {/* DETAIL VIEW */}
          {detailLead && (() => {
            const sl = savedLeads.find(l => l.id === detailLead.id) || detailLead;
            return (
              <div className="animate-fadeIn flex flex-col h-full">
                <div className="flex items-center justify-between mb-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-4 flex-shrink-0 flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    <button onClick={() => setDetailLead(null)} className="w-10 h-10 flex items-center justify-center bg-[#222] hover:bg-[#333] border border-[#444] rounded-lg text-gray-400 cursor-pointer transition-colors">
                      <FaAngleLeft />
                    </button>
                    <div><h1 className="text-lg font-bold text-white">{sl.name}</h1><p className="text-xs text-gray-500">{sl.source || ""}</p></div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {sl.interestStatus && iBadge(sl.interestStatus)}
                    {sl.interestStatus !== "Interested" && <button onClick={() => setInterest(sl, "Interested")} className="flex items-center gap-2 bg-green-600/10 hover:bg-green-600 border border-green-500/30 text-green-400 hover:text-white font-bold px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors"><FaCheckCircle /> Interested</button>}
                    {sl.interestStatus !== "Not Interested" && <button onClick={() => setInterest(sl, "Not Interested")} className="flex items-center gap-2 bg-red-600/10 hover:bg-red-600 border border-red-500/30 text-red-400 hover:text-white font-bold px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors"><FaTimes /> Not Interested</button>}
                    {sl.interestStatus !== "Non Genuine Demand" && <button onClick={() => setInterest(sl, "Non Genuine Demand")} className="flex items-center gap-2 bg-yellow-600/10 hover:bg-yellow-600 border border-yellow-500/30 text-yellow-400 hover:text-white font-bold px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors">Non Genuine Demand</button>}
                  </div>
                </div>
                <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
                  <div className="w-full lg:w-[42%] bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5 overflow-y-auto custom-scrollbar">
                    <h3 className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-4 border-b border-[#2a2a2a] pb-2">Lead Information</h3>
                    <div className="space-y-3 text-sm">
                      {[
                        { label: "Phone", value: sl.contact_no || sl.phone },
                        { label: "Email", value: sl.email },
                        { label: "Source", value: sl.source },
                        { label: "Channel Partner", value: sl.channel_partner || sl.channelPartner },
                        { label: "Assign Manager", value: sl.assign_manager || sl.assignManager },
                        { label: "Budget", value: sl.budget },
                        { label: "Location", value: sl.location },
                        { label: "Status", value: sl.status },
                      ].map(({ label, value }) => value ? (
                        <div key={label} className="flex justify-between items-start">
                          <p className="text-gray-500 text-xs">{label}</p>
                          <p className="text-white font-medium text-right max-w-[60%] break-words">{value}</p>
                        </div>
                      ) : null)}
                      {sl.siteVisitDate && (
                        <div className="mt-3 bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 text-center">
                          <p className="text-xs text-orange-400 font-bold mb-1">Site Visit</p>
                          <p className="text-white font-bold">{fmtDate(sl.siteVisitDate)}</p>
                        </div>
                      )}
                    </div>
                    {sl.feedback && (
                      <div className="mt-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
                        <p className="text-[10px] text-yellow-400 font-bold uppercase mb-1">Feedback</p>
                        <p className="text-sm text-gray-300">{sl.feedback}</p>
                      </div>
                    )}
                  </div>
                  <div className="w-full lg:w-[58%] flex flex-col bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl overflow-hidden" style={{ minHeight: "400px" }}>
                    <div className="p-4 border-b border-[#2a2a2a] bg-[#151515] flex-shrink-0">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2"><FaCommentAlt className="text-orange-400" /> Follow-up Timeline</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-4 bg-[#111]">
                      <div className="flex justify-start">
                        <div className="bg-[#1a1a1a] border border-[#222] rounded-2xl rounded-tl-none p-4 max-w-[85%]">
                          <span className="font-bold text-xs text-orange-400">System</span>
                          <p className="text-sm text-gray-300 mt-1">Lead loaded into Admin Control Mode.</p>
                        </div>
                      </div>
                      {(sl.followUps || []).length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-700 py-6">
                          <FaCommentAlt className="text-3xl mb-3 opacity-20" />
                          <p className="text-sm">No follow-ups yet.</p>
                        </div>
                      )}
                      {(sl.followUps || []).map((fup: any, idx: number) => (
                        <div key={idx} className="flex justify-start">
                          <div className="bg-[#2a1818] border border-orange-900/50 rounded-2xl rounded-tl-none p-4 max-w-[85%]">
                            <div className="flex justify-between items-center mb-2 gap-4">
                              <span className="font-bold text-xs text-orange-300">{fup.createdBy}</span>
                              <span className="text-[10px] text-gray-400">{fmtDate(fup.createdAt)}</span>
                            </div>
                            <p className="text-sm text-gray-200 whitespace-pre-wrap">{fup.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <form onSubmit={sendNote} className="p-4 bg-[#1a1a1a] border-t border-[#2a2a2a] flex gap-3 items-center flex-shrink-0">
                      <input type="text" value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Add follow-up note..."
                        className="flex-1 bg-[#111] border border-[#333] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-orange-500 transition-colors" />
                      <button type="submit" className="w-12 h-12 bg-orange-600 hover:bg-orange-500 text-white rounded-xl flex items-center justify-center cursor-pointer shadow-lg transition-colors">
                        <FaPaperPlane className="text-sm" />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })()}
        </main>
      </div>
    </div>
  );
}
