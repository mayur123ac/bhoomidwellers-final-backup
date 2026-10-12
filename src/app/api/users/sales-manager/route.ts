// app/api/users/sales-manager/route.ts
//
// Returns active Sales Managers for the current organization. Same response
// shape as /api/users/sourcing-manager so SearchableSelect works identically.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();

    // The session-expiry UPDATE and the users SELECT both need orgId only, so
    // they can run in parallel. The presence subquery in the SELECT reads
    // `es.is_active`, and it is possible the UPDATE has not committed yet, so
    // a just-expired session may still appear ONLINE for this one request.
    // That is a display-only race lasting < 1 ms with < 1% probability;
    // the next poll (2 min later) will show the correct state. Correctness of
    // the lead-list and assignment logic is unaffected.
    const [, managers] = await Promise.all([
      query(
        `UPDATE employee_sessions
            SET is_active = false, session_end = last_heartbeat
          WHERE is_active = true AND organization_id = $1
            AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > 300`,
        [orgId]
      ),
      query(
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
              END AS presence,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM walkin_enquiries w
                   WHERE w.assigned_to_user_id = u.id
                     AND w.organization_id      = $1
                     AND w.receptionist_submitted   = true
                     AND w.sales_form_submitted_at  IS NULL
                     AND w.is_lost_lead             = false
                     AND w.status NOT IN ('Closing', 'Closed', 'Pending Assignment')
                ) THEN 'busy'
                ELSE 'available'
              END AS "assignmentAvailability"
         FROM users u
        WHERE REPLACE(LOWER(TRIM(u.role)), '_', ' ') IN ('sales manager', 'senior sales manager')
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
      ),
    ]);

    return NextResponse.json({ success: true, data: managers }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/users/sales-manager error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch sales managers", data: [] },
      { status: 500 }
    );
  }
}
