"use client";

import {
  FaBuilding,
  FaMapMarkerAlt,
  FaHandshake,
  FaRupeeSign,
} from "react-icons/fa";
import type { EmployeeKpi, AllTeamKpi } from "./useDashboardKpis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- theme is untyped
type ThemeAny = any;

type Props = {
  selectedId: number | null;
  employees: EmployeeKpi[];
  allTeam: AllTeamKpi;
  isAdmin: boolean;
  isLoading: boolean;
  theme: ThemeAny;
  isDark: boolean;
};

function formatSpent(value: number): string {
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

export default function PerformanceKPICards({
  selectedId,
  employees,
  allTeam,
  isAdmin,
  isLoading,
  theme,
  isDark,
}: Props) {
  // Resolve the data source
  const emp = selectedId !== null
    ? employees.find(e => e.id === selectedId)
    : null;

  const data = emp || allTeam;

  const cards = [
    {
      label: "Enquiries",
      Icon: FaBuilding,
      iconBg: isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600",
      value: data.totalLeads,
      monthValue: data.totalLeadsThisMonth,
      valueColor: isDark ? "text-blue-400" : "text-blue-600",
    },
    {
      label: "Site Visits",
      Icon: FaMapMarkerAlt,
      iconBg: isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-600",
      value: data.siteVisitsCompleted,
      monthValue: data.siteVisitsCompletedThisMonth,
      valueColor: isDark ? "text-emerald-400" : "text-emerald-600",
    },
    {
      label: "Sales",
      Icon: FaHandshake,
      iconBg: isDark ? "bg-[#9E217B]/20 text-[#d946a8]" : "bg-pink-100 text-[#9E217B]",
      value: data.confirmedBookings,
      monthValue: data.confirmedBookingsThisMonth,
      valueColor: isDark ? "text-[#d946a8]" : "text-[#9E217B]",
    },
  ];

  // Spent card — admin only
  if (isAdmin) {
    cards.push({
      label: "Spent",
      Icon: FaRupeeSign,
      iconBg: isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-600",
      value: data.spent ?? 0,
      monthValue: 0, // Monthly spend requires per-period payroll data — show 0 until available
      valueColor: isDark ? "text-orange-400" : "text-orange-600",
    });
  }

  return (
    <div className={`grid grid-cols-2 ${isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-2 sm:gap-3 mb-5 lg:mb-6`}>
      {cards.map((card) => (
        <div
          key={card.label}
          className={`${theme.card} rounded-2xl p-4 flex flex-col gap-2.5 relative overflow-hidden`}
          style={theme.cardGlass}
        >
          {/* Top row: icon + label */}
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.iconBg}`}>
              <card.Icon className="text-[13px]" />
            </div>
            <span className={`text-[11px] font-semibold ${theme.textMuted}`}>
              {card.label}
            </span>
          </div>

          {/* Big value */}
          <div className={`text-2xl sm:text-3xl font-black tracking-tight ${card.valueColor}`}>
            {isLoading ? (
              <span className="inline-block w-10 h-7 rounded bg-current/10 animate-pulse" />
            ) : card.label === "Spent" ? (
              <>
                <span className="text-lg font-bold">&#8377;</span>
                {formatSpent(card.value)}
              </>
            ) : (
              card.value.toLocaleString("en-IN")
            )}
          </div>

          {/* Month sub-label */}
          <div className={`text-[10px] font-semibold ${theme.textFaint}`}>
            Month{" "}
            <span className={theme.text}>
              {isLoading
                ? "..."
                : card.label === "Spent"
                  ? `\u20B9${formatSpent(card.monthValue)}`
                  : card.monthValue.toLocaleString("en-IN")}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
