"use client";

import { useEffect, useState, useCallback } from "react";
import {
  IoTrendingUpOutline,
  IoWalletOutline,
  IoCashOutline,
  IoStatsChartOutline,
  IoChevronDown,
  IoCheckmarkCircle,
  IoTimeOutline,
  IoAlertCircleOutline,
} from "react-icons/io5";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProfitSummary {
  totalBrokerageRevenue: number;
  receivedBrokerage: number;
  pendingBrokerage: number;
  expectedBrokerage: number;
  totalEmployeeCosts: number;
  totalResourceCosts: number;
  totalCosts: number;
  netContribution: number;
  profitMargin: number;
  completedBookings: number;
  totalBookingValue: number;
  allTimeBookings: number;
  allTimeBookingValue: number;
  brokerageConfigured: number;
  brokerageUnconfigured: number;
}

interface ChartPoint {
  month: string;
  revenue: number;
  costs: number;
}

interface EmployeeRow {
  userId: number;
  name: string;
  role: string;
  brokerageGenerated: number;
  employeeCost: number;
  resourceCost: number;
  netContribution: number;
}

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

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(mo) - 1]} ${y.slice(2)}`;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function ProfitKpiCard({
  label, value, sub, accent, isDark, icon: Icon, onClick,
}: {
  label: string; value: string; sub?: string; accent: string; isDark: boolean;
  icon: React.ComponentType<{ size: number; className?: string }>;
  onClick?: () => void;
}) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const clickable = onClick ? "cursor-pointer hover:ring-2 hover:ring-emerald-500/30 active:scale-[0.98] transition-all" : "";
  return (
    <div
      className={`rounded-2xl p-4 flex flex-col gap-1.5 ${card} ${clickable}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>
          {label}
        </span>
        <Icon size={16} className={accent} />
      </div>
      <span className={`text-2xl font-black ${accent}`}>{value}</span>
      {sub && <span className={`text-xs ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>{sub}</span>}
    </div>
  );
}

// ─── Simple Bar Chart ────────────────────────────────────────────────────────

function MiniBarChart({ data, isDark }: { data: ChartPoint[]; isDark: boolean }) {
  if (data.length === 0) return null;
  const maxVal = Math.max(...data.flatMap((d) => [d.revenue, d.costs]), 1);

  return (
    <div className={`rounded-2xl p-5 ${isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm"}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
          Brokerage vs Employee Costs
        </h3>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[10px] font-medium">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Revenue
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-medium">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> Costs
          </span>
        </div>
      </div>
      <div className="flex items-end gap-3 h-40">
        {data.map((d) => (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-end gap-1 w-full h-32">
              <div
                className="flex-1 rounded-t-md bg-emerald-500/80 transition-all duration-500"
                style={{ height: `${(d.revenue / maxVal) * 100}%`, minHeight: d.revenue > 0 ? 4 : 0 }}
                title={`Revenue: ${fmtFull(d.revenue)}`}
              />
              <div
                className="flex-1 rounded-t-md bg-red-400/80 transition-all duration-500"
                style={{ height: `${(d.costs / maxVal) * 100}%`, minHeight: d.costs > 0 ? 4 : 0 }}
                title={`Costs: ${fmtFull(d.costs)}`}
              />
            </div>
            <span className={`text-[9px] font-medium ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
              {monthLabel(d.month)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Brokerage Status Badge ──────────────────────────────────────────────────

function BrokerageStatusBadge({ amount, label, icon: Icon, color, isDark }: {
  amount: number; label: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
  color: string; isDark: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`}>
      <Icon size={16} className={color} />
      <div className="flex flex-col">
        <span className={`text-[10px] font-medium ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>{label}</span>
        <span className={`text-sm font-bold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>{fmtFull(amount)}</span>
      </div>
    </div>
  );
}

// ─── Date Range Selector ─────────────────────────────────────────────────────

function DateRangeSelector({
  from, to, onChange, isDark,
}: {
  from: string; to: string;
  onChange: (f: string, t: string) => void;
  isDark: boolean;
}) {
  const presets = [
    { label: "This Month", fn: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1), d]; } },
    { label: "Last Month", fn: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth() - 1, 1), new Date(d.getFullYear(), d.getMonth(), 0)]; } },
    { label: "Last 3 Months", fn: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth() - 2, 1), d]; } },
    { label: "This Year", fn: () => { const d = new Date(); return [new Date(d.getFullYear(), 0, 1), d]; } },
  ];
  const [open, setOpen] = useState(false);

  const applyPreset = (fn: () => Date[]) => {
    const [s, e] = fn();
    onChange(s.toISOString().slice(0, 10), e.toISOString().slice(0, 10));
    setOpen(false);
  };

  const inputCls = `px-2.5 py-1.5 rounded-lg text-xs font-medium border outline-none ${
    isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#E5E5EA] text-[#1D1D1F]"
  }`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className={inputCls}
      />
      <span className={`text-xs ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        className={inputCls}
      />
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
            isDark ? "bg-[#2C2C2E] border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "bg-white border-[#E5E5EA] text-[#86868B] hover:border-[#D1D1D6]"
          }`}
        >
          Presets <IoChevronDown size={12} />
        </button>
        {open && (
          <div className={`absolute right-0 top-full mt-1 z-20 rounded-xl shadow-lg border overflow-hidden ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-white border-[#E5E5EA]"}`}>
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.fn)}
                className={`w-full text-left px-4 py-2.5 text-xs font-medium cursor-pointer transition-colors ${
                  isDark ? "text-white hover:bg-[#38383A]" : "text-[#1D1D1F] hover:bg-[#F2F2F7]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function HRProfitability({ isDark, onOpenBrokerageCenter }: { isDark: boolean; onOpenBrokerageCenter?: () => void }) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayStr);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ProfitSummary>({
    totalBrokerageRevenue: 0, receivedBrokerage: 0, pendingBrokerage: 0, expectedBrokerage: 0,
    totalEmployeeCosts: 0, totalResourceCosts: 0, totalCosts: 0,
    netContribution: 0, profitMargin: 0, completedBookings: 0, totalBookingValue: 0,
    allTimeBookings: 0, allTimeBookingValue: 0, brokerageConfigured: 0, brokerageUnconfigured: 0,
  });
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);

  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textAccent = isDark ? "text-emerald-400" : "text-emerald-600";

  const fetchData = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/profitability?from=${f}&to=${t}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (j.success) {
        setSummary(j.data.summary);
        setChart(j.data.chart || []);
        setEmployees(j.data.employees || []);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load profitability data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(from, to); }, [from, to, fetchData]);

  const handleDateChange = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${textAccent}`}>Profitability</p>
            <h2 className={`text-xl font-black ${textPrimary}`}>Financial Overview</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={`rounded-2xl h-28 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Date Range */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${textAccent}`}>
            Profitability
          </p>
          <h2 className={`text-xl font-black ${textPrimary}`}>Financial Overview</h2>
          <p className={`text-sm mt-0.5 ${textSecondary}`}>
            Brokerage revenue vs employee costs for the selected period
          </p>
        </div>
        <DateRangeSelector from={from} to={to} onChange={handleDateChange} isDark={isDark} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl p-4 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchData(from, to)} className="underline cursor-pointer text-xs">Retry</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ProfitKpiCard
          label="Brokerage Revenue"
          value={`₹${fmt(summary.totalBrokerageRevenue)}`}
          sub={`${summary.completedBookings} booking${summary.completedBookings !== 1 ? "s" : ""} · Click to manage`}
          accent={textAccent}
          isDark={isDark}
          icon={IoCashOutline}
          onClick={onOpenBrokerageCenter}
        />
        <ProfitKpiCard
          label="Employee Costs"
          value={`₹${fmt(summary.totalCosts)}`}
          sub={summary.totalResourceCosts > 0 ? `Incl. ₹${fmt(summary.totalResourceCosts)} resources` : "Payroll + incentives"}
          accent="text-red-400"
          isDark={isDark}
          icon={IoWalletOutline}
        />
        <ProfitKpiCard
          label="Net Contribution"
          value={`₹${fmt(summary.netContribution)}`}
          sub={summary.netContribution >= 0 ? "Operating surplus" : "Operating deficit"}
          accent={summary.netContribution >= 0 ? "text-blue-400" : "text-red-500"}
          isDark={isDark}
          icon={IoTrendingUpOutline}
        />
        <ProfitKpiCard
          label="Profit Margin"
          value={`${summary.profitMargin.toFixed(1)}%`}
          sub={`On ₹${fmt(summary.totalBookingValue)} booking value`}
          accent={summary.profitMargin >= 0 ? "text-purple-400" : "text-red-400"}
          isDark={isDark}
          icon={IoStatsChartOutline}
        />
      </div>

      {/* Brokerage Status Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BrokerageStatusBadge
          amount={summary.receivedBrokerage}
          label="Received (Cash Collected)"
          icon={IoCheckmarkCircle}
          color="text-emerald-400"
          isDark={isDark}
        />
        <BrokerageStatusBadge
          amount={summary.pendingBrokerage}
          label="Pending Collection"
          icon={IoTimeOutline}
          color="text-amber-400"
          isDark={isDark}
        />
        <BrokerageStatusBadge
          amount={summary.expectedBrokerage}
          label="Expected (Not Yet Due)"
          icon={IoAlertCircleOutline}
          color="text-blue-400"
          isDark={isDark}
        />
      </div>

      {/* Revenue vs Cost Note */}
      <div className={`rounded-xl p-3 text-xs font-medium ${isDark ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
        Financial basis: Recognized brokerage revenue (expected + received + partially received). Collected-cash contribution = ₹{fmtFull(summary.receivedBrokerage - summary.totalCosts)}.
        Total booking value (₹{fmtFull(summary.totalBookingValue)}) is not treated as revenue.
      </div>

      {/* Booking & Config Summary */}
      {(summary.allTimeBookings > 0 || summary.brokerageUnconfigured > 0) && (
        <div className={`rounded-xl p-3 flex flex-wrap items-center gap-4 text-xs font-medium ${isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA]"}`}>
          <span className={isDark ? "text-[#98989D]" : "text-[#86868B]"}>
            All-time: <strong className={isDark ? "text-white" : "text-[#1D1D1F]"}>{summary.allTimeBookings}</strong> bookings ({fmtFull(summary.allTimeBookingValue)})
          </span>
          <span className={isDark ? "text-[#98989D]" : "text-[#86868B]"}>
            Brokerage configured: <strong className="text-emerald-400">{summary.brokerageConfigured}</strong>
          </span>
          {summary.brokerageUnconfigured > 0 && (
            <span className="text-amber-400">
              Missing config: <strong>{summary.brokerageUnconfigured}</strong>
            </span>
          )}
        </div>
      )}

      {/* Chart */}
      <MiniBarChart data={chart} isDark={isDark} />

      {/* Employee Profitability Table */}
      {employees.length > 0 && (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className={`px-5 py-3 ${isDark ? "bg-[#1C1C1E]" : "bg-[#F5F5F7]"}`}>
            <h3 className={`text-sm font-semibold ${textPrimary}`}>Employee Profitability</h3>
            <p className={`text-[10px] mt-0.5 ${textSecondary}`}>Brokerage generated vs cost per employee</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Employee</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Brokerage</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Salary Cost</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Resources</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Net</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => (
                  <tr
                    key={emp.userId}
                    className={`border-t transition-colors ${
                      isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"
                    } ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 bg-emerald-600">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-xs font-semibold truncate ${textPrimary}`}>{emp.name}</p>
                          <p className={`text-[10px] truncate ${textSecondary}`}>{emp.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-right text-xs font-medium ${textAccent}`}>
                      {fmtFull(emp.brokerageGenerated)}
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${textSecondary}`}>
                      {fmtFull(emp.employeeCost)}
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${textSecondary}`}>
                      {fmtFull(emp.resourceCost)}
                    </td>
                    <td className={`px-4 py-3 text-right text-xs font-bold ${emp.netContribution >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtFull(emp.netContribution)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
