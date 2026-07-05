"use client";

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
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  Landmark,
  Layers3,
  RefreshCcw,
  Search,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
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

const EMPTY_DATA: any = {
  records: [],
  summary: {
    total_agreement_value: 0,
    expected_revenue: 0,
    revenue_received: 0,
    pending_revenue: 0,
    collection_efficiency: 0,
  },
  indicators: {
    booking: {},
    registration: {},
    loan_sanction: {},
    ocr: {},
    sdr: {},
    disbursement: {},
    cash_component: {},
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

const reportTypes = [
  { value: "revenue_summary", label: "Revenue Summary" },
  { value: "loan_status", label: "Loan Status" },
  { value: "registration_report", label: "Registration Report" },
  { value: "disbursement_report", label: "Disbursement Report" },
  { value: "sales_manager_performance", label: "Sales Manager Performance" },
  { value: "project_revenue", label: "Project Revenue" },
  { value: "monthly_collection", label: "Monthly Collection Report" },
];

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function flatLabel(record: any) {
  return [record.wing, record.floor || record.floor_number, record.flat_number].filter(Boolean).join(" / ") || "-";
}

function statusPillClass(isDark: boolean, tone: "success" | "warning" | "danger" | "info" | "muted") {
  const tones = {
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

function monthKey(value: unknown) {
  const date = toDate(value);
  if (!date) return "Unscheduled";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getReportRows(reportType: string, data: any, records: any[]) {
  if (reportType === "sales_manager_performance") {
    return data.sales_managers.map((row: any) => ({
      "Sales Manager": row.name,
      Bookings: row.bookings,
      "Agreement Value": formatRevenueAmount(row.agreement_value),
      "Revenue Received": formatRevenueAmount(row.revenue_received),
      Pending: formatRevenueAmount(row.pending),
    }));
  }

  if (reportType === "project_revenue") {
    return data.projects.map((row: any) => ({
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
      acc[key]["Expected Revenue"] += record.expected_revenue;
      acc[key]["Revenue Received"] += record.actual_revenue;
      acc[key].Pending += record.pending_revenue;
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

  return records.map((record) => {
    const base = {
      "Booking No": record.booking_number,
      Customer: record.customer_name,
      Flat: flatLabel(record),
      Project: record.project || "-",
      "Sales Manager": record.sales_manager || "-",
      "Agreement Value": formatRevenueAmount(record.agreement_value_number),
      "Expected Revenue": formatRevenueAmount(record.expected_revenue),
      "Revenue Received": formatRevenueAmount(record.actual_revenue),
      Pending: formatRevenueAmount(record.pending_revenue),
      Stage: record.derived_stage_label,
    };

    if (reportType === "loan_status") {
      return {
        ...base,
        Bank: record.bank_name || "-",
        "Loan Status": record.loan_status || "-",
        "Sanction Status": record.sanction_status || "-",
        "Sanction Date": formatDate(record.sanction_date),
        "Sanction Amount": formatRevenueAmount(record.sanction_amount),
      };
    }

    if (reportType === "registration_report") {
      return {
        ...base,
        "Registration Status": record.registration_status || "-",
        "Expected Registration": formatDate(record.expected_registration_date),
        "Actual Registration": formatDate(record.actual_registration_date),
        "Delay Days": record.registration_delay_days,
      };
    }

    if (reportType === "disbursement_report") {
      return {
        ...base,
        "Disbursement Status": record.disbursement_status || "-",
        "Expected Disbursement": formatDate(record.expected_disbursement_date),
        "Actual Disbursement": formatDate(record.actual_disbursement_date),
        "Delay Days": record.disbursement_delay_days,
      };
    }

    return base;
  });
}

export default function RevenueIntelligenceView({ isDark, theme }: RevenueIntelligenceViewProps) {
  const [data, setData] = useState<any>(EMPTY_DATA);
  const [filters, setFilters] = useState<RevenueFilters>(INITIAL_FILTERS);
  const [activeSlice, setActiveSlice] = useState<{ key: string; label: string }>({ key: "recent", label: "Recent Bookings" });
  const [sortMode, setSortMode] = useState("highest_revenue");
  const [reportType, setReportType] = useState(reportTypes[0].value);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const recordsRef = useRef<HTMLDivElement>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || "").trim()) params.set(key, String(value).trim());
    });
    return params.toString();
  }, [filters]);

  const fetchDashboard = useCallback(async (quiet = false) => {
    if (quiet) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/revenue-intelligence${queryString ? `?${queryString}` : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Revenue intelligence could not load.");
      setData(json.data || EMPTY_DATA);
    } catch (err: any) {
      setError(err.message || "Revenue intelligence could not load.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const timer = setInterval(() => fetchDashboard(true), 30_000);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  const setFilter = (key: keyof RevenueFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setActiveSlice({ key: "recent", label: "Recent Bookings" });
  };

  const openSlice = (key: string, label: string) => {
    setActiveSlice({ key, label });
    window.requestAnimationFrame(() => recordsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setActiveSlice({ key: "recent", label: "Recent Bookings" });
  };

  const recordsForSlice = useMemo(() => {
    const now = new Date();
    const records = data.records || [];
    const [type, section, metric] = activeSlice.key.split(":");

    if (activeSlice.key === "recent") return records.slice(0, 30);
    if (activeSlice.key === "total_agreement") return records;
    if (activeSlice.key === "expected_month") return records.filter((record: any) => isThisMonth(record.expected_disbursement_date, now));
    if (activeSlice.key === "received_month") return records.filter((record: any) => isThisMonth(record.expected_disbursement_date, now) && record.actual_revenue > 0);
    if (activeSlice.key === "pending_month") return records.filter((record: any) => isThisMonth(record.expected_disbursement_date, now) && record.pending_revenue > 0);
    if (activeSlice.key === "collection_efficiency") return records.filter((record: any) => isThisMonth(record.expected_disbursement_date, now));
    if (activeSlice.key.startsWith("forecast:")) {
      const days = Number(activeSlice.key.split(":")[1]);
      return records.filter((record: any) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, days, now));
    }
    if (activeSlice.key.startsWith("stage:")) {
      const stage = activeSlice.key.split(":")[1] as RevenueStageId;
      return records.filter((record: any) => recordReachesStage(record, stage));
    }
    if (activeSlice.key.startsWith("manager:")) {
      const manager = activeSlice.key.slice("manager:".length);
      return records.filter((record: any) => String(record.sales_manager || "Unassigned") === manager);
    }
    if (activeSlice.key.startsWith("project:")) {
      const project = activeSlice.key.slice("project:".length);
      return records.filter((record: any) => String(record.project || "Unassigned") === project);
    }
    if (activeSlice.key.startsWith("bank:")) {
      const bank = activeSlice.key.slice("bank:".length);
      return records.filter((record: any) => String(record.bank_name || "") === bank);
    }
    if (activeSlice.key.startsWith("alert:")) {
      const id = activeSlice.key.slice("alert:".length);
      return records.filter((record: any) => String(record.booking_id) === id);
    }
    if (activeSlice.key.startsWith("upcoming:")) {
      const key = activeSlice.key.slice("upcoming:".length);
      return data.upcoming?.[key] || [];
    }
    if (activeSlice.key.startsWith("delay:")) {
      const key = activeSlice.key.slice("delay:".length);
      return records.filter((record: any) => Number(record[`${key}_delay_days`]) > 0);
    }
    if (type === "indicator") {
      if (section === "booking" && metric === "today") return records.filter((record: any) => isSameDay(record.booking_date || record.created_at, now));
      if (section === "booking" && metric === "this_week") return records.filter((record: any) => isThisWeek(record.booking_date || record.created_at, now));
      if (section === "booking" && metric === "this_month") return records.filter((record: any) => isThisMonth(record.booking_date || record.created_at, now));
      if (section === "booking" && metric === "last_month") return records.filter((record: any) => isLastMonth(record.booking_date || record.created_at, now));
      if (section === "registration" && metric === "due_this_week") return records.filter((record: any) => !record.actual_registration_date && isThisWeek(record.expected_registration_date, now));
      if (section === "registration" && metric === "completed_this_week") return records.filter((record: any) => isThisWeek(record.actual_registration_date, now));
      if (section === "registration" && metric === "pending") return records.filter((record: any) => !record.actual_registration_date);
      if (section === "registration" && metric === "delayed") return records.filter((record: any) => !record.actual_registration_date && record.registration_delay_days > 0);
      if (section === "loan_sanction" && metric === "pending") return records.filter((record: any) => recordReachesStage(record, "loan_applied") && !recordReachesStage(record, "loan_sanctioned"));
      if (section === "loan_sanction" && metric === "approved") return records.filter((record: any) => recordReachesStage(record, "loan_sanctioned"));
      if (section === "loan_sanction" && metric === "rejected") return records.filter((record: any) => String(record.loan_status || record.sanction_status || "").toLowerCase().includes("reject"));
      if (section === "loan_sanction" && metric === "processing") return records.filter((record: any) => String(record.loan_status || "").toLowerCase().includes("process"));
      if (section === "ocr" && metric === "pending") return records.filter((record: any) => !recordReachesStage(record, "ocr_completed"));
      if (section === "ocr" && metric === "received") return records.filter((record: any) => recordReachesStage(record, "ocr_completed"));
      if (section === "ocr" && metric === "this_week") return records.filter((record: any) => isThisWeek(record.ocr_received_date, now));
      if (section === "ocr" && metric === "this_month") return records.filter((record: any) => isThisMonth(record.ocr_received_date, now));
      if (section === "sdr" && metric === "pending") return records.filter((record: any) => !recordReachesStage(record, "sdr_paid"));
      if (section === "sdr" && metric === "completed") return records.filter((record: any) => recordReachesStage(record, "sdr_paid"));
      if (section === "sdr" && metric === "due_this_week") return records.filter((record: any) => !recordReachesStage(record, "sdr_paid") && isThisWeek(record.sdr_due_date, now));
      if (section === "disbursement" && metric === "due_this_week") return records.filter((record: any) => !record.actual_disbursement_date && isThisWeek(record.expected_disbursement_date, now));
      if (section === "disbursement" && metric === "due_this_month") return records.filter((record: any) => !record.actual_disbursement_date && isThisMonth(record.expected_disbursement_date, now));
      if (section === "disbursement" && metric === "received") return records.filter((record: any) => recordReachesStage(record, "disbursement"));
      if (section === "disbursement" && metric === "delayed") return records.filter((record: any) => !record.actual_disbursement_date && record.disbursement_delay_days > 0);
      if (section === "cash_component" && metric === "pending") return records.filter((record: any) => parseRevenueAmount(record.cash_component) > 0 && !record.cash_component_date);
      if (section === "cash_component" && metric === "received") return records.filter((record: any) => parseRevenueAmount(record.cash_component) > 0 && !!record.cash_component_date);
      if (section === "cash_component" && metric === "outstanding") return records.filter((record: any) => parseRevenueAmount(record.cash_component) > 0 && !record.cash_component_date);
    }

    return records.slice(0, 30);
  }, [activeSlice, data]);

  const sortedManagers = useMemo(() => {
    const managers = [...(data.sales_managers || [])];
    if (sortMode === "highest_agreement") return managers.sort((a, b) => b.agreement_value - a.agreement_value);
    if (sortMode === "highest_bookings") return managers.sort((a, b) => b.bookings - a.bookings);
    return managers.sort((a, b) => b.revenue_received - a.revenue_received);
  }, [data.sales_managers, sortMode]);

  const exportRows = () => getReportRows(reportType, data, recordsForSlice.length ? recordsForSlice : data.records || []);

  const handleExportCsv = () => {
    const rows = exportRows();
    downloadBlob(new Blob([makeCsv(rows)], { type: "text/csv;charset=utf-8" }), `${reportType}.csv`);
  };

  const handleExportExcel = async () => {
    const rows = exportRows();
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Revenue Intelligence");
    XLSX.writeFile(workbook, `${reportType}.xlsx`);
  };

  const handleExportPdf = () => {
    const previousTitle = document.title;
    document.title = `${reportTypes.find((type) => type.value === reportType)?.label || "Revenue Report"} - Bhoomi CRM`;
    window.print();
    window.setTimeout(() => {
      document.title = previousTitle;
    }, 500);
  };

  const summaryCards = [
    {
      label: "Total Agreement Value",
      value: formatRevenueAmount(data.summary.total_agreement_value),
      sub: `${data.total || 0} confirmed bookings`,
      icon: IndianRupee,
      tone: "magenta",
      key: "total_agreement",
    },
    {
      label: "Expected Revenue",
      value: formatRevenueAmount(data.summary.expected_revenue),
      sub: "This Month",
      icon: TrendingUp,
      tone: "cyan",
      key: "expected_month",
    },
    {
      label: "Revenue Received",
      value: formatRevenueAmount(data.summary.revenue_received),
      sub: "Actual disbursement",
      icon: Banknote,
      tone: "emerald",
      key: "received_month",
    },
    {
      label: "Pending Revenue",
      value: formatRevenueAmount(data.summary.pending_revenue),
      sub: "This Month",
      icon: Wallet,
      tone: "amber",
      key: "pending_month",
    },
    {
      label: "Collection Efficiency",
      value: `${data.summary.collection_efficiency || 0}%`,
      sub: "Received / Expected",
      icon: Activity,
      tone: "violet",
      key: "collection_efficiency",
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
  ];

  const forecastCards = [
    { label: "Next 7 Days", value: data.forecast.next_7_days, days: 7, tone: "cyan" },
    { label: "Next 15 Days", value: data.forecast.next_15_days, days: 15, tone: "emerald" },
    { label: "Next 30 Days", value: data.forecast.next_30_days, days: 30, tone: "amber" },
    { label: "Next 90 Days", value: data.forecast.next_90_days, days: 90, tone: "violet" },
  ];

  const delayCards = [
    { label: "Registration Delay", key: "registration", value: data.delays.registration_delay || 0, tone: "emerald" },
    { label: "Loan Delay", key: "loan", value: data.delays.loan_delay || 0, tone: "violet" },
    { label: "OCR Delay", key: "ocr", value: data.delays.ocr_delay || 0, tone: "amber" },
    { label: "SDR Delay", key: "sdr", value: data.delays.sdr_delay || 0, tone: "magenta" },
    { label: "Disbursement Delay", key: "disbursement", value: data.delays.disbursement_delay || 0, tone: "rose" },
  ];

  const options = data.filters || {};
  const selectClass = `h-10 rounded-lg px-3 text-sm outline-none ${theme.select || theme.inputBg}`;
  const inputClass = `h-10 rounded-lg px-3 text-sm outline-none ${theme.inputBg} ${theme.text}`;

  if (isLoading) {
    return (
      <div className={`h-full overflow-y-auto p-4 md:p-6 ${theme.mainBg}`}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className={`h-32 rounded-lg border animate-pulse ${isDark ? "bg-white/5 border-white/10" : "bg-white border-slate-200"}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-6 ${theme.mainBg}`}>
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black tracking-tight ${theme.accentText}`}>Revenue Intelligence</h1>
          <p className={`text-sm mt-1 ${theme.textMuted}`}>Updated {formatDateTime(data.updated_at)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={reportType} onChange={(event) => setReportType(event.target.value)} className={selectClass} aria-label="Report type">
            {reportTypes.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          <button onClick={handleExportCsv} className={`h-10 px-3 rounded-lg text-sm font-bold inline-flex items-center gap-2 ${theme.btnSecondary}`}>
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={handleExportExcel} className={`h-10 px-3 rounded-lg text-sm font-bold inline-flex items-center gap-2 ${theme.btnPrimary}`}>
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button onClick={handleExportPdf} className={`h-10 px-3 rounded-lg text-sm font-bold inline-flex items-center gap-2 ${isDark ? "bg-white/10 text-white border border-white/10 hover:bg-white/15" : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"}`}>
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button onClick={() => fetchDashboard(true)} disabled={isRefreshing} className={`h-10 w-10 rounded-lg inline-flex items-center justify-center ${theme.toggleWrap}`} aria-label="Refresh dashboard">
            <RefreshCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className={`rounded-lg border p-4 flex items-center gap-3 ${statusPillClass(isDark, "danger")}`}>
          <XCircle className="w-5 h-5" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      )}

      <section className={`rounded-lg border p-4 ${theme.tableWrap}`} style={theme.tableGlass}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className={`flex items-center gap-2 font-bold ${theme.text}`}>
            <Filter className="w-4 h-4 text-[#9E217B]" /> Advanced Filters
          </div>
          <button onClick={resetFilters} className={`text-xs font-bold px-3 py-2 rounded-lg border ${isDark ? "border-white/10 text-gray-300 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            Clear
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          <select value={filters.project} onChange={(e) => setFilter("project", e.target.value)} className={selectClass} aria-label="Project">
            <option value="">All Projects</option>
            {(options.projects || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.building} onChange={(e) => setFilter("building", e.target.value)} className={selectClass} aria-label="Building">
            <option value="">All Buildings</option>
            {(options.buildings || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.wing} onChange={(e) => setFilter("wing", e.target.value)} className={selectClass} aria-label="Wing">
            <option value="">All Wings</option>
            {(options.wings || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.floor} onChange={(e) => setFilter("floor", e.target.value)} className={selectClass} aria-label="Floor">
            <option value="">All Floors</option>
            {(options.floors || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.sales_manager} onChange={(e) => setFilter("sales_manager", e.target.value)} className={selectClass} aria-label="Sales Manager">
            <option value="">All Sales Managers</option>
            {(options.sales_managers || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.bank} onChange={(e) => setFilter("bank", e.target.value)} className={selectClass} aria-label="Bank">
            <option value="">All Banks</option>
            {(options.banks || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.loan_status} onChange={(e) => setFilter("loan_status", e.target.value)} className={selectClass} aria-label="Loan Status">
            <option value="">Loan Status</option>
            {(options.loan_statuses || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.registration_status} onChange={(e) => setFilter("registration_status", e.target.value)} className={selectClass} aria-label="Registration Status">
            <option value="">Registration Status</option>
            {(options.registration_statuses || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filters.disbursement_status} onChange={(e) => setFilter("disbursement_status", e.target.value)} className={selectClass} aria-label="Disbursement Status">
            <option value="">Disbursement Status</option>
            {(options.disbursement_statuses || []).map((value: string) => <option key={value} value={value}>{value}</option>)}
          </select>
          <input type="date" value={filters.date_from} onChange={(e) => setFilter("date_from", e.target.value)} className={inputClass} aria-label="Date from" />
          <input type="date" value={filters.date_to} onChange={(e) => setFilter("date_to", e.target.value)} className={inputClass} aria-label="Date to" />
          <div className="grid grid-cols-2 gap-2">
            <input value={filters.revenue_min} onChange={(e) => setFilter("revenue_min", e.target.value)} className={inputClass} placeholder="Min value" aria-label="Minimum revenue" />
            <input value={filters.revenue_max} onChange={(e) => setFilter("revenue_max", e.target.value)} className={inputClass} placeholder="Max value" aria-label="Maximum revenue" />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {summaryCards.map(({ label, value, sub, icon: Icon, tone, key }) => (
          <button
            key={label}
            onClick={() => openSlice(key, label)}
            className={`text-left rounded-lg border p-4 min-h-32 transition-all hover:-translate-y-0.5 ${cardTone(tone, isDark)}`}
            style={theme.cardGlass}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-bold uppercase ${theme.textMuted}`}>{label}</p>
                <p className={`text-2xl font-black mt-3 break-words ${theme.text}`}>{value}</p>
                <p className={`text-xs mt-2 ${theme.textMuted}`}>{sub}</p>
              </div>
              <span className={`w-10 h-10 rounded-lg border inline-flex items-center justify-center ${statusPillClass(isDark, "info")}`}>
                <Icon className="w-5 h-5" />
              </span>
            </div>
          </button>
        ))}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4">
        {indicatorSections.map(({ title, icon: Icon, tone, section, rows }) => (
          <div key={title} className={`rounded-lg border p-4 ${cardTone(tone, isDark)}`}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-4 h-4 text-[#9E217B]" />
              <h2 className={`font-black ${theme.text}`}>{title}</h2>
            </div>
            <div className="space-y-2">
              {rows.map(([label, metric]) => {
                const value = data.indicators?.[section]?.[metric] || 0;
                const displayValue = section === "cash_component" && metric === "outstanding" ? formatRevenueAmount(value) : value;
                return (
                  <button
                    key={metric}
                    onClick={() => openSlice(`indicator:${section}:${metric}`, `${title} - ${label}`)}
                    className={`w-full h-9 px-3 rounded-lg flex items-center justify-between text-sm border transition-colors ${isDark ? "bg-black/10 border-white/10 hover:bg-white/5" : "bg-white/70 border-white hover:bg-white"}`}
                  >
                    <span className={theme.textMuted}>{label}</span>
                    <span className={`font-black ${theme.text}`}>{displayValue}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {forecastCards.map(({ label, value, days, tone }) => (
          <button
            key={label}
            onClick={() => openSlice(`forecast:${days}`, label)}
            className={`rounded-lg border p-4 text-left min-h-28 ${cardTone(tone, isDark)}`}
          >
            <p className={`text-xs font-bold uppercase ${theme.textMuted}`}>{label}</p>
            <p className={`text-2xl font-black mt-3 ${theme.text}`}>{formatRevenueAmount(value || 0)}</p>
          </button>
        ))}
      </section>

      <section className={`rounded-lg border p-4 ${theme.tableWrap}`} style={theme.tableGlass}>
        <div className="flex items-center gap-2 mb-4">
          <Layers3 className="w-5 h-5 text-[#9E217B]" />
          <h2 className={`font-black ${theme.text}`}>Booking Pipeline Analytics</h2>
        </div>
        <div className="overflow-x-auto">
          <div className="flex items-stretch gap-3 min-w-[920px]">
            {(data.pipeline?.length ? data.pipeline : REVENUE_STAGES.map((stage) => ({ ...stage, count: 0, value: 0 }))).map((stage: any, index: number) => (
              <React.Fragment key={stage.id}>
                <button
                  onClick={() => openSlice(`stage:${stage.id}`, stage.label)}
                  className={`w-32 rounded-lg border p-3 text-left flex-shrink-0 ${index % 2 === 0 ? cardTone("cyan", isDark) : cardTone("magenta", isDark)}`}
                >
                  <p className={`text-xs font-bold ${theme.textMuted}`}>{stage.label}</p>
                  <p className={`text-3xl font-black mt-2 ${theme.text}`}>{stage.count}</p>
                  <p className={`text-[11px] mt-1 ${theme.textMuted}`}>{formatRevenueAmount(stage.value || 0)}</p>
                </button>
                {index < REVENUE_STAGES.length - 1 && (
                  <div className="flex items-center text-[#9E217B]">
                    <ChevronRight className="w-5 h-5" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)] gap-4">
        <div className={`rounded-lg border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
          <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${theme.tableBorder}`}>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#9E217B]" />
              <h2 className={`font-black ${theme.text}`}>Sales Manager Performance</h2>
            </div>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className={selectClass} aria-label="Sort managers">
              <option value="highest_revenue">Highest Revenue</option>
              <option value="highest_agreement">Highest Agreement Value</option>
              <option value="highest_bookings">Highest Bookings</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={theme.tableHead}>
                <tr>
                  {["Sales Manager", "Bookings", "Agreement Value", "Revenue Received", "Pending"].map((header) => (
                    <th key={header} className={`px-4 py-3 text-left font-bold ${theme.text}`}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedManagers.map((manager: any) => (
                  <tr key={manager.name} onClick={() => openSlice(`manager:${manager.name}`, manager.name)} className={`cursor-pointer ${theme.tableRow}`}>
                    <td className={`px-4 py-3 font-bold ${theme.text}`}>{manager.name}</td>
                    <td className={`px-4 py-3 ${theme.textMuted}`}>{manager.bookings}</td>
                    <td className={`px-4 py-3 ${theme.text}`}>{formatRevenueAmount(manager.agreement_value)}</td>
                    <td className="px-4 py-3 text-emerald-500 font-bold">{formatRevenueAmount(manager.revenue_received)}</td>
                    <td className="px-4 py-3 text-amber-500 font-bold">{formatRevenueAmount(manager.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
          {delayCards.map((delay) => (
            <button key={delay.key} onClick={() => openSlice(`delay:${delay.key}`, delay.label)} className={`rounded-lg border p-4 text-left ${cardTone(delay.tone, isDark)}`}>
              <p className={`text-xs font-bold uppercase ${theme.textMuted}`}>{delay.label}</p>
              <p className={`text-2xl font-black mt-2 ${theme.text}`}>{delay.value} Days</p>
            </button>
          ))}
        </div>
      </section>

      <UpcomingActivities data={data} theme={theme} isDark={isDark} openSlice={openSlice} />

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PerformanceTable
          title="Project Performance"
          icon={Building2}
          rows={data.projects || []}
          headers={["Project", "Total Flats", "Booked", "Available", "Reg. Pending", "Disb. Pending", "Revenue"]}
          renderRow={(row: any) => [
            row.name,
            row.total_flats,
            row.booked,
            row.available,
            row.registration_pending,
            row.disbursement_pending,
            formatRevenueAmount(row.revenue_generated),
          ]}
          onRowClick={(row: any) => openSlice(`project:${row.name}`, row.name)}
          theme={theme}
        />
        <PerformanceTable
          title="Bank Performance"
          icon={Landmark}
          rows={data.banks || []}
          headers={["Bank", "Loan Count", "Approved", "Pending", "Rejected", "Disbursed"]}
          renderRow={(row: any) => [row.name, row.loan_count, row.approved, row.pending, row.rejected, row.disbursed]}
          onRowClick={(row: any) => openSlice(`bank:${row.name}`, row.name)}
          theme={theme}
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)] gap-4">
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

      <section ref={recordsRef} className={`rounded-lg border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
        <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${theme.tableBorder}`}>
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-[#9E217B]" />
            <h2 className={`font-black ${theme.text}`}>{activeSlice.label}</h2>
            <span className={`text-xs px-2 py-1 rounded-full border ${statusPillClass(isDark, "muted")}`}>{recordsForSlice.length}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={theme.tableHead}>
              <tr>
                {["Booking", "Customer", "Flat", "Stage", "Agreement", "Expected", "Received", "Pending", "Disbursement"].map((header) => (
                  <th key={header} className={`px-4 py-3 text-left font-bold ${theme.text}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recordsForSlice.length === 0 ? (
                <tr>
                  <td colSpan={9} className={`px-4 py-10 text-center ${theme.textMuted}`}>No records found.</td>
                </tr>
              ) : recordsForSlice.map((record: any) => (
                <tr key={record.booking_id} className={theme.tableRow}>
                  <td className={`px-4 py-3 font-bold whitespace-nowrap ${theme.text}`}>{record.booking_number || `BKG-${record.booking_id}`}</td>
                  <td className={`px-4 py-3 ${theme.text}`}>
                    <p className="font-bold">{record.customer_name}</p>
                    <p className={`text-xs ${theme.textMuted}`}>{record.sales_manager || "-"}</p>
                  </td>
                  <td className={`px-4 py-3 ${theme.textMuted}`}>{flatLabel(record)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full border text-xs font-bold ${statusPillClass(isDark, record.derived_stage === "completed" ? "success" : record.days_delayed > 0 ? "warning" : "info")}`}>
                      {record.derived_stage_label}
                    </span>
                  </td>
                  <td className={`px-4 py-3 ${theme.text}`}>{formatRevenueAmount(record.agreement_value_number)}</td>
                  <td className={`px-4 py-3 ${theme.text}`}>{formatRevenueAmount(record.expected_revenue)}</td>
                  <td className="px-4 py-3 text-emerald-500 font-bold">{formatRevenueAmount(record.actual_revenue)}</td>
                  <td className="px-4 py-3 text-amber-500 font-bold">{formatRevenueAmount(record.pending_revenue)}</td>
                  <td className={`px-4 py-3 ${theme.textMuted}`}>{formatDate(record.expected_disbursement_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
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
    <section className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-5 gap-4">
      {tables.map((table) => (
        <div key={table.key} className={`rounded-lg border overflow-hidden ${cardTone(table.tone, isDark)}`}>
          <button onClick={() => openSlice(`upcoming:${table.key}`, table.title)} className="w-full p-4 text-left flex items-center justify-between gap-3">
            <h2 className={`font-black ${theme.text}`}>{table.title}</h2>
            <span className={`text-xs font-black px-2 py-1 rounded-full border ${statusPillClass(isDark, "muted")}`}>{data.upcoming?.[table.key]?.length || 0}</span>
          </button>
          <div className={`border-t ${isDark ? "border-white/10" : "border-white"}`}>
            {(data.upcoming?.[table.key] || []).slice(0, 5).map((record: any) => (
              <button key={`${table.key}-${record.booking_id}`} onClick={() => openSlice(`alert:${record.booking_id}`, record.customer_name)} className={`w-full px-4 py-3 text-left border-b last:border-b-0 ${isDark ? "border-white/10 hover:bg-white/5" : "border-white hover:bg-white/70"}`}>
                <p className={`font-bold text-sm truncate ${theme.text}`}>{record.customer_name}</p>
                <p className={`text-xs mt-1 ${theme.textMuted}`}>{flatLabel(record)} | {formatDate(record[table.dateKey])}</p>
              </button>
            ))}
            {(!data.upcoming?.[table.key] || data.upcoming[table.key].length === 0) && (
              <p className={`px-4 py-6 text-sm text-center ${theme.textMuted}`}>No records</p>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function PerformanceTable({ title, icon: Icon, rows, headers, renderRow, onRowClick, theme }: any) {
  return (
    <div className={`rounded-lg border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className={`p-4 border-b flex items-center gap-2 ${theme.tableBorder}`}>
        <Icon className="w-5 h-5 text-[#9E217B]" />
        <h2 className={`font-black ${theme.text}`}>{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={theme.tableHead}>
            <tr>
              {headers.map((header: string) => (
                <th key={header} className={`px-4 py-3 text-left font-bold whitespace-nowrap ${theme.text}`}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className={`px-4 py-8 text-center ${theme.textMuted}`}>No records found.</td></tr>
            ) : rows.map((row: any) => (
              <tr key={row.name} onClick={() => onRowClick(row)} className={`cursor-pointer ${theme.tableRow}`}>
                {renderRow(row).map((value: any, index: number) => (
                  <td key={`${row.name}-${index}`} className={`px-4 py-3 whitespace-nowrap ${index === 0 ? `font-bold ${theme.text}` : theme.textMuted}`}>{value}</td>
                ))}
              </tr>
            ))}
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
  const firstDay = new Date(year, monthIndex, 1);
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlankDays = firstDay.getDay();
  const todayKey = toDateKey(new Date());

  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    const pushEvent = (dateValue: unknown, record: any, label: string, completed: boolean) => {
      const key = toDateKey(dateValue);
      if (!key) return;
      const delayed = !completed && todayKey && key < todayKey;
      if (!map[key]) map[key] = [];
      map[key].push({ record, label, completed, delayed });
    };

    records.forEach((record: any) => {
      pushEvent(record.expected_registration_date || record.actual_registration_date, record, "Registration", !!record.actual_registration_date);
      pushEvent(record.sanction_date, record, "Loan Sanction", !!record.sanction_date);
      pushEvent(record.ocr_received_date || addDays(record.booking_date || record.application_date, 7), record, "OCR", !!record.ocr_received_date);
      pushEvent(record.sdr_due_date, record, "SDR", recordReachesStage(record, "sdr_paid"));
      pushEvent(record.expected_disbursement_date || record.actual_disbursement_date, record, "Disbursement", !!record.actual_disbursement_date);
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

  return (
    <div className={`rounded-lg border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className={`p-4 border-b flex items-center justify-between gap-3 ${theme.tableBorder}`}>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-[#9E217B]" />
          <h2 className={`font-black ${theme.text}`}>Revenue Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeMonth(-1)} className={`h-9 w-9 rounded-lg border ${isDark ? "border-white/10 hover:bg-white/5" : "border-slate-200 hover:bg-slate-50"}`}>‹</button>
          <span className={`text-sm font-bold min-w-28 text-center ${theme.text}`}>{monthDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>
          <button onClick={() => changeMonth(1)} className={`h-9 w-9 rounded-lg border ${isDark ? "border-white/10 hover:bg-white/5" : "border-slate-200 hover:bg-slate-50"}`}>›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-bold uppercase">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className={`py-2 ${theme.textMuted}`}>{day}</div>
        ))}
      </div>
      <div className={`grid grid-cols-7 border-t ${isDark ? "border-white/10" : "border-slate-200"}`}>
        {cells.map((day, index) => {
          const key = day ? `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
          const events = key ? eventsByDate[key] || [] : [];
          return (
            <div key={`${day || "blank"}-${index}`} className={`min-h-28 p-2 border-r border-b last:border-r-0 ${isDark ? "border-white/10" : "border-slate-200"} ${!day ? "opacity-30" : ""}`}>
              {day && <p className={`text-xs font-black mb-2 ${key === todayKey ? "text-[#9E217B]" : theme.text}`}>{day}</p>}
              <div className="space-y-1">
                {events.slice(0, 3).map((event, eventIndex) => (
                  <button
                    key={`${event.record.booking_id}-${event.label}-${eventIndex}`}
                    onClick={() => openSlice(`alert:${event.record.booking_id}`, event.record.customer_name)}
                    className={`w-full text-left px-2 py-1 rounded text-[10px] font-bold truncate border ${
                      event.completed
                        ? statusPillClass(isDark, "success")
                        : event.delayed
                          ? statusPillClass(isDark, "danger")
                          : statusPillClass(isDark, "warning")
                    }`}
                  >
                    {event.label}
                  </button>
                ))}
                {events.length > 3 && <p className={`text-[10px] ${theme.textMuted}`}>+{events.length - 3}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SmartAlerts({ alerts, openSlice, theme, isDark }: any) {
  return (
    <div className={`rounded-lg border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
      <div className={`p-4 border-b flex items-center justify-between gap-3 ${theme.tableBorder}`}>
        <div className="flex items-center gap-2">
          <BellRing className="w-5 h-5 text-[#9E217B]" />
          <h2 className={`font-black ${theme.text}`}>Smart Alerts</h2>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full border ${statusPillClass(isDark, alerts.length ? "warning" : "success")}`}>{alerts.length}</span>
      </div>
      <div className="max-h-[540px] overflow-y-auto custom-scrollbar">
        {alerts.length === 0 ? (
          <div className={`p-8 text-center ${theme.textMuted}`}>
            <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-60" />
            <p className="text-sm">No alerts found.</p>
          </div>
        ) : alerts.map((alert: any, index: number) => (
          <button
            key={`${alert.booking_id}-${alert.title}-${index}`}
            onClick={() => openSlice(`alert:${alert.booking_id}`, alert.title)}
            className={`w-full p-4 border-b last:border-b-0 text-left flex items-start gap-3 ${isDark ? "border-white/10 hover:bg-white/5" : "border-slate-200 hover:bg-slate-50"}`}
          >
            <span className={`w-9 h-9 rounded-lg border inline-flex items-center justify-center flex-shrink-0 ${statusPillClass(isDark, alert.type === "danger" ? "danger" : alert.type === "warning" ? "warning" : "success")}`}>
              <AlertTriangle className="w-4 h-4" />
            </span>
            <span className="min-w-0">
              <span className={`block font-bold text-sm ${theme.text}`}>{alert.title}</span>
              <span className={`block text-xs mt-1 truncate ${theme.textMuted}`}>{alert.customer_name} | {alert.booking_number}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
