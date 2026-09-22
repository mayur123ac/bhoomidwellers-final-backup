"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MdPeople,
  MdPhone,
  MdPlaylistAddCheck,
  MdCalendarToday,
  MdFlag,
  MdKeyboardArrowDown,
  MdInfoOutline,
  MdCheck
} from "react-icons/md";

// ── Types ────────────────────────────────────────────────────────────────────

interface EmployeeInfo {
  id: number;
  name: string;
  role: string;
  created_at: string;
}

interface DashboardData {
  employees: EmployeeInfo[];
  totalLeads: number;
  contacted: Record<string, number>;
  followups: Record<string, number>;
  siteVisits: Record<string, number>;
  bookings: Record<string, number>;
}

// ── Period definitions ───────────────────────────────────────────────────────

const CONTACTED_PERIODS = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "last1Month", label: "Last 1 Month" },
  { value: "last3Months", label: "Last 3 Months" },
  { value: "last6Months", label: "Last 6 Months" },
];

const FOLLOWUP_PERIODS = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
];

const SITE_VISIT_PERIODS = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
];

const BOOKING_PERIODS = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "last3Months", label: "Last 3 Months" },
  { value: "last6Months", label: "Last 6 Months" },
  { value: "last12Months", label: "Last 12 Months" },
  { value: "tillNow", label: "Till Now" },
];

// ── Breakdown rows for detail panels ─────────────────────────────────────────

const CONTACTED_BREAKDOWN = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "last3Months", label: "Last 3 Months" },
  { key: "last6Months", label: "Last 6 Months" },
];

const FOLLOWUP_BREAKDOWN = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
];

const SITE_VISIT_BREAKDOWN = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
];

