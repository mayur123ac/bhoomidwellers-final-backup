"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FaCheckCircle, FaClipboardList, FaCheck } from "react-icons/fa";
import { useAttendance } from "@/components/AttendanceContext";
import ColumnFilterDropdown, { FilterableColumnHeader, useColumnFilters, type FilterableColumn } from "@/components/ColumnFilterDropdown";
import { motion, AnimatePresence } from "framer-motion";
import AppleDatePicker from "@/components/AppleDatePicker";
import { computeFirstToLastSeconds, formatDurationHM } from "@/lib/attendance/sessionDuration";

/**
 * Compute the authoritative daily Working Hours from attendance timestamps.
 *
 * The metric is always: first attendance mark (login_time) → latest completion
 * (logout_time) or NOW if the day is still active.  Gaps between CRM sessions
 * are included — this is the attendance *span*, not the sum of online time.
 *
 * Falls back to session-based computation only when no attendance record exists
 * (e.g. employee is logged in but hasn't marked attendance yet).
 */
function computeAttendanceSpan(
  sessions: any[],
  now: number,
): number | null {
  if (!sessions || sessions.length === 0) return null;

  // The ar subquery is DISTINCT ON employee_id, so every session row carries
  // the same attendance_* fields. Read them from the first row.
  const row = sessions[0];
  const loginTimeStr: string | null = row?.attendance_login_time ?? null;
  const completedStr: string | null = row?.attendance_completed_at ?? null;

  if (loginTimeStr) {
    const loginMs = new Date(loginTimeStr).getTime();
    if (!isNaN(loginMs)) {
      if (completedStr) {
        // Day completed: frozen span from first mark to completion.
        // Prefer the server-computed span (avoids client-clock drift),
        // but fall back to client-side timestamp math if missing.
        const spanFromServer = row?.attendance_span_seconds;
        if (spanFromServer != null && Number(spanFromServer) >= 0) {
          return Math.floor(Number(spanFromServer));
        }
        const completedMs = new Date(completedStr).getTime();
        if (!isNaN(completedMs)) {
          const sec = Math.floor((completedMs - loginMs) / 1000);
          return sec >= 0 ? sec : null;
        }
      }
      // Day still active (no logout_time): compute client-side so the
      // live timer ticks every second instead of stalling between fetches.
      const sec = Math.floor((now - loginMs) / 1000);
      return sec >= 0 ? sec : null;
    }
  }

  // No attendance record — fall back to session-based computation.
  // This handles the "logged in but not yet marked" state.
  return computeFirstToLastSeconds(sessions, now);
}
export type ThemeTokens = Record<string, string | any>;

