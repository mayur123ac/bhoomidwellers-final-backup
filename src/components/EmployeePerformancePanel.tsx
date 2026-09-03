"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: number;
  name: string;
  role: string;
  totalLeads: number;
  activeLeads: number;
  closingLeads: number;
  lostLeads: number;
  contactedLeads: number;
  stagnantLeads: number;
  activeInLast7d: number;
  dataQualityLeads: number;
  totalFollowups: number;
  leadsWithFollowups: number;
  visitsScheduled: number;
  visitsCompleted: number;
  leadsWithVisits: number;
  leadsVisitCompleted: number;
  totalBookings: number;
  activeBookings: number;
  totalAgreementValue: number;
  totalReminders: number;
  completedReminders: number;
  overdueReminders: number;
  firstActionSpeed: number | null;
  contactRate: number | null;
  followupRate: number | null;
  siteVisitRate: number | null;
  visitCompletionRate: number | null;
  bookingRate: number | null;
  lostRate: number | null;
  stagnationRate: number | null;
  dataQualityRate: number | null;
  reminderCompletionRate: number | null;
}

interface StagnantLead {
  id: number;
  sr_no: number;
  name: string;
  phone: string;
  assigned_to: string;
  status: string;
  last_activity_at: string | null;
  assigned_at: string | null;
  budget: string;
  configuration: string;
}

interface PerfData {
  employees: Employee[];
  stagnantLeads: StagnantLead[];
  period: string;
  generatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rateColor(rate: number | null, invert = false): string {
  if (rate === null) return "text-gray-400";
  if (invert) {
    // Lower is better (lost rate, stagnation rate)
    if (rate <= 10) return "text-green-500";
    if (rate <= 30) return "text-yellow-500";
    return "text-red-500";
  }
  if (rate >= 70) return "text-green-500";
  if (rate >= 40) return "text-yellow-500";
  return "text-red-500";
}

function speedLabel(hours: number | null): { text: string; color: string } {
  if (hours === null) return { text: "—", color: "text-gray-400" };
  if (hours <= 1) return { text: `${hours}h`, color: "text-green-500" };
  if (hours <= 4) return { text: `${hours}h`, color: "text-yellow-500" };
  if (hours <= 24) return { text: `${hours}h`, color: "text-orange-500" };
  return { text: `${Math.round(hours / 24)}d`, color: "text-red-500" };
}

function fmtRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

function fmtMoney(val: number): string {
  if (val >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return String(val);
}

// KPI formula tooltips for percentage/rate columns
const kpiTooltips: Record<string, string> = {
  "contactRate": "Contacted Leads / Total Leads × 100\nLeads where first contact was made",
  "Contact %": "Contacted Leads / Total Leads × 100\nLeads where first contact was made",
  "followupRate": "Leads with Follow-ups / Active Leads × 100\nActive leads that received at least one follow-up",
  "Follow-up %": "Leads with Follow-ups / Active Leads × 100\nActive leads that received at least one follow-up",
  "siteVisitRate": "Leads with Visits / Total Leads × 100\nLeads that had at least one site visit scheduled",
  "Visit %": "Leads with Visits / Total Leads × 100\nLeads that had at least one site visit scheduled",
  "lostRate": "Lost Leads / Total Leads × 100\nLower is better",
  "Lost %": "Lost Leads / Total Leads × 100\nLower is better",
  "firstActionSpeed": "Avg hours from assignment to first contact\nLower is better — shows response speed",
  "1st Action": "Avg hours from assignment to first contact\nLower is better — shows response speed",
  "1st Action Speed": "Avg hours from assignment to first contact\nLower is better — shows response speed",
  "Contact Rate": "Contacted Leads / Total Leads × 100\nLeads where first contact was made",
  "Follow-up Rate": "Leads with Follow-ups / Active Leads × 100\nActive leads that received at least one follow-up",
  "Site Visit Rate": "Leads with Visits / Total Leads × 100\nLeads that had at least one site visit scheduled",
  "Visit Completion": "Completed Visits / Scheduled Visits × 100\nHow many scheduled visits were actually completed",
  "visitCompletionRate": "Completed Visits / Scheduled Visits × 100\nHow many scheduled visits were actually completed",
  "Booking Rate": "Active Bookings / Total Leads × 100\nConversion from lead to booking",
  "bookingRate": "Active Bookings / Total Leads × 100\nConversion from lead to booking",
  "Lost Rate": "Lost Leads / Total Leads × 100\nLower is better",
  "Stagnation Rate": "Stagnant Leads / Active Leads × 100\nLeads with no activity for 7+ days. Lower is better",
  "stagnationRate": "Stagnant Leads / Active Leads × 100\nLeads with no activity for 7+ days. Lower is better",
  "Data Quality": "Leads with Budget+Property Type filled / Total Leads × 100\nCompleteness of lead data entry",
  "dataQualityRate": "Leads with Budget+Property Type filled / Total Leads × 100\nCompleteness of lead data entry",
  "Reminder Completion": "Completed Reminders / Total Reminders × 100\nHow many reminders were acted on",
  "reminderCompletionRate": "Completed Reminders / Total Reminders × 100\nHow many reminders were acted on",
  "Stagnant": "Leads with no activity for 7+ days\nNeeds immediate attention",
  "stagnantLeads": "Leads with no activity for 7+ days\nNeeds immediate attention",
  "Bookings": "Active bookings (non-cancelled)\nTotal successful conversions",
  "activeBookings": "Active bookings (non-cancelled)\nTotal successful conversions",
  "Leads": "Total leads assigned to this employee\nWithin the selected time period",
  "totalLeads": "Total leads assigned to this employee\nWithin the selected time period",
};

function daysSince(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Unknown";
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  return `${diff} days ago`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EmployeePerformancePanel({
  theme,
  isDark,
}: {
  theme: any;
  isDark: boolean;
}) {
  const [data, setData] = useState<PerfData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<string>("30d");
  const [activeTab, setActiveTab] = useState<"overview" | "detail" | "alerts">("overview");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [sortField, setSortField] = useState<string>("activeBookings");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [lastUpdated, setLastUpdated] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitoring/employee-performance?period=${period}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setLastUpdated(
          new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        );
      }
    } catch (e) {
      console.error("employee-performance fetch error", e);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchData();
    }, 60000);
    const onVis = () => { if (!document.hidden) fetchData(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchData]);

