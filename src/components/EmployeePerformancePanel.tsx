"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MdPeople,
  MdPhone,
  MdPlaylistAddCheck,
  MdCalendarToday,
  MdFlag,
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
  { key: "today", label: "Contacted Today" },
  { key: "thisWeek", label: "Contacted This Week" },
  { key: "thisMonth", label: "Contacted This Month" },
  { key: "last3Months", label: "Contacted in Last 3 Months" },
  { key: "last6Months", label: "Contacted in Last 6 Months" },
];

const FOLLOWUP_BREAKDOWN = [
  { key: "today", label: "Followups Today" },
  { key: "thisWeek", label: "Followups This Week" },
  { key: "thisMonth", label: "Followups This Month" },
];

const SITE_VISIT_BREAKDOWN = [
  { key: "today", label: "Site Visits Today" },
  { key: "thisWeek", label: "Site Visits This Week" },
  { key: "thisMonth", label: "Site Visits This Month" },
];

const BOOKING_BREAKDOWN = [
  { key: "today", label: "Bookings Today" },
  { key: "thisWeek", label: "Bookings This Week" },
  { key: "thisMonth", label: "Bookings This Month" },
  { key: "last3Months", label: "Bookings Last 3 Months" },
  { key: "last6Months", label: "Bookings Last 6 Months" },
  { key: "last12Months", label: "Bookings Last 12 Months" },
  { key: "tillNow", label: "Total Bookings (Till Now)" },
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
      <div className={`h-full flex items-center justify-center ${theme.textMuted}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
          <p className="text-sm">Loading performance data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`h-full flex items-center justify-center ${theme.textMuted}`}>
        <p>Failed to load performance data.</p>
      </div>
    );
  }

  const selectedEmployee =
    employeeId !== "all"
      ? data.employees.find((e) => e.id === employeeId) || null
      : null;

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const selectCls = `text-[11px] font-bold border rounded-md px-1.5 py-0.5 cursor-pointer appearance-none ${isDark
    ? "bg-[#1a1a2e] border-[#333] text-white/70"
    : "bg-gray-50 border-gray-200 text-gray-600"
    }`;

  // ── Render ──

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ═══ Header ═══ */}
      <div
        className={`p-2 sm:p-6 border-b flex-shrink-0 ${theme.header}`}
        style={theme.headerGlass}
      >
        {/* Title */}
        {/* <div className="mb-4">
          <h2 className={`text-lg font-bold flex items-center gap-2 ${theme.text}`}>
            Employee Performance
          </h2>
          <p className={`text-xs mt-1 ${theme.textFaint}`}>
            Track individual performance and key activities across leads,
            followups, site visits and bookings.
          </p>
        </div> */}

        {/* Employee selector row */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Dropdown */}
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${isDark
                ? "bg-[#9E217B]/20 text-[#d946a8]"
                : "bg-[#9E217B]/10 text-[#9E217B]"
                }`}
            >
              {selectedEmployee
                ? selectedEmployee.name.charAt(0).toUpperCase()
                : "A"}
            </div>
            <div>
              <label className={`crm-eyebrow block mb-0.5 ${theme.textFaint}`}>
                Select Employee
              </label>
              <select
                value={employeeId}
                onChange={(e) =>
                  setEmployeeId(
                    e.target.value === "all" ? "all" : Number(e.target.value),
                  )
                }
                className={`text-sm font-bold rounded-lg border px-3 py-1.5 cursor-pointer ${isDark
                  ? "bg-[#1a1a2e] border-[#333] text-white"
                  : "bg-white border-gray-200 text-gray-900"
                  }`}
              >
                <option value="all">All Employees</option>
                {data.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Employee info chips */}
          {selectedEmployee && (
            <div
              className={`flex items-center gap-5 text-xs ${theme.textMuted}`}
            >
              <div>
                <span className={`crm-eyebrow block ${theme.textFaint}`}>
                  Role
                </span>
                <p className={`font-bold ${theme.text}`}>
                  {selectedEmployee.role}
                </p>
              </div>
              <div>
                <span className={`crm-eyebrow block ${theme.textFaint}`}>
                  Joined
                </span>
                <p className={`font-bold ${theme.text}`}>
                  {fmtDate(selectedEmployee.created_at)}
                </p>
              </div>
              <div>
                <span className={`crm-eyebrow block ${theme.textFaint}`}>
                  Status
                </span>
                <p className="font-bold text-green-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Active
                </p>
              </div>
            </div>
          )}

          {/* Performance period */}
          <div className="ml-auto text-right hidden sm:block">
            <p className={`crm-eyebrow ${theme.textFaint}`}>
              Performance Period
            </p>
            <p className={`text-xs font-bold mt-0.5 ${theme.text}`}>
              1 Jan {new Date().getFullYear()} &mdash; {today}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ Content ═══ */}
      <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${theme.scroll}`}>
        <div className="space-y-5">
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Total Leads */}
            <SummaryCard
              Icon={MdPeople}
              accentBg={isDark ? "bg-blue-500/15" : "bg-blue-50"}
              accentColor="text-blue-500"
              title="Total Leads"
              value={data.totalLeads}
              subtitle={
                selectedEmployee
                  ? "Leads assigned to this employee"
                  : "Leads assigned to employees"
              }
              theme={theme}
              isDark={isDark}
            />

            {/* Leads Contacted */}
            <SummaryCard
              Icon={MdPhone}
              accentBg={isDark ? "bg-green-500/15" : "bg-green-50"}
              accentColor="text-green-500"
              title="Leads Contacted"
              value={data.contacted[contactedPeriod] ?? 0}
              subtitle="Leads contacted via manual calls"
              theme={theme}
              isDark={isDark}
              periodDropdown={
                <select
                  value={contactedPeriod}
                  onChange={(e) => setContactedPeriod(e.target.value)}
                  className={selectCls}
                >
                  {CONTACTED_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              }
            />

            {/* Followups Done */}
            <SummaryCard
              Icon={MdPlaylistAddCheck}
              accentBg={isDark ? "bg-rose-500/15" : "bg-rose-50"}
              accentColor="text-rose-500"
              title="Followups Done"
              value={data.followups[followupPeriod] ?? 0}
              subtitle="Total followups completed"
              theme={theme}
              isDark={isDark}
              periodDropdown={
                <select
                  value={followupPeriod}
                  onChange={(e) => setFollowupPeriod(e.target.value)}
                  className={selectCls}
                >
                  {FOLLOWUP_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              }
            />

            {/* Site Visits Scheduled */}
            <SummaryCard
              Icon={MdCalendarToday}
              accentBg={isDark ? "bg-teal-500/15" : "bg-teal-50"}
              accentColor="text-teal-500"
              title="Site Visits Scheduled"
              value={data.siteVisits[siteVisitPeriod] ?? 0}
              subtitle="Site visits scheduled for leads"
              theme={theme}
              isDark={isDark}
              periodDropdown={
                <select
                  value={siteVisitPeriod}
                  onChange={(e) => setSiteVisitPeriod(e.target.value)}
                  className={selectCls}
                >
                  {SITE_VISIT_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              }
            />

            {/* Bookings Done */}
            <SummaryCard
              Icon={MdFlag}
              accentBg={isDark ? "bg-orange-500/15" : "bg-orange-50"}
              accentColor="text-orange-500"
              title="Bookings Done"
              value={data.bookings[bookingPeriod] ?? 0}
              subtitle="Confirmed bookings"
              theme={theme}
              isDark={isDark}
              periodDropdown={
                <select
                  value={bookingPeriod}
                  onChange={(e) => setBookingPeriod(e.target.value)}
                  className={selectCls}
                >
                  {BOOKING_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              }
            />
          </div>

          {/* ── Breakdown panels ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <BreakdownPanel
              Icon={MdPhone}
              accentColor="text-green-500"
              title="Leads Contacted"
              values={data.contacted}
              rows={CONTACTED_BREAKDOWN}
              theme={theme}
              isDark={isDark}
            />
            <BreakdownPanel
              Icon={MdPlaylistAddCheck}
              accentColor="text-rose-500"
              title="Followups Done"
              values={data.followups}
              rows={FOLLOWUP_BREAKDOWN}
              theme={theme}
              isDark={isDark}
            />
            <BreakdownPanel
              Icon={MdCalendarToday}
              accentColor="text-teal-500"
              title="Site Visits Scheduled"
              values={data.siteVisits}
              rows={SITE_VISIT_BREAKDOWN}
              theme={theme}
              isDark={isDark}
            />
            <BreakdownPanel
              Icon={MdFlag}
              accentColor="text-orange-500"
              title="Bookings Done"
              values={data.bookings}
              rows={BOOKING_BREAKDOWN}
              theme={theme}
              isDark={isDark}
            />
          </div>

          {/* ── Note ── */}
          <div
            className={`flex items-start gap-2.5 rounded-xl p-3.5 text-xs ${isDark
              ? "bg-blue-500/5 border border-blue-500/10"
              : "bg-blue-50 border border-blue-100"
              }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isDark
                ? "bg-blue-500/20 text-blue-400"
                : "bg-blue-100 text-blue-600"
                }`}
            >
              i
            </span>
            <p className={theme.textMuted}>
              <strong>Note:</strong> Contacts are counted when a manual call is
              made from the CRM. Followups are counted when a followup is marked
              as done. Site visit and booking data is fetched from existing APIs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  Icon,
  accentBg,
  accentColor,
  title,
  value,
  subtitle,
  theme,
  isDark,
  periodDropdown,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  accentBg: string;
  accentColor: string;
  title: string;
  value: number;
  subtitle: string;
  theme: any;
  isDark: boolean;
  periodDropdown?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl p-4 border ${theme.card}`}
      style={theme.cardGlass}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${accentBg}`}
          >
            <Icon className={`text-[1.1rem] ${accentColor}`} />
          </div>
          <span className={`text-xs font-bold ${theme.text}`}>{title}</span>
        </div>
        <span className={`text-sm ${theme.textFaint}`}>&rsaquo;</span>
      </div>

      {/* Value */}
      <p className={`text-3xl font-black mb-1 ${theme.text}`}>
        {fmtNum(value)}
      </p>

      {/* Period dropdown */}
      {periodDropdown && <div className="mb-2">{periodDropdown}</div>}

      {/* Subtitle */}
      <p className={`text-[10px] leading-tight ${theme.textFaint}`}>
        {subtitle}
      </p>
    </div>
  );
}

function BreakdownPanel({
  Icon,
  accentColor,
  title,
  values,
  rows,
  theme,
  isDark,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  title: string;
  values: Record<string, number>;
  rows: { key: string; label: string }[];
  theme: any;
  isDark: boolean;
}) {
  return (
    <div
      className={`rounded-xl border overflow-hidden ${theme.card}`}
      style={theme.cardGlass}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${theme.tableBorder}`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`text-sm ${accentColor}`} />
          <span className={`text-sm font-bold ${theme.text}`}>{title}</span>
        </div>
        <span className={`text-sm ${theme.textFaint}`}>&rsaquo;</span>
      </div>

      {/* Rows */}
      <div className="px-4 py-1">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={`flex items-center justify-between py-2.5 ${i < rows.length - 1
              ? `border-b ${isDark ? "border-white/5" : "border-gray-100"}`
              : ""
              }`}
          >
            <span className={`text-xs ${theme.textMuted}`}>{row.label}</span>
            <span className={`text-sm font-bold tabular-nums ${theme.text}`}>
              {fmtNum(values[row.key] ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
