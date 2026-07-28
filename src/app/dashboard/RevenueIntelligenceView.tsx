"use client";

/* ══════════════════════════════════════════════════════════════════════════
   RevenueIntelligenceView.tsx — Bhoomi Dwellers CRM

   Reads from /api/revenue-intelligence, which returns buildRevenueAnalytics()
   output from lib/revenueCalculations.ts.

   Revenue is CASH BASIS: a receipt counts only once a date or confirming
   status exists. The Receipt Composition section breaks "Revenue Received"
   into the individual receipts behind it — token, booking amount, OCR, cash
   component, loan disbursement — and every figure drills through to the
   bookings that produced it.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BarChart3,
  BellRing,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  Landmark,
  Layers3,
  ReceiptText,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { Pencil } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  REVENUE_STAGES,
  RevenueStageId,
  addDays,
  formatRevenueAmount,
  isLastMonth,
  isSameDay,
  isThisMonth,
  isThisWeek,
  isWithinNextDays,
  parseRevenueAmount,
  recordReachesStage,
  toDate,
  toDateKey,
} from "@/lib/revenueCalculations";
import ReceiptComposition, {
  receiptLineAmount,
  receiptLineDate,
  receiptLineLabel,
  receiptLineUnconfirmed,
} from "./ReceiptComposition";
import {
  REVENUE_COMPONENTS,
  REVENUE_CONFIG_STORAGE_KEY,
  DEFAULT_REVENUE_CONFIG,
  RevenueConfig,
  calculateRevenueReceived,
  calculateBalanceReceivable,
  calculateCollectionEfficiency,
  describeRevenueConfig,
  isComponentSuppressed,
  isDefaultRevenueConfig,
  isRevenueComponentEnabled,
  normalizeRevenueConfig,
  sumAgreementValue,
  sumBalanceReceivable,
  sumGovernmentCharges,
  sumGrossCollection,
  sumRevenueReceived,
} from "@/lib/revenueFormula";
import {
  commissionBookingCount,
  commissionCostRatio,
  commissionGross,
  commissionNet,
  commissionTds,
  groupCommissionByPartner,
  hasCommission,
  isCommissionCommitted,
  isCommissionPaid,
  sumCommissionCommitted,
  sumCommissionNetPaid,
  sumCommissionPaid,
  sumCommissionTdsPaid,
  sumCommissionTotal,
} from "@/lib/cpPayout";

/* ═══════════════════════════ types ═══════════════════════════ */

type RevenueFilters = {
  project: string;
  building: string;
  wing: string;
  floor: string;
  sales_manager: string;
  bank: string;
  loan_status: string;
  registration_status: string;
  disbursement_status: string;
  date_from: string;
  date_to: string;
  revenue_min: string;
  revenue_max: string;
};

type RevenueIntelligenceViewProps = {
  isDark: boolean;
  theme: any;
};

type Tone = "magenta" | "cyan" | "emerald" | "amber" | "rose" | "violet" | "slate";
type PillTone = "success" | "warning" | "danger" | "info" | "muted";

/* ═══════════════════════════ constants ═══════════════════════════ */

const EMPTY_DATA: any = {
  records: [],
  summary: {
    total_agreement_value: 0,
    expected_revenue: 0,
    revenue_received: 0,
    unconfirmed_revenue: 0,
    government_charges_received: 0,
    gross_collection_received: 0,
    balance_receivable: 0,
    pending_revenue: 0,
    collection_efficiency: 0,
    overpaid_bookings: 0,
  },
  indicators: {
    booking: {},
    registration: {},
    loan_sanction: {},
    ocr: {},
    sdr: {},
    disbursement: {},
    cash_component: {},
    revenue_quality: {},
  },
  forecast: {},
  pipeline: [],
  sales_managers: [],
  delays: {},
  upcoming: {},
  projects: [],
  banks: [],
  alerts: [],
  filters: {},
  total: 0,
  updated_at: null,
};

const INITIAL_FILTERS: RevenueFilters = {
  project: "",
  building: "",
  wing: "",
  floor: "",
  sales_manager: "",
  bank: "",
  loan_status: "",
  registration_status: "",
  disbursement_status: "",
  date_from: "",
  date_to: "",
  revenue_min: "",
  revenue_max: "",
};

const FILTER_LABELS: Record<keyof RevenueFilters, string> = {
  project: "Project",
  building: "Building",
  wing: "Wing",
  floor: "Floor",
  sales_manager: "Manager",
  bank: "Bank",
  loan_status: "Loan",
  registration_status: "Registration",
  disbursement_status: "Disbursement",
  date_from: "From",
  date_to: "To",
  revenue_min: "Min",
  revenue_max: "Max",
};

const reportTypes = [
  { value: "revenue_summary", label: "Revenue Summary" },
  { value: "receipt_breakdown", label: "Receipt Breakdown" },
  { value: "loan_status", label: "Loan Status" },
  { value: "registration_report", label: "Registration Report" },
  { value: "disbursement_report", label: "Disbursement Report" },
  { value: "sales_manager_performance", label: "Sales Manager Performance" },
  { value: "project_revenue", label: "Project Revenue" },
  { value: "monthly_collection", label: "Monthly Collection Report" },
  { value: "cp_commission", label: "Channel Partner Commission" },
];

const FORECAST_WINDOWS = [
  { label: "7 Days", days: 7 },
  { label: "15 Days", days: 15 },
  { label: "30 Days", days: 30 },
  { label: "90 Days", days: 90 },
];

const GRAPH_VISIBILITY_KEY = "bhoomi_revenue_graph_visible";
const PAGE_SIZE = 12;

// Component registry, defaults and storage key now live in lib/revenueFormula.ts
// so the modal, KPIs, charts and exports all read one list. Adding a receipt type
// means editing REVENUE_COMPONENTS there and nothing in this file.

