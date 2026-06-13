import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";

export async function POST(req: NextRequest) {
    try {
        const auth = await requireRole(["admin", "site_head", "site head", "sales manager", "sales_manager", "receptionist"]);
        if (!auth.isAuthorized) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const { session_id, user_id } = await req.json();
        const targetUserId = user_id || auth.session.id;

        // Find the active session for the user
        let sessionIdToUse = session_id;
        let loginTime = null;

        if (!sessionIdToUse) {
            const activeSession = await query(`
                SELECT id, session_start 
                FROM employee_sessions 
                WHERE user_id = $1 AND is_active = true 
                ORDER BY session_start DESC LIMIT 1
            `, [targetUserId]);

            if (activeSession.length === 0) {
                return NextResponse.json({ success: false, message: "No active session found to mark attendance" }, { status: 404 });
            }
            sessionIdToUse = activeSession[0].id;
            loginTime = activeSession[0].session_start;
        }

        // Insert into attendance_records
        // ON CONFLICT (login_session_id) DO NOTHING to prevent duplicate marks
        const result = await query(`
            INSERT INTO attendance_records (organization_id, employee_id, login_session_id, attendance_status, login_time)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (login_session_id) DO NOTHING
            RETURNING id, attendance_status
        `, [1, targetUserId, sessionIdToUse, 'Present', loginTime || new Date()]);

        if (result.length === 0) {
            // Already marked — return success anyway so frontend updates gracefully
            return NextResponse.json({ success: true, message: "Attendance already marked for this session" }, { status: 200 });
        }

        return NextResponse.json({ success: true, data: result[0] });
    } catch (err: any) {
        console.error("Mark Attendance Error:", err);
        return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
    }
}