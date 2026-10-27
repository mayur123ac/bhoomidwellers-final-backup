// @vitest-environment node
//
// Working Hours Calculation Tests
//
// Tests the shared sessionDuration utility used by both Attendance Tracker
// (admin/LiveActivityView) and My Attendance (employee/AttendanceView).
//
// Business rule:
//   Working Hours = First Login of Day → Final Logout of Day
//   Breaks between sessions are NOT subtracted.

import { describe, expect, it } from "vitest";
import {
  computeSessionSeconds,
  computeDailyTotalSeconds,
  computeFirstToLastSeconds,
  formatDurationHM,
  formatDurationHMS,
} from "@/lib/attendance/sessionDuration";

// ── Single-session duration ────────────────────────────────────────────────

describe("computeSessionSeconds", () => {
  it("9:00 AM to 6:00 PM = 9 hours", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z", // 9:00 AM IST
      "2026-10-23T12:30:00.000Z", // 6:00 PM IST
      false, 0,
    );
    expect(sec).toBe(9 * 3600);
  });

  it("9:00 AM to 5:00 PM = 8 hours", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z",
      "2026-10-23T11:30:00.000Z",
      false, 0,
    );
    expect(sec).toBe(8 * 3600);
  });

  it("10:00 AM to 10:40 AM = 40 minutes", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T04:30:00.000Z",
      "2026-10-23T05:10:00.000Z",
      false, 0,
    );
    expect(sec).toBe(40 * 60);
  });

  it("active session: 9:00 AM, now = 11:00 AM => 2 hours", () => {
    const nowMs = new Date("2026-10-23T05:30:00.000Z").getTime();
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z", null, true, nowMs,
    );
    expect(sec).toBe(2 * 3600);
  });

  it("missing start timestamp returns null", () => {
    expect(computeSessionSeconds(null, null, false, Date.now())).toBeNull();
    expect(computeSessionSeconds(undefined, null, false, Date.now())).toBeNull();
    expect(computeSessionSeconds("", null, false, Date.now())).toBeNull();
  });

  it("active session with no end uses now", () => {
    const nowMs = new Date("2026-10-23T06:30:00.000Z").getTime();
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z", null, true, nowMs,
    );
    expect(sec).toBe(3 * 3600);
  });

  it("end before start returns null (invalid)", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T12:30:00.000Z",
      "2026-10-23T03:30:00.000Z",
      false, 0,
    );
    expect(sec).toBeNull();
  });

  it("session crossing midnight", () => {
    const sec = computeSessionSeconds(
      "2026-10-22T16:30:00.000Z",
      "2026-10-23T00:30:00.000Z",
      false, 0,
    );
    expect(sec).toBe(8 * 3600);
  });

  it("expired session uses last_heartbeat as session_end", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z",
      "2026-10-23T08:30:00.000Z",
      false, 0,
    );
    expect(sec).toBe(5 * 3600);
  });

  it("manual logout uses NOW() as session_end", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z",
      "2026-10-23T12:30:00.000Z",
      false, 0,
    );
    expect(sec).toBe(9 * 3600);
  });

  it("same inputs always produce same output (refresh-safe)", () => {
    const a = computeSessionSeconds("2026-10-23T03:30:00Z", "2026-10-23T12:30:00Z", false, 0);
    const b = computeSessionSeconds("2026-10-23T03:30:00Z", "2026-10-23T12:30:00Z", false, 0);
    expect(a).toBe(b);
    expect(a).toBe(9 * 3600);
  });

  it("inactive session with no end returns null", () => {
    const sec = computeSessionSeconds(
      "2026-10-23T03:30:00.000Z", null, false, Date.now(),
    );
    expect(sec).toBeNull();
  });

  it("invalid timestamp string returns null", () => {
    expect(computeSessionSeconds("not-a-date", null, false, Date.now())).toBeNull();
  });
});

// ── First Login → Final Logout (the business rule) ────────────────────────

