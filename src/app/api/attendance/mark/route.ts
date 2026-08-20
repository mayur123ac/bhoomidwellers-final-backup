import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export async function POST(req: NextRequest) {
    try {
        const auth = await requireRole(["admin", "site_head", "site head", "sales manager", "sales_manager", "receptionist"]);
        if (!auth.isAuthorized) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const sessionUserId = getSessionUserId(auth.session);
        if (sessionUserId === null) {
            return NextResponse.json({ success: false, message: "Cannot determine current user" }, { status: 400 });
        }

        const { session_id } = await req.json();

        // Always bind the record to the authenticated user. The employee_id written
        // here must match the one /api/attendance/status reads back, otherwise the
        // header badge can never see the record.
        const targetUserId = sessionUserId;
        const orgId = await getOrganizationId();

        // Find the active session for the user
        let sessionIdToUse = session_id;
        let loginTime: Date | null = null;

        if (!sessionIdToUse) {
            const activeSession = await query(`
                SELECT id, session_start
                FROM employee_sessions
                WHERE user_id = $1 AND organization_id = $2 AND is_active = true
                ORDER BY session_start DESC LIMIT 1
            `, [targetUserId, orgId]);

            if (activeSession.length === 0) {
                return NextResponse.json({ success: false, message: "No active session found to mark attendance" }, { status: 404 });
            }
            sessionIdToUse = activeSession[0].id;
            loginTime = activeSession[0].session_start;
        }

        // Check if attendance already exists today (IST), computed DB-side so it does
        // not depend on the app server's clock/timezone.
        const existing = await query(`
            SELECT id, attendance_status, login_time FROM attendance_records
            WHERE employee_id = $1 AND organization_id = $2
              AND DATE(login_time) = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
            ORDER BY id DESC
            LIMIT 1
        `, [targetUserId, orgId]);

        if (existing.length > 0) {
            return NextResponse.json({
                success: true,
                message: "Attendance already marked for today",
                employeeId: targetUserId,
                status: existing[0].attendance_status,
                timeIn: existing[0].login_time,
            }, { status: 200 });
        }

        // login_time is `timestamp WITHOUT time zone`. Convert the instant to the IST
        // wall clock DB-side so the stored value is identical no matter which
        // timezone the Node process runs in (local dev = IST, Vercel/Neon = UTC).
        const result = await query(`
            INSERT INTO attendance_records (organization_id, employee_id, login_session_id, attendance_status, login_time)
            VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, CURRENT_TIMESTAMP) AT TIME ZONE 'Asia/Kolkata')
            RETURNING id, attendance_status, login_time
        `, [orgId, targetUserId, sessionIdToUse, 'Present', loginTime]);

        if (result.length === 0) {
            // Already marked — return success anyway so frontend updates gracefully
            return NextResponse.json({
                success: true,
                message: "Attendance already marked for this session",
                employeeId: targetUserId,
                status: 'Present',
                timeIn: null,
            }, { status: 200 });
        }

        return NextResponse.json({
            success: true,
            employeeId: targetUserId,
            status: result[0].attendance_status,
            timeIn: result[0].login_time,
            data: result[0],
        });
    } catch (err: any) {
        console.error("Mark Attendance Error:", err);
        return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
    }
}