/** Format a timestamptz ISO string as IST time (hh:mm:ss AM/PM). */
const fmtIST = (v: string) =>
  new Date(v).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "Asia/Kolkata",
  });

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
  const [selectedDate, setSelectedDate] = useState<string>(
    // IST date, not UTC.  Between 12:00 AM and 5:30 AM IST the UTC calendar
    // day is still the previous day, so .toISOString().split("T")[0] would
    // select yesterday's sessions for the first 5.5 hours of every workday.
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  );

  const {
    markAttendanceOptimistic,
    refreshAttendance,
    isMarkedPresent: headerIsMarkedPresent,
    employeeId: headerEmployeeId,
  } = useAttendance();

  // ── Column filter / sort state ──────────────────────────────────────────────
  const {
    colFilters, colSort, openFilterCol, setOpenFilterCol,
    applyFilter, applySort, clearAllFilters, filterRows, sortRows,
  } = useColumnFilters();

  const attendanceCols: FilterableColumn[] = [
    { key: "status", label: "Status" },
    { key: "employee", label: "Employee" },
    { key: "markAttendanceTime", label: "Mark Attendance Time" },
    { key: "dayCompletedAt", label: "Day Completed At" },
    { key: "workingHours", label: "Working Hours" },
  ];

  /** Map a session row + column key to the display string used for filtering / sorting. */
  const getDisplayValue = useCallback((s: any, colKey: string): string => {
    switch (colKey) {
      case "status": {
        const st = s.attendance_status?.toLowerCase();
        if (st === "present") return "Present";
        if (st === "absent") return "Absent";
        return "Pending";
      }
      case "employee":
        return s.name || adminUser.name || "";
      case "markAttendanceTime":
        return s.attendance_marked_at ? fmtIST(s.attendance_marked_at) : "—";
      case "dayCompletedAt":
        return s.attendance_completed_at ? fmtIST(s.attendance_completed_at) : "—";
      case "workingHours": {
        const total = computeAttendanceSpan(sessions, now);
        if (total != null && total > 0) return formatDurationHM(total);
        return "—";
      }
      default:
        return "";
    }
  }, [adminUser.name, sessions, now]);

  /** Build the flat record array that the dropdown needs for unique-value extraction. */
  const buildFilterData = useCallback((rows: any[]) => {
    return rows.map(s => {
      const rec: Record<string, string> = {};
      for (const col of attendanceCols) rec[col.key] = getDisplayValue(s, col.key);
      return rec;
    });
  }, [getDisplayValue]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSessions = async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
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
              ? { ...sess, attendance_status: "Present", attendance_marked_at: data.markedAt || new Date().toISOString() }
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

  // ── Derived state ─────────────────────────────────────────────────────────

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const isFutureDate = selectedDate > todayStr;
  const isLoggedInNow = sessions.some((s) => s.session_is_active);
  const firstLogin = sessions.length > 0 ? sessions[0].session_start : null;

  const totalWorkingRaw = computeAttendanceSpan(sessions, now);
  const totalWorkingSec = totalWorkingRaw ?? 0;
  const totalH = Math.floor(totalWorkingSec / 3600);
  const totalM = Math.floor((totalWorkingSec % 3600) / 60);

  const isMarkedPresent = sessions.some(
    (s) => s.attendance_status?.toLowerCase() === "present"
  );

  // Simplified view: one summary row (attendance data is the same across all
  // sessions because the subquery uses DISTINCT ON employee_id). Pick the
  // active session if one exists, otherwise the latest.
  const displaySessions = sessions.length === 0
    ? []
    : [sessions.find((s) => s.session_is_active) || sessions[sessions.length - 1]];

  // ── Apply column filters & sort to display sessions ──
  const filteredSessions = useMemo(() => {
    let rows = filterRows(displaySessions, getDisplayValue);
    rows = sortRows(rows, getDisplayValue);
    return rows;
  }, [displaySessions, filterRows, sortRows, getDisplayValue]);

  const filterData = useMemo(() => buildFilterData(displaySessions), [displaySessions, buildFilterData]);

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

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Working hours: First Login → Final Logout (or NOW if active). */
  const getWorkingHoursDisplay = (): { text: string; isLive: boolean } => {
    // totalWorkingRaw is null when no valid session timestamps exist;
    // 0 is a legitimate (if unlikely) duration.  Show "—" only for null.
    if (totalWorkingRaw != null) {
      return { text: formatDurationHM(totalWorkingSec), isLive: isLoggedInNow && selectedDate === todayStr };
    }
    return { text: "—", isLive: false };
  };

  /** Status badge styling. */
  const statusStyle = (status: string) => {
    const st = status.toLowerCase();
    if (st === "present") return {
      label: "Present",
      cls: isDark ? "text-[#32D74B] bg-[rgba(50,215,75,0.15)]" : "text-[#34C759] bg-[#EBF9EE]",
    };
    if (st === "absent") return {
      label: "Absent",
      cls: isDark ? "text-[#FF453A] bg-[rgba(255,69,58,0.15)]" : "text-[#FF3B30] bg-[#FFECEB]",
    };
    return {
      label: "Pending",
      cls: isDark ? "text-[#FF9F0A] bg-[rgba(255,159,10,0.15)]" : "text-[#FF9500] bg-[#FFF4E5]",
    };
  };

  // ── Common cell border helper ──
  const borderCls = (isLast: boolean) =>
    !isLast ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : "";

  return (
    <div className={`font-sans antialiased w-full min-w-0 max-w-full mx-auto p-2 sm:p-0 lg:p-0 space-y-0 sm:space-y-6 ${isDark ? "bg-transparent text-white" : "bg-transparent text-black"}`}>

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
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 ${isDark ? "border-white/10" : "border-gray-200"}`}>
        <div className="flex flex-col gap-0.5">
          <h1 className={`text-base sm:text-xl font-black tracking-tight ${t.accentText}`}>
            My Attendance
          </h1>
          <p className={`text-[10px] sm:text-[11px] ${t.textFaint}`}>
            {adminUser.name} &middot; Personal tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <AppleDatePicker
            selectedDate={selectedDate}
            onChange={setSelectedDate}
            maxDate={todayStr}
            isDark={isDark}
          />
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
                  You are logged in. Use the mark action in the table below to confirm your attendance.
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
              value: totalWorkingRaw != null ? `${String(totalH).padStart(2, "0")}h ${String(totalM).padStart(2, "0")}m` : "—",
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
              className={`min-w-0 rounded-[16px] shadow-sm p-3.5 sm:p-4 flex flex-col justify-between gap-1 min-h-[85px] sm:min-h-[96px] ${isDark ? "bg-[#1C1C1E] border border-white/5 shadow-sm" : "bg-white border border-black/5 shadow-[0_2px_12px_rgba(0,0,0,0.03)]"}`}
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

        {/* ── Attendance Table ── */}
        <div className={`rounded-[18px] shadow-sm overflow-hidden border ${isDark ? "bg-[#1C1C1E] border-white/10 shadow-sm" : "bg-white border-black/5 shadow-[0_2px_16px_rgba(0,0,0,0.03)]"}`}>

          <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
            <h3 className={`text-[13px] sm:text-[14px] font-semibold tracking-tight flex items-center gap-2 ${isDark ? "text-[#9E217B]" : "text-[#9E217B]"}`}>
              <FaClipboardList className={isDark ? "text-[#9E217B]" : "text-[#9E217B]"} />
              Session Log
            </h3>
          </div>

          {/* ── Desktop table ── */}
          <div className="hidden lg:block overflow-x-auto custom-scrollbar">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr>
                  {attendanceCols.map((col) => (
                    <FilterableColumnHeader
                      key={col.key}
                      column={col}
                      isFiltered={!!colFilters[col.key]}
                      colSort={colSort}
                      isOpen={openFilterCol === col.key}
                      onToggle={() => setOpenFilterCol(openFilterCol === col.key ? null : col.key)}
                      isDark={isDark}
                      accent={isDark ? "#0A84FF" : "#007AFF"}
                      className={`px-4 py-2.5 text-[10px] sm:text-[11px] font-medium uppercase tracking-wider relative ${isDark ? "text-[#8E8E93] border-b border-[#38383A]" : "text-[#8E8E93] border-b border-[#E5E5EA]"}`}
                    >
                      {openFilterCol === col.key && (
                        <ColumnFilterDropdown
                          column={col}
                          data={filterData}
                          activeFilter={colFilters[col.key] ?? null}
                          activeSort={colSort?.key === col.key ? colSort : null}
                          onApply={(vals) => applyFilter(col.key, vals)}
                          onSort={(dir) => applySort(col.key, dir)}
                          onClose={() => setOpenFilterCol(null)}
                          isDark={isDark}
                          accent={isDark ? "#0A84FF" : "#007AFF"}
                        />
                      )}
                    </FilterableColumnHeader>
                  ))}
                </tr>
              </thead>

              <tbody>
                {isFutureDate ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-3xl opacity-50">📅</span>
                        <p className={`text-[13px] sm:text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>No Data Available</p>
                        <p className={`text-[11px] sm:text-[12px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Selected date is in the future.</p>
                      </div>
                    </td>
                  </tr>
                ) : isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center">
                      <div className="flex items-center justify-center gap-2.5">
                        <div className="w-4 h-4 rounded-full border-[2px] border-[#8E8E93] border-t-transparent animate-spin" />
                        <span className={`text-[12px] sm:text-[13px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Loading...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-3xl opacity-50">📭</span>
                        <p className={`text-[13px] sm:text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>No attendance record</p>
                        <p className={`text-[11px] sm:text-[12px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No session found for this date.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s: any, i: number) => {
                    const st = statusStyle(s.attendance_status ?? "Pending");
                    const isAlreadyMarked = s.attendance_status?.toLowerCase() === "present";
                    const isCurrentlyMarking = markingId === (s.session_id ?? s.id);
                    const isLast = i === filteredSessions.length - 1;
                    const wh = getWorkingHoursDisplay();

                    return (
                      <tr key={i} className={`transition-colors ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-black/[0.02]"}`}>
                        {/* Status */}
                        <td className={`px-4 py-3 ${borderCls(isLast)}`}>
                          {isAlreadyMarked ? (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] sm:text-[12px] font-semibold tracking-wide ${st.cls}`}>
                              <FaCheckCircle className="text-[12px]" /> {st.label}
                            </span>
                          ) : (
                            <AttendanceCheckbox
                              sessionId={s.session_id ?? s.id}
                              isMarking={isCurrentlyMarking}
                              isDark={isDark}
                              statusBadge={st}
                              onSubmit={() => handleMarkAttendance(s)}
                            />
                          )}
                        </td>

                        {/* Employee */}
                        <td className={`px-4 py-3 font-medium tracking-tight text-[12px] sm:text-[13px] ${isDark ? "text-white" : "text-black"} ${borderCls(isLast)}`}>
                          {s.name || adminUser.name}
                        </td>

                        {/* Mark Attendance Time */}
                        <td className={`px-4 py-3 text-[12px] sm:text-[13px] font-medium tracking-tight ${isDark ? "text-[#EBEBF5]" : "text-[#333333]"} ${borderCls(isLast)}`}>
                          {s.attendance_marked_at
                            ? fmtIST(s.attendance_marked_at)
                            : <span className="text-[#8E8E93]">—</span>}
                        </td>

                        {/* Day Completed At */}
                        <td className={`px-4 py-3 text-[12px] sm:text-[13px] font-medium tracking-tight ${borderCls(isLast)}`}>
                          {s.attendance_completed_at
                            ? <span className={isDark ? "text-[#EBEBF5]" : "text-[#333333]"}>{fmtIST(s.attendance_completed_at)}</span>
                            : selectedDate === todayStr && sessions.length > 0
                              ? <span className={isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}>In Progress</span>
                              : <span className="text-[#8E8E93]">—</span>}
                        </td>

                        {/* Working Hours */}
                        <td className={`px-4 py-3 font-mono text-[12px] sm:text-[13px] font-semibold tracking-tight ${borderCls(isLast)}`}>
                          <span className={wh.text === "—"
                            ? "text-[#8E8E93]"
                            : isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}>
                            {wh.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

        </div>

        {/* ── Mobile / tablet: cards ── */}
        {isFutureDate || isLoading || filteredSessions.length === 0 ? (
          <div className="lg:hidden py-10 px-4 text-center text-[12px] font-medium text-[#8E8E93]">
            {isFutureDate
              ? "Selected date is in the future."
              : isLoading
                ? "Loading..."
                : "No attendance record for this date."}
          </div>
        ) : (
          <div className={`lg:hidden divide-y ${isDark ? "divide-[#38383A]" : "divide-[#E5E5EA]"}`}>
            {filteredSessions.map((s: any, i: number) => {
              const st = statusStyle(s.attendance_status ?? "Pending");
              const isAlreadyMarked = s.attendance_status?.toLowerCase() === "present";
              const isCurrentlyMarking = markingId === (s.session_id ?? s.id);
              const wh = getWorkingHoursDisplay();

              return (
                <div key={s.session_id ?? s.id ?? i} className="relative p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[13px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                      {s.name || adminUser.name}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide ${st.cls}`}>
                      {isAlreadyMarked && <FaCheckCircle className="text-[10px]" />} {st.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field
                      label="Mark Attendance Time"
                      value={s.attendance_marked_at ? fmtIST(s.attendance_marked_at) : "—"}
                      isDark={isDark}
                    />
                    <Field
                      label="Day Completed At"
                      value={s.attendance_completed_at
                        ? fmtIST(s.attendance_completed_at)
                        : selectedDate === todayStr && sessions.length > 0
                          ? "In Progress"
                          : "—"}
                      isDark={isDark}
                      valueClass={!s.attendance_completed_at && selectedDate === todayStr && sessions.length > 0
                        ? (isDark ? "text-[#0A84FF]" : "text-[#007AFF]")
                        : undefined}
                    />
                    <Field
                      label="Working Hours"
                      value={wh.text}
                      isDark={isDark}
                      mono
                      valueClass={wh.text !== "—" ? (isDark ? "text-[#0A84FF]" : "text-[#007AFF]") : undefined}
                    />
                  </div>

                  {!isAlreadyMarked && (
                    <div className="pt-1">
                      <AttendanceCheckbox
                        sessionId={s.session_id ?? s.id}
                        isMarking={isCurrentlyMarking}
                        isDark={isDark}
                        statusBadge={st}
                        onSubmit={() => handleMarkAttendance(s)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className={`text-[11px] text-center font-medium leading-relaxed pb-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
          Attendance data is sourced automatically from the CRM session tracker.
        </p>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  value,
  isDark,
  mono,
  valueClass,
}: {
  label: string;
  value: string;
  isDark: boolean;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[#8E8E93]">{label}</p>
      <p
        className={`mt-0.5 text-[13px] font-medium tracking-tight truncate ${mono ? "font-mono" : ""} ${valueClass ?? (isDark ? "text-[#EBEBF5]" : "text-[#333333]")
          }`}
      >
        {value}
      </p>
    </div>
  );
}

function AttendanceCheckbox({
  sessionId,
  isMarking,
  isDark,
  statusBadge,
  onSubmit,
}: {
  sessionId: any;
  isMarking: boolean;
  isDark: boolean;
  statusBadge: { label: string; cls: string };
  onSubmit: () => void;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 cursor-pointer select-none group">
        <div
          onClick={() => !isMarking && setChecked((p) => !p)}
          className={`w-[22px] h-[22px] sm:w-[18px] sm:h-[18px] rounded-full border-[1.5px] flex items-center justify-center transition-all duration-200 ${checked
            ? isDark ? "bg-[#0A84FF] border-[#0A84FF]" : "bg-[#007AFF] border-[#007AFF]"
            : isDark ? "border-[#8E8E93] bg-transparent group-hover:border-[#0A84FF]" : "border-[#C7C7CC] bg-white group-hover:border-[#007AFF]"
            }`}
        >
          {checked && <FaCheck className="text-white text-[8px]" />}
        </div>
        <span className={`text-[12px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}>
          Mark Present
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
