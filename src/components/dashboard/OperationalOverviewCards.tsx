"use client";

import {
  FaPhoneAlt,
  FaCalendarAlt,
  FaHandshake,
  FaCheckCircle,
  FaMapMarkerAlt,
} from "react-icons/fa";
import type { OperationalKpi } from "./useDashboardKpis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- theme is untyped
type ThemeAny = any;

type Props = {
  operational: OperationalKpi;
  isLoading: boolean;
  theme: ThemeAny;
  isDark: boolean;
};

const CARDS = [
  {
    key: "callsDue" as const,
    label: "Calls Due",
    Icon: FaPhoneAlt,
    color: "#EF4444",
    lightBg: "bg-red-50",
    darkBg: "bg-red-500/10",
    lightText: "text-red-600",
    darkText: "text-red-400",
  },
  {
    key: "visitsToday" as const,
    label: "Visits Today",
    Icon: FaCalendarAlt,
    color: "#F59E0B",
    lightBg: "bg-amber-50",
    darkBg: "bg-amber-500/10",
    lightText: "text-amber-600",
    darkText: "text-amber-400",
  },
  {
    key: "inClosing" as const,
    label: "In Closing",
    Icon: FaHandshake,
    color: "#9E217B",
    lightBg: "bg-pink-50",
    darkBg: "bg-[#9E217B]/10",
    lightText: "text-[#9E217B]",
    darkText: "text-[#d946a8]",
  },
  {
    key: "confirmedBookings" as const,
    label: "Overall Closing",
    Icon: FaCheckCircle,
    color: "#10B981",
    lightBg: "bg-emerald-50",
    darkBg: "bg-emerald-500/10",
    lightText: "text-emerald-600",
    darkText: "text-emerald-400",
  },
  {
    key: "siteVisitsCompleted" as const,
    label: "Site Visits Completed",
    Icon: FaMapMarkerAlt,
    color: "#3B82F6",
    lightBg: "bg-blue-50",
    darkBg: "bg-blue-500/10",
    lightText: "text-blue-600",
    darkText: "text-blue-400",
  },
];

export default function OperationalOverviewCards({
  operational,
  isLoading,
  theme,
  isDark,
}: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-5 lg:mb-6">
      {CARDS.map((card) => {
        const value = operational[card.key];
        return (
          <div
            key={card.key}
            className={`${theme.card} rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 transition-all`}
            style={theme.cardGlass}
          >
            <div
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? card.darkBg : card.lightBg}`}
            >
              <card.Icon
                className={`text-sm sm:text-base ${isDark ? card.darkText : card.lightText}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wider ${theme.textFaint} truncate`}
              >
                {card.label}
              </p>
              <p
                className={`text-xl sm:text-2xl font-black mt-0.5 ${isDark ? card.darkText : card.lightText}`}
              >
                {isLoading ? (
                  <span className="inline-block w-8 h-6 rounded bg-current/10 animate-pulse" />
                ) : (
                  value.toLocaleString("en-IN")
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
