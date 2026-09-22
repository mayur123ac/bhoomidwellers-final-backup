"use client";

/* ══════════════════════════════════════════════════════════════════════════
   RevenueIntelligenceView.tsx — Bhoomi Dwellers CRM

   One table of every booking in hand, with the money split into the three
   things that actually arrive separately:

     AV  ·  OCR received  ·  Loan disbursed  ·  Balance

   OCR is entered as a RECEIPT, not as a field. Pressing "+" on an OCR cell
   appends a credit row to financial_ledger; the figure shown is always the
   sum of those rows. That keeps financialEngine.ts the single source of
   truth and leaves the reversal chain intact — a mistyped receipt gets
   reversed, never overwritten.

   Progressive disclosure:
     · Click a row  → case drawer: detail, receipt history, follow-up thread
     · Click "+"    → record an OCR receipt (Admin / Site Head only)
     · Click "i"    → plain-language explainer of every derived figure
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  ChevronDownIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  HandCoins,
  Info,
  Landmark,
  Loader,
  MessageSquarePlus,
  Plus,
  RefreshCcw,
  Search,
  Send,
  User,
  Wallet,
  X,
} from "lucide-react";

import RevenueChatDock from "@/components/RevenueChatDock";
import ClosedLeadBookingView from "@/components/ClosedLeadBookingView";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";

/* ─────────────────────────────── config ─────────────────────────────── */
const DASHBOARD_ENDPOINT = "/api/revenue-intelligence";
const paymentSummaryUrl = (bookingId: number | string) => `/api/booking-applications/${bookingId}/payment-summary`;
const receiptsUrl = (bookingId: number | string) => `/api/booking-applications/${bookingId}/receipts`;
const bookingApplicationUrl = (bookingId: number | string) => `/api/booking-applications/${bookingId}`;
const followupsUrl = () => `/api/followups`;

const ACCENT = "#007AFF"; // Apple Blue
const ACCENT_DARK = "#0A84FF";
const PAGE_SIZE = 25;
const REFRESH_MS = 60_000;

const canRecordMoney = (role?: string) => {
  const clean = (role || "").trim().toLowerCase();
  return clean === "admin" || clean === "site_head" || clean === "site head";
};

const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "UPI", "Cash", "Demand Draft"];

/* ─────────────────────────────── types ─────────────────────────────── */

type Props = {
  isDark: boolean;
  theme: any;
  user?: { name: string; role: string };
};

type StatusTone = "done" | "partial" | "processing" | "idle";

type Row = {
  id: string;
  srNo: number | string;
  leadId: number | string | null;
  bookingId: number | string | null;
  bookingNumber: string;
  customerName: string;
  customerNote: string;
  agreementValue: number;
  ocrReceived: number;
  ownContributionRequired: number;
  sanctionedAmount: number;
  sanctionedDate: string | null;
  disbursement: number;
  registrationAmount: number;
  balance: number;
  salesManager: string;
  flatNo: string;
  bankerDetails: string;
  statusText: string;
  statusTone: StatusTone;
  raw: any;
};

type SortKey =
  | "srNo"
  | "customerName"
  | "agreementValue"
  | "ocrReceived"
  | "sanctionedAmount"
  | "disbursement"
  | "registrationAmount"
  | "balance"
  | "salesManager"
  | "flatNo"
  | "statusText"
  | "sanctionedDate";

type Followup = {
  _id: number | string;
  leadId: string;
  message: string;
  salesManagerName?: string;
  createdBy?: string;
  siteVisitDate?: string | null;
  createdAt?: string;
};

