"use client";

import { FaRupeeSign } from "react-icons/fa";
import type { RevenueKpi } from "./useDashboardKpis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- theme is untyped
type ThemeAny = any;

type Props = {
  revenue: RevenueKpi | null;
  isLoading: boolean;
  theme: ThemeAny;
  isDark: boolean;
};

function formatINR(value: number): string {
  if (value >= 1_00_00_000) {
    return `${(value / 1_00_00_000).toFixed(1).replace(/\.0$/, "")} Cr`;
  }
  if (value >= 1_00_000) {
    return `${(value / 1_00_000).toFixed(1).replace(/\.0$/, "")}L`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toLocaleString("en-IN");
}

const METRICS = [
  { key: "totalBookedValue" as const, label: "Overall Booked Value", prefix: true },
  { key: "thisMonthBookedValue" as const, label: "This Month Booked", prefix: true },
  { key: "totalReceived" as const, label: "Overall Received", prefix: true },
  { key: "thisMonthReceived" as const, label: "This Month Received", prefix: true },
  { key: "outstandingBalance" as const, label: "Balance Receivable", prefix: true },
  { key: "totalConfirmedBookings" as const, label: "Confirmed Bookings", prefix: false },
];

export default function RevenueIntelligenceSection({
  revenue,
  isLoading,
  theme,
  isDark,
}: Props) {
  if (!revenue && !isLoading) return null;

  return (
    <div className="mb-5 lg:mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-600"}`}
        >
          <FaRupeeSign className="text-xs" />
        </div>
        <h3 className={`text-xs sm:text-sm font-bold uppercase tracking-wider ${theme.text}`}>
          Revenue Intelligence
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {METRICS.map((m) => {
          const value = revenue ? revenue[m.key] : 0;
          return (
            <div
              key={m.key}
              className={`${theme.card} rounded-xl p-3 sm:p-3.5`}
              style={theme.cardGlass}
            >
              <p
                className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${theme.textFaint} truncate`}
              >
                {m.label}
              </p>
              <p className={`text-base sm:text-lg font-black mt-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                {isLoading ? (
                  <span className="inline-block w-12 h-5 rounded bg-current/10 animate-pulse" />
                ) : m.prefix ? (
                  <>
                    <span className="text-xs font-bold mr-0.5">&#8377;</span>
                    {formatINR(value)}
                  </>
                ) : (
                  value.toLocaleString("en-IN")
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
