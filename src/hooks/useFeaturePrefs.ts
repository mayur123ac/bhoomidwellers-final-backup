"use client";

// hooks/useFeaturePrefs.ts — the signed-in user's Additional Features choices,
// fetched once and shared.
//
// Deliberately modelled on useCallingConfig: same single-flight cache, same
// subscriber set, same reason (no SWR in this project, and these values are read
// from several places on one screen). The difference is what happens before the
// answer arrives — see below.
//
// ── Why the defaults are optimistic ──────────────────────────────────────────
// useCallingConfig fails closed, because a live-looking call button that 400s is
// worse than a disabled one. Here the opposite is true: every toggle governs
// something already on screen, so a pessimistic default would blank the
// follow-up badge for a moment on every page load and read as a bug. So the
// pre-load value is DEFAULT_FEATURE_PREFS and a user who has turned something
// off sees it switch off once their row lands, rather than everyone watching it
// switch on.

import { useEffect, useState } from "react";
import { DEFAULT_FEATURE_PREFS, mergeFeaturePrefs, type FeaturePrefs } from "@/lib/featurePrefs";

let cached: FeaturePrefs | null = null;
let inFlight: Promise<FeaturePrefs> | null = null;
const subscribers = new Set<(p: FeaturePrefs) => void>();

function publish(next: FeaturePrefs): FeaturePrefs {
  cached = next;
  subscribers.forEach((fn) => fn(next));
  return next;
}

function load(): Promise<FeaturePrefs> {
  if (inFlight) return inFlight;

  inFlight = fetch("/api/settings/feature-prefs", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    // mergeFeaturePrefs rather than a raw assignment: a 401 or an old response
    // shape then reads as "all defaults" instead of undefined toggles.
    .then((json) => publish(mergeFeaturePrefs(json?.prefs)))
    .catch(() => publish({ ...DEFAULT_FEATURE_PREFS, toggles: { ...DEFAULT_FEATURE_PREFS.toggles } }))
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** For the settings screen to call after a save, so open dashboards catch up. */
export function refreshFeaturePrefs() {
  cached = null;
  inFlight = null;
  load();
}

export function useFeaturePrefs(): FeaturePrefs {
  const [prefs, setPrefs] = useState<FeaturePrefs>(cached ?? DEFAULT_FEATURE_PREFS);

  useEffect(() => {
    let active = true;
    const update = (p: FeaturePrefs) => {
      if (active) setPrefs(p);
    };
    subscribers.add(update);

    if (cached) update(cached);
    else load();

    return () => {
      active = false;
      subscribers.delete(update);
    };
  }, []);

  return prefs;
}
