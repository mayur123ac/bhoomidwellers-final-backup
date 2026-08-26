//receptionist frontend
"use client";
import {
  StatusChip,
  ContactCell,
  SearchBar,
  ToolbarButton,
  ToggleSwitch,
  SortIcon,
  SkeletonRows,
  EmptyState,
} from "@/components/Tableui"; // adjust path to match where Tableui.tsx actually lives
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaThLarge, FaCog, FaBell, FaTimes, FaClipboardList,
  FaChevronLeft, FaRobot, FaPaperPlane, FaCalendarAlt, FaEye, FaEyeSlash,
  FaPhoneAlt, FaUserCircle, FaBriefcase, FaSearch, FaDownload,
  FaFileInvoice, FaHandshake, FaUniversity, FaUsers, FaFileAlt,
  FaClock, FaMicrophone, FaWhatsapp, FaCheckCircle,
  FaExchangeAlt, FaUserTie, FaChartPie, FaInfoCircle, FaSyncAlt
} from "react-icons/fa";
import { Ghost, AlertTriangle } from "lucide-react";
import LoginTimerWidget from "@/components/LoginTimerWidget";
import AttendanceBadge from "@/components/AttendanceBadge";
import { useAttendance } from "@/components/AttendanceContext";
import CrmUpdatesNotification from "@/components/CrmUpdatesNotification";
import WhatsAppConversationPanel from "@/components/whatsapp/WhatsAppConversationPanel";
import LostLeadModal from "@/components/LostLeadModal";
import { updateLeadLostState, useLostLeadEvents } from "@/lib/lostLeadSync";
// The notification queue. Built and organization-scoped on the server — see
// lib/notifications/feed.ts for why it is no longer derived in this file.
import { useNotificationFeed, openNotificationLead, type CrmNotification } from "@/lib/hooks/useNotificationFeed";
import NotificationPopover from "@/components/notifications/NotificationPopover";
// buildTheme used to be defined in this file; it moved out unchanged so the
// Sourcing Manager panel shares it instead of forking.
// WhatsAppSettingsCard went with the in-page Settings tab — the WhatsApp number
// is now edited in Settings › WhatsApp Integration. The component itself is
// untouched and still used by the panels that render it inline.
import { buildTheme } from "@/lib/crmTheme";
import ChannelPartnerFormModal from "@/components/ChannelPartnerFormModal";
import ChannelPartnerEnquiriesTable from "@/components/ChannelPartnerEnquiriesTable";
import SearchableSelect from "@/components/SearchableSelect";
import BookingFormModal from "@/components/BookingFormModal";
import BookingApplicationView from "@/components/BookingApplicationView";
import InlineContactField from "@/components/InlineContactField";
import { contactFieldSave } from "@/lib/contactFieldSave";
import ClosedLeadBookingView from "@/components/ClosedLeadBookingView";
import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import AttendanceView from "@/components/AttendanceView";
import LoanDealForm from "@/components/LoanDealForm";
import LoanDealView from "@/components/LoanDealView";
import BolnaCallWidget from "@/components/BolnaCallWidget";
import CallingButtons from "@/components/CallingButtons";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import UserAvatar from "@/components/UserAvatar";
import AppHeader, { HeaderControl } from "@/components/AppHeader";
import ReceptionistSidebar, { RECEPTIONIST_NAV } from "@/components/receptionist/ReceptionistSidebar";
import BhoomiAiPanel from "@/components/bhoomi-ai/BhoomiAiPanel";
import dynamic from "next/dynamic";

// Loaded on demand, matching /dashboard and /dashboard/sales. It pulls in
// framer-motion and a month/week/day calendar that most front-desk sessions
// never open, so it has no business in the initial bundle.
const SiteVisitOverview = dynamic(() => import("../SiteVisitOverview"), { ssr: false });

