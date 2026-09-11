import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaCheckCircle } from "react-icons/fa";
import { CheckCircle2, X } from "lucide-react";
import { useAttendance } from "./AttendanceContext";
import { getStoredCrmUser } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";

/** Parses a login/logout timestamp from the server.
 *  Accepts bare IST wall-clock strings (no Z) and real ISO strings. */
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

function formatElapsed(from: Date, nowMs: number): string {
  const diff = Math.max(0, Math.floor((nowMs - from.getTime()) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function formatWorkingTrack(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

function timeGreeting(): string {
  const h = new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" });
  const hour = parseInt(h, 10);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ── Popup (auto-dismiss toast) ────────────────────────────────────────────────
function AttendancePopup({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] animate-fadeIn">
      <div className="bg-white dark:bg-[#1C1C2A] border border-gray-200 dark:border-[#2A2A35] rounded-2xl shadow-2xl px-6 py-4 text-center min-w-[220px]">
        {children}
      </div>
    </div>,
    document.body
  );
}

// ── Day Complete confirmation dialog ─────────────────────────────────────────
function DayCompleteConfirmDialog({
  open,
  isDark,
  isConfirming,
  onClose,
  onConfirm,
}: {
  open: boolean;
  isDark: boolean;
  isConfirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 sm:p-6 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !isConfirming) onClose(); }}
    >
      <div
        className={`w-full max-w-sm overflow-hidden rounded-xl border shadow-2xl ${isDark ? "border-[#2a2a2a] bg-[#171717] text-white" : "border-gray-200 bg-white text-[#1A1A1A]"
          }`}
      >
        {/* Header */}
        <div
          className={`flex items-start justify-between gap-4 border-b p-5 ${isDark ? "border-[#2a2a2a] bg-[#1f1f1f]" : "border-gray-100 bg-gray-50"
            }`}
        >
          <div className="flex gap-3">
            <div className={`mt-0.5 rounded-lg p-2 w-10 h-10 ${isDark ? "bg-green-500/10 text-green-400" : "bg-green-50 text-green-600"}`}>
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className={`text-base font-black ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                Are you sure you want to complete your day?
              </h2>
              <p className={`mt-1 text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                Once completed, your attendance for today will be marked as done.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isConfirming}
            className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? "text-gray-400 hover:bg-white/5 hover:text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              }`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Footer */}
        <div className={`flex flex-col-reverse gap-3 p-5 sm:flex-row sm:justify-end ${isDark ? "bg-[#151515]" : "bg-white"}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={isConfirming}
            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? "text-gray-300 hover:bg-white/5 hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-black text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70 bg-red-600 hover:bg-red-500"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isConfirming ? "Completing…" : "Yes, Complete Day"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Goodbye modal (shown after successful day complete) ───────────────────────
function GoodbyeModal({
  open,
  isDark,
  userName,
  onDone,
}: {
  open: boolean;
  isDark: boolean;
  userName: string;
  onDone: () => void;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 sm:p-6 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
    >
      <div
        className={`w-full max-w-sm overflow-hidden rounded-xl border shadow-2xl ${isDark ? "border-[#2a2a2a] bg-[#171717] text-white" : "border-gray-200 bg-white text-[#1A1A1A]"
          }`}
      >
        {/* Header */}
        <div
          className={`flex items-start gap-4 border-b p-5 ${isDark ? "border-[#2a2a2a] bg-[#1f1f1f]" : "border-gray-100 bg-gray-50"
            }`}
        >
          <div className={`mt-0.5 rounded-lg p-2 ${isDark ? "bg-green-500/10 text-green-400" : "bg-green-50 text-green-600"}`}>
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className={`text-base font-black ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
              Goodbye, {userName || "take care"}! 👋
            </h2>
            <p className={`mt-1 text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              Your day has been marked as complete. Have a great day!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className={`flex justify-end p-5 ${isDark ? "bg-[#151515]" : "bg-white"}`}>
          <button
            type="button"
            onClick={onDone}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-black text-white transition-colors bg-green-600 hover:bg-green-500`}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AttendanceBadge({
  timeIn,
  isMarkedPresent,
  // onLogout kept in the prop type for backward compatibility — all existing
  // callers pass it. The badge no longer triggers a full CRM logout; the
  // dedicated "Done for the Day" action ends attendance instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onLogout,
}: {
  timeIn?: string | Date | null;
  isMarkedPresent: boolean;
  onLogout?: () => void;
}) {
  const {
    markAttendanceOptimistic,
    markDayComplete,
    refreshAttendance,
    isDayCompleted,
    logoutTime,
    workingTrack,
  } = useAttendance();

  const { isDark } = useCrmTheme();

  const userName = useMemo(() => {
    const u = getStoredCrmUser();
    return (u?.name as string | undefined) ?? "";
  }, []);

  // ── Timer state ───────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());

  // Tick only while attendance is active (not completed, not absent)
  useEffect(() => {
    if (!isMarkedPresent || isDayCompleted) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isMarkedPresent, isDayCompleted]);

  const punchedAt = useMemo(() => parseTimeIn(timeIn), [timeIn]);

  const markedAtLabel = useMemo(() => {
    if (!punchedAt) return "";
    return punchedAt.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  }, [punchedAt]);

  // Live elapsed (only used in ATTENDANCE_ACTIVE state)
  const liveElapsed = useMemo(() => {
    if (!punchedAt) return "";
    return formatElapsed(punchedAt, now);
  }, [punchedAt, now]);

  // Frozen elapsed from punch-in to checkout (used in DAY_COMPLETED state)
  const frozenElapsed = useMemo(() => {
    if (!punchedAt || !logoutTime) return "";
    const logoutDate = parseTimeIn(logoutTime);
    if (!logoutDate) return "";
    return formatElapsed(punchedAt, logoutDate.getTime());
  }, [punchedAt, logoutTime]);

  // ── Action state ──────────────────────────────────────────────────────────
  const [isPunching, setIsPunching] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // Confirmation dialog (shown before executing checkout)
  const [showDayCompleteConfirm, setShowDayCompleteConfirm] = useState(false);
  // Goodbye modal (shown after successful checkout)
  const [showGoodbyeModal, setShowGoodbyeModal] = useState(false);

  // ── Mark Attendance ───────────────────────────────────────────────────────
  // Same API call as before — idempotent, uses existing endpoint unchanged.
  const handleMarkAttendance = useCallback(async () => {
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
        setShowWelcome(true);
        setTimeout(() => setShowWelcome(false), 3000);
        await refreshAttendance();
      } else {
        console.error("Failed to mark attendance", data);
      }
    } catch (e) {
      console.error("Failed to mark attendance", e);
    } finally {
      setIsPunching(false);
    }
  }, [isPunching, markAttendanceOptimistic, refreshAttendance]);

  // ── Done for the Day ──────────────────────────────────────────────────────
  // Existing checkout logic unchanged — called only after user confirms.
  const handleCheckout = useCallback(async () => {
    if (isCheckingOut || isDayCompleted) return;
    setShowDayCompleteConfirm(false);
    setIsCheckingOut(true);
    try {
      const res = await fetch("/api/attendance/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        markDayComplete(data.logoutTime || new Date().toISOString(), data.workingTrack ?? null);
        setShowGoodbyeModal(true);
        await refreshAttendance();
      } else {
        console.error("Checkout failed", data);
      }
    } catch (e) {
      console.error("Checkout error", e);
    } finally {
      setIsCheckingOut(false);
    }
  }, [isCheckingOut, isDayCompleted, markDayComplete, refreshAttendance]);

  // ── Render ────────────────────────────────────────────────────────────────

  // STATE 1: NOT_MARKED
  if (!isMarkedPresent) {
    return (
      <>
        <button
          type="button"
          onClick={handleMarkAttendance}
          disabled={isPunching}
          title="Mark your attendance for today"
          className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#FF3B30]/10 px-2 sm:px-3 text-[#FF3B30] hover:bg-[#FF3B30]/20 transition-colors duration-150 cursor-pointer border border-transparent disabled:opacity-60 disabled:cursor-wait"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B30] flex-shrink-0" />
          <span className="hidden sm:inline text-[11px] sm:text-[12px] font-medium tracking-wide whitespace-nowrap">
            {isPunching ? "Marking…" : "Mark Attendance"}
          </span>
        </button>

        <AttendancePopup show={showWelcome}>
          <p className="text-base font-bold text-gray-900 dark:text-white">
            {timeGreeting()}, {userName || "Welcome"}! 👋
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Attendance marked for today.</p>
        </AttendancePopup>
      </>
    );
  }

  // STATE 3: DAY_COMPLETED
  if (isDayCompleted) {
    return (
      <>
        <div
          title="Day complete — attendance recorded"
          className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-gray-100 dark:bg-white/5 px-2.5 sm:px-3 text-gray-500 dark:text-gray-400 border border-transparent"
        >
          <FaCheckCircle className="text-gray-400 dark:text-gray-500 w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
          <span className="hidden sm:flex flex-col items-start leading-none">
            {markedAtLabel && (
              <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70 whitespace-nowrap">
                Day complete · in at {markedAtLabel}
              </span>
            )}
            {(workingTrack != null || frozenElapsed) && (
              <span className="text-[11px] sm:text-[12px] font-bold tracking-wide whitespace-nowrap font-mono mt-0.5">
                {workingTrack != null ? formatWorkingTrack(workingTrack) : frozenElapsed}
              </span>
            )}
          </span>
        </div>

        <GoodbyeModal
          open={showGoodbyeModal}
          isDark={isDark}
          userName={userName}
          onDone={() => setShowGoodbyeModal(false)}
        />
      </>
    );
  }

  // STATE 2: ATTENDANCE_ACTIVE
  return (
    <>
      <button
        type="button"
        onClick={() => setShowDayCompleteConfirm(true)}
        disabled={isCheckingOut}
        title="Mark done for the day"
        className="h-8 sm:h-9 flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#34C759]/10 px-2.5 sm:px-3 text-[#248A3D] dark:text-[#32D74B] hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] transition-colors duration-150 cursor-pointer border border-transparent group disabled:opacity-60 disabled:cursor-wait"
      >
        <FaCheckCircle className="text-[#34C759] group-hover:text-[#FF3B30] w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 transition-colors duration-150" />
        <span className="hidden sm:flex flex-col items-start leading-none">
          {markedAtLabel && (
            <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70 whitespace-nowrap group-hover:opacity-100">
              {isCheckingOut ? "Checking out…" : `Logged in at ${markedAtLabel}`}
            </span>
          )}
          <span className="text-[11px] sm:text-[12px] font-bold tracking-wide whitespace-nowrap font-mono mt-0.5">
            {isCheckingOut ? "Please wait…" : liveElapsed}
          </span>
        </span>
      </button>

      <DayCompleteConfirmDialog
        open={showDayCompleteConfirm}
        isDark={isDark}
        isConfirming={isCheckingOut}
        onClose={() => setShowDayCompleteConfirm(false)}
        onConfirm={handleCheckout}
      />

      <GoodbyeModal
        open={showGoodbyeModal}
        isDark={isDark}
        userName={userName}
        onDone={() => setShowGoodbyeModal(false)}
      />
    </>
  );
}
