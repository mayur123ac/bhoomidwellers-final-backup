import { useEffect, useState } from "react";

/**
 * Returns whether the current user's role is allowed to delete recordings.
 * Fetches the org's recording permission config once and caches it.
 */

let cached: Record<string, boolean> | null = null;
let inFlight: Promise<Record<string, boolean>> | null = null;

function load(): Promise<Record<string, boolean>> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/settings/recording-permissions", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const roles = data?.roles ?? { admin: true };
      cached = roles;
      return roles;
    })
    .catch(() => {
      cached = { admin: true };
      return cached;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function useRecordingDeletePermission(roleKey: string | null | undefined): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!roleKey) return;
    const normalized = roleKey.trim().toLowerCase().replace(/ /g, "_");

    if (cached) {
      setAllowed(cached[normalized] === true);
      return;
    }

    load().then((roles) => {
      setAllowed(roles[normalized] === true);
    });
  }, [roleKey]);

  return allowed;
}

/** Force refetch after settings change. */
export function refreshRecordingDeletePermission() {
  cached = null;
  inFlight = null;
}
