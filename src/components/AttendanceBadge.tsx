"use client";

import React from "react";
import { FaCheckCircle } from "react-icons/fa";
import { useAttendance } from "@/components/AttendanceContext";

export default function AttendanceBadge() {
  const { isMarkedPresent, timeIn, isLoading } = useAttendance();

  if (isLoading) return null;

  return (
    <>
      {!isMarkedPresent && (
        <button
          onClick={() => { window.location.href = "/dashboard?tab=attendance"; }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors shadow-sm cursor-pointer animate-pulse-slow"
        >
          <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
          <span className="text-xs font-bold whitespace-nowrap">Mark Attendance</span>
        </button>
      )}
      {isMarkedPresent && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm cursor-default"
          title={
            timeIn
              ? `Attendance marked at ${new Date(timeIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : "Attendance marked for today"
          }
        >
          <FaCheckCircle className="text-emerald-500 w-3 h-3" />
          <span className="text-xs font-bold whitespace-nowrap">
            Present Today {timeIn ? `(${new Date(timeIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})` : ""}
          </span>
        </div>
      )}
    </>
  );
}
