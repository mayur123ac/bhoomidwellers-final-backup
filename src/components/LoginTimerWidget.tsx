"use client";
// LoginTimerWidget – shows 🟢 Online | Login Time | Live Elapsed Timer
// Uses session_start from /api/attendance/my-sessions (same source as admin tracker).
// Caches session_start in sessionStorage so refresh doesn't reset the timer.
// Only this component re-renders every second.

import { useEffect, useState, useRef, memo } from "react";

interface Props {
  isDark: boolean;
}

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}h : ${String(m).padStart(2, "0")}m : ${String(s).padStart(2, "0")}s`;
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  } catch { return "--:--"; }
}

const LoginTimerWidget = memo(function LoginTimerWidget({ isDark }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [loginTime, setLoginTime] = useState<string | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Try cache first — survives page refresh
    const cached = sessionStorage.getItem("crm_session_start");
    const cachedLogin = sessionStorage.getItem("crm_login_time");
    if (cached && cachedLogin) {
      sessionStartRef.current = Number(cached);
      setLoginTime(cachedLogin);
    }

    // Always fetch the live session_start from the DB (authoritative)
    fetch("/api/attendance/my-sessions")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.sessions?.length) return;
        // Find the latest active session today
        const active = data.sessions
          .filter((s: any) => s.session_is_active)
          .sort((a: any, b: any) => new Date(b.session_start).getTime() - new Date(a.session_start).getTime())[0]
          || data.sessions[data.sessions.length - 1];

        if (!active?.session_start) return;
        const start = new Date(active.session_start).getTime();
        sessionStartRef.current = start;
        setLoginTime(active.session_start);

        // Cache it for refresh resilience
        sessionStorage.setItem("crm_session_start", String(start));
        sessionStorage.setItem("crm_login_time", active.session_start);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (sessionStartRef.current) {
        setElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  if (!loginTime) return null;

  const timerColor = isDark ? "text-[#d946a8]" : "text-[#9E217B]";
  const labelColor = isDark ? "text-[#9ca3af]" : "text-[#475569]";
  const wrapCls = isDark
    ? "bg-[#1C1C2A] border border-[#2A2A2A] shadow-sm"
    : "bg-white border border-[#E5E7EB] shadow-sm";

  return (
    <div className={`hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-xl ${wrapCls}`}>
      {/* Online dot */}
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />

      {/* Login time */}
      <div className="hidden md:flex flex-col leading-none">
        <span className={`text-[9px] font-semibold uppercase tracking-wider pb-1 ${labelColor}`}>Login</span>
        <span className={`text-[11px] font-bold tabular-nums ${labelColor}`}>{fmtTime(loginTime)}</span>
      </div>

      {/* Divider */}
      <span className={`hidden md:block w-px h-6 ${isDark ? "bg-[#2A2A2A]" : "bg-[#E5E7EB]"}`} />

      {/* Elapsed timer */}
      <div className="flex flex-col leading-none">
        <span className={`text-[9px] font-semibold uppercase tracking-wider pb-1 ${labelColor}`}>Logged In</span>
        <span className={`text-[11px] font-bold tabular-nums ${timerColor}`}>{fmt(elapsed)}</span>
      </div>
    </div>
  );
});

export default LoginTimerWidget;
