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
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  HandCoins,
  Info,
  Landmark,
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
import { CRMContextManager } from "@/lib/admin-ai/contextManager";

/* ─────────────────────────────── config ─────────────────────────────── */
const DASHBOARD_ENDPOINT = "/api/revenue-intelligence";
const paymentSummaryUrl = (bookingId: number | string) => `/api/booking-applications/${bookingId}/payment-summary`;
const receiptsUrl = (bookingId: number | string) => `/api/booking-applications/${bookingId}/receipts`;
const followupsUrl = (leadId: number | string) => `/api/walkin_enquiries/${leadId}/follow-ups`;

const ACCENT = "#9E217B";
const PAGE_SIZE = 25;
const REFRESH_MS = 60_000;

/** Same gate as the milestones and TDS routes — money in is not a sales-manager action. */
const canRecordMoney = (role?: string) => {
  const clean = (role || "").trim().toLowerCase();
  return clean === "admin" || clean === "site_head" || clean === "site head";
};

const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "UPI", "Cash", "Demand Draft"];

/* ─────────────────────────────── types ─────────────────────────────── */

type Props = {
  isDark: boolean;
  theme: any;
  /** Needed to attribute receipts and follow-ups. Without it the "+" button hides. */
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
  id: number | string;
  note: string;
  created_at?: string;
  created_by?: string;
  author?: string;
  next_followup_date?: string | null;
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

  // Unrecognised phrasing shows verbatim rather than being silently bucketed.
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
    // OCR is the buyer's own contribution actually received — a ledger sum, never a typed column.
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
      balance:
        explicitBalance !== null && explicitBalance !== undefined
          ? toNumber(explicitBalance)
          : Math.max(0, agreementValue - ocrReceived - disbursement),
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
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
      : "bg-emerald-50 text-emerald-700 border-emerald-200",
    partial: isDark ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" : "bg-cyan-50 text-cyan-700 border-cyan-200",
    processing: isDark
      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
      : "bg-amber-50 text-amber-700 border-amber-200",
    idle: isDark ? "bg-white/5 text-gray-400 border-white/10" : "bg-slate-50 text-slate-500 border-slate-200",
  };
  return map[tone];
}

