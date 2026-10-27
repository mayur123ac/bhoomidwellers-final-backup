import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await requireRole(["admin", "site_head", "site head", "sales manager", "sales_manager", "receptionist", "sourcing_manager", "sourcing manager", "caller", "telecaller", "channel partner manager"]);
        if (!auth.isAuthorized) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const userId = getSessionUserId(auth.session);
        if (userId === null) {
            return NextResponse.json({ success: false, message: "Cannot determine current user" }, { status: 400 });
        }

        // attendance_records.login_time is a genuine `timestamptz`, so the IST-day
        // match needs `login_time AT TIME ZONE 'Asia/Kolkata'` — converting it to a
        // naive IST wall-clock value first — compared against today in IST; the
        // bare column would compare under the DB session's own timezone (UTC on
        // Neon) instead and misdate logins near the day boundary.
        //
        // The SELECTed `login_time` below is left as the raw timestamptz — NOT
        // re-wrapped in `AT TIME ZONE` — on purpose. A naive (zone-less) value
        // sent over JSON gets reconstructed by the pg driver using the Node
        // process's own OS timezone, which only happens to equal IST on this dev
        // machine; on a UTC production server the exact same code would silently
        // return a value 5.5 hours off. A `timestamptz` carries its offset through
        // JSON as a real 'Z'-suffixed instant, so it parses correctly everywhere
        // and the client (AttendanceBadge / AttendanceView) does the IST
        // conversion itself for display.
        //
        // `ORDER BY id ASC` — not DESC — for the same reason as the mark route:
        // some employees already have more than one attendance_records row for
        // the same IST day in production, and picking DESC would report whichever
        // is newest, letting a later punch move the header's "marked at" time
        // instead of keeping it pinned to the day's actual first punch.
        //
        // The LEFT JOIN LATERAL guarantees exactly one row, so `today_ist` is
        // always reported even when the employee has not marked attendance yet.
        const existing = await query(`
            SELECT
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date::text AS today_ist,
                ar.id,
                ar.login_time,
                ar.submitted_at,
                ar.logout_time,
                ar.attendance_status,
                ar.working_track
            FROM (SELECT 1) AS _
            LEFT JOIN LATERAL (
                SELECT id, login_time, logout_time, attendance_status, working_track,
                   submitted_at AT TIME ZONE 'UTC' AS submitted_at
                FROM attendance_records
                WHERE employee_id = $1 AND organization_id = $2
                  AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
                ORDER BY id ASC
                LIMIT 1
            ) ar ON true
        `, [userId, await getOrganizationId()]);

        const row = existing[0];
        const marked = !!row && String(row.attendance_status).toLowerCase() === "present";

        // Fetch period summary for today's attendance record (if any).
        let canRemark = false;
        let currentPeriod = 0;
        let totalPeriods = 0;
        let completedPeriodsSeconds = 0;
        let activePeriodStartedAt: string | null = null;

        if (row?.id) {
            const periodRows = await query<{
                period_number: number;
                started_at: string | null;
                completed_at: string | null;
                duration_seconds: number | null;
            }>(`
                SELECT period_number,
                  TO_CHAR(started_at AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at,
                  completed_at,
                  duration_seconds
                FROM attendance_periods
                WHERE attendance_id = $1
                ORDER BY period_number ASC
            `, [row.id]);

            totalPeriods = periodRows.length;
            for (const p of periodRows) {
                if (p.completed_at) {
                    completedPeriodsSeconds += p.duration_seconds || 0;
                    currentPeriod = p.period_number;
                } else {
                    activePeriodStartedAt = p.started_at;
                    currentPeriod = p.period_number;
                }
            }
            // canRemark: attendance marked, day completed (logout set), and no active period
            canRemark = marked && !!row.logout_time && !activePeriodStartedAt;
        }

        return NextResponse.json({
            success: true,
            marked,
            employeeId: userId,
            date: row?.today_ist ?? null,
            status: row?.attendance_status ?? null,
            timeIn: row?.submitted_at ?? row?.login_time ?? null,
            logoutTime: row?.logout_time ?? null,
            workingTrack: row?.working_track ?? null,
            // Period data for remark-aware clients
            canRemark,
            currentPeriod,
            totalPeriods,
            completedPeriodsSeconds,
            activePeriodStartedAt,
        }, { status: 200 });
    } catch (err) {
        console.error("Attendance Status Error:", err);
        return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
    }
}
