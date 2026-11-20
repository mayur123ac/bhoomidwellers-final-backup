"use client";

import { useMemo } from "react";
import type { OperationalKpi, AllTeamKpi } from "./useDashboardKpis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- theme is untyped
type ThemeAny = any;

function getGreeting(): string {
  const now = new Date();
  // Convert to IST
  const istHour = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  ).getHours();

  if (istHour < 12) return "GOOD MORNING";
  if (istHour < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).toUpperCase();
}

function buildSummary(op: OperationalKpi, allTeam: AllTeamKpi): string {
  const parts: string[] = [];
  if (allTeam.confirmedBookings > 0) {
    parts.push(
      `${allTeam.confirmedBookings} deal${allTeam.confirmedBookings === 1 ? " is" : "s are"} successfully booked`
    );
  }
  if (allTeam.siteVisitsCompletedThisMonth > 0) {
    parts.push(
      `${allTeam.siteVisitsCompletedThisMonth} completed site visit${allTeam.siteVisitsCompletedThisMonth === 1 ? "" : "s"} recorded this month`
    );
  }
  if (op.callsDue > 0) {
    parts.push(`${op.callsDue} lead${op.callsDue === 1 ? "" : "s"} waiting on first contact`);
  }
  if (parts.length === 0) return "All systems operational.";
  return parts.join(" and ") + ".";
}

type Props = {
  userName: string;
  operational: OperationalKpi;
  allTeam: AllTeamKpi;
  theme: ThemeAny;
  isDark: boolean;
};

export default function DashboardWelcomeHeader({ userName, operational, allTeam, theme, isDark }: Props) {
  const greeting = useMemo(() => getGreeting(), []);
  const date = useMemo(() => getFormattedDate(), []);
  const summary = useMemo(() => buildSummary(operational, allTeam), [operational, allTeam]);

  const initials = (userName || "A")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-start gap-3 sm:gap-4 mb-5 lg:mb-6">
      {/* Avatar */}
      <div
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-black text-sm sm:text-base shadow-lg shrink-0"
        style={{ background: "linear-gradient(135deg, #10B981, #059669)" }}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`text-[10px] sm:text-[11px] font-bold tracking-[0.15em] ${theme.textFaint}`}
        >
          {date}
        </p>
        <h2 className={`text-lg sm:text-xl font-black tracking-tight ${theme.text}`}>
          {greeting},{" "}
          <span className={isDark ? "text-[#d946a8]" : "text-[#9E217B]"}>
            {userName || "Admin"}
          </span>
        </h2>
        <p className={`text-xs sm:text-sm mt-0.5 ${theme.textMuted} line-clamp-2`}>
          {summary}
        </p>
      </div>
    </div>
  );
}
