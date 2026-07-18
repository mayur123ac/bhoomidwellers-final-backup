"use client";

import { useState, useEffect, useCallback } from "react";

export interface ShiftTiming {
  loginTime: string;
  logoutTime: string;
  flexible: boolean;
}

export function useShiftTiming(pollingIntervalMs = 10000) {
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
    // Initial fetch
    fetchTiming();

    // Polling
    const intervalId = setInterval(fetchTiming, pollingIntervalMs);
    return () => clearInterval(intervalId);
  }, [fetchTiming, pollingIntervalMs]);

  return { timing, loading, error, refresh: fetchTiming };
}
