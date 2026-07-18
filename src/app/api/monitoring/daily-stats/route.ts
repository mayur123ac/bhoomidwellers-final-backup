//monitoring/daily-stats/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const now = new Date();
    const todayStrIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0];
    const dayStartIST = new Date(`${todayStrIST}T00:00:00.000+05:30`);
    const dayEndIST = new Date(`${todayStrIST}T23:59:59.999+05:30`);
    const startOfDay = dayStartIST.toISOString();
    const endOfDay = dayEndIST.toISOString();

    // ── Tomorrow's date range (IST) ──────────────────────────────────────────
    const tomorrowDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStrIST = tomorrowDate.toISOString().split("T")[0];
    const tomorrowStartIST = new Date(`${tomorrowStrIST}T00:00:00.000+05:30`);
    const tomorrowEndIST   = new Date(`${tomorrowStrIST}T23:59:59.999+05:30`);
    const startOfTomorrow  = tomorrowStartIST.toISOString();
    const endOfTomorrow    = tomorrowEndIST.toISOString();

    const safeQuery = async (sql: string, params: any[] = []) => {
      try {
        return await query(sql, params);
      } catch (e) {
        console.error("Daily stats safe query failed:", e);
        return [];
      }
    };

    const users = await query(`
      SELECT id, name, role FROM public.users
      WHERE role IN ('Sales Manager', 'Site Head', 'Receptionist') AND is_active = true
      ORDER BY role, name
    `);

    const leadCounts = await safeQuery(`
      SELECT assigned_to AS name, COUNT(*) AS total
      FROM public.walkin_enquiries
      WHERE assigned_to IS NOT NULL AND assigned_to != ''
      GROUP BY assigned_to
    `);

    const followUpsToday = await safeQuery(`
      SELECT created_by_name AS name, COUNT(*) AS count
      FROM public.follow_ups
      WHERE created_at >= $1 AND created_at < $2
        AND message NOT LIKE '%Lead Transferred%'
        AND message NOT LIKE '%Lead Marked as Closing%'
      GROUP BY created_by_name
    `, [startOfDay, endOfDay]);

    const waToday = await safeQuery(`
      SELECT sender_name AS name, COUNT(*) AS count
      FROM public.whatsapp_logs
      WHERE sent_at >= $1 AND sent_at < $2
      GROUP BY sender_name
    `, [startOfDay, endOfDay]);

    // ── Today's site visits ──────────────────────────────────────────────────
    const siteVisitRows = await safeQuery(
      `SELECT sv.*, we.name, we.assigned_to, we.status as lead_status
       FROM public.site_visits sv
       JOIN public.walkin_enquiries we ON we.id = sv.lead_id
       WHERE sv.visit_date >= $1 AND sv.visit_date <= $2
       ORDER BY sv.visit_date ASC`,
      [startOfDay, endOfDay]
    );

    const siteVisitsToday       = siteVisitRows;
    const completedVisitsToday  = siteVisitRows.filter((v: any) => v.status === "completed").length;
    const pendingVisitsToday    = siteVisitRows.filter((v: any) => v.status === "scheduled").length;

    // ── Tomorrow's site visits ───────────────────────────────────────────────
    const siteVisitsTomorrow = await safeQuery(
      `SELECT sv.*, we.name, we.assigned_to, we.status as lead_status
       FROM public.site_visits sv
       JOIN public.walkin_enquiries we ON we.id = sv.lead_id
       WHERE sv.visit_date >= $1 AND sv.visit_date <= $2
       ORDER BY sv.visit_date ASC`,
      [startOfTomorrow, endOfTomorrow]
    );

    const siteVisitActionsToday = await safeQuery(
      `SELECT
         f.id,
         f.lead_id,
         f.created_by_name,
         f.message,
         f.created_at,
         we.name AS lead_name,
         we.assigned_to
       FROM public.follow_ups f
       LEFT JOIN public.walkin_enquiries we ON we.id = f.lead_id
       WHERE f.created_at >= $1 AND f.created_at <= $2
         AND (
           f.message ILIKE '%Site Visit Scheduled%'
           OR f.message ILIKE '%Re-Site Visit Scheduled%'
           OR f.message ILIKE '%Re-Site Visit Rescheduled%'
           OR f.message ILIKE '%Site Visit marked as%'
         )
       ORDER BY f.created_at DESC`,
      [startOfDay, endOfDay]
    );

    const leadsNoFollowUp = await safeQuery(`
      SELECT we.id, we.name, we.assigned_to
      FROM public.walkin_enquiries we
      WHERE we.status NOT IN ('Closing', 'Closed', 'Completed')
        AND we.assigned_to IS NOT NULL AND we.assigned_to != ''
        AND NOT EXISTS (
          SELECT 1 FROM public.follow_ups f
          WHERE f.lead_id = we.id AND f.created_at >= $1 AND f.created_at < $2
        )
    `, [startOfDay, endOfDay]);

    const leadMap: Record<string, number> = {};
    leadCounts.forEach((r: any) => { leadMap[r.name] = parseInt(r.total); });

    const fupMap: Record<string, number> = {};
    followUpsToday.forEach((r: any) => { fupMap[r.name] = parseInt(r.count); });

    const waMap: Record<string, number> = {};
    waToday.forEach((r: any) => { waMap[r.name] = parseInt(r.count); });

    const noFupByManager: Record<string, any[]> = {};
    leadsNoFollowUp.forEach((l: any) => {
      if (!noFupByManager[l.assigned_to]) noFupByManager[l.assigned_to] = [];
      noFupByManager[l.assigned_to].push({ id: l.id, name: l.name });
    });

    const stats = users.map((u: any) => ({
      name: u.name,
      role: u.role,
      totalLeads: leadMap[u.name] || 0,
      followUpsToday: fupMap[u.name] || 0,
      waToday: waMap[u.name] || 0,
      pendingLeads: noFupByManager[u.name]?.length || 0,
      noFupLeads: noFupByManager[u.name] || [],
      requiredToday: leadMap[u.name] || 0,
      remainingToday: Math.max(0, (leadMap[u.name] || 0) - (fupMap[u.name] || 0)),
    }));

    return NextResponse.json({
      success: true,
      data: {
        stats,
        siteVisitsToday,
        siteVisitsTomorrow,
        siteVisitActionsToday,
        completedVisitsToday,
        pendingVisitsToday,
        date: now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }),
        totalFollowUpsToday: followUpsToday.reduce((a: number, r: any) => a + parseInt(r.count), 0),
        totalWaToday: waToday.reduce((a: number, r: any) => a + parseInt(r.count), 0),
      }
    });
  } catch (error) {
    console.error("Daily stats error:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch stats" }, { status: 500 });
  }
}