"use client";

// lib/supabase/useRealtimeUser.ts — per-user private channel for targeted events.
//
// Used for security-critical events like FORCE_LOGOUT that must reach exactly
// one user and no one else. The channel name includes the user id, and the
// Supabase RLS policy enforces that only the JWT owner can subscribe.
//
// Token refresh is handled by the shared realtimeTokenManager.
//
// Mobile: Also listens to Capacitor appStateChange for reliable reconnection.

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./client";
import { subscribe, unsubscribe, refreshNow } from "./realtimeTokenManager";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Capacitor foreground helper — same as useRealtimeOrg (avoids circular import)
type CapCleanup = (() => void) | null;
function onCapacitorForeground(cb: () => void): CapCleanup {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor } = require("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
  } catch { return null; }
  let handle: { remove: () => Promise<void> } | null = null;
  import("@capacitor/app").then(({ App }) => {
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) cb();
    }).then(h => { handle = h; });
  }).catch(() => {});
  return () => { handle?.remove(); };
}

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

    const reconnect = () => {
      if (cancelledRef.current) return;
      cleanupChannel();
      refreshNow().then(() => {
        if (!cancelledRef.current) connect();
      });
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      reconnect();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const cleanupCap = onCapacitorForeground(reconnect);

    return () => {
      cancelledRef.current = true;
      cleanupChannel();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupCap?.();
    };
  }, [organizationId, userId, enabled, cleanupChannel]);
}
