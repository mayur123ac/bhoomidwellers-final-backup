// api/monitoring/employee-performance/route.ts
// Aggregates lead-lifecycle metrics per employee for the Employee Performance panel.
//
// GET /api/monitoring/employee-performance?period=30d
//   period: 7d | 30d | 90d | all (default: 30d)
//
// Returns per-employee metrics derived from existing tables — no new schema required.

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
  if (period === "all") return null; // no date filter
  return "30 days"; // default
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const role = (gate.session.role ?? "").toLowerCase().replace(/_/g, " ");
  if (role !== "admin" && role !== "super admin" && role !== "site head") {
    return NextResponse.json({ success: false, message: "Admin only." }, { status: 403 });
  }

  const orgId = await getOrganizationId();
  const period = req.nextUrl.searchParams.get("period") || "30d";
  const interval = periodToInterval(period);

  // Date clause for walkin_enquiries — filters when the lead was assigned
  const dateClause = interval
    ? `AND w.assigned_at >= NOW() - INTERVAL '${interval}'`
    : "";
  // For follow_ups and events — filters the event date
  const eventDateClause = interval
    ? `AND f.created_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const visitDateClause = interval
    ? `AND sv.created_at >= NOW() - INTERVAL '${interval}'`
    : "";
  const reminderDateClause = interval
    ? `AND lr.created_at >= NOW() - INTERVAL '${interval}'`
    : "";

  // ── 1. Roster: active users who handle leads ──────────────────────────
  const roster = await query<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM users
      WHERE organization_id = $1
        AND is_active = true
        AND role IN ('Sales Manager', 'Site Head', 'Receptionist')
      ORDER BY role, name`,
    [orgId],
  );

  if (roster.length === 0) {
    return NextResponse.json({
      success: true,
      data: { employees: [], period, generatedAt: new Date().toISOString() },
    });
  }

  // ── 2. Lead counts & assignment metrics per employee ──────────────────
  const leadStats = await query<any>(
    `SELECT
        w.assigned_to                                           AS name,
        COUNT(*)                                                AS total_leads,
        COUNT(*) FILTER (WHERE w.is_lost_lead = true)           AS lost_leads,
        COUNT(*) FILTER (WHERE w.status = 'Closing'
                            OR w.status = 'Closed')             AS closing_leads,
        COUNT(*) FILTER (WHERE w.is_lost_lead = false
                            AND w.status NOT IN ('Closing','Closed')) AS active_leads,
        COUNT(*) FILTER (WHERE w.first_contact_at IS NOT NULL)  AS contacted_leads,
        AVG(EXTRACT(EPOCH FROM (w.first_contact_at - w.assigned_at)) / 3600.0)
          FILTER (WHERE w.first_contact_at IS NOT NULL
                    AND w.assigned_at IS NOT NULL)               AS avg_first_action_hours,
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
        AND w.assigned_to IS NOT NULL
        AND w.assigned_to != ''
        ${dateClause}
      GROUP BY w.assigned_to`,
    [orgId],
  );

  // ── 3. Follow-up counts per employee ──────────────────────────────────
  // Prefer created_by_id (integer FK) when available; fall back to name match.
  const fupStats = await query<any>(
    `SELECT
        COALESCE(f.created_by_id, u_name.id)                    AS user_id,
        COALESCE(u_id.name, f.created_by_name)                  AS name,
        COUNT(*)                                                AS total_followups,
        COUNT(DISTINCT f.lead_id)                               AS leads_with_followups
      FROM follow_ups f
      LEFT JOIN users u_id   ON u_id.id = f.created_by_id
      LEFT JOIN users u_name ON u_name.name = f.created_by_name
                             AND u_name.organization_id = $1
                             AND f.created_by_id IS NULL
      WHERE f.organization_id = $1
        AND f.message NOT ILIKE '%Lead Transferred%'
        AND f.message NOT ILIKE '%Lead Marked as Closing%'
        ${eventDateClause}
      GROUP BY COALESCE(f.created_by_id, u_name.id),
               COALESCE(u_id.name, f.created_by_name)`,
    [orgId],
  );

  // ── 4. Site visit stats per employee ──────────────────────────────────
  const visitStats = await query<any>(
    `SELECT
        sv.created_by                                           AS name,
        COUNT(*)                                                AS visits_scheduled,
        COUNT(*) FILTER (WHERE sv.status = 'completed')         AS visits_completed,
        COUNT(*) FILTER (WHERE sv.status = 'cancelled')         AS visits_cancelled,
        COUNT(DISTINCT sv.lead_id)                              AS leads_with_visits
      FROM site_visits sv
      JOIN walkin_enquiries w ON w.id = sv.lead_id
      WHERE w.organization_id = $1
        ${visitDateClause}
      GROUP BY sv.created_by`,
    [orgId],
  );

  // ── 5. Booking stats per assigned_to at booking time ──────────────────
  const bookingStats = await query<any>(
    `SELECT
        ba.created_by                                           AS name,
        COUNT(*)                                                AS total_bookings,
        COUNT(*) FILTER (WHERE ba.booking_status != 'Cancelled') AS active_bookings,
        COALESCE(SUM(ba.agreement_value)
          FILTER (WHERE ba.booking_status != 'Cancelled'), 0)   AS total_agreement_value
      FROM booking_applications ba
      JOIN walkin_enquiries w ON w.id = ba.lead_id
      WHERE w.organization_id = $1
        ${interval ? `AND ba.created_at >= NOW() - INTERVAL '${interval}'` : ""}
      GROUP BY ba.created_by`,
    [orgId],
  );

  // ── 6. Reminder adherence per employee ────────────────────────────────
  const reminderStats = await query<any>(
    `SELECT
        lr.assigned_user_id                                     AS user_id,
        COUNT(*)                                                AS total_reminders,
        COUNT(*) FILTER (WHERE lr.status = 'completed')         AS completed_reminders,
        COUNT(*) FILTER (WHERE lr.status = 'cancelled')         AS cancelled_reminders,
        COUNT(*) FILTER (WHERE lr.status IN ('pending','notified')
                            AND lr.remind_at < NOW())           AS overdue_reminders
      FROM lead_reminders lr
      WHERE lr.organization_id = $1
        ${reminderDateClause}
      GROUP BY lr.assigned_user_id`,
    [orgId],
  );

  // ── 7. Leads with site visit but assigned_to (for funnel by assignee) ─
  const visitFunnel = await query<any>(
    `SELECT
        w.assigned_to                                           AS name,
        COUNT(DISTINCT sv.lead_id)
          FILTER (WHERE sv.status = 'completed')                AS leads_visit_completed
      FROM walkin_enquiries w
      JOIN site_visits sv ON sv.lead_id = w.id
      WHERE w.organization_id = $1
        AND w.assigned_to IS NOT NULL
        ${dateClause}
      GROUP BY w.assigned_to`,
    [orgId],
  );

  // ── 8. Recent stagnant leads detail (for alerts tab) ──────────────────
  const stagnantLeads = await query<any>(
    `SELECT
        w.id, w.sr_no, w.name, w.phone, w.assigned_to, w.status,
        w.last_activity_at, w.assigned_at, w.budget, w.configuration
      FROM walkin_enquiries w
      WHERE w.organization_id = $1
        AND w.is_lost_lead = false
        AND w.status NOT IN ('Closing', 'Closed')
        AND (w.last_activity_at IS NULL OR w.last_activity_at < NOW() - INTERVAL '7 days')
        AND w.assigned_to IS NOT NULL
        AND w.assigned_to != ''
      ORDER BY w.last_activity_at ASC NULLS FIRST
      LIMIT 100`,
    [orgId],
  );

  // ── Merge into per-employee records ───────────────────────────────────

  // Index lookup maps
  const leadMap = new Map<string, any>();
  for (const r of leadStats) leadMap.set(r.name, r);

  const fupMapById = new Map<number, any>();
  const fupMapByName = new Map<string, any>();
  for (const r of fupStats) {
    if (r.user_id != null) fupMapById.set(Number(r.user_id), r);
    if (r.name) fupMapByName.set(r.name, r);
  }

  const visitMap = new Map<string, any>();
  for (const r of visitStats) visitMap.set(r.name, r);

  const bookingMap = new Map<string, any>();
  for (const r of bookingStats) bookingMap.set(r.name, r);

  const reminderMap = new Map<number, any>();
  for (const r of reminderStats) reminderMap.set(r.user_id, r);

  const visitFunnelMap = new Map<string, any>();
  for (const r of visitFunnel) visitFunnelMap.set(r.name, r);

  const employees = roster.map((u) => {
    const ls = leadMap.get(u.name) || {};
    const fs = fupMapById.get(u.id) || fupMapByName.get(u.name) || {};
    const vs = visitMap.get(u.name) || {};
    const bs = bookingMap.get(u.name) || {};
    const rs = reminderMap.get(u.id) || {};
    const vf = visitFunnelMap.get(u.name) || {};

    const totalLeads = Number(ls.total_leads || 0);
    const activeLeads = Number(ls.active_leads || 0);
    const lostLeads = Number(ls.lost_leads || 0);
    const closingLeads = Number(ls.closing_leads || 0);
    const contactedLeads = Number(ls.contacted_leads || 0);
    const stagnantCount = Number(ls.stagnant_leads || 0);
    const dataQualityLeads = Number(ls.data_quality_leads || 0);
    const activeInLast7d = Number(ls.active_last_7d || 0);

    const totalFollowups = Number(fs.total_followups || 0);
    const leadsWithFollowups = Number(fs.leads_with_followups || 0);

    const visitsScheduled = Number(vs.visits_scheduled || 0);
    const visitsCompleted = Number(vs.visits_completed || 0);
    const leadsWithVisits = Number(vs.leads_with_visits || 0);

    const totalBookings = Number(bs.total_bookings || 0);
    const activeBookings = Number(bs.active_bookings || 0);
    const totalAgreementValue = Number(bs.total_agreement_value || 0);

    const totalReminders = Number(rs.total_reminders || 0);
    const completedReminders = Number(rs.completed_reminders || 0);
    const overdueReminders = Number(rs.overdue_reminders || 0);

    const leadsVisitCompleted = Number(vf.leads_visit_completed || 0);

    // Derived rates (null if denominator is 0 — don't fake 100%)
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
      ? Math.round((activeBookings / totalLeads) * 100)
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

      // Counts
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

      totalBookings,
      activeBookings,
      totalAgreementValue,

      totalReminders,
      completedReminders,
      overdueReminders,

      // Rates (null = insufficient data)
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

  // Sort by bookings desc, then by active leads desc
  employees.sort((a, b) => b.activeBookings - a.activeBookings || b.totalLeads - a.totalLeads);

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
