// api/attendance/report — range attendance data for the Excel report.
//
// The existing export in LiveActivityView maps over whatever single day is
// already loaded in the browser. This route is the range equivalent: it reads
// from the database, covers every active employee, and reuses the SAME rules the
// Live Activity screen uses so the spreadsheet and the screen never disagree:
//
//   • Present/Absent  → attendance_records.attendance_status, else 'Pending'
//                       while a session is open, else 'Absent'
//                       (api/attendance/live/route.ts:42-46)
//   • Late            → first login vs organization_settings.shift_start,
//                       ±2 min grace, 'Flexible' when the org flag is set
//                       (LiveActivityView.tsx:316-334)
//   • Working hours   → session_end − session_start, NOW() while still active
//                       (LiveActivityView.tsx:89-97)
//   • Employee set    → users WHERE is_active = true
//
// Three queries total, each covering the whole range. Nothing runs per-employee,
// so cost is flat in the number of employees.
//
// ── Known inconsistency, deliberately preserved ─────────────────────────────
// Sessions are dated with `AT TIME ZONE 'Asia/Kolkata'`; attendance_records are
// dated with a bare `DATE(login_time)` on a `timestamp without time zone`
// column. Those agree on a local Postgres running Asia/Calcutta and diverge on
// Neon, which runs UTC — a 9pm IST login lands on the previous UTC day. This
// route copies the existing behaviour rather than correcting it, so the export
// always matches what the Live Activity table shows. Fixing it means changing
// both together, as its own piece of work.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

/** Attendance data is employee PII — Admin only, enforced server-side. */
const REPORT_ROLES = ["admin"];

/** Guards against an unbounded scan from a hand-rolled request. */
const MAX_RANGE_DAYS = 400;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyRow {
  date: string;
  employeeId: number;
  employeeName: string;
  role: string;
  attendanceStatus: string;
  loginTime: string | null;
  logoutTime: string | null;
  punctuality: string;
  lateMinutes: number;
  workedSeconds: number;
  sessionCount: number;
  stillActive: boolean;
}

/**
 * Punctuality, matching LiveActivityView exactly: a ±2 minute grace band around
 * the configured shift start, and no judgement at all when the org is flexible.
 */
function derivePunctuality(
  firstLogin: Date | null,
  shiftStart: string,
  flexible: boolean
): { label: string; lateMinutes: number } {
  if (!firstLogin) return { label: "—", lateMinutes: 0 };
  if (flexible) return { label: "Flexible", lateMinutes: 0 };

  const [h, m] = String(shiftStart || "11:00").split(":").map(Number);
  const expected = new Date(firstLogin);
  expected.setHours(Number.isFinite(h) ? h : 11, Number.isFinite(m) ? m : 0, 0, 0);

  const diffMin = Math.round((firstLogin.getTime() - expected.getTime()) / 60000);
  if (diffMin > 2) {
    const hh = Math.floor(diffMin / 60);
    const mm = diffMin % 60;
    return { label: `Late ${hh > 0 ? hh + "h " : ""}${mm}m`, lateMinutes: diffMin };
  }
  if (diffMin < -2) {
    const abs = Math.abs(diffMin);
    const hh = Math.floor(abs / 60);
    const mm = abs % 60;
    return { label: `Early ${hh > 0 ? hh + "h " : ""}${mm}m`, lateMinutes: 0 };
  }
  return { label: "On Time", lateMinutes: 0 };
}

/**
 * Working days in the range, Sundays excluded.
 *
 * There is no holiday, leave or week-off table in this database — verified, not
 * assumed — so a six-day week is the only rule available. It IS an assumption,
 * which is why the workbook states it in a header cell rather than presenting
 * the percentage as if it were derived from a roster.
 */
