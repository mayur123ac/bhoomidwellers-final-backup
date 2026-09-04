"use client";

// lib/supabase/useRealtimeUser.ts — per-user private channel for targeted events.
//
// Used for security-critical events like FORCE_LOGOUT that must reach exactly
// one user and no one else. The channel name includes the user id, and the
// Supabase RLS policy enforces that only the JWT owner can subscribe.
//
// Token refresh is handled by the shared realtimeTokenManager.

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./client";
import { subscribe, unsubscribe, refreshNow } from "./realtimeTokenManager";
import type { RealtimeChannel } from "@supabase/supabase-js";

type EventHandler = (payload: Record<string, unknown>) => void;

interface UseRealtimeUserOptions {
  organizationId: string | null | undefined;
  userId: number | string | null | undefined;
  events: Record<string, EventHandler>;
  enabled?: boolean;
}

export function useRealtimeUser({ organizationId, userId, events, enabled = true }: UseRealtimeUserOptions) {
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
    if (!enabled || !organizationId || !userId) return;

    cancelledRef.current = false;

    async function connect() {
      const data = await subscribe();
      if (!data || cancelledRef.current) return;

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
      cleanupChannel();
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
  }, [organizationId, userId, enabled, cleanupChannel]);
}
