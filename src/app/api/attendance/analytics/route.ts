import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "site_head", "site head", "sales_manager", "sales manager"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ message: "Missing userId" }, { status: 400 });
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. Fetch Audit History (Timeline)
    const logs = await query(`
      SELECT action_type, description as action, module, lead_id, lead_name, timestamp as created_at
      FROM employee_activity_logs
      WHERE user_id = $1 AND DATE(timestamp) = $2
      ORDER BY timestamp DESC
      LIMIT 100
    `, [userId, today]);

    // 2. Compute Analytics Metrics
    const leadsOpenedRes = await query(`
      SELECT COUNT(DISTINCT lead_id) as count
      FROM employee_activity_logs
      WHERE user_id = $1 AND DATE(timestamp) = $2 AND lead_id IS NOT NULL
    `, [userId, today]);

    const interactionsRes = await query(`
      SELECT action_type, COUNT(*) as count
      FROM employee_activity_logs
      WHERE user_id = $1 AND DATE(timestamp) = $2 
      GROUP BY action_type
    `, [userId, today]);

    let callsInitiated = 0;
    let followupsAdded = 0;
    let whatsappInteractions = 0;
    let totalInteractions = 0;

    interactionsRes.forEach((row: any) => {
      const type = row.action_type;
      const count = parseInt(row.count, 10);
      totalInteractions += count;
      if (type === 'CALL_STARTED') callsInitiated += count;
      if (type === 'FOLLOWUP_ADDED' || type.includes('EDIT')) followupsAdded += count;
      if (type === 'WHATSAPP_SENT') whatsappInteractions += count;
    });

    // 3. Risk Engine calculations
    let frequentLeadSwitching = false;
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentLeads = logs.filter((l: any) => new Date(l.created_at) > tenMinsAgo && l.lead_id);
    const uniqueRecentLeads = new Set(recentLeads.map((l: any) => l.lead_id));
    if (uniqueRecentLeads.size > 5) {
      frequentLeadSwitching = true;
    }

    return NextResponse.json({
      analytics: {
        leadsOpened: parseInt(leadsOpenedRes[0]?.count || 0),
        callsInitiated,
        followupsAdded,
        whatsappInteractions,
        interactions: totalInteractions
      },
      risks: {
        frequentLeadSwitching,
        uniqueRecentLeadsCount: uniqueRecentLeads.size
      },
      timeline: logs
    });
  } catch (error) {
    console.error("Analytics API error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
