"use client";
import React, { useState, useEffect } from "react";
import { useShiftTiming } from "@/hooks/useShiftTiming";
import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import { FaClock, FaCalendarAlt, FaCheckCircle, FaTimesCircle, FaMapMarkerAlt, FaFileExcel, FaTimes, FaCog, FaClipboardList, FaCheck } from "react-icons/fa";

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
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );

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

      // Use my-sessions endpoint which returns ALL sessions for the day (not just latest)
      // This ensures the Live Timer accumulates across login/logout cycles
      const res = await fetch(`/api/attendance/my-sessions?date=${selectedDate}`, { cache: "no-store" });

      if (!res.ok) {
        // Fallback: try the live endpoint and filter by user
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

      // my-sessions already filters by current user — but double-check for safety
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

  // Auto-refresh every 30s so live timer and status stay fresh
  useEffect(() => {
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  // ── Mark attendance (checkbox → submit) ────────────────────────────────────
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
        // Optimistically update local state — no full refetch needed
        setSessions((prev) =>
          prev.map((sess) =>
            (sess.session_id ?? sess.id) === (s.session_id ?? s.id)
              ? { ...sess, attendance_status: "Present" }
              : sess
          )
        );
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

  /**
   * Returns the duration of a SINGLE session as a string.
   * For completed sessions: session_end - session_start
   * For the active session: now - session_start
   */
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

  /**
   * Returns the CUMULATIVE total working time across ALL sessions today.
   * This is what the blue "Live Timer" column shows for the active session row.
   * Formula: sum(all completed session durations) + current active session elapsed
   */
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

  const getWorkingHoursFormatted = (start: string, end: string, isActive: boolean) => {
    if (!start) return "—";
    const startTime = new Date(start).getTime();
    const endTime = isActive ? now : end ? new Date(end).getTime() : startTime;
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
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
        style: isDark
          ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
          : "text-blue-600 bg-blue-50 border-blue-200",
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
        style: isDark
          ? "text-red-400 bg-red-500/10 border-red-500/20"
          : "text-red-600 bg-red-50 border-red-200",
      };
    if (diffMinutes < -2)
      return {
        label: `Early ${formatPunctualityDiff(diffMinutes)}`,
        style: isDark
          ? "text-green-400 bg-green-500/10 border-green-500/20"
          : "text-green-600 bg-green-50 border-green-200",
      };
    return {
      label: "On Time 🎯",
      style: isDark
        ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
        : "text-blue-600 bg-blue-50 border-blue-200",
    };
  };

  // ── Summary stats ────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const isFutureDate = selectedDate > todayStr;
  const isLoggedInNow = sessions.some((s) => s.session_is_active);
  const firstLogin = sessions.length > 0 ? sessions[0].session_start : null;

  // Total working = sum of ALL sessions (completed + active ticking live)
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

  return (
    <div className="animate-fadeIn space-y-6">
      {/* ── Toast ── */}
      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-fadeIn border text-white text-sm font-bold ${toast.ok ? "bg-green-600 border-green-400" : "bg-red-600 border-red-400"
            }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-bold flex items-center gap-3 ${t.text}`}>
            <FaClock className={t.accentText} /> My Attendance
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 ${t.textFaint}`}>
            {adminUser.name} — personal attendance tracker
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 relative z-[10]">
          <input
            type="date"
            value={selectedDate}
            max={todayStr}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={`px-3 py-2 rounded-lg text-xs font-bold focus:outline-none border ${t.inputInner} ${t.text}`}
          />

          <div
            className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 border ${t.card} ${t.text}`}
          >
            <span className="text-[10px]">Shift time</span>
            {workingHours.flexible
              ? "Flexible"
              : `${workingHours.loginTime} – ${workingHours.logoutTime}`}
          </div>
        </div>
      </div>

      {/* ── "Mark Present" banner — shown when logged in today but not yet marked ── */}
      {selectedDate === todayStr && isLoggedInNow && !isMarkedPresent && sessions.length > 0 && (
        <div
          className={`rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${isDark
            ? "bg-[#9E217B]/10 border-[#9E217B]/30"
            : "bg-pink-50 border-pink-200"
            }`}
        >
          <div>
            <p className={`font-bold text-sm flex items-center gap-2 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
              📋 Mark Today's Attendance
            </p>
            <p className={`text-xs mt-0.5 ${t.textFaint}`}>
              You are logged in. Check the box in the table row and click Submit to confirm your attendance.
            </p>
          </div>
          <span
            className={`text-[10px] font-black uppercase px-3 py-1 rounded-full border animate-pulse ${isDark
              ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
              : "text-amber-600 bg-amber-50 border-amber-300"
              }`}
          >
            Pending
          </span>
        </div>
      )}

      {/* ── Already marked banner ── */}
      {isMarkedPresent && (
        <div
          className={`rounded-xl border p-4 flex items-center gap-3 ${isDark
            ? "bg-green-500/10 border-green-500/30"
            : "bg-green-50 border-green-200"
            }`}
        >
          <FaCheckCircle className="text-green-500 text-lg flex-shrink-0" />
          <div>
            <p className="font-bold text-sm text-green-500">Attendance Marked Present</p>
            <p className={`text-xs mt-0.5 ${t.textFaint}`}>
              Your attendance for today is confirmed. Admin can see this in Live Activity.
            </p>
          </div>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "Status Today",
            value: isLoggedInNow ? "🟢 Online" : sessions.length > 0 ? "⚪ Logged Out" : "—",
            color: isLoggedInNow ? "text-green-500" : t.textMuted,
            glow: t.statGlow5,
          },
          {
            label: "First Login",
            value: firstLogin
              ? new Date(firstLogin).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
              : "—",
            color: t.text,
            glow: t.statGlow1,
          },
          {
            label: "Total Working",
            value: sessions.length > 0 ? `${String(totalH).padStart(2, "0")}h ${String(totalM).padStart(2, "0")}m` : "—",
            color: isDark ? "text-blue-400" : "text-[#9E217B]",
            glow: t.statGlow3,
          },
          {
            label: "Attendance",
            value: isMarkedPresent ? "✅ Present" : sessions.length > 0 ? "⏳ Pending" : "—",
            color: isMarkedPresent ? "text-green-500" : isDark ? "text-yellow-400" : "text-amber-500",
            glow: t.statGlow4,
          },
        ].map((card, i) => (
          <div
            key={i}
            className={`rounded-2xl p-4 border relative overflow-hidden ${t.card}`}
            style={t.cardGlass}
          >
            <div className={`absolute -right-4 -top-4 w-16 h-16 rounded-full blur-xl pointer-events-none ${card.glow}`} />
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${t.textFaint}`}>{card.label}</p>
            <p className={`text-sm font-black ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* ── Cumulative Live Timer Banner (shown only when active session exists) ── */}
      {isLoggedInNow && selectedDate === todayStr && sessions.length > 1 && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${isDark ? "bg-[#00AEEF]/5 border-[#00AEEF]/20" : "bg-blue-50 border-blue-200"}`}>
          <FaClock className="text-[#00AEEF] flex-shrink-0" />
          <div className="flex-1">
            <p className={`text-xs font-bold ${isDark ? "text-[#00AEEF]" : "text-blue-700"}`}>
              Cumulative Timer — {sessions.length} session{sessions.length !== 1 ? "s" : ""} today
            </p>
            <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>
              Timer accumulates across all login/logout cycles. Your total today is shown in the Live Timer column.
            </p>
          </div>
          <span className="font-mono font-black text-[#00AEEF] text-sm">{getCumulativeLiveTimer()}</span>
        </div>
      )}

      {/* ── Attendance Table ── */}
      <div className={`rounded-2xl border overflow-hidden ${t.tableWrap}`} style={t.tableGlass}>
        <div className={`p-4 border-b flex items-center justify-between ${t.tableBorder} ${t.modalHeader}`}>
          <h3 className={`font-bold flex items-center gap-2 text-sm ${t.text}`}>
            <FaClipboardList className={t.accentText} /> Attendance Log —{" "}
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </h3>
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${t.btnClosingBadge}`}>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs sm:text-sm whitespace-nowrap">
            <thead className={`${t.tableHead} ${t.textHeader}`}>
              <tr>
                {[
                  "Status",
                  "Employee",
                  "Login Date",
                  "Login Time",
                  "Punctuality",
                  "Logout Time",
                  "Logged Time",
                  "Total Working Hour",
                  "Attendance",
                ].map((h) => (
                  <th
                    key={h}
                    className={`px-4 py-3 font-bold uppercase tracking-wider border-b text-xs ${t.tableBorder}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className={`divide-y ${t.tableDivide}`}>
              {isFutureDate ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-4xl">📅</span>
                      <p className={`text-sm font-bold ${t.text}`}>No Data Available</p>
                      <p className={`text-xs ${t.textFaint}`}>Selected date is in the future.</p>
                    </div>
                  </td>
                </tr>
              ) : isLoading ? (
                <tr>
                  <td colSpan={10} className={`py-10 text-center text-sm ${t.textMuted}`}>
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-[#9E217B] border-t-transparent animate-spin" />
                      Loading attendance data...
                    </div>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-4xl">📭</span>
                      <p className={`text-sm font-bold ${t.text}`}>No sessions found</p>
                      <p className={`text-xs ${t.textFaint}`}>
                        No login recorded for this date. Make sure the CRM session tracker is active.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sessions.map((s: any, i: number) => {
                  const punct = getPunctualityInfo(s.session_start);
                  const isActive = !!s.session_is_active;
                  const isAlreadyMarked = s.attendance_status?.toLowerCase() === "present";
                  const isCurrentlyMarking =
                    markingId === (s.session_id ?? s.id);

                  return (
                    <tr
                      key={i}
                      className={`transition-colors ${isAlreadyMarked
                        ? isDark
                          ? "bg-green-500/5"
                          : "bg-green-50/60"
                        : t.tableRow
                        }`}
                    >
                      {/* Status */}
                      <td className={`px-4 py-3 border-b relative ${t.tableBorder}`}>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                        )}
                        <span className={`font-black text-xs ${isActive ? "text-green-500" : t.textMuted}`}>
                          {isActive ? "🟢 ACTIVE" : s.session_end ? "⚪ OFFLINE" : "🟡 IDLE"}
                        </span>
                      </td>

                      {/* Employee */}
                      <td className={`px-4 py-3 border-b font-bold ${t.text} ${t.tableBorder}`}>
                        {s.name || adminUser.name}
                      </td>

                      {/* Login Date */}
                      <td className={`px-4 py-3 border-b ${t.textMuted} ${t.tableBorder}`}>
                        {new Date(s.session_start).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                      </td>

                      {/* Login Time */}
                      <td className={`px-4 py-3 border-b font-mono ${t.textMuted} ${t.tableBorder}`}>
                        {new Date(s.session_start).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>

                      {/* Punctuality */}
                      <td className={`px-4 py-3 border-b ${t.tableBorder}`}>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black border whitespace-nowrap ${punct.style}`}>
                          {punct.label}
                        </span>
                      </td>

                      {/* Logout Time */}
                      <td className={`px-4 py-3 border-b font-bold ${isActive ? "text-green-500" : t.textMuted} ${t.tableBorder}`}>
                        {isActive
                          ? "Active Session"
                          : s.session_end
                            ? new Date(s.session_end).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                            : "N/A"}
                      </td>

                      {/* Session Duration — individual session only */}
                      <td className={`px-4 py-3 border-b font-mono ${t.textMuted} ${t.tableBorder}`}>
                        {getSessionDuration(s.session_start, s.session_end, isActive)}
                      </td>

                      {/* Live Timer (Cumulative Total) — ticks every second on active row */}
                      <td className={`px-4 py-3 border-b font-mono font-black ${t.tableBorder}`}>
                        {isActive ? (
                          <span className="text-[#00AEEF]" title="Total working time today across all sessions">
                            {getCumulativeLiveTimer()}
                          </span>
                        ) : (
                          <span className={t.textFaint}>
                            {getSessionDuration(s.session_start, s.session_end, false)}
                          </span>
                        )}
                      </td>


                      {/* Attendance — checkbox + submit */}
                      <td className={`px-4 py-3 border-b ${t.tableBorder}`}>
                        {isAlreadyMarked ? (
                          <span className="flex items-center gap-1.5 text-green-500 font-black text-xs">
                            <FaCheckCircle className="text-base" /> Present
                          </span>
                        ) : (
                          <AttendanceCheckbox
                            sessionId={s.session_id ?? s.id}
                            isMarking={isCurrentlyMarking}
                            isDark={isDark}
                            t={t}
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

      <p className={`text-[10px] text-center ${t.textFaint}`}>
        ℹ️ Attendance data is sourced from the CRM session tracker. The blue Live Timer shows your cumulative working time today across all sessions. Contact admin if any session appears missing.
      </p>
    </div>
  );
}

function AttendanceCheckbox({
  sessionId,
  isMarking,
  isDark,
  t,
  onSubmit,
}: {
  sessionId: any;
  isMarking: boolean;
  isDark: boolean;
  t: any;
  onSubmit: () => void;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <div
          onClick={() => !isMarking && setChecked((p) => !p)}
          className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${checked
            ? isDark
              ? "bg-[#9E217B] border-[#9E217B]"
              : "bg-[#9E217B] border-[#9E217B]"
            : isDark
              ? "border-gray-500 bg-transparent hover:border-[#9E217B]"
              : "border-gray-300 bg-white hover:border-[#9E217B]"
            }`}
        >
          {checked && <FaCheck className="text-white text-[8px]" />}
        </div>
        <span className={`text-[11px] font-semibold ${t.textMuted}`}>Present</span>
      </label>

      {checked && (
        <button
          onClick={onSubmit}
          disabled={isMarking}
          className={`text-[10px] font-black px-2.5 py-1 rounded-lg cursor-pointer transition-all flex items-center gap-1 ${isMarking
            ? "opacity-60 cursor-not-allowed bg-gray-400 text-white"
            : isDark
              ? "bg-[#9E217B] hover:bg-[#b8268f] text-white shadow-md shadow-[#9E217B]/20"
              : "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-sm"
            }`}
        >
          {isMarking ? (
            <div className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin" />
          ) : (
            <FaCheck className="text-[8px]" />
          )}
          {isMarking ? "Saving..." : "Submit"}
        </button>
      )}
    </div>
  );
}