// PERF: recharts (~8 MB in node_modules) used to be a static import at the top of
// this file, so it sat in the front-desk route's initial JavaScript and was parsed
// before first paint even for staff who never scroll to a chart. ssr: false
// because ResponsiveContainer measures the DOM, which the server cannot do.
const ReceptionistDonutChart = dynamic(() => import("@/components/receptionist/ReceptionistDonutChart"), { ssr: false });

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
function DraggableTableContainer({ children, className, isDark }: { children: React.ReactNode, className?: string, isDark: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [showLeftShadow, setShowLeftShadow] = useState(false);
  const [showRightShadow, setShowRightShadow] = useState(true);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftShadow(scrollLeft > 0);
    setShowRightShadow(scrollLeft < scrollWidth - clientWidth - 1);
  };

  useEffect(() => {
    handleScroll();
    window.addEventListener("resize", handleScroll);
    return () => window.removeEventListener("resize", handleScroll);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };
  const onMouseLeave = () => setIsDragging(false);
  const onMouseUp = () => setIsDragging(false);
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const shadowColor = isDark ? "from-[#121218]" : "from-white";

  return (
    <div className={`relative ${className || ""}`}>
      {/* 268px = the two frozen columns (96 + 172). Keep this in step with the
          `left-[96px]` offset and the minWidth/maxWidth pairs on those cells, or
          the scroll shadow detaches from the freeze edge. */}
      {showLeftShadow && <div className={`absolute top-0 bottom-0 left-[268px] w-8 bg-gradient-to-r ${shadowColor} to-transparent pointer-events-none z-[15] opacity-100`} />}
      {showRightShadow && <div className={`absolute top-0 bottom-0 right-0 w-8 bg-gradient-to-l ${shadowColor} to-transparent pointer-events-none z-[15] opacity-100`} />}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        className={`overflow-auto custom-scrollbar draggable-table-scroll ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"} pb-2`}
        style={{ maxHeight: "calc(200vh - 250px)" }}
      >
        <style>{`
          .draggable-table-scroll::-webkit-scrollbar {
            height: 10px !important;
          }
          .draggable-table-scroll::-webkit-scrollbar-thumb {
            border-radius: 10px;
          }
        `}</style>
        {children}
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;
const CARDS_PER_PAGE = 20;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// NAV_ITEMS moved to components/receptionist/ReceptionistSidebar.tsx as
// RECEPTIONIST_NAV. It has to live somewhere Settings can import it too, or the
// rail says one thing here and another there — which is how the Receptionist
// ended up with the admin rail inside Settings in the first place.
//
// Views this page can be asked to open by name, filtered so a stale or
// hand-edited `return_tab` cannot set activeTab to something that renders
// nothing. "settings" is excluded because it is a route, not a tab.
const RECEPTIONIST_TAB_IDS = new Set(
  RECEPTIONIST_NAV.filter((i) => i.id !== "settings").map((i) => i.id)
);

// What the header shows for each tab, taken from the rail's own labels rather
// than retyped, so the bar and the sidebar cannot disagree about what the
// current page is called. This is the same `context` slot Settings fills with
// "Settings · Profile". "detail" is a lead's page, which belongs to Dashboard.
const RECEPTIONIST_CONTEXT: Record<string, string> = {
  ...Object.fromEntries(RECEPTIONIST_NAV.map((i) => [i.id, i.label])),
  detail: "Dashboard",
};

const LEAD_SOURCES = [
  "Advertisement", "Referral", "Exhibition", "Channel Partner", "Website", "Call Center", "Others"
];

// Full standardised Indian real-estate configuration list.
// Order here determines order in both the combobox and all charts.
const CONFIG_OPTIONS = [
  // ── Residential Apartments ──────────────────────────────────────────────
  "Studio",
  "1 RK",
  "1 BHK",
  "1.5 BHK",
  "2 BHK",
  "2.5 BHK",
  "3 BHK",
  "3.5 BHK",
  "4 BHK",
  "4.5 BHK",
  "5 BHK",
  "5+ BHK",
  "Duplex",
  "Penthouse",
  "Loft",
  // ── Independent Residential ──────────────────────────────────────────────
  "Villa",
  "Bungalow",
  "Row House",
  "Townhouse",
  "Independent House",
  "Farm House",
  // ── Land ─────────────────────────────────────────────────────────────────
  "Residential Plot",
  "NA Plot",
  "Agricultural Land",
  // ── Commercial ───────────────────────────────────────────────────────────
  "Office",
  "Retail Shop",
  "Showroom",
  "Commercial Space",
  "Warehouse",
  "Industrial Unit",
  "Co-working Space",
  // ── Fallback ─────────────────────────────────────────────────────────────
  "Other",
] as const;

// Alias kept for chart bucketing (same array, just as mutable string[]).
const CONFIG_KEYS: string[] = [...CONFIG_OPTIONS];

// ─────────────────────────────────────────────────────────────────────────────
// SVG ICONS
// ─────────────────────────────────────────────────────────────────────────────
// 12px, matching the 32px HeaderControl size="sm" this panel's header uses.
// These two consts are local to the Receptionist page — Settings and Sales each
// declare their own pair at 14px, so changing the size here reaches nothing else.
//
// They must stay equal to each other: the sun was 16 and the moon 14, so the
// icon grew by 2px when you switched to dark mode and shrank on the way back,
// in the same button.
const SunIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);
const MoonIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

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


// ─────────────────────────────────────────────────────────────────────────────
// CONFIG COMBOBOX  — searchable, keyboard-navigable, no free text
// ─────────────────────────────────────────────────────────────────────────────
function ConfigCombobox({
  value,
  onChange,
  isDark,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  t: ReturnType<typeof buildTheme>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = query.trim()
    ? CONFIG_OPTIONS.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : [...CONFIG_OPTIONS];

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setOpen(true); setHighlighted(0); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) { select(filtered[highlighted]); }
    }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  function select(option: string) {
    onChange(option);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }

  const displayValue = open ? query : (value || "");
  const inputPlaceholder = open ? "Type to search…" : (value ? value : "Select configuration…");

  return (
    <div ref={containerRef} className="relative w-full">
      {/* ── Trigger / search input ── */}
      <div
        className={`w-full flex items-center gap-2 rounded-lg border text-sm transition-colors cursor-pointer ${open
          ? isDark ? "border-[#9E217B] bg-[#14141B]" : "border-[#00AEEF] bg-white"
          : `${t.modalInput}`
          }`}
        onClick={() => { setOpen(o => !o); setHighlighted(0); }}
      >
        <input
          type="text"
          value={displayValue}
          placeholder={inputPlaceholder}
          onChange={e => { setQuery(e.target.value); setHighlighted(0); if (!open) setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { setOpen(true); setHighlighted(0); }}
          autoComplete="off"
          className={`flex-1 p-3 outline-none bg-transparent ${t.text} placeholder:text-gray-400`}
          aria-label="Room Configuration"
        />
        <span className={`pr-3 text-xs select-none ${t.textFaint}`}>{open ? "▲" : "▼"}</span>
      </div>

      {/* ── Dropdown list ── */}
      {open && (
        <ul
          ref={listRef}
          className={`absolute z-[200] mt-1 w-full max-h-52 overflow-y-auto custom-scrollbar rounded-lg border shadow-xl text-sm ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#D1D5DB]"
            }`}
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className={`px-4 py-3 ${t.textFaint}`}>No match — select from list only</li>
          ) : (
            filtered.map((option, i) => (
              <li
                key={option}
                role="option"
                aria-selected={value === option}
                onMouseDown={e => { e.preventDefault(); select(option); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`px-4 py-2.5 cursor-pointer transition-colors ${i === highlighted
                  ? isDark ? "bg-[#9E217B]/20 text-white" : "bg-[#00AEEF]/10 text-[#00AEEF]"
                  : value === option
                    ? isDark ? "text-[#d4006e] font-semibold" : "text-[#9E217B] font-semibold"
                    : `${t.text}`
                  }`}
              >
                {option}
                {value === option && <span className="ml-2 text-xs opacity-60">✓</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * One page header for every Receptionist tab.
 *
 * The five tabs previously each hand-rolled their own: `text-xl md:text-3xl`
 * here, a bare `text-xl` there, `mb-8` on three of them and `mb-4` on the
 * assistant, subtitles present on two and missing on the rest. Switching tabs
 * moved the title and shifted the content below it, which is exactly the
 * "where am I?" ambiguity rule 4 is about.
 *
 * The Apple hierarchy is title → subtitle → actions, with the actions right
 * aligned and never competing with the title for weight. Colours come from the
 * caller's theme tokens; this component chooses no colours of its own.
 */
function RpPageHeader({
  title, subtitle, titleClass, subtitleClass, badge, leading, children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  titleClass: string;
  subtitleClass: string;
  badge?: React.ReactNode;
  leading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rp-page-header px-5 pt-5">
      <div className="flex items-center gap-3 min-w-0">
        {leading}
        <div className="rp-page-header-titles">
          <h1 className={`rp-title-lg flex items-center flex-wrap gap-2.5 ${titleClass}`}>
            {title}
            {badge}
          </h1>
          {subtitle && <p className={`rp-secondary ${subtitleClass}`}>{subtitle}</p>}
        </div>
      </div>
      {children && <div className="rp-page-header-actions">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
export default function ReceptionistDashboard() {
  const router = useRouter();
  const { isMarkedPresent, timeIn } = useAttendance();
  useActivityTracker();
  // The shared theme, from lib/theme.ts. This used to be a local useState that
  // reset to light on every navigation and was never stored anywhere; it now
  // reads the same value Preferences → Theme writes.
  const { isDark, toggleTheme } = useCrmTheme();
  const t = buildTheme(isDark);

  /* ── Table design tokens ────────────────────────────────────────────────────
     Mirrors EnquiryOverviewSection.tsx so the Front Desk Log, Receptionist Leads
     and Closed Leads tables read as the same product. Presentation only — every
     one of these is a className string; no data, handler or gate goes near them.

     Held as constants rather than repeated inline because the three tables drifted
     apart previously (p-4 here, py-3 there), and a single source is what stops
     that recurring. */
  const tblHeadCls = `sticky top-0 z-[25] ${t.tableHead} ${t.textHeader}`;
  /* Intentionally empty — see below.
     This used to carry backdropFilter: blur(12px). t.tableHead is
     bg-[#1A1A28] / bg-[#F1F5F9], fully opaque with no alpha, so the blur was
     never visible: the compositor snapshotted and blurred the region behind the
     sticky header on every scroll frame, then painted a solid box over the
     result. Removing it cost nothing visually and is what stopped the frame
     drops while scrolling these three tables.
     Kept as a constant rather than deleted so the three call sites do not need
     touching, and so this reasoning stays attached to the decision. */
  const tblHeadStyle: React.CSSProperties = {};
  /** Column header. `text-[10px]` sits on the th so it beats the `text-xs`
   *  inherited from t.textHeader on the thead — same trick EnquiryOverview uses. */
  const thCls = `px-4 py-3 whitespace-nowrap border-b text-[10px] font-bold uppercase tracking-[0.09em] ${isDark ? "border-white/[0.08]" : "border-gray-300"
    }`;
  /** Body cell. py-3.5 is the reference row height; the old `md:p-4` made these
   *  rows 4px taller than the admin table at desktop width.
   *
   *  px went 12 → 16 (the spacing scale's --rp-4). At 12px the column gutter was
   *  narrower than the word spacing inside a cell, so "CP Company" and "CP Phone"
   *  read as one run of text. The first and last cells get 20px instead, from
   *  the `.recep-panel table td:first-child/:last-child` rules in globals.css,
   *  so content is not flush against the card edge. Row height is unchanged —
   *  this widens gutters without costing a single visible row. */
  const tdCls = `px-4 py-3.5 align-middle ${isDark ? "border-white/[0.045]" : "border-indigo-300"}`;
  const tblDivide = isDark ? "divide-white/[0.045]" : "divide-indigo-300";

  /**
   * Zebra striping, as opaque colours rather than the reference's translucent
   * `bg-white/[0.015]`.
   *
   * These tables pin "Lead No." and "Client Name" with `position: sticky` +
   * `bg-inherit`. A translucent row background would be inherited as-is, so
   * horizontally scrolled cells would bleed through the frozen columns. Opaque
   * values render identically and keep the freeze solid.
   */
  const zebraBg = (i: number) =>
    isDark
      ? i % 2 === 1 ? "bg-[#16161F]" : "bg-[#121218]"
      : i % 2 === 1 ? "bg-[#F6F7FA]" : "bg-white";
  /** t.tableRow is already an opaque hover, so the frozen columns stay solid. */
  const rowCls = `group transition-colors duration-200 ${t.tableRow}`;

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
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Restore the tab a rail click asked for before it navigated here — the same
  // `return_tab` convention the Admin and Sales dashboards use, written by
  // SettingsShell's railSelect. Without it, choosing "Closed Leads" from the
  // rail inside Settings would land on this page's default Dashboard tab.
  useEffect(() => {
    try {
      const returnTab = localStorage.getItem("return_tab");
      if (returnTab) {
        localStorage.removeItem("return_tab");
        if (RECEPTIONIST_TAB_IDS.has(returnTab)) setActiveTab(returnTab);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ── Attendance: live clock tick (1-second interval for AttendanceView live timer) ──
  //
  // PERF: same fix as the sales dashboard. This ticked once a second regardless of
  // what was on screen, re-rendering the whole front-desk page 60 times a minute.
  // `now` has exactly one consumer, <AttendanceView>, which only renders on the
  // attendance tab — so gating the interval on that tab is behaviour-identical.
  const [now, setNow] = useState(Date.now());
  const clockRunning = activeTab === "attendance";
  useEffect(() => {
    if (!clockRunning) return;
    setNow(Date.now());   // resync immediately on open, don't show a stale second
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [clockRunning]);
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [bookingData, setBookingData] = useState<any>(null);
  const [bookingDetailTab, setBookingDetailTab] = useState<"personal" | "loan" | "booking">("personal");
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
  // notificationHistory is no longer local state — it is derived from the
  // server-built, organization-scoped feed further down.

  // The shared notification popover takes its classes as props, so each
  // dashboard keeps its own theme token names.
  const notifPopoverTheme = useMemo(
    () => ({
      text: t.text,
      textMuted: t.textMuted,
      textFaint: t.textFaint,
      border: t.tableBorder,
      itemHover: isDark ? "hover:bg-white/5" : "hover:bg-black/5",
      footer: isDark
        ? "text-[#d946a8] hover:bg-[#9E217B]/10"
        : "text-[#9E217B] hover:bg-[#9E217B]/10",
    }),
    [t, isDark]
  );

  // ── Enquiry (new-entry) modal ──
  const [isEnquiryModalOpen, setIsEnquiryModalOpen] = useState(false);
  // Channel Partner office-visit registration. Create-only for this role: the
  // Receptionist records the partner's profile but never edits or lists them.
  const [isCpVisitModalOpen, setIsCpVisitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const getTodayString = () => new Date().toISOString().split("T")[0];
  const [enquiryForm, setEnquiryForm] = useState({
    fullName: "", mobile: "", altMobile: "", email: "", address: "", pinCode: "", city: "",
    occupation: "", organization: "", budget: "", configuration: "",
    purpose: "", source: "", assignedTo: "", loanPlanned: "", sourceOther: "", referralName: "",
    cpDetails: { name: "", company: "", phone: "" },
    sourcingManagerId: "",   // users.id of the assigned Sourcing Manager (CP enquiries only)
    preferredLocation: "",
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
  // Sourcing Managers available for CP assignment. Fetched, never hardcoded.
  const [sourcingManagers, setSourcingManagers] = useState<any[]>([]);
  const [isFetchingSourcingManagers, setIsFetchingSourcingManagers] = useState(true);
  const [sourcingManagersError, setSourcingManagersError] = useState<string | null>(null);
  const sourcingManagerOptions = useMemo(
    () => sourcingManagers.map((m: any) => ({
      value: String(m.id),
      label: m.name,
      sublabel: `ID ${m.id}${m.username ? ` · ${m.username}` : ""} · ${m.phone || m.whatsapp_number || "no phone on file"}`,
      keywords: `${m.username || ""} ${m.phone || ""} ${m.email || ""}`,
    })),
    [sourcingManagers]
  );
  // Inline validation for the required CP phone (shown under the field, not an alert).
  const [cpPhoneError, setCpPhoneError] = useState("");

  // ── Registered-partner cross-check ──
  // The CP phone number is the partner's identity. As soon as a full one is typed
  // we ask whether it already belongs to a registered partner and, if so, who owns
  // them — because that owner gets the lead regardless of what this form selects
  // (enforced server-side in POST /api/walkin_enquiries). Showing the answer before
  // submit means the receptionist sees where the lead is going, instead of picking a
  // manager whose choice is then silently discarded.
  const [cpLookup, setCpLookup] = useState<any>(null);
  const [cpLookupLoading, setCpLookupLoading] = useState(false);
  /** The phone matched a registered partner whose owner will take this lead. */
  const cpRoutedByPartner = !!(cpLookup?.found && cpLookup?.routable);

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
  // Loan & Deal Tracking panel — independent of bookingData/fetchBookingForLead above,
  // which (when wired up) swaps the whole detail view to ClosedLeadBookingView.
  const [loanDealBooking, setLoanDealBooking] = useState<any>(null);
  const [loanDealLatest, setLoanDealLatest] = useState<any>(null);
  // One pass serves both consumers of the booking row — same consolidation as the
  // admin and sales panels. Two effects were fetching the SAME URL concurrently and
  // both reading `data[0]`, and the loan request needlessly waited on the booking one.
  const fetchLoanDealData = useCallback(async (leadId: string | number) => {
    const [bookingOutcome, loanOutcome] = await Promise.allSettled([
      fetch(`/api/booking-applications?lead_id=${leadId}`).then((r) => r.json()),
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
  const [assignedToError, setAssignedToError] = useState("");

  const [transferNote, setTransferNote] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  // ── Receptionist Leads tab ──
  const [searchRecepLeads, setSearchRecepLeads] = useState("");
  const recepLeadsSentinelRef = useRef<HTMLDivElement>(null);
  // directAssignedLeads: fetched directly from the DB via dedicated endpoints,
  // NOT filtered from the paginated enquiries list. This is the source of truth
  // for the "Receptionist Leads" tab and must match the Admin view exactly.
  const [directAssignedLeads, setDirectAssignedLeads] = useState<any[]>([]);
  const [isFetchingDirectLeads, setIsFetchingDirectLeads] = useState(false);

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

  // The assistant's chat state used to live here — input, a canned greeting and
  // a scroll sentinel. BhoomiAiPanel owns its own conversation, so none of it
  // belongs to this page any more.

  const tableSentinelRef = useRef<HTMLDivElement>(null);

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
  // Reformats a phone input to "+91 XXXXXXXXXX" while preserving cursor position,
  // so digits are inserted where the user is actually typing instead of jumping
  // to the front/back and duplicatin
  // Input only ever holds raw digits — the "+91" prefix is rendered separately,
  // so there's no reformatting-while-typing to fight the cursor over.
  const cleanMobileDigits = (raw: string) => raw.replace(/\D/g, "").slice(0, 10);
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

  // handleSendWhatsApp was removed with the wa.me workflow. It logged a row
  // saying a message had been composed and then handed off to another app, so
  // the CRM never learned whether the message was delivered or what came back.
  // Sending now goes through WhatsAppConversationPanel →
  // POST /api/whatsapp/conversations/:id/messages.

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
  /* The `currentTime` 1-second interval was removed with the in-page Settings
     tab: its only readers were that tab's clock card, so it was re-rendering
     this whole component every second to update nothing. The header's live
     clock is HeaderClock, which owns its own tick. */

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
          fetchSourcingManagers();
          initialLoad();
          fetchFollowUps();
          // Fetch all leads directly assigned to this receptionist (bypasses pagination)
          fetchMyAssignedLeads(p.name || "");
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

  // Booking and loan both arrive via fetchLoanDealData now. The separate
  // fetchBookingForLead effect that used to sit here requested
  // /api/booking-applications?lead_id= a SECOND time, concurrently, for the same row.
  useEffect(() => {
    if (selectedLead?.id) {
      fetchLoanDealData(selectedLead.id);
      setBookingDetailTab("personal");
    } else {
      setLoanDealBooking(null);
      setLoanDealLatest(null);
      setBookingData(null);
    }
  }, [selectedLead?.id, fetchLoanDealData]);

  // ─────────────────────────────────────────────────────────────────────────
  // DATA FETCHING
  // ─────────────────────────────────────────────────────────────────────────
  /* `search` is sent to the server rather than applied to the loaded rows.
     This queue is paginated 20 at a time, so the client-side filter below could
     only ever match leads that had already been scrolled into memory: searching
     for a lead by name or phone returned "nothing found" unless the receptionist
     had happened to load far enough down the list first. searchColumn=basic
     matches exactly the three fields this queue has always searched — name,
     phone and lead number — so the results are the same set, just drawn from the
     whole organization instead of the current page. */
  const fetchPage = async (currentOffset: number, append: boolean, search = "") => {
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(currentOffset) });
      if (search.trim()) { qs.set("q", search.trim()); qs.set("searchColumn", "basic"); }
      const res = await fetch(`/api/walkin_enquiries?${qs.toString()}`);
      if (!res.ok) return;
      const json = await res.json();
      const dataArray: any[] = Array.isArray(json) ? json : (json.data ?? []);
      const total: number = json.total ?? (append ? totalCount : dataArray.length);
      const formatted = dataArray.map((item: any) => ({
        ...item,
        assignedTo: item.assigned_to || "Unassigned",
        assignedReceptionist: item.assigned_receptionist || null,
        altPhone: item.alt_phone,
        pinCode: item.pin_code,
        city: item.city,
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
    await fetchPage(0, false, searchRecep);
    setIsFetchingEnquiries(false);
  };

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const next = offset + PAGE_SIZE;
    setOffset(next);
    // The search term goes with every page, so "load more" keeps paging through
    // the FILTERED set rather than reverting to the unfiltered list.
    await fetchPage(next, true, searchRecep);
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore, offset, searchRecep]);

  /* Re-query from the top when the search term settles. Debounced, because this
     runs on a keystroke and each pass is a round trip; 300 ms is below the point
     where typing feels laggy and well above a fast typist's inter-key gap, so a
     word costs one request rather than one per letter.

     The leading `didMountSearch` guard keeps this from firing a duplicate first
     page on mount, which initialLoad has already fetched. */
  const didMountSearch = useRef(false);
  useEffect(() => {
    if (!didMountSearch.current) { didMountSearch.current = true; return; }
    const id = setTimeout(() => {
      setOffset(0); setHasMore(true);
      fetchPage(0, false, searchRecep);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRecep]);

  const fetchSourcingManagers = async () => {
    setIsFetchingSourcingManagers(true);
    setSourcingManagersError(null);
    try {
      const res = await fetch("/api/users/sourcing-manager");
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setSourcingManagers(json.data);
      } else {
        // A failed or malformed response left `sourcingManagers` at [], which is
        // visually identical to "zero accounts exist" — the field's error copy
        // reads that fetch failure and a real empty list differently on purpose.
        setSourcingManagersError(json.message || `Request failed (${res.status}).`);
      }
    } catch (e: any) {
      console.error("fetchSourcingManagers error", e);
      setSourcingManagersError(e.message || "Network error.");
    } finally {
      setIsFetchingSourcingManagers(false);
    }
  };

  // Debounced so a 10-digit number typed at speed produces one request, not ten.
  // Only fires for CP enquiries and only on a complete number — a partial one can
  // never match the 10-digit key, and asking would flash a misleading
  // "new partner" state on every keystroke.
  useEffect(() => {
    const digits = (enquiryForm.cpDetails.phone || "").replace(/\D/g, "");
    if (enquiryForm.source !== "Channel Partner" || digits.length < 10) {
      setCpLookup(null);
      setCpLookupLoading(false);
      return;
    }
    let cancelled = false;
    setCpLookupLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/channel-partners/lookup?phone=${encodeURIComponent(digits)}`);
        const json = await res.json();
        if (cancelled) return;
        setCpLookup(res.ok && json.success ? json : null);
        // A registered partner's owner is the manager this lead will actually go
        // to, so the field is set to match rather than left showing a different
        // name than the outcome.
        if (res.ok && json.success && json.routable) {
          setEnquiryForm(prev => ({
            ...prev,
            sourcingManagerId: String(json.partner.assigned_sourcing_manager_id),
          }));
        }
      } catch {
        // A failed lookup is not blocking: the server re-checks on submit, so the
        // worst case is the receptionist picks manually and is corrected there.
        if (!cancelled) setCpLookup(null);
      } finally {
        if (!cancelled) setCpLookupLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enquiryForm.cpDetails.phone, enquiryForm.source]);

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

  // ── Fetch leads directly assigned to the logged-in receptionist ──
  // Uses BOTH ownership columns to mirror the Admin Receptionist View exactly:
  //   /api/receptionist/assigned  → WHERE assigned_to = name
  //   /api/receptionist/leads     → WHERE assigned_receptionist = name
  // The two result sets are merged by ID so a lead that appears in both
  // (e.g. transferred to the same person who originally created it) is not counted twice.
  const fetchMyAssignedLeads = useCallback(async (name: string) => {
    if (!name || name === "Loading...") return;
    setIsFetchingDirectLeads(true);
    try {
      const encodedName = encodeURIComponent(name);
      const [resAssigned, resSelf] = await Promise.all([
        fetch(`/api/receptionist/assigned?name=${encodedName}`),
        fetch(`/api/receptionist/leads?name=${encodedName}`),
      ]);
      const [jsonAssigned, jsonSelf] = await Promise.all([
        resAssigned.ok ? resAssigned.json() : { success: false, data: [] },
        resSelf.ok ? resSelf.json() : { success: false, data: [] },
      ]);
      const assignedRows: any[] = jsonAssigned.success ? (jsonAssigned.data ?? []) : [];
      const selfRows: any[] = jsonSelf.success ? (jsonSelf.data ?? []) : [];
      // Merge and deduplicate by lead ID
      const merged = [...new Map([...assignedRows, ...selfRows].map((l: any) => [l.id, l])).values()];
      // Normalise field names to match the shape used elsewhere in this dashboard
      const fmtDate = (ds: string) => {
        if (!ds) return "N/A";
        try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
        catch { return "Invalid"; }
      };
      const formatted = merged.map((item: any) => ({
        ...item,
        assignedTo: item.assigned_to || "Unassigned",
        assignedReceptionist: item.assigned_receptionist || null,
        altPhone: item.alt_phone,
        pinCode: item.pin_code,
        city: item.city,
        date: fmtDate(item.created_at),
        enquiryDate: item.enquiry_date || item.created_at,
        autoDateEnabled: item.auto_date_enabled ?? true,
        status: (item.status === "Routed" || item.status === "ROUTED" ? "Assigned" : item.status) || "Assigned",
      }));
      setDirectAssignedLeads(formatted);
    } catch (e) {
      console.error("fetchMyAssignedLeads error", e);
    } finally {
      setIsFetchingDirectLeads(false);
    }
  }, []);

  const refetchAll = async () => {
    await Promise.all([initialLoad(), fetchFollowUps(), fetchMyAssignedLeads(user.name)]);
  };

  // ── Lost / restored leads, live ─────────────────────────────────────────────
  // This panel loads its leads once at mount and never polls, so a lead marked
  // Lost anywhere else — by a Site Head, a Sales Manager or an Admin — stayed
  // Active on the front desk until someone reloaded the page. The Admin and
  // Sales dashboards have subscribed to this channel all along; this one had
  // simply been left out.
  //
  // Both lead lists are updated, because they come from different endpoints:
  // `enquiries` is the paginated table, `directAssignedLeads` is this
  // receptionist's own leads. Updating one and not the other would leave the
  // same lead showing two different statuses on two tabs of the same screen.
  //
  // The stream is tenant-scoped server-side (lib/lostLeadEvents.ts), so nothing
  // here has to check which organization an event belongs to.
  const applyLostLeadUpdate = useCallback((updatedLead: any) => {
    setEnquiries(prev => updateLeadLostState(prev, updatedLead));
    setDirectAssignedLeads(prev => updateLeadLostState(prev, updatedLead));
    setSelectedLead((prev: any) =>
      prev && String(prev.id) === String(updatedLead?.id) ? { ...prev, ...updatedLead } : prev
    );
  }, []);
  // Both callbacks must keep the SAME identity across renders: useLostLeadEvents
  // has them in its effect deps, so a fresh closure per render would tear down
  // and reopen the EventSource on every render. refetchAll is rebuilt each
  // render (it closes over user.name), so it is reached through a ref.
  const refetchAllRef = useRef(refetchAll);
  refetchAllRef.current = refetchAll;
  const resyncAfterLostLeadDrop = useCallback(() => { refetchAllRef.current(); }, []);
  useLostLeadEvents(applyLostLeadUpdate, resyncAfterLostLeadDrop);

  // ── The notification queue ─────────────────────────────────────────────────
  //
  // Built by the server, scoped to this session's organization in SQL. This
  // replaces a useEffect that re-derived the New Lead and Site Visit rules here
  // in the browser — the same two rules the Admin and Sales dashboards each kept
  // their own copy of. See lib/notifications/feed.ts.
  const notifications = useNotificationFeed();
  const notificationHistory = useMemo(
    () =>
      [...notifications.newLeads, ...notifications.siteVisits].sort(
        (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
      ),
    [notifications.newLeads, notifications.siteVisits]
  );

  /**
   * Open a notification's lead in this panel's Lead Detail view.
   *
   * The server is asked first: it re-reads the organization from the session and
   * re-applies it, so a lead id from a stale tab or another tenant resolves to
   * nothing and nothing opens. Only then is the lead selected from this page's
   * own organization-scoped list.
   */
  const openLeadFromNotification = useCallback(async (n: CrmNotification) => {
    setActivePopup(null);
    setActiveNotif(null);
    const ok = await openNotificationLead(n.leadId);
    if (!ok) {
      console.warn("[notifications] lead is not available for this organization:", n.leadId);
      return;
    }
    const lead =
      directAssignedLeads.find((l: any) => Number(l.id) === Number(n.leadId)) ??
      enquiries.find((l: any) => Number(l.id) === Number(n.leadId));
    if (!lead) return;
    setSelectedLead(lead);
    setAssignedSubView("detail");
    setDetailTab("personal");
    setShowSalesForm(false);
    setShowLoanForm(false);
    setActiveTab("assigned");
  }, [directAssignedLeads, enquiries]);

  // Toast queue. The "already shown" set is namespaced by organization: it used
  // to be one flat crm_shown_notif_ids key, so signing out of one builder and
  // into another on the same machine silently suppressed the second tenant's
  // genuinely-new leads, because lead ids are global and had already been used.
  useEffect(() => {
    if (!notifications.organizationId || notificationHistory.length === 0) return;
    const storageKey = "crm_shown_notif_ids:" + notifications.organizationId;
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
      });
      seenSet.add(n.id);
    }

    if (fresh.length > 0) {
      setNotifQueue(prev => [...prev, ...fresh]);
      setNotifCount(c => c + fresh.length);
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(seenSet))); } catch { }
    }
  }, [notificationHistory, notifications.organizationId]);


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

  // myAssignedLeads: sourced from directAssignedLeads (fetched directly from DB
  // via /api/receptionist/assigned + /api/receptionist/leads) rather than from
  // the paginated enquiries list. This fixes the bug where leads transferred to
  // this receptionist were invisible because they fell outside the loaded page.
  // Closing/closed leads are excluded here; closedLeads handles those separately.
  const myAssignedLeads = useMemo(() =>
    directAssignedLeads.filter((l: any) =>
      l.status !== "Closing" &&
      !l.closingDate
    )
    , [directAssignedLeads]);

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
  // Also sourced from directAssignedLeads so transferred leads are included.
  const closedLeads = useMemo(() =>
    directAssignedLeads.filter((l: any) =>
      l.status === "Closing" || !!l.closingDate
    )
    , [directAssignedLeads]);

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

    // CP phone is required for Channel Partner enquiries — it is the only key that
    // identifies a partner uniquely. The API enforces this too; this check exists so
    // the user sees the problem on the field instead of as a failed request.
    if (enquiryForm.source === "Channel Partner" && !enquiryForm.cpDetails.phone.trim()) {
      setCpPhoneError("CP phone number is required for Channel Partner enquiries.");
      setIsSubmitting(false);
      return;
    }
    setCpPhoneError("");

    if (!enquiryForm.selfAssign && !enquiryForm.assignedTo) {
      setAssignedToError("Please select a Sales Manager before submitting.");
      setIsSubmitting(false);
      return;
    }
    setAssignedToError("");



    const newEntry = {
      name: enquiryForm.fullName,
      phone: enquiryForm.mobile,
      alt_phone: enquiryForm.altMobile || null,
      email: enquiryForm.email || "N/A",
      address: enquiryForm.address || "N/A",
      // null, not "N/A" — these are the match keys for the future CP-by-area
      // lookup, where a placeholder string would read as a real area.
      pin_code: enquiryForm.pinCode || null,
      city: enquiryForm.city || null,
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
      preferred_location: enquiryForm.preferredLocation || null,
      // Only sent for CP enquiries — the server leaves assigned_at/by NULL when this
      // is null, so a non-CP lead never looks like it has a sourcing assignment.
      sourcing_manager_id: enquiryForm.source === "Channel Partner" && enquiryForm.sourcingManagerId
        ? Number(enquiryForm.sourcingManagerId)
        : null,
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
        const json = await res.json().catch(() => ({}));
        // When the partner's registered owner overrode the form's pick, say where
        // the lead went — otherwise the operator has no way to know it moved.
        showToast(
          json?.routedByPartner && json?.routedTo
            ? `Lead routed to ${json.routedTo} — the registered partner's Sourcing Manager.`
            : isReceptionist ? `Lead self-assigned to you!` : `Lead assigned to ${assignTo}!`
        );
        setIsEnquiryModalOpen(false);
        setCpPhoneError("");
        setCpLookup(null);
        setEnquiryForm({ fullName: "", mobile: "", altMobile: "", email: "", address: "", pinCode: "", city: "", occupation: "", organization: "", budget: "", configuration: "", purpose: "", source: "", assignedTo: "", loanPlanned: "", sourceOther: "", referralName: "", cpDetails: { name: "", company: "", phone: "" }, sourcingManagerId: "", preferredLocation: "", selfAssign: false, enquiryDate: getTodayString() });
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
  const prefillSalesForm = () => {
    if (!selectedLead) return;
    const sf = currentLeadFollowUps.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));
    if (sf.length === 0) return;
    const msg = sf[sf.length - 1].message;
    const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; };
    setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" });
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

  const handleBookingSuccess = (booking: any) => {
    setBookingData(booking);
    setBookingDetailTab("booking");
    showToast(`🎉 Booking ${booking.booking_number} created for ${selectedLead?.name}!`);
    refetchAll();
  };

  // fetchBookingForLead was removed: it duplicated the booking request that
  // fetchLoanDealData already makes, and had no callers left once the two
  // lead-open effects were merged.

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
      showToast(`✅ Lead #${selectedLead.sr_no || selectedLead.id} transferred to ${transferTarget}!`);
      setAssignedSubView("cards");
      refetchAll();
    } catch (e: any) {
      alert(e.message ?? "Transfer failed. Try again.");
    } finally {
      setIsTransferring(false);
    }
  };

  // handleChatSubmit lived here: a setTimeout, three `userMsg.includes(...)`
  // branches and a default apology. It is gone with the mock it drove.

  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  // ─────────────────────────────────────────────────────────────────────────
  // FILTERED SETS
  // ─────────────────────────────────────────────────────────────────────────
  const receptionistLeads = mergedLeads
    .filter((e: any) =>
      (e.name || "").toLowerCase().includes(searchRecep.toLowerCase()) ||
      String(e.sr_no || e.id).includes(searchRecep) ||
      (e.phone || "").includes(searchRecep)
    )
    .sort((a: any, b: any) => (Number(b.sr_no) || 0) - (Number(a.sr_no) || 0));

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
  // ── Chart bucket helper ──────────────────────────────────────────────────
  // All new data uses exact standardised strings. Legacy rows that don't match
  // any CONFIG_KEY are bucketed into "Other" so they still appear in the chart.
  const bucketConfig = (rawConfig: string): string => {
    const c = (rawConfig || "").trim();
    return CONFIG_KEYS.includes(c) ? c : "Other";
  };

  const configTodayBarData = useMemo(() => {
    const filtered = mergedLeads.filter((e: any) => e.created_at && new Date(e.created_at) >= todayStart);
    const cc: Record<string, number> = {}; CONFIG_KEYS.forEach(k => (cc[k] = 0));
    filtered.forEach((item: any) => { cc[bucketConfig(item.configuration)]++; });
    return CONFIG_KEYS.map((name, i) => ({ name, count: cc[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
  }, [mergedLeads, todayStart, t.chartColors]);

  const configMonthlyBarData = useMemo(() => {
    const filtered = mergedLeads.filter((e: any) => { if (!e.created_at) return false; const d = new Date(e.created_at); return d.getMonth() === configChartMonth && d.getFullYear() === dateNow.getFullYear(); });
    const cc: Record<string, number> = {}; CONFIG_KEYS.forEach(k => (cc[k] = 0));
    filtered.forEach((item: any) => { cc[bucketConfig(item.configuration)]++; });
    return CONFIG_KEYS.map((name, i) => ({ name, count: cc[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
  }, [mergedLeads, configChartMonth, isDark]);

  const configInceptionBarData = useMemo(() => {
    const cc: Record<string, number> = {}; CONFIG_KEYS.forEach(k => (cc[k] = 0));
    mergedLeads.forEach((item: any) => { cc[bucketConfig(item.configuration)]++; });
    return CONFIG_KEYS.map((name, i) => ({ name, count: cc[name], color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
  }, [mergedLeads, t.chartColors]);

  const buildMonthStackedData = (numMonths: number) => {
    return Array.from({ length: numMonths }, (_, i) => numMonths - 1 - i).map(offset => {
      const d = new Date(dateNow.getFullYear(), dateNow.getMonth() - offset, 1);
      const monthIdx = d.getMonth(); const year = d.getFullYear();
      const filtered = mergedLeads.filter((e: any) => { if (!e.created_at) return false; const dd = new Date(e.created_at); return dd.getMonth() === monthIdx && dd.getFullYear() === year; });
      const entry: Record<string, any> = { month: MONTH_NAMES[monthIdx].slice(0, 3) };
      CONFIG_KEYS.forEach(k => { entry[k] = filtered.filter((e: any) => bucketConfig(e.configuration) === k).length; });
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
      /* `recep-panel` scopes the Apple-discipline type/spacing/touch-target
         layer in globals.css to this panel only — see the block there. It
         replaces `font-sans` (Geist) with the native system stack. */
      className={`recep-panel flex flex-col md:flex-row h-screen overflow-hidden ${t.pageWrap}`}
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
          Mounted from components/receptionist/ReceptionistSidebar.tsx rather
          than written inline. Settings mounts the same component through
          RoleSidebar, which is what stops the rail from being replaced by the
          cut-down admin one when a Receptionist opens Settings.
      ════════════════════════════════════════════════════ */}
      <ReceptionistSidebar
        activeId={activeTab === "detail" ? "overview" : activeTab}
        onSelect={(item) => {
          if (item.id === "settings") router.push("/dashboard/settings/profile");
          else setActiveTab(item.id);
        }}
        expanded={sidebarExpanded}
        onExpandedChange={setSidebarExpanded}
      />

      {/* ════════════════════════════════════════════════════
          MAIN CONTENT
      ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden relative md:ml-[72px]">

        {/* HEADER — the shared AppHeader, i.e. literally the bar the Settings
            page renders. It was hand-rolled here before, which is why its
            controls kept drifting from Settings no matter how many times the
            sizes were matched by hand: two copies of a bar cannot be kept equal
            by editing one of them. AppHeader owns the frame, the logo and the
            clock; the controls below stay this page's own, with their handlers,
            popups and state untouched. */}
        <AppHeader
          isDark={isDark}
          context={RECEPTIONIST_CONTEXT[activeTab]}
          role={user?.role}
          // Structure comes from AppHeader; colour stays on this panel's own
          // locked tokens. `border-b ${t.header}` and `t.headerGlass` are the
          // exact class and style this header carried before the migration, so
          // the bar's background, border colour and light-mode shadow are
          // unchanged — only its metrics and controls moved.
          surfaceClassName={`border-b ${t.header}`}
          surfaceStyle={t.headerGlass}
        >
          <div className="flex items-center gap-2 relative" ref={topbarRef}>
            {/* HeaderClock is rendered by AppHeader itself — the copy that used
                to be here is gone, not moved, or the bar would show two clocks. */}
            {/* Compact Login/Logout punch control. Clicking "Login" hits
                POST /api/attendance/mark directly (no navigation); once
                marked it shows the live elapsed timer and clicking it runs
                the same logout flow as the profile menu. */}
            <AttendanceBadge
              timeIn={timeIn}
              isMarkedPresent={isMarkedPresent}
              onLogout={handleLogout} />
            {/* HeaderControl is the Settings bar's control: 36px square, one
                border, one radius, colour transitions only. Using the component
                rather than restating its classes is what makes "the same size as
                Settings" true by construction instead of by inspection. */}
            <HeaderControl
              isDark={isDark}
              size="sm"
              onClick={toggleTheme}
              aria-pressed={isDark}
              label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </HeaderControl>
            {/* ── NOTIFICATION BELL & DROPDOWN ── */}
            <div className="relative">
              {/* Same HeaderControl as the theme button, so the bell is no longer
                  the one control in this bar with its own size and no chrome.
                  `relative` is passed explicitly: HeaderControl does not set it,
                  and the unread badge is absolutely positioned against this
                  button rather than against the wrapper. */}
              <HeaderControl
                isDark={isDark}
                size="sm"
                label="Notifications"
                className="relative"
                onClick={() => { setActivePopup(activePopup === "notifications" ? null : "notifications"); setNotifCount(0); }}
              >
                <FaBell className="w-3 h-3" />
                {notifCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#9E217B] rounded-full text-[9px] font-black text-white flex items-center justify-center">
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </HeaderControl>

              <AnimatePresence>
                {activePopup === "notifications" && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`absolute top-12 right-0 w-[320px] border rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden ${t.dropdown}`} style={t.dropdownGlass}
                  >
                    {/* Three at most, newest first, no internal scrollbar, and a
                        centred "You're all caught up" instead of a blank box.
                        Clicking a row opens that lead's detail panel. */}
                    <NotificationPopover
                      title="Recent Notifications"
                      caption="New leads and upcoming site visits"
                      items={notificationHistory}
                      footerNoun="notifications"
                      accent="green"
                      theme={notifPopoverTheme}
                      onOpenLead={openLeadFromNotification}
                      onDismiss={(n) => notifications.dismiss(n.id)}
                      // No separate Notification Center on this panel: the front
                      // desk's own Enquiries table already IS the full list, and
                      // it is one click away in the rail. The footer takes them
                      // there rather than to a second copy of the same rows.
                      onSeeAll={() => { setActivePopup(null); setActiveTab("overview"); }}
                    />
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
            {/* Was a click-handling <div>: not reachable by keyboard, and not
                sized by the touch-target rule, so it would have sat 8px shorter
                than the two buttons beside it. Same colours, same avatar.
                overflow-hidden matches the Settings avatar button so an uploaded
                picture is clipped to the circle by the button, not only by the
                <img>'s own rounding. */}
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={activePopup === "profile"}
              onClick={() => setActivePopup(activePopup === "profile" ? null : "profile")}
              className={`w-8 h-8 flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center font-semibold text-[13px] cursor-pointer transition-colors duration-150 ${isDark ? "border border-[#9E217B]/40 text-[#d4006e] bg-[#9E217B]/15" : "border border-[#00AEEF]/40 text-[#00AEEF] bg-[#00AEEF]/10"}`}>
              <UserAvatar name={user?.name} fallback="U" alt="" />
            </button>
            <AnimatePresence>
              {activePopup === "profile" && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={`absolute top-12 right-0 w-60 rounded-[1.25rem] p-4 z-50 border shadow-2xl ${isDark ? "bg-[#1C1C1E]/95 border-white/10" : "bg-white/95 border-black/5"
                    }`}
                  style={{ backdropFilter: "blur(20px) saturate(180%)" }}
                >
                  <p className={`font-semibold text-[14px] tracking-tight leading-tight ${t.text}`}>
                    {user?.name || "User"}
                  </p>
                  <p className={`text-[11px] truncate mt-0.5 ${t.textMuted}`}>
                    {user?.email || "No email"}
                  </p>

                  <hr className={`my-3 border-0 border-t ${isDark ? "border-white/10" : "border-black/5"}`} />

                  <p className={`text-[12px] leading-relaxed ${t.textMuted}`}>
                    Logged in as a <span className={`font-semibold capitalize ${isDark ? "text-white" : "text-black"}`}>{user?.role || "Receptionist"}</span>.
                  </p>

                  <button
                    onClick={() => {
                      setActivePopup(null);
                      router.push("/dashboard/settings/profile");
                    }}
                    className={`w-full mt-4 py-2 rounded-xl font-medium text-[13px] transition-colors ${isDark
                      ? "bg-white/10 hover:bg-white/15 text-white"
                      : "bg-black/[0.04] hover:bg-black/[0.08] text-black"
                      }`}
                  >
                    Account Settings
                  </button>

                  {/* Destructive, so it is the only red control in the menu. */}
                  <button
                    onClick={handleLogout}
                    className="w-full mt-2 py-2 rounded-xl font-medium text-[13px] transition-colors text-red-500 bg-red-500/10 hover:bg-red-500/20"
                  >
                    Log Out
                  </button>
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

        </AppHeader>

        {/* ── MAIN SCROLL AREA ── */}
        {/* Content inset comes off the spacing scale (20 → 32) instead of the
            old 16/24, which matches the 20px the table toolbars already use and
            stops the page edge from shifting between tabs. */}
        <main className={`flex-1 overflow-y-auto p-2 md:p-2 custom-scrollbar relative ${t.mainBg}`}>

          {/* ────────────────────────────────────────────────────────────
              SETTINGS — no longer an in-page tab.
              The three cards that used to live here are all superseded by the
              real Settings area, which the rail now opens:
                Account Details  → Settings › Profile (editable, not read-only)
                System Password  → Settings › Account & Security (change it,
                                   rather than reveal it in plain text)
                WhatsApp Number  → Settings › WhatsApp Integration (same field,
                                   plus the API/manual state that explains when
                                   the number stops sending)
              Nothing was dropped; every control moved to a screen that does more.
          ──────────────────────────────────────────────────────────── */}

          {/* ────────────────────────────────────────────────────────────
              AI ASSISTANT
          ──────────────────────────────────────────────────────────── */}
          {activeTab === "assistant" && (
            /* The real assistant, replacing ~310 lines of inline mock.

               What was here: a hand-rolled chat panel whose "AI" was a chain of
               `userMsg.includes("total")` string tests returning pre-written
               strings, a typing indicator permanently disabled behind
               `{false && ...}`, a duplicated bold-text renderer, and a Google
               four-colour "✦" avatar that matched nothing else in the CRM. It
               could not answer anything it had not been hardcoded to answer.

               BhoomiAiPanel is the same component the Admin and Sales rails
               mount: real retrieval through /api/admin/ai/chat, streaming
               thinking state, retry, regenerate, New Chat, markdown answers and
               cited sources. It owns its own dark canvas, so it is given the
               height and left alone — no page header above it, because it
               renders its own.

               A Receptionist's answers are scoped to her own leads in SQL
               (lib/admin-ai/services.ts), not by anything this file passes. */
            <div className="animate-fadeIn h-[calc(100vh-130px)] flex flex-col">
              <BhoomiAiPanel isDark={isDark} t={t} user={user} />
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              CHANNEL PARTNER ENQUIRIES — view only for Receptionist.
              Row scoping and the reassign gate live in /api/cp-enquiries,
              so this panel just renders whatever it is allowed to see.
          ════════════════════════════════════════════════════ */}
          {activeTab === "cp-enquiries" && (
            <div className="animate-fadeIn h-[calc(100vh-140px)]">
              <ChannelPartnerEnquiriesTable
                user={user}
                isDark={isDark}
                t={t}
                title="Channel Partner Enquiries"
                subtitle="All enquiries sourced through a Channel Partner"
              />
            </div>
          )}

          {/* ── SHARED PAGE HEADER ── */}
          {!["settings", "detail", "assistant", "assigned", "recep-leads", "closed-leads", "attendance", "analytics", "cp-enquiries"].includes(activeTab) && (
            <RpPageHeader
              title={`Hi, ${String(user?.name || "User").split(" ")[0]}`}
              subtitle="Walk-ins and enquiries logged at the front desk"
              titleClass={t.text}
              subtitleClass={t.textFaint}
              badge={
                <span className={`rp-chip capitalize ${isDark ? "text-[#9E217B] bg-white/80 border border-[#9E217B]/40" : "text-[#9E217B] bg-[#9E217B]/10 border border-[#9E217B]/20"}`}>Front Desk</span>
              }
            >
              <button onClick={() => setIsCpVisitModalOpen(true)}
                className={`rp-control-label flex items-center justify-center gap-2 px-4 rounded-lg shadow-sm ${t.btnSecondary}`}>
                <FaUserTie className="text-[11px]" />
                <span className="md:hidden">CP</span>
                <span className="hidden md:inline">CP Office Visit</span>
              </button>
              <button onClick={refetchAll} className={`rp-control-label text-white flex items-center justify-center gap-2 px-4 rounded-lg shadow-sm ${t.btnPrimary}`}>
                <FaSyncAlt className="text-[11px]" />
                <span className="md:hidden">Sync</span>
                <span className="hidden md:inline">Refresh Live Data</span>
              </button>
            </RpPageHeader>
          )}

          {/* ── CP Office Visit Registration (create-only for Receptionist) ── */}
          <ChannelPartnerFormModal
            isOpen={isCpVisitModalOpen}
            onClose={() => setIsCpVisitModalOpen(false)}
            onSaved={info => {
              // A merge means the phone matched an existing partner and their
              // record was topped up — the operator asked to create something and
              // no new record appeared, so say so rather than a generic success.
              if (info) showToast(info.merged ? "Existing partner updated" : "Channel partner registered", info.merged ? "blue" : "green");
            }}
            partner={null}
            user={user}
            isDark={isDark}
            t={t}
            variant="office_visit"
          />

          {/* ════════════════════════════════════════════════════
              OVERVIEW TAB
          ════════════════════════════════════════════════════ */}
          {/* ════════════════════════════════════════════════════
              OVERVIEW TAB
          ════════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <div className="animate-fadeIn pb-10">

              {/* Front Desk Log */}
              <div className={`rounded-3xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
                {/* Toolbar — same rhythm as EnquiryOverview: title + count chip,
                    flexible search, actions pushed right, all on the head surface. */}
                <div className={`px-5 pt-4 pb-3.5 flex flex-wrap items-center gap-3 border-b ${t.tableHead} ${isDark ? "border-white/[0.06]" : "border-indigo-300"}`}>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <FaClipboardList className="text-[#00AEEF] text-sm" />
                    <h2 className={`rp-section ${t.text}`}>Front Desk Log</h2>
                    <span
                      className={`text-[10px] font-bold px-2 py-1 rounded-md tabular-nums ${t.btnClosingBadge}`}
                      title={receptionistLeads.length !== totalCount ? `${receptionistLeads.length} of ${totalCount} leads loaded` : undefined}
                    >
                      {receptionistLeads.length.toLocaleString("en-IN")}
                      {receptionistLeads.length !== totalCount && (
                        <span className="opacity-50"> / {Number(totalCount || 0).toLocaleString("en-IN")}</span>
                      )}
                    </span>
                  </div>

                  <SearchBar value={searchRecep} onChange={setSearchRecep} isDark={isDark} placeholder="Search leads..." />

                  <div className="flex items-center gap-2 flex-wrap ml-auto">
                    <ToolbarButton onClick={() => setIsEnquiryModalOpen(true)} isDark={isDark} tone="brand" title="Log a new walk-in enquiry">
                      + New Entry
                    </ToolbarButton>
                  </div>
                </div>
                <DraggableTableContainer isDark={isDark}>
                  <table className="w-full text-left text-sm border-gray-300 whitespace-nowrap">
                    <thead className={tblHeadCls} style={tblHeadStyle}><tr>
                      {["Lead No.", "Client Name", "Source", "CP Name", "CP Company", "CP Phone", "Budget", "Phone", "Alt. Phone", "Date Created", "Backdated Entry", "Sales Manager"].map(h => (
                        <th key={h} className={`${thCls} ${h === "Lead No." ? `sticky left-0 z-20 ${isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}` :
                          h === "Client Name" ? `sticky left-[96px] z-20 ${isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}` : ""
                          }`}
                          style={
                            h === "Lead No." ? { minWidth: '96px', maxWidth: '96px' } :
                              h === "Client Name" ? { minWidth: '172px', maxWidth: '172px', boxShadow: isDark ? "1px 0 0 #2A2A35" : "1px 0 0 #9CA3AF" } : {}
                          }>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className={`${tblDivide} divide-y`}>
                      {isFetchingEnquiries ? (
                        <SkeletonRows rows={8} cols={12} isDark={isDark} />
                      ) : receptionistLeads.length === 0 ? (
                        <tr><td colSpan={12}>
                          <EmptyState onReset={() => setSearchRecep("")} hasFilters={!!searchRecep} isDark={isDark} />
                        </td></tr>
                      ) : receptionistLeads.map((enquiry: any, rowIdx: number) => {
                        const rowBgClass = zebraBg(rowIdx);
                        return (
                          <tr key={enquiry.id} className={`${rowCls} cursor-pointer ${rowBgClass}`} onClick={() => { setSelectedLead(enquiry); setActiveTab("detail"); }}>
                            <td className={`${tdCls} text-[13px] font-bold ${t.accentText} sticky left-0 z-10 bg-inherit`} style={{ minWidth: '96px', maxWidth: '96px' }}>#{enquiry.sr_no || enquiry.id}</td>
                            <td className={`${tdCls} text-[13px] font-bold ${t.text} sticky left-[96px] z-10 bg-inherit`} style={{ minWidth: '172px', maxWidth: '172px', boxShadow: isDark ? "1px 0 0 #2A2A35" : "1px 0 0 #9CA3AF" }}>{enquiry.name}</td>

                            <td className={`${tdCls} text-xs ${t.textMuted}`}>
                              {enquiry.source || <span className="text-xs italic opacity-35">—</span>}
                            </td>
                            <td className={`${tdCls} text-xs truncate max-w-[100px] ${t.textMuted}`}>{enquiry.cp_name || <span className="text-xs italic opacity-35">—</span>}</td>
                            <td className={`${tdCls} text-xs truncate max-w-[100px] ${t.textMuted}`}>{enquiry.cp_company || <span className="text-xs italic opacity-35">—</span>}</td>
                            <td className={`${tdCls} text-xs truncate max-w-[100px] ${t.textMuted}`}>{enquiry.cp_phone || <span className="text-xs italic opacity-35">—</span>}</td>
                            <td className={`${tdCls} text-[13px] font-semibold tabular-nums ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>{enquiry.salesBudget || enquiry.budget}</td>
                            <td className={`${tdCls} text-xs font-mono ${t.text}`}>{maskPhone(enquiry.phone)}</td>
                            <td className={`${tdCls} text-xs font-mono ${t.textMuted}`}>{maskPhone(enquiry.altPhone)}</td>
                            <td className={`${tdCls} text-xs min-w-[120px] ${t.textFaint}`}>{enquiry.date}</td>
                            <td className={`${tdCls} text-xs min-w-[110px] ${t.textFaint}`}>
                              {enquiry.autoDateEnabled === false && enquiry.enquiryDate ? formatDate(enquiry.enquiryDate).split(",")[0] : <span className="text-xs italic opacity-30">—</span>}
                            </td>
                            <td className={tdCls}>
                              <span className={`px-2 py-1 rounded-md text-[10px] font-semibold ${t.accentBg}`}>{enquiry.assignedTo || "Unassigned"}</span>
                            </td>
                          </tr>
                        )
                      })}
                      {isLoadingMore && <LoaderRow />}
                      {!hasMore && !isFetchingEnquiries && enquiries.length > 0 && (
                        <tr><td colSpan={12} className={`px-3 py-3.5 text-center text-[11px] font-semibold opacity-50`}>All {totalCount} records loaded</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div ref={tableSentinelRef} className="h-1 w-full" aria-hidden="true" />
                </DraggableTableContainer>
              </div>

            </div>
          )}

          {/* ════════════════════════════════════════════════════
              ANALYTICS TAB
          ════════════════════════════════════════════════════ */}
          {activeTab === "analytics" && (
            <div className="animate-fadeIn pb-10">
              <RpPageHeader
                title="Analytics"
                subtitle="Charts and breakdowns for your enquiries"
                titleClass={t.text}
                subtitleClass={t.textFaint}
              >
                <button onClick={refetchAll} className={`rp-control-label text-white flex items-center justify-center gap-2 px-4 rounded-lg shadow-sm ${t.btnPrimary}`}>
                  <FaSyncAlt className="text-[11px]" /> Refresh Live Data
                </button>
              </RpPageHeader>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Card 1: Room Configurations */}
                <div className={`rounded-3xl p-6 border flex flex-col ${t.card}`} style={t.cardGlass}>
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
                      {(() => {
                        let pieData: any[] = [];
                        if (chartMode1 === "today") pieData = configTodayBarData;
                        else if (chartMode1 === "monthly") pieData = configMonthlyBarData;
                        else if (chartMode1 === "inception") pieData = configInceptionBarData;
                        else {
                          const src = chartMode1 === "3months" ? config3MonthBarData : chartMode1 === "6months" ? config6MonthBarData : configYearlyBarData;
                          pieData = CONFIG_KEYS.map((key, i) => ({ name: key, count: src.reduce((s: number, item: any) => s + (item[key] || 0), 0), color: t.chartColors[i % t.chartColors.length] })).filter(d => d.count > 0);
                        }
                        return <ReceptionistDonutChart data={pieData} legendColor={t.legendColor} tooltip={<CustomTooltip />} />;
                      })()}
                    </div>
                  )}
                </div>

                {/* Card 4: Lead Sources */}
                <div className={`rounded-3xl p-6 border flex flex-col ${t.card}`} style={t.cardGlass}>
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
                      <ReceptionistDonutChart data={sourceDataFiltered} legendColor={t.legendColor} tooltip={<CustomTooltip />} />
                    </div>
                  )}
                </div>

                {/* Card 2: Enquiry Details */}
                <div className={`rounded-3xl p-6 border flex flex-col gap-4 ${t.card}`} style={t.cardGlass}>
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
                        downloadCSV(f.map((e: any) => ({ "Lead No.": e.sr_no || e.id, "Client Name": e.name, "Budget": e.salesBudget || "N/A", "Configuration": e.configuration || "N/A", "Purpose": e.purpose || "N/A", "Source": e.source || "N/A", "Date": e.date, "Assigned To": e.assignedTo || "Unassigned" })), `Enquiries_${card2Mode}.csv`);
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
                <div className={`rounded-3xl p-6 border flex flex-col ${t.card}`} style={t.cardGlass}>
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
            </div>
          )}

          {/* ════════════════════════════════════════════════════
              DETAIL VIEW (from Forms tab)
          ════════════════════════════════════════════════════ */}
          {activeTab === "detail" && selectedLead && (
            <div className="animate-fadeIn max-w-5xl mx-auto">
              <div className={`flex flex-col sm:flex-row sm:items-center gap-4 mb-8 rounded-2xl border p-6 md:p-8 ${t.card}`} style={t.cardGlass}>
                <button onClick={() => setActiveTab("overview")} className={`w-10 h-10 flex items-center justify-center border hover:border-current rounded-xl transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder}`}><FaChevronLeft className="text-sm" /></button>
                <h1 className={`text-xl md:text-3xl font-bold flex flex-wrap items-center gap-3 ${t.text}`}>
                  <span className={t.accentText}>#{selectedLead.sr_no || selectedLead.id}</span>
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
                        <InlineContactField label="Phone Number" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); showToast("Contact details updated successfully."); }} />
                        <InlineContactField label="Alt. Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); showToast("Contact details updated successfully."); }} />
                        <InlineContactField label="Email Address" value={selectedLead.email} fieldType="email" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                        <div>
                          <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Residential Address</p>
                          <p className={`font-medium ${t.text}`}>{selectedLead.address || "N/A"}</p>
                          <div className="grid grid-cols-2 gap-4 mt-3">
                            <div>
                              <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Pin Code</p>
                              <p className={`font-medium ${t.text}`}>{selectedLead.pinCode || selectedLead.pin_code || "N/A"}</p>
                            </div>
                            <div>
                              <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>City</p>
                              <p className={`font-medium ${t.text}`}>{selectedLead.city || "N/A"}</p>
                            </div>
                            <div className="col-span-2">
                              <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Preferred Location</p>
                              <p className={`font-medium ${t.text}`}>{selectedLead.preferred_location || "N/A"}</p>
                            </div>
                          </div>

                          {/* ── Assignment Details — CP enquiries only, read-only.
                              Rendered only when the lead actually came through a
                              Channel Partner, so non-CP leads don't show an empty
                              sourcing block. Receptionists cannot change this. ── */}
                          {(selectedLead.source === "Channel Partner" || selectedLead.source === "CP") && (
                            <div className={`mt-4 rounded-3xl p-4 border ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30" : "bg-[#9E217B]/5 border-[#9E217B]/25"}`}>
                              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${t.accentText}`}>
                                Assignment Details
                              </p>
                              <div className="grid grid-cols-2 gap-4">
                                {/* /api/walkin_enquiries is a plain SELECT * with no join,
                                    so only sourcing_manager_id is on the lead. The person's
                                    details are resolved from the list already fetched for the
                                    enquiry form rather than widening that paginated query. */}
                                {(() => {
                                  const sm = sourcingManagers.find(
                                    (m: any) => String(m.id) === String(selectedLead.sourcing_manager_id)
                                  );
                                  return [
                                    ["Assigned Sourcing Manager", sm?.name],
                                    ["Employee ID", selectedLead.sourcing_manager_id ? `#${selectedLead.sourcing_manager_id}` : null],
                                    ["Phone Number", sm?.phone || sm?.whatsapp_number],
                                    ["Email", sm?.email],
                                    ["Assigned Date", selectedLead.sourcing_manager_assigned_at ? formatDate(selectedLead.sourcing_manager_assigned_at) : null],
                                    ["Assigned By", selectedLead.sourcing_manager_assigned_by],
                                  ];
                                })().map(([label, value]) => (
                                  <div key={String(label)}>
                                    <p className={`text-xs font-medium mb-1 ${t.textFaint}`}>{label}</p>
                                    <p className={`font-medium text-sm ${t.text}`}>{value ? String(value) : "N/A"}</p>
                                  </div>
                                ))}
                              </div>
                              <p className={`text-[10px] mt-3 ${t.textFaint}`}>
                                Read-only. Only an Admin can change the assigned Sourcing Manager.
                              </p>
                            </div>
                          )}
                        </div>
                        <InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); showToast("Contact details updated successfully."); }} />
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
                                  <span className={`mr-2 transition-colors ${isDark ? "text-[#d4006e]" : "text-[#00AEEF] group-hover:text-[#9E217B]"}`}>#{lead.sr_no || lead.id}</span>{lead.name}
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
                bookingData ? (
                  <div className="animate-fadeIn max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-130px)]">
                    <ClosedLeadBookingView
                      booking={bookingData}
                      lead={selectedLead}
                      isDark={isDark}
                      userRole={user?.role?.toLowerCase() || "receptionist"}
                    />
                  </div>
                ) : (
                  <div className="animate-fadeIn max-w-[1600px] mx-auto flex flex-col h-[calc(100vh-130px)]">
                    {/* Detail header */}
                    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1 rounded-2xl border p-3 sm:p-3 shadow-sm flex-shrink-0 ${t.card}`} style={t.cardGlass}>
                      <div className="flex items-center gap-4">
                        <button onClick={() => { setAssignedSubView("cards"); }} className={`w-10 h-10 flex items-center justify-center border rounded-xl transition-colors cursor-pointer shadow-sm ${t.textMuted} ${t.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}`}><FaChevronLeft className="text-sm" /></button>
                        <h1 className={`text-xl md:text-2xl font-bold flex items-center gap-3 ${t.text}`}>
                          <span className={t.accentText}>#{selectedLead.sr_no || selectedLead.id}</span>
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
                              <button onClick={() => { setShowLoanForm(true); setShowSalesForm(false); }}
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

                    {/* AI voice calling. Self-gating: renders nothing at all when
                        Bolna is unconfigured, so it needs no capability guard here. */}
                    <div className="mb-1 flex-shrink-0">
                      <BolnaCallWidget
                        leadId={Number(selectedLead.id)}
                        leadName={selectedLead.name}
                        phone={selectedLead.phone}
                        userData={{ project: selectedLead.propType || selectedLead.configuration }}
                        compact
                      />
                    </div>

                    <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 pb-2">
                      {/* LEFT PANEL */}
                      <div className="w-full lg:w-[50%] flex flex-col gap-3 h-[calc(100vh-150px)] pb-2">
                        {showSalesForm ? (
                          <div className={`rounded-xl border p-5 shadow-xl flex-1 overflow-y-auto custom-scrollbar flex flex-col ${t.modalCard}`} style={t.modalGlass}>
                            <div className={`flex justify-between items-center mb-4 border-b pb-3 ${t.tableBorder}`}>
                              <div>
                                <h3 className={`text-lg font-bold ${t.text}`}>Sales Data Form</h3>
                                <p className={`text-xs mt-0.5 ${t.accentText}`}>For Lead #{selectedLead.sr_no || selectedLead.id}</p>
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
                          <LoanDealForm
                            lead={selectedLead}
                            booking={loanDealBooking}
                            loanUpdate={loanDealLatest}
                            user={user}
                            isDark={isDark}
                            t={t}
                            onCancel={() => setShowLoanForm(false)}
                            onSuccess={() => {
                              setShowLoanForm(false);
                              showToast(`Loan & deal data saved for ${selectedLead.name}`, "blue");
                              fetchLoanDealData(selectedLead.id);
                              refetchAll();
                            }}
                          />
                        ) : (
                          <div className="flex flex-col h-full animate-fadeIn">
                            {/* Tab switcher */}
                            <div className={`flex items-center gap-2 mb-2 border p-1.5 rounded-xl flex-shrink-0 ${t.tableWrap}`}>
                              <button onClick={() => setDetailTab("personal")} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "personal" ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Personal Information</button>
                              <button onClick={() => setDetailTab("loan")} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${detailTab === "loan" ? t.btnSecondary : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>Loan Tracking</button>
                              {bookingData && (
                                <button onClick={() => { setDetailTab("loan" as any); setBookingDetailTab("booking"); }} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1 ${bookingDetailTab === "booking" && detailTab === "loan" ? (isDark ? "bg-yellow-600 text-white" : "bg-amber-500 text-white") : `${t.textMuted} ${isDark ? "hover:text-white hover:bg-[#222]" : "hover:text-[#1A1A1A] hover:bg-[#F1F5F9]"}`}`}>
                                  📋 Booking Application
                                </button>
                              )}
                            </div>
                            <div className={`flex-1 overflow-y-auto custom-scrollbar rounded-xl p-6 pt-4 pb-4 shadow-lg border ${t.chatPanel}`} style={t.chatPanelGl}>
                              {bookingData && bookingDetailTab === "booking" ? (
                                <BookingApplicationView
                                  booking={bookingData}
                                  lead={selectedLead}
                                  isDark={isDark}
                                  userRole={user.role?.toLowerCase() || "receptionist"}
                                  onApprove={undefined}
                                  onCancel={undefined}
                                />
                              ) : detailTab === "personal" ? (
                                <div>
                                  <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                                    <InlineContactField label="Email" value={selectedLead.email} fieldType="email" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "email", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, email: val || "N/A" })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Phone" value={selectedLead.phone} fieldType="tel" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, phone: val })); showToast("Contact details updated successfully."); }} />
                                    <InlineContactField label="Alt Phone" value={selectedLead.altPhone ?? selectedLead.alt_phone} fieldType="tel" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} mono onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "alt_phone", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, altPhone: val, alt_phone: val })); showToast("Contact details updated successfully."); }} />
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Lead Interest</p>{selectedLead.leadInterestStatus && selectedLead.leadInterestStatus !== "Pending" ? <InterestBadge status={selectedLead.leadInterestStatus} /> : <p className={`font-semibold ${t.text}`}>Pending</p>}</div>
                                    <div className="col-span-1"><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Loan Status</p>{selectedLead.loanStatus && selectedLead.loanStatus !== "N/A" ? <div className="w-fit"><LoanStatusBadge status={selectedLead.loanStatus} /></div> : <p className={`font-semibold ${t.text}`}>N/A</p>}</div>
                                    <div className="col-span-1"><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Backdated Entry</p><p className={`font-semibold ${t.text}`}>{selectedLead.auto_date_enabled === false && selectedLead.enquiry_date ? formatDate(selectedLead.enquiry_date).split(",")[0] : "Null"}</p></div>
                                    <div className="col-span-2"><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Residential Address</p><p className={`font-semibold ${t.text}`}>{selectedLead.address && selectedLead.address !== "N/A" ? selectedLead.address : "Not Provided"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Pin Code</p><p className={`font-semibold ${t.text}`}>{selectedLead.pinCode || selectedLead.pin_code || "N/A"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>City</p><p className={`font-semibold ${t.text}`}>{selectedLead.city || "N/A"}</p></div>
                                    <div className="col-span-2"><InlineContactField label="Location" value={selectedLead.location} fieldType="text" isDark={isDark} theme={t} canEdit={user?.role === "Admin" || user?.role === "Receptionist"} onSave={async (val) => { const r = await contactFieldSave(selectedLead.id, "location", val); if (!r.success) throw new Error(r.message); setSelectedLead((p: any) => ({ ...p, location: val || "N/A" })); showToast("Contact details updated successfully."); }} /></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Budget</p><p className={`font-bold ${isDark ? "text-green-400" : "text-emerald-600"}`}>{selectedLead.salesBudget !== "Pending" ? selectedLead.salesBudget : selectedLead.budget}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Property Type</p><p className={`font-semibold ${t.text}`}>{selectedLead.propType || "Pending"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Type of Use</p><p className={`font-semibold ${t.text}`}>{selectedLead.useType !== "Pending" ? selectedLead.useType : (selectedLead.purpose || "N/A")}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Planning to Buy?</p><p className={`font-semibold ${t.text}`}>{selectedLead.planningPurchase || "Pending"}</p></div>
                                    <div><p className={`text-xs font-medium mb-1 ${t.textFaint}`}>Loan Required?</p><p className={`font-semibold ${t.text}`}>{loanDealLatest?.loan_required || selectedLead.loanPlanned || "Pending"}</p></div>
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
                                <LoanDealView lead={selectedLead} booking={loanDealBooking} loanUpdate={loanDealLatest} isDark={isDark} t={t} />
                              )}
                            </div>



                            <div className="grid grid-cols-2 gap-3 mt-2 flex-shrink-0">
                              <button className={`border flex flex-col items-center justify-center py-3 rounded-xl transition-all cursor-pointer gap-1 ${isDark ? "bg-[#00AEEF]/10 border-[#00AEEF]/30 hover:bg-[#00AEEF] text-[#00AEEF] hover:text-white" : "bg-[#00AEEF]/10 border-[#00AEEF]/30 hover:bg-[#00AEEF] text-[#00AEEF] hover:text-white"}`}><FaMicrophone className="text-lg" /><span className="font-bold text-[10px]">Browser Call</span></button>
                              <button onClick={() => setIsWaModalOpen(true)} className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl transition-all cursor-pointer gap-1"><FaWhatsapp className="text-xl" /><span className="font-bold text-[10px]">WhatsApp</span></button>
                              <CallingButtons leadId={selectedLead?.id ?? null} phone={selectedLead?.phone} leadName={selectedLead?.name} isDark={isDark} iconClass="text-xl" paddingClass="py-3" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* RIGHT PANEL: FOLLOW-UPS */}
                      <div className={`w-full lg:w-[50%] flex flex-col rounded-2xl overflow-hidden shadow-2xl h-[calc(100vh-150px)] min-h-0 border ${t.chatPanel}`} style={t.chatPanelGl}>
                        <div className={`flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-3 ${t.chatArea}`}>
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
                        {/* Open on closed/lost leads too — see the note in the sales panel. */}
                        <form onSubmit={handleSendCustomNote} className={`p-4 border-t flex gap-3 items-center flex-shrink-0 ${t.header} ${t.tableBorder}`} style={t.headerGlass}>
                          <input
                            type="text" value={customNote} onChange={e => setCustomNote(e.target.value)}
                            placeholder="Add follow-up note..."
                            className={`flex-1 rounded-xl px-4 py-3 text-sm outline-none transition-colors border ${t.inputBg} ${t.text} ${t.inputFocus}`}
                          />
                          <button type="submit" className={`w-12 h-12 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg ${isDark ? "bg-purple-600 hover:bg-purple-500" : "bg-[#00AEEF] hover:bg-[#0099d4]"}`}><FaPaperPlane className="text-sm ml-[-2px]" /></button>
                        </form>
                      </div>
                    </div>
                  </div>
                )
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

          <BookingFormModal
            isOpen={isClosingModalOpen}
            onClose={() => setIsClosingModalOpen(false)}
            lead={selectedLead}
            user={user}
            isDark={isDark}
            onSuccess={handleBookingSuccess}
          />

          {/* ════════════════════════════════════════════════════
              RECEPTIONIST LEADS TAB
          ════════════════════════════════════════════════════ */}
          {activeTab === "recep-leads" && (
            <div className="animate-fadeIn pb-10">
              <RpPageHeader
                title="Receptionist Leads"
                subtitle="Leads you have personally handled or captured"
                titleClass={t.text}
                subtitleClass={t.textFaint}
              >
                <ToolbarButton
                  onClick={() => downloadCSV(filteredRecepLeads.map((l: any) => ({ "Lead No.": l.sr_no || l.id, "Client Name": l.name, "CP Company": l.cp_company || "N/A", "Budget": l.salesBudget || l.budget || "N/A", "Phone": l.phone || "N/A", "Alt Phone": l.altPhone || "N/A", "Date Created": l.date, "Assigned to Receptionist": l.assignedReceptionist || user.name, "Status": l.status || "Assigned" })), "Receptionist_Leads.csv")}
                  icon={<FaDownload className="text-[11px]" />} isDark={isDark} title="Download these leads as CSV">
                  Export
                </ToolbarButton>
                <ToolbarButton onClick={refetchAll} icon={<FaSyncAlt className="text-[11px]" />} isDark={isDark} title="Refresh leads" />
              </RpPageHeader>

              <div className={`rounded-3xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
                {/* Toolbar row 1: title + search */}
                <div className={`px-5 pt-4 pb-3 flex flex-wrap items-center gap-3 ${t.tableHead}`}>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <FaUserTie className="text-[#00AEEF] text-sm" />
                    <h3 className={`rp-section ${t.text}`}>Your Leads</h3>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md tabular-nums ${t.btnClosingBadge}`}>
                      {filteredRecepLeads.length.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <SearchBar value={searchRecepLeads} onChange={setSearchRecepLeads} isDark={isDark} placeholder="Search leads..." />
                </div>

                {/* Toolbar row 2: filters — same layout and toggle styling as EnquiryOverview.
                    The checkboxes became ToggleSwitches; the bound state and the
                    `leadStatusFilter !== "all"` disable rule are unchanged. */}
                <div className={`px-5 pb-3.5 pt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b ${t.tableHead} ${isDark ? "border-white/[0.06]" : "border-indigo-300"}`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">Filters</span>
                  <ToggleSwitch
                    checked={showLostLeads}
                    onChange={setShowLostLeads}
                    label="Show lost"
                    accent="#ef4444"
                    disabled={leadStatusFilter !== "all"}
                    title={leadStatusFilter !== "all" ? "Controlled by the status filter" : "Include lost leads in the table"}
                    isDark={isDark}
                  />
                  <ToggleSwitch
                    checked={showNGDLeads}
                    onChange={setShowNGDLeads}
                    label="Show NGD"
                    accent="#F97316"
                    disabled={leadStatusFilter !== "all"}
                    title={leadStatusFilter !== "all" ? "Controlled by the status filter" : "Include non-genuine-demand leads"}
                    isDark={isDark}
                  />
                  <span className={`ml-auto text-[11px] font-semibold opacity-50`}>Leads assigned to or handled by you</span>
                </div>
                <DraggableTableContainer isDark={isDark}>
                  <table className="w-full text-left text-sm border-collapse whitespace-nowrap">
                    <thead className={tblHeadCls} style={tblHeadStyle}><tr>
                      {["Lead No.", "Client Name", "CP Details", "Budget", "Phone", "Alt. Phone", "Date Created", "Assigned to", "Site Visits", "Status", "Actions"].map(h => (
                        <th key={h} className={`${thCls} ${h === "Lead No." ? `sticky left-0 z-20 ${isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}` :
                          h === "Client Name" ? `sticky left-[96px] z-20 ${isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}` : ""
                          } ${h === "Status" || h === "Actions" ? "text-center" : ""}`}
                          style={
                            h === "Lead No." ? { minWidth: '96px', maxWidth: '96px' } :
                              h === "Client Name" ? { minWidth: '172px', maxWidth: '172px', boxShadow: isDark ? "1px 0 0 #2A2A35" : "1px 0 0 #9CA3AF" } : {}
                          }>
                          {h}
                        </th>
                      ))}
                    </tr></thead>
                    <tbody className={`${tblDivide} divide-y`}>
                      {isFetchingDirectLeads ? (
                        <SkeletonRows rows={8} cols={11} isDark={isDark} />
                      ) : filteredRecepLeads.length === 0 ? (
                        /* Kept as bespoke copy rather than <EmptyState>, whose text is
                           fixed — "self-assign when creating an entry" is the actual
                           next step here. Styling matches EmptyState exactly. */
                        <tr><td colSpan={11}>
                          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                            <div className={`w-16 h-16 rounded-2xl grid place-items-center mb-4 ${isDark ? "bg-white/[0.04] border border-white/10" : "bg-gray-50 border border-gray-200"}`}>
                              <FaUserTie className="text-2xl opacity-25" />
                            </div>
                            <p className="text-sm font-bold mb-1">No leads found</p>
                            <p className="text-xs opacity-50 mb-5 max-w-[300px]">Self-assign leads when creating new entries and they will appear here.</p>
                          </div>
                        </td></tr>
                      ) : filteredRecepLeads.map((lead: any, rowIdx: number) => {
                        const isLost = !!lead.is_lost_lead;
                        const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" || lead.leadStatus === "NON GENUINE DEMAND (NGD)" || lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
                        // Lost / NGD keep their own opaque tint — that colour carries
                        // meaning, so it outranks the zebra stripe rather than blending.
                        const rowBgClass = isLost ? (isDark ? "bg-[#151515]" : "bg-slate-100") : isNGD ? (isDark ? "bg-[#1a1410]" : "bg-orange-50") : zebraBg(rowIdx);
                        return (
                          <tr key={lead.id}
                            className={`group transition-colors duration-200 ${isLost ? t.rowLost : isNGD ? t.rowNGD : t.tableRow} ${rowBgClass}`}>

                            {/* 1. Lead No. */}
                            <td className={`${tdCls} text-[13px] font-bold ${t.accentText} sticky left-0 z-10 bg-inherit`} style={{ minWidth: '96px', maxWidth: '96px' }}>#{lead.sr_no || lead.id}</td>

                            {/* 2. Client Name */}
                            <td className={`${tdCls} text-[13px] font-bold ${t.text} sticky left-[96px] z-10 bg-inherit`} style={{ minWidth: '172px', maxWidth: '172px', boxShadow: isDark ? "1px 0 0 #2A2A35" : "1px 0 0 #9CA3AF" }}>{lead.name}</td>

                            {/* 3. CP Details */}
                            <td className={`${tdCls} text-xs ${t.textMuted}`}>
                              {(lead.cp_company || lead.cpCompany) ? (
                                <div className="flex flex-col gap-[3px]">
                                  <span className={`font-semibold text-xs ${t.text}`}>{lead.cp_company || lead.cpCompany}</span>
                                  {(lead.cp_phone || lead.cpPhone) && (
                                    <span className="font-mono text-[10px] text-orange-400">{lead.cp_phone || lead.cpPhone}</span>
                                  )}
                                </div>
                              ) : <span className="text-xs italic opacity-35">—</span>}
                            </td>

                            {/* 4. Budget */}
                            <td className={`${tdCls} text-[13px] font-semibold tabular-nums ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</td>

                            {/* 5. Phone */}
                            <td className={`${tdCls} text-xs font-mono ${t.text}`}>{maskPhone(lead.phone)}</td>

                            {/* 6. Alt Phone */}
                            <td className={`${tdCls} text-xs font-mono ${t.textMuted}`}>{maskPhone(lead.altPhone)}</td>

                            {/* 7. Date Created */}
                            <td className={`${tdCls} text-xs min-w-[120px] ${t.textFaint}`}>{lead.date}</td>

                            {/* 8. Assigned to */}
                            <td className={tdCls}>
                              <span className={`px-2 py-1 rounded-md text-[10px] font-semibold ${isDark ? "bg-purple-500/10 text-purple-400 border border-purple-500/30" : "bg-[#9E217B]/10 text-[#9E217B] border border-[#9E217B]/30"}`}>{lead.assignedReceptionist || user.name}</span>
                            </td>

                            {/* Site Visits */}
                            <td className={tdCls}>
                              {lead.mongoVisitDate ? (
                                <span className="text-orange-500 font-semibold text-xs whitespace-nowrap">{formatDate(lead.mongoVisitDate).split(",")[0]}</span>
                              ) : (
                                <span className="text-xs italic opacity-35">Pending</span>
                              )}
                            </td>

                            {/* 9. Status */}
                            <td className={`${tdCls} text-center`}>
                              {lead.is_lost_lead ? (
                                <span className={`rp-chip border uppercase ${t.statusLost}`}>
                                  <Ghost className="w-3 h-3" /> Lost
                                </span>
                              ) : isNGD ? (
                                <span className={`rp-chip border uppercase ${t.statusNGD}`}>
                                  NGD
                                </span>
                              ) : (
                                <span className={`rp-chip border uppercase ${getStatusStyle(lead.status)
                                  }`}>{lead.status || "Assigned"}</span>
                              )}
                            </td>

                            {/* 10. Actions */}
                            <td className={`${tdCls} text-center`}>
                              <button onClick={() => { setSelectedLead(lead); setAssignedSubView("detail"); setDetailTab("personal"); setShowSalesForm(false); setShowLoanForm(false); setActiveTab("assigned"); }}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all duration-200 hover:-translate-y-[1px] cursor-pointer ${t.btnPrimary}`}>
                                <FaEye className="text-[9px]" /> Open
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </DraggableTableContainer>
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
                  <RpPageHeader
                    title="Closed Leads"
                    subtitle="Leads that have reached the Closing stage"
                    titleClass={t.text}
                    subtitleClass={t.textFaint}
                  >
                    <ToolbarButton
                      onClick={() => downloadCSV(filteredClosedLeads.map((l: any) => ({
                        "Lead No.": l.sr_no || l.id,
                        "Client Name": l.name,
                        "Budget": l.salesBudget || l.budget || "N/A",
                        "Status": l.status,
                        "Assigned To": l.assignedTo || "Unassigned",
                        "Closing Date": l.closingDate ? formatDate(l.closingDate) : "N/A",
                        "Date Created": l.date,
                      })), "Closed_Leads.csv")}
                      icon={<FaDownload className="text-[11px]" />} isDark={isDark} title="Download closed leads as CSV">
                      Export
                    </ToolbarButton>
                    <ToolbarButton onClick={refetchAll} icon={<FaSyncAlt className="text-[11px]" />} isDark={isDark} title="Refresh leads" />
                  </RpPageHeader>

                  <div className={`rounded-3xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
                    <div className={`px-5 pt-4 pb-3.5 flex flex-wrap items-center gap-3 border-b ${t.tableHead} ${isDark ? "border-white/[0.06]" : "border-indigo-300"}`}>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <FaHandshake className="text-[#00AEEF] text-sm" />
                        <h3 className={`rp-section ${t.text}`}>Closed Leads</h3>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md tabular-nums ${t.btnClosingBadge}`}>
                          {filteredClosedLeads.length.toLocaleString("en-IN")}
                        </span>
                      </div>
                      <SearchBar value={searchClosedLeads} onChange={setSearchClosedLeads} isDark={isDark} placeholder="Search leads..." />
                      <span className="ml-auto text-[11px] font-semibold opacity-50">Click any row to view full history</span>
                    </div>
                    <DraggableTableContainer isDark={isDark}>
                      <table className="w-full text-left text-sm border-collapse whitespace-nowrap">
                        <thead className={tblHeadCls} style={tblHeadStyle}><tr>
                          {["Lead No.", "Client Name", "Budget", "Property", "Status", "Assigned To", "Site Visit", "Closing Date", "Actions"].map(h => (
                            <th key={h} className={`${thCls} ${h === "Lead No." ? `sticky left-0 z-20 ${isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}` :
                              h === "Client Name" ? `sticky left-[96px] z-20 ${isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}` : ""
                              } ${h === "Status" || h === "Actions" ? "text-center" : ""}`}
                              style={
                                h === "Lead No." ? { minWidth: '96px', maxWidth: '96px' } :
                                  h === "Client Name" ? { minWidth: '172px', maxWidth: '172px', boxShadow: isDark ? "1px 0 0 #2A2A35" : "1px 0 0 #9CA3AF" } : {}
                              }>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody className={`${tblDivide} divide-y`}>
                          {isFetchingEnquiries ? (
                            <SkeletonRows rows={8} cols={9} isDark={isDark} />
                          ) : filteredClosedLeads.length === 0 ? (
                            <tr><td colSpan={9}>
                              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                                <div className={`w-16 h-16 rounded-2xl grid place-items-center mb-4 ${isDark ? "bg-white/[0.04] border border-white/10" : "bg-gray-50 border border-gray-200"}`}>
                                  <FaHandshake className="text-2xl opacity-25" />
                                </div>
                                <p className="text-sm font-bold mb-1">No closed leads yet</p>
                                <p className="text-xs opacity-50 mb-5 max-w-[300px]">Leads marked as Closing will appear here.</p>
                              </div>
                            </td></tr>
                          ) : filteredClosedLeads.map((lead: any, rowIdx: number) => {
                            const rowBgClass = zebraBg(rowIdx);
                            return (
                              <tr key={lead.id} className={`${rowCls} cursor-pointer ${rowBgClass}`}
                                onClick={() => { setSelectedClosedLead(lead); setClosedLeadView("detail"); }}>
                                <td className={`${tdCls} text-[13px] font-bold ${t.accentText} sticky left-0 z-10 bg-inherit`} style={{ minWidth: '96px', maxWidth: '96px' }}>#{lead.sr_no || lead.id}</td>
                                <td className={`${tdCls} text-[13px] font-bold ${t.text} sticky left-[96px] z-10 bg-inherit`} style={{ minWidth: '172px', maxWidth: '172px', boxShadow: isDark ? "1px 0 0 #2A2A35" : "1px 0 0 #9CA3AF" }}>{lead.name}</td>
                                <td className={`${tdCls} text-[13px] font-semibold tabular-nums ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>{lead.salesBudget || lead.budget}</td>
                                <td className={`${tdCls} text-xs ${t.textMuted}`}>{(lead.propType && lead.propType !== "Pending" && lead.propType !== "N/A" ? lead.propType : lead.configuration && lead.configuration !== "Pending" && lead.configuration !== "N/A" ? lead.configuration : "N/A")}</td>
                                <td className={`${tdCls} text-center`}>
                                  <span className={`rp-chip border uppercase ${t.statusClosing}`}>
                                    {lead.status}
                                  </span>
                                </td>
                                <td className={`${tdCls} text-xs ${t.textMuted}`}>{lead.assignedTo || "Unassigned"}</td>
                                <td className={`${tdCls} text-xs ${lead.mongoVisitDate ? "text-orange-500 font-semibold" : t.textFaint}`}>
                                  {lead.mongoVisitDate ? formatDate(lead.mongoVisitDate).split(",")[0] : <span className="text-xs italic opacity-35">—</span>}
                                </td>
                                <td className={`${tdCls} text-xs ${t.textFaint}`}>
                                  {lead.closingDate ? formatDate(lead.closingDate).split(",")[0] : <span className="text-xs italic opacity-35">—</span>}
                                </td>
                                <td className={`${tdCls} text-center`}>
                                  <button className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all duration-200 hover:-translate-y-[1px] cursor-pointer ${t.btnWarning}`}>
                                    <FaEye className="text-[9px]" /> View History
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </DraggableTableContainer>
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
                      <div className={`lg:col-span-2 rounded-3xl border overflow-hidden flex flex-col ${t.chatPanel}`} style={t.chatPanelGl}>
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

          {/* ════════════════════════════════════════════════════
              SITE VISIT OVERVIEW — this receptionist's leads only.
              Same component the Admin and Sales Manager calendars use. It
              scopes itself to the lead ids handed to it in `allLeads`, which is
              why the Sales page passes `myOwnLeads` and this one passes
              `directAssignedLeads` — every lead where she is the assignee or
              the assigned receptionist, fetched from the two dedicated
              endpoints rather than the paginated table, so a lead transferred
              to her is included even when it falls outside the loaded page.
              `myAssignedLeads` is deliberately NOT used: it drops Closing and
              closed leads, and a completed visit on a lead that went on to
              close is exactly the history this calendar should still show.

              The prop is not the security boundary. /api/site-visits/all now
              applies the same ownership predicate in SQL, so the browser is
              never sent another employee's visits to filter out.
          ════════════════════════════════════════════════════ */}
          {activeTab === "site_visits" && (
            <div className="animate-fadeIn h-[calc(100vh-130px)]">
              <SiteVisitOverview
                allLeads={directAssignedLeads}
                receptionists={[]}
                managers={[]}
                siteHeads={[]}
                adminUser={user}
                theme={t}
                isDark={isDark}
              />
            </div>
          )}
        </main>
      </div>

      {/* ════════════════════════════════════════════════════
          BOTTOM NAV (MOBILE)
      ════════════════════════════════════════════════════ */}
      <nav className={`md:hidden flex w-full h-16 border-t items-center justify-around flex-shrink-0 z-40 ${t.sidebar}`}>
        {/* Same list as the desktop rail — Settings is filtered out because it
            is rendered separately below as a route rather than a tab. */}
        {RECEPTIONIST_NAV.filter(i => i.id !== "settings").map(({ id, icon: Icon, label }) => {
          const active = activeTab === id || (id === "overview" && activeTab === "detail");
          return (
            <div key={id} onClick={() => setActiveTab(id)} className="relative flex justify-center items-center h-full flex-1 cursor-pointer" title={label}>
              {active && <div className={`absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b ${t.navIndicator}`} />}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${active ? t.navActive : t.navInactive}`}><Icon className="w-5 h-5" /></div>
            </div>
          );
        })}
        {/* Navigates rather than switching tab — same destination as the desktop
            rail's Settings item, so both entry points land on the same screen. It
            never shows an active state because leaving this route unmounts the
            bar; Settings has its own rail and marks itself active there. */}
        <button
          type="button"
          aria-label="Settings"
          onClick={() => router.push("/dashboard/settings/profile")}
          className="relative flex justify-center items-center h-full flex-1 cursor-pointer"
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${t.navInactive}`}><FaCog className="w-5 h-5" /></div>
        </button>
      </nav>

      {/* ════════════════════════════════════════════════════
          ENQUIRY MODAL (with Self-Assign toggle)
      ════════════════════════════════════════════════════ */}
      {isEnquiryModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[100] flex justify-center items-center p-4 sm:p-6 animate-fadeIn"
          style={{ backdropFilter: "blur(20px) saturate(180%)" }}
        >
          <div
            className={`rounded-[28px] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col ${t.modalCard}`}
            style={{
              ...t.modalGlass,
              boxShadow: isDark
                ? "0 24px 70px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)"
                : "0 24px 70px -12px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)",
            }}
          >
            {/* Header — Apple sheet header: title left, plain circular close, hairline divider */}
            <div className={`px-6 py-5 flex justify-between items-start border-b ${t.tableBorder}`}>
              <div>
                <h2 className={`text-[19px] font-semibold tracking-[-0.01em] ${t.text}`}>
                  Client Enquiry
                </h2>
                <p className={`text-[13px] mt-0.5 ${t.textMuted}`}>
                  Fill all details accurately to route to the Sales Manager.
                </p>
              </div>
              <button
                onClick={() => setIsEnquiryModalOpen(false)}
                aria-label="Close"
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${isDark ? "bg-white/10 hover:bg-white/15 text-gray-300" : "bg-black/[0.06] hover:bg-black/[0.09] text-gray-500"
                  }`}
              >
                <FaTimes className="text-[13px]" />
              </button>
            </div>

            <div className={`px-6 py-6 overflow-y-auto custom-scrollbar flex-1 ${t.modalInner}`}>
              {/* space-y-9: Apple grouped-list sections read as separate "cards" of
            content, so the gap between sections needs to clearly exceed the
            gap between fields inside one (gap-4) — otherwise the eye can't
            tell where one group ends and the next begins. */}
              <form id="enquiryForm" onSubmit={handleEnquirySubmit} className="space-y-9">
                <div>
                  <h3 className={`text-[12px] font-semibold uppercase tracking-wider mb-3 px-1 ${t.textMuted}`}>
                    Personal Information
                  </h3>
                  <div
                    className={`rounded-2xl border overflow-hidden ${isDark ? "border-white/10 bg-white/[0.03]" : "border-black/[0.06] bg-black/[0.015]"}`}
                  >
                    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Full Name *</label>
                        <input
                          type="text"
                          required
                          value={enquiryForm.fullName}
                          onChange={e => setEnquiryForm({ ...enquiryForm, fullName: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                            } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                          placeholder="e.g. Mayur Acharya"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Address</label>
                        <input
                          type="text"
                          value={enquiryForm.address}
                          onChange={e => setEnquiryForm({ ...enquiryForm, address: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border-gray-400 ${isDark ? "bg-white/5 border-white/10" : "bg-white border-black/10"
                            } ${t.text}`}
                          placeholder="Full residential address"
                        />

                        {/* Pin Code + City — optional, same as Address. Captured now so
                      Channel Partners can later be matched to enquiry demand by
                      area; no filtering UI is wired to these yet. */}
                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Pin Code</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={enquiryForm.pinCode}
                              // Digits only: the column is VARCHAR, but a stray letter
                              // would break an equality match against a CP's pincode.
                              onChange={e => setEnquiryForm({ ...enquiryForm, pinCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                              className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                                } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                              placeholder="e.g. 411045"
                            />
                          </div>
                          <div>
                            <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>City</label>
                            <input
                              type="text"
                              value={enquiryForm.city}
                              onChange={e => setEnquiryForm({ ...enquiryForm, city: e.target.value })}
                              className={`w-full appearance-none rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                                } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                              placeholder="e.g. Pune"
                            />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Mobile No *</label>
                        <div
                          className={`flex items-center rounded-xl border overflow-hidden transition-all focus-within:ring-4 ${isDark
                            ? "bg-white/5 border-white/10 focus-within:border-blue-400/60 focus-within:ring-blue-500/10"
                            : "bg-white border-black/10 focus-within:border-blue-500 focus-within:ring-blue-500/10"
                            }`}
                        >
                          <span className={`pl-3.5 pr-1 text-[14px] font-medium select-none ${t.textMuted}`}>+91</span>
                          <input
                            type="tel"
                            required
                            inputMode="numeric"
                            maxLength={10}
                            value={enquiryForm.mobile}
                            onChange={e => setEnquiryForm({ ...enquiryForm, mobile: cleanMobileDigits(e.target.value) })}
                            className={`flex-1 py-2.5 pr-3.5 pl-1 text-[14px] outline-none bg-transparent ${t.text}`}
                            placeholder="8369787919"
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Alt Mobile No</label>
                        <div
                          className={`flex items-center rounded-xl border overflow-hidden transition-all focus-within:ring-4 ${isDark
                            ? "bg-white/5 border-white/10 focus-within:border-blue-400/60 focus-within:ring-blue-500/10"
                            : "bg-white border-black/10 focus-within:border-blue-500 focus-within:ring-blue-500/10"
                            }`}
                        >
                          <span className={`pl-3.5 pr-1 text-[14px] font-medium select-none ${t.textMuted}`}>+91</span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            value={enquiryForm.altMobile}
                            onChange={e => setEnquiryForm({ ...enquiryForm, altMobile: cleanMobileDigits(e.target.value) })}
                            className={`flex-1 py-2.5 pr-3.5 pl-1 text-[14px] outline-none bg-transparent ${t.text}`}
                            placeholder="9876543210"
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Email ID</label>
                        <input
                          type="email"
                          value={enquiryForm.email}
                          onChange={e => setEnquiryForm({ ...enquiryForm, email: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                            } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                          placeholder="email@example.com"
                        />
                      </div>
                      <div>
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Occupation</label>
                        <select
                          value={enquiryForm.occupation}
                          onChange={e => setEnquiryForm({ ...enquiryForm, occupation: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border cursor-pointer appearance-none ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                            } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                        >
                          <option value="" disabled>Select Occupation</option>
                          {["Salaried", "Self Employed", "Business owner", "House maker"].map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Loan Planned</label>
                        <select
                          value={enquiryForm.loanPlanned}
                          onChange={e => setEnquiryForm({ ...enquiryForm, loanPlanned: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border cursor-pointer appearance-none ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                            } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                        >
                          <option value="" disabled>Select Option</option>
                          <option value="Yes">Yes</option><option value="No">No</option>
                        </select>
                      </div>

                      {/* ── Auto Date Toggle + Enquiry Date Picker ── */}
                      <div className="sm:col-span-2">
                        <div className={`rounded-xl p-4 border ${isDark ? "bg-white/[0.04] border-white/10" : "bg-black/[0.02] border-black/[0.06]"}`}>
                          {/* Toggle Row */}
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <label className={`block text-[13px] font-medium ${t.text}`}>
                                <FaCalendarAlt className={`inline mr-1.5 text-[11px] ${t.textMuted}`} />
                                Auto Date
                              </label>
                              <p className={`text-[11px] mt-0.5 ${t.textFaint}`}>
                                {autoDate ? "Using today's date automatically." : "Select the original enquiry date."}
                              </p>
                            </div>
                            <button
                              type="button"
                              /* role="switch" matches the shared ToggleSwitch and,
                                 beyond the a11y win, exempts this control from the
                                 panel's 36px min-height rule — a switch has fixed
                                 geometry (h-6 w-11 with a knob positioned against
                                 that height) and would otherwise inflate. */
                              role="switch"
                              aria-checked={autoDate}
                              onClick={() => setAutoDate(!autoDate)}
                              className="relative inline-flex h-[26px] w-[46px] items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer flex-shrink-0"
                              style={{
                                backgroundColor: autoDate ? "#34C759" : (isDark ? "rgba(255,255,255,0.16)" : "#E9E9EB"),
                              }}
                              aria-label="Toggle Auto Date"
                            >
                              <span
                                className="inline-block h-[22px] w-[22px] transform rounded-full bg-white transition-transform duration-200"
                                style={{
                                  transform: autoDate ? "translateX(22px)" : "translateX(2px)",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                                }}
                              />
                            </button>
                          </div>

                          {/* Date Picker */}
                          <div>
                            <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>
                              Enquiry Date {!autoDate && <span className="text-red-500">*</span>}
                            </label>
                            <input
                              type="date"
                              required={!autoDate}
                              disabled={autoDate}
                              value={enquiryForm.enquiryDate}
                              max={getTodayString()}
                              onChange={e => setEnquiryForm({ ...enquiryForm, enquiryDate: e.target.value })}
                              className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                                } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text} ${autoDate ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                                }`}
                              style={autoDate ? { pointerEvents: "none" } : {}}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className={`text-[12px] font-semibold uppercase tracking-wider mb-3 px-1 ${t.textMuted}`}>
                    Requirement &amp; Budget
                  </h3>
                  <div
                    className={`rounded-2xl border p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-black/[0.06] bg-black/[0.015]"
                      }`}
                  >
                    <div>
                      <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Budget *</label>
                      <input
                        type="text"
                        required
                        value={enquiryForm.budget}
                        onChange={e => setEnquiryForm({ ...enquiryForm, budget: e.target.value })}
                        className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                          } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                        placeholder="e.g. 80 Lakhs, 1.5 Cr"
                      />
                    </div>
                    <div>
                      {/* Where the client wants to buy — distinct from the residential
                    address captured in Personal Information. */}
                      <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Preferred Location</label>
                      <input
                        type="text"
                        value={enquiryForm.preferredLocation}
                        onChange={e => setEnquiryForm({ ...enquiryForm, preferredLocation: e.target.value })}
                        className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                          } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                        placeholder="e.g. Baner, Wakad, Hinjewadi"
                      />
                    </div>
                    <div>
                      <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Configuration (BHK)</label>
                      <input
                        type="text"
                        value={enquiryForm.configuration}
                        onChange={e => setEnquiryForm({ ...enquiryForm, configuration: e.target.value })}
                        className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                          } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                        placeholder="e.g. 2 BHK, 3 BHK, Studio"
                      />
                    </div>
                    <div>
                      <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Purpose</label>
                      <select
                        value={enquiryForm.purpose}
                        onChange={e => setEnquiryForm({ ...enquiryForm, purpose: e.target.value })}
                        className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border cursor-pointer appearance-none ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                          } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                      >
                        <option value="" disabled>Select…</option>
                        {["Personal use", "Investment", "Second home"].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className={`text-[12px] font-semibold uppercase tracking-wider mb-3 px-1 ${t.textMuted}`}>
                    Routing &amp; Source
                  </h3>
                  <div
                    className={`rounded-2xl border p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-black/[0.06] bg-black/[0.015]"
                      }`}
                  >
                    <div>
                      <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Source *</label>
                      <select
                        required
                        value={enquiryForm.source}
                        onChange={e => {
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
                          // Switching away from Channel Partner must not leave a stale
                          // CP-phone error attached to a source that has no CP fields.
                          setCpPhoneError("");
                        }}
                        className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border cursor-pointer appearance-none ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                          } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                      >
                        <option value="" disabled>Select Source</option>
                        {["Advertisement", "Referral", "Exhibition", "Channel Partner", "Website", "Call Center", "Others"].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    {/* SELF-ASSIGN — true iOS segmented control: single pill track,
                  sliding white/dark "thumb" behind the active label. Only one
                  of the two states is ever visually "raised", matching how
                  UISegmentedControl reads at a glance. */}
                    <div className={`rounded-xl p-4 border flex flex-col gap-3 ${isDark ? "bg-white/[0.04] border-white/10" : "bg-black/[0.02] border-black/[0.06]"}`}>
                      <label className={`block text-[12px] font-medium px-0.5 ${t.textMuted}`}>Assignment Option</label>
                      <div className={`relative flex p-1 rounded-lg ${isDark ? "bg-black/30" : "bg-black/[0.06]"}`}>
                        <div
                          className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md transition-transform duration-200 ease-out ${isDark ? "bg-[#2C2C2E]" : "bg-white"
                            }`}
                          style={{
                            transform: enquiryForm.selfAssign ? "translateX(calc(100% + 8px))" : "translateX(0)",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => { setEnquiryForm({ ...enquiryForm, selfAssign: false }); setShowManagerDropdown(true); }}
                          className={`relative z-10 flex-1 py-1.5 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer ${!enquiryForm.selfAssign ? "text-blue-500" : t.textMuted
                            }`}
                        >
                          Assign to Manager
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEnquiryForm({ ...enquiryForm, selfAssign: true, assignedTo: "" }); setAssignedToError(""); }}
                          className={`relative z-10 flex-1 py-1.5 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer ${enquiryForm.selfAssign ? "text-blue-500" : t.textMuted
                            }`}
                        >
                          Self-Assign (Me)
                        </button>
                      </div>
                      {enquiryForm.selfAssign ? (
                        <p className="text-[12px] text-blue-500">✓ Lead will be assigned to <strong>{user.name}</strong> (you)</p>
                      ) : (
                        <div className={`w-full rounded-xl border overflow-hidden ${assignedToError ? "border-red-500" : isDark ? "border-white/10" : "border-black/10"}`}>
                          {isFetchingManagers ? (
                            <div className={`p-3 text-[13px] ${t.textMuted}`}>Loading managers…</div>
                          ) : combinedAssignees.length === 0 ? (
                            <div className={`p-3 text-[13px] ${t.textMuted}`}>No assignees available</div>
                          ) : (
                            <>
                              {/* Selected display or placeholder — always visible */}
                              <div
                                onClick={() => setShowManagerDropdown(prev => !prev)}
                                className={`px-3.5 py-2.5 text-[13.5px] cursor-pointer flex items-center justify-between ${enquiryForm.assignedTo
                                  ? isDark ? "text-blue-300 bg-blue-500/10" : "text-blue-700 bg-blue-500/[0.06] font-medium"
                                  : t.textFaint
                                  }`}
                              >
                                <span>{enquiryForm.assignedTo ? `${enquiryForm.assignedTo} ✓` : "-- Select Sales Manager --"}</span>
                                <span className={`text-[11px] ${t.textFaint}`}>{showManagerDropdown ? "▲" : "▼"}</span>
                              </div>

                              {/* Dropdown list — only shown when open */}
                              {showManagerDropdown && (
                                <div className={`max-h-[200px] overflow-y-auto custom-scrollbar border-t ${isDark ? "border-white/10" : "border-black/[0.06]"}`}>
                                  {combinedAssignees.map((m, i) => (
                                    <div
                                      key={i}
                                      onClick={() => {
                                        setEnquiryForm({ ...enquiryForm, assignedTo: m.name });
                                        setAssignedToError("");
                                        setShowManagerDropdown(false);
                                      }}
                                      className={`px-3.5 py-2.5 text-[13.5px] cursor-pointer border-b transition-colors ${enquiryForm.assignedTo === m.name
                                        ? isDark ? "bg-blue-500/15 text-blue-300 font-medium" : "bg-blue-500/[0.08] text-blue-700 font-medium"
                                        : `${t.text} ${isDark ? "hover:bg-white/[0.04] border-white/10" : "hover:bg-black/[0.02] border-black/[0.05]"}`
                                        }`}
                                    >
                                      <span>{m.name}</span>
                                      <span className={`ml-2 text-[11px] ${t.textFaint}`}>
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

                      {/* The submit guard sets assignedToError but nothing displayed it,
                    so an unassigned submit failed silently — the button appeared
                    to do nothing. Rendered here, under the field it refers to. */}
                      {assignedToError && (
                        <p className="text-[12px] font-medium text-red-500 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          {assignedToError}
                        </p>
                      )}
                    </div>

                    {enquiryForm.source === "Others" && (
                      <div className="sm:col-span-2">
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Specify Source *</label>
                        <input
                          required
                          type="text"
                          value={enquiryForm.sourceOther}
                          onChange={e => setEnquiryForm({ ...enquiryForm, sourceOther: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                            } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                          placeholder="Please specify the lead source"
                        />
                      </div>
                    )}
                    {enquiryForm.source === "Referral" && (
                      <div className="sm:col-span-2">
                        <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>Referred by *</label>
                        <input
                          required
                          type="text"
                          value={enquiryForm.referralName}
                          onChange={e => setEnquiryForm({ ...enquiryForm, referralName: e.target.value })}
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                            } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                          placeholder="e.g. Rajesh Sharma (existing client)"
                        />
                      </div>
                    )}
                    {enquiryForm.source === "Channel Partner" && (
                      <div
                        className={`sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-4 rounded-xl border ${isDark ? "bg-white/[0.04] border-white/10" : "bg-black/[0.02] border-black/[0.06]"
                          }`}
                      >
                        <h4 className={`sm:col-span-2 text-[12px] font-semibold uppercase tracking-wider mb-0.5 ${t.textMuted}`}>
                          Channel Partner Details
                        </h4>

                        {/* Phone is first, emphasized, and now REQUIRED. It is the only
                      field that identifies a partner uniquely: name-only matching
                      creates duplicates, and where two partners share a name it
                      merges them and pays commission to the wrong person. Enforced
                      client-side here and again in POST /api/walkin_enquiries. */}
                        <div className="sm:col-span-2">
                          <label className={`block text-[12px] mb-1.5 font-semibold px-0.5 text-blue-500`}>CP Phone Number *</label>
                          <input
                            required
                            type="text"
                            value={enquiryForm.cpDetails.phone}
                            onChange={e => {
                              setEnquiryForm({ ...enquiryForm, cpDetails: { ...enquiryForm.cpDetails, phone: e.target.value } });
                              if (cpPhoneError) setCpPhoneError("");
                            }}
                            className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${cpPhoneError
                              ? "border-red-500 focus:ring-4 focus:ring-red-500/10"
                              : isDark
                                ? "bg-white/5 border-white/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                                : "bg-white border-black/10 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                              } ${t.text}`}
                            placeholder="Phone Number"
                          />
                          {cpPhoneError ? (
                            <p className="text-[11px] mt-1.5 px-0.5 font-medium text-red-500">{cpPhoneError}</p>
                          ) : cpLookupLoading ? (
                            <p className={`text-[11px] mt-1.5 px-0.5 ${t.textFaint}`}>Checking the partner registry…</p>
                          ) : (
                            <p className={`text-[11px] mt-1.5 px-0.5 ${t.textMuted}`}>
                              Required — identifies this partner and prevents duplicate records.
                            </p>
                          )}

                          {/* ── Registry cross-check result ──
                        Three outcomes, each worth saying differently:
                        a registered partner with an owner (routing is decided),
                        a registered partner with none (this form picks the owner),
                        and an unknown number (a new partner will be created). */}
                          {!cpLookupLoading && cpLookup?.found && cpLookup.routable && (
                            <div className={`mt-2 rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px] ${isDark ? "bg-green-500/[0.08] text-green-300" : "bg-green-500/[0.06] text-green-700"
                              }`}>
                              <FaUserTie className="mt-0.5 flex-shrink-0 text-[11px]" />
                              <span>
                                <b>{cpLookup.partner.name}</b>
                                {cpLookup.partner.company_name ? ` (${cpLookup.partner.company_name})` : ""}{" "}
                                is a registered Channel Partner with <b>{Number(cpLookup.partner.lead_count || 0)}</b> lead
                                {Number(cpLookup.partner.lead_count || 0) === 1 ? "" : "s"} so far. This lead goes to their
                                Sourcing Manager, <b>{cpLookup.partner.assigned_sourcing_manager_name}</b>.
                              </span>
                            </div>
                          )}

                          {!cpLookupLoading && cpLookup?.found && !cpLookup.routable && (
                            <div className={`mt-2 rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px] ${isDark ? "bg-amber-500/[0.08] text-amber-300" : "bg-amber-500/[0.08] text-amber-700"
                              }`}>
                              <FaInfoCircle className="mt-0.5 flex-shrink-0 text-[11px]" />
                              <span>
                                <b>{cpLookup.partner.name}</b> is already registered but has no active Sourcing Manager.
                                Choose one below — they will own this partner from now on.
                              </span>
                            </div>
                          )}

                          {!cpLookupLoading && cpLookup && !cpLookup.found && (
                            <div className={`mt-2 rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px] ${isDark ? "bg-blue-500/[0.08] text-blue-300" : "bg-blue-500/[0.06] text-blue-700"
                              }`}>
                              <FaInfoCircle className="mt-0.5 flex-shrink-0 text-[11px]" />
                              <span>New number — a Channel Partner record will be created and assigned to the Sourcing Manager you pick below.</span>
                            </div>
                          )}
                        </div>

                        <div>
                          <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>CP Name *</label>
                          <input
                            required
                            type="text"
                            value={enquiryForm.cpDetails.name}
                            onChange={e => setEnquiryForm({ ...enquiryForm, cpDetails: { ...enquiryForm.cpDetails, name: e.target.value } })}
                            className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                              } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                            placeholder="Contact Person Name"
                          />
                        </div>

                        {/* Smart Auto-suggest Input for Company */}
                        <div className="relative">
                          <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>CP Company *</label>
                          <input
                            required
                            type="text"
                            value={enquiryForm.cpDetails.company}
                            onChange={e => {
                              setEnquiryForm({ ...enquiryForm, cpDetails: { ...enquiryForm.cpDetails, company: e.target.value } });
                              setShowCpDropdown(true);
                            }}
                            onFocus={() => setShowCpDropdown(true)}
                            onBlur={() => setTimeout(() => setShowCpDropdown(false), 200)} // Delay so click registers
                            className={`w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none transition-all border ${isDark ? "bg-white/5 border-white/10 focus:border-blue-400/60" : "bg-white border-black/10 focus:border-blue-500"
                              } focus:ring-4 ${isDark ? "focus:ring-blue-500/10" : "focus:ring-blue-500/10"} ${t.text}`}
                            placeholder="Company Name"
                          />

                          {/* Dropdown Menu */}
                          {showCpDropdown && enquiryForm.cpDetails.company && (
                            <div
                              className={`absolute z-50 w-full mt-1.5 max-h-40 overflow-y-auto rounded-xl border ${t.dropdown}`}
                              style={{ ...t.dropdownGlass, boxShadow: "0 12px 32px -8px rgba(0,0,0,0.25)" }}
                            >
                              {existingCPs.filter(cp => cp.company.toLowerCase().includes(enquiryForm.cpDetails.company.toLowerCase())).length > 0 ? (
                                existingCPs
                                  .filter(cp => cp.company.toLowerCase().includes(enquiryForm.cpDetails.company.toLowerCase()))
                                  .map((cp, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => {
                                        // Auto-fill company AND phone number
                                        setEnquiryForm({
                                          ...enquiryForm,
                                          cpDetails: { name: "", company: cp.company, phone: cp.phone },
                                        });
                                        setShowCpDropdown(false);
                                      }}
                                      className={`px-3.5 py-2 text-[13px] cursor-pointer transition-colors ${t.tableRow} ${t.text}`}
                                    >
                                      <p className="font-medium">{cp.company}</p>
                                      {cp.phone && <p className={`text-[10.5px] ${t.textFaint}`}>{cp.phone}</p>}
                                    </div>
                                  ))
                              ) : (
                                <div className={`px-3.5 py-2 text-[12px] italic ${t.textFaint}`}>Add as new Channel Partner</div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* CP phone now lives at the top of this block (see above) so it
                      reads as the primary identifier rather than an afterthought. */}

                        {/* ── Assign Sourcing Manager ──
                      Only the employee id is stored. Names are never hardcoded —
                      the list is fetched from /api/users/sourcing-manager. */}
                        <div className="md:col-span-2">
                          <label className={`block text-[12px] mb-1.5 font-medium px-0.5 ${t.textMuted}`}>
                            Assign Sourcing Manager{" "}
                            {cpRoutedByPartner
                              ? <span className={t.textFaint}>(set by the partner&apos;s registration)</span>
                              : <span className={t.textFaint}>(optional)</span>}
                          </label>
                          <SearchableSelect
                            value={enquiryForm.sourcingManagerId}
                            onChange={v => setEnquiryForm(prev => ({ ...prev, sourcingManagerId: v }))}
                            options={sourcingManagerOptions}
                            isDark={isDark}
                            t={t}
                            placeholder={isFetchingSourcingManagers ? "Loading Sourcing Managers…" : "Search by name, ID or phone…"}
                            emptyMessage={isFetchingSourcingManagers ? "Loading…" : "No active Sourcing Managers yet"}
                            // Locked once the phone matches an owned partner: the server
                            // routes to that owner anyway, so an editable field here would
                            // only let the operator record a choice that never takes effect.
                            disabled={isFetchingSourcingManagers || cpRoutedByPartner}
                            ariaLabel="Assign Sourcing Manager"
                          />
                          {cpRoutedByPartner && (
                            <p className={`text-[11px] mt-1.5 px-0.5 ${isDark ? "text-green-400" : "text-green-700"}`}>
                              This partner is already registered under <b>{cpLookup.partner.assigned_sourcing_manager_name}</b>,
                              so their leads stay with them. An Admin can reassign the partner from Channel Partner Management.
                            </p>
                          )}
                          {/* Three distinct states, deliberately not collapsed into one:
                        a genuinely empty registry, a failed fetch, and "loading" all
                        left the list at [] before this fix — which meant a network
                        error looked identical to "zero Sourcing Manager accounts
                        exist" with no way to tell them apart from this screen. */}
                          {cpRoutedByPartner ? (
                            // The routing is already explained above; repeating the
                            // "required" / "no managers" copy here would contradict it.
                            null
                          ) : isFetchingSourcingManagers ? (
                            <p className={`text-[11px] mt-1.5 px-0.5 ${t.textFaint}`}>Loading Sourcing Managers…</p>
                          ) : sourcingManagersError ? (
                            <p className="text-[11px] mt-1.5 px-0.5 font-medium text-red-500">
                              Couldn&apos;t load Sourcing Managers ({sourcingManagersError}).{" "}
                              <button type="button" onClick={fetchSourcingManagers} className="underline cursor-pointer">Retry</button>
                            </p>
                          ) : sourcingManagers.length === 0 ? (
                            // A walk-in partner must never be turned away because no
                            // Sourcing Manager account exists yet — reception can submit
                            // unassigned and an Admin assigns from Channel Partner
                            // Management afterwards.
                            <p className={`text-[11px] mt-1.5 px-0.5 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                              No Sourcing Managers yet — create one in Add Employee. You can still submit; an Admin can assign this enquiry later.
                            </p>
                          ) : !enquiryForm.sourcingManagerId ? (
                            <p className={`text-[11px] mt-1.5 px-0.5 ${t.textFaint}`}>
                              Optional — you can submit without one and an Admin can assign this enquiry later.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </form>
            </div>

            {/* Footer — plain-text Cancel, single blue pill primary action (Apple sheet convention) */}
            <div className={`px-6 py-4 border-t flex flex-col-reverse sm:flex-row justify-end gap-2.5 ${t.tableBorder}`}>
              <button
                onClick={() => { setIsEnquiryModalOpen(false); setShowManagerDropdown(false); }}
                type="button"
                className={`px-5 py-2.5 rounded-full text-[14px] font-medium cursor-pointer transition-colors ${isDark ? "text-gray-300 hover:bg-white/[0.06]" : "text-gray-600 hover:bg-black/[0.04]"
                  }`}
              >
                Cancel
              </button>
              <button
                form="enquiryForm"
                type="submit"
                disabled={isSubmitting}
                className={`px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-blue-500 transition-all ${isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-blue-600 active:scale-[0.98]"
                  }`}
              >
                {isSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          TRANSFER LEAD MODAL
      ════════════════════════════════════════════════════ */}
      {/* ── WHATSAPP CONVERSATION PANEL ──
          The embedded two-way panel replaced the wa.me modal: sending goes
          through the CRM backend and the customer's replies arrive over the
          webhook, so the whole thread stays inside the CRM. */}
      {isWaModalOpen && selectedLead && (
        <WhatsAppConversationPanel
          theme={t}
          isDark={isDark}
          initialLeadId={Number(selectedLead.id)}
          onClose={() => setIsWaModalOpen(false)}
        />
      )}
      {isTransferModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-4 sm:p-6 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
          <div className={`rounded-2xl w-full max-w-lg shadow-2xl border overflow-hidden ${t.modalCard}`} style={t.modalGlass}>
            {/* Header */}
            <div className={`p-5 border-b flex justify-between items-center ${isDark ? "bg-purple-900/20 border-purple-500/20" : "bg-purple-50 border-purple-200"}`}>
              <div>
                <h2 className={`text-lg font-bold flex items-center gap-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>
                  <FaExchangeAlt /> Transfer Lead #{selectedLead.sr_no || selectedLead.id}
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
                <p className={`text-xs mt-0.5 ${t.textMuted}`}>Lead #{lead.sr_no || lead.id} — {lead.name}</p>
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

