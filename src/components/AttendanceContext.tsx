"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

/** Flip to false to silence the attendance sync tracing. */
const ATTENDANCE_DEBUG = true;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const log = (...args: any[]) => {
  if (ATTENDANCE_DEBUG) console.log("%c[attendance-sync]", "color:#9E217B;font-weight:bold", ...args);
};

/**
 * How long an optimistic "Present" may out-rank a server response saying
 * otherwise. This only needs to cover a refetch that raced the POST /mark
 * commit — it must stay short so a genuinely unmarked employee is never shown
 * as present.
 */
const OPTIMISTIC_GRACE_MS = 10_000;

interface AttendanceContextType {
  isMarkedPresent: boolean;
  timeIn: string | null;
  logoutTime: string | null;
  isDayCompleted: boolean;
  workingTrack: number | null;
  status: string | null;
  employeeId: number | null;
  isLoading: boolean;
  /** Remark attendance fields */
  canRemark: boolean;
  currentPeriod: number;
  totalPeriods: number;
  completedPeriodsSeconds: number;
  activePeriodStartedAt: string | null;
  markAttendanceOptimistic: (timeIn: string) => void;
  markDayComplete: (logoutTime: string, workingTrack?: number | null) => void;
  remarkAttendance: () => Promise<boolean>;
  refreshAttendance: () => Promise<void>;
}

const AttendanceContext = createContext<AttendanceContextType | undefined>(undefined);

