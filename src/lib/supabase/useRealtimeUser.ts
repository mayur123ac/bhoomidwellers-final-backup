"use client";

// lib/supabase/useRealtimeUser.ts — per-user private channel for targeted events.
//
// Used for security-critical events like FORCE_LOGOUT that must reach exactly
// one user and no one else. The channel name includes the user id, and the
// Supabase RLS policy enforces that only the JWT owner can subscribe.

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type EventHandler = (payload: Record<string, unknown>) => void;

interface UseRealtimeUserOptions {
  organizationId: string | null | undefined;
  userId: number | string | null | undefined;
  events: Record<string, EventHandler>;
  enabled?: boolean;
}

async function fetchRealtimeToken(): Promise<{ token: string; expires_in: number } | null> {
  try {
    const res = await fetch("/api/auth/realtime-token", { method: "POST" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function useRealtimeUser({ organizationId, userId, events, enabled = true }: UseRealtimeUserOptions) {
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const ms = Math.max((expiresIn - 10) * 1000, 5000);
    refreshTimerRef.current = setTimeout(async () => {
      if (cancelledRef.current) return;
      const data = await fetchRealtimeToken();
      if (data && !cancelledRef.current) {
        supabase.realtime.setAuth(data.token);
        scheduleRefresh(data.expires_in);
      }
    }, ms);
  }, []);

  useEffect(() => {
    if (!enabled || !organizationId || !userId) return;

    cancelledRef.current = false;

    async function connect() {
      const data = await fetchRealtimeToken();
      if (!data || cancelledRef.current) return;

      supabase.realtime.setAuth(data.token);
      scheduleRefresh(data.expires_in);

      if (cancelledRef.current) return;

      let ch = supabase.channel(`org:${organizationId}:user:${userId}`, {
        config: { private: true },
      });

      for (const eventName of Object.keys(eventsRef.current)) {
        ch = ch.on("broadcast", { event: eventName }, ({ payload }) => {
          eventsRef.current[eventName]?.(payload as Record<string, unknown>);
        });
      }

      ch.subscribe();
      channelRef.current = ch;
    }

    connect();

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || cancelledRef.current) return;
      cleanup();
      connect();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelledRef.current = true;
      cleanup();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [organizationId, userId, enabled, cleanup, scheduleRefresh]);
}
