import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await requireRole(["admin", "site_head", "site head", "sales manager", "sales_manager", "receptionist", "sourcing_manager", "sourcing manager", "caller", "telecaller", "channel partner manager"]);
        const userId = getSessionUserId(auth.session);

        const existing = await query(`
            SELECT id, login_time, employee_id, attendance_status FROM attendance_records
            WHERE employee_id = $1 AND DATE(login_time) = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
            LIMIT 1
        `, [userId]);

        const allToday = await query(`
            SELECT id, login_time, employee_id, attendance_status FROM attendance_records
            WHERE DATE(login_time) = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        `);

        return NextResponse.json({ 
            auth, 
            userId,
            existing,
            allToday
        }, { status: 200 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