export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const [isMarkedPresent, setIsMarkedPresent] = useState(false);
  const [timeIn, setTimeIn] = useState<string | null>(null);
  const [logoutTime, setLogoutTime] = useState<string | null>(null);
  const [workingTrack, setWorkingTrack] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [canRemark, setCanRemark] = useState(false);
  const [currentPeriod, setCurrentPeriod] = useState(0);
  const [totalPeriods, setTotalPeriods] = useState(0);
  const [completedPeriodsSeconds, setCompletedPeriodsSeconds] = useState(0);
  const [activePeriodStartedAt, setActivePeriodStartedAt] = useState<string | null>(null);

  // Which employee the current state describes. Logout uses router.replace(), a
  // soft navigation, so this provider is never remounted when the user changes —
  // we have to detect the switch ourselves and drop the previous user's state.
  const employeeIdRef = useRef<number | null>(null);
  // Scoped to an employee and time-bounded, so it can never mask another user.
  const optimisticRef = useRef<{ employeeId: number | null; at: number } | null>(null);
  // Guards against out-of-order responses: only the newest request may write state.
  const requestSeqRef = useRef(0);

  const applyUnmarked = useCallback(() => {
    setIsMarkedPresent(false);
    setStatus(null);
    setTimeIn(null);
    setLogoutTime(null);
    setWorkingTrack(null);
    setCanRemark(false);
    setCurrentPeriod(0);
    setTotalPeriods(0);
    setCompletedPeriodsSeconds(0);
    setActivePeriodStartedAt(null);
  }, []);

  const reset = useCallback(() => {
    optimisticRef.current = null;
    employeeIdRef.current = null;
    setEmployeeId(null);
    applyUnmarked();
    log("state reset (session cleared)");
  }, [applyUnmarked]);

  const fetchStatus = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const res = await fetch(`/api/attendance/status?t=${Date.now()}`, { cache: "no-store" });

      if (res.status === 401 || res.status === 403) {
        // No valid session — never keep showing the previous user's badge.
        if (seq === requestSeqRef.current) reset();
        return;
      }
      if (!res.ok) {
        log("status fetch failed", res.status, "— keeping current state");
        return;
      }

      const data = await res.json();
      log("GET /api/attendance/status →", data);

      if (seq !== requestSeqRef.current) {
        log("discarded stale status response", { seq, latest: requestSeqRef.current });
        return;
      }

      const incomingId = data.employeeId ?? null;

      // Different employee than the state we hold → a user switch. Take the
      // server's answer verbatim and drop anything the previous user left behind.
      if (employeeIdRef.current !== null && incomingId !== employeeIdRef.current) {
        log("employee changed", { from: employeeIdRef.current, to: incomingId }, "— dropping previous state");
        optimisticRef.current = null;
      }
      employeeIdRef.current = incomingId;
      setEmployeeId(incomingId);

      if (data.marked) {
        setIsMarkedPresent(true);
        setStatus(data.status ?? "Present");
        setTimeIn(data.timeIn || null);
        setLogoutTime(data.logoutTime || null);
        setWorkingTrack(data.workingTrack ?? null);
        setCanRemark(data.canRemark ?? false);
        setCurrentPeriod(data.currentPeriod ?? 0);
        setTotalPeriods(data.totalPeriods ?? 0);
        setCompletedPeriodsSeconds(data.completedPeriodsSeconds ?? 0);
        setActivePeriodStartedAt(data.activePeriodStartedAt || null);
        optimisticRef.current = null;
        return;
      }

      // Server says not marked. Only defend an optimistic write that is recent
      // AND belongs to this same employee.
      const opt = optimisticRef.current;
      const isRecent = !!opt && Date.now() - opt.at < OPTIMISTIC_GRACE_MS;
      const isSameEmployee = !!opt && (opt.employeeId === null || opt.employeeId === incomingId);
      if (isRecent && isSameEmployee) {
        log("ignoring 'unmarked' within optimistic grace window", { employeeId: incomingId });
        return;
      }

      optimisticRef.current = null;
      applyUnmarked();
    } catch (e) {
      console.error("Failed to fetch attendance status", e);
    } finally {
      if (seq === requestSeqRef.current) setIsLoading(false);
    }
  }, [applyUnmarked, reset]);

  // Re-sync on every route change. Login navigates soft (router.replace), so this
  // is what re-reads the badge for the newly signed-in user.
  const pathname = usePathname();
  useEffect(() => {
    fetchStatus();
  }, [pathname, fetchStatus]);

  useEffect(() => {
    // Cross-component broadcast (any page can fire this after marking).
    const handleMarked = () => {
      log("received 'attendance-marked' event → refetching");
      fetchStatus();
    };
    // Fired by clearCrmSession() so the badge clears the moment someone logs out.
    const handleReset = () => reset();
    // Re-sync when the tab regains focus so other devices/tabs converge.
    const handleFocus = () => fetchStatus();

    window.addEventListener("attendance-marked", handleMarked);
    window.addEventListener("attendance-reset", handleReset);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("attendance-marked", handleMarked);
      window.removeEventListener("attendance-reset", handleReset);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchStatus, reset]);

  const markAttendanceOptimistic = useCallback((newTimeIn: string) => {
    optimisticRef.current = { employeeId: employeeIdRef.current, at: Date.now() };
    setIsMarkedPresent(true);
    setStatus("Present");
    setTimeIn(newTimeIn);
    setLogoutTime(null);
    setWorkingTrack(null);
    setIsLoading(false);
    log("optimistic update applied → Present", { employeeId: employeeIdRef.current, timeIn: newTimeIn });
  }, []);

  const markDayComplete = useCallback((newLogoutTime: string, newWorkingTrack?: number | null) => {
    setLogoutTime(newLogoutTime);
    if (newWorkingTrack != null) setWorkingTrack(newWorkingTrack);
    setCanRemark(true);
    setActivePeriodStartedAt(null);
    log("optimistic day-complete applied", { logoutTime: newLogoutTime, workingTrack: newWorkingTrack });
  }, []);

  const remarkAttendance = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/attendance/remark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        // Optimistic: clear logout, set active period
        setLogoutTime(null);
        setCanRemark(false);
        setActivePeriodStartedAt(data.startedAt || new Date().toISOString());
        setCurrentPeriod(data.periodNumber ?? (currentPeriod + 1));
        setTotalPeriods((prev) => prev + 1);
        log("remark applied", { periodNumber: data.periodNumber });
        window.dispatchEvent(new Event("attendance-marked"));
        await fetchStatus();
        return true;
      }
      log("remark failed", data?.message);
      return false;
    } catch (e) {
      console.error("Remark attendance error:", e);
      return false;
    }
  }, [currentPeriod, fetchStatus]);

  const isDayCompleted = isMarkedPresent && !!logoutTime;

  return (
    <AttendanceContext.Provider
      value={{
        isMarkedPresent,
        timeIn,
        logoutTime,
        isDayCompleted,
        workingTrack,
        status,
        employeeId,
        isLoading,
        canRemark,
        currentPeriod,
        totalPeriods,
        completedPeriodsSeconds,
        activePeriodStartedAt,
        markAttendanceOptimistic,
        markDayComplete,
        remarkAttendance,
        refreshAttendance: fetchStatus,
      }}
    >
      {children}
    </AttendanceContext.Provider>
  );
}

export function useAttendance() {
  const context = useContext(AttendanceContext);
  if (!context) throw new Error("useAttendance must be used within an AttendanceProvider");
  return context;
}