  // Clear stale selectedEmployee when data changes
  useEffect(() => {
    if (data && selectedEmployee) {
      const found = data.employees.find(e => e.id === selectedEmployee.id);
      if (found) setSelectedEmployee(found);
      else { setSelectedEmployee(null); setActiveTab("overview"); }
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / Error ──

  if (isLoading)
    return (
      <div className={`h-full flex items-center justify-center ${theme.textMuted}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
          <p className="text-sm">Loading performance data...</p>
        </div>
      </div>
    );

  if (!data)
    return (
      <div className={`h-full flex items-center justify-center ${theme.textMuted}`}>
        <p>Failed to load performance data.</p>
      </div>
    );

  const { employees, stagnantLeads } = data;

  // ── Sorting ──

  const sorted = [...employees].sort((a: any, b: any) => {
    const av = a[sortField] ?? -1;
    const bv = b[sortField] ?? -1;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // ── Aggregates ──

  const totalLeadsAll = employees.reduce((s, e) => s + e.totalLeads, 0);
  const totalBookingsAll = employees.reduce((s, e) => s + e.activeBookings, 0);
  const totalStagnant = employees.reduce((s, e) => s + e.stagnantLeads, 0);
  const totalOverdueReminders = employees.reduce((s, e) => s + e.overdueReminders, 0);
  const noActivityEmployees = employees.filter(e => e.totalLeads > 0 && e.totalFollowups === 0 && e.visitsScheduled === 0);

  // ── Alert counts ──
  const alertCount = stagnantLeads.length + noActivityEmployees.length + totalOverdueReminders;

  // ── Tabs ──
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "detail", label: selectedEmployee ? `${selectedEmployee.name}` : "Employee Detail" },
    { key: "alerts", label: `Alerts${alertCount > 0 ? ` (${alertCount})` : ""}` },
  ];

  // ── Period selector ──
  const periods = [
    { value: "7d", label: "7 Days" },
    { value: "30d", label: "30 Days" },
    { value: "90d", label: "90 Days" },
    { value: "all", label: "All Time" },
  ];

  const getRoleBadge = (role: string) => {
    if (role === "Sales Manager")
      return isDark
        ? "text-[#d946a8] border-[#9E217B]/30 bg-[#9E217B]/10"
        : "text-[#9E217B] border-[#9E217B]/20 bg-[#9E217B]/5";
    if (role === "Site Head")
      return isDark
        ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
        : "text-blue-700 border-blue-200 bg-blue-50";
    return isDark
      ? "text-purple-400 border-purple-500/30 bg-purple-500/10"
      : "text-purple-700 border-purple-200 bg-purple-50";
  };

  const SortHeader = ({ field, label, className = "" }: { field: string; label: string; className?: string }) => {
    const tooltip = kpiTooltips[label] || kpiTooltips[field] || "";
    return (
      <th
        className={`px-3 py-3 text-xs font-bold uppercase cursor-pointer select-none hover:opacity-80 ${theme.tableBorder} ${className}`}
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label} {sortField === field ? (sortDir === "desc" ? "↓" : "↑") : ""}
          {tooltip && <InfoTip text={tooltip} isDark={isDark} />}
        </span>
      </th>
    );
  };

  // ── Render ──

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className={`p-4 border-b flex-shrink-0 ${theme.header}`} style={theme.headerGlass}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className={`text-lg font-bold flex items-center gap-2 ${theme.text}`}>
              Employee Performance
            </h2>
            <p className={`text-xs mt-0.5 ${theme.textFaint}`}>
              Period: {periods.find(p => p.value === period)?.label} · Updated: {lastUpdated}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Period selector */}
            <div className={`flex rounded-lg border overflow-hidden ${isDark ? "border-[#333]" : "border-gray-200"}`}>
              {periods.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    period === p.value
                      ? "bg-[#9E217B] text-white"
                      : `${theme.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-gray-50"}`
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setIsLoading(true); fetchData(); }}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                isDark
                  ? "bg-[#222] border-[#333] text-white hover:bg-[#333]"
                  : "bg-white border-indigo-200 text-[#9E217B] hover:bg-[#F8FAFC]"
              }`}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === tab.key
                  ? "bg-[#9E217B] text-white shadow-md"
                  : `${theme.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-[#F1F5F9]"}`
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-2 ${theme.scroll}`}>

        {/* ════ OVERVIEW ════ */}
        {activeTab === "overview" && (
          <div className="space-y-4 animate-fadeIn">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Total Employees", value: employees.length, color: isDark ? "text-[#d946a8]" : "text-[#9E217B]", glow: theme.statGlow1 },
                { label: "Total Leads", value: totalLeadsAll, color: isDark ? "text-blue-400" : "text-blue-600", glow: theme.statGlow3 },
                { label: "Active Bookings", value: totalBookingsAll, color: isDark ? "text-green-400" : "text-emerald-600", glow: theme.statGlow5 },
                { label: "Stagnant Leads", value: totalStagnant, color: totalStagnant > 0 ? "text-red-500" : "text-green-500", glow: theme.statGlow4 },
              ].map((card, i) => (
                <div key={i} className={`rounded-xl p-5 border relative overflow-hidden ${theme.card}`} style={theme.cardGlass}>
                  <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full blur-2xl pointer-events-none ${card.glow}`} />
                  <p className={`crm-eyebrow mb-2 ${theme.textFaint}`}>{card.label}</p>
                  <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Funnel visualization */}
            <div className={`rounded-xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
              <div className={`p-4 border-b ${theme.tableBorder} ${theme.modalHeader}`}>
                <h3 className={`font-bold text-sm ${theme.text}`}>Lead Funnel (All Employees)</h3>
              </div>
              <div className="p-4">
                <FunnelBar
                  stages={[
                    { label: "Assigned", value: totalLeadsAll, color: "bg-blue-500" },
                    { label: "Contacted", value: employees.reduce((s, e) => s + e.contactedLeads, 0), color: "bg-indigo-500" },
                    { label: "With Follow-ups", value: employees.reduce((s, e) => s + e.leadsWithFollowups, 0), color: "bg-purple-500" },
                    { label: "Visit Done", value: employees.reduce((s, e) => s + e.leadsVisitCompleted, 0), color: "bg-orange-500" },
                    { label: "Booking", value: totalBookingsAll, color: "bg-green-500" },
                    { label: "Lost", value: employees.reduce((s, e) => s + e.lostLeads, 0), color: "bg-red-500" },
                  ]}
                  isDark={isDark}
                  theme={theme}
                />
              </div>
            </div>

            {/* Employee ranking table */}
            <div className={`rounded-xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
              <div className={`p-4 border-b flex items-center justify-between ${theme.tableBorder} ${theme.modalHeader}`}>
                <h3 className={`font-bold text-sm ${theme.text}`}>Employee Ranking</h3>
                <span className={`text-xs ${theme.textFaint}`}>{employees.length} employees</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className={`${theme.tableHead} ${theme.textHeader}`}>
                    <tr>
                      <th className={`px-3 py-3 text-xs font-bold uppercase ${theme.tableBorder}`}>#</th>
                      <th className={`px-3 py-3 text-xs font-bold uppercase ${theme.tableBorder}`}>Employee</th>
                      <th className={`px-3 py-3 text-xs font-bold uppercase ${theme.tableBorder}`}>Role</th>
                      <SortHeader field="totalLeads" label="Leads" />
                      <SortHeader field="firstActionSpeed" label="1st Action" />
                      <SortHeader field="contactRate" label="Contact %" />
                      <SortHeader field="followupRate" label="Follow-up %" />
                      <SortHeader field="siteVisitRate" label="Visit %" />
                      <SortHeader field="activeBookings" label="Bookings" />
                      <SortHeader field="lostRate" label="Lost %" />
                      <SortHeader field="stagnantLeads" label="Stagnant" />
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${theme.tableDivide}`}>
                    {sorted.length === 0 ? (
                      <tr>
                        <td colSpan={11} className={`text-center py-8 ${theme.textMuted}`}>
                          No employee data for this period.
                        </td>
                      </tr>
                    ) : (
                      sorted.map((emp, i) => {
                        const sp = speedLabel(emp.firstActionSpeed);
                        return (
                          <tr
                            key={emp.id}
                            className={`transition-colors cursor-pointer ${theme.tableRow} ${
                              isDark ? "hover:bg-white/5" : "hover:bg-gray-50"
                            }`}
                            onClick={() => { setSelectedEmployee(emp); setActiveTab("detail"); }}
                          >
                            <td className={`px-3 py-3 text-xs font-bold ${theme.textFaint}`}>{i + 1}</td>
                            <td className={`px-3 py-3 font-bold ${theme.text}`}>{emp.name}</td>
                            <td className="px-3 py-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadge(emp.role)}`}>
                                {emp.role}
                              </span>
                            </td>
                            <td className={`px-3 py-3 font-bold ${theme.text}`}>{emp.totalLeads}</td>
                            <td className={`px-3 py-3 font-bold ${sp.color}`}>{sp.text}</td>
                            <td className={`px-3 py-3 font-bold ${rateColor(emp.contactRate)}`}>{fmtRate(emp.contactRate)}</td>
                            <td className={`px-3 py-3 font-bold ${rateColor(emp.followupRate)}`}>{fmtRate(emp.followupRate)}</td>
                            <td className={`px-3 py-3 font-bold ${rateColor(emp.siteVisitRate)}`}>{fmtRate(emp.siteVisitRate)}</td>
                            <td className={`px-3 py-3 font-bold ${emp.activeBookings > 0 ? "text-green-500" : theme.textFaint}`}>
                              {emp.activeBookings}
                            </td>
                            <td className={`px-3 py-3 font-bold ${rateColor(emp.lostRate, true)}`}>{fmtRate(emp.lostRate)}</td>
                            <td className={`px-3 py-3 font-bold ${emp.stagnantLeads > 0 ? "text-red-500" : "text-green-500"}`}>
                              {emp.stagnantLeads}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════ EMPLOYEE DETAIL ════ */}
        {activeTab === "detail" && (
          <div className="space-y-4 animate-fadeIn">
            {!selectedEmployee ? (
              <div className={`text-center py-12 ${theme.textMuted}`}>
                <p className="text-sm">Click on any employee in the Overview tab to see their detail.</p>
              </div>
            ) : (
              <EmployeeDetail
                emp={selectedEmployee}
                stagnantLeads={stagnantLeads.filter(l => (l.assigned_to || "").toLowerCase() === (selectedEmployee.name || "").toLowerCase())}
                theme={theme}
                isDark={isDark}
                getRoleBadge={getRoleBadge}
                onBack={() => { setSelectedEmployee(null); setActiveTab("overview"); }}
              />
            )}
          </div>
        )}

        {/* ════ ALERTS ════ */}
        {activeTab === "alerts" && (
          <div className="space-y-4 animate-fadeIn">
            {/* Stagnant leads */}
            <AlertBlock
              title="Stagnant Leads (No activity 7+ days)"
              count={stagnantLeads.length}
              color="red"
              isDark={isDark}
              theme={theme}
              emptyMsg="No stagnant leads found."
            >
              {stagnantLeads.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className={`${theme.tableHead} ${theme.textHeader}`}>
                      <tr>
                        {["#", "Lead", "Assigned To", "Status", "Last Activity", "Budget", "Config"].map(h => (
                          <th key={h} className={`px-3 py-2 text-xs font-bold uppercase ${theme.tableBorder}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${theme.tableDivide}`}>
                      {stagnantLeads.slice(0, 50).map(lead => (
                        <tr key={lead.id} className={`${theme.tableRow}`}>
                          <td className={`px-3 py-2 text-xs ${theme.textFaint}`}>{lead.sr_no}</td>
                          <td className={`px-3 py-2 font-bold ${theme.text}`}>{lead.name || "—"}</td>
                          <td className={`px-3 py-2 ${theme.text}`}>{lead.assigned_to}</td>
                          <td className={`px-3 py-2 ${theme.textMuted}`}>{lead.status}</td>
                          <td className={`px-3 py-2 font-bold text-red-500`}>{daysSince(lead.last_activity_at)}</td>
                          <td className={`px-3 py-2 ${theme.textMuted}`}>{lead.budget || "—"}</td>
                          <td className={`px-3 py-2 ${theme.textMuted}`}>{lead.configuration || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {stagnantLeads.length > 50 && (
                    <p className={`text-xs text-center py-2 ${theme.textFaint}`}>
                      Showing 50 of {stagnantLeads.length} stagnant leads
                    </p>
                  )}
                </div>
              )}
            </AlertBlock>

            {/* Employees with no activity */}
            <AlertBlock
              title="No Activity This Period"
              count={noActivityEmployees.length}
              color="yellow"
              isDark={isDark}
              theme={theme}
              emptyMsg="All employees have activity this period."
            >
              {noActivityEmployees.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-3">
                  {noActivityEmployees.map(emp => (
                    <div
                      key={emp.id}
                      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                        isDark ? "border-yellow-500/20 bg-yellow-500/5 hover:bg-yellow-500/10" : "border-yellow-200 bg-yellow-50 hover:bg-yellow-100"
                      }`}
                      onClick={() => { setSelectedEmployee(emp); setActiveTab("detail"); }}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-bold text-sm ${theme.text}`}>{emp.name}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadge(emp.role)}`}>
                          {emp.role}
                        </span>
                      </div>
                      <p className={`text-xs mt-1 ${theme.textFaint}`}>
                        {emp.totalLeads} leads assigned · 0 follow-ups · 0 visits
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </AlertBlock>

            {/* Overdue reminders */}
            <AlertBlock
              title="Overdue Reminders"
              count={totalOverdueReminders}
              color="orange"
              isDark={isDark}
              theme={theme}
              emptyMsg="No overdue reminders."
            >
              {totalOverdueReminders > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-3">
                  {employees.filter(e => e.overdueReminders > 0).map(emp => (
                    <div
                      key={emp.id}
                      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                        isDark ? "border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10" : "border-orange-200 bg-orange-50 hover:bg-orange-100"
                      }`}
                      onClick={() => { setSelectedEmployee(emp); setActiveTab("detail"); }}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-bold text-sm ${theme.text}`}>{emp.name}</span>
                        <span className="text-xs font-bold text-orange-500">{emp.overdueReminders} overdue</span>
                      </div>
                      <p className={`text-xs mt-1 ${theme.textFaint}`}>
                        {emp.completedReminders}/{emp.totalReminders} completed
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </AlertBlock>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FunnelBar({
  stages,
  isDark,
  theme,
}: {
  stages: { label: string; value: number; color: string }[];
  isDark: boolean;
  theme: any;
}) {
  const max = Math.max(1, ...stages.map(s => s.value));
  return (
    <div className="space-y-2">
      {stages.map((stage, i) => {
        const pct = Math.max(2, (stage.value / max) * 100);
        return (
          <div key={i} className="flex items-center gap-3">
            <span className={`text-xs font-bold w-28 text-right shrink-0 ${theme.textMuted}`}>{stage.label}</span>
            <div className={`flex-1 h-7 rounded-lg overflow-hidden ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
              <div
                className={`h-full rounded-lg ${stage.color} transition-all duration-500 flex items-center px-2`}
                style={{ width: `${pct}%` }}
              >
                <span className="text-xs font-bold text-white drop-shadow">{stage.value}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmployeeDetail({
  emp,
  stagnantLeads,
  theme,
  isDark,
  getRoleBadge,
  onBack,
}: {
  emp: Employee;
  stagnantLeads: StagnantLead[];
  theme: any;
  isDark: boolean;
  getRoleBadge: (role: string) => string;
  onBack: () => void;
}) {
  const sp = speedLabel(emp.firstActionSpeed);

  const metricCards = [
    { label: "Total Leads", value: emp.totalLeads, color: isDark ? "text-blue-400" : "text-blue-600" },
    { label: "Active Leads", value: emp.activeLeads, color: isDark ? "text-indigo-400" : "text-indigo-600" },
    { label: "Closing/Closed", value: emp.closingLeads, color: "text-green-500" },
    { label: "Lost Leads", value: emp.lostLeads, color: emp.lostLeads > 0 ? "text-red-500" : "text-green-500" },
    { label: "Active Bookings", value: emp.activeBookings, color: "text-green-500" },
    { label: "Agreement Value", value: fmtMoney(emp.totalAgreementValue), color: isDark ? "text-emerald-400" : "text-emerald-600" },
  ];

  const rateCards = [
    { label: "1st Action Speed", value: sp.text, color: sp.color },
    { label: "Contact Rate", value: fmtRate(emp.contactRate), color: rateColor(emp.contactRate) },
    { label: "Follow-up Rate", value: fmtRate(emp.followupRate), color: rateColor(emp.followupRate) },
    { label: "Site Visit Rate", value: fmtRate(emp.siteVisitRate), color: rateColor(emp.siteVisitRate) },
    { label: "Visit Completion", value: fmtRate(emp.visitCompletionRate), color: rateColor(emp.visitCompletionRate) },
    { label: "Booking Rate", value: fmtRate(emp.bookingRate), color: rateColor(emp.bookingRate) },
    { label: "Lost Rate", value: fmtRate(emp.lostRate), color: rateColor(emp.lostRate, true) },
    { label: "Stagnation Rate", value: fmtRate(emp.stagnationRate), color: rateColor(emp.stagnationRate, true) },
    { label: "Data Quality", value: fmtRate(emp.dataQualityRate), color: rateColor(emp.dataQualityRate) },
    { label: "Reminder Completion", value: fmtRate(emp.reminderCompletionRate), color: rateColor(emp.reminderCompletionRate) },
  ];

  return (
    <>
      {/* Back + header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
            isDark ? "bg-[#222] border-[#333] text-white hover:bg-[#333]" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
          }`}
        >
          ← Back
        </button>
        <h3 className={`text-lg font-bold ${theme.text}`}>{emp.name}</h3>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadge(emp.role)}`}>
          {emp.role}
        </span>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {metricCards.map((c, i) => (
          <div key={i} className={`rounded-xl p-4 border ${theme.card}`} style={theme.cardGlass}>
            <p className={`crm-eyebrow mb-1 ${theme.textFaint}`}>{c.label}</p>
            <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Funnel */}
      <div className={`rounded-xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
        <div className={`p-4 border-b ${theme.tableBorder} ${theme.modalHeader}`}>
          <h3 className={`font-bold text-sm ${theme.text}`}>Lead Funnel</h3>
        </div>
        <div className="p-4">
          <FunnelBar
            stages={[
              { label: "Assigned", value: emp.totalLeads, color: "bg-blue-500" },
              { label: "Contacted", value: emp.contactedLeads, color: "bg-indigo-500" },
              { label: "Follow-ups", value: emp.leadsWithFollowups, color: "bg-purple-500" },
              { label: "Visit Done", value: emp.leadsVisitCompleted, color: "bg-orange-500" },
              { label: "Booking", value: emp.activeBookings, color: "bg-green-500" },
              { label: "Lost", value: emp.lostLeads, color: "bg-red-500" },
            ]}
            isDark={isDark}
            theme={theme}
          />
        </div>
      </div>

      {/* Rates grid */}
      <div className={`rounded-xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
        <div className={`p-4 border-b ${theme.tableBorder} ${theme.modalHeader}`}>
          <h3 className={`font-bold text-sm ${theme.text}`}>Performance Rates</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px p-3">
          {rateCards.map((c, i) => {
            const tooltip = kpiTooltips[c.label] || "";
            return (
              <div key={i} className={`p-3 rounded-lg ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
                <p className={`text-[10px] font-bold uppercase mb-1 ${theme.textFaint} inline-flex items-center gap-1`}>
                  {c.label}
                  {tooltip && <InfoTip text={tooltip} isDark={isDark} />}
                </p>
                <p className={`text-lg font-black ${c.color}`}>{c.value}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Activity breakdown */}
      <div className={`rounded-xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
        <div className={`p-4 border-b ${theme.tableBorder} ${theme.modalHeader}`}>
          <h3 className={`font-bold text-sm ${theme.text}`}>Activity Breakdown</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div>
            <p className={`crm-eyebrow mb-1 ${theme.textFaint}`}>Follow-ups</p>
            <p className={`text-lg font-bold ${theme.text}`}>{emp.totalFollowups}</p>
            <p className={`text-xs ${theme.textFaint}`}>{emp.leadsWithFollowups} leads covered</p>
          </div>
          <div>
            <p className={`crm-eyebrow mb-1 ${theme.textFaint}`}>Site Visits</p>
            <p className={`text-lg font-bold ${theme.text}`}>{emp.visitsScheduled} scheduled</p>
            <p className={`text-xs ${theme.textFaint}`}>{emp.visitsCompleted} completed</p>
          </div>
          <div>
            <p className={`crm-eyebrow mb-1 ${theme.textFaint}`}>Reminders</p>
            <p className={`text-lg font-bold ${theme.text}`}>{emp.totalReminders} total</p>
            <p className={`text-xs ${emp.overdueReminders > 0 ? "text-red-500 font-bold" : theme.textFaint}`}>
              {emp.overdueReminders > 0 ? `${emp.overdueReminders} overdue` : "None overdue"}
            </p>
          </div>
          <div>
            <p className={`crm-eyebrow mb-1 ${theme.textFaint}`}>Active Last 7d</p>
            <p className={`text-lg font-bold ${emp.activeInLast7d > 0 ? "text-green-500" : "text-red-500"}`}>
              {emp.activeInLast7d} leads
            </p>
            <p className={`text-xs ${theme.textFaint}`}>{emp.stagnantLeads} stagnant</p>
          </div>
        </div>
      </div>

      {/* Stagnant leads for this employee */}
      {stagnantLeads.length > 0 && (
        <div className={`rounded-xl border overflow-hidden ${theme.tableWrap}`} style={theme.tableGlass}>
          <div className={`p-4 border-b ${theme.tableBorder} ${isDark ? "bg-red-500/10" : "bg-red-50"}`}>
            <h3 className={`font-bold text-sm text-red-500`}>
              Stagnant Leads ({stagnantLeads.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className={`${theme.tableHead} ${theme.textHeader}`}>
                <tr>
                  {["#", "Lead", "Status", "Last Activity", "Budget"].map(h => (
                    <th key={h} className={`px-3 py-2 text-xs font-bold uppercase ${theme.tableBorder}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className={`divide-y ${theme.tableDivide}`}>
                {stagnantLeads.map(lead => (
                  <tr key={lead.id} className={`${theme.tableRow}`}>
                    <td className={`px-3 py-2 text-xs ${theme.textFaint}`}>{lead.sr_no}</td>
                    <td className={`px-3 py-2 font-bold ${theme.text}`}>{lead.name || "—"}</td>
                    <td className={`px-3 py-2 ${theme.textMuted}`}>{lead.status}</td>
                    <td className={`px-3 py-2 font-bold text-red-500`}>{daysSince(lead.last_activity_at)}</td>
                    <td className={`px-3 py-2 ${theme.textMuted}`}>{lead.budget || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function InfoTip({ text, isDark }: { text: string; isDark: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold cursor-help shrink-0 ${
          isDark
            ? "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white/80"
            : "bg-gray-200 text-gray-500 hover:bg-gray-300 hover:text-gray-700"
        }`}
      >
        ?
      </span>
      {show && (
        <span
          className={`absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg text-[11px] font-medium leading-snug whitespace-pre-line shadow-xl pointer-events-none min-w-[200px] max-w-[280px] ${
            isDark
              ? "bg-[#1a1a2e] text-white/90 border border-white/10"
              : "bg-white text-gray-700 border border-gray-200"
          }`}
        >
          {text}
          <span
            className={`absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] ${
              isDark ? "border-t-[#1a1a2e]" : "border-t-white"
            }`}
          />
        </span>
      )}
    </span>
  );
}

function AlertBlock({
  title,
  count,
  color,
  isDark,
  theme,
  emptyMsg,
  children,
}: {
  title: string;
  count: number;
  color: "red" | "yellow" | "orange";
  isDark: boolean;
  theme: any;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  const colors = {
    red: {
      border: isDark ? "border-red-500/20" : "border-red-200",
      header: isDark ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200",
      title: "text-red-500",
      badge: isDark ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-red-700 border-red-200 bg-red-50",
    },
    yellow: {
      border: isDark ? "border-yellow-500/20" : "border-yellow-200",
      header: isDark ? "bg-yellow-500/10 border-yellow-500/20" : "bg-yellow-50 border-yellow-200",
      title: "text-yellow-500",
      badge: isDark ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" : "text-yellow-700 border-yellow-200 bg-yellow-50",
    },
    orange: {
      border: isDark ? "border-orange-500/20" : "border-orange-200",
      header: isDark ? "bg-orange-500/10 border-orange-500/20" : "bg-orange-50 border-orange-200",
      title: "text-orange-500",
      badge: isDark ? "text-orange-400 bg-orange-500/10 border-orange-500/30" : "text-orange-700 border-orange-200 bg-orange-50",
    },
  }[color];

  return (
    <div className={`rounded-xl border overflow-hidden ${colors.border}`}>
      <div className={`p-4 border-b flex items-center justify-between ${colors.header}`}>
        <h3 className={`font-bold text-sm ${colors.title}`}>{title}</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colors.badge}`}>{count}</span>
      </div>
      {count === 0 ? (
        <div className={`p-6 text-center ${theme.textMuted}`}>
          <p className="text-sm">{emptyMsg}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
