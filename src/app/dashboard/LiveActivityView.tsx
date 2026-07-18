//LiveActivityView.tsx
import React, { useState, useEffect } from "react";
import { FaCircle, FaUsers, FaWalking, FaExclamationTriangle, FaTimes, FaChartLine, FaShieldAlt, FaBriefcase, FaChartPie, FaInfoCircle, FaHistory, FaClock, FaCog, FaFileExcel, FaSave } from "react-icons/fa";
import * as XLSX from 'xlsx';
import { useShiftTiming } from "@/hooks/useShiftTiming";

export default function LiveActivityView({ theme, isDark }: { theme: any; isDark: boolean }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [inspectorTab, setInspectorTab] = useState<"activity" | "lead" | "analytics" | "risk" | "timeline" | "history">("activity");
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [sessionHistory, setSessionHistory] = useState<any[]>([]);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [smartAlerts, setSmartAlerts] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<"live" | "analytics">("live");
  const [globalAnalytics, setGlobalAnalytics] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [historyCache, setHistoryCache] = useState<Record<string, any[]>>({});
  const [visibleColumns, setVisibleColumns] = useState({
    activeLead: true,
    loginDate: true,
    loginTime: true,
    punctuality: true,
    logoutTime: true,
    liveTimer: true,
    workingHours: true,
    risk: true,
  });
  // NEW STATES
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [showHoursConfig, setShowHoursConfig] = useState(false);

  // Real-time Shift Timing Hook
  const { timing: workingHours, refresh: refreshTiming } = useShiftTiming();
  const [localTiming, setLocalTiming] = useState(workingHours);
  const [isSavingTiming, setIsSavingTiming] = useState(false);

  useEffect(() => {
    setLocalTiming(workingHours);
  }, [workingHours]);

  const updateWorkingHours = (newConfig: any) => {
    setLocalTiming(newConfig);
  };

  const saveWorkingHours = async () => {
    setIsSavingTiming(true);
    try {
      const res = await fetch('/api/settings/working-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localTiming)
      });
      let data;
      try { data = await res.json(); } catch (e) { alert("⛔ Server Error"); return; }

      if (res.ok) {
        refreshTiming();
        setShowHoursConfig(false);
      } else {
        alert("Error: " + (data.message || "Failed to save shift timing"));
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save shift timing");
    } finally {
      setIsSavingTiming(false);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getLiveTimer = (start: string, end: string, isActive: boolean) => {
    if (!start) return "Frozen";
    const startTime = new Date(start).getTime();
    const endTime = isActive ? now : (end ? new Date(end).getTime() : startTime);
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  };

  const getWorkingHours = (start: string, end: string, isActive: boolean) => {
    if (!start) return "-";
    const startTime = new Date(start).getTime();
    const endTime = isActive ? now : (end ? new Date(end).getTime() : startTime);
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  };

  const formatPunctualityDiff = (diffMinutes: number): string => {
    const abs = Math.abs(diffMinutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };


  const getPunctualityBadge = (sessionStart: string) => {
    if (workingHours.flexible) return null;

    const loginDate = new Date(sessionStart);
    const [configH, configM] = workingHours.loginTime.split(':').map(Number);

    // Build the "expected login" for that same calendar day
    const expected = new Date(loginDate);
    expected.setHours(configH, configM, 0, 0);

    const diffMs = loginDate.getTime() - expected.getTime();
    const diffMinutes = Math.round(diffMs / 60000);

    if (diffMinutes > 2) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 text-red-500 border border-red-500/20 whitespace-nowrap">
          Late {formatPunctualityDiff(diffMinutes)}
        </span>
      );
    } else if (diffMinutes < -2) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-green-500/10 text-green-500 border border-green-500/20 whitespace-nowrap">
          ✅ Early {formatPunctualityDiff(diffMinutes)}
        </span>
      );
    } else {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-500/10 text-blue-500 border border-blue-500/20 whitespace-nowrap">
          🎯 On Time
        </span>
      );
    }
  };

  const handleRowClick = (e: React.MouseEvent, s: any) => {
    e.stopPropagation();
    setSelectedUser(s);
  };

  const toggleAccordion = async (e: React.MouseEvent, s: any) => {
    e.stopPropagation();
    const isExpanded = !!expandedRows[s.user_id];
    setExpandedRows(prev => ({ ...prev, [s.user_id]: !isExpanded }));

    const cacheKey = `${s.user_id}_${selectedDate}`;
    if (!isExpanded && !historyCache[cacheKey]) {
      try {
        const res = await fetch(`/api/attendance/session-history?userId=${s.user_id}&date=${selectedDate}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setHistoryCache(prev => ({ ...prev, [cacheKey]: data.sessions }));
        }
      } catch (err) {
        console.error(err);
      }
    }
  };



  // Fetch Advanced Global Analytics
  useEffect(() => {
    if (viewMode === "analytics") {
      fetch("/api/attendance/advanced-analytics")
        .then(res => { if (!res.ok) throw new Error("Error"); return res.json(); })
        .then(data => {
          if (data.success) setGlobalAnalytics(data.data);
        })
        .catch(console.error);
    }
  }, [viewMode]);

  useEffect(() => {
    if (selectedUser) {
      fetch(`/api/attendance/analytics?userId=${selectedUser.user_id}`)
        .then(res => { if (!res.ok) throw new Error("Error"); return res.json(); })
        .then(data => setAnalyticsData(data))
        .catch(console.error);

      fetch(`/api/attendance/session-history?userId=${selectedUser.user_id}`)
        .then(res => { if (!res.ok) throw new Error("Error"); return res.json(); })
        .then(data => {
          if (data.success) setSessionHistory(data.sessions);
        })
        .catch(console.error);
    } else {
      setAnalyticsData(null);
      setSessionHistory([]);
    }
  }, [selectedUser?.user_id]);

  useEffect(() => {
    fetchSessions();
  }, [selectedDate]);

  useEffect(() => {
    // 2. Connect to Realtime Event Bus
    const evtSource = new EventSource("/api/sse/live-activity");

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle SESSION updates (heartbeat transitions)
        if (data.type === "SESSION_UPDATE" || data.type === "ACTIVITY") {
          setSessions(prev => {
            const exists = prev.find(s => s.user_id === data.userId);
            if (exists) {
              return prev.map(s => s.user_id === data.userId ? { ...s, ...data } : s);
            }
            // If new session, we might need a full fetch, or just append it if we have enough data
            return prev;
          });

          if (selectedUser?.user_id === data.userId) {
            setSelectedUser((prev: any) => prev && prev.user_id === data.userId ? ({ ...prev, ...data }) : prev);
          }
        }

        // Handle global floating events timeline
        if (data.type === "ACTIVITY") {
          setLiveEvents(prev => {
            const newFeed = [{
              id: Date.now() + Math.random(),
              message: `${data.userName} ${data.action} ${data.leadName ? `(${data.leadName})` : ''}`,
              time: new Date(data.timestamp).toLocaleTimeString()
            }, ...prev];
            return newFeed.slice(0, 5); // Keep last 5
          });
        }

        if (data.type === "FORCE_LOGOUT") {
          fetchSessions(); // refresh list to drop the user
        }

        // Handle Smart Alerts for Risk Engine
        if (data.type === "SMART_ALERT") {
          setSmartAlerts(prev => {
            const newAlerts = [{
              id: Date.now() + Math.random(),
              message: data.message,
              type: data.alertType,
              time: new Date(data.timestamp).toLocaleTimeString()
            }, ...prev];
            return newAlerts.slice(0, 10); // keep last 10 alerts
          });
        }
      } catch (e) { }
    };

    return () => evtSource.close();
  }, [selectedUser?.user_id]);

  const fetchSessions = async () => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedDate > today) {
      setSessions([]);
      setIsLoading(false);
      return; // bail early, no API call
    }
    try {
      const res = await fetch(`/api/attendance/live?date=${selectedDate}`, { cache: 'no-store' });
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
      // Auto-update selected user if open
      if (selectedUser) {
        const updatedUser = (data.sessions || []).find((s: any) => s.user_id === selectedUser.user_id);
        if (updatedUser) setSelectedUser(updatedUser);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const activeCount = sessions.filter(s => s.status === 'ACTIVE').length;
  const idleCount = sessions.filter(s => s.status === 'IDLE').length;

  const formatDuration = (seconds: number) => {
    if (!seconds) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const handleForceLogout = async (userId: number) => {
    if (!confirm("Are you sure you want to force logout this user?")) return;
    try {
      await fetch("/api/attendance/force-logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId })
      });
      fetchSessions();
      setSelectedUser(null);
    } catch (e) { console.error(e); }
  };

  const exportToExcel = () => {
    if (sessions.length === 0) return;

    const rows = sessions.map(s => {
      const loginTime = new Date(s.session_start);
      const [configH, configM] = workingHours.loginTime.split(':').map(Number);
      const expected = new Date(loginTime);
      expected.setHours(configH, configM, 0, 0);
      const diffMin = Math.round((loginTime.getTime() - expected.getTime()) / 60000);

      let punctuality = 'On Time';
      if (!workingHours.flexible) {
        if (diffMin > 2) {
          const h = Math.floor(Math.abs(diffMin) / 60);
          const m = Math.abs(diffMin) % 60;
          punctuality = `Late ${h > 0 ? h + 'h ' : ''}${m}m`;
        } else if (diffMin < -2) {
          const h = Math.floor(Math.abs(diffMin) / 60);
          const m = Math.abs(diffMin) % 60;
          punctuality = `Early ${h > 0 ? h + 'h ' : ''}${m}m`;
        }
      } else {
        punctuality = 'Flexible';
      }

      return {
        'Employee': s.name,
        'Status': s.status,
        'Login Date': new Date(s.session_start).toLocaleDateString('en-IN'),
        'Login Time': new Date(s.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        'Logout Time': s.session_is_active ? 'User Active' : (s.session_end ? new Date(s.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A'),
        'Working Hours': getWorkingHours(s.session_start, s.session_end, s.session_is_active),
        'Active Lead': s.active_lead_id ? `${s.active_lead_name || 'Lead'} (${s.active_lead_id})` : '-',
        'Punctuality': punctuality,
        'Productivity Score': s.productivity_score || 0,
        'Long Idle Risk': s.idle_duration_seconds > 1800 ? 'Yes' : 'No',
        'IP Address': s.ip_address || '-',
        'Device': s.device_info || '-',
        'Attendance': s.attendance_status || 'Absent',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 25 },
      { wch: 25 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
      { wch: 16 }, { wch: 22 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Report');

    const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN').replace(/\//g, '-');
    XLSX.writeFile(workbook, `Attendance_${dateLabel}.xlsx`);
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const isFutureDate = selectedDate > todayStr;

  return (
    <div className={`p-4 w-full h-full flex flex-col ${theme.mainBg} relative`}>

      {/* SMART ALERTS PANEL (Floating Top Center) */}
      {smartAlerts.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-[400px]">
          {smartAlerts.map(alert => (
            <div key={alert.id} className="bg-red-600/90 backdrop-blur-md text-white p-3 rounded-lg shadow-[0_0_15px_rgba(220,38,38,0.5)] border border-red-400 animate-fade-in-down">
              <div className="flex justify-between items-center mb-1">
                <span className="font-black text-[10px] uppercase">{alert.type.replace(/_/g, ' ')}</span>
                <span className="text-[10px] opacity-70">{alert.time}</span>
              </div>
              <p className="text-xs font-medium">{alert.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* FLOATING REALTIME EVENT FEED (Top Right) */}
      <div className="fixed top-20 right-6 z-50 w-72 space-y-2 pointer-events-none">
        {liveEvents.map((evt) => (
          <div key={evt.id} className="bg-[#9E217B]/90 backdrop-blur-md text-white p-3 rounded-lg shadow-xl shadow-[#9E217B]/20 border border-white/10 animate-fade-in-down pointer-events-auto">
            <span className="text-[10px] text-white/70 font-bold">{evt.time}</span>
            <span className="text-xs font-medium leading-snug block">{evt.message}</span>
          </div>
        ))}
      </div>

      {/* TOP HEADER & TOGGLES */}
      <div className="flex justify-between items-center mb-4">
        <h2 className={`text-xl font-black ${theme.text}`}>Operations Command Center</h2>
        <div className={`flex bg-black/5 dark:bg-white/5 p-1 rounded-lg border ${theme.tableBorder}`}>
          <button
            onClick={() => setViewMode("live")}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === "live" ? "bg-[#9E217B] text-white shadow-md" : `${theme.textMuted} hover:text-[#9E217B]`}`}
          >
            Live Telemetry
          </button>
          <button
            onClick={() => setViewMode("analytics")}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === "analytics" ? "bg-[#9E217B] text-white shadow-md" : `${theme.textMuted} hover:text-[#9E217B]`}`}
          >
            Intelligence Hub
          </button>
        </div>
      </div>

      {viewMode === "analytics" && globalAnalytics ? (
        <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-10 custom-scrollbar h-[calc(100vh-140px)]">

          {/* ANALYTICS KPI CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className={`p-4 rounded-xl border ${theme.card}`}>
              <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Avg Active Time Today</p>
              <h3 className={`text-2xl font-black mt-1 ${theme.text}`}>{formatDuration(globalAnalytics.kpis?.avgActiveTimeSeconds || 0)}</h3>
              <p className={`text-xs mt-1 ${theme.textMuted}`}>Excludes idle duration</p>
            </div>
            <div className={`p-4 rounded-xl border ${theme.card}`}>
              <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Most Active Employee</p>
              <h3 className={`text-xl font-black mt-1 text-green-500`}>{globalAnalytics.kpis?.mostActiveEmployee?.name || 'N/A'}</h3>
              <p className={`text-xs mt-1 ${theme.textMuted}`}>{formatDuration(globalAnalytics.kpis?.mostActiveEmployee?.time || 0)} active</p>
            </div>
            <div className={`p-4 rounded-xl border ${theme.card}`}>
              <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Highest Idle Time</p>
              <h3 className={`text-xl font-black mt-1 text-yellow-500`}>{globalAnalytics.kpis?.highestIdleEmployee?.name || 'N/A'}</h3>
              <p className={`text-xs mt-1 ${theme.textMuted}`}>{formatDuration(globalAnalytics.kpis?.highestIdleEmployee?.time || 0)} idle</p>
            </div>
            <div className={`p-4 rounded-xl border ${theme.card}`}>
              <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Total Leads Worked</p>
              <h3 className={`text-2xl font-black mt-1 ${theme.text}`}>{sessions.filter(s => s.active_lead_id).length} Active Now</h3>
              <p className={`text-xs mt-1 ${theme.textMuted}`}>Realtime lead engagement</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* WEEKLY HEATMAP */}
            <div className={`p-4 rounded-xl border ${theme.card}`}>
              <h3 className={`text-sm font-black mb-4 ${theme.text}`}>Company Operational Rhythm (7 Days)</h3>
              <div className="space-y-3">
                {globalAnalytics.weeklyHeatmap?.map((day: any) => (
                  <div key={day.date} className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${theme.text} w-24`}>{day.day}</span>
                    <div className="flex-1 mx-4 bg-black/5 dark:bg-white/5 h-2 rounded-full overflow-hidden flex">
                      <div className="bg-[#9E217B] h-full" style={{ width: `${Math.min(100, (day.count / 200) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-bold w-20 text-right">{day.intensity} ({day.count})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* MODULE USAGE */}
            <div className={`p-4 rounded-xl border ${theme.card}`}>
              <h3 className={`text-sm font-black mb-4 ${theme.text}`}>Global Module Usage</h3>
              <div className="space-y-3">
                {globalAnalytics.moduleUsage?.map((mod: any) => (
                  <div key={mod.module} className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${theme.text} w-32 truncate`}>{mod.module}</span>
                    <div className="flex-1 mx-4 bg-black/5 dark:bg-white/5 h-2 rounded-full overflow-hidden flex">
                      <div className="bg-blue-500 h-full" style={{ width: `${mod.percentage}%` }} />
                    </div>
                    <span className="text-[10px] font-bold w-12 text-right">{mod.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <div className={`px-4 py-3 rounded-xl border flex items-center justify-between ${theme.card}`}>
              <div>
                <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Employees Online</p>
                <h3 className={`text-xl font-black mt-0.5 ${theme.text}`}>{activeCount}</h3>
              </div>
              <FaCircle className="text-green-500 w-4 h-4 animate-pulse" />
            </div>
            <div className={`px-4 py-3 rounded-xl border flex items-center justify-between ${theme.card}`}>
              <div>
                <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Logged In Today</p>
                <h3 className={`text-xl font-black mt-0.5 ${theme.text}`}>{sessions.length}</h3>
              </div>
              <FaUsers className="text-blue-500" />
            </div>
            <div className={`px-4 py-3 rounded-xl border flex items-center justify-between ${theme.card}`}>
              <div>
                <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Idle Employees</p>
                <h3 className={`text-xl font-black mt-0.5 ${theme.text}`}>{idleCount}</h3>
              </div>
              <FaWalking className="text-yellow-500" />
            </div>
            <div className={`px-4 py-3 rounded-xl border flex items-center justify-between ${theme.card}`}>
              <div>
                <p className={`text-[10px] uppercase font-bold ${theme.textMuted}`}>Avg Productivity</p>
                <h3 className={`text-xl font-black mt-0.5 ${theme.text}`}>
                  {sessions.length > 0 ? Math.round(sessions.reduce((acc, s) => acc + (s.productivity_score || 0), 0) / sessions.length) : 0}
                </h3>
              </div>
              <FaChartLine className="text-[#9E217B]" />
            </div>
          </div>

          {/* DATE PICKER & WORKING HOURS ROW */}
          <div className="flex items-center justify-between mb-3 relative z-30">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold focus:outline-none ${theme.card} ${theme.text} ${theme.tableBorder}`}
              />
            </div>

            <div className="flex items-center gap-3 relative">
              <button
                onClick={exportToExcel}
                disabled={sessions.length === 0 || isFutureDate}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors
                  ${sessions.length === 0 || isFutureDate
                    ? 'opacity-40 cursor-not-allowed border-gray-500/20 text-gray-500'
                    : 'border-green-500/30 text-green-500 bg-green-500/5 hover:bg-green-500/15'
                  }`}
              >
                <FaFileExcel className="w-3.5 h-3.5" />
                Export Excel
              </button>

              <button
                onClick={() => setShowHoursConfig(!showHoursConfig)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${theme.card} ${theme.text} ${theme.tableBorder} hover:border-[#9E217B]/50 cursor-pointer`}
              >
                <FaClock className="text-[#9E217B]" /> Working Hours: {workingHours.flexible ? "Flexible" : `${workingHours.loginTime} - ${workingHours.logoutTime}`} <span className="text-[10px]">▼</span>
              </button>

              {showHoursConfig && (
                <div className={`absolute right-0 top-full mt-2 w-64 p-4 rounded-xl shadow-2xl border z-50 ${theme.card}`} style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className={`text-xs font-bold ${theme.text}`}>Configure Working Hours</h3>
                    <button onClick={() => setShowHoursConfig(false)} className={`${theme.textMuted} hover:text-red-500 cursor-pointer`}><FaTimes className="w-3 h-3" /></button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={`text-[10px] block mb-1 font-bold uppercase ${theme.textMuted}`}>Login Time</label>
                      <input type="time" value={localTiming.loginTime} onChange={e => updateWorkingHours({ ...localTiming, loginTime: e.target.value })} className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none ${theme.mainBg} border ${theme.tableBorder} ${theme.text}`} disabled={localTiming.flexible} />
                    </div>
                    <div>
                      <label className={`text-[10px] block mb-1 font-bold uppercase ${theme.textMuted}`}>Logout Time</label>
                      <input type="time" value={localTiming.logoutTime} onChange={e => updateWorkingHours({ ...localTiming, logoutTime: e.target.value })} className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none ${theme.mainBg} border ${theme.tableBorder} ${theme.text}`} disabled={localTiming.flexible} />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-gray-500/20">
                      <label className={`text-[10px] font-bold uppercase ${theme.textMuted}`}>Flexible Mode</label>
                      <button
                        onClick={() => updateWorkingHours({ ...localTiming, flexible: !localTiming.flexible })}
                        className={`w-8 h-4 rounded-full relative transition-colors cursor-pointer ${localTiming.flexible ? "bg-green-500" : "bg-gray-500"}`}
                      >
                        <span className={`absolute top-[2px] w-3 h-3 bg-white rounded-full transition-all ${localTiming.flexible ? "left-[18px]" : "left-[2px]"}`} />
                      </button>
                    </div>
                    <button
                      onClick={saveWorkingHours}
                      disabled={isSavingTiming}
                      className="w-full mt-2 py-2 flex items-center justify-center gap-2 bg-[#9E217B] hover:bg-[#b8268f] text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FaSave /> {isSavingTiming ? "Saving..." : "Save Settings"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={`flex items-center gap-2 flex-wrap mb-3 px-3 py-2.5 rounded-xl border ${theme.tableWrap}`}>
            <span className={`text-[10px] font-black uppercase tracking-wider mr-1 ${theme.textFaint}`}>Columns:</span>
            {([
              { key: "activeLead", label: "Active Lead" },
              { key: "loginDate", label: "Login Date" },
              { key: "loginTime", label: "Login Time" },
              { key: "punctuality", label: "Punctuality" },
              { key: "logoutTime", label: "Logout Time" },
              { key: "liveTimer", label: "Live Timer" },
              { key: "workingHours", label: "Working Hours" },
              { key: "risk", label: "Risk" },
            ] as const).map(col => (
              <button
                key={col.key}
                onClick={() => setVisibleColumns(prev => ({ ...prev, [col.key]: !prev[col.key] }))}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${visibleColumns[col.key]
                  ? "bg-[#9E217B]/10 border-[#9E217B]/40 text-[#9E217B]"
                  : isDark
                    ? "bg-[#1a1a1a] border-[#333] text-gray-500"
                    : "bg-gray-100 border-gray-200 text-gray-400"
                  }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${visibleColumns[col.key] ? "bg-[#9E217B]" : "bg-gray-500"}`} />
                {col.label}
              </button>
            ))}
          </div>

          <div className="flex gap-4 h-[calc(100vh-200px)] overflow-hidden">
            {/* Left Pane - Dense Tracking Grid */}
            <div className={`flex-1 rounded-xl border flex flex-col overflow-hidden ${theme.tableWrap}`}>
              <div className={`overflow-auto flex-1 p-0 ${theme.scroll}`}>
                <table className="w-full text-left border-collapse text-[11px] whitespace-nowrap">
                  <thead className={`sticky top-0 z-10 ${theme.tableHead}`}>
                    <tr className={`${theme.textMuted} uppercase tracking-wider`}>
                      <th className="px-3 py-2 font-bold">Status</th>
                      <th className="px-3 py-2 font-bold">Employee</th>

                      {/* Replace each optional th like this: */}
                      {visibleColumns.activeLead && <th className="px-3 py-2 font-bold">Active Lead</th>}
                      {visibleColumns.loginDate && <th className="px-3 py-2 font-bold">Login Date</th>}
                      {visibleColumns.loginTime && <th className="px-3 py-2 font-bold">Login Time</th>}
                      {visibleColumns.punctuality && <th className="px-3 py-2 font-bold">Punctuality</th>}
                      {visibleColumns.logoutTime && <th className="px-3 py-2 font-bold">Logout Time</th>}
                      {visibleColumns.liveTimer && <th className="px-3 py-2 font-bold">Live Timer</th>}
                      {visibleColumns.workingHours && <th className="px-3 py-2 font-bold">Working Hours</th>}
                      {visibleColumns.risk && <th className="px-3 py-2 font-bold">Risk</th>}
                      <th className="px-3 py-2 font-bold">Attendance</th>
                    </tr>

                  </thead>

                  {/* COLUMN TOGGLE CONTROLS */}

                  <tbody>
                    <tr>

                    </tr>
                    {isFutureDate ? (
                      <tr>
                        <td colSpan={12} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-4xl">📅</span>
                            <p className={`text-sm font-bold ${theme.text}`}>No Data Available</p>
                            <p className={`text-xs ${theme.textMuted}`}>
                              Selected date ({new Date(selectedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}) is in the future.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : isLoading ? (
                      <tr><td colSpan={12} className="py-8 text-center text-sm">Loading telemetry...</td></tr>
                    ) : sessions.length === 0 ? (
                      <tr><td colSpan={12} className="py-8 text-center text-sm">No operational data.</td></tr>
                    ) : (
                      sessions.map((s, i) => (
                        <React.Fragment key={i}>
                          <tr className={`cursor-pointer transition-colors ${selectedUser?.user_id === s.user_id ? 'bg-[#9E217B]/10' : theme.tableRow}`} onClick={(e) => handleRowClick(e, s)}>
                            <td className={`px-3 py-2.5 border-b ${theme.tableBorder} relative`}>
                              {/* Heat Indicator Border */}
                              {s.status === 'ACTIVE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />}
                              {s.status === 'IDLE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500" />}
                              {s.status === 'OFFLINE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-gray-500" />}

                              {s.status === 'ACTIVE' && <span className="font-black text-green-500">🟢 ACTIVE</span>}
                              {s.status === 'IDLE' && <span className="font-bold text-yellow-500">🟡 IDLE</span>}
                              {s.status === 'OFFLINE' && <span className="font-bold text-gray-500">⚪ OFFLINE</span>}
                            </td>
                            <td className={`px-3 py-2.5 border-b font-bold ${theme.text} ${theme.tableBorder}`}>{s.name}</td>

                            {visibleColumns.activeLead && (
                              <td className={`px-3 py-2.5 border-b font-medium text-[#9E217B] ${theme.tableBorder}`}>
                                {s.active_lead_id ? `${s.active_lead_name || 'Lead'} (${s.active_lead_id})` : '-'}
                              </td>
                            )}
                            {visibleColumns.loginDate && (
                              <td className={`px-3 py-2.5 border-b ${theme.textMuted} ${theme.tableBorder}`}>
                                {s.session_start ? new Date(s.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'}
                              </td>
                            )}
                            {visibleColumns.loginTime && (
                              <td className={`px-3 py-2.5 border-b ${theme.textMuted} ${theme.tableBorder}`}>
                                {s.session_start ? new Date(s.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                              </td>
                            )}
                            {visibleColumns.punctuality && (
                              <td className={`px-3 py-2.5 border-b ${theme.tableBorder}`}>
                                {s.session_start ? getPunctualityBadge(s.session_start) : <span className={theme.textFaint}>-</span>}
                              </td>
                            )}
                            {visibleColumns.logoutTime && (
                              <td className={`px-3 py-2.5 border-b font-bold ${s.session_is_active ? 'text-green-500' : theme.textMuted} ${theme.tableBorder}`}>
                                {s.session_start ? (s.session_is_active ? "User Active" : (s.session_end ? new Date(s.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "N/A")) : "-"}
                              </td>
                            )}
                            {visibleColumns.liveTimer && (
                              <td className={`px-3 py-2.5 border-b ${theme.tableBorder}`}>
                                <button className="w-full text-left" onClick={(e) => toggleAccordion(e, s)} disabled={!s.session_start}>
                                  <div className={`flex items-center gap-1.5 font-bold ${s.session_start ? 'text-[#00AEEF]' : theme.textFaint}`}>
                                    {s.session_start ? (s.status === 'OFFLINE' ? "Frozen" : getLiveTimer(s.session_start, s.session_end, s.session_is_active)) : "-"}
                                    {s.session_start && <span className={`text-[8px] transition-transform ${expandedRows[s.user_id] ? 'rotate-180' : ''}`}>▼</span>}
                                  </div>
                                </button>
                              </td>
                            )}
                            {visibleColumns.workingHours && (
                              <td className={`px-3 py-2.5 border-b font-mono font-bold ${theme.text} ${theme.tableBorder}`}>
                                {s.session_start ? getWorkingHours(s.session_start, s.session_end, s.session_is_active) : "-"}
                              </td>
                            )}
                            {visibleColumns.risk && (
                              <td className={`px-3 py-2.5 border-b ${theme.tableBorder}`}>
                                {s.idle_duration_seconds > 1800
                                  ? <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 text-red-500 border border-red-500/20">⚠ Long Idle</span>
                                  : <span className={theme.textFaint}>-</span>}
                              </td>
                            )}
                            <td className={`px-3 py-2.5 border-b ${theme.tableBorder}`}>
                              {s.attendance_status === 'Present' && <span className="text-green-500 font-bold whitespace-nowrap">Present ✅</span>}
                              {s.attendance_status === 'Absent' && <span className="text-red-500 font-bold whitespace-nowrap">Absent ❌</span>}
                              {s.attendance_status === 'Pending' && <span className="text-yellow-500 font-bold whitespace-nowrap">Pending ⏳</span>}
                            </td>
                          </tr>
                          {expandedRows[s.user_id] && (
                            <tr>
                              <td colSpan={3 + Object.values(visibleColumns).filter(Boolean).length} className={`p-4 border-b ${theme.tableBorder} bg-black/5 dark:bg-white/5`}>
                                <div className="mb-2 flex items-center gap-2">
                                  <span className={`text-xs font-black uppercase ${theme.text}`}>▼ Login History — {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                                </div>
                                {historyCache[`${s.user_id}_${selectedDate}`] ? (
                                  <div className="space-y-3 pl-4 border-l-2 border-[#9E217B]/20">
                                    {historyCache[`${s.user_id}_${selectedDate}`].map((h: any, hIdx: number) => (
                                      <div key={hIdx} className="text-[11px]">
                                        <p className={`font-bold ${theme.text}`}>• {new Date(h.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                        <div className="grid grid-cols-4 gap-4 mt-1 ml-3">
                                          <div><span className={theme.textMuted}>Login:</span> <span className={theme.text}>{new Date(h.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></div>
                                          <div><span className={theme.textMuted}>Logout:</span> <span className={`font-bold ${h.is_active ? 'text-green-500' : theme.text}`}>{h.is_active ? "User Active" : (h.session_end ? new Date(h.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : "N/A")}</span></div>
                                          <div><span className={theme.textMuted}>Duration:</span> <span className={`font-mono ${theme.text}`}>{getWorkingHours(h.session_start, h.session_end, h.is_active)}</span></div>
                                          <div><span className={theme.textMuted}>Device:</span> <span className={theme.text}>{h.device_info || '-'}</span></div>
                                          <div className="col-span-4"><span className={theme.textMuted}>IP:</span> <span className={theme.text}>{h.ip_address || '-'}</span></div>
                                        </div>
                                      </div>
                                    ))}
                                    {historyCache[`${s.user_id}_${selectedDate}`].length === 0 && <p className={theme.textMuted}>No sessions found for this date.</p>}
                                  </div>
                                ) : (
                                  <p className={`text-xs ${theme.textMuted}`}>Loading sessions...</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Pane - 4-Tab Inspector Drawer */}
            {selectedUser && (
              <div className={`w-[360px] rounded-xl border flex flex-col overflow-hidden ${theme.card}`}>
                <div className={`p-3 border-b flex items-center justify-between ${theme.tableBorder}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${selectedUser.status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-500'}`}>
                      {selectedUser?.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <h3 className={`font-black text-sm leading-none ${theme.text}`}>{selectedUser?.name || 'Unknown User'}</h3>
                      <span className={`text-[10px] uppercase ${theme.textMuted}`}>{selectedUser?.role || 'Staff'}</span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedUser(null)} className={`${theme.textMuted} hover:text-red-500 p-1`}>
                    <FaTimes />
                  </button>
                </div>

                {/* Inspector Tabs */}
                <div className={`flex text-[10px] font-bold uppercase ${theme.tableBorder} border-b overflow-x-auto`}>
                  {[
                    { id: "activity", label: "Live", icon: FaChartLine },
                    { id: "lead", label: "Lead", icon: FaBriefcase },
                    { id: "analytics", label: "Analytics", icon: FaChartPie },
                    { id: "risk", label: "Risk", icon: FaShieldAlt },
                    { id: "timeline", label: "Timeline", icon: FaHistory },
                    { id: "history", label: "History", icon: FaClock }
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setInspectorTab(t.id as any)}
                      className={`flex-1 py-2 px-2 flex justify-center items-center gap-1.5 transition-colors border-b-2 ${inspectorTab === t.id ? 'border-[#9E217B] text-[#9E217B] bg-[#9E217B]/5' : `border-transparent ${theme.textMuted} hover:bg-black/5 dark:hover:bg-white/5`}`}
                    >
                      <t.icon /> <span className="hidden sm:inline">{t.label}</span>
                    </button>
                  ))}
                </div>

                <div className={`flex-1 p-4 overflow-y-auto ${theme.scroll}`}>
                  {inspectorTab === "activity" && (
                    <div className="space-y-4 text-xs">
                      <div className={`p-3 rounded-lg border ${theme.tableWrap}`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-1`}>Current Status</p>
                        <div className="flex items-center gap-2">
                          {selectedUser.status === 'ACTIVE' && <><FaCircle className="text-green-500 w-3 h-3 animate-pulse" /> <span className={`font-bold ${theme.text}`}>ACTIVE NOW</span></>}
                          {selectedUser.status === 'IDLE' && <><FaWalking className="text-yellow-500 w-3 h-3" /> <span className={`font-bold ${theme.text}`}>IDLE</span></>}
                          {selectedUser.status === 'OFFLINE' && <><FaCircle className="text-gray-500 w-3 h-3" /> <span className={`font-bold ${theme.text}`}>OFFLINE</span></>}
                        </div>
                        <p className={`mt-2 ${theme.textMuted}`}>Route: <span className="font-mono text-[10px]">{selectedUser.current_route || 'Initializing...'}</span></p>
                      </div>

                      <div className={`p-3 rounded-lg border ${theme.tableWrap}`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-2`}>Session Details</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className={`text-[9px] ${theme.textFaint}`}>Email</p>
                            <p className={`font-medium text-[10px] truncate ${theme.text}`}>{selectedUser.email}</p>
                          </div>
                          <div>
                            <p className={`text-[9px] ${theme.textFaint}`}>IP Address</p>
                            <p className={`font-medium text-[10px] ${theme.text}`}>{selectedUser.ip_address || 'Unknown'}</p>
                          </div>
                          <div className="col-span-2">
                            <p className={`text-[9px] ${theme.textFaint}`}>Device / Browser</p>
                            <p className={`font-medium text-[10px] ${theme.text}`}>{selectedUser.device_info || 'Unknown Device'}</p>
                          </div>
                        </div>
                      </div>

                      <div className={`p-3 rounded-lg border ${theme.tableWrap}`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-1`}>Work Tracking</p>
                        <p className={`font-medium ${theme.text}`}>Module: {selectedUser.current_module || '-'}</p>
                        <p className={`font-medium ${theme.text} mt-1`}>Action: {selectedUser.current_action || '-'}</p>
                      </div>

                      <div className={`p-3 rounded-lg border ${theme.tableWrap}`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-1`}>Productivity Meter</p>
                        <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 mt-2">
                          <div className="bg-[#9E217B] h-2 rounded-full" style={{ width: `${Math.min(100, (selectedUser.productivity_score || 0) * 2)}%` }}></div>
                        </div>
                        <p className={`text-right text-[9px] mt-1 ${theme.textMuted}`}>Score: {selectedUser.productivity_score}</p>
                      </div>
                    </div>
                  )}

                  {inspectorTab === "lead" && (
                    <div className="space-y-4 text-xs">
                      <div className={`p-3 rounded-lg border ${selectedUser.active_lead_id ? 'bg-[#9E217B]/5 border-[#9E217B]/30' : theme.tableWrap}`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-1`}>Active Target</p>
                        {selectedUser.active_lead_id ? (
                          <>
                            <p className={`font-bold text-sm ${theme.text}`}>{selectedUser.active_lead_name || 'Unknown Lead'}</p>
                            <p className={`font-mono text-[10px] ${theme.textMuted} mt-0.5`}>ID: {selectedUser.active_lead_id}</p>
                          </>
                        ) : (
                          <p className={`italic ${theme.textFaint}`}>No Active Lead Selected</p>
                        )}
                      </div>
                    </div>
                  )}

                  {inspectorTab === "analytics" && (
                    <div className="space-y-4 text-xs">
                      <div className={`p-3 rounded-lg border ${theme.tableWrap}`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-2`}>Employee Efficiency</p>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className={`text-[9px] ${theme.textFaint}`}>Total Online Time</p>
                            <p className={`font-medium ${theme.text}`}>{formatDuration(selectedUser.session_duration_seconds)}</p>
                          </div>
                          <div>
                            <p className={`text-[9px] ${theme.textFaint}`}>Active Time</p>
                            <p className={`font-medium text-green-500`}>{formatDuration(selectedUser.session_duration_seconds - (selectedUser.idle_duration_seconds || 0))}</p>
                          </div>
                          <div>
                            <p className={`text-[9px] ${theme.textFaint}`}>Idle Time</p>
                            <p className={`font-medium text-yellow-500`}>{formatDuration(selectedUser.idle_duration_seconds || 0)}</p>
                          </div>
                        </div>
                      </div>
                      <div className={`p-3 rounded-lg border ${theme.tableWrap} mt-4`}>
                        <p className={`text-[10px] uppercase font-bold ${theme.textMuted} mb-2`}>Operational Output</p>
                        {analyticsData ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className={`text-[9px] ${theme.textFaint}`}>Leads Opened</p>
                              <p className={`font-medium ${theme.text}`}>{analyticsData.analytics.leadsOpened}</p>
                            </div>
                            <div>
                              <p className={`text-[9px] ${theme.textFaint}`}>Calls Initiated</p>
                              <p className={`font-medium ${theme.text}`}>{analyticsData.analytics.callsInitiated}</p>
                            </div>
                            <div>
                              <p className={`text-[9px] ${theme.textFaint}`}>Followups Added</p>
                              <p className={`font-medium ${theme.text}`}>{analyticsData.analytics.followupsAdded}</p>
                            </div>
                            <div>
                              <p className={`text-[9px] ${theme.textFaint}`}>Total Interactions</p>
                              <p className={`font-medium ${theme.text}`}>{analyticsData.analytics.interactions}</p>
                            </div>
                          </div>
                        ) : (
                          <p className={`text-[10px] italic ${theme.textMuted}`}>Loading analytics...</p>
                        )}
                      </div>
                    </div>
                  )}

                  {inspectorTab === "risk" && (
                    <div className="space-y-3 text-xs">
                      {selectedUser.idle_duration_seconds > 1800 && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex gap-3 items-start">
                          <FaExclamationTriangle className="text-red-500 mt-0.5" />
                          <div>
                            <p className="font-bold text-red-500">Severe Inactivity Detected</p>
                            <p className="text-[10px] text-red-400 mt-0.5">User has been completely inactive for over 30 minutes while still logged in.</p>
                          </div>
                        </div>
                      )}

                      {analyticsData?.risks?.frequentLeadSwitching && (
                        <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 flex gap-3 items-start">
                          <FaExclamationTriangle className="text-orange-500 mt-0.5" />
                          <div>
                            <p className="font-bold text-orange-500">Frequent Lead Switching</p>
                            <p className="text-[10px] text-orange-400 mt-0.5">User has rapidly opened {analyticsData.risks.uniqueRecentLeadsCount} distinct leads in the last 10 minutes.</p>
                          </div>
                        </div>
                      )}

                      {selectedUser.active_sessions_count > 1 && (
                        <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 flex gap-3 items-start">
                          <FaExclamationTriangle className="text-orange-500 mt-0.5" />
                          <div>
                            <p className="font-bold text-orange-500">Multiple Active Sessions</p>
                            <p className="text-[10px] text-orange-400 mt-0.5">This user is currently logged into {selectedUser.active_sessions_count} devices/browsers simultaneously.</p>
                          </div>
                        </div>
                      )}

                      {selectedUser.status === 'OFFLINE' && (
                        <div className="p-3 rounded-lg bg-gray-500/10 border border-gray-500/30 flex gap-3 items-start">
                          <FaInfoCircle className="text-gray-400 mt-0.5" />
                          <div>
                            <p className="font-bold text-gray-400">Offline / Terminated</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">This session has been terminated either manually or automatically.</p>
                          </div>
                        </div>
                      )}

                      {(!selectedUser.idle_duration_seconds || selectedUser.idle_duration_seconds <= 1800) && selectedUser.active_sessions_count <= 1 && selectedUser.status !== 'OFFLINE' && (
                        <p className={`text-center py-4 italic ${theme.textFaint}`}>No operational risks detected.</p>
                      )}

                      <div className="mt-8 pt-4 border-t border-red-500/20">
                        <p className={`text-[10px] uppercase font-bold text-red-500 mb-2`}>Admin Actions</p>
                        <button onClick={() => handleForceLogout(selectedUser.user_id)} className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-lg transition-colors font-bold flex justify-center items-center gap-2">
                          <FaShieldAlt /> Force Logout User
                        </button>
                        <p className={`text-[9px] text-center mt-2 ${theme.textFaint}`}>Instantly revokes access and redirects to login.</p>
                      </div>
                    </div>
                  )}

                  {inspectorTab === "timeline" && (
                    <div className="space-y-4 text-xs">
                      <div className="relative border-l-2 border-[#9E217B]/30 ml-2 space-y-4">
                        {analyticsData?.timeline ? analyticsData.timeline.map((log: any, idx: number) => (
                          <div key={idx} className="relative">
                            <div className="absolute -left-[21px] top-0.5 w-6 h-6 rounded-full bg-[#9E217B]/20 flex items-center justify-center text-[#9E217B] text-[10px]"><FaCircle className="w-2 h-2" /></div>
                            <div className="ml-5">
                              <p className={`font-bold ${theme.text}`}>{log.action_type}: {log.action}</p>
                              <p className={`text-[10px] ${theme.textMuted}`}>{new Date(log.created_at).toLocaleTimeString()} • {log.module}</p>
                              {log.lead_id && (
                                <p className={`text-[10px] mt-0.5 ${theme.accentText}`}>Lead: {log.lead_name} (#{log.lead_id})</p>
                              )}
                            </div>
                          </div>
                        )) : (
                          <p className={`text-[10px] italic ${theme.textMuted} ml-4`}>Loading audit history...</p>
                        )}
                        {analyticsData?.timeline?.length === 0 && (
                          <p className={`text-[10px] italic ${theme.textMuted} ml-4`}>No meaningful events recorded yet today.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {inspectorTab === "history" && (
                    <div className="space-y-4 text-xs">
                      {sessionHistory.length > 0 ? (
                        <div className="space-y-3">
                          {sessionHistory.map((sLog: any, idx: number) => (
                            <div key={idx} className={`p-3 rounded-lg border ${theme.tableWrap}`}>
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <p className={`font-bold ${theme.text}`}>{new Date(sLog.session_start).toLocaleDateString()}</p>
                                  <p className={`text-[10px] ${theme.textMuted}`}>{new Date(sLog.session_start).toLocaleTimeString()} - {sLog.session_end ? new Date(sLog.session_end).toLocaleTimeString() : 'Ongoing'}</p>
                                </div>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${sLog.status === 'ACTIVE' ? 'bg-green-500/10 text-green-500' : sLog.status === 'IDLE' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-gray-500/10 text-gray-500'}`}>{sLog.status}</span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-[9px] mt-2 border-t pt-2 border-gray-500/20">
                                <div>
                                  <p className={theme.textFaint}>Duration</p>
                                  <p className={`font-medium ${theme.text}`}>{formatDuration(sLog.session_duration_seconds || 0)}</p>
                                </div>
                                <div>
                                  <p className={theme.textFaint}>Idle Time</p>
                                  <p className={`font-medium ${theme.text}`}>{formatDuration(sLog.idle_duration_seconds || 0)}</p>
                                </div>
                                {sLog.session_end_reason && (
                                  <div className="col-span-2 mt-1">
                                    <p className={theme.textFaint}>End Reason</p>
                                    <p className={`font-medium ${theme.text}`}>{sLog.session_end_reason}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={`text-[10px] italic ${theme.textMuted}`}>No session history found or loading...</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
