/**
 * Shared working-hours calculation for attendance.
 *
 * Both Attendance Tracker (admin) and My Attendance (employee) import
 * these functions so the duration logic is defined in exactly one place.
 *
 * All durations are in integer seconds.
 */

/**
 * Compute the elapsed seconds for a single session.
 *
 * @param sessionStart  ISO timestamp of session start (nullable)
 * @param sessionEnd    ISO timestamp of session end (nullable for active sessions)
 * @param isActive      Whether the session is currently active
 * @param nowMs         Current time in epoch milliseconds (for active sessions)
 * @returns             Duration in seconds, or null if the inputs are invalid/missing
 */
export function computeSessionSeconds(
  sessionStart: string | null | undefined,
  sessionEnd: string | null | undefined,
  isActive: boolean,
  nowMs: number,
): number | null {
  if (!sessionStart) return null;

  const startMs = new Date(sessionStart).getTime();
  if (isNaN(startMs)) return null;

  let endMs: number;
  if (isActive) {
    endMs = nowMs;
  } else if (sessionEnd) {
    endMs = new Date(sessionEnd).getTime();
    if (isNaN(endMs)) return null;
  } else {
    // Inactive with no recorded end — cannot determine duration
    return null;
  }

  const sec = Math.floor((endMs - startMs) / 1000);
  // Negative duration means timestamps are inconsistent — flag as invalid
  return sec >= 0 ? sec : null;
}

/**
 * Sum durations across multiple sessions for a daily total.
 *
 * @param sessions  Array of session objects with session_start, session_end, session_is_active
 * @param nowMs     Current time in epoch milliseconds
 * @returns         Total seconds (0 if no valid sessions)
 */
export function computeDailyTotalSeconds(
  sessions: Array<{
    session_start?: string | null;
    session_end?: string | null;
    session_is_active?: boolean;
    is_active?: boolean;
  }>,
  nowMs: number,
): number {
  let total = 0;
  for (const s of sessions) {
    const active = !!(s.session_is_active ?? s.is_active);
    const sec = computeSessionSeconds(s.session_start, s.session_end, active, nowMs);
    if (sec != null) total += sec;
  }
  return total;
}

/**
 * Format seconds as "XXh YYm" (hours and minutes, zero-padded).
 */
export function formatDurationHM(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Compute working hours as First Login → Final Logout/NOW for a day.
 *
 * Business rule: the duration spans the earliest valid login to the latest
 * valid logout (or the current time if any session is still active).
 * Breaks between sessions are NOT subtracted.
 *
 * @param sessions  All session rows for one employee on one day
 * @param nowMs     Current time in epoch milliseconds
 * @returns         Duration in seconds, or null if no valid sessions
 */
export function computeFirstToLastSeconds(
  sessions: Array<{
    session_start?: string | null;
    session_end?: string | null;
    session_is_active?: boolean;
    is_active?: boolean;
  }>,
  nowMs: number,
): number | null {
  if (!sessions || sessions.length === 0) return null;

  let firstLoginMs: number | null = null;
  let finalEndMs: number | null = null;
  let anyActive = false;

  for (const s of sessions) {
    if (!s.session_start) continue;
    const startMs = new Date(s.session_start).getTime();
    if (isNaN(startMs)) continue;

    // Track earliest login
    if (firstLoginMs === null || startMs < firstLoginMs) {
      firstLoginMs = startMs;
    }

    const active = !!(s.session_is_active ?? s.is_active);
    if (active) {
      anyActive = true;
      // Active session → end is NOW
      if (finalEndMs === null || nowMs > finalEndMs) {
        finalEndMs = nowMs;
      }
    } else if (s.session_end) {
      const endMs = new Date(s.session_end).getTime();
      if (!isNaN(endMs) && (finalEndMs === null || endMs > finalEndMs)) {
        finalEndMs = endMs;
      }
    }
    // Inactive with no session_end: skip for final-end calculation
  }

  if (firstLoginMs === null) return null;

  // If no valid end was found but sessions exist, cannot determine duration
  if (finalEndMs === null) return null;

  const sec = Math.floor((finalEndMs - firstLoginMs) / 1000);
  return sec >= 0 ? sec : null;
}

/**
 * Format seconds as "XXh YYm ZZs" (hours, minutes, seconds, zero-padded).
 */
export function formatDurationHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}
