"use client";

import { useEffect, useState, useCallback } from "react";
import {
  IoSearchOutline,
  IoCloseOutline,
  IoChevronBack,
  IoChevronForward,
  IoSettingsOutline,
  IoCheckmarkCircle,
  IoTimeOutline,
  IoAlertCircleOutline,
  IoWarningOutline,
  IoFilterOutline,
} from "react-icons/io5";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BrokerageRecord {
  id: number;
  bookingNumber: string;
  bookingStatus: string;
  bookingDate: string;
  agreementValue: number;
  bookingAmount: number;
  projectName: string;
  flatNumber: string;
  tower: string;
  wing: string;
  primaryName: string;
  customerName: string;
  customerPhone: string;
  createdBy: string;
  createdAt: string;
  salesManager: string;
  // Financial fields from Revenue Intelligence sub-tables
  tokenAmount: number;
  ocrAmount: number;
  cashComponent: number;
  sanctionAmount: number;
  disbursementAmount: number;
  bankName: string;
  registrationAmount: number;
  // Brokerage
  brokerageId: number | null;
  brokerageMethod: string | null;
  brokerageRate: number | null;
  brokerageAmount: number | null;
  brokerageSource: string | null;
  brokerageStatus: string | null;
  receivedAmount: number;
  receivedDate: string | null;
  brokerageNotes: string | null;
  agreementValueSnapshot: number | null;
}