function StatusChip({ row, isDark }: { row: Row; isDark: boolean }) {
  const dot =
    row.statusTone === "done"
      ? "bg-emerald-500"
      : row.statusTone === "partial"
        ? "bg-cyan-500"
        : row.statusTone === "processing"
          ? "bg-amber-500"
          : "bg-slate-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-bold leading-none whitespace-nowrap ${toneClasses(
        row.statusTone,
        isDark
      )}`}
      title={row.statusText}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
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
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
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

  /* ── shared classes ── */
  const ghostBtn = `h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-2 border transition-colors ${isDark ? "border-white/10 text-gray-200 hover:bg-white/[0.07]" : "border-slate-200 text-slate-700 hover:bg-slate-50"
    }`;
  const controlCls = `h-9 rounded-lg px-2.5 text-xs font-semibold outline-none border transition-colors ${isDark ? "border-white/10 bg-white/[0.04] text-gray-100" : "border-slate-200 bg-white text-slate-700"
    }`;
  const thCls = `px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.07em] whitespace-nowrap ${theme.text}`;

  if (isLoading) {
    return (
      <div className={`h-full overflow-y-auto p-4 md:p-6 space-y-4 ${theme.mainBg}`}>
        <div className={`h-10 w-80 rounded-lg animate-pulse ${isDark ? "bg-white/[0.07]" : "bg-slate-200"}`} />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`h-20 rounded-xl animate-pulse ${isDark ? "bg-white/[0.05]" : "bg-slate-200"}`}
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>
        <div className={`h-96 rounded-2xl animate-pulse ${isDark ? "bg-white/[0.04]" : "bg-slate-100"}`} />
      </div>
    );
  }

  return (
    <div className={`h-full overflow-y-auto custom-scrollbar ${theme.mainBg}`}>
      {/* ═══ command bar ═══ */}
      <div
        className={`sticky top-0 z-20 px-4 md:px-6 py-3 border-b ${isDark ? "border-white/10 bg-black/40" : "border-slate-200 bg-white/75"
          }`}
        style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className={`text-lg font-black tracking-tight ${theme.accentText}`}>Revenue Intelligence</h1>
              <button
                onClick={() => setShowInfo(true)}
                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center transition-colors ${isDark
                  ? "border-white/15 text-gray-300 hover:bg-white/10"
                  : "border-slate-300 text-slate-500 hover:bg-slate-100"
                  }`}
                aria-label="How this panel works"
                title="How this panel works"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              <span
                className={`text-[9px] font-black px-2 py-0.5 rounded-full border inline-flex items-center gap-1.5 ${toneClasses(
                  "done",
                  isDark
                )}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            </div>
            <p className={`text-[11px] mt-0.5 ${theme.textMuted}`}>
              Cash basis — a receipt counts once it has a date · refreshed {relativeTime(updatedAt) || "now"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.textMuted}`} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Customer, flat, banker…"
                className={`${controlCls} pl-9 pr-3 w-full sm:w-60 font-normal`}
              />
            </div>

            <select
              value={manager}
              onChange={(e) => {
                setManager(e.target.value);
                setPage(1);
              }}
              className={controlCls}
              aria-label="Sales manager"
            >
              <option value="">All managers</option>
              {managers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setPage(1);
              }}
              className={controlCls}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="done">Done</option>
              <option value="partial">Registered · disbursement pending</option>
              <option value="processing">In process</option>
              <option value="idle">Not started</option>
            </select>

            <button onClick={exportCsv} className={ghostBtn} title="Download the rows currently shown">
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>

            <button
              onClick={() => load(true)}
              disabled={isRefreshing}
              className={`h-9 w-9 rounded-lg inline-flex items-center justify-center border ${isDark ? "border-white/10 hover:bg-white/[0.07]" : "border-slate-200 hover:bg-slate-50"
                }`}
              aria-label="Refresh now"
              title="Refresh now"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {showInfo && <HowItWorks onClose={() => setShowInfo(false)} theme={theme} isDark={isDark} />}
        <RevenueChatDock
          rows={filtered}
          filterLabel={[manager, statusFilter && `status: ${statusFilter}`, search && `“${search}”`].filter(Boolean).join(" · ")}
          theme={theme}
          isDark={isDark}
        />
        {error && (
          <div className={`rounded-xl border p-4 ${toneClasses("idle", isDark)}`}>
            <p className={`text-sm font-bold ${theme.text}`}>Revenue intelligence could not load</p>
            <p className={`text-xs mt-0.5 ${theme.textMuted}`}>{error}</p>
            <button onClick={() => load()} className={`${ghostBtn} mt-3`}>
              Try again
            </button>
          </div>
        )}

        {/* ═══ money strip ═══ */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            {
              label: "Booking in hand",
              value: compact(totals.av),
              sub: `${filtered.length} booking${filtered.length === 1 ? "" : "s"}`,
              icon: Building2,
            },
            { label: "OCR received", value: compact(totals.ocr), sub: "Buyer's own contribution", icon: HandCoins },
            { label: "Loan disbursed", value: compact(totals.disb), sub: "Completed tranches only", icon: Landmark },
            {
              label: "Collected to date",
              value: compact(totals.collected),
              sub: `${totals.pct}% of agreement value`,
              icon: Banknote,
            },
            { label: "Balance receivable", value: compact(totals.balance), sub: "AV − OCR − disbursed", icon: Wallet },
          ].map((tile) => (
            <div
              key={tile.label}
              className={`rounded-xl border p-3.5 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white"
                }`}
              style={theme.cardGlass || undefined}
            >
              <div className="flex items-center gap-2">
                <tile.icon className="w-3.5 h-3.5" style={{ color: ACCENT }} />
                <p className={`text-[10px] font-black uppercase tracking-[0.07em] ${theme.textMuted}`}>{tile.label}</p>
              </div>
              <p className={`text-xl font-black mt-1.5 tabular-nums ${theme.text}`}>{tile.value}</p>
              <p className={`text-[10px] mt-0.5 ${theme.textMuted}`}>{tile.sub}</p>
            </div>
          ))}
        </section>

        {/* ═══ the table ═══ */}
        <section className={`rounded-2xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={`sticky top-0 z-10 ${theme.tableHead}`}>
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
                    <th key={label} className={`${thCls} ${align === "right" ? "text-right" : "text-left"}`}>
                      {key ? (
                        <button
                          onClick={() => toggleSort(key)}
                          className={`inline-flex items-center gap-1 hover:opacity-70 transition-opacity ${align === "right" ? "flex-row-reverse" : ""
                            }`}
                        >
                          {label}
                          {sort.key === key &&
                            (sort.dir === "asc" ? (
                              <ArrowUp className="w-3 h-3" style={{ color: ACCENT }} />
                            ) : (
                              <ArrowDown className="w-3 h-3" style={{ color: ACCENT }} />
                            ))}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                  <th className={`${thCls} text-right`}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-16 text-center">
                      <Search className={`w-8 h-8 mx-auto mb-3 opacity-25 ${theme.textMuted}`} />
                      <p className={`text-sm font-bold ${theme.text}`}>No bookings here</p>
                      <p className={`text-xs mt-1 ${theme.textMuted}`}>
                        {search || manager || statusFilter
                          ? "Widen the filters to see more."
                          : "Confirmed bookings appear as soon as a lead is marked closing."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paged.map((row) => {
                    const collected = row.ocrReceived + row.disbursement;
                    const pct =
                      row.agreementValue > 0 ? Math.min(100, Math.round((collected / row.agreementValue) * 100)) : 0;
                    const ocrPct =
                      row.ownContributionRequired > 0
                        ? Math.min(100, Math.round((row.ocrReceived / row.ownContributionRequired) * 100))
                        : null;

                    return (
                      <tr
                        key={row.id}
                        onClick={() => setOpenRow(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setOpenRow(row);
                        }}
                        tabIndex={0}
                        className={`cursor-pointer group outline-none ${theme.tableRow} focus-visible:ring-2 focus-visible:ring-inset`}
                        style={{ ["--tw-ring-color" as any]: `${ACCENT}66` }}
                        title="Open case and add a follow-up"
                      >
                        <td className={`px-3 py-3 tabular-nums font-bold ${theme.textMuted}`}>{row.srNo}</td>

                        <td className="px-3 py-3">
                          <p className={`font-bold leading-tight ${theme.text}`}>{row.customerName}</p>
                          {row.customerNote && (
                            <p className={`text-[11px] mt-0.5 italic ${theme.textMuted}`}>{row.customerNote}</p>
                          )}
                        </td>

                        <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${theme.text}`}>
                          {inr(row.agreementValue)}
                        </td>

                        {/* OCR — figure plus the receipt-entry affordance */}
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span className="text-right">
                              <span className="block tabular-nums font-bold text-cyan-500">{inr(row.ocrReceived)}</span>
                              {ocrPct !== null && (
                                <span className={`block text-[9px] font-bold tabular-nums ${theme.textMuted}`}>
                                  {ocrPct}% of own share
                                </span>
                              )}
                            </span>
                            {mayRecord && row.bookingId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOcrRow(row);
                                }}
                                className={`w-6 h-6 rounded-md border inline-flex items-center justify-center flex-shrink-0 transition-colors ${isDark
                                  ? "border-white/15 text-gray-300 hover:bg-white/10"
                                  : "border-slate-300 text-slate-500 hover:bg-slate-100"
                                  }`}
                                aria-label={`Record an OCR receipt for ${row.customerName}`}
                                title="Record an OCR receipt"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <p className="tabular-nums font-bold text-indigo-500">{inr(row.sanctionedAmount)}</p>
                          {row.sanctionedDate && (
                            <p className={`text-[9px] mt-0.5 font-bold tabular-nums ${theme.textMuted}`}>
                              {shortDate(row.sanctionedDate)}
                            </p>
                          )}
                        </td>

                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <p className="tabular-nums font-bold text-emerald-500">{inr(row.disbursement)}</p>
                          {row.agreementValue > 0 && (
                            <div className="mt-1 flex items-center justify-end gap-1.5">
                              <span
                                className={`h-1 w-14 rounded-full overflow-hidden ${isDark ? "bg-white/10" : "bg-slate-200"
                                  }`}
                              >
                                <span
                                  className="block h-full rounded-full transition-all"
                                  style={{ width: `${pct}%`, background: pct >= 100 ? "#10b981" : ACCENT }}
                                />
                              </span>
                              <span className={`text-[9px] font-bold tabular-nums ${theme.textMuted}`}>{pct}%</span>
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums font-bold whitespace-nowrap text-violet-500">
                          {inr(row.registrationAmount)}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums font-bold text-amber-500 whitespace-nowrap">
                          {inr(row.balance)}
                        </td>

                        <td className={`px-3 py-3 whitespace-nowrap ${theme.text}`}>{row.salesManager}</td>
                        <td className={`px-3 py-3 font-semibold whitespace-nowrap ${theme.text}`}>{row.flatNo}</td>
                        <td className={`px-3 py-3 text-xs max-w-[180px] truncate ${theme.textMuted}`} title={row.bankerDetails}>
                          {row.bankerDetails}
                        </td>
                        <td className="px-3 py-3">
                          <StatusChip row={row} isDark={isDark} />
                        </td>
                        <td className={`px-3 py-3 whitespace-nowrap ${theme.textMuted}`}>
                          {shortDate(row.sanctionedDate)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <ArrowUpRight
                            className={`w-4 h-4 inline-block opacity-0 group-hover:opacity-100 transition-opacity ${theme.textMuted}`}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {filtered.length > 0 && (
                <tfoot className={`border-t-2 ${isDark ? "border-white/15" : "border-slate-300"}`}>
                  <tr className={isDark ? "bg-white/[0.03]" : "bg-slate-50/80"}>
                    <td
                      colSpan={2}
                      className={`px-3 py-3 text-[10px] font-black uppercase tracking-[0.07em] ${theme.textMuted}`}
                    >
                      Total · {filtered.length} booking{filtered.length === 1 ? "" : "s"}
                    </td>
                    <td className={`px-3 py-3 text-right tabular-nums font-black ${theme.text}`}>{inr(totals.av)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-black text-cyan-500">{inr(totals.ocr)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-black text-indigo-500">{inr(totals.sanctioned)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-black text-emerald-500">{inr(totals.disb)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-black text-violet-500">{inr(totals.registration)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-black text-amber-500">{inr(totals.balance)}</td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {sorted.length > PAGE_SIZE && (
            <div className={`flex items-center justify-between gap-3 p-3.5 border-t ${theme.tableBorder}`}>
              <p className={`text-[11px] font-semibold ${theme.textMuted}`}>
                Page {Math.min(page, totalPages)} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center disabled:opacity-30 ${isDark ? "border-white/10 hover:bg-white/[0.07]" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
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

      {ocrRow && user && (
        <OcrReceiptModal
          row={ocrRow}
          user={user}
          onClose={() => setOcrRow(null)}
          onSaved={() => {
            setOcrRow(null);
            load(true);
          }}
          theme={theme}
          isDark={isDark}
        />
      )}
      {openRow && (
        <CaseDrawer
          row={openRow}
          user={user}
          mayRecord={mayRecord}
          onRecordOcr={() => setOcrRow(openRow)}
          onClose={() => setOpenRow(null)}
          theme={theme}
          isDark={isDark}
        />
      )}
      {showInfo && <HowItWorks onClose={() => setShowInfo(false)} theme={theme} isDark={isDark} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   OCR receipt entry — appends a ledger credit, never edits a total
   ══════════════════════════════════════════════════════════════════════ */

function OcrReceiptModal({
  row,
  user,
  onClose,
  onSaved,
  theme,
  isDark,
}: {
  row: Row;
  user: { name: string; role: string };
  onClose: () => void;
  onSaved: () => void;
  theme: any;
  isDark: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
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

  const labelCls = `text-[10px] font-bold uppercase tracking-[0.07em] block mb-1 ${theme.textMuted}`;
  const fieldCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors ${isDark ? "border-white/10 bg-white/[0.04] text-gray-100" : "border-slate-200 bg-white text-slate-800"
    }`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        className={`relative w-full max-w-md rounded-2xl border overflow-hidden ${isDark ? "border-white/10 bg-[#0d0d12]" : "border-slate-200 bg-white"
          }`}
      >
        <header className={`px-5 py-4 border-b flex items-start justify-between gap-3 ${theme.tableBorder}`}>
          <div className="min-w-0">
            <h2 className={`text-sm font-black ${theme.text}`}>Record an OCR receipt</h2>
            <p className={`text-[11px] mt-0.5 truncate ${theme.textMuted}`}>
              {row.customerName} · {row.flatNo} · {row.bookingNumber}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg flex-shrink-0 ${isDark ? "hover:bg-white/10 text-gray-300" : "hover:bg-slate-100 text-slate-500"
              }`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {/* Context so the figure being typed can be sanity-checked in place */}
          <div
            className={`rounded-xl border divide-y text-xs ${isDark ? "border-white/10 divide-white/[0.07]" : "border-slate-200 divide-slate-100"
              }`}
          >
            {[
              ["Own contribution required", inr(row.ownContributionRequired)],
              ["Received so far", inr(row.ocrReceived)],
              ["Still due from buyer", inr(pendingOwn)],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className={theme.textMuted}>{label}</span>
                <span className={`font-semibold tabular-nums ${theme.text}`}>{val}</span>
              </div>
            ))}
          </div>

          <div>
            <label className={labelCls}>Amount received *</label>
            <input
              ref={amountRef}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              inputMode="numeric"
              placeholder="2,50,000"
              className={fieldCls}
            />
            {value > 0 && (
              <p className={`text-[11px] mt-1 tabular-nums ${theme.textMuted}`}>{inr(value)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Received on *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayIso()} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className={fieldCls}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Reference no.</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque or UTR number"
              className={fieldCls}
            />
          </div>

          <div>
            <label className={labelCls}>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={fieldCls} />
          </div>

          {exceedsOwnShare && (
            <p className="text-[11px] font-semibold text-amber-500">
              This is more than the {inr(pendingOwn)} still due from the buyer. Save it only if the extra is genuinely a
              customer payment.
            </p>
          )}
          {error && <p className="text-[11px] font-semibold text-rose-500">{error}</p>}
          <p className={`text-[10px] ${theme.textMuted}`}>
            Saved as a dated ledger receipt against this booking. Corrections are made by reversing the entry, not by
            editing it.
          </p>
        </div>

        <footer className={`px-5 py-3.5 border-t flex items-center justify-end gap-2 ${theme.tableBorder}`}>
          <button onClick={onClose} className={`h-9 px-3 rounded-lg text-xs font-bold ${theme.textMuted}`}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={value <= 0 || !date || saving}
            className="h-9 px-4 rounded-lg text-xs font-black text-white inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: ACCENT }}
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save receipt"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Case drawer — detail, receipt history, follow-up thread
   ══════════════════════════════════════════════════════════════════════ */

function CaseDrawer({
  row,
  user,
  mayRecord,
  onRecordOcr,
  onClose,
  theme,
  isDark,
}: {
  row: Row;
  user?: { name: string; role: string };
  mayRecord: boolean;
  onRecordOcr: () => void;
  onClose: () => void;
  theme: any;
  isDark: boolean;
}) {
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

  const leadId = row.leadId;
  const bookingId = row.bookingId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    noteRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Receipt history comes from the payment-summary route, which already
     returns the own-contribution breakdown straight off the ledger. */
  useEffect(() => {
    if (!bookingId) {
      setLoadingSummary(false);
      return;
    }
    fetch(paymentSummaryUrl(bookingId), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSummary(d.data);
      })
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
      const res = await fetch(followupsUrl(leadId), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Follow-ups could not load.");
      setFollowups(json.data || json.follow_ups || json.followups || []);
    } catch (err: any) {
      setThreadError(err.message || "Follow-ups could not load.");
    } finally {
      setLoadingThread(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  const saveFollowup = async () => {
    if (!note.trim() || !leadId || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(followupsUrl(leadId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim(),
          next_followup_date: nextDate || null,
          booking_id: bookingId,
          user_name: user?.name,
          user_role: user?.role,
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

  const labelCls = `text-[10px] font-bold uppercase tracking-[0.07em] ${theme.textMuted}`;
  const fieldCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors ${isDark ? "border-white/10 bg-white/[0.04] text-gray-100" : "border-slate-200 bg-white text-slate-800"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Case detail">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />

      <aside
        className={`relative h-full w-full sm:max-w-[540px] flex flex-col border-l overflow-hidden ${isDark ? "border-white/10 bg-[#0d0d12]" : "border-slate-200 bg-white"
          }`}
        style={{ animation: "bdSlideIn 220ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        <style>{`
          @keyframes bdSlideIn { from { transform: translateX(24px); opacity: 0.4 } to { transform: translateX(0); opacity: 1 } }
          @media (prefers-reduced-motion: reduce) { aside { animation: none !important } }
        `}</style>

        <header className={`px-5 py-4 border-b flex items-start justify-between gap-3 ${theme.tableBorder}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className={`text-base font-black leading-tight ${theme.text}`}>{row.customerName}</h2>
              <StatusChip row={row} isDark={isDark} />
            </div>
            <p className={`text-[11px] mt-1 ${theme.textMuted}`}>
              {row.flatNo} · {row.bookingNumber} · {row.salesManager}
            </p>
            {row.customerNote && <p className={`text-[11px] mt-1 italic ${theme.textMuted}`}>{row.customerNote}</p>}
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg flex-shrink-0 ${isDark ? "hover:bg-white/10 text-gray-300" : "hover:bg-slate-100 text-slate-500"
              }`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">
          <section>
            <p className={`${labelCls} mb-2.5`}>Case detail</p>
            <div
              className={`rounded-xl border divide-y ${isDark ? "border-white/10 divide-white/[0.07]" : "border-slate-200 divide-slate-100"
                }`}
            >
              {detailRows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className={`text-[11px] ${theme.textMuted}`}>{label}</span>
                  <span className={`text-xs font-semibold text-right tabular-nums ${theme.text}`}>{value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* OCR receipt history */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className={labelCls}>OCR receipts {ocrBreakdown.length > 0 && `(${ocrBreakdown.length})`}</p>
              {mayRecord && bookingId && (
                <button
                  onClick={onRecordOcr}
                  className="text-[10px] font-black px-2.5 py-1 rounded-full text-white inline-flex items-center gap-1"
                  style={{ background: ACCENT }}
                >
                  <Plus className="w-3 h-3" />
                  Record receipt
                </button>
              )}
            </div>

            {loadingSummary ? (
              <div className={`h-16 rounded-xl animate-pulse ${isDark ? "bg-white/[0.05]" : "bg-slate-100"}`} />
            ) : ocrBreakdown.length === 0 ? (
              <p className={`text-[11px] ${theme.textMuted}`}>
                No customer receipts recorded yet. Each one you record shows here with its date and mode.
              </p>
            ) : (
              <div
                className={`rounded-xl border divide-y ${isDark ? "border-white/10 divide-white/[0.07]" : "border-slate-200 divide-slate-100"
                  }`}
              >
                {ocrBreakdown.map((line: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className={`block text-xs font-semibold truncate ${theme.text}`}>{line.type}</span>
                      <span className={`block text-[10px] ${theme.textMuted}`}>{shortDate(line.date)}</span>
                    </span>
                    <span className="text-xs font-bold tabular-nums text-cyan-500 flex-shrink-0">
                      {inr(line.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Follow-up composer */}
          <section>
            <div className="flex items-center gap-2 mb-2.5">
              <MessageSquarePlus className="w-3.5 h-3.5" style={{ color: ACCENT }} />
              <p className={labelCls}>Add a follow-up</p>
            </div>

            <textarea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveFollowup();
              }}
              rows={4}
              disabled={!leadId}
              placeholder="Spoke to the banker — sanction letter expected Friday, registration slot booked for the 12th."
              className={`${fieldCls} resize-none leading-relaxed disabled:opacity-50`}
            />

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 mt-2.5">
              <div>
                <label className={`${labelCls} block mb-1`}>Next follow-up</label>
                <input
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                  disabled={!leadId}
                  className={`${fieldCls} disabled:opacity-50`}
                />
              </div>
              <button
                onClick={saveFollowup}
                disabled={!note.trim() || saving || !leadId}
                className="h-9 self-end px-4 rounded-lg text-xs font-black text-white inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: ACCENT }}
              >
                {justSaved ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                {saving ? "Saving…" : justSaved ? "Saved" : "Save follow-up"}
              </button>
            </div>

            <p className={`text-[10px] mt-1.5 ${theme.textMuted}`}>⌘/Ctrl + Enter saves.</p>
            {saveError && <p className="text-[11px] mt-1.5 text-rose-500 font-semibold">{saveError}</p>}
          </section>

          <section>
            <p className={`${labelCls} mb-2.5`}>History {followups.length > 0 && `(${followups.length})`}</p>

            {loadingThread ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className={`h-16 rounded-xl animate-pulse ${isDark ? "bg-white/[0.05]" : "bg-slate-100"}`} />
                ))}
              </div>
            ) : threadError ? (
              <p className={`text-[11px] ${theme.textMuted}`}>{threadError}</p>
            ) : followups.length === 0 ? (
              <p className={`text-[11px] ${theme.textMuted}`}>
                Nothing logged yet. The first follow-up you save shows up here with your name against it.
              </p>
            ) : (
              <div className="space-y-2">
                {followups.map((f) => (
                  <article
                    key={f.id}
                    className={`rounded-xl border p-3 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50/60"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${theme.text}`}>
                        <User className="w-3 h-3 opacity-60" />
                        {f.created_by || f.author || "Team"}
                      </span>
                      <span className={`text-[10px] ${theme.textMuted}`}>{shortDate(f.created_at)}</span>
                    </div>
                    <p className={`text-xs leading-relaxed whitespace-pre-wrap ${theme.text}`}>{f.note}</p>
                    {f.next_followup_date && (
                      <p className={`text-[10px] mt-1.5 inline-flex items-center gap-1 ${theme.textMuted}`}>
                        <CalendarClock className="w-3 h-3" />
                        Next: {shortDate(f.next_followup_date)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   "How this works"
   ══════════════════════════════════════════════════════════════════════ */

function HowItWorks({ onClose, theme, isDark }: { onClose: () => void; theme: any; isDark: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = [
    {
      title: "What appears in this table",
      body: "One row per confirmed booking. A lead shows up only once it has been marked closing and a booking application exists, so live enquiries are deliberately absent.",
    },
    {
      title: "Money arrives in two streams",
      body: "The buyer pays their own share, and the bank disburses the loan. OCR and Disbursement are those two streams kept separate, because they are chased by different people and arrive on different dates. Together they make Collected to date.",
    },
    {
      title: "OCR received",
      body: "The buyer's own contribution actually in hand — token, booking amount, instalments, cash component. It is the sum of dated customer receipts on the ledger, not a number anyone types into a total. That is why it can only go up when a receipt is recorded.",
    },
    {
      title: "Recording an OCR receipt",
      body: "Press the plus on any OCR cell. Amount and date are required, because an undated receipt is not yet collected money and would inflate the figure. The entry is appended to the ledger; a mistake is fixed by reversing it, which keeps the audit trail whole.",
    },
    {
      title: "% of own share",
      body: "OCR received against the own contribution the buyer is required to bring, which is agreement value plus charges minus the sanctioned loan. It reads 100% when the buyer has paid their full share, even if the loan is still pending.",
    },
    {
      title: "Disbursement",
      body: "The sum of loan tranches marked completed. Pending and scheduled tranches are earmarked, not received, so they are excluded — which is why this can sit below the sanctioned amount.",
    },
    {
      title: "Balance receivable",
      body: "Agreement value minus OCR received minus disbursement. Where the ledger view supplies an outstanding balance directly, that figure wins, since it also accounts for reversals.",
    },
    {
      title: "Stamp duty, registration fee and GST",
      body: "Collected on the government's behalf, so they are never counted as revenue here. They appear in the case drawer for reference and are deliberately kept out of every total on this screen.",
    },
    {
      title: "Sanction / regi. status",
      body: "Read from the booking's registration and sanction fields and shortened to Done, Registered · disbursement pending, In process, or Not started. Wording that matches no known pattern is shown exactly as typed, so nothing is quietly reclassified.",
    },
    {
      title: "Totals",
      body: "The footer and the cards above sum whatever is currently filtered, not the whole database. Narrow by manager and the totals narrow with it, which is what makes them useful in a one-manager review.",
    },
    {
      title: "Who can record money",
      body: "Only Admin and Site Head see the plus button, matching the rule already applied to payment milestones and TDS. Everyone can read the figures and add follow-ups.",
    },
    {
      title: "How fresh this is",
      body: "The table reloads on its own every minute, and the refresh button forces it immediately. Recording a receipt refreshes it at once so the new figure is visible before you close the row.",
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        className={`relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border overflow-hidden ${isDark ? "border-white/10 bg-[#0d0d12]" : "border-slate-200 bg-white"
          }`}
      >
        <header className={`px-5 py-4 border-b flex items-start justify-between gap-3 ${theme.tableBorder}`}>
          <div>
            <h2 className={`text-sm font-black uppercase tracking-[0.06em] ${theme.text}`}>How this panel works</h2>
            <p className={`text-[11px] mt-1 ${theme.textMuted}`}>
              Every figure is derived from a dated receipt. Here is exactly where each one comes from.
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg flex-shrink-0 ${isDark ? "hover:bg-white/10 text-gray-300" : "hover:bg-slate-100 text-slate-500"
              }`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
          {sections.map((s) => (
            <section key={s.title}>
              <h3 className="text-xs font-black mb-1" style={{ color: ACCENT }}>
                {s.title}
              </h3>
              <p className={`text-[12px] leading-relaxed ${theme.textMuted}`}>{s.body}</p>
            </section>
          ))}
        </div>

        <footer className={`px-5 py-3.5 border-t ${theme.tableBorder}`}>
          <button onClick={onClose} className="h-9 w-full rounded-lg text-xs font-black text-white" style={{ background: ACCENT }}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}