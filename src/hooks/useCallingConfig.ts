"use client";

// hooks/useCallingConfig.ts — "are the call buttons live?", fetched once.
//
// SWR is not a dependency of this project, and the reason to reach for it here
// would have been request deduplication: the call buttons render inside lead
// lists, so a naive useEffect+fetch would issue one request per row. The cache
// below is that dedup and nothing more — a single in-flight promise shared by
// every mounted instance, plus the resolved value for instances that mount
// later. Adding a data-fetching library to avoid twenty duplicate requests for
// two booleans would be the larger change.
//
// The answer changes only when an admin edits the settings, so it is fetched
// once per page load and not revalidated. `refreshCallingConfig()` exists for
// the settings panel to call after a save, so an admin sees the effect of their
// own change without a reload.

import { useEffect, useState } from "react";

export interface CallingConfig {
  /** Bolna credentials exist — without them the AI button cannot do anything. */
  aiCallingEnabled: boolean;
  /** Always true: `tel:` needs no credentials. Kept for symmetry at call sites. */
  manualCallingEnabled: boolean;
  /** "provider" = server-side click-to-call, "tel" = hand off to the device. */
  manualCallingMode: "provider" | "tel";
  /** False until the first response lands, so callers can avoid a flash. */
  loaded: boolean;
}

const FALLBACK: CallingConfig = {
  // Fail closed for AI calling: showing a live button that 400s is worse than a
  // disabled one, and the tooltip tells the user what to do either way.
  aiCallingEnabled: false,
  manualCallingEnabled: true,
  manualCallingMode: "tel",
  loaded: false,
};

let cached: CallingConfig | null = null;
let inFlight: Promise<CallingConfig> | null = null;
const subscribers = new Set<(c: CallingConfig) => void>();

function load(): Promise<CallingConfig> {
  if (inFlight) return inFlight;

  inFlight = fetch("/api/calling/status", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const next: CallingConfig = {
        aiCallingEnabled: Boolean(json?.aiCallingEnabled),
        manualCallingEnabled: json?.manualCallingEnabled !== false,
        manualCallingMode: json?.manualCallingMode === "provider" ? "provider" : "tel",
        loaded: true,
      };
      cached = next;
      subscribers.forEach((fn) => fn(next));
      return next;
    })
    .catch(() => {
      const next = { ...FALLBACK, loaded: true };
      cached = next;
      subscribers.forEach((fn) => fn(next));
      return next;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drops the cache and refetches. For the settings panel to call after a save. */
export function refreshCallingConfig() {
  cached = null;
  inFlight = null;
  load();
}

export function useCallingConfig(): CallingConfig {
  const [config, setConfig] = useState<CallingConfig>(cached ?? FALLBACK);

  useEffect(() => {
    let active = true;
    const update = (c: CallingConfig) => {
      if (active) setConfig(c);
    };
    subscribers.add(update);

    if (cached) update(cached);
    else load();

    return () => {
      active = false;
      subscribers.delete(update);
    };
  }, []);

  return config;
}
