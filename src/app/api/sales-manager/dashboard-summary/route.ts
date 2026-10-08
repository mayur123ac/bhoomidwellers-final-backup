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

    // The session enforces the role. We don't strictly require "sales manager" here because
    // it's secure for any user to view their *own* scoped dashboard, but we rely on the
    // fact that this dashboard is primarily loaded by Sales Managers.
    // The strict boundary is `assigned_to_user_id = $userId`. No URL params are accepted.

    // 1. Calls Due
    // Business Definition: Assigned leads that have NEVER been contacted.
    // Reuses the exact definition from Employee Performance: a lead is "contacted"
    // if there is at least one call_session with a valid recording_r2_key.
    // This represents the SM's pending first-contact workload, independent of reminders.
    const callsDuePromise = query<{ count: string }>(
      `SELECT COUNT(*)
       FROM walkin_enquiries w
       WHERE w.organization_id = $1
         AND w.assigned_to_user_id = $2
         AND COALESCE(w.is_lost_lead, false) = false
         AND NOT EXISTS (
           SELECT 1 FROM call_sessions cs
           WHERE cs.lead_id = w.id
             AND cs.organization_id = w.organization_id
             AND cs.recording_r2_key IS NOT NULL
         )`,
      [orgId, userId]
    );

    // 2. Visits Today
    // Reuses table logic from /api/site-visits/all
    const visitsTodayPromise = query<{ count: string }>(
      `SELECT COUNT(*)
       FROM site_visits sv
       JOIN walkin_enquiries w ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
       WHERE sv.organization_id = $1
         AND w.assigned_to_user_id = $2
         AND (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`,
      [orgId, userId]
    );

    // 3. In Closing
    // Reuses the specific CRM state machine definition for a lead currently in the closing state.
    const inClosingPromise = query<{ count: string }>(
      `SELECT COUNT(*)
       FROM walkin_enquiries w
       WHERE w.organization_id = $1
         AND w.assigned_to_user_id = $2
         AND w.status = 'Closing'
         AND COALESCE(w.is_lost_lead, false) = false`,
      [orgId, userId]
    );

    // 4. Site Visits Completed
    // Reuses table logic from /api/site-visits/all, filtering by status = 'Completed'
    const siteVisitsCompletedPromise = query<{ this_week: string, this_month: string }>(
      `SELECT 
         COUNT(*) FILTER (WHERE (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date >= (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date) AS this_week,
         COUNT(*) FILTER (WHERE (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date >= (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date) AS this_month
       FROM site_visits sv
       JOIN walkin_enquiries w ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
       WHERE sv.organization_id = $1
         AND w.assigned_to_user_id = $2
         AND sv.status = 'Completed'`,
      [orgId, userId]
    );

    // 5. Sales Closed
    // Reuses logic from /api/booking-applications. 
    // `booking_status` explicitly filters out failed/cancelled bookings.
    const salesClosedPromise = query<{ this_week: string, this_month: string }>(
      `SELECT 
         COUNT(*) FILTER (WHERE COALESCE(b.booking_date, (b.created_at AT TIME ZONE 'Asia/Kolkata')::date) >= (date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date) AS this_week,
         COUNT(*) FILTER (WHERE COALESCE(b.booking_date, (b.created_at AT TIME ZONE 'Asia/Kolkata')::date) >= (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))::date) AS this_month
       FROM booking_applications b
       JOIN walkin_enquiries w ON w.id = b.lead_id AND w.organization_id = b.organization_id
       WHERE b.organization_id = $1
         AND w.assigned_to_user_id = $2
         AND COALESCE(b.booking_status, '') NOT IN ('Cancelled', 'Dropped', 'Rejected')`,
      [orgId, userId]
    );

    // Execute all highly-indexed count queries concurrently
    const [
      callsDueResult,
      visitsTodayResult,
      inClosingResult,
      siteVisitsResult,
      salesClosedResult
    ] = await Promise.all([
      callsDuePromise,
      visitsTodayPromise,
      inClosingPromise,
      siteVisitsCompletedPromise,
      salesClosedPromise
    ]);

    // Return the strict 5-metric structure
    return NextResponse.json({
      callsDue: parseInt(callsDueResult[0]?.count || "0", 10),
      visitsToday: parseInt(visitsTodayResult[0]?.count || "0", 10),
      inClosing: parseInt(inClosingResult[0]?.count || "0", 10),
      siteVisitsCompleted: {
        thisWeek: parseInt(siteVisitsResult[0]?.this_week || "0", 10),
        thisMonth: parseInt(siteVisitsResult[0]?.this_month || "0", 10),
      },
      salesClosed: {
        thisWeek: parseInt(salesClosedResult[0]?.this_week || "0", 10),
        thisMonth: parseInt(salesClosedResult[0]?.this_month || "0", 10),
      }
    });
  } catch (error: any) {
    console.error("[GET /api/sales-manager/dashboard-summary]", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
