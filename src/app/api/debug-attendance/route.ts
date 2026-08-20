import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await requireRole(["admin", "site_head", "site head", "sales manager", "sales_manager", "receptionist", "sourcing_manager", "sourcing manager", "caller", "telecaller", "channel partner manager"]);
        // The result of requireRole was computed and then ignored, so an unauthorised
        // caller still received the `allToday` dump below. Checked now: this route
        // returns other employees' attendance and must not answer without a session.
        if (!auth.isAuthorized) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }
        const userId = getSessionUserId(auth.session);
        const orgId = await getOrganizationId();

        const existing = await query(`
            SELECT id, login_time, employee_id, attendance_status FROM attendance_records
            WHERE employee_id = $1 AND organization_id = $2 AND DATE(login_time) = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
            LIMIT 1
        `, [userId, orgId]);

        // `allToday` had no predicate at all beyond the date, so it returned every
        // tenant's attendance for today to any caller. Scoped to the caller's own
        // organization.
        const allToday = await query(`
            SELECT id, login_time, employee_id, attendance_status FROM attendance_records
            WHERE organization_id = $1 AND DATE(login_time) = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        `, [orgId]);

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
