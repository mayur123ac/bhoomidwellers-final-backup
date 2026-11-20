"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAttendance } from "@/components/AttendanceContext";
import { computeFirstToLastSeconds, formatDurationHM } from "@/lib/attendance/sessionDuration";
import { motion, AnimatePresence } from "framer-motion";

/* ─── Types ─────────────────────────────────────────────────────────── */

type PeriodRow = {
  period_number: number;
  started_at_ist: string;
  completed_at_ist: string | null;
  duration_seconds: number | null;
  effective_seconds: number;
  is_completed: boolean;
};

/* ─── Helpers ───────────────────────────────────────────────────────── */

/** IST date string (YYYY-MM-DD) for the current moment. */
const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Format an ISO / timestamptz string as IST time (hh:mm:ss AM/PM). */
const fmtIST = (v: string) =>
  new Date(v).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
  });

/** Format a bare IST datetime string (no tz offset) as 12h time. */
const fmtISTBare = (v: string) => {
  const m = v.match(/(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return v;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const sec = m[3];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${String(h12).padStart(2, "0")}:${min}:${sec} ${ampm}`;
};

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Format seconds → "Xh Ym" */
const fmtHM = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

/** Compute attendance span from session rows (matches AttendanceView logic). */
function computeAttendanceSpan(sessions: any[], now: number): number | null {
  if (!sessions || sessions.length === 0) return null;
  const row = sessions[0];
  const markedAtStr: string | null = row?.attendance_marked_at ?? null;
  const completedStr: string | null = row?.attendance_completed_at ?? null;
  if (markedAtStr) {
    const markedMs = new Date(markedAtStr).getTime();
    if (!isNaN(markedMs)) {
      if (completedStr) {
        const spanFromServer = row?.attendance_span_seconds;
        if (spanFromServer != null && Number(spanFromServer) >= 0)
          return Math.floor(Number(spanFromServer));
        const completedMs = new Date(completedStr).getTime();
        if (!isNaN(completedMs)) {
          const sec = Math.floor((completedMs - markedMs) / 1000);
          return sec >= 0 ? sec : null;
        }
      }
      const sec = Math.floor((now - markedMs) / 1000);
      return sec >= 0 ? sec : null;
    }
  }
  return computeFirstToLastSeconds(sessions, now);
}

/* ─── Component ─────────────────────────────────────────────────────── */

export default function MyAttendanceNewUi({ isDark }: { isDark: boolean }) {
  const {
    isMarkedPresent,
    timeIn,
    logoutTime,
    isDayCompleted,
    status,
    isLoading: ctxLoading,
    canRemark,
    currentPeriod,
    totalPeriods,
    completedPeriodsSeconds,
    activePeriodStartedAt,
    markAttendanceOptimistic,
    markDayComplete,
    remarkAttendance,
    refreshAttendance,
  } = useAttendance();

  /* ── Local state ─────────────────────────────────────── */
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [remarking, setRemarking] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Design tokens ───────────────────────────────────── */
  const bg = isDark ? "bg-[#000000]" : "bg-[#F5F5F7]";
  const card = isDark
    ? "bg-[#1C1C1E] border border-[#38383A]"
    : "bg-white border border-[#E5E5EA] shadow-sm";
  const subtle = isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]";
  const txt1 = isDark ? "text-white" : "text-[#1D1D1F]";
  const txt2 = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const accent = isDark ? "#FF3797" : "#9E217B";
  const accentBg = isDark ? "bg-[#FF3797]" : "bg-[#9E217B]";
  const divider = isDark ? "border-[#38383A]" : "border-[#E5E5EA]";

  /* ── Toast helper ────────────────────────────────────── */
  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  /* ── Fetch sessions ──────────────────────────────────── */
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/my-sessions?date=${todayIST()}`);
      if (res.ok) {
        const json = await res.json();
        setSessions(json.sessions ?? []);
      }
    } catch {
      /* non-blocking */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  /* ── Fetch periods ───────────────────────────────────── */
  const fetchPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    try {
      const res = await fetch(`/api/attendance/my-periods?date=${todayIST()}`);
      if (res.ok) {
        const json = await res.json();
        setPeriods(json.periods ?? []);
      }
    } catch {
      /* non-blocking */
    } finally {
      setPeriodsLoading(false);
    }
  }, []);

  /* ── Live tick (1s) ──────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ── Initial load + 30s refresh ──────────────────────── */
  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 30_000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  /* ── Mark Attendance ─────────────────────────────────── */
  const handleMark = async () => {
    if (marking || isMarkedPresent) return;
    setMarking(true);
    try {
      const res = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        markAttendanceOptimistic(json.time_in || new Date().toISOString());
        showToast("Attendance marked successfully", true);
        fetchSessions();
      } else {
        showToast(json.message || "Failed to mark attendance", false);
      }
    } catch {
      showToast("Network error — please try again", false);
    } finally {
      setMarking(false);
    }
  };

  /* ── Checkout (Done for the Day) ─────────────────────── */
  const handleCheckout = async () => {
    if (checkingOut || isDayCompleted) return;
    setCheckingOut(true);
    try {
      const res = await fetch("/api/attendance/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        markDayComplete(
          json.logout_time || new Date().toISOString(),
          json.working_track ?? null
        );
        showToast("Day completed — great work!", true);
        fetchSessions();
      } else {
        showToast(json.message || "Checkout failed", false);
      }
    } catch {
      showToast("Network error — please try again", false);
    } finally {
      setCheckingOut(false);
    }
  };

  /* ── Remark Attendance ───────────────────────────────── */
  const handleRemark = async () => {
    if (remarking) return;
    setRemarking(true);
    try {
      const ok = await remarkAttendance();
      if (ok) {
        showToast(`Period ${totalPeriods + 1} started`, true);
        fetchSessions();
      } else {
        showToast("Could not start new period", false);
      }
    } catch {
      showToast("Network error", false);
    } finally {
      setRemarking(false);
    }
  };

  /* ── Derived values ──────────────────────────────────── */
  const workingSec = computeAttendanceSpan(sessions, tick);
  const workingDisplay =
    workingSec != null && workingSec >= 0 ? fmtHM(workingSec) : "--h --m";

  const dateDisplay = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const isPresent = isMarkedPresent && status === "Present";
  const loading = ctxLoading || sessionsLoading;

  /* ── Active period timer ─────────────────────────────── */
  let activePeriodSec: number | null = null;
  if (activePeriodStartedAt && !isDayCompleted) {
    const ms = new Date(activePeriodStartedAt).getTime();
    if (!isNaN(ms)) activePeriodSec = Math.max(0, Math.floor((tick - ms) / 1000));
  }

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  return (
    <div className={`min-h-full ${bg} px-4 md:px-8 py-6 md:py-10 animate-fadeIn`}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* ── Header ───────────────────────────────────── */}
        <div>
          <h1 className={`text-xl md:text-2xl font-semibold tracking-tight ${txt1}`}>
            My Attendance
          </h1>
          <p className={`text-xs md:text-sm mt-1 ${txt2}`}>{dateDisplay}</p>
        </div>

        {/* ── Status Card ──────────────────────────────── */}
        <div className={`rounded-2xl p-5 md:p-6 ${card}`}>
          {/* Status indicator */}
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{
                backgroundColor: loading
                  ? isDark ? "#48484A" : "#D1D1D6"
                  : isPresent
                    ? "#34C759"
                    : "#FF3B30",
                boxShadow: loading
                  ? "none"
                  : isPresent
                    ? "0 0 8px rgba(52,199,89,0.5)"
                    : "0 0 8px rgba(255,59,48,0.4)",
              }}
            />
            <span className={`text-sm font-medium ${txt1}`}>
              {loading
                ? "Checking..."
                : isPresent
                  ? "Present Today"
                  : "Not Marked"}
            </span>
            {isPresent && isDayCompleted && (
              <span
                className={`ml-auto text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                  isDark ? "bg-[#2C2C2E] text-[#98989D]" : "bg-[#F2F2F7] text-[#86868B]"
                }`}
              >
                Day Completed
              </span>
            )}
          </div>

          {/* Mark / Checkout / Remark button */}
          {!loading && (
            <div className="mb-5">
              {!isPresent ? (
                <button
                  onClick={handleMark}
                  disabled={marking}
                  className={`w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.98] ${accentBg} ${
                    marking ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
                  }`}
                >
                  {marking ? "Marking..." : "Mark Attendance"}
                </button>
              ) : !isDayCompleted ? (
                <button
                  onClick={handleCheckout}
                  disabled={checkingOut}
                  className={`w-full py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] border ${divider} ${
                    isDark ? "bg-[#2C2C2E] text-white" : "bg-[#F2F2F7] text-[#1D1D1F]"
                  } ${checkingOut ? "opacity-60 cursor-not-allowed" : "hover:opacity-80"}`}
                >
                  {checkingOut ? "Completing..." : "Done for the Day"}
                </button>
              ) : canRemark ? (
                <button
                  onClick={handleRemark}
                  disabled={remarking}
                  className={`w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.98] ${accentBg} ${
                    remarking ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
                  }`}
                >
                  {remarking ? "Starting..." : "Start New Period"}
                </button>
              ) : null}
            </div>
          )}

          {/* Info row */}
          <div className={`grid grid-cols-2 gap-4`}>
            {/* Time In */}
            <div className={`rounded-xl p-3.5 ${subtle}`}>
              <p className={`text-[10px] uppercase tracking-wider font-medium mb-1.5 ${txt2}`}>
                Marked At
              </p>
              <p className={`text-sm font-semibold tabular-nums ${txt1}`}>
                {isPresent && timeIn ? fmtIST(timeIn) : "—"}
              </p>
            </div>
            {/* Working Hours */}
            <div className={`rounded-xl p-3.5 ${subtle}`}>
              <p className={`text-[10px] uppercase tracking-wider font-medium mb-1.5 ${txt2}`}>
                Working Hours
              </p>
              <p className={`text-sm font-semibold tabular-nums ${txt1}`}>
                {isPresent ? workingDisplay : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* ── Period Info Card ─────────────────────────── */}
        {isPresent && totalPeriods > 0 && (
          <div className={`rounded-2xl p-5 md:p-6 ${card}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-sm font-semibold ${txt1}`}>Work Periods</h2>
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${subtle} ${txt2}`}>
                {totalPeriods} {totalPeriods === 1 ? "period" : "periods"}
              </span>
            </div>

            {/* Active period timer */}
            {activePeriodSec != null && (
              <div className={`rounded-xl p-3.5 mb-4 ${subtle}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full animate-pulse"
                      style={{ backgroundColor: "#34C759" }}
                    />
                    <span className={`text-xs font-medium ${txt2}`}>
                      {ordinal(currentPeriod)} period — active
                    </span>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${txt1}`}>
                    {fmtHM(activePeriodSec)}
                  </span>
                </div>
              </div>
            )}

            {/* Completed periods summary */}
            {completedPeriodsSeconds > 0 && (
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs ${txt2}`}>Completed periods total</span>
                <span className={`text-xs font-semibold tabular-nums ${txt1}`}>
                  {fmtHM(completedPeriodsSeconds)}
                </span>
              </div>
            )}

            {/* Expand period history */}
            <button
              onClick={() => {
                if (!periodsOpen) fetchPeriods();
                setPeriodsOpen(!periodsOpen);
              }}
              className={`w-full text-xs font-medium py-2.5 rounded-xl transition-colors ${subtle} ${txt2} hover:opacity-80`}
            >
              {periodsOpen ? "Hide Details" : "View Period History"}
            </button>

            <AnimatePresence>
              {periodsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 space-y-2">
                    {periodsLoading ? (
                      <p className={`text-xs py-3 text-center ${txt2}`}>Loading...</p>
                    ) : periods.length === 0 ? (
                      <p className={`text-xs py-3 text-center ${txt2}`}>No periods found</p>
                    ) : (
                      periods.map((p) => (
                        <div
                          key={p.period_number}
                          className={`flex items-center justify-between py-2.5 px-3.5 rounded-xl ${subtle}`}
                        >
                          <div>
                            <span className={`text-xs font-medium ${txt1}`}>
                              {ordinal(p.period_number)} Period
                            </span>
                            <span className={`text-[10px] ml-2 ${txt2}`}>
                              {fmtISTBare(p.started_at_ist)}
                              {p.completed_at_ist
                                ? ` — ${fmtISTBare(p.completed_at_ist)}`
                                : " — now"}
                            </span>
                          </div>
                          <span className={`text-xs font-semibold tabular-nums ${txt1}`}>
                            {p.is_completed && p.duration_seconds != null
                              ? fmtHM(p.duration_seconds)
                              : p.effective_seconds > 0
                                ? fmtHM(p.effective_seconds)
                                : "Active"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Sessions Card ────────────────────────────── */}
        {sessions.length > 0 && (
          <div className={`rounded-2xl p-5 md:p-6 ${card}`}>
            <h2 className={`text-sm font-semibold mb-4 ${txt1}`}>
              Today&apos;s Sessions
            </h2>
            <div className="space-y-2">
              {sessions.map((s: any, i: number) => {
                const start = s.session_start
                  ? fmtIST(s.session_start)
                  : "—";
                const end = s.session_end ? fmtIST(s.session_end) : null;
                const durSec = s.session_duration_seconds;
                return (
                  <div
                    key={s.session_id ?? i}
                    className={`flex items-center justify-between py-2.5 px-3.5 rounded-xl ${subtle}`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: s.is_active ? "#34C759" : isDark ? "#48484A" : "#D1D1D6",
                        }}
                      />
                      <span className={`text-xs ${txt1}`}>
                        {start}
                        {end ? ` — ${end}` : " — now"}
                      </span>
                    </div>
                    <span className={`text-xs font-semibold tabular-nums ${txt1}`}>
                      {durSec != null && durSec > 0
                        ? fmtHM(durSec)
                        : s.is_active && s.session_start
                          ? fmtHM(
                              Math.max(
                                0,
                                Math.floor(
                                  (tick - new Date(s.session_start).getTime()) / 1000
                                )
                              )
                            )
                          : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Toast ────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.25 }}
            className={`fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl text-sm font-medium shadow-lg ${
              toast.ok
                ? isDark
                  ? "bg-green-900/80 text-green-200"
                  : "bg-green-100 text-green-800"
                : isDark
                  ? "bg-red-900/80 text-red-200"
                  : "bg-red-100 text-red-800"
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