function countWorkingDays(from: string, to: string): number {
  let days = 0;
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    if (cur.getDay() !== 0) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export async function GET(req: NextRequest) {
  const gate = await requireRoles(REPORT_ROLES);
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const from = String(searchParams.get("from") ?? "").trim();
    const to = String(searchParams.get("to") ?? "").trim();

    // ── Validation ──────────────────────────────────────────────────────────
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return NextResponse.json(
        { success: false, message: "from and to must be YYYY-MM-DD dates.", code: "BAD_DATE" },
        { status: 400 }
      );
    }
    if (from > to) {
      return NextResponse.json(
        { success: false, message: "The From date cannot be after the To date.", code: "BAD_RANGE" },
        { status: 400 }
      );
    }
    // Clamped rather than rejected: "this month" on the 2nd legitimately asks for
    // a range whose month has not finished.
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const effectiveTo = to > todayStr ? todayStr : to;

    if (countWorkingDays(from, effectiveTo) > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { success: false, message: `Range too large. Limit is ${MAX_RANGE_DAYS} days.`, code: "RANGE_TOO_LARGE" },
        { status: 400 }
      );
    }

    // ── Shift configuration (the same row the Live Activity header reads) ────
    // Resolved once and reused by every statement in this report, so the roster,
    // the session aggregate and the attendance marks are all read for the same
    // organization and cannot be assembled from a mix of tenants.
    const orgId = await getOrganizationId();

    const settings = await query<any>(
      `SELECT shift_start, shift_end, flexible FROM organization_settings WHERE organization_id = $1`,
      [orgId]
    );
    const shiftStart = settings[0]?.shift_start || "11:00";
    const shiftEnd = settings[0]?.shift_end || "20:00";
    const flexible = !!settings[0]?.flexible;

    // ── Query 1: every active employee (the report's roster) ────────────────
    const employees = await query<any>(
      `SELECT id, name, COALESCE(NULLIF(TRIM(role),''),'—') AS role, email
         FROM users
        WHERE is_active = true AND organization_id = $1
        ORDER BY name ASC`,
      [orgId]
    );

    // ── Query 2: sessions folded to one row per employee per day ────────────
    // Aggregated in SQL, not JS: a year of sessions for 200 staff is tens of
    // thousands of rows, and only the per-day totals are ever used.
    //
    // MIN(session_start)/MAX(session_end), not the screen's "most recent
    // session" — across a range an HR report means first arrival and last
    // departure, and a day with three sessions must not report only the third.
    // Hours are summed across sessions for the same reason.
    const sessions = await query<any>(
      `SELECT s.user_id,
              TO_CHAR(DATE(s.session_start AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
              MIN(s.session_start)                        AS first_login,
              MAX(s.session_end)                          AS last_logout,
              BOOL_OR(s.is_active)                        AS still_active,
              COUNT(*)::int                               AS session_count,
              COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.session_end, NOW()) - s.session_start))), 0)::bigint
                                                          AS worked_seconds
         FROM employee_sessions s
        WHERE s.organization_id = $3
          AND DATE(s.session_start AT TIME ZONE 'Asia/Kolkata') BETWEEN $1::date AND $2::date
        GROUP BY s.user_id, DATE(s.session_start AT TIME ZONE 'Asia/Kolkata')`,
      [from, effectiveTo, orgId]
    );

    // ── Query 3: the marked attendance status per employee per day ──────────
    // DISTINCT ON mirrors the live route: if a day somehow has two records, the
    // latest one wins, exactly as the screen resolves it.
    const marks = await query<any>(
      `SELECT DISTINCT ON (employee_id, DATE(login_time))
              employee_id,
              TO_CHAR(DATE(login_time), 'YYYY-MM-DD') AS day,
              attendance_status,
              login_time AT TIME ZONE 'Asia/Kolkata' AS login_time,
              logout_time AT TIME ZONE 'Asia/Kolkata' AS logout_time
         FROM attendance_records
        WHERE organization_id = $3
          AND DATE(login_time) BETWEEN $1::date AND $2::date
        ORDER BY employee_id, DATE(login_time), login_time DESC`,
      [from, effectiveTo, orgId]
    );

    // ── Assemble ────────────────────────────────────────────────────────────
    const sessionByKey = new Map<string, any>();
    for (const s of sessions) sessionByKey.set(`${s.user_id}|${s.day}`, s);
    const markByKey = new Map<string, any>();
    for (const m of marks) markByKey.set(`${m.employee_id}|${m.day}`, m);

    const days: string[] = [];
    {
      const cur = new Date(`${from}T00:00:00`);
      const end = new Date(`${effectiveTo}T00:00:00`);
      while (cur <= end) {
        days.push(
          `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`
        );
        cur.setDate(cur.getDate() + 1);
      }
    }

    const daily: DailyRow[] = [];
    for (const emp of employees) {
      for (const day of days) {
        const key = `${emp.id}|${day}`;
        const s = sessionByKey.get(key);
        const m = markByKey.get(key);

        // A day with neither a session nor a mark is an absence, and is emitted
        // rather than skipped — a report that omits absent days cannot be used
        // to count them.
        const firstLogin = s?.first_login ? new Date(s.first_login) : null;
        const { label: punctuality, lateMinutes } = derivePunctuality(firstLogin, shiftStart, flexible);

        const status = m?.attendance_status
          ? m.attendance_status
          : s?.still_active
            ? "Pending"
            : "Absent";

        daily.push({
          date: day,
          employeeId: emp.id,
          employeeName: emp.name,
          role: emp.role,
          attendanceStatus: status,
          loginTime: firstLogin ? firstLogin.toISOString() : null,
          logoutTime: s?.last_logout ? new Date(s.last_logout).toISOString() : null,
          punctuality: s ? punctuality : "—",
          lateMinutes: s ? lateMinutes : 0,
          workedSeconds: s ? Number(s.worked_seconds) : 0,
          sessionCount: s ? s.session_count : 0,
          stillActive: !!s?.still_active,
        });
      }
    }

    const totalWorkingDays = countWorkingDays(from, effectiveTo);

    const summary = employees.map((emp: any) => {
      const rows = daily.filter((d) => d.employeeId === emp.id);
      // Sundays excluded from the denominator, so they are excluded here too —
      // otherwise a Sunday login would push attendance above 100%.
      const counted = rows.filter((r) => new Date(`${r.date}T00:00:00`).getDay() !== 0);
      const present = counted.filter((r) => /present/i.test(r.attendanceStatus)).length;
      const late = counted.filter((r) => r.lateMinutes > 0).length;
      const workedSeconds = counted.reduce((sum, r) => sum + r.workedSeconds, 0);
      const daysWithWork = counted.filter((r) => r.workedSeconds > 0).length;

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        role: emp.role,
        totalWorkingDays,
        presentDays: present,
        absentDays: Math.max(totalWorkingDays - present, 0),
        lateDays: late,
        totalWorkedSeconds: workedSeconds,
        averageWorkedSeconds: daysWithWork > 0 ? Math.round(workedSeconds / daysWithWork) : 0,
        attendancePercent: totalWorkingDays > 0
          ? Math.round((present / totalWorkingDays) * 1000) / 10
          : 0,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        from,
        to: effectiveTo,
        totalWorkingDays,
        shift: { start: shiftStart, end: shiftEnd, flexible },
        // Stated so the workbook can print the basis rather than leaving the
        // reader to guess how the percentage was reached.
        workingDayBasis: "Calendar days excluding Sundays. No holiday or leave calendar exists in this system.",
        employeeCount: employees.length,
        summary,
        daily,
      },
    });
  } catch (err: any) {
    console.error("[attendance/report]", err);
    return NextResponse.json(
      { success: false, message: "Unable to generate attendance report.", code: "REPORT_FAILED" },
      { status: 500 }
    );
  }
}
