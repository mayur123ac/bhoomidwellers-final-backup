"use client";

// AttendanceBadge — the header's attendance control.
//
// Behaviour is unchanged: same context, same "not marked → go and mark it"
// navigation, same tooltip, same hidden-while-loading. Only the presentation
// moved, and only to sit correctly beside the other header controls.
//
// What changed and why:
//   * h-9 to match HeaderControl, so the four controls share one baseline
//     instead of the pill floating a couple of pixels high.
//   * rounded-lg rather than rounded-full — a pill next to three rounded
//     squares was the single most obvious mismatch in the bar.
//   * The pulse animation is gone. It was the loudest thing on a page full of
//     lead data, and a dot plus a colour already says "unresolved".
//   * On narrow screens the label drops and the dot remains, so the bar does
//     not wrap.

import React from "react";
import { FaCheckCircle } from "react-icons/fa";
import { useAttendance } from "@/components/AttendanceContext";

export default function AttendanceBadge({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { isMarkedPresent, timeIn, isLoading } = useAttendance();

  if (isLoading) return null;

  const markedAt = timeIn
    ? new Date(timeIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  if (!isMarkedPresent) {
    return (
      <button
        type="button"
        /* `onNavigate` lets the host decide where "go and mark it" goes.
         *
         * The default below is the Admin dashboard's attendance tab, which is
         * correct for Admin and is what every existing caller gets by passing
         * nothing. It is NOT correct for a role that middleware confines to its
         * own path: a Receptionist sent to /dashboard is redirected straight to
         * /dashboard/receptionist, the `?tab=attendance` is dropped on the way,
         * and the click lands them on the default tab having done nothing.
         *
         * Hosts with an in-page attendance view should pass a handler instead —
         * it also avoids the full page reload that window.location.href forces,
         * so the dashboard's loaded state survives the click.
         */
        onClick={
          onNavigate ?? (() => {
            window.location.href = "/dashboard?tab=attendance";
          })
        }
        title="Attendance not marked for today"
        /* Geometry is deliberately identical to the marked state below and to
           HeaderClock: h-9, rounded-lg, gap-2, px-2.5 sm:px-3. The two states
           swap in and out of the same slot in the header, so any difference
           between them shows up as the bar twitching when attendance is
           marked. Only the colour differs. */
        className="h-9 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 sm:px-3 text-red-600 hover:bg-red-100 transition-colors duration-150 cursor-pointer"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
        <span className="hidden sm:inline text-xs font-semibold whitespace-nowrap">
          Mark Attendance
        </span>
      </button>
    );
  }

  return (
    <div
      title={markedAt ? `Attendance marked at ${markedAt}` : "Attendance marked for today"}
      className="h-9 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 sm:px-3 text-emerald-700 cursor-default"
    >
      <FaCheckCircle className="text-emerald-500 w-3.5 h-3.5 flex-shrink-0" />
      <span className="hidden sm:inline text-xs font-semibold whitespace-nowrap">
        Present{markedAt ? ` · ${markedAt}` : ""}
      </span>
    </div>
  );
}
