// lib/hooks/useOrgName.ts — fetches the current organisation's display name.
//
// This hook is the single source of truth for the org name in the sidebar. It:
//   - Calls GET /api/settings/org-name once on mount (all roles have access).
//   - Returns { name, loading } — never throws; errors surface as name === null.
//   - Is safe to call inside any "use client" component without lifting state.
//
// The session cookie (not localStorage) drives server-side tenant resolution, so
// the name is always consistent with the data the user actually sees — switching
// organisations would require a new login, which issues a new cookie, which
// causes a fresh fetch here.

"use client";

import { useEffect, useState } from "react";

export interface UseOrgNameResult {
  /** The workspace / organisation display name, or null while loading / on error. */
  name: string | null;
  loading: boolean;
}

export function useOrgName(): UseOrgNameResult {
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/settings/org-name")
      .then((r) => r.json())
      .then((data: { success: boolean; name: string | null }) => {
        if (!cancelled) setName(data.name ?? null);
      })
      .catch(() => {
        // Silent — sidebar will simply omit the name line.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { name, loading };
}
