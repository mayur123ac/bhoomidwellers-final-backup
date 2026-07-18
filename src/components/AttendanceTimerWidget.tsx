"use client";

import { useEffect, useState } from "react";
import { FaClock, FaCalendarAlt } from "react-icons/fa";
import { useShiftTiming } from "@/hooks/useShiftTiming";

/**
 * Header widget that shows:
 *  - First login time today
 *  - Cumulative working time today (all sessions combined, live-ticking)
 *  - Shift schedule
 *
 * Timer represents TOTAL WORKING TIME FOR THE DAY — it does NOT reset on
 * logout/login. On each login it rehydrates by summing all previous sessions.
 */
export default function AttendanceTimerWidget() {
  const [firstLoginTime, setFirstLoginTime] = useState<Date | null>(null);
  /** Elapsed milliseconds from completed sessions (re-hydrated on mount) */
  const [completedMs, setCompletedMs] = useState<number>(0);
  /** Start time of the current active session (null when logged out) */
  const [activeSessionStart, setActiveSessionStart] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState<string>("00:00:00");

  const { timing: workingHours } = useShiftTiming();
  const schedule = workingHours.flexible
    ? "Flexible"
    : `${workingHours.loginTime} - ${workingHours.logoutTime}`;

  // Fetch all today's sessions to compute cumulative time
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];

    async function loadSessions() {
      try {
        const res = await fetch(`/api/attendance/my-sessions?date=${today}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // Fallback: use sessionStorage login time (old behaviour)
          const stored = sessionStorage.getItem("crm_login_time");
          if (stored) {
            setActiveSessionStart(new Date(parseInt(stored, 10)));
          } else {
            const now = new Date();
            sessionStorage.setItem("crm_login_time", now.getTime().toString());
            setActiveSessionStart(now);
          }
          return;
        }

        const data = await res.json();
        const sessions: any[] = data.sessions || [];

        if (sessions.length === 0) {
          // No sessions yet — use sessionStorage
          const stored = sessionStorage.getItem("crm_login_time");
          const loginTime = stored ? new Date(parseInt(stored, 10)) : new Date();
          if (!stored) {
            sessionStorage.setItem("crm_login_time", loginTime.getTime().toString());
          }
          setActiveSessionStart(loginTime);
          return;
        }

        // Sort oldest first
        const sorted = [...sessions].sort(
          (a, b) =>
            new Date(a.session_start).getTime() - new Date(b.session_start).getTime()
        );

        setFirstLoginTime(new Date(sorted[0].session_start));

        // Sum all COMPLETED sessions
        let sumMs = 0;
        let currentActive: Date | null = null;
        for (const s of sorted) {
          const start = new Date(s.session_start).getTime();
          if (s.session_is_active) {
            // This is the live session — don't add to completed; tick from now
            currentActive = new Date(s.session_start);
          } else if (s.session_end) {
            const end = new Date(s.session_end).getTime();
            sumMs += Math.max(0, end - start);
          }
        }

        setCompletedMs(sumMs);
        setActiveSessionStart(currentActive);
      } catch {
        // Fallback on any error
        const stored = sessionStorage.getItem("crm_login_time");
        const loginTime = stored ? new Date(parseInt(stored, 10)) : new Date();
        if (!stored) {
          sessionStorage.setItem("crm_login_time", loginTime.getTime().toString());
        }
        setActiveSessionStart(loginTime);
      }
    }

    loadSessions();

    // Rehydrate every 5 minutes in case a new session row appears
    const rehydrate = setInterval(loadSessions, 5 * 60 * 1000);
    return () => clearInterval(rehydrate);
  }, []);

  // Tick every second: completedMs + (now - activeSessionStart)
  useEffect(() => {
    const tick = () => {
      let totalMs = completedMs;
      if (activeSessionStart) {
        totalMs += Math.max(0, Date.now() - activeSessionStart.getTime());
      }

      const totalSec = Math.floor(totalMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setElapsed(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    };

    tick(); // run immediately
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [completedMs, activeSessionStart]);

  const displayLoginTime = firstLoginTime ?? activeSessionStart;
  if (!displayLoginTime) return null;

  return (
    <div className="hidden lg:flex items-center gap-4 bg-slate-100 dark:bg-[#14141B] border border-slate-300 dark:border-[#2A2A35] px-4 py-2 rounded-xl text-xs font-semibold shadow-sm ml-4">
      <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
        <FaClock className="text-[#9E217B] dark:text-[#d4006e]" />
        <span>
          Login:{" "}
          {displayLoginTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="w-px h-4 bg-slate-300 dark:bg-slate-600"></div>
      <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-mono tracking-wider">
        <span title="Total working time today (all sessions)">⏱ {elapsed}</span>
      </div>
      <div className="w-px h-4 bg-slate-300 dark:bg-slate-600"></div>
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <FaCalendarAlt />
        <span>Schedule: {schedule}</span>
      </div>
    </div>
  );
}
