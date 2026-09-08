// app/api/users/sourcing-manager/route.ts
//
// Mirrors /api/users/sales-manager, but returns the extra identifying fields the
// assignment dropdown shows: employee id, username, phone, email. The receptionist
// picks a person off this list and only the id is stored on the enquiry.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // Underscores normalized so a role stored as "Sourcing_Manager" still matches,
    // consistent with normalizeRole in @/lib/cpRbac.
    const orgId = await getOrganizationId();

    // Expire stale sessions (no heartbeat in 5 min) — same housekeeping as
    // /api/attendance/live, scoped to the caller's organization.
    await query(
      `UPDATE employee_sessions
          SET is_active = false, session_end = last_heartbeat
        WHERE is_active = true AND organization_id = $1
          AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300`,
      [orgId]
    );

    // Derive ONLINE / OFFLINE from whether the employee has ANY active session,
    // not just the most recent one. A user with two browser tabs whose latest
    // session ended is still online in the older tab.
    const managers = await query(
      `SELECT u.id, u.name, u.username, u.email,
              u.whatsapp_number AS phone, u.whatsapp_number,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM employee_sessions es
                   WHERE es.user_id = u.id
                     AND es.organization_id = $1
                     AND es.is_active = true
                ) THEN 'ONLINE'
                ELSE 'OFFLINE'
              END AS presence
         FROM users u
        WHERE REPLACE(LOWER(TRIM(u.role)), '_', ' ') = 'sourcing manager'
          AND u.is_active = true
          AND u.organization_id = $1
        ORDER BY
          CASE WHEN EXISTS (
            SELECT 1 FROM employee_sessions es
             WHERE es.user_id = u.id
               AND es.organization_id = $1
               AND es.is_active = true
          ) THEN 0 ELSE 1 END,
          u.name ASC`,
      [orgId]
    );

    return NextResponse.json({ success: true, data: managers }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/users/sourcing-manager error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch sourcing managers", data: [] },
      { status: 500 }
    );
  }
}
