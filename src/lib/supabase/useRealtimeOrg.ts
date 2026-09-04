"use client";

// lib/supabase/useRealtimeOrg.ts — reusable hook for Supabase Realtime org channel.
//
// One private channel per organization, one JWT refresh loop, automatic
// reconnect on visibility change. All CRM dashboards share this hook instead
// of opening individual EventSource connections per event family.

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** The shape returned by /api/auth/realtime-token */
interface TokenResponse {
  token: string;
  expires_in: number;
}

type EventHandler = (payload: Record<string, unknown>) => void;

interface UseRealtimeOrgOptions {
  /** The organization ID from the CRM session. No channel is opened without it. */
  organizationId: string | null | undefined;
  /** Map of Supabase event name → handler. Stable reference preferred. */
  events: Record<string, EventHandler>;
  /** Set false to disable without unmounting. Default true. */
  enabled?: boolean;
}

async function fetchRealtimeToken(): Promise<TokenResponse | null> {
  try {
    const res = await fetch("/api/auth/realtime-token", { method: "POST" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function useRealtimeOrg({ organizationId, events, enabled = true }: UseRealtimeOrgOptions) {
  // Refs keep the latest handlers without re-subscribing
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
    // Refresh 10s before expiry, minimum 5s
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
    if (!enabled || !organizationId) return;

    cancelledRef.current = false;

    async function connect() {
      const data = await fetchRealtimeToken();
      if (!data || cancelledRef.current) return;

      supabase.realtime.setAuth(data.token);
      scheduleRefresh(data.expires_in);

      if (cancelledRef.current) return;

      // Build the channel with all event listeners
      let ch = supabase.channel(`org:${organizationId}`, {
        config: { private: true },
      });

      // Register a broadcast listener for every event name the consumer cares about.
      // The handler dispatches through the ref so callback identity changes don't
      // tear down and rebuild the WebSocket.
      const eventNames = Object.keys(eventsRef.current);
      for (const eventName of eventNames) {
        ch = ch.on("broadcast", { event: eventName }, ({ payload }) => {
          eventsRef.current[eventName]?.(payload as Record<string, unknown>);
        });
      }

      ch.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[realtime] channel error, will reconnect:", status);
        }
      });

      channelRef.current = ch;
    }

    connect();

    // Reconnect on visibility change (Capacitor / mobile background)
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
  }, [organizationId, enabled, cleanup, scheduleRefresh]);
}
