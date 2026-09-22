//LiveActivityView.tsx
"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaCircle, FaUsers, FaWalking, FaExclamationTriangle, FaTimes, FaChartLine,
  FaShieldAlt, FaBriefcase, FaChartPie, FaInfoCircle, FaHistory, FaClock,
  FaCog, FaSave, FaCalendarAlt
} from "react-icons/fa";
import { MdChevronLeft, MdChevronRight } from "react-icons/md";
import AttendanceReportButton from "@/components/AttendanceReportButton";
import { useShiftTiming } from "@/hooks/useShiftTiming";
import { useRealtimeOrg } from "@/lib/supabase/useRealtimeOrg";

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
    location: true,
    device: true,
    punctuality: true,
    logoutTime: true,
    liveTimer: true,
    workingHours: true,
    todayWorkingHours: true,
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

    const expected = new Date(loginDate);
    expected.setHours(configH, configM, 0, 0);

    const diffMs = loginDate.getTime() - expected.getTime();
    const diffMinutes = Math.round(diffMs / 60000);

    if (diffMinutes > 2) {
      return (
        <span className={`px-2 py-1 rounded-[6px] text-[10px] font-bold tracking-wide ${isDark ? "bg-[#FF453A]/15 text-[#FF453A]" : "bg-[#FFECEB] text-[#FF3B30]"} whitespace-nowrap`}>
          Late {formatPunctualityDiff(diffMinutes)}
        </span>
      );
    } else if (diffMinutes < -2) {
      return (
        <span className={`px-2 py-1 rounded-[6px] text-[10px] font-bold tracking-wide ${isDark ? "bg-[#32D74B]/15 text-[#32D74B]" : "bg-[#EBF9EE] text-[#34C759]"} whitespace-nowrap`}>
          Early {formatPunctualityDiff(diffMinutes)}
        </span>
      );
    } else {
      return (
        <span className={`px-2 py-1 rounded-[6px] text-[10px] font-bold tracking-wide ${isDark ? "bg-[#0A84FF]/15 text-[#0A84FF]" : "bg-[#E5F1FF] text-[#007AFF]"} whitespace-nowrap`}>
          On Time
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

  // Resolve org ID for Supabase Realtime
  const orgId = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("crmUser");
      if (!raw) return null;
      return JSON.parse(raw)?.org || null;
    } catch { return null; }
  }, []);

  const selectedUserRef = useRef(selectedUser);
  selectedUserRef.current = selectedUser;

  const realtimeEvents = useMemo(() => ({
    "activity.session_update": (data: Record<string, unknown>) => {
      setSessions(prev => {
        const exists = prev.find((s: any) => s.user_id === data.userId);
        if (exists) {
          return prev.map((s: any) => s.user_id === data.userId ? { ...s, ...data } : s);
        }
        return prev;
      });
      if (selectedUserRef.current?.user_id === data.userId) {
        setSelectedUser((prev: any) => prev && prev.user_id === data.userId ? ({ ...prev, ...data }) : prev);
      }
    },
    "activity.event": (data: Record<string, unknown>) => {
      // Update sessions
      setSessions(prev => {
        const exists = prev.find((s: any) => s.user_id === data.userId);
        if (exists) {
          return prev.map((s: any) => s.user_id === data.userId ? { ...s, ...data } : s);
        }
        return prev;
      });
      if (selectedUserRef.current?.user_id === data.userId) {
        setSelectedUser((prev: any) => prev && prev.user_id === data.userId ? ({ ...prev, ...data }) : prev);
      }
      // Live events timeline
      setLiveEvents(prev => {
        const newFeed = [{
          id: Date.now() + Math.random(),
          message: `${data.userName} ${data.action} ${data.leadName ? `(${data.leadName})` : ''}`,
          time: new Date(data.timestamp as string).toLocaleTimeString()
        }, ...prev];
        return newFeed.slice(0, 5);
      });
    },
    "activity.smart_alert": (data: Record<string, unknown>) => {
      setSmartAlerts(prev => {
        const newAlerts = [{
          id: Date.now() + Math.random(),
          message: data.message as string,
          type: data.alertType as string,
          time: new Date(data.timestamp as string).toLocaleTimeString()
        }, ...prev];
        return newAlerts.slice(0, 10);
      });
    },
    "activity.attendance_sync": () => {
      fetchSessions();
    },
    "force_logout": () => {
      fetchSessions();
    },
  }), []);

  useRealtimeOrg({ organizationId: orgId, events: realtimeEvents });

  const fetchSessions = async () => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedDate > today) {
      setSessions([]);
      setIsLoading(false);
      return;
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

  const todayStr = new Date().toISOString().split('T')[0];
  const isFutureDate = selectedDate > todayStr;

  return (
    <div className={`flex flex-col h-full overflow-hidden p-4 sm:p-8 font-sans antialiased overflow-x-hidden ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>

      {/* SMART ALERTS PANEL (Floating Top Center) */}
      <AnimatePresence>
        {smartAlerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-[90%] sm:w-[400px]"
          >
            {smartAlerts.map(alert => (
              <div key={alert.id} className="backdrop-blur-2xl bg-[#FF3B30]/90 text-white p-3 rounded-[16px] shadow-[0_8px_30px_rgba(255,59,48,0.3)] border border-white/20">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-[11px] uppercase tracking-wider">{alert.type.replace(/_/g, ' ')}</span>
                  <span className="text-[11px] font-medium opacity-80">{alert.time}</span>
                </div>
                <p className="text-[13px] font-medium leading-snug">{alert.message}</p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* FLOATING REALTIME EVENT FEED (Top Right) */}
      <AnimatePresence>
        {liveEvents.length > 0 && (
          <div className="fixed top-24 right-4 z-50 w-64 space-y-2 pointer-events-none hidden md:block">
            {liveEvents.map((evt) => (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`backdrop-blur-2xl p-3 rounded-[16px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] pointer-events-auto ${isDark ? "bg-[#1C1C1E]/80 border border-white/10" : "bg-white/80 border border-black/5"}`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{evt.time}</span>
                <span className={`text-[12px] font-medium leading-snug block ${isDark ? "text-white" : "text-black"}`}>{evt.message}</span>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* TOP HEADER & TOGGLES */}
      {/* <div className="flex flex-col sm:flex-row ...>
        ... */}
      {/* </div> */}

      {viewMode === "analytics" && globalAnalytics ? (
        <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-10 custom-scrollbar h-[calc(100vh-140px)]">
          {/* ANALYTICS KPI CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={`p-4 rounded-[20px] ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Avg Active Time</p>
              <h3 className={`text-2xl font-bold mt-1.5 ${isDark ? "text-white" : "text-black"}`}>{formatDuration(globalAnalytics.kpis?.avgActiveTimeSeconds || 0)}</h3>
              <p className={`text-[12px] font-medium mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Excludes idle duration</p>
            </div>
            <div className={`p-4 rounded-[20px] ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Most Active</p>
              <h3 className={`text-xl font-bold mt-1.5 truncate ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>{globalAnalytics.kpis?.mostActiveEmployee?.name || 'N/A'}</h3>
              <p className={`text-[12px] font-medium mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{formatDuration(globalAnalytics.kpis?.mostActiveEmployee?.time || 0)} active</p>
            </div>
            <div className={`p-4 rounded-[20px] ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Highest Idle</p>
              <h3 className={`text-xl font-bold mt-1.5 truncate ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>{globalAnalytics.kpis?.highestIdleEmployee?.name || 'N/A'}</h3>
              <p className={`text-[12px] font-medium mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{formatDuration(globalAnalytics.kpis?.highestIdleEmployee?.time || 0)} idle</p>
            </div>
            <div className={`p-4 rounded-[20px] ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Total Leads Worked</p>
              <h3 className={`text-2xl font-bold mt-1.5 ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>{sessions.filter(s => s.active_lead_id).length} <span className="text-[14px]">Active Now</span></h3>
              <p className={`text-[12px] font-medium mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Realtime engagement</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* WEEKLY HEATMAP */}
            <div className={`p-5 rounded-[24px] ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <h3 className={`text-[14px] font-semibold tracking-tight mb-5 ${isDark ? "text-white" : "text-black"}`}>Operational Rhythm (7 Days)</h3>
              <div className="space-y-4">
                {globalAnalytics.weeklyHeatmap?.map((day: any) => (
                  <div key={day.date} className="flex items-center justify-between">
                    <span className={`text-[13px] font-semibold tracking-tight w-24 ${isDark ? "text-white" : "text-black"}`}>{day.day}</span>
                    <div className={`flex-1 mx-4 h-2 rounded-full overflow-hidden flex ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`}>
                      <div className="bg-[#0A84FF] h-full rounded-full" style={{ width: `${Math.min(100, (day.count / 200) * 100)}%` }} />
                    </div>
                    <span className={`text-[12px] font-medium w-16 text-right ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{day.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* MODULE USAGE */}
            <div className={`p-5 rounded-[24px] ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <h3 className={`text-[14px] font-semibold tracking-tight mb-5 ${isDark ? "text-white" : "text-black"}`}>Global Module Usage</h3>
              <div className="space-y-4">
                {globalAnalytics.moduleUsage?.map((mod: any) => (
                  <div key={mod.module} className="flex items-center justify-between">
                    <span className={`text-[13px] font-semibold tracking-tight w-32 truncate ${isDark ? "text-white" : "text-black"}`}>{mod.module}</span>
                    <div className={`flex-1 mx-4 h-2 rounded-full overflow-hidden flex ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`}>
                      <div className="bg-[#32D74B] h-full rounded-full" style={{ width: `${mod.percentage}%` }} />
                    </div>
                    <span className={`text-[12px] font-medium w-12 text-right ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{mod.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 mb-6">
            <span className={`text-base sm:text-xl font-black tracking-tight ${theme.accentText}`}>Live Activity Overview</span>
            <span className={`text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Real-time tracking of team attendance and engagement.</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-5">
            <div className={`p-4 rounded-[20px] flex items-center justify-between ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <div>
                <p className={`text-[11px] uppercase font-bold tracking-wider mb-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Online</p>
                <h3 className={`text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{activeCount}</h3>
              </div>
              <FaCircle className={`w-3.5 h-3.5 animate-pulse ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`} />
            </div>
            <div className={`p-4 rounded-[20px] flex items-center justify-between ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <div>
                <p className={`text-[11px] uppercase font-bold tracking-wider mb-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Logged In</p>
                <h3 className={`text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{sessions.length}</h3>
              </div>
              <FaUsers className={`w-5 h-5 ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />
            </div>
            <div className={`p-4 rounded-[20px] flex items-center justify-between ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <div>
                <p className={`text-[11px] uppercase font-bold tracking-wider mb-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Idle</p>
                <h3 className={`text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{idleCount}</h3>
              </div>
              <FaWalking className={`w-5 h-5 ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`} />
            </div>
            <div className={`p-4 rounded-[20px] flex items-center justify-between ${isDark ? "bg-[#1C1C1E] shadow-sm" : "bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}>
              <div>
                <p className={`text-[11px] uppercase font-bold tracking-wider mb-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Avg Score</p>
                <h3 className={`text-2xl font-bold tracking-tight ${isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]"}`}>
                  {sessions.length > 0 ? Math.round(sessions.reduce((acc, s) => acc + (s.productivity_score || 0), 0) / sessions.length) : 0}
                </h3>
              </div>
              <FaChartLine className={`w-5 h-5 ${isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]"}`} />
            </div>
          </div>

          {/* DATE PICKER & WORKING HOURS ROW */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 relative z-30">
            <div className="flex items-center gap-3">
              {/* Custom Apple-Style Date Picker */}
              <AppleDatePicker
                selectedDate={selectedDate}
                onChange={setSelectedDate}
                maxDate={todayStr}
                isDark={isDark}
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative isolate w-full sm:w-auto">
                <AttendanceReportButton theme={theme} isDark={isDark} />
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowHoursConfig(!showHoursConfig)}
                  className={`px-4 py-2 rounded-full text-[13px] font-semibold tracking-wide flex items-center justify-between gap-2 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-colors ${isDark ? "bg-[#2C2C2E] border border-white/5 text-white hover:bg-[#3A3A3C]" : "bg-white border border-black/5 text-black hover:bg-gray-50"
                    }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <FaClock className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"} />
                    {workingHours.flexible ? "Flexible" : `${workingHours.loginTime} - ${workingHours.logoutTime}`}
                  </span>
                </button>

                <AnimatePresence>
                  {showHoursConfig && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                      className={`absolute left-0 sm:left-auto sm:right-0 top-[calc(100%+8px)] w-64 p-4 rounded-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] z-50 backdrop-blur-2xl ${isDark ? "bg-[#1C1C1E]/85 border border-white/10" : "bg-white/90 border border-black/5"
                        }`}
                    >
                      <div className="flex justify-between items-center mb-4">
                        <h3 className={`text-[13px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>Shift Settings</h3>
                        <button onClick={() => setShowHoursConfig(false)} className={`${isDark ? "text-[#8E8E93] hover:text-white" : "text-[#8E8E93] hover:text-black"} transition-colors`}>
                          <FaTimes className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className={`text-[13px] font-medium ${isDark ? "text-white" : "text-black"}`}>Flexible Mode</label>
                          <button
                            onClick={() => updateWorkingHours({ ...localTiming, flexible: !localTiming.flexible })}
                            className={`w-11 h-6 rounded-full relative transition-colors duration-300 ease-in-out cursor-pointer ${localTiming.flexible ? (isDark ? "bg-[#32D74B]" : "bg-[#34C759]") : (isDark ? "bg-[#3A3A3C]" : "bg-[#E5E5EA]")}`}
                          >
                            <span className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ease-in-out ${localTiming.flexible ? "translate-x-5" : "translate-x-0"}`} />
                          </button>
                        </div>
                        <div className={`space-y-3 transition-opacity ${localTiming.flexible ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
                          <div>
                            <label className={`text-[11px] font-semibold uppercase tracking-wider mb-1 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Login Time</label>
                            <input type="time" value={localTiming.loginTime} onChange={e => updateWorkingHours({ ...localTiming, loginTime: e.target.value })} disabled={localTiming.flexible} className={`w-full px-3 py-2 rounded-lg text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-[#007AFF] transition-all border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-[#F2F2F7] border-[#E5E5EA] text-black"}`} />
                          </div>
                          <div>
                            <label className={`text-[11px] font-semibold uppercase tracking-wider mb-1 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Logout Time</label>
                            <input type="time" value={localTiming.logoutTime} onChange={e => updateWorkingHours({ ...localTiming, logoutTime: e.target.value })} disabled={localTiming.flexible} className={`w-full px-3 py-2 rounded-lg text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-[#007AFF] transition-all border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-[#F2F2F7] border-[#E5E5EA] text-black"}`} />
                          </div>
                        </div>
                        <button
                          onClick={saveWorkingHours}
                          disabled={isSavingTiming}
                          className={`w-full mt-2 py-2.5 flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold tracking-wide transition-colors ${isSavingTiming ? "opacity-50 cursor-not-allowed bg-[#8E8E93] text-white" : isDark ? "bg-[#0A84FF] hover:bg-[#007AFF] text-white" : "bg-[#007AFF] hover:bg-[#005bb5] text-white"}`}
                        >
                          <FaSave /> {isSavingTiming ? "Saving..." : "Save Settings"}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-[calc(100vh-230px)] overflow-hidden">
            {/* Left Pane - Dense Tracking Grid */}
            <div className={`flex-1 rounded-[24px] border flex flex-col overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.03)] min-h-[350px] ${isDark ? "bg-[#1C1C1E] border-white/5" : "bg-white border-black/5"}`}>
              <div className={`overflow-auto flex-1 p-0 custom-scrollbar`}>
                <table className="w-full text-left border-collapse text-[12px] whitespace-nowrap">
                  <thead className={`sticky top-0 z-10 backdrop-blur-xl ${isDark ? "bg-[#1C1C1E]/80 border-b border-[#38383A]" : "bg-white/80 border-b border-[#E5E5EA]"}`}>
                    <tr className="text-[#8E8E93] uppercase tracking-wider font-medium text-[10px]">
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Employee</th>
                      {visibleColumns.activeLead && <th className="px-4 py-3">Active Lead</th>}
                      {visibleColumns.loginDate && <th className="px-4 py-3">Login Date</th>}
                      {visibleColumns.loginTime && <th className="px-4 py-3">Login Time</th>}
                      {visibleColumns.location && <th className="px-4 py-3">Location</th>}
                      {visibleColumns.device && <th className="px-4 py-3">Device</th>}
                      {visibleColumns.punctuality && <th className="px-4 py-3">Punctuality</th>}
                      {visibleColumns.logoutTime && <th className="px-4 py-3">Logout Time</th>}
                      {visibleColumns.liveTimer && <th className="px-4 py-3">Live Timer</th>}
                      {visibleColumns.todayWorkingHours && <th className="px-4 py-3">Working Hours</th>}
                      {visibleColumns.risk && <th className="px-4 py-3">Risk</th>}
                      <th className="px-4 py-3">Attendance</th>
                    </tr>
                  </thead>

                  <tbody>
                    {isFutureDate ? (
                      <tr>
                        <td colSpan={14} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-4xl opacity-50">📅</span>
                            <p className={`text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>No Data Available</p>
                            <p className={`text-[12px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                              Selected date is in the future.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : isLoading ? (
                      <tr><td colSpan={14} className={`py-12 text-center text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Loading telemetry...</td></tr>
                    ) : sessions.length === 0 ? (
                      <tr><td colSpan={14} className={`py-12 text-center text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No operational data.</td></tr>
                    ) : (
                      sessions.map((s, i) => {
                        const isSelected = selectedUser?.user_id === s.user_id;
                        return (
                          <React.Fragment key={i}>
                            <tr
                              className={`cursor-pointer transition-colors border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"} ${isSelected ? (isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]") : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"}`}
                              onClick={(e) => handleRowClick(e, s)}
                            >
                              <td className="px-4 py-3 relative">
                                {s.status === 'ACTIVE' && <div className={`absolute left-0 top-1/2 -translate-y-1/2 h-2/3 w-[3px] rounded-r-full ${isDark ? "bg-[#32D74B]" : "bg-[#34C759]"}`} />}
                                <span className={`font-semibold tracking-tight text-[12px] ${s.status === 'ACTIVE' ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : (s.status === 'IDLE' ? (isDark ? "text-[#FF9F0A]" : "text-[#FF9500]") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"))}`}>
                                  {s.status === 'ACTIVE' ? "Active" : s.status === 'IDLE' ? "Idle" : "Offline"}
                                </span>
                              </td>
                              <td className={`px-4 py-3 font-semibold tracking-tight text-[13px] ${isDark ? "text-white" : "text-black"}`}>{s.name}</td>

                              {visibleColumns.activeLead && (
                                <td className={`px-4 py-3 font-medium text-[12px] ${isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]"}`}>
                                  {s.active_lead_id ? `${s.active_lead_name || 'Lead'} (${s.active_lead_id})` : '-'}
                                </td>
                              )}
                              {visibleColumns.loginDate && (
                                <td className={`px-4 py-3 font-medium text-[12px] tracking-tight ${isDark ? "text-[#EBEBF5]/80" : "text-[#333333]"}`}>
                                  {s.session_start ? new Date(s.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-'}
                                </td>
                              )}
                              {visibleColumns.loginTime && (
                                <td className={`px-4 py-3 font-medium text-[12px] tracking-tight ${isDark ? "text-[#EBEBF5]/80" : "text-[#333333]"}`}>
                                  {s.session_start ? new Date(s.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-'}
                                </td>
                              )}
                              {visibleColumns.location && (
                                <td className={`px-4 py-3 font-medium text-[12px] tracking-tight ${isDark ? "text-[#EBEBF5]/80" : "text-[#333333]"}`}>
                                  {s.login_location_name
                                    ? <span title={s.login_latitude != null ? `${Number(s.login_latitude).toFixed(6)}, ${Number(s.login_longitude).toFixed(6)}` : undefined}>{s.login_location_name}</span>
                                    : s.login_latitude != null && s.login_longitude != null
                                      ? <span className="font-mono">{`${Number(s.login_latitude).toFixed(4)}, ${Number(s.login_longitude).toFixed(4)}`}</span>
                                      : <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>—</span>}
                                </td>
                              )}
                              {visibleColumns.device && (
                                <td className={`px-4 py-3 font-medium text-[12px] tracking-tight ${isDark ? "text-[#EBEBF5]/80" : "text-[#333333]"}`}>
                                  {s.login_device_name ? (
                                    <div className="leading-snug">
                                      <span>{s.login_device_name}</span>
                                      {s.login_os && <><br /><span className={`text-[10px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{s.login_os}</span></>}
                                    </div>
                                  ) : <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>—</span>}
                                </td>
                              )}
                              {visibleColumns.punctuality && (
                                <td className={`px-4 py-3`}>
                                  {s.session_start ? getPunctualityBadge(s.session_start) : <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>-</span>}
                                </td>
                              )}
                              {visibleColumns.logoutTime && (
                                <td className={`px-4 py-3 font-medium tracking-tight text-[12px] ${s.session_is_active ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : (isDark ? "text-[#EBEBF5]/80" : "text-[#333333]")}`}>
                                  {s.session_start ? (s.session_is_active ? "Active Session" : (s.session_end ? new Date(s.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : "N/A")) : "-"}
                                </td>
                              )}
                              {visibleColumns.liveTimer && (
                                <td className={`px-4 py-3`}>
                                  <button className="w-full text-left group" onClick={(e) => toggleAccordion(e, s)} disabled={!s.session_start}>
                                    <div className={`flex items-center gap-2 font-mono text-[13px] tracking-tight ${s.session_start ? (isDark ? "text-[#0A84FF]" : "text-[#007AFF]") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]")}`}>
                                      {s.session_start ? (s.status === 'OFFLINE' ? "Frozen" : getLiveTimer(s.session_start, s.session_end, s.session_is_active)) : "-"}
                                      {s.session_start && <MdChevronDown className={`text-[16px] transition-transform ${expandedRows[s.user_id] ? 'rotate-180' : 'opacity-0 group-hover:opacity-100'}`} />}
                                    </div>
                                  </button>
                                </td>
                              )}
                              {visibleColumns.todayWorkingHours && (
                                <td className={`px-4 py-3 font-mono font-medium tracking-tight text-[13px] ${isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]"}`}>
                                  {s.working_track != null ? (() => {
                                    const wt = Number(s.working_track);
                                    const h = Math.floor(wt / 3600);
                                    const m = Math.floor((wt % 3600) / 60);
                                    return <span>{`${h}h ${String(m).padStart(2, '0')}m`}</span>;
                                  })() : <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>—</span>}
                                </td>
                              )}
                              {visibleColumns.risk && (
                                <td className={`px-4 py-3`}>
                                  {s.idle_duration_seconds > 1800
                                    ? <span className={`px-2 py-1 rounded-[6px] text-[10px] font-bold tracking-wide ${isDark ? "bg-[#FF453A]/15 text-[#FF453A]" : "bg-[#FFECEB] text-[#FF3B30]"} whitespace-nowrap`}>⚠ Long Idle</span>
                                    : <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>-</span>}
                                </td>
                              )}
                              <td className={`px-4 py-3 text-[12px] font-semibold tracking-tight`}>
                                {s.attendance_status === 'Present' && <span className={isDark ? "text-[#32D74B]" : "text-[#34C759]"}>Present</span>}
                                {s.attendance_status === 'Absent' && <span className={isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}>Absent</span>}
                                {s.attendance_status === 'Pending' && <span className={isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}>Pending</span>}
                              </td>
                            </tr>

                            {/* Accordion History */}
                            <AnimatePresence>
                              {expandedRows[s.user_id] && (
                                <motion.tr
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                >
                                  <td colSpan={14} className={`p-4 border-b ${isDark ? "border-[#38383A] bg-[#2C2C2E]/40" : "border-[#E5E5EA] bg-[#F2F2F7]/50"}`}>
                                    <div className="mb-3 flex items-center gap-2">
                                      <span className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Login History — {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                                    </div>
                                    {historyCache[`${s.user_id}_${selectedDate}`] ? (
                                      <div className={`space-y-4 pl-4 border-l-2 ${isDark ? "border-[#3A3A3C]" : "border-[#E5E5EA]"}`}>
                                        {historyCache[`${s.user_id}_${selectedDate}`].map((h: any, hIdx: number) => (
                                          <div key={hIdx} className="text-[12px]">
                                            <p className={`font-semibold tracking-tight mb-1 ${isDark ? "text-white" : "text-black"}`}>• {new Date(h.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 ml-3">
                                              <div><span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>Login:</span> <span className={isDark ? "text-white" : "text-black"}>{new Date(h.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span></div>
                                              <div><span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>Logout:</span> <span className={`font-medium ${h.is_active ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : (isDark ? "text-white" : "text-black")}`}>{h.is_active ? "Active" : (h.session_end ? new Date(h.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : "N/A")}</span></div>
                                              <div><span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>Duration:</span> <span className={`font-mono ${isDark ? "text-white" : "text-black"}`}>{getWorkingHours(h.session_start, h.session_end, h.is_active)}</span></div>
                                              <div><span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>Device:</span> <span className={isDark ? "text-white" : "text-black"}>{h.login_device_name ? `${h.login_device_name}${h.login_os ? ` / ${h.login_os}` : ''}` : (h.device_info || '-')}</span></div>
                                            </div>
                                          </div>
                                        ))}
                                        {historyCache[`${s.user_id}_${selectedDate}`].length === 0 && <p className={`text-[12px] italic ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No sessions found for this date.</p>}
                                      </div>
                                    ) : (
                                      <p className={`text-[12px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Loading sessions...</p>
                                    )}
                                  </td>
                                </motion.tr>
                              )}
                            </AnimatePresence>
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Pane - macOS Inspector Drawer */}
            <AnimatePresence>
              {selectedUser && (
                <motion.div
                  initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                  animate={{ opacity: 1, width: 360, marginLeft: 16 }}
                  exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                  className={`flex flex-col rounded-[24px] border overflow-hidden shadow-sm flex-shrink-0 ${isDark ? "bg-[#1C1C1E] border-white/5" : "bg-white border-black/5"}`}
                >
                  <div className={`p-4 border-b flex items-center justify-between ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-white text-[14px] ${selectedUser.status === 'ACTIVE' ? (isDark ? "bg-[#32D74B]" : "bg-[#34C759]") : "bg-[#8E8E93]"}`}>
                        {selectedUser?.name?.charAt(0) || '?'}
                      </div>
                      <div className="flex flex-col">
                        <h3 className={`font-semibold text-[15px] tracking-tight leading-tight ${isDark ? "text-white" : "text-black"}`}>{selectedUser?.name || 'Unknown User'}</h3>
                        <span className={`text-[11px] uppercase tracking-wider font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{selectedUser?.role?.replace("_", " ") || 'Staff'}</span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedUser(null)} className={`p-1.5 rounded-full transition-colors ${isDark ? "text-[#8E8E93] hover:bg-white/10 hover:text-white" : "text-[#8E8E93] hover:bg-black/5 hover:text-black"}`}>
                      <FaTimes className="w-4 h-4" />
                    </button>
                  </div>

                  {/* macOS Segmented Control */}
                  <div className={`p-2 border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                    <div className={`flex p-0.5 rounded-[8px] ${isDark ? "bg-[#2C2C2E]" : "bg-[#E5E5EA]"}`}>
                      {[
                        { id: "activity", label: "Live" },
                        { id: "lead", label: "Lead" },
                        { id: "analytics", label: "Data" },
                        { id: "risk", label: "Risk" }
                      ].map(t => (
                        <button
                          key={t.id}
                          onClick={() => setInspectorTab(t.id as any)}
                          className={`flex-1 py-1 text-[12px] font-medium tracking-tight rounded-[6px] transition-all shadow-sm ${inspectorTab === t.id
                            ? (isDark ? "bg-[#3A3A3C] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]" : "bg-white text-black shadow-[0_1px_2px_rgba(0,0,0,0.1)]")
                            : `text-[#8E8E93] shadow-none hover:${isDark ? "text-white" : "text-black"}`
                            }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={`flex-1 p-5 overflow-y-auto custom-scrollbar`}>
                    {inspectorTab === "activity" && (
                      <div className="space-y-4">
                        <div className="flex flex-col gap-1">
                          <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Current Status</p>
                          <div className="flex items-center gap-2 mt-1">
                            {selectedUser.status === 'ACTIVE' && <><FaCircle className={`w-3 h-3 animate-pulse ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`} /> <span className={`font-semibold tracking-tight text-[15px] ${isDark ? "text-white" : "text-black"}`}>Active Now</span></>}
                            {selectedUser.status === 'IDLE' && <><FaWalking className={`w-3.5 h-3.5 ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`} /> <span className={`font-semibold tracking-tight text-[15px] ${isDark ? "text-white" : "text-black"}`}>Idle</span></>}
                            {selectedUser.status === 'OFFLINE' && <><FaCircle className="text-[#8E8E93] w-3 h-3" /> <span className={`font-semibold tracking-tight text-[15px] ${isDark ? "text-white" : "text-black"}`}>Offline</span></>}
                          </div>
                          <p className={`text-[12px] mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Route: <span className="font-mono">{selectedUser.current_route || 'Initializing...'}</span></p>
                        </div>

                        <div className={`h-[1px] w-full ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />

                        <div className="flex flex-col gap-1">
                          <p className={`text-[11px] uppercase font-bold tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Session Details</p>
                          <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                            <div>
                              <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>IP Address</p>
                              <p className={`font-medium text-[13px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>{selectedUser.ip_address || 'Unknown'}</p>
                            </div>
                            <div>
                              <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Device</p>
                              <p className={`font-medium text-[13px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>{selectedUser.login_device_name || selectedUser.device_info || 'Unknown'}</p>
                            </div>
                            <div className="col-span-2">
                              <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Location</p>
                              <p className={`font-medium text-[13px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                                {selectedUser.login_location_name || (selectedUser.login_latitude != null ? `${Number(selectedUser.login_latitude).toFixed(4)}, ${Number(selectedUser.login_longitude).toFixed(4)}` : "Unknown")}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className={`h-[1px] w-full ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />

                        <div className="flex flex-col gap-1">
                          <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Productivity Score</p>
                          <div className={`w-full rounded-full h-1.5 mt-2 ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`}>
                            <div className={`h-1.5 rounded-full ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`} style={{ width: `${Math.min(100, (selectedUser.productivity_score || 0) * 2)}%` }}></div>
                          </div>
                          <p className={`text-right text-[11px] font-medium mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{selectedUser.productivity_score} points</p>
                        </div>
                      </div>
                    )}

                    {inspectorTab === "lead" && (
                      <div className="space-y-4">
                        <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Active Target</p>
                        {selectedUser.active_lead_id ? (
                          <div className={`p-4 rounded-[14px] border ${isDark ? "bg-[#0A84FF]/10 border-[#0A84FF]/20" : "bg-[#E5F1FF] border-[#BCE0FD]"}`}>
                            <p className={`font-semibold tracking-tight text-[15px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>{selectedUser.active_lead_name || 'Unknown Lead'}</p>
                            <p className={`font-mono text-[12px] font-medium mt-1 ${isDark ? "text-[#0A84FF]/70" : "text-[#007AFF]/70"}`}>ID: {selectedUser.active_lead_id}</p>
                          </div>
                        ) : (
                          <p className={`text-[13px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No active lead selected.</p>
                        )}
                      </div>
                    )}

                    {inspectorTab === "analytics" && (
                      <div className="space-y-5">
                        <div className="flex flex-col gap-1">
                          <p className={`text-[11px] uppercase font-bold tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Time Distribution</p>
                          <div className="grid grid-cols-2 gap-y-4">
                            <div>
                              <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Active Time</p>
                              <p className={`font-semibold text-[15px] tracking-tight ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>{formatDuration(selectedUser.session_duration_seconds - (selectedUser.idle_duration_seconds || 0))}</p>
                            </div>
                            <div>
                              <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Idle Time</p>
                              <p className={`font-semibold text-[15px] tracking-tight ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>{formatDuration(selectedUser.idle_duration_seconds || 0)}</p>
                            </div>
                          </div>
                        </div>

                        <div className={`h-[1px] w-full ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />

                        <div className="flex flex-col gap-1">
                          <p className={`text-[11px] uppercase font-bold tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Output</p>
                          {analyticsData ? (
                            <div className="grid grid-cols-2 gap-y-4">
                              <div>
                                <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Leads Opened</p>
                                <p className={`font-semibold text-[15px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>{analyticsData.analytics.leadsOpened}</p>
                              </div>
                              <div>
                                <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Calls Initiated</p>
                                <p className={`font-semibold text-[15px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>{analyticsData.analytics.callsInitiated}</p>
                              </div>
                              <div>
                                <p className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Followups</p>
                                <p className={`font-semibold text-[15px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>{analyticsData.analytics.followupsAdded}</p>
                              </div>
                            </div>
                          ) : (
                            <p className={`text-[12px] italic ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Loading analytics...</p>
                          )}
                        </div>
                      </div>
                    )}

                    {inspectorTab === "risk" && (
                      <div className="space-y-4">
                        {selectedUser.idle_duration_seconds > 1800 && (
                          <div className={`p-4 rounded-[16px] border flex gap-3 items-start ${isDark ? "bg-[#FF453A]/10 border-[#FF453A]/20" : "bg-[#FFECEB] border-[#FF3B30]/20"}`}>
                            <FaExclamationTriangle className={`text-[16px] mt-0.5 flex-shrink-0 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`} />
                            <div>
                              <p className={`font-semibold text-[13px] tracking-tight ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>Severe Inactivity Detected</p>
                              <p className={`text-[12px] mt-1 ${isDark ? "text-[#FF453A]/80" : "text-[#FF3B30]/80"}`}>User has been completely inactive for over 30 minutes.</p>
                            </div>
                          </div>
                        )}

                        {analyticsData?.risks?.frequentLeadSwitching && (
                          <div className={`p-4 rounded-[16px] border flex gap-3 items-start ${isDark ? "bg-[#FF9F0A]/10 border-[#FF9F0A]/20" : "bg-[#FFF4E5] border-[#FF9500]/20"}`}>
                            <FaExclamationTriangle className={`text-[16px] mt-0.5 flex-shrink-0 ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`} />
                            <div>
                              <p className={`font-semibold text-[13px] tracking-tight ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>Frequent Lead Switching</p>
                              <p className={`text-[12px] mt-1 ${isDark ? "text-[#FF9F0A]/80" : "text-[#FF9500]/80"}`}>User rapidly opened {analyticsData.risks.uniqueRecentLeadsCount} leads in 10 minutes.</p>
                            </div>
                          </div>
                        )}

                        {selectedUser.active_sessions_count > 1 && (
                          <div className={`p-4 rounded-[16px] border flex gap-3 items-start ${isDark ? "bg-[#FF9F0A]/10 border-[#FF9F0A]/20" : "bg-[#FFF4E5] border-[#FF9500]/20"}`}>
                            <FaExclamationTriangle className={`text-[16px] mt-0.5 flex-shrink-0 ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`} />
                            <div>
                              <p className={`font-semibold text-[13px] tracking-tight ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>Multiple Active Sessions</p>
                              <p className={`text-[12px] mt-1 ${isDark ? "text-[#FF9F0A]/80" : "text-[#FF9500]/80"}`}>Logged into {selectedUser.active_sessions_count} devices simultaneously.</p>
                            </div>
                          </div>
                        )}

                        {(!selectedUser.idle_duration_seconds || selectedUser.idle_duration_seconds <= 1800) && selectedUser.active_sessions_count <= 1 && selectedUser.status !== 'OFFLINE' && (
                          <p className={`text-center py-4 text-[13px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No operational risks detected.</p>
                        )}

                        <div className={`mt-8 pt-5 border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                          <p className={`text-[11px] uppercase font-bold tracking-wider text-[#FF3B30] mb-3`}>Admin Actions</p>
                          <button onClick={() => handleForceLogout(selectedUser.user_id)} className={`w-full py-2.5 rounded-full font-semibold tracking-wide text-[13px] transition-colors flex justify-center items-center gap-2 ${isDark ? "bg-[#FF453A]/15 text-[#FF453A] hover:bg-[#FF453A]/25" : "bg-[#FFECEB] text-[#FF3B30] hover:bg-[#FF3B30]/20"}`}>
                            <FaShieldAlt /> Force Logout
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Timeline & History tabs omitted from visual refactor for brevity but logic remains same if implemented */}
                    {(inspectorTab === "timeline" || inspectorTab === "history") && (
                      <p className={`text-[13px] text-center mt-10 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Check activity tab for live status.</p>
                    )}

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}

const MdChevronDown = ({ className }: { className?: string }) => (
  <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Apple-Style Custom Date Picker ──────────────────────────────────────────

function AppleDatePicker({
  selectedDate,
  onChange,
  maxDate,
  isDark,
}: {
  selectedDate: string;
  onChange: (date: string) => void;
  maxDate: string;
  isDark: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(new Date(selectedDate));
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const handlePrevMonth = () => setViewDate(new Date(currentYear, currentMonth - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(currentYear, currentMonth + 1, 1));

  const handleSelect = (day: number) => {
    const y = currentYear;
    const m = String(currentMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    const isoString = `${y}-${m}-${d}`;

    if (maxDate && isoString > maxDate) return;

    onChange(isoString);
    setIsOpen(false);
  };

  const displayFormat = new Date(selectedDate).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold tracking-wide border transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${isDark
          ? "bg-[#2C2C2E] border-white/5 text-white hover:bg-[#3A3A3C]"
          : "bg-white border-black/5 text-black hover:bg-gray-50"
          }`}
      >
        <span>{displayFormat}</span>
        <FaCalendarAlt className={`text-[13px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
      </button>

      {/* Floating Calendar Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className={`absolute left-0 top-[calc(100%+8px)] w-[260px] p-4 rounded-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] z-50 backdrop-blur-2xl ${isDark ? "bg-[#1C1C1E]/85 border border-white/10" : "bg-white/90 border border-black/5"
              }`}
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-4 px-1">
              <span className={`font-semibold tracking-tight text-[14px] ${isDark ? "text-white" : "text-black"}`}>
                {monthNames[currentMonth]} {currentYear}
              </span>
              <div className="flex gap-1">
                <button onClick={handlePrevMonth} className={`p-1.5 rounded-full transition-colors ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"}`}>
                  <MdChevronLeft size={18} />
                </button>
                <button onClick={handleNextMonth} className={`p-1.5 rounded-full transition-colors ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"}`}>
                  <MdChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* Days Header */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map(d => (
                <div key={d} className={`text-center text-[10px] font-semibold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === new Date().toISOString().split("T")[0];
                const isDisabled = !!(maxDate && dateStr > maxDate);

                return (
                  <button
                    key={day}
                    disabled={isDisabled}
                    onClick={() => handleSelect(day)}
                    className={`
                      w-[30px] h-[30px] rounded-full flex items-center justify-center text-[13px] font-medium transition-colors mx-auto
                      ${isSelected
                        ? (isDark ? "bg-[#0A84FF] text-white font-semibold shadow-sm" : "bg-[#007AFF] text-white font-semibold shadow-sm")
                        : isDisabled
                          ? "opacity-30 cursor-not-allowed"
                          : isToday
                            ? (isDark ? "bg-white/10 text-[#0A84FF]" : "bg-black/5 text-[#007AFF]")
                            : (isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black")
                      }
                    `}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}