/* ───────────────────────────── formatting ───────────────────────────── */

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const inr = (value: unknown) => {
  const n = toNumber(value);
  return n === 0 ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const compact = (value: unknown) => {
  const n = toNumber(value);
  const trim = (x: number, d: number) => x.toFixed(d).replace(/\.?0+$/, "");
  if (Math.abs(n) >= 1e7) return `₹${trim(n / 1e7, 2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${trim(n / 1e5, 2)} L`;
  if (Math.abs(n) >= 1e3) return `₹${trim(n / 1e3, 1)} K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const shortDate = (value: unknown) => {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const relativeTime = (value: unknown) => {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/* ──────────────────────── status normalisation ──────────────────────── */

function readStatus(raw: string): { text: string; tone: StatusTone } {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return { text: "Not started", tone: "idle" };

  const registered = /reg/.test(s) && /done|complete/.test(s);
  const disbPending = /pend|prnd|pnding/.test(s);

  if (registered && disbPending) return { text: "Registered · disbursement pending", tone: "partial" };
  if (/^done$|complete|disbursed/.test(s)) return { text: "Done", tone: "done" };
  if (registered) return { text: "Registration done", tone: "partial" };
  if (/process|progress|in proc/.test(s)) return { text: "In process", tone: "processing" };
  if (/reject|declin/.test(s)) return { text: "Rejected", tone: "idle" };

  return { text: raw.trim(), tone: "processing" };
}

/* ────────────────────────── API → row mapping ────────────────────────── */

function splitName(fullName: string) {
  const match = String(fullName || "").match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!match) return { name: String(fullName || "").trim() || "Unnamed", note: "" };
  return { name: match[1].trim(), note: match[2].trim() };
}

function flatOf(record: any) {
  const parts = [record.wing, record.floor ?? record.floor_number, record.flat_number ?? record.flat_no].filter(
    (p) => p !== null && p !== undefined && String(p).trim() !== ""
  );
  return parts.length ? parts.join(" ") : "—";
}

function bankerOf(record: any) {
  const bank = record.bank_name || record.bank || "";
  const person = record.loan_executive || record.dsa_agent_name || record.banker_name || "";
  if (bank && person) return `${person} (${bank})`;
  return bank || person || "—";
}

function mapRecords(records: any[]): Row[] {
  return records.map((record, index) => {
    const { name, note } = splitName(record.customer_name);
    const status = readStatus(
      record.sanction_registration_status ||
      record.registration_status ||
      record.sanction_status ||
      record.loan_status ||
      ""
    );

    const agreementValue = toNumber(record.agreement_value_number ?? record.agreement_value);
    const ocrReceived = toNumber(record.ocr_received ?? record.actual_own_contribution ?? record.ocr_amount);
    const sanctionedAmount = toNumber(record.sanction_amount ?? record.sanctioned_amount ?? record.loan_sanctioned_amount);
    const disbursement = toNumber(record.disbursement_amount ?? record.total_loan_disbursed ?? record.total_disbursed);
    const registrationAmount = toNumber(record.registration_fee_amount);
    const explicitBalance = record.balance_receivable;

    return {
      id: String(record.booking_id ?? record.lead_id ?? index),
      srNo: record.sr_no ?? record.lead_no ?? index + 1,
      leadId: record.lead_id ?? null,
      bookingId: record.booking_id ?? null,
      bookingNumber: record.booking_number || (record.booking_id ? `BKG-${record.booking_id}` : "—"),
      customerName: name,
      customerNote: note,
      agreementValue,
      ocrReceived,
      ownContributionRequired: toNumber(record.required_own_contribution),
      sanctionedAmount,
      sanctionedDate: record.sanction_date || null,
      disbursement,
      registrationAmount,
      balance: explicitBalance !== null && explicitBalance !== undefined ? toNumber(explicitBalance) : Math.max(0, agreementValue - ocrReceived - disbursement),
      salesManager: record.sales_manager || "Unassigned",
      flatNo: flatOf(record),
      bankerDetails: bankerOf(record),
      statusText: status.text,
      statusTone: status.tone,
      raw: record,
    };
  });
}

/* ───────────────────────────── style atoms ───────────────────────────── */

function toneClasses(tone: StatusTone, isDark: boolean) {
  const map: Record<StatusTone, string> = {
    done: isDark
      ? "bg-[#32D74B]/15 text-[#32D74B]"
      : "bg-[#EBF9EE] text-[#34C759]",
    partial: isDark
      ? "bg-[#64D2FF]/15 text-[#64D2FF]"
      : "bg-[#E5F5FF] text-[#00AEEF]",
    processing: isDark
      ? "bg-[#FF9F0A]/15 text-[#FF9F0A]"
      : "bg-[#FFF4E5] text-[#FF9500]",
    idle: isDark ? "bg-[#2C2C2E] text-[#8E8E93]" : "bg-[#F2F2F7] text-[#8E8E93]",
  };
  return map[tone];
}

function StatusChip({ row, isDark }: { row: Row; isDark: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[10px] font-semibold tracking-wide leading-none whitespace-nowrap ${toneClasses(
        row.statusTone,
        isDark
      )}`}
      title={row.statusText}
    >
      {row.statusText}
    </span>
  );
}

/* ═══════════════════════════════ main ═══════════════════════════════ */

