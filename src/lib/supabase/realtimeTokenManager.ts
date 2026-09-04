"use client";

// lib/supabase/realtimeTokenManager.ts — singleton token refresh for Supabase Realtime.
//
// Every useRealtimeOrg / useRealtimeUser hook used to run its own
// /api/auth/realtime-token refresh timer. On an admin page with 6–7 hooks
// that meant 6–7 timers each hitting the API every ~50 seconds. Since
// supabase.realtime.setAuth() is global (one auth state per Supabase client),
// a single refresh loop is sufficient and correct.
//
// Hooks call subscribe() on mount and unsubscribe() on cleanup. The first
// subscriber triggers the initial fetch; the last unsubscription stops the
// refresh timer.

import { supabase } from "./client";

interface TokenData {
  token: string;
  expires_in: number;
}

let subscriberCount = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let currentPromise: Promise<TokenData | null> | null = null;

async function fetchToken(): Promise<TokenData | null> {
  try {
    const res = await fetch("/api/auth/realtime-token", { method: "POST" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function scheduleRefresh(expiresIn: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 10 s before expiry, minimum 5 s — same logic the hooks used.
  const ms = Math.max((expiresIn - 10) * 1000, 5000);
  refreshTimer = setTimeout(async () => {
    const data = await fetchToken();
    if (data && subscriberCount > 0) {
      supabase.realtime.setAuth(data.token);
      scheduleRefresh(data.expires_in);
    }
  }, ms);
}

/**
 * Ensure the Supabase Realtime client has a valid JWT and a refresh timer
 * is running. Returns the token data so callers know auth succeeded.
 *
 * Safe to call many times — concurrent calls share one in-flight fetch.
 */
export async function subscribe(): Promise<TokenData | null> {
  subscriberCount++;

  // If a fetch is already in flight (from another hook mounting in the same
  // render cycle), piggyback on it instead of firing a second request.
  if (currentPromise) return currentPromise;

  currentPromise = fetchToken();
  const data = await currentPromise;
  currentPromise = null;

  if (data && subscriberCount > 0) {
    supabase.realtime.setAuth(data.token);
    // Only start the timer if one isn't already running (avoids duplicates
    // when multiple hooks subscribe in rapid succession).
    if (!refreshTimer) {
      scheduleRefresh(data.expires_in);
    }
  }

  return data;
}

/**
 * Decrement the subscriber count. When it reaches zero the refresh timer is
 * stopped — no more /api/auth/realtime-token calls until a new subscribe().
 */
export function unsubscribe() {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    currentPromise = null;
  }
}

/**
 * Force an immediate token refresh (e.g. after a visibility change reconnect).
 * No-op if there are no subscribers.
 */
export async function refreshNow(): Promise<TokenData | null> {
  if (subscriberCount === 0) return null;
  const data = await fetchToken();
  if (data && subscriberCount > 0) {
    supabase.realtime.setAuth(data.token);
    scheduleRefresh(data.expires_in);
  }
  return data;
}
