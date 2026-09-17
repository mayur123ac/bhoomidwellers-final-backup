// api/monitoring/employee-performance/route.ts
// Aggregates lead-lifecycle metrics per employee for the Performance Monitoring panel.
//
// GET /api/monitoring/employee-performance?period=30d
//   period:        7d | 30d | 90d | all (default: 30d)
//   employee_id:   optional integer — scope all aggregates to one employee
//   view:          "summary" (default) | "leads" — lead-level table
//   page:          integer >= 1 (default: 1, leads view only)
//   limit:         integer 1-100 (default: 50, leads view only)
//   search:        string — filters leads by name/phone
//   expectation:   string — filters leads by lead_interest_status
//   followup_today: "true" — only leads with a human follow-up today (IST)

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

// ── Helpers ─────────────────────────────────────────────────────────────────

function periodToInterval(period: string): string | null {
  if (period === "7d") return "7 days";
  if (period === "30d") return "30 days";
  if (period === "90d") return "90 days";
  if (period === "all") return null;
  return "30 days";
}

/** IST date boundary for "today" — avoids UTC CURRENT_DATE mismatch. */
const IST_TODAY_START = `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`;

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const role = (gate.session.role ?? "").toLowerCase().replace(/_/g, " ");
  if (role !== "admin" && role !== "super admin" && role !== "site head") {
    return NextResponse.json({ success: false, message: "Admin only." }, { status: 403 });
  }

  const orgId = await getOrganizationId();
  const sp = new URL(req.url).searchParams;
  const period = sp.get("period") || "30d";
  const interval = periodToInterval(period);
  const view = sp.get("view") || "summary";
  const employeeIdParam = sp.get("employee_id");
  const employeeId = employeeIdParam ? Number(employeeIdParam) : null;

  if (employeeId !== null && !Number.isInteger(employeeId)) {
    return NextResponse.json({ success: false, message: "Invalid employee_id." }, { status: 400 });
  }

  // ── Lead-level view ──────────────────────────────────────────────────────
  if (view === "leads") {
    return handleLeadsView(req, orgId, interval, employeeId);
  }

  // ── Summary view ─────────────────────────────────────────────────────────
  return handleSummaryView(orgId, period, interval, employeeId);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY VIEW
// ═══════════════════════════════════════════════════════════════════════════

