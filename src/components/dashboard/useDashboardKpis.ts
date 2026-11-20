import { useState, useEffect, useCallback, useRef } from "react";

export type EmployeeKpi = {
  id: number;
  name: string;
  role: string;
  totalLeads: number;
  totalLeadsThisMonth: number;
  siteVisitsCompleted: number;
  siteVisitsCompletedThisMonth: number;
  confirmedBookings: number;
  confirmedBookingsThisMonth: number;
  spent?: number;
  spentBreakdown?: { salary: number; incentives: number };
};

export type AllTeamKpi = {
  totalLeads: number;
  totalLeadsThisMonth: number;
  siteVisitsCompleted: number;
  siteVisitsCompletedThisMonth: number;
  confirmedBookings: number;
  confirmedBookingsThisMonth: number;
  spent?: number;
  spentBreakdown?: { salary: number; incentives: number };
};

export type OperationalKpi = {
  callsDue: number;
  visitsToday: number;
  inClosing: number;
  confirmedBookings: number;
  siteVisitsCompleted: number;
  siteVisitsCompletedThisMonth: number;
};

export type RevenueKpi = {
  totalBookedValue: number;
  thisMonthBookedValue: number;
  totalReceived: number;
  thisMonthReceived: number;
  outstandingBalance: number;
  totalConfirmedBookings: number;
};

export type DashboardKpiData = {
  operational: OperationalKpi;
  employees: EmployeeKpi[];
  allTeam: AllTeamKpi;
  revenue?: RevenueKpi;
};

const EMPTY_OPERATIONAL: OperationalKpi = {
  callsDue: 0, visitsToday: 0, inClosing: 0,
  confirmedBookings: 0, siteVisitsCompleted: 0, siteVisitsCompletedThisMonth: 0,
};

const EMPTY_ALL_TEAM: AllTeamKpi = {
  totalLeads: 0, totalLeadsThisMonth: 0,
  siteVisitsCompleted: 0, siteVisitsCompletedThisMonth: 0,
  confirmedBookings: 0, confirmedBookingsThisMonth: 0,
};

export function useDashboardKpis() {
  const [data, setData] = useState<DashboardKpiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchKpis = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/dashboard/overview-kpis", { signal: ac.signal });
      if (!res.ok) {
        if (res.status === 403) {
          setError("Access denied");
          setData(null);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        setError(null);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.error("[useDashboardKpis]", e);
      setError(e instanceof Error ? e.message : "Failed to fetch dashboard KPIs");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKpis();
    return () => { abortRef.current?.abort(); };
  }, [fetchKpis]);

  return {
    data,
    operational: data?.operational ?? EMPTY_OPERATIONAL,
    employees: data?.employees ?? [],
    allTeam: data?.allTeam ?? EMPTY_ALL_TEAM,
    revenue: data?.revenue ?? null,
    isLoading,
    error,
    refetch: fetchKpis,
  };
}