/* ═══════════════════════════ formatters ═══════════════════════════ */

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Indian compact notation — for chart axes and tight cards only. */
function formatCompactAmount(value: unknown) {
  const amount = parseRevenueAmount(value);
  const abs = Math.abs(amount);
  const trim = (n: number, digits: number) =>
    n.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  if (abs >= 10_000_000) return `₹${trim(amount / 10_000_000, 2)} Cr`;
  if (abs >= 100_000) return `₹${trim(amount / 100_000, 2)} L`;
  if (abs >= 1_000) return `₹${trim(amount / 1_000, 1)} K`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatMonthLabel(key: string) {
  if (!key || key === "Unscheduled") return key;
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function flatLabel(record: any) {
  return (
    [record.wing, record.floor || record.floor_number, record.flat_number].filter(Boolean).join(" / ") || "—"
  );
}

function monthKey(value: unknown) {
  const date = toDate(value);
  if (!date) return "Unscheduled";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/* ═══════════════════════════ style helpers ═══════════════════════════ */

function statusPillClass(isDark: boolean, tone: PillTone) {
  const tones: Record<PillTone, string> = {
    success: isDark ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: isDark ? "bg-amber-500/10 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200",
    danger: isDark ? "bg-rose-500/10 text-rose-300 border-rose-500/30" : "bg-rose-50 text-rose-700 border-rose-200",
    info: isDark ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" : "bg-cyan-50 text-cyan-700 border-cyan-200",
    muted: isDark ? "bg-white/5 text-gray-300 border-white/10" : "bg-slate-50 text-slate-600 border-slate-200",
  };
  return tones[tone];
}

function cardTone(tone: string, isDark: boolean) {
  const tones: Record<string, string> = {
    magenta: isDark ? "border-[#9E217B]/40 bg-[#9E217B]/10" : "border-[#9E217B]/25 bg-[#9E217B]/5",
    cyan: isDark ? "border-cyan-500/30 bg-cyan-500/10" : "border-cyan-200 bg-cyan-50/70",
    emerald: isDark ? "border-emerald-500/30 bg-emerald-500/10" : "border-emerald-200 bg-emerald-50/70",
    amber: isDark ? "border-amber-500/30 bg-amber-500/10" : "border-amber-200 bg-amber-50/70",
    rose: isDark ? "border-rose-500/30 bg-rose-500/10" : "border-rose-200 bg-rose-50/70",
    violet: isDark ? "border-violet-500/30 bg-violet-500/10" : "border-violet-200 bg-violet-50/70",
    slate: isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-white",
  };
  return tones[tone] || tones.slate;
}

const TONE_ACCENT: Record<Tone, string> = {
  magenta: "#9E217B",
  cyan: "#06b6d4",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  slate: "#64748b",
};

/* ═══════════════════════════ shared primitives ═══════════════════════════ */

function SectionHeader({
  icon: Icon,
  title,
  theme,
  children,
}: {
  icon: any;
  title: string;
  theme: any;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <Icon className="w-[18px] h-[18px] text-[#9E217B]" />
        <h2 className={`text-[13px] font-black uppercase tracking-[0.08em] ${theme.text}`}>{title}</h2>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

function KpiCard({
  label, value, sub, icon: Icon, tone, active, onClick, theme, isDark, emphasis, onEdit,
}: {
  label: string;
  value: string;
  sub: string;
  icon: any;
  tone: Tone;
  active: boolean;
  onClick: () => void;
  theme: any;
  isDark: boolean;
  emphasis?: PillTone;
  onEdit?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      title={`${label} — click to list the bookings behind this figure`}
      className={`
        group relative text-left rounded-2xl border p-4 min-h-[124px] flex flex-col justify-between
        transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent
        ${cardTone(tone, isDark)}
        ${active ? "ring-2 ring-offset-2 ring-offset-transparent shadow-lg" : ""}
      `}
      style={{
        ...(theme.cardGlass || {}),
        ...(active ? ({ "--tw-ring-color": TONE_ACCENT[tone] } as React.CSSProperties) : {}),
      }}
    >
      {/* One header row. This previously rendered twice — an unstyled icon plus
          the pencil, then the styled icon plus a second "Attention" pill. */}
      <div className="flex items-start justify-between gap-2">
        <span
          className="w-9 h-9 rounded-xl border inline-flex items-center justify-center flex-shrink-0"
          style={{
            borderColor: `${TONE_ACCENT[tone]}44`,
            background: `${TONE_ACCENT[tone]}14`,
            color: TONE_ACCENT[tone],
          }}
        >
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <div className="flex items-center gap-1.5">
          {onEdit && (
            // Nested inside the card <button>, so it must be a span with a click
            // handler that stops propagation — a real <button> would be invalid
            // HTML here, and without stopPropagation the pencil would also fire
            // the card's drill-down.
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onEdit(); } }}
              title="Customize what counts as Revenue Received"
              aria-label="Customize Revenue Received"
              className={`w-6 h-6 rounded-md border inline-flex items-center justify-center transition-colors ${isDark ? "border-white/10 hover:bg-white/10 text-gray-300" : "border-slate-200 hover:bg-slate-100 text-slate-500"
                }`}
            >
              <Pencil className="w-3 h-3" />
            </span>
          )}
          {emphasis && (
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${statusPillClass(isDark, emphasis)}`}>
              Attention
            </span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <p className={`text-[10px] font-black uppercase tracking-[0.07em] ${theme.textMuted}`}>{label}</p>
        <p className={`text-xl xl:text-2xl font-black mt-1 tabular-nums break-words leading-tight ${theme.text}`}>
          {value}
        </p>
        <p className={`text-[10px] mt-1.5 leading-snug ${theme.textMuted}`}>{sub}</p>
      </div>

      <span
        className={`absolute bottom-0 left-4 right-4 h-[2px] rounded-full transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"
          }`}
        style={{ background: TONE_ACCENT[tone] }}
      />
    </button>
  );
}

/* ═══════════════════════════ export rows ═══════════════════════════ */

function makeCsv(rows: Record<string, any>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: any) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))].join("\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// `config` is required rather than defaulted: an export that silently fell back
// to the default formula would disagree with the dashboard it was exported from.
function getReportRows(reportType: string, data: any, records: any[], config: RevenueConfig) {
  if (reportType === "sales_manager_performance") {
    return (data.sales_managers || []).map((row: any) => ({
      "Sales Manager": row.name,
      Bookings: row.bookings,
      "Agreement Value": formatRevenueAmount(row.agreement_value),
      "Revenue Received": formatRevenueAmount(row.revenue_received),
      Pending: formatRevenueAmount(row.pending),
    }));
  }

  if (reportType === "project_revenue") {
    return (data.projects || []).map((row: any) => ({
      Project: row.name,
      "Total Flats": row.total_flats,
      Booked: row.booked,
      Available: row.available,
      "Registration Pending": row.registration_pending,
      "Disbursement Pending": row.disbursement_pending,
      "Revenue Generated": formatRevenueAmount(row.revenue_generated),
    }));
  }

  if (reportType === "monthly_collection") {
    const months = records.reduce<Record<string, any>>((acc, record) => {
      const key = monthKey(record.expected_disbursement_date || record.actual_disbursement_date);
      if (!acc[key]) acc[key] = { Month: key, "Expected Revenue": 0, "Revenue Received": 0, Pending: 0, Bookings: 0 };
      acc[key]["Expected Revenue"] += record.expected_revenue || 0;
      acc[key]["Revenue Received"] += calculateRevenueReceived(record, config);
      acc[key].Pending += calculateBalanceReceivable(record, config);
      acc[key].Bookings += 1;
      return acc;
    }, {});
    return Object.values(months).map((row: any) => ({
      ...row,
      "Expected Revenue": formatRevenueAmount(row["Expected Revenue"]),
      "Revenue Received": formatRevenueAmount(row["Revenue Received"]),
      Pending: formatRevenueAmount(row.Pending),
    }));
  }

  // Commission spend per booking. Bookings without a commission are dropped —
  // an export of "what we paid partners" should not be padded with blank rows.
  if (reportType === "cp_commission") {
    return records.filter(hasCommission).map((record) => ({
      "Booking No": record.booking_number,
      Customer: record.customer_name,
      Flat: flatLabel(record),
      "Channel Partner": record.channel_partner_name || "—",
      "Agreement Value": formatRevenueAmount(record.agreement_value_number),
      "Revenue Received": formatRevenueAmount(calculateRevenueReceived(record, config)),
      "Commission (Gross)": formatRevenueAmount(commissionGross(record)),
      TDS: formatRevenueAmount(commissionTds(record)),
      "Net to Partner": formatRevenueAmount(commissionNet(record)),
      Status: record.cp_commission_status || "—",
      Source: record.cp_commission_source || "—",
      "Paid On": formatDate(record.cp_commission_paid_date),
    }));
  }

  // Per-receipt columns — answers "who paid how much, and when".
  if (reportType === "receipt_breakdown") {
    return records.map((record) => ({
      "Booking No": record.booking_number,
      Customer: record.customer_name,
      Flat: flatLabel(record),
      "Sales Manager": record.sales_manager || "—",
      "Agreement Value": formatRevenueAmount(record.agreement_value_number),
      Token: formatRevenueAmount(receiptLineAmount(record, "token_amount")),
      "Booking Amount": formatRevenueAmount(receiptLineAmount(record, "booking_amount")),
      "Booking Amount Received On": formatDate(receiptLineDate(record, "booking_amount")),
      OCR: formatRevenueAmount(receiptLineAmount(record, "ocr_amount")),
      "OCR Received On": formatDate(receiptLineDate(record, "ocr_amount")),
      "Cash Component": formatRevenueAmount(receiptLineAmount(record, "cash_component")),
      Disbursement: formatRevenueAmount(receiptLineAmount(record, "disbursement_amount")),
      "Disbursed On": formatDate(receiptLineDate(record, "disbursement_amount")),
      "Developer Revenue": formatRevenueAmount(calculateRevenueReceived(record, config)),
      Unconfirmed: formatRevenueAmount(record.unconfirmed_revenue || 0),
      "SDR (Govt)": formatRevenueAmount(receiptLineAmount(record, "sdr_amount")),
      "Balance Receivable": formatRevenueAmount(calculateBalanceReceivable(record, config)),
      Stage: record.derived_stage_label,
    }));
  }

  return records.map((record) => {
    const base = {
      "Booking No": record.booking_number,
      Customer: record.customer_name,
      Flat: flatLabel(record),
      Project: record.project || "—",
      "Sales Manager": record.sales_manager || "—",
      "Agreement Value": formatRevenueAmount(record.agreement_value_number),
      "Expected Revenue": formatRevenueAmount(record.expected_revenue),
      "Revenue Received": formatRevenueAmount(calculateRevenueReceived(record, config)),
      Unconfirmed: formatRevenueAmount(record.unconfirmed_revenue || 0),
      Pending: formatRevenueAmount(calculateBalanceReceivable(record, config)),
      Stage: record.derived_stage_label,
    };

    if (reportType === "loan_status") {
      return {
        ...base,
        Bank: record.bank_name || "—",
        "Loan Status": record.loan_status || "—",
        "Sanction Status": record.sanction_status || "—",
        "Sanction Date": formatDate(record.sanction_date),
        "Sanction Amount": formatRevenueAmount(record.sanction_amount),
        "Disbursed (Actual)": formatRevenueAmount(receiptLineAmount(record, "disbursement_amount")),
      };
    }

    if (reportType === "registration_report") {
      return {
        ...base,
        "Registration Status": record.registration_status || "—",
        "Expected Registration": formatDate(record.expected_registration_date),
        "Actual Registration": formatDate(record.actual_registration_date),
        "Delay Days": record.registration_delay_days,
      };
    }

    if (reportType === "disbursement_report") {
      return {
        ...base,
        "Disbursement Status": record.disbursement_status || "—",
        "Expected Disbursement": formatDate(record.expected_disbursement_date),
        "Actual Disbursement": formatDate(record.actual_disbursement_date),
        "Delay Days": record.disbursement_delay_days,
      };
    }

    return base;
  });
}

/** Least-squares linear regression → {slope, intercept}. */
function linearRegression(ys: number[]) {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - meanX) * (ys[i] - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = den ? num / den : 0;
  return { slope, intercept: meanY - slope * meanX };
}

/* ══════════════════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════════════════ */

export default function RevenueIntelligenceView({ isDark, theme }: RevenueIntelligenceViewProps) {

  // Persisted in localStorage rather than a table: this project has no
  // user_preferences table (only organization_settings, which is org-wide), and
  // the configuration is a per-viewer lens on the same underlying data, not a
  // shared setting. Swapping to a table later only changes these two effects.
  const [revenueComponents, setRevenueComponents] = useState<RevenueConfig>(DEFAULT_REVENUE_CONFIG);
  const [showRevenueEditor, setShowRevenueEditor] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(REVENUE_CONFIG_STORAGE_KEY) : null;
    if (!stored) return;
    try {
      // Normalized so a config saved before a component existed still resolves.
      setRevenueComponents(normalizeRevenueConfig(JSON.parse(stored)));
    } catch { /* corrupt value — fall back to defaults */ }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem(REVENUE_CONFIG_STORAGE_KEY, JSON.stringify(revenueComponents));
  }, [revenueComponents]);
  const [data, setData] = useState<any>(EMPTY_DATA);
  const [filters, setFilters] = useState<RevenueFilters>(INITIAL_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [activeSlice, setActiveSlice] = useState<{ key: string; label: string }>({
    key: "recent",
    label: "Recent Bookings",
  });
  const [sortMode, setSortMode] = useState("highest_revenue");
  const [reportType, setReportType] = useState(reportTypes[0].value);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showGraph, setShowGraph] = useState(true);
  const [forecastWindowDays, setForecastWindowDays] = useState(30);
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingPage, setBookingPage] = useState(1);
  const recordsRef = useRef<HTMLDivElement>(null);

  /* ── graph visibility persistence ── */
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(GRAPH_VISIBILITY_KEY) : null;
    if (stored !== null) setShowGraph(stored === "true");
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(GRAPH_VISIBILITY_KEY, String(showGraph));
  }, [showGraph]);

  /* ── data fetching ── */
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || "").trim()) params.set(key, String(value).trim());
    });
    return params.toString();
  }, [filters]);

  const activeFilterEntries = useMemo(
    () =>
      (Object.entries(filters) as Array<[keyof RevenueFilters, string]>).filter(([, value]) =>
        String(value || "").trim()
      ),
    [filters]
  );

  const fetchDashboard = useCallback(
    async (quiet = false) => {
      if (quiet) setIsRefreshing(true);
      else setIsLoading(true);
      setError("");

      try {
        const res = await fetch(`/api/revenue-intelligence${queryString ? `?${queryString}` : ""}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Revenue intelligence could not load.");
        setData(json.data || EMPTY_DATA);
      } catch (err: any) {
        setError(err.message || "Revenue intelligence could not load.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [queryString]
  );

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const timer = setInterval(() => fetchDashboard(true), 30_000);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  /* ── filter + slice handlers ── */
  const setFilter = (key: keyof RevenueFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setActiveSlice({ key: "recent", label: "Recent Bookings" });
  };

  const openSlice = useCallback((key: string, label: string) => {
    setActiveSlice({ key, label });
    setBookingSearch("");
    setBookingPage(1);
    window.requestAnimationFrame(() =>
      recordsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, []);

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setActiveSlice({ key: "recent", label: "Recent Bookings" });
  };

  /* ── slice resolution ── */
  const recordsForSlice = useMemo(() => {
    const now = new Date();
    const records = data.records || [];
    const [type, section, metric] = activeSlice.key.split(":");

    if (activeSlice.key === "recent") return records.slice(0, 30);
    if (activeSlice.key === "total_agreement") return records;
    if (activeSlice.key === "expected_month")
      return records.filter((r: any) => isThisMonth(r.expected_disbursement_date, now));
    // Both respect the configured formula: with Token disabled, a booking whose
    // only receipt is a token no longer counts as "received".
    if (activeSlice.key === "received_month")
      return records.filter((r: any) => calculateRevenueReceived(r, revenueComponents) > 0);
    if (activeSlice.key === "pending_month")
      return records.filter((r: any) => calculateBalanceReceivable(r, revenueComponents) > 0);
    if (activeSlice.key === "collection_efficiency") return records;
    if (activeSlice.key === "cp_payout")
      return records.filter(hasCommission).sort((a: any, b: any) => commissionGross(b) - commissionGross(a));
    if (activeSlice.key === "cp_payout_paid")
      return records.filter(isCommissionPaid).sort((a: any, b: any) => commissionGross(b) - commissionGross(a));
    if (activeSlice.key === "cp_payout_committed")
      return records.filter(isCommissionCommitted).sort((a: any, b: any) => commissionGross(b) - commissionGross(a));
    if (activeSlice.key.startsWith("cp_partner:")) {
      const partner = activeSlice.key.slice("cp_partner:".length);
      return records.filter((r: any) => hasCommission(r) && String(r.channel_partner_name || "Unattributed") === partner);
    }
    if (activeSlice.key === "unconfirmed")
      return records
        .filter((r: any) => (r.unconfirmed_revenue || 0) > 0)
        .sort((a: any, b: any) => (b.unconfirmed_revenue || 0) - (a.unconfirmed_revenue || 0));

    // Receipt drill-through: one line item across all bookings, biggest first.
    if (activeSlice.key.startsWith("receipt_unconfirmed:")) {
      const key = activeSlice.key.slice("receipt_unconfirmed:".length);
      return records
        .filter((r: any) => receiptLineUnconfirmed(r, key) > 0)
        .sort((a: any, b: any) => receiptLineUnconfirmed(b, key) - receiptLineUnconfirmed(a, key));
    }
    if (activeSlice.key.startsWith("receipt:")) {
      const key = activeSlice.key.slice("receipt:".length);
      return records
        .filter((r: any) => receiptLineAmount(r, key) > 0)
        .sort((a: any, b: any) => receiptLineAmount(b, key) - receiptLineAmount(a, key));
    }

    if (activeSlice.key.startsWith("forecast:")) {
      const days = Number(activeSlice.key.split(":")[1]);
      return records.filter(
        (r: any) => !r.actual_disbursement_date && isWithinNextDays(r.expected_disbursement_date, days, now)
      );
    }
    if (activeSlice.key.startsWith("stage:")) {
      const stage = activeSlice.key.split(":")[1] as RevenueStageId;
      return records.filter((r: any) => recordReachesStage(r, stage));
    }
    if (activeSlice.key.startsWith("manager:")) {
      const manager = activeSlice.key.slice("manager:".length);
      return records.filter((r: any) => String(r.sales_manager || "Unassigned") === manager);
    }
    if (activeSlice.key.startsWith("project:")) {
      const project = activeSlice.key.slice("project:".length);
      return records.filter((r: any) => String(r.project || "Unassigned") === project);
    }
    if (activeSlice.key.startsWith("bank:")) {
      const bank = activeSlice.key.slice("bank:".length);
      return records.filter((r: any) => String(r.bank_name || "") === bank);
    }
    if (activeSlice.key.startsWith("alert:")) {
      const id = activeSlice.key.slice("alert:".length);
      return records.filter((r: any) => String(r.booking_id) === id);
    }
    if (activeSlice.key.startsWith("upcoming:")) {
      const key = activeSlice.key.slice("upcoming:".length);
      return data.upcoming?.[key] || [];
    }
    if (activeSlice.key.startsWith("delay:")) {
      const key = activeSlice.key.slice("delay:".length);
      return records
        .filter((r: any) => Number(r[`${key}_delay_days`]) > 0)
        .sort((a: any, b: any) => Number(b[`${key}_delay_days`]) - Number(a[`${key}_delay_days`]));
    }

    if (type === "indicator") {
      const bookingDate = (r: any) => r.booking_date || r.created_at;
      if (section === "booking" && metric === "today") return records.filter((r: any) => isSameDay(bookingDate(r), now));
      if (section === "booking" && metric === "this_week") return records.filter((r: any) => isThisWeek(bookingDate(r), now));
      if (section === "booking" && metric === "this_month") return records.filter((r: any) => isThisMonth(bookingDate(r), now));
      if (section === "booking" && metric === "last_month") return records.filter((r: any) => isLastMonth(bookingDate(r), now));

      if (section === "registration" && metric === "due_this_week")
        return records.filter((r: any) => !r.actual_registration_date && isThisWeek(r.expected_registration_date, now));
      if (section === "registration" && metric === "completed_this_week")
        return records.filter((r: any) => isThisWeek(r.actual_registration_date, now));
      if (section === "registration" && metric === "pending")
        return records.filter((r: any) => !r.actual_registration_date);
      if (section === "registration" && metric === "delayed")
        return records.filter((r: any) => !r.actual_registration_date && r.registration_delay_days > 0);

      if (section === "loan_sanction" && metric === "pending")
        return records.filter(
          (r: any) => recordReachesStage(r, "loan_applied") && !recordReachesStage(r, "loan_sanctioned")
        );
      if (section === "loan_sanction" && metric === "approved")
        return records.filter((r: any) => recordReachesStage(r, "loan_sanctioned"));
      if (section === "loan_sanction" && metric === "rejected")
        return records.filter((r: any) =>
          String(r.loan_status || r.sanction_status || "").toLowerCase().includes("reject")
        );
      if (section === "loan_sanction" && metric === "processing")
        return records.filter((r: any) => String(r.loan_status || "").toLowerCase().includes("process"));

      if (section === "ocr" && metric === "pending")
        return records.filter((r: any) => !recordReachesStage(r, "ocr_completed"));
      if (section === "ocr" && metric === "received")
        return records.filter((r: any) => recordReachesStage(r, "ocr_completed"));
      if (section === "ocr" && metric === "this_week")
        return records.filter((r: any) => isThisWeek(r.ocr_received_date, now));
      if (section === "ocr" && metric === "this_month")
        return records.filter((r: any) => isThisMonth(r.ocr_received_date, now));

      if (section === "sdr" && metric === "pending")
        return records.filter((r: any) => !recordReachesStage(r, "sdr_paid"));
      if (section === "sdr" && metric === "completed")
        return records.filter((r: any) => recordReachesStage(r, "sdr_paid"));
      if (section === "sdr" && metric === "due_this_week")
        return records.filter((r: any) => !recordReachesStage(r, "sdr_paid") && isThisWeek(r.sdr_due_date, now));

      if (section === "disbursement" && metric === "due_this_week")
        return records.filter((r: any) => !r.actual_disbursement_date && isThisWeek(r.expected_disbursement_date, now));
      if (section === "disbursement" && metric === "due_this_month")
        return records.filter((r: any) => !r.actual_disbursement_date && isThisMonth(r.expected_disbursement_date, now));
      if (section === "disbursement" && metric === "received")
        return records.filter((r: any) => recordReachesStage(r, "disbursement"));
      if (section === "disbursement" && metric === "delayed")
        return records.filter((r: any) => !r.actual_disbursement_date && r.disbursement_delay_days > 0);

      if (section === "cash_component")
        return records.filter(
          (r: any) =>
            parseRevenueAmount(r.cash_component) > 0 &&
            (metric === "received" ? !!r.cash_component_date : !r.cash_component_date)
        );

      if (section === "revenue_quality" && metric === "bookings_with_unconfirmed_amounts")
        return records.filter((r: any) => r.has_unconfirmed_amounts);
      if (section === "revenue_quality" && metric === "overpaid_bookings")
        return records.filter((r: any) => r.is_overpaid);
      if (section === "revenue_quality" && metric === "bookings_with_ledger_drift")
        return records.filter((r: any) => Math.abs(r.ledger_drift || 0) > 1);
    }

    return records.slice(0, 30);
  }, [activeSlice, data, revenueComponents]);

  /* ── which receipt column to append to the table, if any ── */
  const activeReceiptKey = activeSlice.key.startsWith("receipt:")
    ? activeSlice.key.slice("receipt:".length)
    : activeSlice.key.startsWith("receipt_unconfirmed:")
      ? activeSlice.key.slice("receipt_unconfirmed:".length)
      : null;
  const isUnconfirmedSlice = activeSlice.key.startsWith("receipt_unconfirmed:");

  /* ── search + pagination (frontend only) ── */
  const filteredSliceRecords = useMemo(() => {
    const term = bookingSearch.trim().toLowerCase();
    if (!term) return recordsForSlice;
    return recordsForSlice.filter((record: any) => {
      const haystack = `${record.booking_number || ""} ${record.customer_name || ""} ${record.sales_manager || ""
        } ${flatLabel(record)} ${record.project || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [recordsForSlice, bookingSearch]);

  const totalBookingPages = Math.max(1, Math.ceil(filteredSliceRecords.length / PAGE_SIZE));
  const pagedSliceRecords = useMemo(() => {
    const page = Math.min(bookingPage, totalBookingPages);
    const start = (page - 1) * PAGE_SIZE;
    return filteredSliceRecords.slice(start, start + PAGE_SIZE);
  }, [filteredSliceRecords, bookingPage, totalBookingPages]);

  /* ── column totals for the visible slice ── */
  const sliceTotals = useMemo(() => {
    const rows = filteredSliceRecords;
    return {
      agreement: sumAgreementValue(rows),
      received: sumRevenueReceived(rows, revenueComponents),
      pending: sumBalanceReceivable(rows, revenueComponents),
      receipt: activeReceiptKey
        ? rows.reduce(
          (s: number, r: any) =>
            s +
            (isUnconfirmedSlice
              ? receiptLineUnconfirmed(r, activeReceiptKey)
              : receiptLineAmount(r, activeReceiptKey)),
          0
        )
        : 0,
    };
  }, [filteredSliceRecords, activeReceiptKey, isUnconfirmedSlice, revenueComponents]);
  /* ── configured aggregates ──────────────────────────────────────────────
     Every figure below is derived from the engine, so flipping a checkbox
     recalculates the whole dashboard rather than just the one card. */
  const customRevenueReceived = useMemo(
    () => sumRevenueReceived(data.records || [], revenueComponents),
    [data.records, revenueComponents]
  );

  const customBalanceReceivable = useMemo(
    () => sumBalanceReceivable(data.records || [], revenueComponents),
    [data.records, revenueComponents]
  );

  const customCollectionEfficiency = useMemo(
    () => calculateCollectionEfficiency(data.records || [], revenueComponents),
    [data.records, revenueComponents]
  );

  const customGrossCollection = useMemo(
    () => sumGrossCollection(data.records || [], revenueComponents),
    [data.records, revenueComponents]
  );

  const revenueComponentsSub = useMemo(
    () => describeRevenueConfig(revenueComponents),
    [revenueComponents]
  );

  /* ── channel partner payout ─────────────────────────────────────────────
     A cost, not revenue — kept out of the Revenue Received formula on purpose.
     Cash basis like everything else: paid = spent, accrued/due = committed. */
  const cpPayout = useMemo(() => {
    const records = data.records || [];
    const paid = sumCommissionPaid(records);
    return {
      paid,
      committed: sumCommissionCommitted(records),
      total: sumCommissionTotal(records),
      netPaid: sumCommissionNetPaid(records),
      tdsPaid: sumCommissionTdsPaid(records),
      bookings: commissionBookingCount(records),
      ratio: commissionCostRatio(paid, customRevenueReceived),
      byPartner: groupCommissionByPartner(records),
    };
  }, [data.records, customRevenueReceived]);

  /* Manager and project revenue are recomputed here rather than taken from the
     server aggregates, which are summed with the fixed formula. Leaving them
     server-side would make these tables disagree with the KPI cards above them
     the moment a component is switched off. */
  const sortedManagers = useMemo(() => {
    const records = data.records || [];
    const grouped = new Map<string, any[]>();
    records.forEach((record: any) => {
      const name = String(record.sales_manager || "Unassigned");
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name)!.push(record);
    });

    const managers = Array.from(grouped.entries()).map(([name, rows]) => ({
      name,
      bookings: rows.length,
      agreement_value: sumAgreementValue(rows),
      revenue_received: sumRevenueReceived(rows, revenueComponents),
      pending: sumBalanceReceivable(rows, revenueComponents),
    }));

    if (sortMode === "highest_agreement") return managers.sort((a, b) => b.agreement_value - a.agreement_value);
    if (sortMode === "highest_bookings") return managers.sort((a, b) => b.bookings - a.bookings);
    return managers.sort((a, b) => b.revenue_received - a.revenue_received);
  }, [data.records, sortMode, revenueComponents]);

  // Keeps every server-derived project column (booked, pending counts) and
  // replaces only the revenue figure with the configured one.
  const projectRows = useMemo(() => {
    const records = data.records || [];
    return (data.projects || []).map((project: any) => ({
      ...project,
      revenue_generated: sumRevenueReceived(
        records.filter((r: any) => String(r.project || "Unassigned") === String(project.name)),
        revenueComponents
      ),
    }));
  }, [data.projects, data.records, revenueComponents]);

  /* ── trend graph: monthly actual vs expected + regression + forecast ── */
  const revenueTrend = useMemo(() => {
    const records = data.records || [];
    const map: Record<string, { month: string; actual: number; expected: number }> = {};

    records.forEach((record: any) => {
      const key = monthKey(
        record.expected_disbursement_date || record.actual_disbursement_date || record.booking_date
      );
      if (key === "Unscheduled") return;
      if (!map[key]) map[key] = { month: key, actual: 0, expected: 0 };
      // Configured formula, not the server's fixed actual_revenue — so the chart
      // moves with the checkboxes like every other figure.
      map[key].actual += calculateRevenueReceived(record, revenueComponents);
      map[key].expected += record.expected_revenue || 0;
    });

    const history = Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
    const { slope, intercept } = linearRegression(history.map((row) => row.actual));

    const series = history.map((row, index) => ({
      month: row.month,
      label: formatMonthLabel(row.month),
      actual: Math.round(row.actual),
      expected: Math.round(row.expected),
      regression: Math.max(0, Math.round(intercept + slope * index)),
    })) as any[];

    const forecastMonths = Math.max(1, Math.min(6, Math.round(forecastWindowDays / 30)));
    const lastIndex = history.length - 1;

    if (series.length) {
      // Bridge point so the forecast line joins the last known actual.
      series[series.length - 1].forecast = series[series.length - 1].actual;
    }

    for (let i = 1; i <= forecastMonths; i += 1) {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      series.push({
        month: key,
        label: formatMonthLabel(key),
        forecast: Math.max(0, Math.round(intercept + slope * (lastIndex + i))),
      });
    }

    return series;
  }, [data.records, forecastWindowDays, revenueComponents]);

  /* ── exports ── */
  const exportRows = () =>
    getReportRows(
      reportType,
      // Manager and project aggregates are swapped for the recomputed ones, so
      // the Sales Manager Performance and Project Revenue exports match what the
      // tables on screen show rather than the server's fixed formula.
      { ...data, sales_managers: sortedManagers, projects: projectRows },
      filteredSliceRecords.length ? filteredSliceRecords : data.records || [],
      revenueComponents
    );

  const handleExportCsv = () => {
    const rows = exportRows();
    if (!rows.length) return;
    downloadBlob(new Blob([makeCsv(rows)], { type: "text/csv;charset=utf-8" }), `${reportType}.csv`);
  };

  const handleExportExcel = async () => {
    const rows = exportRows();
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Revenue Intelligence");
    XLSX.writeFile(workbook, `${reportType}.xlsx`);
  };

  const handleExportPdf = () => {
    const previousTitle = document.title;
    document.title = `${reportTypes.find((t) => t.value === reportType)?.label || "Revenue Report"} - Bhoomi CRM`;
    window.print();
    window.setTimeout(() => {
      document.title = previousTitle;
    }, 500);
  };

  /* ── card + section config ── */
  const summary = data.summary || EMPTY_DATA.summary;

  const summaryCards: Array<{
    label: string;
    value: string;
    sub: string;
    icon: any;
    tone: Tone;
    key: string;
    emphasis?: PillTone;
  }> = [
      {
        label: "Total Agreement Value",
        value: formatRevenueAmount(summary.total_agreement_value),
        sub: `${data.total || 0} confirmed booking${(data.total || 0) === 1 ? "" : "s"}`,
        icon: IndianRupee,
        tone: "magenta",
        key: "total_agreement",
      },
      {
        label: "Revenue Received",
        value: formatRevenueAmount(customRevenueReceived),
        sub: revenueComponentsSub,
        icon: Banknote,
        tone: "emerald",
        key: "received_month",
      },
      {
        label: "Balance Receivable",
        value: formatRevenueAmount(customBalanceReceivable),
        sub: `Agreement − (${revenueComponentsSub})`,
        icon: Wallet,
        tone: "amber",
        key: "pending_month",
      },
      {
        label: "Unconfirmed Receipts",
        value: formatRevenueAmount(summary.unconfirmed_revenue || 0),
        sub: "Recorded without a receipt date — excluded from revenue",
        icon: AlertTriangle,
        tone: "rose",
        key: "unconfirmed",
        emphasis: (summary.unconfirmed_revenue || 0) > 0 ? "danger" : undefined,
      },
      {
        label: "Government Charges",
        value: formatRevenueAmount(sumGovernmentCharges(data.records || [])),
        // Not configurable: SDR/GST are collected on the government's behalf and
        // are never developer revenue, whatever the formula is set to.
        sub: `SDR + GST — collected, not revenue · Gross ${formatCompactAmount(customGrossCollection)}`,
        icon: FileSpreadsheet,
        tone: "slate",
        key: "receipt:sdr_amount",
      },
      {
        label: "Collection Efficiency",
        value: `${customCollectionEfficiency}%`,
        sub: `(${revenueComponentsSub}) ÷ Agreement Value`,
        icon: Activity,
        tone: "violet",
        key: "collection_efficiency",
      },
      {
        // Spend, not revenue. Gross is the true cost — net reaches the partner,
        // TDS is remitted to the government on their behalf.
        label: "Channel Partner Payout",
        value: formatRevenueAmount(cpPayout.paid),
        sub:
          cpPayout.total === 0
            ? "No commissions recorded yet"
            : `${formatCompactAmount(cpPayout.committed)} committed · ${cpPayout.ratio}% of revenue received`,
        icon: Users,
        tone: "rose",
        key: "cp_payout",
        emphasis: cpPayout.committed > 0 ? "warning" : undefined,
      },
    ];

  const indicatorSections = [
    {
      title: "Booking",
      icon: ClipboardList,
      tone: "cyan",
      section: "booking",
      rows: [
        ["Today", "today"],
        ["This Week", "this_week"],
        ["This Month", "this_month"],
        ["Last Month", "last_month"],
      ],
    },
    {
      title: "Registration",
      icon: CalendarCheck,
      tone: "emerald",
      section: "registration",
      rows: [
        ["Due This Week", "due_this_week"],
        ["Completed This Week", "completed_this_week"],
        ["Pending", "pending"],
        ["Delayed", "delayed"],
      ],
    },
    {
      title: "Loan Sanction",
      icon: Landmark,
      tone: "violet",
      section: "loan_sanction",
      rows: [
        ["Pending", "pending"],
        ["Approved", "approved"],
        ["Rejected", "rejected"],
        ["Processing", "processing"],
      ],
    },
    {
      title: "OCR",
      icon: FileText,
      tone: "amber",
      section: "ocr",
      rows: [
        ["Pending", "pending"],
        ["Received", "received"],
        ["This Week", "this_week"],
        ["This Month", "this_month"],
      ],
    },
    {
      title: "SDR",
      icon: FileSpreadsheet,
      tone: "magenta",
      section: "sdr",
      rows: [
        ["Pending", "pending"],
        ["Completed", "completed"],
        ["Due This Week", "due_this_week"],
      ],
    },
    {
      title: "Disbursement",
      icon: Banknote,
      tone: "rose",
      section: "disbursement",
      rows: [
        ["Due This Week", "due_this_week"],
        ["Due This Month", "due_this_month"],
        ["Received", "received"],
        ["Delayed", "delayed"],
      ],
    },
    {
      title: "Cash Component",
      icon: Wallet,
      tone: "slate",
      section: "cash_component",
      rows: [
        ["Pending", "pending"],
        ["Received", "received"],
        ["Outstanding", "outstanding"],
      ],
    },
    {
      title: "Data Quality",
      icon: AlertTriangle,
      tone: "rose",
      section: "revenue_quality",
      rows: [
        ["Missing Receipt Date", "bookings_with_unconfirmed_amounts"],
        ["Overpaid", "overpaid_bookings"],
        ["Ledger Drift", "bookings_with_ledger_drift"],
      ],
    },
  ];

  const forecastCards: Array<{ label: string; value: number; days: number; tone: Tone }> = [
    { label: "Next 7 Days", value: data.forecast?.next_7_days, days: 7, tone: "cyan" },
    { label: "Next 15 Days", value: data.forecast?.next_15_days, days: 15, tone: "emerald" },
    { label: "Next 30 Days", value: data.forecast?.next_30_days, days: 30, tone: "amber" },
    { label: "Next 90 Days", value: data.forecast?.next_90_days, days: 90, tone: "violet" },
  ];

  const delayCards = [
    { label: "Registration", key: "registration", value: data.delays?.registration_delay || 0 },
    { label: "Loan", key: "loan", value: data.delays?.loan_delay || 0 },
    { label: "OCR", key: "ocr", value: data.delays?.ocr_delay || 0 },
    { label: "SDR", key: "sdr", value: data.delays?.sdr_delay || 0 },
    { label: "Disbursement", key: "disbursement", value: data.delays?.disbursement_delay || 0 },
  ];

  /* ── shared classes ── */
  const options = data.filters || {};
  const selectClass = `h-9 rounded-lg px-2.5 text-xs font-semibold outline-none border transition-colors ${theme.select || theme.inputBg
    }`;
  const inputClass = `h-9 rounded-lg px-2.5 text-xs outline-none border transition-colors ${theme.inputBg} ${theme.text}`;
  const sectionPanel = `rounded-2xl border p-5 ${theme.tableWrap}`;
  const ghostBtn = `h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-2 border transition-colors ${isDark
    ? "border-white/10 text-gray-200 hover:bg-white/[0.07]"
    : "border-slate-200 text-slate-700 hover:bg-slate-50"
    }`;

  /* ── loading skeleton ── */
  if (isLoading) {
    return (
      <div className={`h-full overflow-y-auto p-4 md:p-6 space-y-5 ${theme.mainBg}`}>
        <div className="flex items-center justify-between gap-4">
          <div className={`h-8 w-64 rounded-lg animate-pulse ${isDark ? "bg-white/[0.07]" : "bg-slate-200"}`} />
          <div className={`h-9 w-72 rounded-lg animate-pulse ${isDark ? "bg-white/[0.07]" : "bg-slate-200"}`} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`h-[124px] rounded-2xl border animate-pulse ${isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-slate-200"
                }`}
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
        <div
          className={`h-72 rounded-2xl border animate-pulse ${isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-slate-200"
            }`}
        />
        <div
          className={`h-52 rounded-2xl border animate-pulse ${isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-slate-200"
            }`}
        />
      </div>
    );
  }

  const tableColCount = 9 + (activeReceiptKey ? 2 : 0);

  return (
    <div className={`h-full overflow-y-auto custom-scrollbar ${theme.mainBg}`}>
      {/* ═══ Sticky command bar ═══ */}
      <div
        className={`sticky top-0 z-30 px-4 md:px-6 py-3 border-b ${isDark ? "border-white/10 bg-black/40" : "border-slate-200 bg-white/70"
          }`}
        style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className={`text-xl font-black tracking-tight ${theme.accentText}`}>Revenue Intelligence</h1>
              <span
                className={`text-[9px] font-black px-2 py-0.5 rounded-full border inline-flex items-center gap-1.5 ${statusPillClass(
                  isDark,
                  "success"
                )}`}
                title="Auto-refreshes every 30 seconds"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            </div>
            <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>
              Cash-basis collection intelligence · Updated {formatDateTime(data.updated_at)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowFilters((prev) => !prev)}
              className={`${ghostBtn} ${activeFilterEntries.length ? (isDark ? "bg-white/[0.07]" : "bg-slate-50") : ""
                }`}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeFilterEntries.length > 0 && (
                <span
                  className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${statusPillClass(isDark, "info")}`}
                >
                  {activeFilterEntries.length}
                </span>
              )}
              <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>

            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className={selectClass}
              aria-label="Report type"
              title="Choose what the export contains"
            >
              {reportTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>

            {/* Segmented export group — one visual class for one action class */}
            <div
              className={`h-9 inline-flex items-stretch rounded-lg border overflow-hidden ${isDark ? "border-white/10" : "border-slate-200"
                }`}
            >
              {[
                { label: "CSV", icon: Download, onClick: handleExportCsv },
                { label: "Excel", icon: FileSpreadsheet, onClick: handleExportExcel },
                { label: "PDF", icon: FileText, onClick: handleExportPdf },
              ].map((btn, index) => (
                <button
                  key={btn.label}
                  onClick={btn.onClick}
                  title={`Export ${reportTypes.find((t) => t.value === reportType)?.label} as ${btn.label}`}
                  className={`px-3 text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${index > 0 ? (isDark ? "border-l border-white/10" : "border-l border-slate-200") : ""
                    } ${isDark ? "text-gray-200 hover:bg-white/[0.08]" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  <btn.icon className="w-3.5 h-3.5" />
                  {btn.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => fetchDashboard(true)}
              disabled={isRefreshing}
              className={`h-9 w-9 rounded-lg inline-flex items-center justify-center border ${isDark ? "border-white/10 hover:bg-white/[0.07]" : "border-slate-200 hover:bg-slate-50"
                }`}
              aria-label="Refresh dashboard"
              title="Refresh now"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Active filter chips */}
        {activeFilterEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            {activeFilterEntries.map(([key, value]) => (
              <span
                key={key}
                className={`text-[10px] font-bold px-2 py-1 rounded-full border inline-flex items-center gap-1.5 ${statusPillClass(
                  isDark,
                  "info"
                )}`}
              >
                {FILTER_LABELS[key]}: {value}
                <button
                  onClick={() => setFilter(key, "")}
                  className="hover:opacity-60 transition-opacity"
                  aria-label={`Remove ${FILTER_LABELS[key]} filter`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            <button onClick={resetFilters} className={`text-[10px] font-bold ml-1 ${theme.accentText} hover:underline`}>
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="p-4 md:p-6 space-y-5">
        {error && (
          <div className={`rounded-2xl border p-4 flex items-start gap-3 ${statusPillClass(isDark, "danger")}`}>
            <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold">Could not load revenue intelligence</p>
              <p className="text-xs mt-0.5 opacity-80">{error}</p>
            </div>
          </div>
        )}

        {/* ═══ Advanced filters ═══ */}
        {showFilters && (
          <section className={sectionPanel} style={theme.tableGlass}>
            <SectionHeader icon={Filter} title="Advanced Filters" theme={theme}>
              <button onClick={resetFilters} className={ghostBtn}>
                Clear all
              </button>
            </SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5">
              {(
                [
                  ["project", "All Projects", options.projects],
                  ["building", "All Buildings", options.buildings],
                  ["wing", "All Wings", options.wings],
                  ["floor", "All Floors", options.floors],
                  ["sales_manager", "All Sales Managers", options.sales_managers],
                  ["bank", "All Banks", options.banks],
                  ["loan_status", "Loan Status", options.loan_statuses],
                  ["registration_status", "Registration Status", options.registration_statuses],
                  ["disbursement_status", "Disbursement Status", options.disbursement_statuses],
                ] as Array<[keyof RevenueFilters, string, string[] | undefined]>
              ).map(([key, placeholder, values]) => (
                <select
                  key={key}
                  value={filters[key]}
                  onChange={(e) => setFilter(key, e.target.value)}
                  className={selectClass}
                  aria-label={FILTER_LABELS[key]}
                >
                  <option value="">{placeholder}</option>
                  {(values || []).map((value: string) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ))}
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => setFilter("date_from", e.target.value)}
                className={inputClass}
                aria-label="Date from"
              />
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) => setFilter("date_to", e.target.value)}
                className={inputClass}
                aria-label="Date to"
              />
              <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1">
                <input
                  value={filters.revenue_min}
                  onChange={(e) => setFilter("revenue_min", e.target.value)}
                  className={inputClass}
                  placeholder="Min value"
                  aria-label="Minimum revenue"
                />
                <input
                  value={filters.revenue_max}
                  onChange={(e) => setFilter("revenue_max", e.target.value)}
                  className={inputClass}
                  placeholder="Max value"
                  aria-label="Maximum revenue"
                />
              </div>
            </div>
          </section>
        )}

        {/* ═══ KPI cards ═══ */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
          {summaryCards.map(({ label, value, sub, icon, tone, key: sliceKey, emphasis }) => (
            <KpiCard
              key={label}
              label={label}
              value={value}
              sub={sub}
              icon={icon}
              tone={tone}
              emphasis={emphasis}
              active={activeSlice.key === sliceKey}
              onClick={() => openSlice(sliceKey, label)}
              theme={theme}
              isDark={isDark}
              onEdit={label === "Revenue Received" ? () => setShowRevenueEditor(true) : undefined}
            />
          ))}
        </section>

        {/* ═══ Receipt composition — what makes up "Revenue Received" ═══ */}
        <ReceiptComposition records={data.records || []} theme={theme} isDark={isDark} openSlice={openSlice} />

        {/* ═══ Trend & forecast ═══ */}
        <section className={sectionPanel} style={theme.tableGlass}>
          <SectionHeader icon={BarChart3} title="Revenue Trend & Forecast" theme={theme}>
            {showGraph && (
              <select
                value={forecastWindowDays}
                onChange={(e) => setForecastWindowDays(Number(e.target.value))}
                className={selectClass}
                aria-label="Forecast window"
              >
                {FORECAST_WINDOWS.map((window) => (
                  <option key={window.days} value={window.days}>
                    Forecast: {window.label}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => setShowGraph((prev) => !prev)}
              className={`h-9 px-3 rounded-lg text-[11px] font-black inline-flex items-center gap-2 border ${statusPillClass(
                isDark,
                showGraph ? "success" : "muted"
              )}`}
              aria-pressed={showGraph}
            >
              Graph {showGraph ? "ON" : "OFF"}
            </button>
          </SectionHeader>

          <div
            className="transition-all duration-300 ease-in-out overflow-hidden"
            style={{ maxHeight: showGraph ? 460 : 0, opacity: showGraph ? 1 : 0 }}
          >
            {revenueTrend.length === 0 ? (
              <div className={`h-64 flex flex-col items-center justify-center gap-2 ${theme.textMuted}`}>
                <BarChart3 className="w-8 h-8 opacity-30" />
                <p className="text-sm">No dated revenue history to plot yet.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={420}>
                <ComposedChart data={revenueTrend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.07)" : "#eef2f7"} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                    tickFormatter={(value) => formatCompactAmount(value)}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: any, name: any) => [formatRevenueAmount(Number(value) || 0), String(name ?? "")]}
                    contentStyle={{
                      borderRadius: 12,
                      border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid #eef2f7",
                      background: isDark ? "#0f0f14" : "#ffffff",
                      fontSize: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Revenue Received"
                    stroke="#9E217B"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="expected"
                    name="Agreement Value"
                    stroke="#f472b6"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="regression"
                    name="Trend"
                    stroke="#8b5cf6"
                    strokeWidth={1.75}
                    strokeDasharray="2 3"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    name="Forecast"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    strokeDasharray="8 5"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ═══ Pipeline ═══ */}
        <PipelineTimeline data={data} theme={theme} isDark={isDark} openSlice={openSlice} activeSlice={activeSlice} />

        {/* ═══ Operational snapshot ═══ */}
        <section className={sectionPanel} style={theme.tableGlass}>
          <SectionHeader icon={ClipboardList} title="Operational Snapshot" theme={theme}>
            <span className={`text-[10px] ${theme.textMuted}`}>Click any figure to list those bookings</span>
          </SectionHeader>
          <div className="flex gap-2.5 overflow-x-auto custom-scrollbar pb-1">
            {indicatorSections.map(({ title, icon: Icon, tone, section, rows }) => (
              <div key={title} className={`rounded-xl border p-3 w-[210px] flex-shrink-0 ${cardTone(tone, isDark)}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-3.5 h-3.5 text-[#9E217B]" />
                  <h3 className={`text-[11px] font-black ${theme.text}`}>{title}</h3>
                </div>
                <div className="space-y-1">
                  {rows.map(([label, metric]) => {
                    const value = data.indicators?.[section]?.[metric] ?? 0;
                    const isMoney = section === "cash_component" && metric === "outstanding";
                    const sliceKey = `indicator:${section}:${metric}`;
                    const isActive = activeSlice.key === sliceKey;
                    return (
                      <button
                        key={metric}
                        onClick={() => openSlice(sliceKey, `${title} — ${label}`)}
                        className={`w-full h-7 px-2 rounded-md flex items-center justify-between text-[11px] border transition-all ${isActive
                          ? "border-[#9E217B] bg-[#9E217B]/15"
                          : isDark
                            ? "bg-black/10 border-white/10 hover:bg-white/[0.06]"
                            : "bg-white/70 border-white hover:bg-white"
                          }`}
                      >
                        <span className={`truncate ${theme.textMuted}`}>{label}</span>
                        <span className={`font-black tabular-nums flex-shrink-0 ml-1.5 ${theme.text}`}>
                          {isMoney ? formatCompactAmount(value) : value}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ Upcoming activities ═══ */}
        <UpcomingActivities data={data} theme={theme} isDark={isDark} openSlice={openSlice} />

        {/* ═══ Analytics grid ═══ */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className={`rounded-2xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
              <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${theme.tableBorder}`}>
                <div className="flex items-center gap-2">
                  <Users className="w-[18px] h-[18px] text-[#9E217B]" />
                  <h2 className={`text-[13px] font-black uppercase tracking-[0.06em] ${theme.text}`}>
                    Sales Manager Performance
                  </h2>
                </div>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value)}
                  className={selectClass}
                  aria-label="Sort managers"
                >
                  <option value="highest_revenue">Highest Revenue</option>
                  <option value="highest_agreement">Highest Agreement Value</option>
                  <option value="highest_bookings">Highest Bookings</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={theme.tableHead}>
                    <tr>
                      {["Sales Manager", "Bookings", "Agreement", "Received", "Balance"].map((header, i) => (
                        <th
                          key={header}
                          className={`px-4 py-2.5 font-bold text-[10px] uppercase tracking-wider whitespace-nowrap ${i === 0 ? "text-left" : "text-right"
                            } ${theme.text}`}
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedManagers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className={`px-4 py-8 text-center text-xs ${theme.textMuted}`}>
                          No managers with bookings yet.
                        </td>
                      </tr>
                    ) : (
                      sortedManagers.map((manager: any) => (
                        <tr
                          key={manager.name}
                          onClick={() => openSlice(`manager:${manager.name}`, manager.name)}
                          className={`cursor-pointer ${theme.tableRow} ${activeSlice.key === `manager:${manager.name}` ? "bg-[#9E217B]/[0.07]" : ""
                            }`}
                        >
                          <td className={`px-4 py-2.5 font-bold ${theme.text}`}>{manager.name}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${theme.textMuted}`}>
                            {manager.bookings}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${theme.text}`}>
                            {formatCompactAmount(manager.agreement_value)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-500 font-bold">
                            {formatCompactAmount(manager.revenue_received)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-amber-500 font-bold">
                            {formatCompactAmount(manager.pending)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <PerformanceTable
              title="Project Performance"
              icon={Building2}
              rows={projectRows}
              headers={["Project", "Booked", "Reg. Pending", "Disb. Pending", "Revenue"]}
              renderRow={(row: any) => [
                row.name,
                row.booked,
                row.registration_pending,
                row.disbursement_pending,
                formatCompactAmount(row.revenue_generated),
              ]}
              onRowClick={(row: any) => openSlice(`project:${row.name}`, row.name)}
              activeKey={activeSlice.key}
              keyPrefix="project:"
              theme={theme}
            />
          </div>

          <div className="space-y-4">
            <PerformanceTable
              title="Bank Performance"
              icon={Landmark}
              rows={data.banks || []}
              headers={["Bank", "Loans", "Approved", "Pending", "Rejected", "Disbursed"]}
              renderRow={(row: any) => [
                row.name,
                row.loan_count,
                row.approved,
                row.pending,
                row.rejected,
                formatCompactAmount(row.amount_disbursed || 0),
              ]}
              onRowClick={(row: any) => openSlice(`bank:${row.name}`, row.name)}
              activeKey={activeSlice.key}
              keyPrefix="bank:"
              theme={theme}
            />

            <div className={`rounded-2xl border p-5 ${theme.tableWrap}`} style={theme.tableGlass}>
              <SectionHeader icon={TrendingUp} title="Cash Forecast" theme={theme}>
                <span className={`text-[10px] ${theme.textMuted}`}>Undisbursed bookings by expected date</span>
              </SectionHeader>
              <div className="grid grid-cols-2 gap-2.5">
                {forecastCards.map(({ label, value, days, tone }) => (
                  <button
                    key={label}
                    onClick={() => openSlice(`forecast:${days}`, label)}
                    className={`rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 ${cardTone(
                      tone,
                      isDark
                    )} ${activeSlice.key === `forecast:${days}` ? "ring-2 ring-[#9E217B]/50" : ""}`}
                  >
                    <p className={`text-[10px] font-black uppercase tracking-wider ${theme.textMuted}`}>{label}</p>
                    <p className={`text-lg font-black mt-1.5 tabular-nums ${theme.text}`} title={formatRevenueAmount(value || 0)}>
                      {formatCompactAmount(value || 0)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Channel partner payout ═══ */}
        <ChannelPartnerPayout
          payout={cpPayout}
          openSlice={openSlice}
          activeSlice={activeSlice}
          theme={theme}
          isDark={isDark}
        />

        {/* ═══ Collection health ═══ */}
        <CollectionHealth
          delayCards={delayCards}
          openSlice={openSlice}
          theme={theme}
          isDark={isDark}
          activeSlice={activeSlice}
        />

        {/* ═══ Calendar + alerts ═══ */}
        <section className="grid grid-cols-1 xl:grid-cols-[62fr_38fr] gap-4">
          <RevenueCalendar
            records={data.records || []}
            month={calendarMonth}
            setMonth={setCalendarMonth}
            openSlice={openSlice}
            theme={theme}
            isDark={isDark}
          />
          <SmartAlerts alerts={data.alerts || []} openSlice={openSlice} theme={theme} isDark={isDark} />
        </section>

        {/* ═══ Booking records ═══ */}
        <section
          ref={recordsRef}
          className={`rounded-2xl border overflow-hidden scroll-mt-24 ${theme.tableWrap}`}
          style={theme.tableGlass}
        >
          <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${theme.tableBorder}`}>
            <div className="flex items-center gap-2 min-w-0">
              {activeReceiptKey ? (
                <ReceiptText className="w-[18px] h-[18px] text-[#9E217B] flex-shrink-0" />
              ) : (
                <Search className="w-[18px] h-[18px] text-[#9E217B] flex-shrink-0" />
              )}
              <h2 className={`text-[13px] font-black uppercase tracking-[0.06em] truncate ${theme.text}`}>
                {activeSlice.label}
              </h2>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full border flex-shrink-0 ${statusPillClass(isDark, "muted")}`}>
                {filteredSliceRecords.length}
              </span>
              {activeSlice.key !== "recent" && (
                <button
                  onClick={() => openSlice("recent", "Recent Bookings")}
                  className={`text-[10px] font-bold flex-shrink-0 ${theme.accentText} hover:underline`}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.textMuted}`} />
              <input
                value={bookingSearch}
                onChange={(e) => {
                  setBookingSearch(e.target.value);
                  setBookingPage(1);
                }}
                placeholder="Search customer, booking no., manager..."
                className={`h-9 pl-9 pr-3 rounded-lg text-xs outline-none border w-full sm:w-72 ${theme.inputBg} ${theme.text}`}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={`sticky top-0 z-10 ${theme.tableHead}`}>
                <tr>
                  {[
                    { label: "Booking", align: "left" },
                    { label: "Customer", align: "left" },
                    { label: "Flat", align: "left" },
                    { label: "Agreement", align: "right" },
                    { label: "Received", align: "right" },
                    { label: "Balance", align: "right" },
                    ...(activeReceiptKey
                      ? [
                        { label: receiptLineLabel(activeReceiptKey), align: "right" as const },
                        { label: isUnconfirmedSlice ? "Expected" : "Received On", align: "left" as const },
                      ]
                      : []),
                    { label: "Stage", align: "left" },
                    { label: "Disbursement", align: "left" },
                    { label: "Status", align: "left" },
                  ].map((col) => (
                    <th
                      key={col.label}
                      className={`px-4 py-2.5 font-bold text-[10px] uppercase tracking-wider whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"
                        } ${theme.text}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedSliceRecords.length === 0 ? (
                  <tr>
                    <td colSpan={tableColCount} className="px-4 py-14 text-center">
                      <Search className={`w-8 h-8 mx-auto mb-3 opacity-25 ${theme.textMuted}`} />
                      <p className={`text-sm font-bold ${theme.text}`}>No bookings here</p>
                      <p className={`text-xs mt-1 ${theme.textMuted}`}>
                        {bookingSearch ? "Nothing matches that search." : "Nothing falls into this selection yet."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  pagedSliceRecords.map((record: any) => {
                    const receiptValue = activeReceiptKey
                      ? isUnconfirmedSlice
                        ? receiptLineUnconfirmed(record, activeReceiptKey)
                        : receiptLineAmount(record, activeReceiptKey)
                      : 0;
                    return (
                      <tr key={record.booking_id} className={theme.tableRow}>
                        <td className={`px-4 py-3 font-bold whitespace-nowrap ${theme.text}`}>
                          {record.booking_number || `BKG-${record.booking_id}`}
                        </td>
                        <td className={`px-4 py-3 ${theme.text}`}>
                          <p className="font-bold leading-tight">{record.customer_name}</p>
                          <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>{record.sales_manager || "—"}</p>
                        </td>
                        <td className={`px-4 py-3 text-xs ${theme.textMuted}`}>{flatLabel(record)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${theme.text}`}>
                          {formatRevenueAmount(record.agreement_value_number)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-500 font-bold">
                          {formatRevenueAmount(calculateRevenueReceived(record, revenueComponents))}
                          {(record.unconfirmed_revenue || 0) > 0 && (
                            <span
                              className="block text-[10px] font-bold text-amber-500"
                              title="Recorded without a receipt date — excluded from revenue"
                            >
                              +{formatCompactAmount(record.unconfirmed_revenue)} unconfirmed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-500 font-bold">
                          {formatRevenueAmount(calculateBalanceReceivable(record, revenueComponents))}
                        </td>

                        {activeReceiptKey && (
                          <>
                            <td
                              className={`px-4 py-3 text-right tabular-nums font-black ${isUnconfirmedSlice ? "text-rose-500" : "text-cyan-500"
                                }`}
                            >
                              {formatRevenueAmount(receiptValue)}
                            </td>
                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${theme.textMuted}`}>
                              {isUnconfirmedSlice
                                ? "no date"
                                : formatDate(receiptLineDate(record, activeReceiptKey))}
                            </td>
                          </>
                        )}

                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded-full border text-[10px] font-bold whitespace-nowrap ${statusPillClass(
                              isDark,
                              record.derived_stage === "completed"
                                ? "success"
                                : record.days_delayed > 0
                                  ? "warning"
                                  : "info"
                            )}`}
                          >
                            {record.derived_stage_label}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs whitespace-nowrap ${theme.textMuted}`}>
                          {formatDate(record.expected_disbursement_date)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded-full border text-[10px] font-bold whitespace-nowrap ${statusPillClass(
                              isDark,
                              record.actual_disbursement_date
                                ? "success"
                                : record.days_delayed > 0
                                  ? "danger"
                                  : "muted"
                            )}`}
                          >
                            {record.actual_disbursement_date
                              ? "Completed"
                              : record.days_delayed > 0
                                ? `Delayed ${record.days_delayed}d`
                                : "In Progress"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Totals for the whole slice, not just this page */}
              {filteredSliceRecords.length > 0 && (
                <tfoot className={`border-t-2 ${isDark ? "border-white/15" : "border-slate-300"}`}>
                  <tr className={isDark ? "bg-white/[0.03]" : "bg-slate-50/70"}>
                    <td colSpan={3} className={`px-4 py-3 text-[10px] font-black uppercase tracking-wider ${theme.textMuted}`}>
                      Total · {filteredSliceRecords.length} booking{filteredSliceRecords.length === 1 ? "" : "s"}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-black ${theme.text}`}>
                      {formatRevenueAmount(sliceTotals.agreement)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-black text-emerald-500">
                      {formatRevenueAmount(sliceTotals.received)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-black text-amber-500">
                      {formatRevenueAmount(sliceTotals.pending)}
                    </td>
                    {activeReceiptKey && (
                      <>
                        <td
                          className={`px-4 py-3 text-right tabular-nums font-black ${isUnconfirmedSlice ? "text-rose-500" : "text-cyan-500"
                            }`}
                        >
                          {formatRevenueAmount(sliceTotals.receipt)}
                        </td>
                        <td />
                      </>
                    )}
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {filteredSliceRecords.length > PAGE_SIZE && (
            <div className={`flex items-center justify-between gap-3 p-4 border-t ${theme.tableBorder}`}>
              <p className={`text-[11px] font-semibold ${theme.textMuted}`}>
                Page {Math.min(bookingPage, totalBookingPages)} of {totalBookingPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBookingPage((prev) => Math.max(1, prev - 1))}
                  disabled={bookingPage <= 1}
                  className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center disabled:opacity-30 ${isDark ? "border-white/10 hover:bg-white/[0.07]" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setBookingPage((prev) => Math.min(totalBookingPages, prev + 1))}
                  disabled={bookingPage >= totalBookingPages}
                  className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center disabled:opacity-30 ${isDark ? "border-white/10 hover:bg-white/[0.07]" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  aria-label="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {showRevenueEditor && (
        <RevenueComponentsModal
          components={revenueComponents}
          onApply={setRevenueComponents}
          onClose={() => setShowRevenueEditor(false)}
          theme={theme}
          isDark={isDark}
          records={data.records || []}
        />
      )}
    </div>
  );
}



/* ══════════════════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════════════════ */

function PipelineTimeline({ data, theme, isDark, openSlice, activeSlice }: any) {
  const stages = data.pipeline?.length
    ? data.pipeline
    : REVENUE_STAGES.map((stage: any) => ({ ...stage, count: 0, value: 0 }));
  const maxCount = Math.max(1, ...stages.map((stage: any) => stage.count || 0), data.total || 0);

  return (
    <section className={`rounded-2xl border p-5 ${theme.tableWrap}`} style={theme.tableGlass}>
      <SectionHeader icon={Layers3} title="Revenue Pipeline" theme={theme}>
        <span className={`text-[10px] ${theme.textMuted}`}>Cumulative — a booking appears at every stage it has passed</span>
      </SectionHeader>
      <div className="overflow-x-auto custom-scrollbar pb-1">
        <div className="flex items-stretch gap-1.5 min-w-[980px]">
          {stages.map((stage: any, index: number) => {
            const pct = Math.min(100, Math.round(((stage.count || 0) / maxCount) * 100));
            const isActive = activeSlice?.key === `stage:${stage.id}`;
            return (
              <React.Fragment key={stage.id}>
                <button
                  onClick={() => openSlice(`stage:${stage.id}`, stage.label)}
                  className={`flex-1 min-w-[108px] text-left rounded-xl border p-3 transition-all hover:-translate-y-0.5 ${cardTone(
                    index % 2 === 0 ? "cyan" : "magenta",
                    isDark
                  )} ${isActive ? "ring-2 ring-[#9E217B]/60" : ""}`}
                >
                  <p className={`text-[10px] font-bold leading-tight ${theme.textMuted}`}>{stage.label}</p>
                  <p className={`text-2xl font-black mt-1 tabular-nums ${theme.text}`}>{stage.count || 0}</p>
                  <p className={`text-[10px] mt-0.5 ${theme.textMuted}`} title={formatRevenueAmount(stage.value || 0)}>
                    {formatCompactAmount(stage.value || 0)}
                  </p>
                  <div className={`h-1.5 rounded-full mt-2.5 overflow-hidden ${isDark ? "bg-white/10" : "bg-slate-200"}`}>
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#9E217B] to-cyan-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
                {index < stages.length - 1 && (
                  <div className="flex items-center text-[#9E217B]/50 flex-shrink-0">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Commission spend. Separate from every revenue panel above it because this is
 * money going out — presenting it alongside receipts without that distinction is
 * how a cost ends up read as income.
 */
function ChannelPartnerPayout({ payout, openSlice, activeSlice, theme, isDark }: any) {
  const tiles = [
    {
      label: "Paid Out",
      value: payout.paid,
      slice: "cp_payout_paid",
      tone: "rose" as Tone,
      hint: `${formatCompactAmount(payout.netPaid)} to partners · ${formatCompactAmount(payout.tdsPaid)} TDS`,
    },
    {
      label: "Committed",
      value: payout.committed,
      slice: "cp_payout_committed",
      tone: "amber" as Tone,
      hint: "Accrued or due — not yet paid",
    },
    {
      label: "Total Commission",
      value: payout.total,
      slice: "cp_payout",
      tone: "slate" as Tone,
      hint: `${payout.bookings} booking${payout.bookings === 1 ? "" : "s"} with a commission`,
    },
  ];

  return (
    <section className={`rounded-2xl border p-5 ${theme.tableWrap}`} style={theme.tableGlass}>
      <SectionHeader icon={Users} title="Channel Partner Payout" theme={theme}>
        <span className={`text-[10px] ${theme.textMuted}`}>
          Cost of sale — excluded from revenue, reversed commissions ignored
        </span>
      </SectionHeader>

      {payout.total === 0 ? (
        <div className={`py-8 text-center ${theme.textMuted}`}>
          <Users className="w-8 h-8 mx-auto mb-2.5 opacity-25" />
          <p className="text-sm font-bold">No channel partner commissions recorded</p>
          <p className="text-xs mt-1">Commissions recorded against a booking appear here.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
            {tiles.map((tile) => (
              <button
                key={tile.label}
                onClick={() => openSlice(tile.slice, `Channel Partner — ${tile.label}`)}
                className={`rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 ${cardTone(
                  tile.tone,
                  isDark
                )} ${activeSlice?.key === tile.slice ? "ring-2 ring-[#9E217B]/50" : ""}`}
              >
                <p className={`text-[10px] font-black uppercase tracking-wider ${theme.textMuted}`}>{tile.label}</p>
                <p className={`text-lg font-black mt-1.5 tabular-nums ${theme.text}`} title={formatRevenueAmount(tile.value)}>
                  {formatCompactAmount(tile.value)}
                </p>
                <p className={`text-[10px] mt-1 ${theme.textMuted}`}>{tile.hint}</p>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={theme.tableHead}>
                <tr>
                  {["Channel Partner", "Bookings", "Paid", "Committed", "Total"].map((header, i) => (
                    <th
                      key={header}
                      className={`px-4 py-2.5 font-bold text-[10px] uppercase tracking-wider whitespace-nowrap ${i === 0 ? "text-left" : "text-right"
                        } ${theme.text}`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payout.byPartner.map((row: any) => (
                  <tr
                    key={row.name}
                    onClick={() => openSlice(`cp_partner:${row.name}`, row.name)}
                    className={`cursor-pointer ${theme.tableRow} ${activeSlice?.key === `cp_partner:${row.name}` ? "bg-[#9E217B]/[0.07]" : ""
                      }`}
                  >
                    <td className={`px-4 py-2.5 font-bold ${theme.text}`}>{row.name}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${theme.textMuted}`}>{row.bookings}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-500 font-bold">
                      {formatCompactAmount(row.paid)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-500 font-bold">
                      {formatCompactAmount(row.committed)}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-black ${theme.text}`}>
                      {formatCompactAmount(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function CollectionHealth({ delayCards, openSlice, theme, isDark, activeSlice }: any) {
  const toneFor = (days: number): PillTone => (days <= 0 ? "success" : days <= 5 ? "warning" : "danger");
  const labelFor = (days: number) => (days <= 0 ? "On Track" : days <= 5 ? "Minor Delay" : "Critical");

  return (
    <section className={`rounded-2xl border p-5 ${theme.tableWrap}`} style={theme.tableGlass}>
      <SectionHeader icon={AlertTriangle} title="Collection Health" theme={theme}>
        <span className={`text-[10px] ${theme.textMuted}`}>Average across delayed bookings only</span>
      </SectionHeader>
      <div className="flex flex-wrap gap-2.5">
        {delayCards.map((delay: any) => {
          const tone = toneFor(delay.value);
          const isActive = activeSlice?.key === `delay:${delay.key}`;
          return (
            <button
              key={delay.key}
              onClick={() => openSlice(`delay:${delay.key}`, `${delay.label} — delayed bookings`)}
              className={`flex items-center gap-2.5 rounded-full border pl-2.5 pr-3.5 py-2 transition-all hover:-translate-y-0.5 ${statusPillClass(
                isDark,
                tone
              )} ${isActive ? "ring-2 ring-offset-1 ring-[#9E217B]/50" : ""}`}
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-rose-500"
                  }`}
              />
              <span className="text-[11px] font-bold">{delay.label}</span>
              <span className="text-[11px] font-black tabular-nums">{delay.value}d</span>
              <span className="text-[9px] font-bold uppercase tracking-wide opacity-70">{labelFor(delay.value)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function UpcomingActivities({ data, theme, isDark, openSlice }: any) {
  const tables = [
    { key: "registration_due", title: "Registration Due", dateKey: "expected_registration_date", tone: "emerald" },
    { key: "loan_followup", title: "Loan Follow-up", dateKey: "sanction_date", tone: "violet" },
    { key: "ocr_pending", title: "OCR Pending", dateKey: "ocr_received_date", tone: "amber" },
    { key: "sdr_pending", title: "SDR Pending", dateKey: "sdr_due_date", tone: "magenta" },
    { key: "disbursement_due", title: "Disbursement Due", dateKey: "expected_disbursement_date", tone: "rose" },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
      {tables.map((table) => {
        const rows = data.upcoming?.[table.key] || [];
        return (
          <div key={table.key} className={`rounded-2xl border overflow-hidden ${cardTone(table.tone, isDark)}`}>
            <button
              onClick={() => openSlice(`upcoming:${table.key}`, table.title)}
              className="w-full p-3.5 text-left flex items-center justify-between gap-2 transition-opacity hover:opacity-80"
            >
              <h2 className={`font-black text-[12px] ${theme.text}`}>{table.title}</h2>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full border flex-shrink-0 ${statusPillClass(
                  isDark,
                  rows.length ? "warning" : "muted"
                )}`}
              >
                {rows.length}
              </span>
            </button>
            <div className={`border-t ${isDark ? "border-white/10" : "border-white"}`}>
              {rows.length === 0 ? (
                <p className={`px-3.5 py-6 text-[11px] text-center ${theme.textMuted}`}>Nothing pending</p>
              ) : (
                rows.slice(0, 4).map((record: any) => (
                  <button
                    key={`${table.key}-${record.booking_id}`}
                    onClick={() => openSlice(`alert:${record.booking_id}`, record.customer_name)}
                    className={`w-full px-3.5 py-2.5 text-left border-b last:border-b-0 transition-colors ${isDark ? "border-white/10 hover:bg-white/[0.06]" : "border-white hover:bg-white/70"
                      }`}
                  >
                    <p className={`font-bold text-[12px] truncate ${theme.text}`}>{record.customer_name}</p>
                    <p className={`text-[10px] mt-0.5 truncate ${theme.textMuted}`}>
                      {flatLabel(record)} · {formatDate(record[table.dateKey])}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function PerformanceTable({
  title,
  icon: Icon,
  rows,
  headers,
  renderRow,
  onRowClick,
  activeKey,
  keyPrefix,
  theme,
}: any) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className={`p-4 border-b flex items-center gap-2 ${theme.tableBorder}`}>
        <Icon className="w-[18px] h-[18px] text-[#9E217B]" />
        <h2 className={`text-[13px] font-black uppercase tracking-[0.06em] ${theme.text}`}>{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={theme.tableHead}>
            <tr>
              {headers.map((header: string, i: number) => (
                <th
                  key={header}
                  className={`px-4 py-2.5 font-bold text-[10px] uppercase tracking-wider whitespace-nowrap ${i === 0 ? "text-left" : "text-right"
                    } ${theme.text}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className={`px-4 py-8 text-center text-xs ${theme.textMuted}`}>
                  No records yet.
                </td>
              </tr>
            ) : (
              rows.map((row: any) => (
                <tr
                  key={row.name}
                  onClick={() => onRowClick(row)}
                  className={`cursor-pointer ${theme.tableRow} ${activeKey === `${keyPrefix}${row.name}` ? "bg-[#9E217B]/[0.07]" : ""
                    }`}
                >
                  {renderRow(row).map((value: any, index: number) => (
                    <td
                      key={`${row.name}-${index}`}
                      className={`px-4 py-2.5 whitespace-nowrap ${index === 0 ? `font-bold text-left ${theme.text}` : `text-right tabular-nums ${theme.textMuted}`
                        }`}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RevenueCalendar({ records, month, setMonth, openSlice, theme, isDark }: any) {
  const monthDate = toDate(`${month}-01`) || new Date();
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlankDays = new Date(year, monthIndex, 1).getDay();
  const todayKey = toDateKey(new Date());

  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    const pushEvent = (dateValue: unknown, record: any, label: string, completed: boolean) => {
      const key = toDateKey(dateValue);
      if (!key) return;
      const delayed = !completed && !!todayKey && key < todayKey;
      if (!map[key]) map[key] = [];
      map[key].push({ record, label, completed, delayed });
    };

    records.forEach((record: any) => {
      pushEvent(
        record.expected_registration_date || record.actual_registration_date,
        record,
        "Registration",
        !!record.actual_registration_date
      );
      pushEvent(record.sanction_date, record, "Loan Sanction", !!record.sanction_date);
      pushEvent(
        record.ocr_received_date || addDays(record.booking_date || record.application_date, 7),
        record,
        "OCR",
        !!record.ocr_received_date
      );
      pushEvent(record.sdr_due_date, record, "SDR", recordReachesStage(record, "sdr_paid"));
      pushEvent(
        record.expected_disbursement_date || record.actual_disbursement_date,
        record,
        "Disbursement",
        !!record.actual_disbursement_date
      );
    });
    return map;
  }, [records, todayKey]);

  const cells = [
    ...Array.from({ length: leadingBlankDays }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1),
  ];

  const changeMonth = (offset: number) => {
    const next = new Date(year, monthIndex + offset, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };

  const navBtn = `h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors ${isDark ? "border-white/10 hover:bg-white/[0.07]" : "border-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className={`rounded-2xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${theme.tableBorder}`}>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-[18px] h-[18px] text-[#9E217B]" />
          <h2 className={`text-[13px] font-black uppercase tracking-[0.06em] ${theme.text}`}>Revenue Calendar</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2.5 text-[9px] font-bold uppercase tracking-wide">
            {[
              ["Done", "bg-emerald-500"],
              ["Due", "bg-amber-500"],
              ["Overdue", "bg-rose-500"],
            ].map(([label, dot]) => (
              <span key={label} className={`inline-flex items-center gap-1 ${theme.textMuted}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                {label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => changeMonth(-1)} className={navBtn} aria-label="Previous month">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className={`text-xs font-bold min-w-[92px] text-center ${theme.text}`}>
              {monthDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
            </span>
            <button onClick={() => changeMonth(1)} className={navBtn} aria-label="Next month">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-black uppercase tracking-wider">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className={`py-2 ${theme.textMuted}`}>
            {day}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 border-t ${isDark ? "border-white/10" : "border-slate-200"}`}>
        {cells.map((day, index) => {
          const key = day
            ? `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            : "";
          const events = key ? eventsByDate[key] || [] : [];
          const isToday = key === todayKey;
          return (
            <div
              key={`${day || "blank"}-${index}`}
              className={`min-h-[104px] p-1.5 border-r border-b last:border-r-0 ${isDark ? "border-white/10" : "border-slate-200"
                } ${!day ? "opacity-25" : ""} ${isToday ? (isDark ? "bg-[#9E217B]/10" : "bg-[#9E217B]/[0.05]") : ""}`}
            >
              {day && (
                <p
                  className={`text-[11px] font-black mb-1.5 px-1 ${isToday ? "text-[#9E217B]" : theme.text
                    }`}
                >
                  {day}
                </p>
              )}
              <div className="space-y-1">
                {events.slice(0, 3).map((event, eventIndex) => (
                  <button
                    key={`${event.record.booking_id}-${event.label}-${eventIndex}`}
                    onClick={() => openSlice(`alert:${event.record.booking_id}`, event.record.customer_name)}
                    title={`${event.label} · ${event.record.customer_name}`}
                    className={`w-full text-left px-1.5 py-0.5 rounded text-[9px] font-bold truncate border transition-opacity hover:opacity-75 ${statusPillClass(
                      isDark,
                      event.completed ? "success" : event.delayed ? "danger" : "warning"
                    )}`}
                  >
                    {event.label}
                  </button>
                ))}
                {events.length > 3 && (
                  <p className={`text-[9px] px-1.5 font-bold ${theme.textMuted}`}>+{events.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
/**
 * Draft-based: edits are held locally and only applied on Save, so Cancel is a
 * real escape hatch. The live total in the footer previews the effect of the
 * draft, not of what is currently applied.
 */
function RevenueComponentsModal({ components, onApply, onClose, theme, isDark, records }: any) {
  const [draft, setDraft] = useState<RevenueConfig>(() => normalizeRevenueConfig(components));

  const draftTotal = useMemo(() => sumRevenueReceived(records || [], draft), [records, draft]);
  const draftSub = useMemo(() => describeRevenueConfig(draft), [draft]);
  const dirty = useMemo(
    () => REVENUE_COMPONENTS.some((c) => isRevenueComponentEnabled(draft, c.key) !== isRevenueComponentEnabled(components, c.key)),
    [draft, components]
  );

  // A component whose every receipt line is suppressed can be ticked and still
  // contribute nothing — token is folded into the booking amount by default.
  // Saying so beats letting an admin conclude the checkbox is broken.
  const suppressed = useMemo(() => {
    const map: Record<string, boolean> = {};
    REVENUE_COMPONENTS.forEach((c) => { map[c.key] = isComponentSuppressed(records || [], c.key); });
    return map;
  }, [records]);

  const noneSelected = REVENUE_COMPONENTS.every((c) => !isRevenueComponentEnabled(draft, c.key));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border p-5 ${theme.tableWrap}`}
        style={theme.tableGlass}
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className={`text-[13px] font-black uppercase tracking-wide ${theme.text}`}>Customize Revenue Received</h3>
          <button onClick={onClose} className={theme.textMuted} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <p className={`text-[11px] mb-4 ${theme.textMuted}`}>
          Select which receipt components should contribute to Revenue Received.
        </p>

        <div className="space-y-2">
          {REVENUE_COMPONENTS.map((opt) => {
            const checked = isRevenueComponentEnabled(draft, opt.key);
            return (
              <label
                key={opt.key}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${isDark ? "border-white/10 hover:bg-white/[0.05]" : "border-slate-200 hover:bg-slate-50"
                  }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
                  className="w-4 h-4 mt-0.5 accent-[#9E217B] flex-shrink-0"
                />
                <span className="min-w-0">
                  <span className={`block text-xs font-semibold ${theme.text}`}>{opt.label}</span>
                  {opt.hint && <span className={`block text-[10px] mt-0.5 ${theme.textMuted}`}>{opt.hint}</span>}
                  {suppressed[opt.key] && (
                    <span className="block text-[10px] mt-1 text-amber-500">
                      Already included in another component on every booking — enabling this adds ₹0.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        <div className={`mt-4 pt-4 border-t ${theme.tableBorder}`}>
          <div className="flex items-center justify-between gap-3">
            <span className={`text-[11px] font-bold ${theme.textMuted}`}>Recalculated Total</span>
            <span className={`text-base font-black tabular-nums ${theme.text}`}>{formatRevenueAmount(draftTotal)}</span>
          </div>
          <p className={`text-[10px] mt-1 ${noneSelected ? "text-amber-500" : theme.textMuted}`}>{draftSub}</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={() => setDraft({ ...DEFAULT_REVENUE_CONFIG })}
            disabled={isDefaultRevenueConfig(draft)}
            className={`h-9 px-3 rounded-lg text-xs font-bold border transition-colors ${isDark ? "border-white/10 text-gray-200 hover:bg-white/[0.07]" : "border-slate-200 text-slate-700 hover:bg-slate-50"
              } ${isDefaultRevenueConfig(draft) ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            Reset to Default
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={`h-9 px-3 rounded-lg text-xs font-bold ${theme.textMuted}`}>
              Cancel
            </button>
            <button
              onClick={() => { onApply(draft); onClose(); }}
              disabled={!dirty}
              className={`h-9 px-4 rounded-lg text-xs font-black text-white transition-opacity ${!dirty ? "opacity-40 cursor-not-allowed" : ""}`}
              style={{ background: "#9E217B" }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
function SmartAlerts({ alerts, openSlice, theme, isDark }: any) {
  return (
    <div className={`rounded-2xl border overflow-hidden flex flex-col ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className={`p-4 border-b flex items-center justify-between gap-3 ${theme.tableBorder}`}>
        <div className="flex items-center gap-2">
          <BellRing className="w-[18px] h-[18px] text-[#9E217B]" />
          <h2 className={`text-[13px] font-black uppercase tracking-[0.06em] ${theme.text}`}>Smart Alerts</h2>
        </div>
        <span
          className={`text-[10px] font-black px-2 py-1 rounded-full border ${statusPillClass(
            isDark,
            alerts.length ? "warning" : "success"
          )}`}
        >
          {alerts.length}
        </span>
      </div>
      <div className="flex-1 max-h-[540px] overflow-y-auto custom-scrollbar">
        {alerts.length === 0 ? (
          <div className={`p-10 text-center ${theme.textMuted}`}>
            <BellRing className="w-8 h-8 mx-auto mb-2.5 opacity-25" />
            <p className="text-sm font-bold">All clear</p>
            <p className="text-xs mt-1">Nothing overdue or unconfirmed.</p>
          </div>
        ) : (
          alerts.map((alert: any, index: number) => (
            <button
              key={`${alert.booking_id}-${alert.title}-${index}`}
              onClick={() => openSlice(`alert:${alert.booking_id}`, alert.customer_name || alert.title)}
              className={`w-full p-3.5 border-b last:border-b-0 text-left flex items-start gap-2.5 transition-colors ${isDark ? "border-white/10 hover:bg-white/[0.06]" : "border-slate-200 hover:bg-slate-50"
                }`}
            >
              <span
                className={`w-8 h-8 rounded-lg border inline-flex items-center justify-center flex-shrink-0 ${statusPillClass(
                  isDark,
                  alert.type === "danger" ? "danger" : alert.type === "warning" ? "warning" : "success"
                )}`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block font-bold text-[12px] leading-snug ${theme.text}`}>{alert.title}</span>
                <span className={`block text-[10px] mt-0.5 truncate ${theme.textMuted}`}>
                  {alert.customer_name} · {alert.booking_number}
                </span>
              </span>
            </button>
          ))
        )}

      </div>

    </div>
  );

}
