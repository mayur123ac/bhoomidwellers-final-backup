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

        // attendance_records.login_time is `timestamp WITHOUT time zone` holding the
        // IST wall clock (see the mark route). Comparing it with
        // `login_time AT TIME ZONE 'Asia/Kolkata'` would re-interpret the naive value
        // and shift it a second time, so compare the bare date against today in IST.
        // The LEFT JOIN LATERAL guarantees exactly one row, so `today_ist` is always
        // reported even when the employee has not marked attendance yet.
        const existing = await query(`
            SELECT
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date::text AS today_ist,
                ar.id,
                ar.login_time,
                ar.attendance_status
            FROM (SELECT 1) AS _
            LEFT JOIN LATERAL (
                SELECT id, login_time, attendance_status
                FROM attendance_records
                WHERE employee_id = $1 AND organization_id = $2
                  AND DATE(login_time) = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
                ORDER BY id DESC
                LIMIT 1
            ) ar ON true
        `, [userId, await getOrganizationId()]);

        const row = existing[0];
        const marked = !!row && String(row.attendance_status).toLowerCase() === "present";

        return NextResponse.json({
            success: true,
            marked,
            employeeId: userId,
            date: row?.today_ist ?? null,
            status: row?.attendance_status ?? null,
            timeIn: row?.login_time ?? null,
        }, { status: 200 });
    } catch (err: any) {
        console.error("Attendance Status Error:", err);
        return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
    }
}
