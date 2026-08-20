"use client";

// components/superadmin/usePlatformData.ts
//
// Phase 2 swap: the views were written in Phase 1 against a `SuperAdminData`
// shape fed by mockData.ts. This hook fills that same shape from the platform
// APIs, so the view components did not have to change.
//
// mockData.ts is now unused by the running panel and is kept only as the shape's
// documentation; nothing imports its arrays any more.

import { useCallback, useEffect, useState } from "react";
import type { SuperAdminData, OrgRow, PlatformUser, ActivityEntry } from "./mockData";

export interface PlatformMetrics {
  organizations: number;
  active_organizations: number;
  users: number;
  active_users: number;
  leads: number;
  bookings: number;
}

export interface PlatformState {
  loading: boolean;
  error: string;
  metrics: PlatformMetrics | null;
  data: SuperAdminData;
  reload: () => void;
}

const EMPTY: SuperAdminData = { orgs: [], users: [], activity: [] };

/** Normalises one organization row from the API into the view's OrgRow. */
function toOrgRow(r: any): OrgRow {
  return {
    id: r.id,
    name: r.name,
    status: (r.status || "active") as OrgRow["status"],
    users: Number(r.users || 0),
    admins: Number(r.admins || 0),
    createdOn: r.created_at,
    lastActivity: r.last_activity ?? null,
    leads: Number(r.leads || 0),
    bookings: Number(r.bookings || 0),
    projects: Number(r.projects || 0),
  };
}

export function usePlatformData(): PlatformState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [data, setData] = useState<SuperAdminData>(EMPTY);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [m, o, u, a] = await Promise.all([
          fetch("/api/platform/metrics").then(r => r.json()),
          fetch("/api/platform/organizations").then(r => r.json()),
          fetch("/api/platform/users").then(r => r.json()),
          fetch("/api/platform/activity?limit=100").then(r => r.json()),
        ]);
        if (cancelled) return;

        // A 401/403 from any of them means the session is not (or is no longer)
        // a platform account. Surfaced rather than rendered as empty tables,
        // which would look like an empty platform.
        const failed = [m, o, u, a].find(x => !x?.success);
        if (failed) throw new Error(failed?.message || "Could not load platform data.");

        setMetrics(m.data);
        setData({
          orgs: (o.data || []).map(toOrgRow),
          users: (u.data || []) as PlatformUser[],
          activity: (a.data || []) as ActivityEntry[],
        });
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Could not load platform data.");
          setData(EMPTY);
          setMetrics(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  return { loading, error, metrics, data, reload };
}
