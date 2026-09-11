/**
 * Returns whether the current user's role is allowed to delete follow-ups.
 * Fetches the org's follow-up deletion permission config once and caches it.
 *
 * Mirrors useRecordingDeletePermission.ts in structure and caching strategy.
 */

let cached: Record<string, boolean> | null = null;
let inFlight: Promise<Record<string, boolean>> | null = null;

function load(): Promise<Record<string, boolean>> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/settings/followup-deletion-permissions", {
    credentials: "include",
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const roles = data?.roles ?? { admin: true };
      cached = roles;
      return roles;
    })
    .catch(() => {
      cached = { admin: true };
      return cached as Record<string, boolean>;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

import { useEffect, useState } from "react";

export function useFollowUpDeletionPermission(
  roleKey: string | null | undefined
): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!roleKey) return;
    // Normalize to lowercase underscore key to match the API response shape.
    const normalized = roleKey.trim().toLowerCase().replace(/ /g, "_");

    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
export function refreshFollowUpDeletionPermission() {
  cached = null;
  inFlight = null;
}