describe("computeFirstToLastSeconds", () => {
  // 1. Login at 09:00 AM and logout at 06:00 PM gives 9 hours
  it("single session: 9:00 AM to 6:00 PM = 9 hours", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T12:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(9 * 3600);
  });

  // 2. Login at 09:00 AM with an active session shows live duration
  it("active session: first login 9:00 AM, now 11:00 AM = 2 hours (live)", () => {
    const nowMs = new Date("2026-10-23T05:30:00Z").getTime(); // 11:00 AM IST
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_is_active: true },
    ], nowMs);
    expect(sec).toBe(2 * 3600);
  });

  // 3. Multiple sessions use earliest login and final valid logout
  it("two sessions: 9-12 and 1-6 = 9 hours (first login to final logout)", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T06:30:00Z", session_is_active: false },
      { session_start: "2026-10-23T07:30:00Z", session_end: "2026-10-23T12:30:00Z", session_is_active: false },
    ], 0);
    // First login: 9:00 AM, Final logout: 6:00 PM = 9 hours (includes 1h break)
    expect(sec).toBe(9 * 3600);
  });

  // 4. Heartbeat-expired session does not erase working duration
  it("expired session with session_end still contributes", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T08:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(5 * 3600);
  });

  // 5. Manual logout and day completion produce correct results
  it("checkout at 6 PM after login at 9 AM = 9 hours", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T12:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(9 * 3600);
  });

  // 6. Missing logout timestamps — cannot determine end
  it("inactive session with no end returns null", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: null, session_is_active: false },
    ], Date.now());
    expect(sec).toBeNull();
  });

  // 7. Employee with visible logout time does NOT display "—"
  it("inactive session with session_end returns a valid duration (not null)", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T11:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).not.toBeNull();
    expect(sec).toBe(8 * 3600);
  });

  // 8. Multiple employees calculated independently
  it("different employees are separate calls", () => {
    const emp1 = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T12:30:00Z", session_is_active: false },
    ], 0);
    const emp2 = computeFirstToLastSeconds([
      { session_start: "2026-10-23T04:30:00Z", session_end: "2026-10-23T10:30:00Z", session_is_active: false },
    ], 0);
    expect(emp1).toBe(9 * 3600);
    expect(emp2).toBe(6 * 3600);
  });

  // 9. Midnight/date-boundary handling
  it("session crossing midnight calculates correctly", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-22T16:30:00Z", session_end: "2026-10-23T00:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(8 * 3600);
  });

  // 10. UTC timestamps display correctly in IST without changing durations
  it("UTC timestamps produce correct durations regardless of display timezone", () => {
    // 11:30 PM IST to 12:30 AM IST = 1 hour
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-22T18:00:00Z", session_end: "2026-10-22T19:00:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(3600);
  });

  // 11. Negative durations rejected
  it("returns null for negative duration (end before start)", () => {
    // This shouldn't happen in practice, but defensive
    // computeFirstToLastSeconds uses MIN(start) and MAX(end), so this
    // scenario requires a single session with end < start.
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T12:30:00Z", session_end: "2026-10-23T03:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBeNull();
  });

  // 12. Empty sessions
  it("empty array returns null", () => {
    expect(computeFirstToLastSeconds([], Date.now())).toBeNull();
  });

  // Multiple sessions with one still active uses NOW
  it("three sessions, last one active: first login → now", () => {
    const nowMs = new Date("2026-10-23T10:30:00Z").getTime(); // 4:00 PM IST
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T06:30:00Z", session_is_active: false },
      { session_start: "2026-10-23T07:30:00Z", session_end: "2026-10-23T08:30:00Z", session_is_active: false },
      { session_start: "2026-10-23T09:00:00Z", session_is_active: true },
    ], nowMs);
    // First login: 09:00 AM IST, NOW: 04:00 PM IST = 7 hours
    expect(sec).toBe(7 * 3600);
  });

  // Sessions with null start are skipped
  it("sessions with null start are skipped", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: null, session_end: null, session_is_active: false },
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T12:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(9 * 3600);
  });
});

// ── Legacy: Sum of sessions (computeDailyTotalSeconds) ───────────────────
// Kept for backward compatibility — other parts of the CRM may still use it.

