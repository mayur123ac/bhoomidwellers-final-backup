"use client";

import { useState, useEffect, useCallback } from "react";

export interface ShiftTiming {
  loginTime: string;
  logoutTime: string;
  flexible: boolean;
}

// Working hours are stable org config — they change at most once a day.
// Default poll is 5 minutes, and the interval is skipped in background tabs.
export function useShiftTiming(pollingIntervalMs = 300_000) {
  const [timing, setTiming] = useState<ShiftTiming>({
    loginTime: "11:00",
    logoutTime: "20:00",
    flexible: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTiming = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/working-hours", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch shift timing");
      }
      const data = await res.json();
      setTiming((prev) =>
        JSON.stringify(prev) === JSON.stringify(data) ? prev : data
      );
      setError(null);
    } catch (err: any) {
      console.error("useShiftTiming Error:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTiming();

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchTiming();
    }, pollingIntervalMs);
    const onVisible = () => { if (!document.hidden) fetchTiming(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchTiming, pollingIntervalMs]);

  return { timing, loading, error, refresh: fetchTiming };
}
