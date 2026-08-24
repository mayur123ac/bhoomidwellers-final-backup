"use client";

/**
 * The admin dashboard's charts, lifted out of app/dashboard/page.tsx.
 *
 * PERF: recharts is ~8 MB in node_modules and was imported STATICALLY at the top
 * of the admin page, so it sat in that route's initial JavaScript and had to be
 * parsed before first paint. Everything in this file is reached through
 * next/dynamic instead, so the chart code loads when a chart actually renders.
 *
 * The components are unchanged: same props, same state, same markup.
 */

import { useMemo, useState } from "react";
import { downloadCSV } from "@/lib/downloadCsv";
import { FaChartPie, FaDownload, FaCalendarAlt } from "react-icons/fa";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
  CartesianGrid, PieChart, Pie,
} from "recharts";


export function DashboardAnalytics({ leads, theme, isDark }: { leads: any[]; theme: any; isDark: boolean }) {
  const [pieMode, setPieMode] = useState<"interest" | "loan" | "usetype" | "loanrequired" | "visits">("interest");
  const [barMode, setBarMode] = useState<"weekly" | "source" | "cp">("weekly");

  const interestData = useMemo(() => {
    const c: Record<string, number> = { Interested: 0, "Not Interested": 0, "NON GENUINE DEMAND (NGD)": 0, Pending: 0 };
    leads.forEach(l => {
      const s = l.leadInterestStatus;
      if (s === "NON GENUINE DEMAND (NGD)" || s === "Non Qualified Lead" || s === "Non Qualified Leads" || s === "Non qualified Lead") c["NON GENUINE DEMAND (NGD)"]++;
      else if (s && s !== "Pending" && c[s] !== undefined) c[s]++;
      else c["Pending"]++;
    });
    return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [leads]);

  const loanPieData = useMemo(() => {
    const c: Record<string, number> = { Approved: 0, "In Progress": 0, Rejected: 0, "N/A": 0 };
    leads.forEach(l => { const s = l.loanStatus; if (s && c[s] !== undefined) c[s]++; else c["N/A"]++; });
    return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [leads]);

  const useTypeData = useMemo(() => {
    const c: Record<string, number> = {};
    leads.forEach(l => { const ut = (l.useType && l.useType !== "Pending") ? l.useType : (l.purpose || "Unknown"); c[ut] = (c[ut] || 0) + 1; });
    return Object.entries(c).filter(([k]) => k !== "Unknown").map(([name, value]) => ({ name, value }));
  }, [leads]);

  const loanRequiredData = useMemo(() => {
    const c: Record<string, number> = { Yes: 0, No: 0, "Not Sure": 0, Pending: 0 };
    leads.forEach(l => {
      const lp = l.loanPlanned;
      if (lp && c[lp] !== undefined) c[lp]++;
      else c["Pending"]++;
    });
    return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [leads]);

  const visitData = useMemo(() => {
    const scheduled = leads.filter(l => l.mongoVisitDate).length;
    return [{ name: "Scheduled", value: scheduled }, { name: "Pending", value: leads.length - scheduled }];
  }, [leads]);

  const weeklyData = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    leads.forEach(l => {
      if (!l.created_at) return;
      const d = new Date(l.created_at);
      if (Math.floor((now.getTime() - d.getTime()) / 86400000) < 7) counts[d.getDay()]++;
    });
    return days.map((day, i) => ({ day, leads: counts[i] }));
  }, [leads]);

  const weeklyTotal = weeklyData.reduce((a, b) => a + b.leads, 0);

  const sourceData = useMemo(() => {
    const c: Record<string, number> = {};
    leads.forEach(l => { const src = l.source || "Unknown"; c[src] = (c[src] || 0) + 1; });
    return Object.entries(c).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [leads]);
  const cpData = useMemo(() => {
    const c: Record<string, number> = {};
    leads.forEach(l => {
      // 1. Grab the name from whichever property exists
      const actualCpName = l.cpName || l.cp_name;

      // 2. Verify it's a Channel Partner AND that we have a valid name
      if (
        l.source === "Channel Partner" &&
        actualCpName &&
        actualCpName !== "N/A" &&
        actualCpName !== "—"
      ) {
        // 3. Trim whitespace to prevent duplicates like "Broker" and "Broker "
        const cleanName = actualCpName.trim();

        // 4. Increment the count
        c[cleanName] = (c[cleanName] || 0) + 1;
      }
    });
    return Object.entries(c).map(([cp, count]) => ({ cp, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [leads]);

  const interestColors: Record<string, string> = { Interested: "#4ade80", "Not Interested": "#f87171", "NON GENUINE DEMAND (NGD)": "#F97316", "Non Qualified Lead": "#F97316", Pending: "#6b7280" };
  const loanColors: Record<string, string> = { Approved: "#4ade80", "In Progress": "#fbbf24", Rejected: "#f87171", "N/A": "#6b7280" };
  const useTypeColors: Record<string, string> = { "Self Use": "#9E217B", Investment: "#34d399", "Personal use": "#f87171", "N/A": "#6b7280" };
  const loanReqColors: Record<string, string> = { Yes: "#9E217B", No: "#6b7280", "Not Sure": "#fbbf24", Pending: "#374151" };
  const visitColors: Record<string, string> = { Scheduled: "#f97316", Pending: "#374151" };

  const pieData = pieMode === "interest" ? interestData : pieMode === "loan" ? loanPieData : pieMode === "usetype" ? useTypeData : pieMode === "loanrequired" ? loanRequiredData : visitData;
  const pieColors = pieMode === "interest" ? interestColors : pieMode === "loan" ? loanColors : pieMode === "usetype" ? useTypeColors : pieMode === "loanrequired" ? loanReqColors : visitColors;
  const totalLeads = leads.length;

  const BAR_COLORS = theme.chartColors;

  const BarTip = ({ active, payload, label }: any) => active && payload?.length
    ? <div className="rounded-lg px-4 py-3 sm:py-4 text-xs shadow-xl" style={{ backgroundColor: theme.tooltipBg, color: theme.tooltipColor, border: theme.tooltipBorder }}><p className={theme.textMuted}>{label || payload[0].name}</p><p className="font-bold">{payload[0].value}</p></div>
    : null;

  const PieTip = ({ active, payload }: any) => active && payload?.length
    ? <div className="rounded-lg px-4 py-3 sm:py-4 text-xs shadow-xl" style={{ backgroundColor: theme.tooltipBg, color: theme.tooltipColor, border: theme.tooltipBorder }}><p className="font-bold mb-1">{payload[0].name}</p><p>{payload[0].value} leads</p></div>
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* BAR CHART */}
      <div className={`${theme.card} rounded-3xl p-5`} style={theme.cardGlass}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className={`${theme.text} font-bold text-sm flex items-center gap-2`}>
              <FaChartPie className={`text-[#9E217B] text-xs`} />
              {barMode === "weekly" ? "Leads Added This Week" : barMode === "cp" ? "Leads by Channel Partner" : "Lead Source Distribution"}
            </h3>
            {barMode === "weekly" && <p className="text-[#9E217B] text-xs mt-0.5 font-semibold">{weeklyTotal} total this week</p>}
            {barMode === "cp" && <p className="text-[#9E217B] text-xs mt-0.5 font-semibold">{cpData.reduce((a, b) => a + b.count, 0)} CP leads total</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                let data = [];
                let name = "";
                if (barMode === "weekly") { data = weeklyData; name = "Weekly_Leads"; }
                else if (barMode === "cp") { data = cpData; name = "CP_Leads"; }
                else { data = sourceData; name = "Source_Distribution"; }
                downloadCSV(data, `${name}.csv`);
              }}
              className={`p-2 border rounded-lg transition-colors hover:opacity-80 ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
              title="Export Bar Chart Data"
            >
              <FaDownload size={12} />
            </button>
            <select value={barMode} onChange={e => setBarMode(e.target.value as any)}
              className={`${theme.select} rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer appearance-none`}>
              <option value="weekly">Leads This Week</option>
              <option value="source">Lead Source Distribution</option>
              <option value="cp">Channel Partner Leads</option>
            </select>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          {barMode === "weekly" ? (
            <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2a2a2a" : "#E5E7EB"} />
              <XAxis dataKey="day" tick={{ fill: theme.legendColor, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: theme.legendColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartsTooltip content={<BarTip />} cursor={{ fill: "transparent" }} />
              <Bar dataKey="leads" radius={[6, 6, 0, 0]}>
                {weeklyData.map((_: any, i: number) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
              </Bar>
            </BarChart>
          ) : barMode === "cp" ? (
            <BarChart data={cpData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2a2a2a" : "#E5E7EB"} />
              <XAxis dataKey="cp" tick={{ fill: theme.legendColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: theme.legendColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartsTooltip content={<BarTip />} cursor={{ fill: "transparent" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {cpData.map((_: any, i: number) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={sourceData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2a2a2a" : "#E5E7EB"} horizontal={false} />
              <XAxis type="number" tick={{ fill: theme.legendColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="source" width={100} tick={{ fill: theme.legendColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <RechartsTooltip content={<BarTip />} cursor={{ fill: "transparent" }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {sourceData.map((_: any, i: number) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* PIE CHART */}
      <div className={`${theme.card} rounded-3xl p-5`} style={theme.cardGlass}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`${theme.text} font-bold text-sm flex items-center gap-2`}>
            <FaChartPie className="text-[#00AEEF] text-xs" />
            {pieMode === "interest" ? "Lead Interest Breakdown" :
              pieMode === "loan" ? "Loan Status Breakdown" :
                pieMode === "usetype" ? "Self-Use vs Investment" :
                  pieMode === "loanrequired" ? "Loan Required?" :
                    "Visit Scheduled vs Pending"}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadCSV(pieData, `${pieMode}_chart_data.csv`)}
              className={`p-2 border rounded-lg transition-colors hover:opacity-80 ${isDark ? 'bg-[#222] border-[#333] text-white' : 'bg-white border-indigo-200 text-indigo-600'}`}
              title="Export Pie Chart Data"
            >
              <FaDownload size={12} />
            </button>
            <select value={pieMode} onChange={e => setPieMode(e.target.value as any)}
              className={`${theme.select} rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer appearance-none`}>
              <option value="interest">Lead Interest</option>
              <option value="loan">Loan Status</option>
              <option value="usetype">Self-Use vs Investment</option>
              <option value="loanrequired">Loan Required?</option>
              <option value="visits">Visit Scheduled vs Pending</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ResponsiveContainer width="55%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                {pieData.map((entry: any, i: number) => <Cell key={i} fill={pieColors[entry.name] ?? "#6b7280"} />)}
              </Pie>
              <RechartsTooltip content={<PieTip />} contentStyle={{ boxShadow: theme.tooltipShadow }} cursor={{ fill: "transparent" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-2 flex-1">
            {pieData.map((entry: any) => {
              const color = pieColors[entry.name] ?? "#6b7280";
              const pct = totalLeads > 0 ? Math.round((entry.value / totalLeads) * 100) : 0;
              return (
                <div key={entry.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className={`text-[11px] font-medium ${theme.textFaint}`}>{entry.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-bold ${theme.text}`}>{entry.value}</span>
                    <span className={`text-[10px] ${theme.textMuted}`}>({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Manager Workload" — active leads per sales manager. */
export function ManagerWorkloadChart({ managerStats, theme, isDark }: { managerStats: any[]; theme: any; isDark: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={managerStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2a2a2a" : "#E5E7EB"} vertical={false} />
        <XAxis dataKey="name" stroke={theme.legendColor} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={theme.legendColor} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <RechartsTooltip
          cursor={{ fill: "transparent" }}
          contentStyle={{ backgroundColor: theme.tooltipBg, border: theme.tooltipBorder, borderRadius: "8px", color: theme.tooltipColor, boxShadow: theme.tooltipShadow }}
          itemStyle={{ color: theme.tooltipColor }}
        />
        <Bar dataKey="activeLeads" radius={[4, 4, 0, 0]} barSize={45}>
          {managerStats.map((_: any, i: number) => <Cell key={i} fill={theme.chartColors[i % theme.chartColors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** "Site Visits" — upcoming visits by manager, pie plus its own legend list. */
export function SiteVisitsChart({ pieData, theme, visitColors }: { pieData: any[]; theme: any; visitColors: string[] }) {
  return (
    <div className="flex flex-col h-full">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={pieData} dataKey="siteVisits" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={3}>
            {pieData.map((_: any, i: number) => <Cell key={i} fill={visitColors[i % visitColors.length]} />)}
          </Pie>
          <RechartsTooltip cursor={{ fill: "transparent" }} contentStyle={{ backgroundColor: theme.tooltipBg, border: theme.tooltipBorder, borderRadius: "8px", color: theme.tooltipColor }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-1.5 mt-2 overflow-y-auto max-h-[100px]">
        {pieData.map((entry: any, i: number) => (
          <div key={entry.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: visitColors[i % visitColors.length] }} />
              <span className={`truncate max-w-[100px] ${theme.textMuted}`}>{entry.name}</span>
            </div>
            <span className={`font-bold ${theme.text}`}>{entry.siteVisits}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