describe("computeDailyTotalSeconds", () => {
  it("two sessions: 9-12 and 1-6 = 8 hours (sum, not first-to-last)", () => {
    const total = computeDailyTotalSeconds([
      { session_start: "2026-10-23T03:30:00Z", session_end: "2026-10-23T06:30:00Z", session_is_active: false },
      { session_start: "2026-10-23T07:30:00Z", session_end: "2026-10-23T12:30:00Z", session_is_active: false },
    ], 0);
    expect(total).toBe(8 * 3600);
  });

  it("empty session array returns 0", () => {
    expect(computeDailyTotalSeconds([], Date.now())).toBe(0);
  });
});

// ── Formatting ─────────────────────────────────────────────────────────────

describe("formatDurationHM", () => {
  it("9 hours", () => expect(formatDurationHM(9 * 3600)).toBe("09h 00m"));
  it("8 hours", () => expect(formatDurationHM(8 * 3600)).toBe("08h 00m"));
  it("40 minutes", () => expect(formatDurationHM(40 * 60)).toBe("00h 40m"));
  it("2 hours", () => expect(formatDurationHM(2 * 3600)).toBe("02h 00m"));
  it("zero", () => expect(formatDurationHM(0)).toBe("00h 00m"));
  it("24 hours", () => expect(formatDurationHM(86400)).toBe("24h 00m"));
  it("10h 30m", () => expect(formatDurationHM(10 * 3600 + 30 * 60)).toBe("10h 30m"));
});

describe("formatDurationHMS", () => {
  it("9h 0m 0s", () => expect(formatDurationHMS(9 * 3600)).toBe("09h 00m 00s"));
  it("0h 0m 30s", () => expect(formatDurationHMS(30)).toBe("00h 00m 30s"));
  it("1h 2m 3s", () => expect(formatDurationHMS(3723)).toBe("01h 02m 03s"));
});

// ── Timezone edge cases ─────────────────────────────────────────────────────

describe("timezone and date filtering", () => {
  it("UTC timestamps produce correct IST-equivalent durations", () => {
    const sec = computeSessionSeconds(
      "2026-10-22T18:00:00.000Z",
      "2026-10-22T19:00:00.000Z",
      false, 0,
    );
    expect(sec).toBe(3600);
  });

  it("session spanning IST midnight correctly computed", () => {
    const sec = computeSessionSeconds(
      "2026-10-22T17:30:00.000Z",
      "2026-10-22T20:30:00.000Z",
      false, 0,
    );
    expect(sec).toBe(3 * 3600);
  });
});

// ── Attendance span: the authoritative Working Hours metric ─────────────────
// These tests verify that Working Hours uses attendance timestamps
// (submitted_at → logout_time) NOT session durations.
//
// Business rule: working_seconds = day_completed_at − attendance_marked_at
// submitted_at records when "Mark Attendance" was clicked.
// logout_time records when "Done for the Day" was clicked.

/**
 * Mirrors the computeAttendanceSpan function in AttendanceView.tsx.
 * Extracted here for testing since the original is not exported.
 */
function computeAttendanceSpan(
  sessions: any[],
  now: number,
): number | null {
  if (!sessions || sessions.length === 0) return null;

  const row = sessions[0];
  const markedAtStr: string | null = row?.attendance_marked_at ?? null;
  const completedStr: string | null = row?.attendance_completed_at ?? null;

  if (markedAtStr) {
    const markedMs = new Date(markedAtStr).getTime();
    if (!isNaN(markedMs)) {
      if (completedStr) {
        const spanFromServer = row?.attendance_span_seconds;
        if (spanFromServer != null && Number(spanFromServer) >= 0) {
          return Math.floor(Number(spanFromServer));
        }
        const completedMs = new Date(completedStr).getTime();
        if (!isNaN(completedMs)) {
          const sec = Math.floor((completedMs - markedMs) / 1000);
          return sec >= 0 ? sec : null;
        }
      }
      const sec = Math.floor((now - markedMs) / 1000);
      return sec >= 0 ? sec : null;
    }
  }

  return computeFirstToLastSeconds(sessions, now);
}

