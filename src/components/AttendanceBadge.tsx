import { useCallback, useEffect, useMemo, useState } from "react";
import { FaCheckCircle } from "react-icons/fa";
import { useAttendance } from "./AttendanceContext";

/** Same parsing trick as the rest of the attendance UI: `timeIn` is either a
 *  naive `timestamp` string (IST wall clock, no zone marker) or an ISO string
 *  the optimistic write already stamped — both need to resolve to the same
 *  instant so the header timer and the Admin/Site Head Live Timer column
 *  never drift apart. */
function parseTimeIn(timeIn?: string | Date | null): Date | null {
  if (!timeIn) return null;
  try {
    let parsed = String(timeIn);
    if (!parsed.includes("T") && !parsed.includes("Z") && parsed.includes(" ")) {
      parsed = parsed.replace(" ", "T") + "Z";
    }
    const d = new Date(parsed);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function formatElapsed(from: Date, now: number): string {
  const diff = Math.max(0, Math.floor((now - from.getTime()) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function AttendanceBadge({
  timeIn,
  isMarkedPresent,
  onLogout,
}: {
  timeIn?: string | Date | null;
  isMarkedPresent: boolean;
  onLogout?: () => void;
}) {
  const { markAttendanceOptimistic, refreshAttendance } = useAttendance();
  const [isPunching, setIsPunching] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Only ticks once there is something to tick — an idle interval for every
  // signed-out visitor of every page would be pure waste.
  useEffect(() => {
    if (!isMarkedPresent) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isMarkedPresent]);

  const punchedAt = useMemo(() => parseTimeIn(timeIn), [timeIn]);

  const markedAtLabel = useMemo(() => {
    if (!punchedAt) return "";
    return punchedAt.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  }, [punchedAt]);

  const elapsedLabel = useMemo(() => {
    if (!punchedAt) return "";
    return formatElapsed(punchedAt, now);
  }, [punchedAt, now]);

  // Punches the current user in directly through the existing attendance API —
  // the same endpoint AttendanceView's checkbox flow calls. The API resolves
  // the caller's own active session server-side, so no session_id is needed
  // here, and it is idempotent: a second call for an already-marked day just
  // echoes the existing record back instead of erroring, which combined with
  // the isPunching guard below is what stops a double-click from ever
  // producing two punches.
  const handleLoginClick = useCallback(async () => {
    if (isPunching) return;
    setIsPunching(true);
    try {
      const res = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        markAttendanceOptimistic(data.timeIn || new Date().toISOString());
        window.dispatchEvent(new Event("attendance-marked"));
        await refreshAttendance();
      } else {
        console.error("Failed to punch in", data);
      }
    } catch (e) {
      console.error("Failed to punch in", e);
    } finally {
      setIsPunching(false);
    }
  }, [isPunching, markAttendanceOptimistic, refreshAttendance]);

  if (!isMarkedPresent) {
    return (
      <button
        type="button"
        onClick={handleLoginClick}
        disabled={isPunching}
        title="Punch in for today"
        className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#FF3B30]/10 px-2.5 sm:px-3 text-[#FF3B30] hover:bg-[#FF3B30]/20 transition-colors duration-150 cursor-pointer border border-transparent disabled:opacity-60 disabled:cursor-wait"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B30] flex-shrink-0" />
        <span className="hidden sm:inline text-[11px] sm:text-[12px] font-medium tracking-wide whitespace-nowrap">
          {isPunching ? "Logging in…" : "Login"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onLogout?.()}
      title="Click to logout"
      className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#34C759]/10 px-2.5 sm:px-3 text-[#248A3D] dark:text-[#32D74B] hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] transition-colors duration-150 cursor-pointer border border-transparent group"
    >
      <FaCheckCircle className="text-[#34C759] group-hover:text-[#FF3B30] w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 transition-colors duration-150" />
      <span className="hidden sm:flex flex-col items-start leading-none">
        {markedAtLabel && (
          <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70 whitespace-nowrap">
            Logged in at {markedAtLabel}
          </span>
        )}
        <span className="text-[11px] sm:text-[12px] font-bold tracking-wide whitespace-nowrap font-mono mt-0.5">
          {elapsedLabel}
        </span>
      </span>
    </button>
  );
}
