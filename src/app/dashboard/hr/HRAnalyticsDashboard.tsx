"use client";

// HRAnalyticsDashboard — Phase 4B replacement for the Analytics tab.
// Sections: Executive Overview, Attendance, Payroll, Incentives, Performance, AI Chat.
// Fetches from /api/hr/analytics (structured) and embeds HRAnalyticsChat.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip as ReTooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  IoStatsChartOutline, IoSparkles,
  IoPeopleOutline, IoWalletOutline, IoTrendingUpOutline,
  IoChatbubblesOutline, IoRefreshOutline,
} from "react-icons/io5";
import dynamic from "next/dynamic";

const HRAnalyticsChat = dynamic(() => import("./HRAnalyticsChat"), { ssr: false });

// ── Colours ─────────────────────────────────────────────────────────────────
const C = {
  present:  "#10B981",
  absent:   "#F43F5E",
  onLeave:  "#F59E0B",
  gross:    "#6366F1",
  deductions: "#F43F5E",
  net:      "#10B981",
  paid:     "#3B82F6",
  pending:  "#F59E0B",
  approved: "#10B981",
  paidInc:  "#3B82F6",
};
const ROLE_COLORS = ["#10B981", "#3B82F6", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6"];

// ── Types ───────────────────────────────────────────────────────────────────
interface AnalyticsData {
  days: number;
  executive: {
    totalEmployees: number;
    todayPresent: number;
    todayAbsent: number;
    todayOnLeave: number;
    attendanceRate: number | null;
    approvedPayroll: number | null;
    totalPaid: number | null;
    outstanding: number | null;
    incentivesPending: number;
    incentivesApproved: number;
  };
  attendanceTrend: { date: string; present: number; absent: number }[];
  attendanceByRole: { role: string; total: number; present: number; absent: number; onLeave: number }[];
  payrollTrend: { month: string; year: number; gross: number; deductions: number; net: number; paid: number; status: string; employees: number; approved: number; exceptions: number }[];
  incentives: {
    pendingCount: number; pendingTotal: number;
    approvedCount: number; approvedTotal: number;
    paidCount: number; paidTotal: number;
    byEmployee: { name: string; role: string; total: number; count: number }[];
  };
  performance: {
    byEmployee: { name: string; role: string; leads: number; followUps: number; visits: number }[];
  };
  connectStats: { open: number; inProgress: number; resolved: number; total: number; byCategory: { category: string; count: number }[] };
}

interface Props {
  isDark: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString("en-IN");
}
function fmtInr(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function tickStyle(isDark: boolean) {
  return { fontSize: 11, fill: isDark ? "#98989D" : "#86868B" };
}

// ── Reusable UI pieces ──────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent, isDark }: {
  label: string; value: string | number; sub?: string; accent: string; isDark: boolean;
}) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  return (
    <div className={`rounded-2xl p-4 flex flex-col gap-1 ${card}`}>
      <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>{label}</span>
      <span className={`text-2xl font-black ${accent}`}>{value}</span>
      {sub && <span className={`text-xs ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>{sub}</span>}
    </div>
  );
}

function SectionDivider({ title, icon: Icon, isDark }: { title: string; icon: React.ComponentType<{ size: number; className?: string }>; isDark: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-4">
      <Icon size={16} className={isDark ? "text-emerald-400" : "text-emerald-600"} />
      <h3 className={`text-sm font-bold uppercase tracking-wide ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>{title}</h3>
      <div className={`flex-1 h-px ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />
    </div>
  );
}

function ChartCard({ title, subtitle, isDark, children, minH = "h-64" }: {
  title: string; subtitle?: string; isDark: boolean; children: React.ReactNode; minH?: string;
}) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  return (
    <div className={`rounded-2xl p-5 flex flex-col gap-3 ${card}`}>
      <div>
        <h4 className={`text-sm font-bold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>{title}</h4>
        {subtitle && <p className={`text-[11px] mt-0.5 ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>{subtitle}</p>}
      </div>
      <div className={`w-full ${minH}`}>{children}</div>
    </div>
  );
}

function EmptyChart({ isDark, label }: { isDark: boolean; label?: string }) {
  return (
    <div className={`flex items-center justify-center h-full text-xs font-medium ${isDark ? "text-[#48484A]" : "text-[#C7C7CC]"}`}>
      {label || "No data available"}
    </div>
  );
}

function CustomTooltip({ active, payload, label, isDark }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-xl px-3 py-2 shadow-xl text-xs border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#E5E5EA] text-[#1D1D1F]"}`}>
      <p className="font-bold mb-1">{label}</p>
      {payload.map((e: any) => (
        <p key={e.name} style={{ color: e.color }} className="font-medium">
          {e.name}: {typeof e.value === "number" && e.value >= 1000 ? fmt(e.value) : e.value}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload, isDark }: any) {
  if (!active || !payload?.length) return null;
  const e = payload[0];
  return (
    <div className={`rounded-xl px-3 py-2 shadow-xl text-xs border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#E5E5EA] text-[#1D1D1F]"}`}>
      <p style={{ color: e.payload.fill }} className="font-bold">{e.name}</p>
      <p className="text-[11px]">{fmt(e.value)}</p>
    </div>
  );
}

function LoadingSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`rounded-2xl h-24 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className={`rounded-2xl h-64 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
        <div className={`rounded-2xl h-64 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function HRAnalyticsDashboard({ isDark }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/analytics?days=${d}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
      setData(json.data);
    } catch (e: any) {
      setError(e.message || "Failed to load analytics data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(days); }, [days, fetchData]);

  const trendData = useMemo(() =>
    (data?.attendanceTrend ?? []).map((r) => ({
      ...r,
      label: new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    })),
    [data?.attendanceTrend]
  );

  const incentivePie = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Pending", value: data.incentives.pendingTotal, fill: C.pending },
      { name: "Approved", value: data.incentives.approvedTotal, fill: C.approved },
      { name: "Paid", value: data.incentives.paidTotal, fill: C.paidInc },
    ].filter(d => d.value > 0);
  }, [data]);

  const connectPie = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Open", value: data.connectStats.open, fill: "#F59E0B" },
      { name: "In Progress", value: data.connectStats.inProgress, fill: "#3B82F6" },
      { name: "Resolved", value: data.connectStats.resolved, fill: "#10B981" },
    ].filter(d => d.value > 0);
  }, [data]);

  const textAccent = isDark ? "text-emerald-400" : "text-emerald-600";

  if (loading) return <LoadingSkeleton isDark={isDark} />;

  if (error) {
    return (
      <div className={`rounded-2xl p-6 border ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]"}`}>
        <div className="text-center space-y-3">
          <p className="text-red-400 text-sm font-medium">{error}</p>
          <button onClick={() => fetchData(days)} className={`px-4 py-2 rounded-lg text-xs font-bold ${isDark ? "bg-emerald-600 text-white" : "bg-emerald-600 text-white"}`}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const ex = data.executive;

  return (
    <div className="space-y-6">
      {/* Period filter + refresh */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${textAccent}`}>HR Dashboard</p>
          <h2 className={`text-xl font-black ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>Analytics</h2>
          <p className={`text-sm mt-0.5 ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
            Unified view of workforce, payroll, incentives, and performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {([7, 14, 30, 60] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
                days === d
                  ? isDark ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "bg-emerald-100 border-emerald-300 text-emerald-700"
                  : isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#E5E5EA] text-[#86868B] hover:border-[#D1D1D6]"
              }`}>
              {d}d
            </button>
          ))}
          <button onClick={() => fetchData(days)} title="Refresh"
            className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E] text-[#98989D]" : "hover:bg-[#F2F2F7] text-[#86868B]"}`}>
            <IoRefreshOutline size={16} />
          </button>
        </div>
      </div>

      {/* ── A. Executive Overview ────────────────────────────────────────── */}
      <SectionDivider title="Executive Overview" icon={IoStatsChartOutline} isDark={isDark} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Workforce" value={fmt(ex.totalEmployees)} accent={textAccent} isDark={isDark} />
        <KpiCard label="Present Today" value={fmt(ex.todayPresent)} sub={`${fmt(ex.todayAbsent)} absent, ${fmt(ex.todayOnLeave)} on leave`} accent="text-emerald-500" isDark={isDark} />
        <KpiCard label="Attendance Rate" value={ex.attendanceRate != null ? `${ex.attendanceRate}%` : "--"} sub={`Last ${data.days} days`} accent="text-blue-400" isDark={isDark} />
        <KpiCard label="Approved Payroll" value={fmtInr(ex.approvedPayroll)} sub={ex.outstanding != null && ex.outstanding > 0 ? `${fmtInr(ex.outstanding)} outstanding` : ex.totalPaid != null ? "Fully disbursed" : undefined} accent="text-purple-400" isDark={isDark} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard label="Total Paid" value={fmtInr(ex.totalPaid)} sub="Completed payments" accent="text-blue-400" isDark={isDark} />
        <KpiCard label="Incentives Pending" value={fmtInr(ex.incentivesPending)} sub="Awaiting approval" accent="text-amber-400" isDark={isDark} />
        <KpiCard label="Incentives Approved" value={fmtInr(ex.incentivesApproved)} sub="Ready for payout" accent="text-emerald-400" isDark={isDark} />
      </div>

      {/* ── B. Attendance Analytics ──────────────────────────────────────── */}
      <SectionDivider title="Attendance Analytics" icon={IoPeopleOutline} isDark={isDark} />

      <div className="grid md:grid-cols-2 gap-6">
        {/* Attendance Trend */}
        <div className="md:col-span-2">
          <ChartCard title="Attendance Trend" subtitle={`Present vs Absent — last ${data.days} days`} isDark={isDark}>
            {trendData.length === 0 ? <EmptyChart isDark={isDark} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                  <XAxis dataKey="label" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                  <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                  <Legend wrapperStyle={{ fontSize: "11px", marginTop: "8px" }} />
                  <Line type="monotone" dataKey="present" name="Present" stroke={C.present} strokeWidth={2.5} dot={{ r: 3, fill: C.present }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="absent" name="Absent" stroke={C.absent} strokeWidth={2.5} dot={{ r: 3, fill: C.absent }} activeDot={{ r: 5 }} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Attendance by Role */}
        <div className="md:col-span-2">
          <ChartCard title="Attendance by Role" subtitle="Today — Present / Absent / On Leave per role" isDark={isDark}>
            {data.attendanceByRole.length === 0 ? <EmptyChart isDark={isDark} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.attendanceByRole} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                  <XAxis dataKey="role" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                  <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="present" name="Present" stackId="a" fill={C.present} />
                  <Bar dataKey="absent" name="Absent" stackId="a" fill={C.absent} />
                  <Bar dataKey="onLeave" name="On Leave" stackId="a" fill={C.onLeave} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>

      {/* ── E. Payroll Analytics ─────────────────────────────────────────── */}
      <SectionDivider title="Payroll Analytics" icon={IoWalletOutline} isDark={isDark} />

      {data.payrollTrend.length === 0 ? (
        <div className={`rounded-2xl p-8 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>No payroll periods found</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Payroll trend — gross/deductions/net */}
          <div className="md:col-span-2">
            <ChartCard title="Payroll Trend" subtitle="Gross / Deductions / Net / Paid — recent periods" isDark={isDark}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.payrollTrend} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                  <XAxis dataKey="month" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                  <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`} />
                  <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="gross" name="Gross" fill={C.gross} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="deductions" name="Deductions" fill={C.deductions} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="net" name="Net" fill={C.net} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="paid" name="Paid" fill={C.paid} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Payroll period table */}
          <div className="md:col-span-2">
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Period</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employees</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Gross</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Net</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Paid</th>
                      <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payrollTrend.map((p, i) => (
                      <tr key={i} className={`border-t ${isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                        <td className="px-4 py-2.5 font-medium">{p.month} {p.year}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{p.employees}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtInr(p.gross)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtInr(p.net)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtInr(p.paid)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.status === "approved" ? isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                            : p.status === "draft" ? isDark ? "bg-gray-500/15 text-gray-400" : "bg-gray-100 text-gray-600"
                            : isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-700"
                          }`}>{p.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── D. Incentive Analytics ───────────────────────────────────────── */}
      <SectionDivider title="Incentive Analytics" icon={IoTrendingUpOutline} isDark={isDark} />

      {data.incentives.pendingCount + data.incentives.approvedCount + data.incentives.paidCount === 0 ? (
        <div className={`rounded-2xl p-8 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>No incentive records found</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Incentive breakdown pie */}
          <ChartCard title="Incentive Breakdown" subtitle="Pending vs Approved vs Paid" isDark={isDark}>
            {incentivePie.length === 0 ? <EmptyChart isDark={isDark} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={incentivePie} cx="50%" cy="45%" innerRadius="50%" outerRadius="72%" paddingAngle={3} dataKey="value">
                    {incentivePie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <ReTooltip content={<PieTooltip isDark={isDark} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Top earners */}
          <ChartCard title="Top Incentive Earners" subtitle="Approved + Paid — by employee" isDark={isDark}>
            {data.incentives.byEmployee.length === 0 ? <EmptyChart isDark={isDark} label="No approved incentives yet" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.incentives.byEmployee} layout="vertical" margin={{ left: 60, right: 16, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                  <XAxis type="number" tick={tickStyle(isDark)} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`} />
                  <YAxis type="category" dataKey="name" tick={tickStyle(isDark)} tickLine={false} axisLine={false} width={60} />
                  <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                  <Bar dataKey="total" name="Total" fill={C.approved} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Incentive summary cards */}
          <div className="md:col-span-2 grid grid-cols-3 gap-4">
            <KpiCard label="Pending" value={data.incentives.pendingCount} sub={fmtInr(data.incentives.pendingTotal)} accent="text-amber-400" isDark={isDark} />
            <KpiCard label="Approved" value={data.incentives.approvedCount} sub={fmtInr(data.incentives.approvedTotal)} accent="text-emerald-400" isDark={isDark} />
            <KpiCard label="Paid" value={data.incentives.paidCount} sub={fmtInr(data.incentives.paidTotal)} accent="text-blue-400" isDark={isDark} />
          </div>
        </div>
      )}

      {/* ── C. Performance Analytics ─────────────────────────────────────── */}
      <SectionDivider title="Performance Analytics" icon={IoStatsChartOutline} isDark={isDark} />

      {data.performance.byEmployee.length === 0 ? (
        <div className={`rounded-2xl p-8 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>No sales performance data for this period</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-1 gap-6">
          {/* Performance bar chart */}
          <ChartCard title="Lead Activity by Employee" subtitle={`Leads / Follow-ups / Visits — last ${data.days} days`} isDark={isDark} minH="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.performance.byEmployee} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                <XAxis dataKey="name" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="leads" name="Leads" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="followUps" name="Follow-ups" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="visits" name="Visits" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Performance table */}
          <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employee</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Role</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Leads</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Follow-ups</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.performance.byEmployee.map((emp, i) => (
                    <tr key={i} className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                      <td className="px-4 py-2.5 font-medium">{emp.name}</td>
                      <td className={`px-4 py-2.5 ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>{emp.role}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{emp.leads}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{emp.followUps}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{emp.visits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── HR Connect Stats ─────────────────────────────────────────────── */}
      {data.connectStats.total > 0 && (
        <>
          <SectionDivider title="HR Connect" icon={IoChatbubblesOutline} isDark={isDark} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Total Requests" value={data.connectStats.total} accent={textAccent} isDark={isDark} />
            <KpiCard label="Open" value={data.connectStats.open} accent="text-amber-400" isDark={isDark} />
            <KpiCard label="In Progress" value={data.connectStats.inProgress} accent="text-blue-400" isDark={isDark} />
            <KpiCard label="Resolved" value={data.connectStats.resolved} accent="text-emerald-400" isDark={isDark} />
          </div>
          {data.connectStats.byCategory.length > 0 && (
            <ChartCard title="Requests by Category" subtitle="Distribution of HR Connect requests" isDark={isDark} minH="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.connectStats.byCategory} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                  <XAxis dataKey="category" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                  <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                  <Bar dataKey="count" name="Requests" radius={[6, 6, 0, 0]}>
                    {data.connectStats.byCategory.map((_, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </>
      )}

      {/* ── F. AI Insights ────────────────────────────────────────────────── */}
      <SectionDivider title="AI Insights" icon={IoSparkles} isDark={isDark} />
      <div className={`rounded-2xl border overflow-hidden ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]"}`} style={{ minHeight: 400 }}>
        <HRAnalyticsChat isDark={isDark} />
      </div>
    </div>
  );
}