describe("computeAttendanceSpan — authoritative Working Hours", () => {
  // THE BUG: 1:11 PM mark, 1:42 PM checkout = 31 minutes, but session was only 14 min
  // Formula: working_seconds = logout_time − submitted_at
  it("uses attendance span (31 min) not session duration (14 min)", () => {
    const sessions = [{
      // CRM session: only 14 minutes of online time
      session_start: "2026-10-26T08:17:00.000Z",  // 1:47 PM IST (late session start)
      session_end:   "2026-10-26T08:31:00.000Z",  // 2:01 PM IST
      session_is_active: false,
      // Attendance record: 31 minutes span (submitted_at → logout_time)
      attendance_marked_at:    "2026-10-26T07:41:00.000Z",  // 1:11 PM IST (submitted_at)
      attendance_completed_at: "2026-10-26T08:12:00.000Z",  // 1:42 PM IST (logout_time)
      attendance_span_seconds: 1860,  // 31 minutes
      attendance_working_track: 1860,
    }];
    const result = computeAttendanceSpan(sessions, 0);
    expect(result).toBe(1860);  // 31 minutes
    expect(formatDurationHM(result!)).toBe("00h 31m");

    // Verify that the OLD method would have given the wrong answer
    const oldResult = computeFirstToLastSeconds(sessions, 0);
    expect(oldResult).toBe(14 * 60);  // 14 minutes — WRONG
  });

  it("completed day: prefers server-computed attendance_span_seconds", () => {
    const sessions = [{
      session_start: "2026-10-26T03:30:00.000Z",
      session_end:   "2026-10-26T12:30:00.000Z",
      session_is_active: false,
      attendance_marked_at:   "2026-10-26T03:30:00.000Z",  // 9:00 AM IST
      attendance_completed_at: "2026-10-26T12:30:00.000Z",  // 6:00 PM IST
      attendance_span_seconds: 32400,  // 9 hours
    }];
    expect(computeAttendanceSpan(sessions, 0)).toBe(32400);
  });

  it("active day: computes live timer from attendance_marked_at to now", () => {
    const loginUtc = "2026-10-26T07:41:00.000Z";  // 1:11 PM IST
    const nowMs = new Date("2026-10-26T08:11:00.000Z").getTime();  // 1:41 PM IST
    const sessions = [{
      session_start: "2026-10-26T07:50:00.000Z",  // session started later
      session_is_active: true,
      attendance_marked_at: loginUtc,
      attendance_completed_at: null,
      attendance_span_seconds: null,  // no server span for active day (logout_time is null)
    }];
    const result = computeAttendanceSpan(sessions, nowMs);
    // 1:11 PM to 1:41 PM = 30 minutes
    expect(result).toBe(30 * 60);
  });

  it("active day: live timer ticks with client now, not stale server value", () => {
    const loginUtc = "2026-10-26T07:41:00.000Z";
    const now1 = new Date("2026-10-26T08:11:00.000Z").getTime();
    const now2 = new Date("2026-10-26T08:12:00.000Z").getTime();
    const sessions = [{
      session_start: "2026-10-26T07:50:00.000Z",
      session_is_active: true,
      attendance_marked_at: loginUtc,
      attendance_completed_at: null,
      // Even if server sent a stale span, active day ignores it
      attendance_span_seconds: 1500,
    }];
    const r1 = computeAttendanceSpan(sessions, now1);
    const r2 = computeAttendanceSpan(sessions, now2);
    // Must advance by 60 seconds between the two ticks
    expect(r2! - r1!).toBe(60);
  });

  it("no attendance record: falls back to session-based computation", () => {
    const sessions = [{
      session_start: "2026-10-26T03:30:00.000Z",
      session_end:   "2026-10-26T12:30:00.000Z",
      session_is_active: false,
      // No attendance_marked_at — employee didn't mark attendance
      attendance_marked_at: null,
      attendance_completed_at: null,
      attendance_span_seconds: null,
    }];
    const result = computeAttendanceSpan(sessions, 0);
    // Falls back to computeFirstToLastSeconds = session span
    expect(result).toBe(9 * 3600);
  });

  it("empty sessions returns null", () => {
    expect(computeAttendanceSpan([], Date.now())).toBeNull();
  });

  it("resuming attendance does NOT overwrite original login_time", () => {
    // Simulates: first mark at 9:00 AM, checkout at 12:00 PM, resume at 2:00 PM, checkout at 6:00 PM
    // The attendance_marked_at must still be 9:00 AM (first mark), not 2:00 PM (resume)
    const sessions = [{
      session_start: "2026-10-26T08:30:00.000Z",  // 2:00 PM IST (resume session)
      session_end:   "2026-10-26T12:30:00.000Z",  // 6:00 PM IST
      session_is_active: false,
      attendance_marked_at:   "2026-10-26T03:30:00.000Z",  // 9:00 AM IST — FIRST mark, never overwritten
      attendance_completed_at: "2026-10-26T12:30:00.000Z",  // 6:00 PM IST — LATEST checkout
      attendance_span_seconds: 32400,  // 9 hours (6 PM - 9 AM)
    }];
    const result = computeAttendanceSpan(sessions, 0);
    expect(result).toBe(32400);  // 9 hours, not 4 hours
    expect(formatDurationHM(result!)).toBe("09h 00m");
  });

  it("multiple sessions with shorter online time still shows full attendance span", () => {
    // Employee has 3 CRM sessions totaling 5 hours, but attendance span is 9 hours
    const sessions = [
      {
        session_start: "2026-10-26T03:30:00.000Z",
        session_end:   "2026-10-26T05:30:00.000Z",
        session_is_active: false,
        attendance_marked_at:   "2026-10-26T03:30:00.000Z",
        attendance_completed_at: "2026-10-26T12:30:00.000Z",
        attendance_span_seconds: 32400,
      },
      {
        session_start: "2026-10-26T07:30:00.000Z",
        session_end:   "2026-10-26T09:30:00.000Z",
        session_is_active: false,
        attendance_marked_at:   "2026-10-26T03:30:00.000Z",
        attendance_completed_at: "2026-10-26T12:30:00.000Z",
        attendance_span_seconds: 32400,
      },
      {
        session_start: "2026-10-26T11:30:00.000Z",
        session_end:   "2026-10-26T12:30:00.000Z",
        session_is_active: false,
        attendance_marked_at:   "2026-10-26T03:30:00.000Z",
        attendance_completed_at: "2026-10-26T12:30:00.000Z",
        attendance_span_seconds: 32400,
      },
    ];
    // All three rows carry the same attendance data
    const result = computeAttendanceSpan(sessions, 0);
    expect(result).toBe(32400);  // 9 hours attendance span

    // Session-based would give 9 hours too (first to last) in this case,
    // but verify the attendance span is used, not session computation
    expect(result).toBe(sessions[0].attendance_span_seconds);
  });

  // Exact user scenario: mark at 1:11 PM, checkout at 1:41 PM = 1800 seconds
  it("mark at 1:11 PM, checkout at 1:41 PM = exactly 1800 seconds (30 min)", () => {
    const sessions = [{
      session_start: "2026-10-26T07:30:00.000Z",
      session_end:   "2026-10-26T08:20:00.000Z",
      session_is_active: false,
      attendance_marked_at:    "2026-10-26T07:41:00.000Z",  // 1:11 PM IST (submitted_at)
      attendance_completed_at: "2026-10-26T08:11:00.000Z",  // 1:41 PM IST (logout_time)
      attendance_span_seconds: 1800,  // 30 minutes exactly
    }];
    const result = computeAttendanceSpan(sessions, 0);
    expect(result).toBe(1800);
    expect(formatDurationHM(result!)).toBe("00h 30m");
  });

  // Client-side fallback when server span is missing but both timestamps exist
  it("client-side fallback: submitted_at to logout_time without server span", () => {
    const sessions = [{
      session_start: "2026-10-26T07:30:00.000Z",
      session_end:   "2026-10-26T08:20:00.000Z",
      session_is_active: false,
      attendance_marked_at:    "2026-10-26T07:41:00.000Z",  // 1:11 PM IST
      attendance_completed_at: "2026-10-26T08:11:00.000Z",  // 1:41 PM IST
      attendance_span_seconds: null,  // server span missing
    }];
    const result = computeAttendanceSpan(sessions, 0);
    expect(result).toBe(1800);  // 30 minutes from timestamp math
  });
});

