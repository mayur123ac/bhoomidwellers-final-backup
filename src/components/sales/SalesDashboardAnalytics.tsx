"use client";

/**
 * The sales dashboard's Overview charts, lifted out of app/dashboard/sales/page.tsx.
 *
 * PERF: recharts is ~8 MB in node_modules and was imported STATICALLY at the top
 * of the sales page, so it landed in that route's initial JavaScript and had to be
 * parsed before first paint — including for the many sales users who never leave
 * the lead list. Living in its own module lets the page reach it through
 * next/dynamic, so the chart code is fetched when the Overview actually renders.
 *
 * The component itself is unchanged: same props, same state, same markup. `t` is
 * typed `any` here rather than importing buildTheme back out of the page, which
 * matches how the admin dashboard already types its theme prop.
 */

import { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

export default function DashboardAnalytics({ leads, isDark, t }: { leads: any[]; isDark: boolean; t: any }) {
  const [pieMode, setPieMode] = useState<"interest" | "loan" | "usetype" | "loanrequired" | "visits">("interest");
  const [barMode, setBarMode] = useState<"weekly" | "source">("weekly");

  const interestData = useMemo(() => { const c: Record<string, number> = { Interested: 0, "Not Interested": 0, "NON GENUINE DEMAND (NGD)": 0, Pending: 0 }; leads.forEach(l => { const s = l.leadInterestStatus; if (s === "NON GENUINE DEMAND (NGD)" || s === "Non Qualified Lead" || s === "Non Qualified Leads" || s === "Non qualified Lead") c["NON GENUINE DEMAND (NGD)"]++; else if (s && s !== "Pending" && c[s] !== undefined) c[s]++; else c["Pending"]++; }); return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })); }, [leads]);
  const loanPieData = useMemo(() => { const c: Record<string, number> = { Approved: 0, "In Progress": 0, Rejected: 0, "N/A": 0 }; leads.forEach(l => { const s = l.loanStatus; if (s && c[s] !== undefined) c[s]++; else c["N/A"]++; }); return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })); }, [leads]);
  const useTypeData = useMemo(() => { const c: Record<string, number> = {}; leads.forEach(l => { const ut = (l.useType && l.useType !== "Pending") ? l.useType : (l.purpose || "Unknown"); c[ut] = (c[ut] || 0) + 1; }); return Object.entries(c).filter(([k]) => k !== "Unknown").map(([name, value]) => ({ name, value })); }, [leads]);
  const loanRequiredData = useMemo(() => { const c: Record<string, number> = { Yes: 0, No: 0, "Not Sure": 0, Pending: 0 }; leads.forEach(l => { const lp = l.loanPlanned; if (lp && c[lp] !== undefined) c[lp]++; else c["Pending"]++; }); return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })); }, [leads]);
  const visitData = useMemo(() => { const s = leads.filter(l => l.mongoVisitDate).length; return [{ name: "Scheduled", value: s }, { name: "Pending", value: leads.length - s }]; }, [leads]);
  const weeklyData = useMemo(() => { const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; const counts = [0, 0, 0, 0, 0, 0, 0]; const now = new Date(); leads.forEach(l => { if (!l.created_at) return; const d = new Date(l.created_at); if (Math.floor((now.getTime() - d.getTime()) / 86400000) < 7) counts[d.getDay()]++; }); return days.map((day, i) => ({ day, leads: counts[i] })); }, [leads]);
  const sourceData = useMemo(() => { const c: Record<string, number> = {}; leads.forEach(l => { const src = l.source || "Unknown"; c[src] = (c[src] || 0) + 1; }); return Object.entries(c).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 6); }, [leads]);
  const weeklyTotal = weeklyData.reduce((a, b) => a + b.leads, 0);

  const interestColors: Record<string, string> = { Interested: "#4ade80", "Not Interested": "#f87171", "NON GENUINE DEMAND (NGD)": "#F97316", "Non Qualified Lead": "#F97316", Pending: "#6b7280" };
  const loanColors: Record<string, string> = { Approved: "#4ade80", "In Progress": "#fbbf24", Rejected: "#f87171", "N/A": "#6b7280" };
  const useTypeColors: Record<string, string> = { "Self Use": "#818cf8", Investment: "#34d399", "Personal use": "#f87171", "N/A": "#6b7280" };
  const loanReqColors: Record<string, string> = { Yes: "#60a5fa", No: "#6b7280", "Not Sure": "#fbbf24", Pending: "#374151" };
  const visitColors: Record<string, string> = { Scheduled: "#f97316", Pending: "#374151" };
  const BAR_COLORS = isDark
    ? ["#a855f7", "#818cf8", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#c084fc"]
    : ["#00AEEF", "#9E217B", "#0077b6", "#34d399", "#fbbf24", "#f87171", "#60a5fa"];
  const SRC_COLORS = isDark
    ? ["#a855f7", "#60a5fa", "#4ade80", "#fbbf24", "#f87171", "#34d399"]
    : ["#00AEEF", "#9E217B", "#0077b6", "#4ade80", "#fbbf24", "#f87171"];

  const pieData = pieMode === "interest" ? interestData : pieMode === "loan" ? loanPieData : pieMode === "usetype" ? useTypeData : pieMode === "loanrequired" ? loanRequiredData : visitData;
  const pieColors = pieMode === "interest" ? interestColors : pieMode === "loan" ? loanColors : pieMode === "usetype" ? useTypeColors : pieMode === "loanrequired" ? loanReqColors : visitColors;
  const totalLeads = leads.length;

  const BarTip = ({ active, payload, label }: any) => active && payload?.length
    ? <div className={`rounded-lg px-3 py-2 text-xs shadow-xl border ${t.dropdown}`} style={t.dropdownGlass}><p className={t.textMuted}>{label || payload[0].name}</p><p className={`font-bold ${t.text}`}>{payload[0].value}</p></div>
    : null;
  const PieTip = ({ active, payload }: any) => active && payload?.length
    ? <div className={`rounded-lg px-3 py-2 text-xs shadow-xl border ${t.dropdown}`} style={t.dropdownGlass}><p className={`font-bold ${t.text}`}>{payload[0].name}</p><p className={t.textMuted}>{payload[0].value} leads</p></div>
    : null;

  const axisColor = isDark ? "#9ca3af" : "#6B7280";
  const gridColor = isDark ? "#2a2a2a" : "#E5E7EB";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
        {/* Bar chart */}
        <div className={`rounded-3xl p-3 sm:p-3 shadow-sm border ${t.tableWrap}`} style={t.tableGlass}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className={`font-bold text-sm lg:text-base ${t.text}`}>{barMode === "weekly" ? "Leads This Week" : "Lead Source Distribution"}</h3>
              {barMode === "weekly" && <p className={`text-xs mt-0.5 font-semibold ${t.accentText}`}>{weeklyTotal} total this week</p>}
            </div>
            <select value={barMode} onChange={e => setBarMode(e.target.value as any)} className={`rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer border w-full sm:w-auto ${t.selectSmall}`}>
              <option value="weekly">Total Leads Assigned</option>
              <option value="source">Lead Source Distribution</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            {barMode === "weekly" ? (
              <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="day" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RTooltip content={<BarTip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="leads" radius={[6, 6, 0, 0]}>{weeklyData.map((_: any, i: number) => <Cell key={i} fill={BAR_COLORS[i % 7]} />)}</Bar>
              </BarChart>
            ) : (
              <BarChart data={sourceData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="source" width={100} tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                <RTooltip content={<BarTip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>{sourceData.map((_: any, i: number) => <Cell key={i} fill={SRC_COLORS[i % 6]} />)}</Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div className={`rounded-4xl p-3 sm:p-3 shadow-sm border ${t.tableWrap}`} style={t.tableGlass}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <h3 className={`font-bold text-sm lg:text-base ${t.text}`}>
              {pieMode === "interest" ? "Lead Interest Breakdown" : pieMode === "loan" ? "Loan Status Breakdown" : pieMode === "usetype" ? "Self-Use vs Investment" : pieMode === "loanrequired" ? "Loan Required?" : "Visit Scheduled vs Pending"}
            </h3>
            <select value={pieMode} onChange={e => setPieMode(e.target.value as any)} className={`rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer border w-full sm:w-auto ${t.selectSmall}`}>
              <option value="interest">Lead Interest</option>
              <option value="loan">Loan Status</option>
              <option value="usetype">Self-Use vs Investment</option>
              <option value="loanrequired">Loan Required?</option>
              <option value="visits">Visit Scheduled vs Pending</option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <ResponsiveContainer width="100%" height={200} className="sm:w-[55%]">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {pieData.map((entry: any, i: number) => <Cell key={i} fill={pieColors[entry.name] ?? "#6b7280"} />)}
                </Pie>
                <RTooltip content={<PieTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 w-full sm:w-[45%] flex-1">
              {pieData.map((entry: any) => {
                const color = pieColors[entry.name] ?? "#6b7280";
                const pct = totalLeads > 0 ? Math.round((entry.value / totalLeads) * 100) : 0;
                return (
                  <div key={entry.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} /><span className={`text-[11px] sm:text-xs font-medium ${t.textMuted}`}>{entry.name}</span></div>
                    <div className="flex items-center gap-1.5"><span className={`text-[11px] sm:text-xs font-bold ${t.text}`}>{entry.value}</span><span className={`text-[10px] ${t.textFaint}`}>({pct}%)</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
