import { useMemo } from "react";
import { FaCheckCircle } from "react-icons/fa";

export default function AttendanceBadge({
  timeIn,
  isMarkedPresent,
  onNavigate
}: {
  timeIn?: string | Date | null;
  isMarkedPresent: boolean;
  onNavigate?: () => void;
}) {

  // Safely parse the database time and force it to UTC before converting to IST
  const markedAt = useMemo(() => {
    if (!timeIn) return "";
    try {
      let parsedTime = String(timeIn);

      // If the string lacks a timezone indicator (Z or T), format it as strict UTC ISO
      if (!parsedTime.includes("T") && !parsedTime.includes("Z") && parsedTime.includes(" ")) {
        parsedTime = parsedTime.replace(" ", "T") + "Z";
      }

      const d = new Date(parsedTime);
      if (isNaN(d.getTime())) return ""; // Fallback for invalid dates

      return d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
      });
    } catch {
      return "";
    }
  }, [timeIn]);

  if (!isMarkedPresent) {
    return (
      <button
        type="button"
        onClick={
          onNavigate ?? (() => {
            window.location.href = "/dashboard?tab=attendance";
          })
        }
        title="Attendance not marked for today"
        className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#FF3B30]/10 px-2.5 sm:px-3 text-[#FF3B30] hover:bg-[#FF3B30]/20 transition-colors duration-150 cursor-pointer border border-transparent"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B30] flex-shrink-0" />
        <span className="hidden sm:inline text-[11px] sm:text-[12px] font-medium tracking-wide whitespace-nowrap">
          Mark Login
        </span>
      </button>
    );
  }

  return (
    <div
      title={markedAt ? `Attendance marked at ${markedAt}` : "Attendance marked for today"}
      className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#34C759]/10 px-2.5 sm:px-3 text-[#248A3D] dark:text-[#32D74B] border border-transparent cursor-default"
    >
      <FaCheckCircle className="text-[#34C759] w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
      <span className="hidden sm:inline text-[11px] sm:text-[12px] font-medium tracking-wide whitespace-nowrap">
        Logged In
      </span>
    </div>
  );
}