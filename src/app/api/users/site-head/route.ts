//api/users/site-head/route.ts
import { getOrganizationId } from "@/lib/tenantContext";
import { NextResponse } from "next/server";
import { query } from "@/lib/db"; 
import { requireSession, requireRoles } from "@/lib/serverAuth";

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

    // MT-05: the role test is PARENTHESISED before the organization filter is
    // added. `A OR B AND org` binds as `A OR (B AND org)` in SQL, which would
    // have returned every organization's site heads through the first branch.
    //
    // Columns are listed rather than `SELECT *`. The wildcard shipped the whole
    // users row to any signed-in caller — including `password`, which for legacy
    // rows is still plaintext (see lib/passwords.ts). This endpoint feeds a name
    // dropdown and the notification feed's role labels; it needs identity, not
    // credentials. Any column added to `users` later is now opt-in here.

    // Expire stale sessions (no heartbeat in 5 min) — same housekeeping as
    // /api/attendance/live and the other user-list endpoints.
    await query(
      `UPDATE employee_sessions
          SET is_active = false, session_end = last_heartbeat
        WHERE is_active = true AND organization_id = $1
          AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300`,
      [orgId]
    );

    const rows = await query(
      `SELECT u.id, u.name, u.email, u.username, u.role, u.is_active AS "isActive",
              u.whatsapp_number, u.phone, u.avatar_key, u.avatar_url, u.organization_id,
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
        WHERE (LOWER(u.role) LIKE '%site%head%'
               OR LOWER(u.role) = 'site_head')
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

    return NextResponse.json({ 
      success: true, 
      data: rows 
    }, { status: 200 });

  } catch (error: any) {
    // This logs the EXACT error to your VS Code terminal
    console.error("🚨 DB Query Failed in Site Head API:", error.message);
    return NextResponse.json({ 
      success: false, 
      message: error.message 
    }, { status: 500 });
  }
}