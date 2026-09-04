"use client";

// lib/supabase/useRealtimeOrg.ts — reusable hook for Supabase Realtime org channel.
//
// One private channel per organization. Token refresh is handled by the shared
// realtimeTokenManager so that multiple hooks on the same page share a single
// /api/auth/realtime-token refresh loop instead of each running their own.

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./client";
import { subscribe, unsubscribe, refreshNow } from "./realtimeTokenManager";
import type { RealtimeChannel } from "@supabase/supabase-js";

type EventHandler = (payload: Record<string, unknown>) => void;

interface UseRealtimeOrgOptions {
  /** The organization ID from the CRM session. No channel is opened without it. */
  organizationId: string | null | undefined;
  /** Map of Supabase event name → handler. Stable reference preferred. */
  events: Record<string, EventHandler>;
  /** Set false to disable without unmounting. Default true. */
  enabled?: boolean;
}

export function useRealtimeOrg({ organizationId, events, enabled = true }: UseRealtimeOrgOptions) {
  // Refs keep the latest handlers without re-subscribing
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const cancelledRef = useRef(false);

  const cleanupChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !organizationId) return;

    cancelledRef.current = false;

    async function connect() {
      const data = await subscribe();
      if (!data || cancelledRef.current) return;

      // Build the channel with all event listeners
      let ch = supabase.channel(`org:${organizationId}`, {
        config: { private: true },
      });

      // Register a broadcast listener for every event name the consumer cares about.
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
      cleanupChannel();
      // refreshNow() re-auths the shared Supabase client; only one call
      // per visibility change actually hits the API because the manager
      // deduplicates in-flight fetches.
      refreshNow().then(() => {
        if (!cancelledRef.current) connect();
      });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelledRef.current = true;
      cleanupChannel();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [organizationId, enabled, cleanupChannel]);
}