// ── My Attendance: Total Working / Session Log consistency ──────────────────
// These tests verify the scenarios from the bug where the Total Working card
// showed "00h 00m" and the Session Log Working Hours showed "—" despite valid
// session data existing.

describe("My Attendance working hours display", () => {
  // 1. Active session: live timer should produce a positive duration
  it("active session shows live working duration", () => {
    const nowMs = new Date("2026-10-25T10:30:00Z").getTime(); // 4:00 PM IST
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-25T07:33:00Z", session_is_active: true }, // 1:03 PM IST
    ], nowMs);
    expect(sec).not.toBeNull();
    expect(sec).toBe(Math.floor((nowMs - new Date("2026-10-25T07:33:00Z").getTime()) / 1000));
    expect(sec).toBeGreaterThan(0);
  });

  // 2. Completed session: first login to final logout
  it("completed session shows first-login-to-final-logout", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-25T07:33:00Z", session_end: "2026-10-25T12:30:00Z", session_is_active: false },
    ], 0);
    // 1:03 PM to 6:00 PM IST = 4h 57m = 17820s
    expect(sec).toBe(17820);
    expect(formatDurationHM(/** @type {number} */ (sec))).toBe("04h 57m");
  });

  // 3. Total Working card and Session Log must use the same value
  it("card and table use the same computeFirstToLastSeconds result", () => {
    const nowMs = new Date("2026-10-25T10:30:00Z").getTime();
    const sessions = [
      { session_start: "2026-10-25T03:30:00Z", session_end: "2026-10-25T06:30:00Z", session_is_active: false },
      { session_start: "2026-10-25T07:30:00Z", session_is_active: true },
    ];
    const total = computeFirstToLastSeconds(sessions, nowMs);
    // Both the card and the table should display formatDurationHM(total)
    expect(total).not.toBeNull();
    const cardText = formatDurationHM(total);
    const tableText = total != null ? formatDurationHM(total) : "—";
    expect(cardText).toBe(tableText);
  });

  // 4. Logged-out employee with valid session_end still sees working hours
  it("logged-out employee with session_end sees completed duration", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-25T07:33:00Z", session_end: "2026-10-25T11:00:00Z", session_is_active: false },
    ], Date.now());
    expect(sec).not.toBeNull();
    expect(sec).toBeGreaterThan(0);
    // 1:03 PM to 4:30 PM IST = 3h 27m = 12420s
    expect(sec).toBe(12420);
  });

  // 5. Expired session with last_heartbeat resolved as session_end
  //    (simulates the COALESCE fix: API returns last_heartbeat as session_end)
  it("expired session with resolved last_heartbeat shows duration", () => {
    // Scenario: login at 1:03 PM, last heartbeat at 2:00 PM, session expired
    // API now returns session_end = last_heartbeat = 2:00 PM
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-25T07:33:00Z", session_end: "2026-10-25T08:30:00Z", session_is_active: false },
    ], 0);
    expect(sec).not.toBeNull();
    // 1:03 PM to 2:00 PM IST = 57 minutes = 3420s
    expect(sec).toBe(3420);
  });

  // 6. Missing timestamps: genuinely no session_end → null (show "—")
  it("inactive session with no session_end returns null", () => {
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-25T07:33:00Z", session_end: null, session_is_active: false },
    ], Date.now());
    expect(sec).toBeNull();
  });

  // 7. IST date boundaries: session at 11:55 PM IST
  it("late-night IST session computes correctly", () => {
    // 11:55 PM IST = 6:25 PM UTC; ends 12:30 AM IST next day = 7:00 PM UTC
    const sec = computeFirstToLastSeconds([
      { session_start: "2026-10-25T18:25:00Z", session_end: "2026-10-25T19:00:00Z", session_is_active: false },
    ], 0);
    expect(sec).toBe(35 * 60); // 35 minutes
  });

  // 8. Null vs zero distinction: computeFirstToLastSeconds(null) != 0
  it("null result is distinguishable from zero duration", () => {
    const nullResult = computeFirstToLastSeconds([], Date.now());
    expect(nullResult).toBeNull();

    // Zero-duration session (session_end = session_start)
    const zeroResult = computeFirstToLastSeconds([
      { session_start: "2026-10-25T07:33:00Z", session_end: "2026-10-25T07:33:00Z", session_is_active: false },
    ], 0);
    expect(zeroResult).toBe(0);

    // These must be distinguishable
    expect(nullResult).not.toBe(zeroResult);
  });
});
