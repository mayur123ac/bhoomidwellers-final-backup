// app/api/hr/employees/[id]/attendance/route.ts
//
// GET — employee attendance detail with location, holidays, leave, week-off.
//
// Returns one row per date in the requested range with:
// - Original attendance status
// - Effective attendance status (presence wins over holiday/weekoff)
// - Login location from employee_sessions
// - Holiday, leave, and week-off indicators
// - Late-arrival minutes
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const today = todayIst();
    const from = sp.get("from") || today;
    const to = sp.get("to") || today;

    // Verify employee
    const emp = await query<any>(
      "SELECT id, name, role FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
      [userId, orgId]
    );
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    // Shift config
    const settings = await query<any>(
      "SELECT shift_start, flexible FROM organization_settings WHERE organization_id = $1 LIMIT 1",
      [orgId]
    );
    const shiftStart = settings[0]?.shift_start || "11:00";
    const flexible = !!settings[0]?.flexible;

    // Parallel queries
    const [attendanceRows, holidayRows, leaveRows, weekOffRows] = await Promise.all([
      // Attendance + session location (one row per day via DISTINCT ON).
      // login_time is timestamptz; on Neon the session timezone is UTC, so
      // DATE(login_time) would use UTC boundaries. We must convert to IST
      // first, matching the established pattern in /api/attendance/status
      // and /api/attendance/mark.
      query<any>(
        `SELECT DISTINCT ON (DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata'))
                DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata')::text AS day,
                ar.attendance_status,
                ar.login_time,
                ar.logout_time,
                ar.working_track,
                es.login_latitude,
                es.login_longitude,
                es.login_location_name,
                es.login_location_accuracy,
                es.session_start,
                es.session_end,
                es.is_active AS session_active
           FROM attendance_records ar
           LEFT JOIN employee_sessions es ON es.id = ar.login_session_id
          WHERE ar.employee_id = $1
            AND ar.organization_id = $2
            AND DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') BETWEEN $3::date AND $4::date
          ORDER BY DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata'), ar.id ASC`,
        [userId, orgId, from, to]
      ),

      // Holidays in range
      query<any>(
        `SELECT holiday_date::text AS day, name AS holiday_name, type AS holiday_type
           FROM organization_holidays
          WHERE organization_id = $1 AND is_active = true
            AND holiday_date BETWEEN $2::date AND $3::date`,
        [orgId, from, to]
      ),

      // Approved leave in range
      query<any>(
        `SELECT start_date, end_date, leave_type, days
           FROM employee_leave_records
          WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'
            AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]')`,
        [userId, orgId, from, to]
      ),

      // Active week-off patterns
      query<any>(
        `SELECT day_of_week, effective_from, effective_to
           FROM employee_week_off_pattern
          WHERE user_id = $1 AND organization_id = $2
            AND effective_from <= $4::date
            AND (effective_to IS NULL OR effective_to >= $3::date)`,
        [userId, orgId, from, to]
      ),
    ]);

    // Index by day
    const attendanceByDay = new Map<string, any>();
    for (const r of attendanceRows) attendanceByDay.set(r.day, r);

    const holidayByDay = new Map<string, any>();
    for (const h of holidayRows) holidayByDay.set(h.day, h);

    // Build day-by-day output
    const days: any[] = [];
    const cur = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);

    while (cur <= end) {
      const dayStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      const dayOfWeek = cur.getDay();

      const att = attendanceByDay.get(dayStr);
      const hol = holidayByDay.get(dayStr);

      // Check leave
      const leave = leaveRows.find((l: any) => {
        const s = new Date(l.start_date);
        const e = new Date(l.end_date);
        return cur >= s && cur <= e;
      });

      // Check week-off
      const isWeekOff = weekOffRows.some((w: any) => {
        if (w.day_of_week !== dayOfWeek) return false;
        const effFrom = new Date(w.effective_from);
        const effTo = w.effective_to ? new Date(w.effective_to) : null;
        return cur >= effFrom && (!effTo || cur <= effTo);
      });

      // Status precedence: actual presence wins.
      // Values are capitalized to match the frontend badge/filter expectations
      // ("Present", "Absent", "Holiday", "Week Off").
      const originalStatus = att?.attendance_status || null;
      let effectiveStatus: string;

      if (originalStatus && originalStatus.toLowerCase() === "present") {
        effectiveStatus = "Present";
      } else if (leave) {
        // Capitalize leave type: "casual" → "Casual Leave"
        const lt = leave.leave_type || "leave";
        effectiveStatus = lt.charAt(0).toUpperCase() + lt.slice(1).replace(/_/g, " ") + " Leave";
      } else if (originalStatus) {
        // Capitalize whatever the DB has
        const s = originalStatus.toLowerCase();
        effectiveStatus = s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
      } else if (hol) {
        effectiveStatus = "Holiday";
      } else if (isWeekOff) {
        effectiveStatus = "Week Off";
      } else {
        effectiveStatus = "Absent";
      }

      // Late calculation
      let lateMinutes = 0;
      if (att?.login_time && !flexible) {
        const login = new Date(att.login_time);
        const [h, m] = shiftStart.split(":").map(Number);
        const expected = new Date(login);
        expected.setHours(Number.isFinite(h) ? h : 11, Number.isFinite(m) ? m : 0, 0, 0);
        const diff = Math.round((login.getTime() - expected.getTime()) / 60000);
        if (diff > 2) lateMinutes = diff;
      }

      days.push({
        date: dayStr,
        dayOfWeek,
        originalStatus,
        effectiveStatus,
        isHoliday: !!hol,
        holidayName: hol?.holiday_name || null,
        isLeave: !!leave,
        leaveType: leave?.leave_type || null,
        isWeekOff,
        loginTime: att?.login_time || null,
        logoutTime: att?.logout_time || null,
        workingTrackSeconds: att?.working_track || null,
        lateMinutes,
        location: att ? {
          latitude: att.login_latitude || null,
          longitude: att.login_longitude || null,
          name: att.login_location_name || null,
          accuracy: att.login_location_accuracy || null,
          available: !!(att.login_latitude && att.login_longitude),
        } : { available: false },
      });

      cur.setDate(cur.getDate() + 1);
    }

    return NextResponse.json({
      success: true,
      data: {
        employee: { id: emp[0].id, name: emp[0].name, role: emp[0].role },
        from,
        to,
        shift: { start: shiftStart, flexible },
        days,
      },
    });
  } catch (err: any) {
    console.error("[GET employee attendance detail]", err);
    return NextResponse.json({ success: false, message: "Failed to load attendance detail." }, { status: 500 });
  }
}