const BOOKING_BREAKDOWN = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "last3Months", label: "Last 3 Months" },
  { key: "last6Months", label: "Last 6 Months" },
  { key: "last12Months", label: "Last 12 Months" },
  { key: "tillNow", label: "Till Now" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString("en-IN");
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ── Apple System Colors ──────────────────────────────────────────────────────

const iosColors = {
  blue: { light: "#007AFF", dark: "#0A84FF", bgLight: "#E5F1FF", bgDark: "rgba(10,132,255,0.15)" },
  green: { light: "#34C759", dark: "#32D74B", bgLight: "#EBF9EE", bgDark: "rgba(50,215,75,0.15)" },
  red: { light: "#FF3B30", dark: "#FF453A", bgLight: "#FFECEB", bgDark: "rgba(255,69,58,0.15)" },
  orange: { light: "#FF9500", dark: "#FF9F0A", bgLight: "#FFF4E5", bgDark: "rgba(255,159,10,0.15)" },
  purple: { light: "#AF52DE", dark: "#BF5AF2", bgLight: "#F7EBFC", bgDark: "rgba(191,90,242,0.15)" },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function EmployeePerformancePanel({
  theme,
  isDark,
}: {
  theme: any;
  isDark: boolean;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState<number | "all">("all");
  const [contactedPeriod, setContactedPeriod] = useState("last1Month");
  const [followupPeriod, setFollowupPeriod] = useState("thisMonth");
  const [siteVisitPeriod, setSiteVisitPeriod] = useState("thisMonth");
  const [bookingPeriod, setBookingPeriod] = useState("thisMonth");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ view: "dashboard" });
      if (employeeId !== "all") params.set("employee_id", String(employeeId));
      const res = await fetch(`/api/monitoring/employee-performance?${params}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch (e) {
      console.error("employee-performance fetch error", e);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // ── Loading / Error ──

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center bg-[#F2F2F7] dark:bg-[#000000] font-sans antialiased`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-[3px] border-[#8E8E93] border-t-transparent animate-spin" />
          <p className="text-[15px] font-medium text-[#8E8E93]">Loading performance data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`h-full flex items-center justify-center bg-[#F2F2F7] dark:bg-[#000000] font-sans antialiased`}>
        <p className="text-[15px] text-[#8E8E93]">Failed to load performance data.</p>
      </div>
    );
  }

  const selectedEmployee =
    employeeId !== "all"
      ? data.employees.find((e) => e.id === employeeId) || null
      : null;

  // ── Render ──

  return (
    <div className={`h-full flex flex-col overflow-hidden font-sans antialiased transition-colors duration-300 ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>

      {/* ═══ Apple-style Header Area ═══ */}

      <div className={`flex-shrink-0 pt-8 pb-6 px-6 sm:px-10 border-b ${isDark ? "border-white/10 bg-[#1C1C1E]/80 backdrop-blur-xl" : "border-[#E5E5EA] bg-white/80 backdrop-blur-xl"} sticky top-0 z-10`}>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

          {/* Left: Title & Overview/Employee Status */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <h1 className={`text-base sm:text-xl font-black tracking-tight ${theme.accentText}`}>
              Performance
            </h1>

            {/* Divider */}
            <div className={`hidden md:block w-[1px] h-6 ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />

            {/* Dynamic Employee Quick-Info */}
            <div className="hidden md:flex items-center gap-3 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={employeeId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3 truncate"
                >
                  {selectedEmployee ? (
                    <>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold tracking-tight shadow-inner shrink-0 ${isDark ? "bg-[#2C2C2E] text-white" : "bg-[#F2F2F7] text-black"}`}>
                        {selectedEmployee.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex items-center gap-3 text-[13px]">
                        <span className={`font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                          {selectedEmployee.role.replace("_", " ")}
                        </span>
                        <span className="text-[#8E8E93]">&middot;</span>
                        <span className="text-[#8E8E93] tracking-tight">Joined {fmtDate(selectedEmployee.created_at)}</span>
                        <span className="text-[#8E8E93]">&middot;</span>
                        <span className="font-medium tracking-tight text-[#34C759] flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" /> Active
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className={`text-[13px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                      Organization-wide aggregate metrics
                    </span>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Right: Picker */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="relative">
              {/* Trigger Button */}
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                className={`flex items-center justify-between gap-2 pl-4 pr-3 py-1.5 min-w-[180px] rounded-full text-[13px] font-medium tracking-tight outline-none cursor-pointer transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${isDark
                  ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white border border-white/5"
                  : "bg-white hover:bg-gray-50 text-black border border-black/5"
                  }`}
              >
                <span className="truncate max-w-[140px]">
                  {employeeId === "all"
                    ? "All Employees"
                    : data.employees.find(e => e.id === employeeId)?.name || "Select"}
                </span>
                <MdKeyboardArrowDown className={`w-4 h-4 transition-transform duration-300 flex-shrink-0 ${isDropdownOpen ? "rotate-180" : ""} ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
              </button>

              {/* Floating Menu Popover */}
              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                    animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className={`absolute right-0 top-[calc(100%+6px)] w-[220px] p-1.5 rounded-[16px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] z-50 backdrop-blur-2xl ${isDark
                      ? "bg-[#1C1C1E]/80 border border-white/10"
                      : "bg-white/85 border border-black/5"
                      }`}
                  >
                    <div className="max-h-[250px] overflow-y-auto custom-scrollbar">
                      <div
                        onClick={() => { setEmployeeId("all"); setIsDropdownOpen(false); }}
                        className={`px-3 py-2 text-[13px] font-medium tracking-tight rounded-[10px] cursor-pointer transition-colors flex items-center justify-between group ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"}`}
                      >
                        <span className={employeeId === "all" ? (isDark ? "text-white" : "text-black") : ""}>All Employees</span>
                        {employeeId === "all" && <MdCheck className={`w-3.5 h-3.5 ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />}
                      </div>

                      <div className={`h-[1px] w-[calc(100%-24px)] mx-auto my-1 ${isDark ? "bg-white/10" : "bg-black/5"}`} />

                      {data.employees.map((e) => (
                        <div
                          key={e.id}
                          onClick={() => { setEmployeeId(e.id); setIsDropdownOpen(false); }}
                          className={`px-3 py-2 text-[13px] font-medium tracking-tight rounded-[10px] cursor-pointer transition-colors flex items-center justify-between mt-0.5 ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"}`}
                        >
                          <span className={employeeId === e.id ? (isDark ? "text-white" : "text-black") : ""}>{e.name}</span>
                          {employeeId === e.id && <MdCheck className={`w-3.5 h-3.5 ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Scrollable Content ═══ */}
      <div className={`flex-1 overflow-y-auto px-6 sm:px-10 py-8 custom-scrollbar`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
          className="space-y-8 max-w-[1400px] mx-auto"
        >

          {/* ── Summary Cards (iOS Widget Style) ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5">
            <SummaryCard
              Icon={MdPeople}
              colorConfig={iosColors.blue}
              title="Total Leads"
              value={data.totalLeads}
              isDark={isDark}
            />
            <SummaryCard
              Icon={MdPhone}
              colorConfig={iosColors.green}
              title="Contacted"
              value={data.contacted[contactedPeriod] ?? 0}
              isDark={isDark}
              periodValue={contactedPeriod}
              setPeriodValue={setContactedPeriod}
              periods={CONTACTED_PERIODS}
            />
            <SummaryCard
              Icon={MdPlaylistAddCheck}
              colorConfig={iosColors.red}
              title="Followups"
              value={data.followups[followupPeriod] ?? 0}
              isDark={isDark}
              periodValue={followupPeriod}
              setPeriodValue={setFollowupPeriod}
              periods={FOLLOWUP_PERIODS}
            />
            <SummaryCard
              Icon={MdCalendarToday}
              colorConfig={iosColors.orange}
              title="Site Visits"
              value={data.siteVisits[siteVisitPeriod] ?? 0}
              isDark={isDark}
              periodValue={siteVisitPeriod}
              setPeriodValue={setSiteVisitPeriod}
              periods={SITE_VISIT_PERIODS}
            />
            <SummaryCard
              Icon={MdFlag}
              colorConfig={iosColors.purple}
              title="Bookings"
              value={data.bookings[bookingPeriod] ?? 0}
              isDark={isDark}
              periodValue={bookingPeriod}
              setPeriodValue={setBookingPeriod}
              periods={BOOKING_PERIODS}
            />
          </div>

          {/* ── Breakdown Panels (iOS Grouped List Style) ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 sm:gap-8">
            <BreakdownPanel
              Icon={MdPhone}
              colorConfig={iosColors.green}
              title="Contacts Breakdown"
              values={data.contacted}
              rows={CONTACTED_BREAKDOWN}
              isDark={isDark}
            />
            <BreakdownPanel
              Icon={MdPlaylistAddCheck}
              colorConfig={iosColors.red}
              title="Followups Breakdown"
              values={data.followups}
              rows={FOLLOWUP_BREAKDOWN}
              isDark={isDark}
            />
            <BreakdownPanel
              Icon={MdCalendarToday}
              colorConfig={iosColors.orange}
              title="Site Visits Breakdown"
              values={data.siteVisits}
              rows={SITE_VISIT_BREAKDOWN}
              isDark={isDark}
            />
            <BreakdownPanel
              Icon={MdFlag}
              colorConfig={iosColors.purple}
              title="Bookings Breakdown"
              values={data.bookings}
              rows={BOOKING_BREAKDOWN}
              isDark={isDark}
            />
          </div>

          {/* ── Info Note ── */}
          <div className={`mt-8 flex items-start gap-3 rounded-2xl p-4 ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)]"}`}>
            <MdInfoOutline className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />
            <p className={`text-[15px] leading-relaxed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              Contacts are counted when a manual call is made from the CRM. Followups are counted when marked as done. Site visit and booking data syncs continuously from external records.
            </p>
          </div>

        </motion.div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  Icon,
  colorConfig,
  title,
  value,
  isDark,
  periodValue,
  setPeriodValue,
  periods
}: {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  colorConfig: { light: string; dark: string; bgLight: string; bgDark: string };
  title: string;
  value: number;
  isDark: boolean;
  periodValue?: string;
  setPeriodValue?: (val: string) => void;
  periods?: { value: string; label: string }[];
}) {
  const accentColor = isDark ? colorConfig.dark : colorConfig.light;
  const iconBg = isDark ? colorConfig.bgDark : colorConfig.bgLight;
  const [isOpen, setIsOpen] = useState(false); // <-- ADDED THIS



  return (
    <div
      className={`relative flex flex-col justify-between rounded-[20px] sm:rounded-[24px] p-4 sm:p-5 h-[120px] sm:h-[140px] md:h-[160px] transition-transform duration-300 hover:scale-[1.02] ${isDark
        ? "bg-[#1C1C1E] shadow-sm border border-white/5"
        : "bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-black/5"
        }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-[10px] sm:rounded-[12px] flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: iconBg }}
        >
          <Icon className="text-[16px] sm:text-[20px]" style={{ color: accentColor }} />
        </div>

        {periods && setPeriodValue && periodValue && (
          <div className="relative">
            {/* Trigger Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              onBlur={() => setTimeout(() => setIsOpen(false), 200)}
              className={`flex items-center justify-between gap-1 sm:gap-1.5 pl-2.5 sm:pl-3 pr-1.5 sm:pr-2 py-1 rounded-full text-[10px] sm:text-[11px] font-semibold tracking-wide outline-none cursor-pointer transition-colors ${isDark
                ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]"
                : "bg-[#F2F2F7] text-black hover:bg-[#E5E5EA]"
                }`}
            >
              <span className="truncate max-w-[60px] sm:max-w-[80px]">
                {periods.find((p) => p.value === periodValue)?.label || "Select"}
              </span>
              <MdKeyboardArrowDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform duration-300 flex-shrink-0 ${isOpen ? "rotate-180" : ""} ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </button>

            {/* Floating Menu Popover */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className={`absolute right-0 top-[calc(100%+6px)] w-[140px] sm:w-[160px] p-1.5 rounded-[14px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-50 backdrop-blur-2xl ${isDark
                    ? "bg-[#1C1C1E]/85 border border-white/10"
                    : "bg-white/90 border border-black/5"
                    }`}
                >
                  <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                    {periods.map((p, i) => (
                      <div key={p.value}>
                        <div
                          onClick={() => { setPeriodValue(p.value); setIsOpen(false); }}
                          className={`px-3 py-2 text-[11px] sm:text-[12px] font-medium tracking-tight rounded-[8px] cursor-pointer transition-colors flex items-center justify-between group ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"
                            }`}
                        >
                          <span className={periodValue === p.value ? (isDark ? "text-white" : "text-black") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]")}>
                            {p.label}
                          </span>
                          {periodValue === p.value && <MdCheck className={`w-3.5 h-3.5 ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />}
                        </div>
                        {/* iOS Style Divider between items */}
                        {i < periods.length - 1 && (
                          <div className={`h-[1px] w-[calc(100%-16px)] mx-auto my-0.5 ${isDark ? "bg-white/10" : "bg-black/5"}`} />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="mt-auto">
        <motion.p
          key={value}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.3 }}
          className={`text-[24px] sm:text-[28px] md:text-[34px] font-bold tracking-tight sm:tracking-[-0.04em] leading-none mb-1 sm:mb-1.5 ${isDark ? "text-white" : "text-black"}`}
        >
          {fmtNum(value)}
        </motion.p>
        <span className={`text-[10px] sm:text-[11px] md:text-[13px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
          {title}
        </span>
      </div>
    </div>
  );
}

function BreakdownPanel({
  Icon,
  colorConfig,
  title,
  values,
  rows,
  isDark,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  colorConfig: { light: string; dark: string; bgLight: string; bgDark: string };
  title: string;
  values: Record<string, number>;
  rows: { key: string; label: string }[];
  isDark: boolean;
}) {
  const accentColor = isDark ? colorConfig.dark : colorConfig.light;

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className={`text-[13px] font-semibold uppercase tracking-wider pl-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
        {title}
      </h3>
      <div
        className={`rounded-[20px] overflow-hidden ${isDark
          ? "bg-[#1C1C1E] shadow-sm"
          : "bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
          }`}
      >
        <div className="px-5">
          {rows.map((row, i) => (
            <div
              key={row.key}
              className={`flex items-center justify-between py-3.5 ${i < rows.length - 1
                ? `border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`
                : ""
                }`}
            >
              <span className={`text-[15px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                {row.label}
              </span>
              <motion.span
                key={values[row.key]}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`text-[15px] font-semibold ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}
              >
                {fmtNum(values[row.key] ?? 0)}
              </motion.span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}