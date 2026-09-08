"use client";
// usePresenceRefresh — triggers a callback when employee presence changes.
//
// Reuses the same Supabase Realtime org channel and event names that the
// Attendance Tracker (LiveActivityView / useActivityTracker) already broadcasts:
//   - activity.session_update  (heartbeat state changes)
//   - activity.attendance_sync (login / logout / attendance mark)
//
// No new subscriptions, no new events, no new tables — this is a thin
// consumer of the existing presence infrastructure.

import { useCallback, useMemo, useRef } from "react";
import { useRealtimeOrg } from "@/lib/supabase/useRealtimeOrg";

/** Read the org claim from the stored CRM user.
 *  Matches the pattern used by useActivityTracker and LiveActivityView. */
function getOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    // Login stores the user under "crm_user" (see app/page.tsx).
    const raw = localStorage.getItem("crm_user");
    if (!raw) return null;
    return JSON.parse(raw)?.org || null;
  } catch {
    return null;
  }
}

/**
 * Subscribes to realtime presence events and invokes `onPresenceChange`
 * whenever any employee's session state changes within the organization.
 *
 * The callback should be a stable reference (useCallback) to avoid
 * re-subscribing on every render.
 */
export function usePresenceRefresh(onPresenceChange: () => void, enabled = true) {
  const orgId = useMemo(getOrgId, []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce: batch rapid events (e.g. multiple heartbeats) into one callback
  const debouncedChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onPresenceChange();
    }, 2_000);
  }, [onPresenceChange]);

  const events = useMemo(() => ({
    "activity.session_update": () => debouncedChange(),
    "activity.attendance_sync": () => debouncedChange(),
  }), [debouncedChange]);

  useRealtimeOrg({ organizationId: orgId, events, enabled });
}