async function handleSummaryView(
  orgId: string,
  period: string,
  interval: string | null,
  employeeId: number | null,
) {
  // Date clauses — activity-date based for consistency
  const leadDateClause = interval
    ? `AND w.assigned_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const eventDateClause = interval
    ? `AND f.created_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const visitDateClause = interval
    ? `AND sv.completed_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const visitScheduledDateClause = interval
    ? `AND sv.created_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const bookingDateClause = interval
    ? `AND ba.created_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const reminderDateClause = interval
    ? `AND lr.created_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const callDateClause = interval
    ? `AND cs.started_at >= NOW() - INTERVAL '${interval}'`
    : "";

  // Employee filter fragments
  const empLeadClause = employeeId !== null
    ? `AND w.assigned_to_user_id = ${Number(employeeId)}`
    : "";
  const empFupClause = employeeId !== null
    ? `AND f.created_by_id = ${Number(employeeId)}`
    : "";
  const empVisitClause = employeeId !== null
    ? `AND sv.created_by_id = ${Number(employeeId)}`
    : "";
  const empBookingClause = employeeId !== null
    ? `AND ba.created_by_id = ${Number(employeeId)}`
    : "";
  const empReminderClause = employeeId !== null
    ? `AND lr.assigned_user_id = ${Number(employeeId)}`
    : "";
  const empCallClause = employeeId !== null
    ? `AND cs.user_id = ${Number(employeeId)}`
    : "";

  // ── 1. Roster ───────────────────────────────────────────────────────────
  const rosterQuery = query<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM users
      WHERE organization_id = $1
        AND is_active = true
        AND role IN ('Sales Manager', 'Site Head', 'Receptionist')
        ${employeeId !== null ? `AND id = ${Number(employeeId)}` : ""}
      ORDER BY role, name`,
    [orgId],
  );

  const roster = await rosterQuery;

  if (roster.length === 0) {
    return NextResponse.json({
      success: true,
      data: { employees: [], stagnantLeads: [], period, generatedAt: new Date().toISOString() },
    });
  }

  // ── 2-8. Parallel queries ──────────────────────────────────────────────
  const [
    leadStats,
    fupStats,
    visitStats,
    bookingStats,
    reminderStats,
    visitFunnel,
    contactedStats,
    revisitStats,
    stagnantLeads,
  ] = await Promise.all([

    // 2. Lead counts by assigned_to_user_id
    query<any>(
      `SELECT
          w.assigned_to_user_id                                   AS user_id,
          COUNT(*)                                                AS total_leads,
          COUNT(*) FILTER (WHERE w.is_lost_lead = true)           AS lost_leads,
          COUNT(*) FILTER (WHERE w.status = 'Closing'
                              OR w.status = 'Closed')             AS closing_leads,
          COUNT(*) FILTER (WHERE w.is_lost_lead = false
                              AND w.status NOT IN ('Closing','Closed')) AS active_leads,
          COUNT(*) FILTER (WHERE w.first_contact_at IS NOT NULL)  AS contacted_leads_legacy,
          AVG(EXTRACT(EPOCH FROM (w.first_contact_at - w.assigned_at)) / 3600.0)
            FILTER (WHERE w.first_contact_at IS NOT NULL
                      AND w.assigned_at IS NOT NULL)              AS avg_first_action_hours,
          COUNT(*) FILTER (WHERE w.budget IS NOT NULL
                              AND w.budget != ''
                              AND w.property_type IS NOT NULL
                              AND w.property_type != '')          AS data_quality_leads,
          COUNT(*) FILTER (WHERE w.last_activity_at IS NOT NULL
                              AND w.last_activity_at >= NOW() - INTERVAL '7 days'
                              AND w.is_lost_lead = false
                              AND w.status NOT IN ('Closing','Closed')) AS active_last_7d,
          COUNT(*) FILTER (WHERE (w.last_activity_at IS NULL
                              OR w.last_activity_at < NOW() - INTERVAL '7 days')
                              AND w.is_lost_lead = false
                              AND w.status NOT IN ('Closing','Closed')) AS stagnant_leads
        FROM walkin_enquiries w
        WHERE w.organization_id = $1
          AND w.assigned_to_user_id IS NOT NULL
          ${leadDateClause}
          ${empLeadClause}
        GROUP BY w.assigned_to_user_id`,
      [orgId],
    ),

    // 3. Follow-up counts by created_by_id
    query<any>(
      `SELECT
          f.created_by_id                                         AS user_id,
          COUNT(*)                                                AS total_followups,
          COUNT(DISTINCT f.lead_id)                               AS leads_with_followups
        FROM follow_ups f
        WHERE f.organization_id = $1
          AND f.created_by_id IS NOT NULL
          AND f.follow_up_type NOT IN ('internal_message', 'sm_reply')
          AND f.message NOT ILIKE '%Lead Transferred%'
          AND f.message NOT ILIKE '%Lead Marked as Closing%'
          ${eventDateClause}
          ${empFupClause}
        GROUP BY f.created_by_id`,
      [orgId],
    ),

    // 4. Site visit stats by created_by_id (completed only + all scheduled)
    query<any>(
      `SELECT
          sv.created_by_id                                        AS user_id,
          COUNT(*)                                                AS visits_scheduled,
          COUNT(*) FILTER (WHERE sv.status = 'completed')         AS visits_completed,
          COUNT(DISTINCT sv.lead_id)
            FILTER (WHERE sv.status = 'completed')                AS leads_with_completed_visits
        FROM site_visits sv
        WHERE sv.organization_id = $1
          AND sv.created_by_id IS NOT NULL
          ${visitScheduledDateClause}
          ${empVisitClause}
        GROUP BY sv.created_by_id`,
      [orgId],
    ),

    // 5. Booking stats by created_by_id — confirmed only
    query<any>(
      `SELECT
          ba.created_by_id                                        AS user_id,
          COUNT(*)                                                AS total_bookings,
          COUNT(*) FILTER (WHERE ba.booking_status = 'Confirmed') AS confirmed_bookings,
          COALESCE(SUM(ba.agreement_value)
            FILTER (WHERE ba.booking_status = 'Confirmed'), 0)   AS total_agreement_value
        FROM booking_applications ba
        WHERE ba.organization_id = $1
          AND ba.created_by_id IS NOT NULL
          ${bookingDateClause}
          ${empBookingClause}
        GROUP BY ba.created_by_id`,
      [orgId],
    ),

    // 6. Reminder adherence by assigned_user_id
    query<any>(
      `SELECT
          lr.assigned_user_id                                     AS user_id,
          COUNT(*)                                                AS total_reminders,
          COUNT(*) FILTER (WHERE lr.status = 'completed')         AS completed_reminders,
          COUNT(*) FILTER (WHERE lr.status IN ('pending','notified')
                              AND lr.remind_at < NOW())           AS overdue_reminders
        FROM lead_reminders lr
        WHERE lr.organization_id = $1
          ${reminderDateClause}
          ${empReminderClause}
        GROUP BY lr.assigned_user_id`,
      [orgId],
    ),

    // 7. Visit funnel — leads with completed visits by lead owner
    query<any>(
      `SELECT
          w.assigned_to_user_id                                   AS user_id,
          COUNT(DISTINCT sv.lead_id)                              AS leads_visit_completed
        FROM walkin_enquiries w
        JOIN site_visits sv ON sv.lead_id = w.id AND sv.status = 'completed'
        WHERE w.organization_id = $1
          AND w.assigned_to_user_id IS NOT NULL
          ${leadDateClause}
          ${empLeadClause}
        GROUP BY w.assigned_to_user_id`,
      [orgId],
    ),

    // 8. Contacted leads via call_sessions (manual call + recording)
    query<any>(
      `SELECT
          cs.user_id                                              AS user_id,
          COUNT(DISTINCT cs.lead_id)                              AS contacted_leads
        FROM call_sessions cs
        WHERE cs.organization_id = $1
          AND cs.lead_id IS NOT NULL
          AND cs.recording_r2_key IS NOT NULL
          ${callDateClause}
          ${empCallClause}
        GROUP BY cs.user_id`,
      [orgId],
    ),

    // 9. Recurring site visits — total revisits per employee
    query<any>(
      `SELECT
          sv.created_by_id                                        AS user_id,
          SUM(visit_count - 1)                                    AS recurring_visits
        FROM (
          SELECT sv.created_by_id, sv.lead_id, COUNT(*) AS visit_count
          FROM site_visits sv
          WHERE sv.organization_id = $1
            AND sv.status = 'completed'
            AND sv.created_by_id IS NOT NULL
            ${visitDateClause}
            ${empVisitClause}
          GROUP BY sv.created_by_id, sv.lead_id
          HAVING COUNT(*) > 1
        ) sub
        GROUP BY sub.created_by_id`,
      [orgId],
    ),

    // 10. Stagnant leads detail (alerts tab)
    query<any>(
      `SELECT
          w.id, w.sr_no, w.name, w.phone, w.assigned_to, w.status,
          w.last_activity_at, w.assigned_at, w.budget, w.configuration,
          w.assigned_to_user_id
        FROM walkin_enquiries w
        WHERE w.organization_id = $1
          AND w.is_lost_lead = false
          AND w.status NOT IN ('Closing', 'Closed')
          AND (w.last_activity_at IS NULL OR w.last_activity_at < NOW() - INTERVAL '7 days')
          AND w.assigned_to_user_id IS NOT NULL
          ${empLeadClause}
          ${leadDateClause}
        ORDER BY w.last_activity_at ASC NULLS FIRST
        LIMIT 100`,
      [orgId],
    ),
  ]);

  // ── Merge into per-employee records ─────────────────────────────────────

  const leadMap = new Map<number, any>();
  for (const r of leadStats) leadMap.set(Number(r.user_id), r);

  const fupMap = new Map<number, any>();
  for (const r of fupStats) if (r.user_id != null) fupMap.set(Number(r.user_id), r);

  const visitMap = new Map<number, any>();
  for (const r of visitStats) if (r.user_id != null) visitMap.set(Number(r.user_id), r);

  const bookingMap = new Map<number, any>();
  for (const r of bookingStats) if (r.user_id != null) bookingMap.set(Number(r.user_id), r);

  const reminderMap = new Map<number, any>();
  for (const r of reminderStats) reminderMap.set(Number(r.user_id), r);

  const visitFunnelMap = new Map<number, any>();
  for (const r of visitFunnel) visitFunnelMap.set(Number(r.user_id), r);

  const contactedMap = new Map<number, any>();
  for (const r of contactedStats) contactedMap.set(Number(r.user_id), r);

  const revisitMap = new Map<number, any>();
  for (const r of revisitStats) if (r.user_id != null) revisitMap.set(Number(r.user_id), r);

  const employees = roster.map((u) => {
    const ls = leadMap.get(u.id) || {};
    const fs = fupMap.get(u.id) || {};
    const vs = visitMap.get(u.id) || {};
    const bs = bookingMap.get(u.id) || {};
    const rs = reminderMap.get(u.id) || {};
    const vf = visitFunnelMap.get(u.id) || {};
    const cs = contactedMap.get(u.id) || {};
    const rv = revisitMap.get(u.id) || {};

    const totalLeads = Number(ls.total_leads || 0);
    const activeLeads = Number(ls.active_leads || 0);
    const lostLeads = Number(ls.lost_leads || 0);
    const closingLeads = Number(ls.closing_leads || 0);
    const contactedLeads = Number(cs.contacted_leads || 0);
    const stagnantCount = Number(ls.stagnant_leads || 0);
    const dataQualityLeads = Number(ls.data_quality_leads || 0);
    const activeInLast7d = Number(ls.active_last_7d || 0);

    const totalFollowups = Number(fs.total_followups || 0);
    const leadsWithFollowups = Number(fs.leads_with_followups || 0);

    const visitsScheduled = Number(vs.visits_scheduled || 0);
    const visitsCompleted = Number(vs.visits_completed || 0);
    const leadsWithVisits = Number(vs.leads_with_completed_visits || 0);
    const recurringVisits = Number(rv.recurring_visits || 0);

    const totalBookings = Number(bs.total_bookings || 0);
    const confirmedBookings = Number(bs.confirmed_bookings || 0);
    const totalAgreementValue = Number(bs.total_agreement_value || 0);

    const totalReminders = Number(rs.total_reminders || 0);
    const completedReminders = Number(rs.completed_reminders || 0);
    const overdueReminders = Number(rs.overdue_reminders || 0);

    const leadsVisitCompleted = Number(vf.leads_visit_completed || 0);

    // Derived rates (null if denominator is 0)
    const firstActionSpeed = ls.avg_first_action_hours != null
      ? Math.round(Number(ls.avg_first_action_hours) * 10) / 10
      : null;
    const contactRate = totalLeads > 0 ? Math.round((contactedLeads / totalLeads) * 100) : null;
    const followupRate = activeLeads > 0
      ? Math.round((leadsWithFollowups / activeLeads) * 100)
      : null;
    const siteVisitRate = totalLeads > 0
      ? Math.round((leadsWithVisits / totalLeads) * 100)
      : null;
    const visitCompletionRate = visitsScheduled > 0
      ? Math.round((visitsCompleted / visitsScheduled) * 100)
      : null;
    const bookingRate = totalLeads > 0
      ? Math.round((confirmedBookings / totalLeads) * 100)
      : null;
    const lostRate = totalLeads > 0
      ? Math.round((lostLeads / totalLeads) * 100)
      : null;
    const stagnationRate = activeLeads > 0
      ? Math.round((stagnantCount / activeLeads) * 100)
      : null;
    const dataQualityRate = totalLeads > 0
      ? Math.round((dataQualityLeads / totalLeads) * 100)
      : null;
    const reminderCompletionRate = totalReminders > 0
      ? Math.round((completedReminders / totalReminders) * 100)
      : null;

    return {
      id: u.id,
      name: u.name,
      role: u.role,

      totalLeads,
      activeLeads,
      closingLeads,
      lostLeads,
      contactedLeads,
      stagnantLeads: stagnantCount,
      activeInLast7d,
      dataQualityLeads,

      totalFollowups,
      leadsWithFollowups,

      visitsScheduled,
      visitsCompleted,
      leadsWithVisits,
      leadsVisitCompleted,
      recurringVisits,

      totalBookings,
      // Keep activeBookings key for backward compat with existing frontend
      activeBookings: confirmedBookings,
      confirmedBookings,
      totalAgreementValue,

      totalReminders,
      completedReminders,
      overdueReminders,

      firstActionSpeed,
      contactRate,
      followupRate,
      siteVisitRate,
      visitCompletionRate,
      bookingRate,
      lostRate,
      stagnationRate,
      dataQualityRate,
      reminderCompletionRate,
    };
  });

  employees.sort((a, b) => b.confirmedBookings - a.confirmedBookings || b.totalLeads - a.totalLeads);

  return NextResponse.json({
    success: true,
    data: {
      employees,
      stagnantLeads,
      period,
      generatedAt: new Date().toISOString(),
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADS VIEW
// ═══════════════════════════════════════════════════════════════════════════

async function handleLeadsView(
  req: NextRequest,
  orgId: string,
  interval: string | null,
  employeeId: number | null,
) {
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "50") || 50));
  const offset = (page - 1) * limit;
  const search = (sp.get("search") || "").trim();
  const expectation = (sp.get("expectation") || "").trim();
  const followupToday = sp.get("followup_today") === "true";

  const conditions: string[] = [
    "w.organization_id = $1",
    "w.assigned_to_user_id IS NOT NULL",
  ];
  const values: any[] = [orgId];
  let paramIdx = 2;

  if (interval) {
    conditions.push(`w.assigned_at >= NOW() - INTERVAL '${interval}'`);
  }

  if (employeeId !== null) {
    conditions.push(`w.assigned_to_user_id = $${paramIdx}`);
    values.push(employeeId);
    paramIdx++;
  }

  if (search) {
    conditions.push(`(w.name ILIKE $${paramIdx} OR w.phone ILIKE $${paramIdx})`);
    values.push(`%${search}%`);
    paramIdx++;
  }

  if (expectation) {
    conditions.push(`w.lead_interest_status = $${paramIdx}`);
    values.push(expectation);
    paramIdx++;
  }

  // Correlated subquery fragments
  const followupTodaySub = `EXISTS (
    SELECT 1 FROM follow_ups f2
    WHERE f2.lead_id = w.id
      AND f2.organization_id = w.organization_id
      AND (f2.created_at AT TIME ZONE 'Asia/Kolkata')::date = ${IST_TODAY_START}
      AND f2.created_by_id IS NOT NULL
      AND f2.follow_up_type NOT IN ('internal_message', 'sm_reply')
      AND f2.message NOT ILIKE '%Lead Transferred%'
      AND f2.message NOT ILIKE '%Lead Marked as Closing%'
  )`;

  if (followupToday) {
    conditions.push(followupTodaySub);
  }

  const contactedSub = `EXISTS (
    SELECT 1 FROM call_sessions cs2
    WHERE cs2.lead_id = w.id
      AND cs2.organization_id = w.organization_id
      AND cs2.recording_r2_key IS NOT NULL
  )`;

  const siteVisitCountSub = `(
    SELECT COUNT(*) FROM site_visits sv2
    WHERE sv2.lead_id = w.id
      AND sv2.organization_id = w.organization_id
      AND sv2.status = 'completed'
  )`;

  const whereClause = conditions.join(" AND ");

  // Count + data in parallel
  const [countResult, rows] = await Promise.all([
    query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM walkin_enquiries w WHERE ${whereClause}`,
      values,
    ),
    query<any>(
      `SELECT
          w.id,
          w.sr_no,
          w.name                                AS client_name,
          w.phone,
          w.assigned_to                         AS assigned_employee,
          w.assigned_to_user_id                 AS assigned_employee_id,
          w.status,
          w.lead_interest_status                AS expectation,
          w.is_lost_lead,
          ${followupTodaySub}                   AS follow_up_done_today,
          ${contactedSub}                       AS contacted_lead,
          ${siteVisitCountSub}                  AS total_site_visits
        FROM walkin_enquiries w
        WHERE ${whereClause}
        ORDER BY w.sr_no DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    ),
  ]);

  const total = Number(countResult[0]?.total || 0);

  return NextResponse.json({
    success: true,
    data: {
      leads: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
}
