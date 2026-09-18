"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useShiftTiming } from "@/hooks/useShiftTiming";
import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import { FaClock, FaCalendarAlt, FaCheckCircle, FaTimesCircle, FaMapMarkerAlt, FaFileExcel, FaTimes, FaCog, FaClipboardList, FaCheck } from "react-icons/fa";
import { useAttendance } from "@/components/AttendanceContext";
import { motion, AnimatePresence } from "framer-motion";
import AppleDatePicker from "@/components/AppleDatePicker";
export type ThemeTokens = Record<string, string | any>;

export default function AttendanceView({
  adminUser,
  isDark,
  t,
  now,
}: {
  adminUser: any;
  isDark: boolean;
  t: ThemeTokens;
  now: number;
}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );

  const {
    markAttendanceOptimistic,
    refreshAttendance,
    isMarkedPresent: headerIsMarkedPresent,
    employeeId: headerEmployeeId,
  } = useAttendance();

  // Real-time Centralized Shift Timing
  const { timing: workingHours } = useShiftTiming();

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSessions = async () => {
    const today = new Date().toISOString().split("T")[0];
    if (selectedDate > today) {
      setSessions([]);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);

      const res = await fetch(`/api/attendance/my-sessions?date=${selectedDate}`, { cache: "no-store" });

      if (!res.ok) {
        const fallbackRes = await fetch(`/api/attendance/live?date=${selectedDate}`, { cache: "no-store" });
        if (!fallbackRes.ok) throw new Error("Failed to fetch sessions");
        const fallbackData = await fallbackRes.json();
        const allSessions: any[] = fallbackData.sessions || [];
        const mine = allSessions.filter(
          (s: any) =>
            (s.name && s.name.trim().toLowerCase() === adminUser.name.trim().toLowerCase()) ||
            (s.email && adminUser.email && s.email.trim().toLowerCase() === adminUser.email.trim().toLowerCase())
        );
        setSessions(mine);
        return;
      }

      const data = await res.json();
      const allSessions: any[] = data.sessions || [];

      const mine =
        allSessions.length > 0 &&
          allSessions[0].name !== undefined
          ? allSessions.filter(
            (s: any) =>
              (s.name && s.name.trim().toLowerCase() === adminUser.name.trim().toLowerCase()) ||
              (s.email && adminUser.email && s.email.trim().toLowerCase() === adminUser.email.trim().toLowerCase())
          )
          : allSessions;

      setSessions(mine);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [selectedDate, adminUser.name, adminUser.email]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchSessions();
    }, 30000);
    const onVisible = () => { if (!document.hidden) fetchSessions(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selectedDate]);

  const handleMarkAttendance = async (s: any) => {
    if (markingId) return;
    setMarkingId(s.session_id ?? s.id);
    try {
      const res = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: s.session_id ?? s.id,
          user_id: s.user_id,
        }),
      });
      if (!res.ok) { showToast("❌ Failed to update presence", false); return; }
      const data = await res.json();
      if (data.success) {
        showToast("✅ Attendance marked as Present!", true);
        markAttendanceOptimistic(data.timeIn || new Date().toISOString());
        setSessions((prev) =>
          prev.map((sess) =>
            (sess.session_id ?? sess.id) === (s.session_id ?? s.id)
              ? { ...sess, attendance_status: "Present" }
              : sess
          )
        );
        await refreshAttendance();
        window.dispatchEvent(new Event("attendance-marked"));
      } else {
        showToast("❌ " + (data.message || "Failed to mark attendance"), false);
      }
    } catch {
      showToast("❌ Network error. Please try again.", false);
    } finally {
      setMarkingId(null);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const getSessionDuration = (start: string, end: string, isActive: boolean) => {
    if (!start) return "—";
    const startTime = new Date(start).getTime();
    const endTime = isActive ? now : end ? new Date(end).getTime() : startTime;
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const sec = diff % 60;
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  };

  const getCumulativeLiveTimer = () => {
    let totalMs = 0;
    for (const s of sessions) {
      const startTime = new Date(s.session_start).getTime();
      const endTime = s.session_is_active
        ? now
        : s.session_end
          ? new Date(s.session_end).getTime()
          : startTime;
      totalMs += Math.max(0, endTime - startTime);
    }
    const totalSec = Math.floor(totalMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  };

  const formatPunctualityDiff = (diffMinutes: number): string => {
    const abs = Math.abs(diffMinutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const getPunctualityInfo = (sessionStart: string) => {
    if (workingHours.flexible)
      return {
        label: "Flexible",
        style: isDark ? "text-[#0A84FF] bg-[rgba(10,132,255,0.15)]" : "text-[#007AFF] bg-[#E5F1FF]",
      };

    const loginDate = new Date(sessionStart);
    const [configH, configM] = workingHours.loginTime.split(":").map(Number);
    const expected = new Date(loginDate);
    expected.setHours(configH, configM, 0, 0);
    const diffMinutes = Math.round(
      (loginDate.getTime() - expected.getTime()) / 60000
    );

    if (diffMinutes > 2)
      return {
        label: `Late ${formatPunctualityDiff(diffMinutes)}`,
        style: isDark ? "text-[#FF453A] bg-[rgba(255,69,58,0.15)]" : "text-[#FF3B30] bg-[#FFECEB]",
      };
    if (diffMinutes < -2)
      return {
        label: `Early ${formatPunctualityDiff(diffMinutes)}`,
        style: isDark ? "text-[#32D74B] bg-[rgba(50,215,75,0.15)]" : "text-[#34C759] bg-[#EBF9EE]",
      };
    return {
      label: "On Time",
      style: isDark ? "text-[#0A84FF] bg-[rgba(10,132,255,0.15)]" : "text-[#007AFF] bg-[#E5F1FF]",
    };
  };

  const todayStr = new Date().toISOString().split("T")[0];
  const isFutureDate = selectedDate > todayStr;
  const isLoggedInNow = sessions.some((s) => s.session_is_active);
  const firstLogin = sessions.length > 0 ? sessions[0].session_start : null;

  const totalWorkingMs = sessions.reduce((acc, s) => {
    const start = new Date(s.session_start).getTime();
    const end = s.session_is_active
      ? now
      : s.session_end
        ? new Date(s.session_end).getTime()
        : start;
    return acc + Math.max(0, end - start);
  }, 0);
  const totalH = Math.floor(totalWorkingMs / 3600000);
  const totalM = Math.floor((totalWorkingMs % 3600000) / 60000);

  const isMarkedPresent = sessions.some(
    (s) => s.attendance_status?.toLowerCase() === "present"
  );

  const displaySessions = showHistory
    ? sessions
    : sessions.length <= 1
      ? sessions
      : (() => {
        const active = sessions.find((s) => s.session_is_active);
        return active ? [active] : [sessions[sessions.length - 1]];
      })();

  useEffect(() => {
    if (selectedDate !== todayStr) return;
    console.table({
      "Attendance page (my-sessions)": {
        isMarkedPresent,
        source: sessions.find((s) => s.attendance_status?.toLowerCase() === "present")?.attendance_status ?? "—",
        userId: sessions[0]?.user_id ?? "—",
      },
      "Header badge (shared context)": {
        isMarkedPresent: headerIsMarkedPresent,
        source: "GET /api/attendance/status",
        userId: headerEmployeeId ?? "—",
      },
    });
  }, [isMarkedPresent, headerIsMarkedPresent, headerEmployeeId, selectedDate, todayStr, sessions]);

  return (
    <div className={`font-sans antialiased max-w-[1400px] mx-auto space-y-4 sm:space-y-6 ${isDark ? "bg-transparent text-white" : "bg-transparent text-black"}`}>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -15, scale: 0.95 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-full shadow-[0_4px_24px_rgba(0,0,0,0.12)] flex items-center gap-2.5 backdrop-blur-xl text-white text-[12px] font-medium tracking-wide ${toast.ok ? "bg-[#34C759]/90 border border-white/20" : "bg-[#FF3B30]/90 border border-white/20"
              }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Compact Apple-Style Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-gray-200 dark:border-white/10">
        <div className="flex flex-col gap-0.5">
          <h1 className={`text-xl sm:text-[22px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
            My Attendance
          </h1>
          <p className={`text-[12px] sm:text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
            {adminUser.name} &middot; Personal tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <AppleDatePicker
            selectedDate={selectedDate}
            onChange={setSelectedDate}
            maxDate={todayStr}
            isDark={isDark}
          />
          <div className={`px-3 py-1.5 rounded-md text-[12px] font-medium tracking-wide flex items-center gap-1.5 border ${isDark ? "bg-[#1C1C1E] border-white/10 text-[#EBEBF5]" : "bg-white border-gray-200 text-[#333333] shadow-sm"
            }`}>
            <span className="text-[#8E8E93] text-[10px] uppercase tracking-wider">Shift</span>
            {workingHours.flexible ? "Flexible" : `${workingHours.loginTime} – ${workingHours.logoutTime}`}
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-4 sm:space-y-5"
      >
        {/* ── Pending Mark Attendance Banner ── */}
        <AnimatePresence>
          {selectedDate === todayStr && isLoggedInNow && !isMarkedPresent && sessions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className={`rounded-[14px] p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${isDark ? "bg-[rgba(255,159,10,0.15)] border border-[rgba(255,159,10,0.2)]" : "bg-[#FFF4E5] border border-[#FFE0B2]"
                }`}
            >
              <div>
                <p className={`text-[13px] sm:text-[14px] font-semibold flex items-center gap-1.5 tracking-tight ${isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}`}>
                  Mark Today's Attendance
                </p>
                <p className={`text-[11px] sm:text-[12px] mt-0.5 ${isDark ? "text-[#EBEBF5]/60" : "text-[#8E8E93]"}`}>
                  You are logged in. Select the checkbox in the active session below and submit to confirm.
                </p>
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full animate-pulse flex-shrink-0 ${isDark ? "text-[#FF9F0A] bg-[rgba(255,159,10,0.2)]" : "text-[#FF9500] bg-[#FFE0B2]"
                }`}>
                Action Required
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Already Marked Banner ── */}
        <AnimatePresence>
          {isMarkedPresent && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`rounded-[14px] p-3 sm:p-4 flex items-center gap-3 ${isDark ? "bg-[rgba(50,215,75,0.15)] border border-[rgba(50,215,75,0.2)]" : "bg-[#EBF9EE] border border-[#C6F0D4]"
                }`}
            >
              <FaCheckCircle className={`text-[18px] flex-shrink-0 ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`} />
              <div>
                <p className={`text-[13px] sm:text-[14px] font-semibold tracking-tight ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>
                  Attendance Confirmed
                </p>
                <p className={`text-[11px] sm:text-[12px] mt-0.5 ${isDark ? "text-[#EBEBF5]/60" : "text-[#8E8E93]"}`}>
                  Your attendance for today is marked. Administrators can view this in Live Activity.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Scaled-Down KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            {
              label: "Status Today",
              value: isLoggedInNow ? "Online" : sessions.length > 0 ? "Logged Out" : "—",
              color: isLoggedInNow ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"),
            },
            {
              label: "First Login",
              value: firstLogin ? new Date(firstLogin).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—",
              color: isDark ? "text-white" : "text-black",
            },
            {
              label: "Total Working",
              value: sessions.length > 0 ? `${String(totalH).padStart(2, "0")}h ${String(totalM).padStart(2, "0")}m` : "—",
              color: isDark ? "text-[#0A84FF]" : "text-[#007AFF]",
            },
            {
              label: "Attendance",
              value: isMarkedPresent ? "Present" : sessions.length > 0 ? "Pending" : "—",
              color: isMarkedPresent ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : isDark ? "text-[#FF9F0A]" : "text-[#FF9500]",
            },
          ].map((card, i) => (
            <div
              key={i}
              className={`rounded-[16px] p-3.5 sm:p-4  flex flex-col justify-between h-[85px] sm:h-[96px] ${isDark ? "bg-[#1C1C1E] border border-white/5 shadow-sm" : "bg-white border border-black/5 shadow-[0_2px_12px_rgba(0,0,0,0.03)]"
                }`}
            >
              <p className={`text-[10px] sm:text-[11px] font-medium uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                {card.label}
              </p>
              <p className={`text-lg sm:text-[20px] font-semibold tracking-tight ${card.color}`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Cumulative Timer Banner ── */}
        <AnimatePresence>
          {isLoggedInNow && selectedDate === todayStr && sessions.length > 1 && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className={`rounded-[14px] p-3 sm:p-4 flex items-center gap-3 ${isDark ? "bg-[rgba(10,132,255,0.15)] border border-[rgba(10,132,255,0.2)]" : "bg-[#E5F1FF] border border-[#BCE0FD]"}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>
                <FaClock className="text-white text-sm" />
              </div>
              <div className="flex-1">
                <p className={`text-[12px] sm:text-[13px] font-semibold tracking-tight ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>
                  Cumulative Timer ({sessions.length} sessions today)
                </p>
                <p className={`text-[10px] sm:text-[11px] mt-0.5 ${isDark ? "text-[#EBEBF5]/60" : "text-[#8E8E93]"}`}>
                  Time accumulates across all cycles. Total shown in the table below.
                </p>
              </div>
              <span className={`font-mono text-sm sm:text-base font-bold tracking-tight ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>
                {getCumulativeLiveTimer()}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Attendance List ── */}
        <div className={`rounded-[18px] overflow-hidden border ${isDark ? "bg-[#1C1C1E] border-white/10 shadow-sm" : "bg-white border-black/5 shadow-[0_2px_16px_rgba(0,0,0,0.03)]"}`}>

          <div className={`px-4 py-3 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
            <h3 className={`text-[13px] sm:text-[14px] font-semibold tracking-tight flex items-center gap-2 ${isDark ? "text-[#9E217B]" : "text-[#9E217B]"}`}>
              <FaClipboardList className={isDark ? "text-[#9E217B]" : "text-[#9E217B]"} />
              Session Log
            </h3>
            <div className="flex items-center gap-3">
              {sessions.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] sm:text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Show History</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showHistory}
                    onClick={() => setShowHistory((p) => !p)}
                    className={`relative w-[36px] h-[22px] rounded-full transition-colors duration-200 ease-in-out ${showHistory ? (isDark ? "bg-[#32D74B]" : "bg-[#34C759]") : (isDark ? "bg-[#3A3A3C]" : "bg-[#E5E5EA]")
                      }`}
                  >
                    <span
                      className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${showHistory ? "translate-x-[14px]" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              )}
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md ${isDark ? "bg-[#2C2C2E] text-[#8E8E93]" : "bg-[#F2F2F7] text-[#8E8E93]"}`}>
                {sessions.length} Session{sessions.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr>
                  {["Status", "Employee", "Login Time", "Punctuality", "Logout Time", "Logged Time", "Working Hour", "Attendance"].map((h) => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] sm:text-[11px] font-medium uppercase tracking-wider ${isDark ? "text-[#8E8E93] border-b border-[#38383A]" : "text-[#8E8E93] border-b border-[#E5E5EA]"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {isFutureDate ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-3xl opacity-50">📅</span>
                        <p className={`text-[13px] sm:text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>No Data Available</p>
                        <p className={`text-[11px] sm:text-[12px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Selected date is in the future.</p>
                      </div>
                    </td>
                  </tr>
                ) : isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center">
                      <div className="flex items-center justify-center gap-2.5">
                        <div className="w-4 h-4 rounded-full border-[2px] border-[#8E8E93] border-t-transparent animate-spin" />
                        <span className={`text-[12px] sm:text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Loading sessions...</span>
                      </div>
                    </td>
                  </tr>
                ) : displaySessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-3xl opacity-50">📭</span>
                        <p className={`text-[13px] sm:text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>No sessions found</p>
                        <p className={`text-[11px] sm:text-[12px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Make sure the CRM session tracker is active.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displaySessions.map((s: any, i: number) => {
                    const punct = getPunctualityInfo(s.session_start);
                    const isActive = !!s.session_is_active;
                    const isAlreadyMarked = s.attendance_status?.toLowerCase() === "present";
                    const isCurrentlyMarking = markingId === (s.session_id ?? s.id);
                    const isLast = i === displaySessions.length - 1;

                    return (
                      <tr key={i} className={`transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]`}>
                        <td className={`px-4 py-3 relative ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {isActive && <div className={`absolute left-0 top-1/2 -translate-y-1/2 h-2/3 w-[3px] rounded-r-full ${isDark ? "bg-[#32D74B]" : "bg-[#34C759]"}`} />}
                          <span className={`font-medium tracking-tight text-[12px] sm:text-[13px] ${isActive ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]")}`}>
                            {isActive ? "Active" : s.session_end ? "Offline" : "Idle"}
                          </span>
                        </td>

                        <td className={`px-4 py-3 font-medium tracking-tight text-[12px] sm:text-[13px] ${isDark ? "text-white" : "text-black"} ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {s.name || adminUser.name}
                        </td>

                        <td className={`px-4 py-3 text-[12px] sm:text-[13px] font-medium tracking-tight ${isDark ? "text-[#EBEBF5]" : "text-[#333333]"} ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {new Date(s.session_start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                        </td>

                        <td className={`px-4 py-3 ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-semibold tracking-wide ${punct.style}`}>
                            {punct.label}
                          </span>
                        </td>

                        <td className={`px-4 py-3 text-[12px] sm:text-[13px] font-medium tracking-tight ${isActive ? (isDark ? "text-[#32D74B]" : "text-[#34C759]") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]")} ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {isActive ? "Active Session" : s.session_end ? new Date(s.session_end).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "N/A"}
                        </td>

                        <td className={`px-4 py-3 font-mono text-[12px] sm:text-[13px] tracking-tight ${isDark ? "text-[#EBEBF5]" : "text-[#333333]"} ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {getSessionDuration(s.session_start, s.session_end, isActive)}
                        </td>

                        <td className={`px-4 py-3 font-mono text-[12px] sm:text-[13px] font-semibold tracking-tight ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"} ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {i === 0 && s.attendance_working_track != null ? (
                            (() => {
                              const sec = Number(s.attendance_working_track);
                              const h = Math.floor(sec / 3600);
                              const m = Math.floor((sec % 3600) / 60);
                              return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
                            })()
                          ) : (
                            <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>—</span>
                          )}
                        </td>

                        <td className={`px-4 py-3 ${!isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          {isAlreadyMarked ? (
                            <span className={`flex items-center gap-1.5 text-[12px] sm:text-[13px] font-semibold tracking-tight ${isDark ? "text-[#32D74B]" : "text-[#34C759]"}`}>
                              <FaCheckCircle className="text-[14px]" /> Confirmed
                            </span>
                          ) : (
                            <AttendanceCheckbox
                              sessionId={s.session_id ?? s.id}
                              isMarking={isCurrentlyMarking}
                              isDark={isDark}
                              onSubmit={() => handleMarkAttendance(s)}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className={`text-[11px] text-center font-medium leading-relaxed pb-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
          Attendance data is sourced automatically from the CRM session tracker.
          <br className="hidden sm:block" /> The cumulative live timer displays total working time today across all sessions.
        </p>
      </motion.div>
    </div>
  );
}

function AttendanceCheckbox({
  sessionId,
  isMarking,
  isDark,
  onSubmit,
}: {
  sessionId: any;
  isMarking: boolean;
  isDark: boolean;
  onSubmit: () => void;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 cursor-pointer select-none group">
        <div
          onClick={() => !isMarking && setChecked((p) => !p)}
          className={`w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center transition-all duration-200 ${checked
            ? isDark ? "bg-[#0A84FF] border-[#0A84FF]" : "bg-[#007AFF] border-[#007AFF]"
            : isDark ? "border-[#8E8E93] bg-transparent group-hover:border-[#0A84FF]" : "border-[#C7C7CC] bg-white group-hover:border-[#007AFF]"
            }`}
        >
          {checked && <FaCheck className="text-white text-[8px]" />}
        </div>
        <span className={`text-[12px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}>
          Present
        </span>
      </label>

      <AnimatePresence>
        {checked && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, x: -5 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -5 }}
            onClick={onSubmit}
            disabled={isMarking}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold tracking-wide flex items-center gap-1.5 transition-all ${isMarking
              ? "opacity-60 cursor-not-allowed bg-[#8E8E93] text-white"
              : isDark
                ? "bg-[#0A84FF] hover:bg-[#007AFF] text-white"
                : "bg-[#007AFF] hover:bg-[#005bb5] text-white"
              }`}
          >
            {isMarking ? (
              <div className="w-3 h-3 rounded-full border-[2px] border-white/30 border-t-white animate-spin" />
            ) : (
              "Submit"
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}