interface TabCounts {
  all: number;
  received: number;
  pending: number;
  expected: number;
  unconfigured: number;
  receivedTotal: number;
  pendingTotal: number;
  expectedTotal: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Filters {
  employees: string[];
  projects: string[];
}

type TabKey = "all" | "received" | "pending" | "expected" | "unconfigured";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtFull(n: number): string {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function statusColor(status: string | null): { bg: string; text: string; label: string } {
  switch (status) {
    case "received": return { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Received" };
    case "partially_received": return { bg: "bg-amber-500/15", text: "text-amber-400", label: "Partial" };
    case "pending": return { bg: "bg-orange-500/15", text: "text-orange-400", label: "Pending" };
    case "expected": return { bg: "bg-blue-500/15", text: "text-blue-400", label: "Expected" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-400", label: "Not Set" };
  }
}

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ size: number; className?: string }> }[] = [
  { key: "all", label: "All Bookings", icon: IoFilterOutline },
  { key: "received", label: "Received", icon: IoCheckmarkCircle },
  { key: "pending", label: "Pending", icon: IoTimeOutline },
  { key: "expected", label: "Expected", icon: IoAlertCircleOutline },
  { key: "unconfigured", label: "Missing Config", icon: IoWarningOutline },
];

// ─── Detail Drawer ──────────────────────────────────────────────────────────

function BookingDetailDrawer({
  record, isDark, onClose, onApply, applying,
}: {
  record: BrokerageRecord; isDark: boolean; onClose: () => void;
  onApply?: (bookingId: number) => void; applying?: boolean;
}) {
  const card = isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]";
  const textP = isDark ? "text-white" : "text-[#1D1D1F]";
  const textS = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const sc = statusColor(record.brokerageStatus);

  const rows: [string, string][] = [
    ["Booking #", record.bookingNumber || "—"],
    ["Booking Date", record.bookingDate || "—"],
    ["Status", record.bookingStatus || "—"],
    ["Project", record.projectName || "—"],
    ["Flat / Unit", [record.tower, record.wing, record.flatNumber].filter(Boolean).join(" - ") || "—"],
    ["Customer", record.customerName || "—"],
    ["Phone", record.customerPhone || "—"],
    ["Sales Manager", record.salesManager || "—"],
    ["Created By", record.createdBy || "—"],
    ["Agreement Value", fmtFull(record.agreementValue)],
    ["Booking Amount", fmtFull(record.bookingAmount)],
  ];

  const finRows: [string, string][] = [
    ...(record.tokenAmount > 0 ? [["Token Amount", fmtFull(record.tokenAmount)] as [string, string]] : []),
    ...(record.ocrAmount > 0 ? [["OCR Received", fmtFull(record.ocrAmount)] as [string, string]] : []),
    ...(record.cashComponent > 0 ? [["Cash Component", fmtFull(record.cashComponent)] as [string, string]] : []),
    ...(record.sanctionAmount > 0 ? [["Sanctioned Amount", fmtFull(record.sanctionAmount)] as [string, string]] : []),
    ...(record.disbursementAmount > 0 ? [["Loan Disbursement", fmtFull(record.disbursementAmount)] as [string, string]] : []),
    ...(record.registrationAmount > 0 ? [["Registration Amount", fmtFull(record.registrationAmount)] as [string, string]] : []),
    ...(record.bankName ? [["Bank", record.bankName] as [string, string]] : []),
  ];

  const brokRows: [string, string][] = record.brokerageId
    ? [
        ["Method", record.brokerageMethod === "percentage" ? `${record.brokerageRate}%` : `Fixed ₹${fmt(record.brokerageRate ?? 0)}`],
        ["Brokerage Amount", fmtFull(record.brokerageAmount ?? 0)],
        ["Source", (record.brokerageSource || "").replace(/_/g, " ")],
        ["Status", sc.label],
        ["Received", fmtFull(record.receivedAmount)],
        ["Received Date", record.receivedDate || "—"],
        ["Snapshot Value", fmtFull(record.agreementValueSnapshot ?? 0)],
        ["Notes", record.brokerageNotes || "—"],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        style={{ animation: "fadeIn 0.2s ease-out" }}
      />
      <div
        className={`absolute top-0 right-0 bottom-0 w-full max-w-md border-l overflow-y-auto ${card}`}
        style={{ animation: "slideInRight 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
      >
        <div className={`sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b backdrop-blur-xl ${card}`}>
          <h3 className={`text-sm font-bold ${textP}`}>Booking Detail</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-colors ${isDark ? "hover:bg-[#2C2C2E] text-[#98989D]" : "hover:bg-[#F2F2F7] text-[#86868B]"}`}>
            <IoCloseOutline size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Booking Info */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
              Booking Information
            </p>
            <div className="space-y-2">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between items-baseline gap-2">
                  <span className={`text-xs ${textS} flex-shrink-0`}>{label}</span>
                  <span className={`text-xs font-medium text-right ${textP}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Details */}
          {finRows.length > 0 && (
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${isDark ? "text-blue-400" : "text-blue-600"}`}>
                Financial Details
              </p>
              <div className="space-y-2">
                {finRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between items-baseline gap-2">
                    <span className={`text-xs ${textS} flex-shrink-0`}>{label}</span>
                    <span className={`text-xs font-medium text-right ${textP}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Brokerage Info */}
          {record.brokerageId ? (
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                Brokerage Details
              </p>
              <div className="space-y-2">
                {brokRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between items-baseline gap-2">
                    <span className={`text-xs ${textS} flex-shrink-0`}>{label}</span>
                    <span className={`text-xs font-medium text-right ${textP}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={`rounded-xl p-4 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-[#F9F9F9]"}`}>
              <IoWarningOutline size={24} className={`mx-auto mb-2 ${isDark ? "text-amber-400" : "text-amber-500"}`} />
              <p className={`text-xs font-medium ${textS}`}>
                No brokerage configured for this booking.
              </p>
              {onApply ? (
                <button
                  onClick={() => onApply(record.id)}
                  disabled={applying}
                  className={`mt-3 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                    isDark
                      ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                      : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {applying ? "Applying..." : "Apply Brokerage"}
                </button>
              ) : (
                <p className={`text-[10px] mt-1 ${textS}`}>
                  Set up default rates in Brokerage Rules first.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function HRBrokerageCenter({
  isDark,
  onBack,
  onOpenSettings,
}: {
  isDark: boolean;
  onBack: () => void;
  onOpenSettings?: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<BrokerageRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [tabCounts, setTabCounts] = useState<TabCounts>({ all: 0, received: 0, pending: 0, expected: 0, unconfigured: 0, receivedTotal: 0, pendingTotal: 0, expectedTotal: 0 });
  const [filters, setFilters] = useState<Filters>({ employees: [], projects: [] });
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<BrokerageRecord | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const textP = isDark ? "text-white" : "text-[#1D1D1F]";
  const textS = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textA = isDark ? "text-emerald-400" : "text-emerald-600";
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page on filter changes
  useEffect(() => { setPage(1); }, [tab, debouncedSearch, selectedEmployee, selectedProject]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
        tab,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (selectedEmployee) params.set("employee", selectedEmployee);
      if (selectedProject) params.set("project", selectedProject);

      const res = await fetch(`/api/hr/brokerage-center?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || j.message || `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (j.success) {
        setRecords(j.data.records);
        setPagination(j.data.pagination);
        setTabCounts(j.data.tabCounts);
        setFilters(j.data.filters);
      }
    } catch (e: any) {
      console.error("Brokerage center fetch error:", e);
      setError(e.message || "Failed to load brokerage data.");
    } finally {
      setLoading(false);
    }
  }, [page, tab, debouncedSearch, selectedEmployee, selectedProject]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const applyBrokerage = async (bookingId: number) => {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/booking-brokerage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message || "Failed to apply brokerage");
      setSelectedRecord(null);
      fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  const applyAll = async () => {
    const unconfigured = records.filter((r) => !r.brokerageId);
    if (unconfigured.length === 0) return;
    setApplying(true);
    setError(null);
    let failed = 0;
    for (const r of unconfigured) {
      try {
        const res = await fetch("/api/hr/booking-brokerage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: r.id }),
        });
        const j = await res.json();
        if (!j.success) failed++;
      } catch {
        failed++;
      }
    }
    if (failed > 0) setError(`${failed} booking(s) failed to apply.`);
    setApplying(false);
    fetchData();
  };

  const toggleReceived = async (r: BrokerageRecord) => {
    if (!r.brokerageId) return;
    setTogglingId(r.id);
    const isReceived = r.brokerageStatus === "received";
    try {
      const res = await fetch(`/api/hr/booking-brokerage/${r.brokerageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isReceived
            ? { status: "expected", receivedAmount: 0, receivedDate: null }
            : { status: "received", receivedAmount: r.brokerageAmount ?? 0, receivedDate: new Date().toISOString().slice(0, 10) }
        ),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  const inputCls = `px-3 py-2 rounded-xl text-xs font-medium border outline-none transition-colors ${
    isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder:text-[#48484A] focus:border-emerald-500/50" : "bg-white border-[#E5E5EA] text-[#1D1D1F] placeholder:text-[#C7C7CC] focus:border-emerald-500/50"
  }`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className={`w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-colors ${isDark ? "hover:bg-[#2C2C2E] text-[#98989D]" : "hover:bg-[#F2F2F7] text-[#86868B]"}`}
            title="Back to Financial Overview"
          >
            <IoChevronBack size={18} />
          </button>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 ${textA}`}>
              Brokerage
            </p>
            <h2 className={`text-xl font-black ${textP}`}>Management Center</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tabCounts.unconfigured > 0 && (
            <button
              onClick={applyAll}
              disabled={applying}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                isDark ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <IoCheckmarkCircle size={14} />
              {applying ? "Applying..." : `Apply to All (${tabCounts.unconfigured})`}
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                isDark ? "bg-[#2C2C2E] border-[#38383A] text-[#98989D] hover:border-emerald-500/40 hover:text-emerald-400" : "bg-white border-[#E5E5EA] text-[#86868B] hover:border-emerald-500/40 hover:text-emerald-600"
              }`}
            >
              <IoSettingsOutline size={14} />
              Brokerage Rules
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl p-4 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchData()} className="underline cursor-pointer text-xs">Retry</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`rounded-2xl p-3.5 ${card}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${textS}`}>Total Bookings</span>
          <p className={`text-xl font-black mt-1 ${textP}`}>{tabCounts.all}</p>
        </div>
        <div className={`rounded-2xl p-3.5 ${card}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest text-emerald-400`}>Received</span>
          <p className={`text-xl font-black mt-1 text-emerald-400`}>{fmtFull(tabCounts.receivedTotal)}</p>
          <span className={`text-[10px] ${textS}`}>{tabCounts.received} bookings</span>
        </div>
        <div className={`rounded-2xl p-3.5 ${card}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest text-amber-400`}>Pending</span>
          <p className={`text-xl font-black mt-1 text-amber-400`}>{fmtFull(tabCounts.pendingTotal)}</p>
          <span className={`text-[10px] ${textS}`}>{tabCounts.pending} bookings</span>
        </div>
        <div className={`rounded-2xl p-3.5 ${card}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest text-blue-400`}>Expected</span>
          <p className={`text-xl font-black mt-1 text-blue-400`}>{fmtFull(tabCounts.expectedTotal)}</p>
          <span className={`text-[10px] ${textS}`}>{tabCounts.expected} bookings</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = tab === key;
          const count = tabCounts[key];
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer transition-all duration-200 border ${
                isActive
                  ? isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#E5E5EA] text-[#1D1D1F] shadow-sm"
                  : `border-transparent ${isDark ? "text-[#98989D] hover:bg-[#2C2C2E]/50" : "text-[#86868B] hover:bg-[#F2F2F7]"}`
              }`}
            >
              <Icon size={14} className={isActive ? textA : ""} />
              {label}
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                isActive
                  ? isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : isDark ? "bg-[#38383A] text-[#98989D]" : "bg-[#E5E5EA] text-[#86868B]"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <IoSearchOutline size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${textS}`} />
          <input
            type="text"
            placeholder="Search bookings, customers, projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputCls} w-full pl-8`}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className={`absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer ${textS}`}
            >
              <IoCloseOutline size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
            showFilters || selectedEmployee || selectedProject
              ? isDark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-700"
              : isDark ? "bg-[#2C2C2E] border-[#38383A] text-[#98989D]" : "bg-white border-[#E5E5EA] text-[#86868B]"
          }`}
        >
          <IoFilterOutline size={14} />
          Filters
          {(selectedEmployee || selectedProject) && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          )}
        </button>
      </div>

      {/* Filter Dropdowns */}
      {showFilters && (
        <div className={`flex flex-wrap gap-2 p-3 rounded-xl border ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-[#F9F9FB] border-[#E5E5EA]"}`}>
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className={inputCls}
          >
            <option value="">All Employees</option>
            {filters.employees.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className={inputCls}
          >
            <option value="">All Projects</option>
            {filters.projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {(selectedEmployee || selectedProject) && (
            <button
              onClick={() => { setSelectedEmployee(""); setSelectedProject(""); }}
              className={`text-xs font-medium cursor-pointer ${textA}`}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
        {loading ? (
          <div className="space-y-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`h-14 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-50"} ${i > 0 ? `border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"}` : ""}`} />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className={`p-10 text-center ${isDark ? "bg-[#1C1C1E]" : "bg-white"}`}>
            <p className={`text-sm font-medium ${textS}`}>
              {debouncedSearch ? "No bookings match your search." : "No bookings found for this filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="w-10 px-3 py-2.5"><span className="sr-only">Mark received</span></th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Booking</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Customer</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Project</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Agreement</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">OCR Recd</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Disbursed</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Brokerage</th>
                  <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Status</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Received</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => {
                  const sc = statusColor(r.brokerageStatus);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRecord(r)}
                      className={`border-t cursor-pointer transition-colors ${
                        isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"
                      } ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}
                    >
                      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {r.brokerageId ? (
                          <input
                            type="checkbox"
                            checked={r.brokerageStatus === "received"}
                            disabled={togglingId === r.id}
                            onChange={() => toggleReceived(r)}
                            className="w-4 h-4 rounded border-2 accent-emerald-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        ) : (
                          <span className={`text-[10px] ${textS}`}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className={`text-xs font-semibold ${textP}`}>{r.bookingNumber || `#${r.id}`}</p>
                        <p className={`text-[10px] ${textS}`}>{r.bookingDate || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`text-xs font-medium truncate max-w-[140px] ${textP}`}>{r.customerName || "—"}</p>
                        <p className={`text-[10px] ${textS}`}>{r.createdBy || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`text-xs truncate max-w-[120px] ${textP}`}>{r.projectName || "—"}</p>
                        <p className={`text-[10px] ${textS}`}>{[r.tower, r.wing, r.flatNumber].filter(Boolean).join("-") || "—"}</p>
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-medium ${textP}`}>
                        {fmtFull(r.agreementValue)}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs hidden lg:table-cell ${r.ocrAmount > 0 ? textP : textS}`}>
                        {r.ocrAmount > 0 ? fmt(r.ocrAmount) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs hidden lg:table-cell ${r.disbursementAmount > 0 ? textP : textS}`}>
                        {r.disbursementAmount > 0 ? fmt(r.disbursementAmount) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-bold ${r.brokerageAmount ? textA : textS}`}>
                        {r.brokerageAmount != null ? fmtFull(r.brokerageAmount) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${sc.bg} ${sc.text}`}>
                          {sc.label}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right text-xs ${r.receivedAmount > 0 ? "text-emerald-400 font-bold" : textS}`}>
                        {r.receivedAmount > 0 ? fmtFull(r.receivedAmount) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-[#F5F5F7] border-[#E5E5EA]"}`}>
            <span className={`text-[10px] font-medium ${textS}`}>
              {pagination.total} result{pagination.total !== 1 ? "s" : ""} &middot; Page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className={`w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#E5E5EA]"}`}
              >
                <IoChevronBack size={14} />
              </button>
              <button
                onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
                disabled={page >= pagination.totalPages}
                className={`w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#E5E5EA]"}`}
              >
                <IoChevronForward size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedRecord && (
        <BookingDetailDrawer
          record={selectedRecord}
          isDark={isDark}
          onClose={() => setSelectedRecord(null)}
          onApply={!selectedRecord.brokerageId ? applyBrokerage : undefined}
          applying={applying}
        />
      )}
    </div>
  );
}
