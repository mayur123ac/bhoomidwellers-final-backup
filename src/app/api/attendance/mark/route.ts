import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastEvent } from "@/lib/eventBus";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export async function POST(req: NextRequest) {
    try {
        // Matches /api/attendance/status's allow-list: any role that can see its
        // own attendance state must also be able to punch in from the header
        // control, not just the four that historically had a My Attendance page.
        const auth = await requireRole(["admin", "site_head", "site head", "sales manager", "sales_manager", "receptionist", "sourcing_manager", "sourcing manager", "caller", "telecaller", "channel partner manager"]);
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
        // not depend on the app server's clock/timezone. login_time is a genuine
        // `timestamptz` in production, so converting it with `AT TIME ZONE
        // 'Asia/Kolkata'` first (to a naive IST wall-clock value) before taking
        // DATE() is correct regardless of the DB session's own timezone (UTC on
        // Neon) — comparing the bare column instead would silently use the
        // session's zone and misdate logins near the IST day boundary.
        //
        // `ORDER BY id ASC` — not DESC — is what makes a punch sticky: some
        // employees already have more than one attendance_records row for the
        // same IST day in production (from sessions created before this check
        // existed, or edge cases it still doesn't fully close). Picking DESC
        // would surface whichever row happens to be newest and let a later
        // punch silently override the header's "marked at" time; ASC always
        // anchors the header to the employee's actual first punch of the day,
        // exactly like a logout/re-login must never move it.
        const existing = await query(`
            SELECT id, attendance_status, login_time FROM attendance_records
            WHERE employee_id = $1 AND organization_id = $2
              AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
            ORDER BY id ASC
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

        // login_time is `timestamptz`, so this just stores the real instant —
        // either the active session's session_start, or (COALESCE) the moment
        // this INSERT runs, computed DB-side. No wall-clock conversion needed:
        // a timestamptz carries its own offset, so it reads back correctly
        // regardless of which timezone the Node process or DB session use.
        const result = await query(`
            INSERT INTO attendance_records (organization_id, employee_id, login_session_id, attendance_status, login_time)
            VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, CURRENT_TIMESTAMP))
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

        // Push the punch to Admin/Site Head immediately — without this, their
        // Live Activity tracker only picks up the new login_time/attendance_status
        // on their next manual refresh, since heartbeats don't carry these fields.
        broadcastEvent(orgId, { type: "ATTENDANCE_SYNC", userId: targetUserId }, ["admin", "site_head"]);
        broadcastToOrg(orgId, "activity.attendance_sync", { type: "ATTENDANCE_SYNC", userId: targetUserId });

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
