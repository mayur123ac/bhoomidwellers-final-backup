"use client";

// components/HeaderClock.tsx — live wall clock for the global header.
//
// The Profile screen's "Time Preferences" card claims the saved timezone is
// "used when displaying timestamps". This is the visible proof of that claim:
// it renders in APP_TIMEZONE rather than the browser's zone, so a laptop left
// on a foreign zone shows the office's time here, and the setting stops being
// a control that changes nothing.
//
// ── Hydration ───────────────────────────────────────────────────────────────
// The server renders at a different instant than the client hydrates, so any
// clock in server-rendered markup is a guaranteed text mismatch. It therefore
// renders a fixed-width placeholder until mounted — the placeholder reserves the
// same space, so the header does not shift when the time arrives.

import { useEffect, useState } from "react";
import { APP_TIMEZONE_ABBR, formatAppTime, formatAppWeekday, formatAppDate } from "@/lib/timePreferences";

export default function HeaderClock({
  isDark,
  className = "",
}: {
  isDark: boolean;
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    // Aligned to the next second boundary, then ticked every second. A plain
    // 1000ms interval started mid-second makes the displayed seconds jump by
    // two roughly once a minute as the drift accumulates.
    let interval: ReturnType<typeof setInterval>;
    const align = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 1000);
    }, 1000 - (Date.now() % 1000));

    return () => {
      clearTimeout(align);
      clearInterval(interval);
    };
  }, []);

  const border = isDark ? "border-white/10" : "border-[#E5E7EB]";
  const bg = isDark ? "bg-white/[0.04]" : "bg-white";
  const timeColor = isDark ? "text-gray-100" : "text-[#111827]";
  const metaColor = isDark ? "text-gray-400" : "text-[#6B7280]";

  return (
    <div
      className={`hidden sm:flex h-9 flex-shrink-0 items-center gap-2 rounded-lg border px-2.5 ${border} ${bg} ${className}`}
      // The full date is not shown at this size, so it lives in the tooltip
      // rather than being unavailable.
      title={now ? `${formatAppDate(now)} · ${APP_TIMEZONE_ABBR}` : undefined}
      aria-label="Current time"
    >
      {/* aria-live off: a clock announcing itself every second would make the
          header unusable with a screen reader. The value is still readable on
          demand via the label above. */}
      <span
        className={`font-mono text-[12px] font-semibold leading-none tabular-nums ${timeColor}`}
        suppressHydrationWarning
      >
        {now ? formatAppTime(now, true) : "--:--:-- --"}
      </span>
      <span className={`hidden lg:inline text-[10px] font-medium leading-none ${metaColor}`}>
        {now ? `${formatAppWeekday(now)} · ${APP_TIMEZONE_ABBR}` : APP_TIMEZONE_ABBR}
      </span>
    </div>
  );
}
