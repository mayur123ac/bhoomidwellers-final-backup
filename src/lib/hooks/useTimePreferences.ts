"use client";

// lib/hooks/useTimePreferences.ts — the signed-in user's stored week start.
//
// The timezone half of "Time Preferences" needs no hook: it is a constant, and
// lives in lib/timePreferences.ts with the formatters that use it. `weekStartDay`
// is a real per-user value, so it has to be fetched — and fetched once.
//
// One module-level cache and one in-flight request are shared by every consumer,
// so several surfaces mounting together make a single call rather than one each.

import { useEffect, useState } from "react";
import {
  APP_TIMEZONE,
  DEFAULT_WEEK_START_DAY,
  isValidWeekStartDay,
  type TimePreferences,
} from "@/lib/timePreferences";

const CACHE_KEY = "crm_time_prefs";

type Stored = { weekStartDay: number };

let cache: Stored | null = null;
let inFlight: Promise<Stored> | null = null;
const listeners = new Set<(v: Stored) => void>();

function publish(value: Stored) {
  cache = value;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* the cache is an optimisation, not a requirement */
  }
  listeners.forEach((l) => l(value));
}

/**
 * Drop the cached preference.
 *
 * Logout is a soft navigation, so this module is never re-evaluated between two
 * users on the same machine — without this the second user inherits the first
 * user's week start. clearCrmSession() already fires "attendance-reset" for
 * exactly this class of state, and the hook below listens for it.
 */
export function clearTimePreferences() {
  cache = null;
  inFlight = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l({ weekStartDay: DEFAULT_WEEK_START_DAY }));
}

/** Called by the Profile screen on save, so open surfaces update without a reload. */
export function setWeekStartDay(day: number) {
  publish({ weekStartDay: isValidWeekStartDay(day) ? day : DEFAULT_WEEK_START_DAY });
}

function loadPreferences(): Promise<Stored> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = fetch("/api/settings/profile")
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const day = Number(json?.user?.weekStartDay);
      const value = { weekStartDay: isValidWeekStartDay(day) ? day : DEFAULT_WEEK_START_DAY };
      publish(value);
      return value;
    })
    .catch(() => {
      // A failed read must not leave callers stuck; the default is a usable
      // answer, and clearing inFlight lets the next mount try again.
      inFlight = null;
      return { weekStartDay: DEFAULT_WEEK_START_DAY };
    });

  return inFlight;
}

export function useTimePreferences(): TimePreferences {
  const [weekStartDay, setDay] = useState<number>(
    () => cache?.weekStartDay ?? DEFAULT_WEEK_START_DAY
  );
  const [ready, setReady] = useState<boolean>(() => cache !== null);

  useEffect(() => {
    let alive = true;

    // Seed from localStorage first, so a reload does not flash the default
    // before the fetch lands.
    if (!cache) {
      try {
        const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
        if (stored && isValidWeekStartDay(Number(stored.weekStartDay))) {
          setDay(Number(stored.weekStartDay));
        }
      } catch {
        /* ignore */
      }
    }

    const onChange = (v: Stored) => {
      if (!alive) return;
      setDay(v.weekStartDay);
      setReady(true);
    };
    listeners.add(onChange);

    loadPreferences().then((v) => {
      if (!alive) return;
      setDay(v.weekStartDay);
      setReady(true);
    });

    const onReset = () => {
      clearTimePreferences();
      if (alive) setReady(false);
    };
    window.addEventListener("attendance-reset", onReset);

    return () => {
      alive = false;
      listeners.delete(onChange);
      window.removeEventListener("attendance-reset", onReset);
    };
  }, []);

  // The zone is a constant, not stored state — see lib/timePreferences.ts.
  return { timezone: APP_TIMEZONE, weekStartDay, ready };
}
