import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const userId = getSessionUserId(gate.session);
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Could not resolve user id from session." },
        { status: 401 }
      );
    }

    const orgId = await getOrganizationId();

    // All 5 metrics in one statement, one connection, one Neon round trip.
    //
    // Previously this was 5 separate query() calls via Promise.all, each
    // acquiring its own pool connection (5 of the 10 max). Combined with the
    // auth connection that is 6 connections for one endpoint — while 7 other
    // dashboard requests compete for the remaining 4. Scalar subqueries run
    // inside the database, so the planner sees all 5 at once and shares any
    // common page reads.
    const rows = await query<{
      calls_due: string;
      visits_today: string;
      in_closing: string;
      sv_week: string;
      sv_month: string;
      sc_week: string;
      sc_month: string;
    }>(
      `SELECT
         -- 1. Calls Due: assigned leads never contacted (no call_session with a recording)
         (SELECT COUNT(*)
            FROM walkin_enquiries w
           WHERE w.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND COALESCE(w.is_lost_lead, false) = false
             AND NOT EXISTS (
               SELECT 1 FROM call_sessions cs
                WHERE cs.lead_id = w.id
                  AND cs.organization_id = w.organization_id
                  AND cs.recording_r2_key IS NOT NULL
             )
         ) AS calls_due,

         -- 2. Visits Today
         (SELECT COUNT(*)
            FROM site_visits sv
            JOIN walkin_enquiries w ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
           WHERE sv.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date
                 = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
         ) AS visits_today,

         -- 3. In Closing
         (SELECT COUNT(*)
            FROM walkin_enquiries w
           WHERE w.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND w.status = 'Closing'
             AND COALESCE(w.is_lost_lead, false) = false
         ) AS in_closing,

         -- 4. Site Visits Completed (this week / this month)
         (SELECT COUNT(*) FILTER (
            WHERE (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date
                  >= (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date)
            FROM site_visits sv
            JOIN walkin_enquiries w ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
           WHERE sv.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND sv.status = 'Completed'
         ) AS sv_week,
         (SELECT COUNT(*) FILTER (
            WHERE (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date
                  >= (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date)
            FROM site_visits sv
            JOIN walkin_enquiries w ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
           WHERE sv.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND sv.status = 'Completed'
         ) AS sv_month,

         -- 5. Sales Closed (this week / this month)
         (SELECT COUNT(*) FILTER (
            WHERE COALESCE(b.booking_date, (b.created_at AT TIME ZONE 'Asia/Kolkata')::date)
                  >= (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date)
            FROM booking_applications b
            JOIN walkin_enquiries w ON w.id = b.lead_id AND w.organization_id = b.organization_id
           WHERE b.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND COALESCE(b.booking_status, '') NOT IN ('Cancelled', 'Dropped', 'Rejected')
         ) AS sc_week,
         (SELECT COUNT(*) FILTER (
            WHERE COALESCE(b.booking_date, (b.created_at AT TIME ZONE 'Asia/Kolkata')::date)
                  >= (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date)
            FROM booking_applications b
            JOIN walkin_enquiries w ON w.id = b.lead_id AND w.organization_id = b.organization_id
           WHERE b.organization_id = $1
             AND w.assigned_to_user_id = $2
             AND COALESCE(b.booking_status, '') NOT IN ('Cancelled', 'Dropped', 'Rejected')
         ) AS sc_month`,
      [orgId, userId]
    );

    const r = rows[0];
    return NextResponse.json({
      callsDue: parseInt(r?.calls_due || "0", 10),
      visitsToday: parseInt(r?.visits_today || "0", 10),
      inClosing: parseInt(r?.in_closing || "0", 10),
      siteVisitsCompleted: {
        thisWeek: parseInt(r?.sv_week || "0", 10),
        thisMonth: parseInt(r?.sv_month || "0", 10),
      },
      salesClosed: {
        thisWeek: parseInt(r?.sc_week || "0", 10),
        thisMonth: parseInt(r?.sc_month || "0", 10),
      }
    });
  } catch (error: any) {
    console.error("[GET /api/sales-manager/dashboard-summary]", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