export default function RevenueIntelligenceView({ isDark, theme, user }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [manager, setManager] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | StatusTone>("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "srNo", dir: "asc" });
  const [page, setPage] = useState(1);

  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [ocrRow, setOcrRow] = useState<Row | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const mayRecord = canRecordMoney(user?.role) && !!user?.name;

  /* ── load ── */
  const load = useCallback(async (quiet = false) => {
    quiet ? setIsRefreshing(true) : setIsLoading(true);
    setError("");
    try {
      const res = await fetch(DASHBOARD_ENDPOINT, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Revenue intelligence could not load.");
      setRows(mapRecords(json.data?.records || []));
      setUpdatedAt(json.data?.updated_at || new Date().toISOString());
    } catch (err: any) {
      setError(err.message || "Revenue intelligence could not load.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load(true);
    }, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) load(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /* ── derive ── */
  const managers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.salesManager))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (manager && row.salesManager !== manager) return false;
      if (statusFilter && row.statusTone !== statusFilter) return false;
      if (!term) return true;
      return `${row.customerName} ${row.customerNote} ${row.flatNo} ${row.bankerDetails} ${row.salesManager} ${row.bookingNumber}`
        .toLowerCase()
        .includes(term);
    });
  }, [rows, search, manager, statusFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const { key, dir } = sort;
    copy.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "en", { numeric: true });
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const p = Math.min(page, totalPages);
    return sorted.slice((p - 1) * PAGE_SIZE, (p - 1) * PAGE_SIZE + PAGE_SIZE);
  }, [sorted, page, totalPages]);

  const totals = useMemo(() => {
    const av = filtered.reduce((s, r) => s + r.agreementValue, 0);
    const ocr = filtered.reduce((s, r) => s + r.ocrReceived, 0);
    const sanctioned = filtered.reduce((s, r) => s + r.sanctionedAmount, 0);
    const disb = filtered.reduce((s, r) => s + r.disbursement, 0);
    const registration = filtered.reduce((s, r) => s + r.registrationAmount, 0);
    const balance = filtered.reduce((s, r) => s + r.balance, 0);
    const collected = ocr + disb;
    return {
      av,
      ocr,
      sanctioned,
      disb,
      registration,
      balance,
      collected,
      pct: av > 0 ? Math.round((collected / av) * 100) : 0,
      awaiting: filtered.filter((r) => r.statusTone !== "done").length,
    };
  }, [filtered]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));

  useEffect(() => {
    CRMContextManager.update({
      module: "Revenue Intelligence",
      filters: {
        search,
        manager,
        statusFilter,
      },
      metrics: totals,
      totalRows: filtered.length,
      rows: filtered.slice(0, 30),
      selectedRow: openRow,
    });
  }, [search, manager, statusFilter, totals, filtered, openRow]);

  const exportCsv = () => {
    if (!sorted.length) return;
    const header = [
      "#",
      "Customer Name",
      "Note",
      "AV",
      "OCR Received",
      "Sanctioned Amount",
      "Loan Disbursed",
      "Registration Amount",
      "Balance",
      "Sales Manager",
      "Flat No.",
      "Banker Details",
      "Sanction / Regi. Status",
    ];
    const body = sorted.map((r) => [
      r.srNo,
      r.customerName,
      r.customerNote,
      r.agreementValue || "",
      r.ocrReceived || "",
      r.sanctionedAmount || "",
      r.disbursement || "",
      r.registrationAmount || "",
      r.balance || "",
      r.salesManager,
      r.flatNo,
      r.bankerDetails,
      r.statusText,
    ]);
    const escape = (v: any) => {
      const t = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [
      header,
      ...body,
      ["", "Total", "", totals.av, totals.ocr, totals.sanctioned, totals.disb, totals.registration, totals.balance, "", "", "", ""],
    ]
      .map((line) => line.map(escape).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `revenue-intelligence-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className={`h-full flex items-center justify-center font-sans antialiased ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-[3px] border-[#8E8E93] border-t-transparent animate-spin" />
          <p className="text-[15px] font-medium text-[#8E8E93]">Loading revenue intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full overflow-y-auto custom-scrollbar font-sans antialiased ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>
      {/* ═══ Apple-Style Compact Header ═══ */}
      <div className={`sticky top-0 z-20 flex-shrink-0 pt-5 pb-4 px-6 sm:px-10 border-b ${isDark ? "border-white/10 bg-[#1C1C1E]/80 backdrop-blur-xl" : "border-[#E5E5EA] bg-white/80 backdrop-blur-xl"}`}>
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h1 className={`text-base sm:text-xl font-black tracking-tight ${theme.accentText}`}>
                  Revenue Intelligence
                </h1>
                <span className={`px-2 py-0.5 rounded-[6px] text-[10px] font-bold tracking-wide flex items-center gap-1.5 ${isDark ? "bg-[#32D74B]/15 text-[#32D74B]" : "bg-[#EBF9EE] text-[#34C759]"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> LIVE
                </span>
              </div>
              <p className={`text-[12px] sm:text-[13px] font-medium tracking-tight flex items-center gap-1.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                Cash basis · Refreshed {relativeTime(updatedAt) || "now"}
                <button
                  onClick={() => setShowInfo(true)}
                  className={`ml-1 p-0.5 rounded-full transition-colors ${isDark ? "hover:bg-white/10 text-[#8E8E93]" : "hover:bg-black/5 text-[#8E8E93]"}`}
                  title="How this panel works"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="relative">
              <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search bookings..."
                className={`pl-9 pr-4 py-1.5 w-full sm:w-[220px] rounded-full text-[13px] font-medium tracking-tight outline-none transition-colors ${isDark ? "bg-[#2C2C2E] text-white placeholder-[#8E8E93]" : "bg-[#E5E5EA] text-black placeholder-[#8E8E93]"
                  }`}
              />
            </div>

            <div className="relative">
              <select
                value={manager}
                onChange={(e) => { setManager(e.target.value); setPage(1); }}
                className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                  }`}
              >
                <option value="">All Managers</option>
                {managers.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <ChevronDownIcon className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
                className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                  }`}
              >
                <option value="">All Statuses</option>
                <option value="done">Done</option>
                <option value="partial">Registered · disb. pending</option>
                <option value="processing">In process</option>
                <option value="idle">Not started</option>
              </select>
              <ChevronDownIcon className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <button onClick={exportCsv} className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"}`} title="Download CSV">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={() => load(true)} disabled={isRefreshing} className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"}`} title="Refresh">
              <RefreshCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-10 py-6 space-y-6 max-w-[1600px] mx-auto">
        {error && (
          <div className={`rounded-[16px] p-4 flex items-center justify-between ${isDark ? "bg-[#FF453A]/15 border border-[#FF453A]/30" : "bg-[#FFECEB] border border-[#FF3B30]/30"}`}>
            <div>
              <p className={`text-[14px] font-semibold tracking-tight ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>Revenue intelligence could not load</p>
              <p className={`text-[12px] mt-0.5 ${isDark ? "text-[#FF453A]/80" : "text-[#FF3B30]/80"}`}>{error}</p>
            </div>
            <button onClick={() => load()} className={`px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#FF453A] text-white" : "bg-[#FF3B30] text-white"}`}>
              Try again
            </button>
          </div>
        )}

        {/* ═══ Apple-Style KPI Cards ═══ */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: "Booking in hand", value: compact(totals.av), sub: `${filtered.length} booking${filtered.length === 1 ? "" : "s"}`, icon: Building2, color: isDark ? "text-[#0A84FF]" : "text-[#007AFF]", bg: isDark ? "bg-[#0A84FF]/15" : "bg-[#E5F1FF]" },
            { label: "OCR received", value: compact(totals.ocr), sub: "Buyer's contribution", icon: HandCoins, color: isDark ? "text-[#32D74B]" : "text-[#34C759]", bg: isDark ? "bg-[#32D74B]/15" : "bg-[#EBF9EE]" },
            { label: "Loan disbursed", value: compact(totals.disb), sub: "Completed tranches", icon: Landmark, color: isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]", bg: isDark ? "bg-[#BF5AF2]/15" : "bg-[#F7EBFC]" },
            { label: "Collected to date", value: compact(totals.collected), sub: `${totals.pct}% of agreement value`, icon: Banknote, color: isDark ? "text-[#FF9F0A]" : "text-[#FF9500]", bg: isDark ? "bg-[#FF9F0A]/15" : "bg-[#FFF4E5]" },
            { label: "Balance receivable", value: compact(totals.balance), sub: "AV − OCR − disbursed", icon: Wallet, color: isDark ? "text-[#FF453A]" : "text-[#FF3B30]", bg: isDark ? "bg-[#FF453A]/15" : "bg-[#FFECEB]" },
          ].map((tile) => (
            <div key={tile.label} className={`rounded-[20px] sm:rounded-[24px] p-4 sm:p-5 flex flex-col justify-between h-[115px] sm:h-[120px] md:h-[130px] transition-transform hover:scale-[1.02] ${isDark ? "bg-[#1C1C1E] shadow-sm border border-white/5" : "bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-black/5"}`}>
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-[8px] sm:rounded-[10px] flex items-center justify-center flex-shrink-0 ${tile.bg}`}>
                  <tile.icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${tile.color}`} />
                </div>
                <p className={`text-[10px] sm:text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  {tile.label}
                </p>
              </div>
              <div className="mt-auto">
                <p className={`text-[20px] sm:text-[22px] md:text-[24px] font-bold tracking-tight truncate ${isDark ? "text-white" : "text-black"}`}>
                  {tile.value}
                </p>
                <p className={`text-[10px] sm:text-[11px] font-medium mt-0.5 truncate ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  {tile.sub}
                </p>
              </div>
            </div>
          ))}
        </section>

        {/* ═══ Apple-Style Table ═══ */}
        <section className={`rounded-[24px] overflow-hidden border shadow-sm ${isDark ? "bg-[#1C1C1E] border-white/10" : "bg-white border-black/5 shadow-[0_4px_24px_rgba(0,0,0,0.04)]"}`}>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left whitespace-nowrap">
              <thead className={`sticky top-0 z-10 backdrop-blur-xl ${isDark ? "bg-[#1C1C1E]/80 border-b border-[#38383A]" : "bg-[#F9F9F9]/80 border-b border-[#E5E5EA]"}`}>
                <tr>
                  {(
                    [
                      ["srNo", "#", "left"],
                      ["customerName", "Customer name", "left"],
                      ["agreementValue", "AV", "right"],
                      ["ocrReceived", "OCR received", "right"],
                      ["sanctionedAmount", "Sanctioned amt.", "right"],
                      ["disbursement", "Disbursement", "right"],
                      ["registrationAmount", "Registration amt.", "right"],
                      ["balance", "Balance", "right"],
                      ["salesManager", "Sales manager", "left"],
                      ["flatNo", "Flat no.", "left"],
                      [null, "Banker details", "left"],
                      ["statusText", "Sanction / regi. status", "left"],
                      ["sanctionedDate" as SortKey, "Sanction date", "left"],
                    ] as Array<[SortKey | null, string, "left" | "right"]>
                  ).map(([key, label, align]) => (
                    <th key={label} className={`px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"} ${align === "right" ? "text-right" : "text-left"}`}>
                      {key ? (
                        <button
                          onClick={() => toggleSort(key)}
                          className={`inline-flex items-center gap-1 hover:text-black dark:hover:text-white transition-colors ${align === "right" ? "flex-row-reverse" : ""}`}
                        >
                          {label}
                          {sort.key === key && (
                            sort.dir === "asc" ? <ArrowUp className={`w-3 h-3 ${isDark ? "text-white" : "text-black"}`} /> : <ArrowDown className={`w-3 h-3 ${isDark ? "text-white" : "text-black"}`} />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                  <th className={`px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-right ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>

              <tbody className={`divide-y ${isDark ? "divide-[#38383A]" : "divide-[#E5E5EA]"}`}>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-16 text-center">
                      <Search className={`w-8 h-8 mx-auto mb-3 opacity-20 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
                      <p className={`text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>No bookings found</p>
                      <p className={`text-[12px] mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                        {search || manager || statusFilter ? "Widen the filters to see more." : "Confirmed bookings appear once a lead is closing."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paged.map((row) => {
                    const collected = row.ocrReceived + row.disbursement;
                    const pct = row.agreementValue > 0 ? Math.min(100, Math.round((collected / row.agreementValue) * 100)) : 0;
                    const ocrPct = row.ownContributionRequired > 0 ? Math.min(100, Math.round((row.ocrReceived / row.ownContributionRequired) * 100)) : null;

                    return (
                      <tr
                        key={row.id}
                        onClick={() => setOpenRow(row)}
                        onKeyDown={(e) => { if (e.key === "Enter") setOpenRow(row); }}
                        tabIndex={0}
                        className={`cursor-pointer group outline-none transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]`}
                      >
                        <td className={`px-4 py-3.5 tabular-nums text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{row.srNo}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <p className={`text-[13px] font-semibold tracking-tight leading-tight ${isDark ? "text-white" : "text-black"}`}>{row.customerName}</p>
                          {row.customerNote && <p className={`text-[11px] mt-0.5 tracking-tight truncate max-w-[200px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{row.customerNote}</p>}
                        </td>
                        <td className={`px-4 py-3.5 text-right tabular-nums text-[13px] font-medium whitespace-nowrap ${isDark ? "text-white" : "text-black"}`}>{inr(row.agreementValue)}</td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap group/ocr">
                          <div className="inline-flex items-center justify-end gap-2">
                            <span className="text-right">
                              <span className={`block tabular-nums text-[13px] font-semibold ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>{inr(row.ocrReceived)}</span>
                              {ocrPct !== null && <span className={`block text-[10px] font-medium tabular-nums ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{ocrPct}% of share</span>}
                            </span>
                            {mayRecord && row.bookingId && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setOcrRow(row); }}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors opacity-0 group-hover/ocr:opacity-100 focus:opacity-100 ${isDark ? "bg-[#32D74B]/15 text-[#32D74B] hover:bg-[#32D74B] hover:text-white" : "bg-[#EBF9EE] text-[#34C759] hover:bg-[#34C759] hover:text-white"
                                  }`}
                                title="Record OCR receipt"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <p className={`tabular-nums text-[13px] font-semibold ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>{inr(row.sanctionedAmount)}</p>
                          {row.sanctionedDate && <p className={`text-[10px] mt-0.5 font-medium tabular-nums ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{shortDate(row.sanctionedDate)}</p>}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <p className={`tabular-nums text-[13px] font-semibold ${isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]"}`}>{inr(row.disbursement)}</p>
                          {row.agreementValue > 0 && (
                            <div className="mt-1 flex items-center justify-end gap-1.5">
                              <span className={`h-1 w-12 rounded-full overflow-hidden ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`}>
                                <span className={`block h-full rounded-full transition-all ${pct >= 100 ? (isDark ? "bg-[#32D74B]" : "bg-[#34C759]") : (isDark ? "bg-[#BF5AF2]" : "bg-[#AF52DE]")}`} style={{ width: `${pct}%` }} />
                              </span>
                              <span className={`text-[10px] font-medium tabular-nums ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{pct}%</span>
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-3.5 text-right tabular-nums text-[13px] font-semibold whitespace-nowrap ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>{inr(row.registrationAmount)}</td>
                        <td className={`px-4 py-3.5 text-right tabular-nums text-[13px] font-semibold whitespace-nowrap ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{inr(row.balance)}</td>
                        <td className={`px-4 py-3.5 whitespace-nowrap text-[13px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}>{row.salesManager}</td>
                        <td className={`px-4 py-3.5 whitespace-nowrap text-[13px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}>{row.flatNo}</td>
                        <td className={`px-4 py-3.5 text-[12px] font-medium tracking-tight max-w-[160px] truncate ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} title={row.bankerDetails}>{row.bankerDetails}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <StatusChip row={row} isDark={isDark} />
                        </td>
                        <td className={`px-4 py-3.5 whitespace-nowrap text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{shortDate(row.sanctionedDate)}</td>
                        <td className="px-4 py-3.5 text-right">
                          <ArrowUpRight className={`w-4 h-4 inline-block opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {filtered.length > 0 && (
                <tfoot className={`border-t border-b-0 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/50" : "border-[#E5E5EA] bg-[#F2F2F7]/50"}`}>
                  <tr>
                    <td colSpan={2} className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                      Total · {filtered.length} booking{filtered.length === 1 ? "" : "s"}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums text-[13px] font-bold ${isDark ? "text-white" : "text-black"}`}>{inr(totals.av)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums text-[13px] font-bold ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>{inr(totals.ocr)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums text-[13px] font-bold ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>{inr(totals.sanctioned)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums text-[13px] font-bold ${isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]"}`}>{inr(totals.disb)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums text-[13px] font-bold ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>{inr(totals.registration)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums text-[13px] font-bold ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{inr(totals.balance)}</td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          {sorted.length > PAGE_SIZE && (
            <div className={`flex items-center justify-between px-5 py-3 border-t ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#E5E5EA] bg-white"}`}>
              <p className={`text-[12px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                Page {Math.min(page, totalPages)} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors disabled:opacity-30 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-colors disabled:opacity-30 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {ocrRow && user && (
        <OcrReceiptModal
          row={ocrRow}
          user={user}
          onClose={() => setOcrRow(null)}
          onSaved={() => { setOcrRow(null); load(true); }}
          theme={theme}
          isDark={isDark}
        />
      )}
      <AnimatePresence>
        {openRow && (
          <CaseDrawer
            row={openRow}
            user={user}
            mayRecord={mayRecord}
            onRecordOcr={() => setOcrRow(openRow)}
            onSaved={() => load(true)}
            onClose={() => setOpenRow(null)}
            theme={theme}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showInfo && <HowItWorks onClose={() => setShowInfo(false)} theme={theme} isDark={isDark} />}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   OCR receipt entry
   ══════════════════════════════════════════════════════════════════════ */
function OcrReceiptModal({ row, user, onClose, onSaved, isDark }: any) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    amountRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const value = toNumber(amount);
  const pendingOwn = Math.max(0, row.ownContributionRequired - row.ocrReceived);
  const exceedsOwnShare = row.ownContributionRequired > 0 && value > pendingOwn;

  const save = async () => {
    if (value <= 0 || !date || saving || !row.bookingId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(receiptsUrl(row.bookingId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_type: "ocr",
          amount: value,
          transaction_date: date,
          payment_mode: mode,
          reference_no: reference || null,
          remarks: remarks || null,
          user_name: user.name,
          user_role: user.role,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "The receipt did not save.");
      onSaved();
    } catch (err: any) {
      setError(err.message || "The receipt did not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className={`relative w-full max-w-md rounded-[24px] overflow-hidden shadow-[0_24px_48px_rgba(0,0,0,0.2)] ${isDark ? "bg-[#1C1C1E] border border-white/10" : "bg-white border border-black/5"}`}
      >
        <header className={`px-6 py-5 border-b flex items-start justify-between gap-3 ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="min-w-0">
            <h2 className={`text-[17px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>Record OCR Receipt</h2>
            <p className={`text-[13px] mt-1 tracking-tight truncate ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              {row.customerName} · {row.flatNo} · {row.bookingNumber}
            </p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-full transition-colors ${isDark ? "hover:bg-white/10 text-[#8E8E93]" : "hover:bg-black/5 text-[#8E8E93]"}`}>
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <div className={`rounded-[14px] border px-4 py-3 space-y-2 ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Own share required</span>
              <span className={`text-[13px] font-semibold tabular-nums ${isDark ? "text-white" : "text-black"}`}>{inr(row.ownContributionRequired)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Received so far</span>
              <span className={`text-[13px] font-semibold tabular-nums ${isDark ? "text-white" : "text-black"}`}>{inr(row.ocrReceived)}</span>
            </div>
            <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />
            <div className="flex items-center justify-between">
              <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Still due</span>
              <span className={`text-[13px] font-semibold tabular-nums ${isDark ? "text-white" : "text-black"}`}>{inr(pendingOwn)}</span>
            </div>
          </div>

          <div>
            <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Amount received *</label>
            <input
              ref={amountRef}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
              inputMode="numeric"
              placeholder="2,50,000"
              className={`w-full px-4 py-2.5 rounded-[12px] text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 ${isDark ? "bg-[#2C2C2E] border border-[#38383A] text-white" : "bg-[#F2F2F7] border border-[#E5E5EA] text-black"}`}
            />
            {value > 0 && <p className={`text-[12px] mt-1.5 font-medium tabular-nums ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{inr(value)}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Received on *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayIso()} className={`w-full px-4 py-2.5 rounded-[12px] text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 ${isDark ? "bg-[#2C2C2E] border border-[#38383A] text-white" : "bg-[#F2F2F7] border border-[#E5E5EA] text-black"}`} />
            </div>
            <div>
              <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Mode</label>
              <div className="relative">
                <select value={mode} onChange={(e) => setMode(e.target.value)} className={`appearance-none w-full px-4 py-2.5 rounded-[12px] text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 ${isDark ? "bg-[#2C2C2E] border border-[#38383A] text-white" : "bg-[#F2F2F7] border border-[#E5E5EA] text-black"}`}>
                  {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <div className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>▼</div>
              </div>
            </div>
          </div>

          <div>
            <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Reference no.</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque or UTR number" className={`w-full px-4 py-2.5 rounded-[12px] text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 ${isDark ? "bg-[#2C2C2E] border border-[#38383A] text-white" : "bg-[#F2F2F7] border border-[#E5E5EA] text-black"}`} />
          </div>

          <div>
            <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={`w-full px-4 py-2.5 rounded-[12px] text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 ${isDark ? "bg-[#2C2C2E] border border-[#38383A] text-white" : "bg-[#F2F2F7] border border-[#E5E5EA] text-black"}`} />
          </div>

          {exceedsOwnShare && <p className={`text-[12px] font-medium leading-snug ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>This is more than the {inr(pendingOwn)} still due from the buyer. Save it only if the extra is genuinely a customer payment.</p>}
          {error && <p className={`text-[12px] font-medium ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{error}</p>}
        </div>

        <footer className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
          <button onClick={onClose} className={`px-4 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#F2F2F7] text-black hover:bg-[#E5E5EA]"}`}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={value <= 0 || !date || saving}
            className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? `bg-[${ACCENT_DARK}]` : `bg-[${ACCENT}]`}`}
          >
            <Check className="w-4 h-4" />
            {saving ? "Saving…" : "Save Receipt"}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Case drawer — detail, receipt history, follow-up thread
   ══════════════════════════════════════════════════════════════════════ */
function CaseDrawer({ row, user, mayRecord, onRecordOcr, onSaved, onClose, isDark }: any) {
  const [summary, setSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState("");
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [bookingError, setBookingError] = useState("");

  const leadId = row.leadId;
  const bookingId = row.bookingId;

  useEffect(() => { noteRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (bookingOpen) setBookingOpen(false); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, bookingOpen]);

  const fetchBooking = async () => {
    if (!bookingId) return;
    setLoadingBooking(true);
    setBookingError("");
    try {
      const res = await fetch(bookingApplicationUrl(bookingId), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "The booking form could not load.");
      setBooking(json.data);
    } catch (err: any) {
      setBookingError(err.message || "The booking form could not load.");
    } finally {
      setLoadingBooking(false);
    }
  };

  const openBookingForm = () => {
    if (!bookingId) return;
    setBookingOpen(true);
    if (booking || loadingBooking) return;
    fetchBooking();
  };

  useEffect(() => {
    if (!bookingId) { setLoadingSummary(false); return; }
    fetch(paymentSummaryUrl(bookingId), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.success) setSummary(d.data); })
      .catch(() => { })
      .finally(() => setLoadingSummary(false));
  }, [bookingId]);

  const loadThread = useCallback(async () => {
    if (!leadId) {
      setLoadingThread(false);
      setThreadError("This booking has no linked lead, so follow-ups cannot be stored against it.");
      return;
    }
    setLoadingThread(true);
    setThreadError("");
    try {
      const res = await fetch(`${followupsUrl()}?lead_id=${encodeURIComponent(String(leadId))}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Follow-ups could not load.");
      const mine = (json.data || []).filter((f: Followup) => String(f.leadId) === String(leadId));
      setFollowups(mine);
    } catch (err: any) {
      setThreadError(err.message || "Follow-ups could not load.");
    } finally {
      setLoadingThread(false);
    }
  }, [leadId]);

  useEffect(() => { loadThread(); }, [loadThread]);

  const saveFollowup = async () => {
    if (!note.trim() || !leadId || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(followupsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          message: note.trim(),
          salesManagerName: user?.name,
          createdBy: user?.name,
          siteVisitDate: nextDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "The follow-up did not save.");
      setNote("");
      setNextDate("");
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2200);
      await loadThread();
    } catch (err: any) {
      setSaveError(err.message || "The follow-up did not save.");
    } finally {
      setSaving(false);
    }
  };

  const ocrBreakdown: any[] = summary?.own_contribution?.breakdown || [];

  const detailRows: Array<[string, React.ReactNode]> = [
    ["Booking no.", row.bookingNumber],
    ["Flat", row.flatNo],
    ["Sales manager", row.salesManager],
    ["Banker", row.bankerDetails],
    ["Agreement value", inr(row.agreementValue)],
    ["OCR received", inr(row.ocrReceived)],
    ["Loan sanctioned", inr(summary?.loan?.sanctioned ?? row.raw?.sanction_amount)],
    ["Loan disbursed", inr(row.disbursement)],
    ["Balance receivable", inr(row.balance)],
    ["Stamp duty", inr(summary?.stamp_duty?.amount)],
    ["Registration fee", inr(summary?.registration_fee?.amount)],
    ["Sanction date", shortDate(row.raw?.sanction_date)],
    ["Registration", shortDate(row.raw?.actual_registration_date || row.raw?.expected_registration_date)],
  ];

  const bookingLead = booking
    ? {
      id: booking.lead_id ?? leadId,
      sr_no: booking.lead_sr_no,
      name: booking.lead_name ?? row.customerName,
      phone: booking.lead_phone,
      alt_phone: booking.lead_alt_phone,
      email: booking.lead_email,
      address: booking.lead_address,
      budget: booking.lead_budget,
      configuration: booking.lead_configuration,
      purpose: booking.lead_purpose,
      source: booking.lead_source,
      assigned_to: booking.lead_assigned_to,
    }
    : null;

  return (
    <div className="fixed inset-0 z-[50] flex justify-end" role="dialog">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        className={`relative h-full w-full sm:max-w-[420px] flex flex-col border-l shadow-2xl ${isDark ? "border-white/10 bg-[#1C1C1E]" : "border-black/5 bg-white"}`}
      >
        <header className={`px-6 py-5 border-b flex items-start justify-between gap-4 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className={`text-[18px] font-semibold tracking-tight leading-tight ${isDark ? "text-white" : "text-black"}`}>{row.customerName}</h2>
              <StatusChip row={row} isDark={isDark} />
            </div>
            <p className={`text-[13px] font-medium tracking-tight mt-1.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              {row.flatNo} · {row.bookingNumber} · {row.salesManager}
            </p>
            {row.customerNote && <p className={`text-[12px] mt-1.5 italic ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{row.customerNote}</p>}
            {bookingId && (
              <button
                onClick={openBookingForm}
                disabled={loadingBooking}
                className={`mt-3 text-[12px] font-semibold tracking-wide px-3.5 py-1.5 rounded-full inline-flex items-center gap-2 transition-colors ${isDark
                  ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C] disabled:opacity-50"
                  : "bg-[#F2F2F7] text-black hover:bg-[#E5E5EA] disabled:opacity-50"
                  }`}
              >
                {loadingBooking ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {loadingBooking ? "Loading…" : "View Booking Form"}
              </button>
            )}
          </div>
          <button onClick={onClose} className={`p-2 rounded-full transition-colors shrink-0 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[#8E8E93]" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#8E8E93]"}`}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-8">
          <section>
            <p className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Case Detail</p>
            <div className={`rounded-[14px] overflow-hidden border ${isDark ? "border-[#38383A] bg-[#2C2C2E]" : "border-[#E5E5EA] bg-[#F2F2F7]"}`}>
              {detailRows.map(([label, value], i) => (
                <div key={label} className={`flex items-center justify-between gap-3 px-4 py-3 ${i !== detailRows.length - 1 ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                  <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{label}</span>
                  <span className={`text-[13px] font-semibold tracking-tight text-right tabular-nums ${isDark ? "text-white" : "text-black"}`}>{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>OCR Receipts {ocrBreakdown.length > 0 && `(${ocrBreakdown.length})`}</p>
              {mayRecord && bookingId && (
                <button
                  onClick={onRecordOcr}
                  className={`text-[11px] font-semibold tracking-wide px-3 py-1.5 rounded-full text-white inline-flex items-center gap-1.5 transition-all active:scale-95 ${isDark ? `bg-[${ACCENT_DARK}]` : `bg-[${ACCENT}]`}`}
                >
                  <Plus className="w-3 h-3" /> Record receipt
                </button>
              )}
            </div>

            {loadingSummary ? (
              <div className={`h-[120px] rounded-[14px] animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
            ) : ocrBreakdown.length === 0 ? (
              <p className={`text-[13px] leading-relaxed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                No customer receipts recorded yet. Each one you record shows here with its date and mode.
              </p>
            ) : (
              <div className={`rounded-[14px] overflow-hidden border ${isDark ? "border-[#38383A] bg-[#2C2C2E]" : "border-[#E5E5EA] bg-[#F2F2F7]"}`}>
                {ocrBreakdown.map((line: any, i: number) => (
                  <div key={i} className={`flex items-center justify-between gap-3 px-4 py-3 ${i !== ocrBreakdown.length - 1 ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                    <span className="min-w-0">
                      <span className={`block text-[13px] font-semibold tracking-tight truncate ${isDark ? "text-white" : "text-black"}`}>{line.type}</span>
                      <span className={`block text-[11px] font-medium mt-0.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{shortDate(line.date)}</span>
                    </span>
                    <span className={`text-[13px] font-semibold tabular-nums flex-shrink-0 ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>
                      {inr(line.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquarePlus className={`w-4 h-4 ${isDark ? `text-[${ACCENT_DARK}]` : `text-[${ACCENT}]`}`} />
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Add a Follow-Up</p>
            </div>

            <textarea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveFollowup(); }}
              rows={4}
              disabled={!leadId}
              placeholder="Spoke to the banker — sanction letter expected Friday..."
              className={`w-full rounded-[14px] px-4 py-3 text-[14px] font-medium tracking-tight outline-none resize-none leading-relaxed transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 border disabled:opacity-50 ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-[#E5E5EA] text-black placeholder-[#8E8E93]"
                }`}
            />

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-3">
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Next Date</label>
                <input
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                  disabled={!leadId}
                  className={`w-full rounded-[10px] px-3 py-2 text-[13px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[${ACCENT}]/50 border disabled:opacity-50 ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-[#F2F2F7] border-[#E5E5EA] text-black"
                    }`}
                />
              </div>
              <button
                onClick={saveFollowup}
                disabled={!note.trim() || saving || !leadId}
                className={`self-end px-5 py-2 rounded-full text-[13px] font-semibold tracking-wide text-white inline-flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? `bg-[${ACCENT_DARK}]` : `bg-[${ACCENT}]`
                  }`}
              >
                {justSaved ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                {saving ? "Saving…" : justSaved ? "Saved" : "Save"}
              </button>
            </div>
            {saveError && <p className={`text-[12px] mt-2 font-medium ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{saveError}</p>}
          </section>

          <section className="pb-6">
            <p className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>History {followups.length > 0 && `(${followups.length})`}</p>

            {loadingThread ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className={`h-[80px] rounded-[14px] animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
                ))}
              </div>
            ) : threadError ? (
              <p className={`text-[13px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{threadError}</p>
            ) : followups.length === 0 ? (
              <p className={`text-[13px] leading-relaxed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                Nothing logged yet. The first follow-up you save shows up here with your name against it.
              </p>
            ) : (
              <div className="space-y-3">
                {followups.map((f) => (
                  <article key={f._id} className={`rounded-[14px] p-4 border ${isDark ? "border-[#38383A] bg-[#2C2C2E]/50" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                        <User className="w-3.5 h-3.5 opacity-70" />
                        {f.salesManagerName || f.createdBy || "Team"}
                      </span>
                      <span className={`text-[11px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{shortDate(f.createdAt)}</span>
                    </div>
                    <p className={`text-[13px] leading-relaxed whitespace-pre-wrap tracking-tight ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>{f.message}</p>
                    {f.siteVisitDate && (
                      <p className={`text-[11px] mt-2 inline-flex items-center gap-1.5 font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                        <CalendarClock className="w-3.5 h-3.5" />
                        Next: {shortDate(f.siteVisitDate)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </motion.aside>

      <AnimatePresence>
        {bookingOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setBookingOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className={`relative w-full max-w-6xl max-h-[90vh] flex flex-col rounded-[24px] border shadow-[0_24px_48px_rgba(0,0,0,0.2)] overflow-hidden ${isDark ? "border-white/10 bg-[#1C1C1E]" : "border-black/5 bg-white"
                }`}
            >
              <div className={`px-6 py-4 border-b flex items-center justify-between gap-4 flex-shrink-0 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
                <div className="min-w-0">
                  <p className={`text-[15px] font-semibold tracking-tight truncate ${isDark ? "text-white" : "text-black"}`}>Booking Form</p>
                  <p className={`text-[12px] font-medium tracking-tight mt-0.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                    {row.bookingNumber} · {row.customerName}
                  </p>
                </div>
                <button
                  onClick={() => setBookingOpen(false)}
                  className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[#8E8E93]" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#8E8E93]"}`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                {loadingBooking ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className={`h-[100px] rounded-[16px] animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
                    ))}
                  </div>
                ) : bookingError ? (
                  <div className="py-12 text-center">
                    <p className={`text-[14px] font-semibold ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{bookingError}</p>
                    <button
                      onClick={fetchBooking}
                      className={`mt-4 text-[13px] font-semibold tracking-wide px-5 py-2.5 rounded-full text-white transition-all active:scale-95 ${isDark ? `bg-[${ACCENT_DARK}]` : `bg-[${ACCENT}]`}`}
                    >
                      Try again
                    </button>
                  </div>
                ) : booking ? (
                  <ClosedLeadBookingView
                    booking={booking}
                    lead={bookingLead}
                    isDark={isDark}
                    userRole={(user?.role || "").toLowerCase().replace(/\s+/g, "_") || "sales"}
                    currentUser={user}
                    onRefetch={() => { fetchBooking(); onSaved?.(); }}
                  />
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   "How this works"
   ══════════════════════════════════════════════════════════════════════ */
function HowItWorks({ onClose, isDark }: any) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = [
    { title: "What appears in this table", body: "One row per confirmed booking. A lead shows up only once it has been marked closing and a booking application exists, so live enquiries are deliberately absent." },
    { title: "Money arrives in two streams", body: "The buyer pays their own share, and the bank disburses the loan. OCR and Disbursement are those two streams kept separate, because they are chased by different people and arrive on different dates. Together they make Collected to date." },
    { title: "OCR received", body: "The buyer's own contribution actually in hand — token, booking amount, instalments, cash component. It is the sum of dated customer receipts on the ledger, not a number anyone types into a total. That is why it can only go up when a receipt is recorded." },
    { title: "Recording an OCR receipt", body: "Press the plus on any OCR cell. Amount and date are required, because an undated receipt is not yet collected money and would inflate the figure. The entry is appended to the ledger; a mistake is fixed by reversing it, which keeps the audit trail whole." },
    { title: "% of own share", body: "OCR received against the own contribution the buyer is required to bring, which is agreement value plus charges minus the sanctioned loan. It reads 100% when the buyer has paid their full share, even if the loan is still pending." },
    { title: "Disbursement", body: "The sum of loan tranches marked completed. Pending and scheduled tranches are earmarked, not received, so they are excluded — which is why this can sit below the sanctioned amount." },
    { title: "Balance receivable", body: "Agreement value minus OCR received minus disbursement. Where the ledger view supplies an outstanding balance directly, that figure wins, since it also accounts for reversals." },
    { title: "Stamp duty, registration fee and GST", body: "Collected on the government's behalf, so they are never counted as revenue here. They appear in the case drawer for reference and are deliberately kept out of every total on this screen." },
    { title: "Sanction / regi. status", body: "Read from the booking's registration and sanction fields and shortened to Done, Registered · disbursement pending, In process, or Not started. Wording that matches no known pattern is shown exactly as typed, so nothing is quietly reclassified." },
    { title: "Totals", body: "The footer and the cards above sum whatever is currently filtered, not the whole database. Narrow by manager and the totals narrow with it, which is what makes them useful in a one-manager review." },
    { title: "Who can record money", body: "Only Admin and Site Head see the plus button, matching the rule already applied to payment milestones and TDS. Everyone can read the figures and add follow-ups." },
    { title: "How fresh this is", body: "The table reloads on its own every minute, and the refresh button forces it immediately. Recording a receipt refreshes it at once so the new figure is visible before you close the row." },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6" role="dialog">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        className={`relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-[24px] border shadow-[0_24px_48px_rgba(0,0,0,0.2)] overflow-hidden ${isDark ? "border-white/10 bg-[#1C1C1E]" : "border-black/5 bg-white"
          }`}
      >
        <header className={`px-6 py-5 border-b flex items-start justify-between gap-4 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
          <div>
            <h2 className={`text-[16px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>How this panel works</h2>
            <p className={`text-[12px] font-medium tracking-tight mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              Every figure is derived from a dated receipt. Here is exactly where each one comes from.
            </p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[#8E8E93]" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#8E8E93]"}`}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-6">
          {sections.map((s) => (
            <section key={s.title}>
              <h3 className={`text-[13px] font-bold tracking-tight mb-1.5 ${isDark ? `text-[${ACCENT_DARK}]` : `text-[${ACCENT}]`}`}>
                {s.title}
              </h3>
              <p className={`text-[13px] leading-relaxed tracking-tight ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>{s.body}</p>
            </section>
          ))}
        </div>

        <footer className={`px-6 py-4 border-t ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#E5E5EA] bg-white"}`}>
          <button onClick={onClose} className={`w-full py-3 rounded-full text-[14px] font-semibold tracking-wide text-white transition-all active:scale-95 ${isDark ? `bg-[${ACCENT_DARK}]` : `bg-[${ACCENT}]`}`}>
            Got it
          </button>
        </footer>
      </motion.div>
    </div>
  );
}