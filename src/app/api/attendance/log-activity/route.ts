import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { broadcastEvent } from "@/lib/eventBus";

export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin", "site_head", "site head", "sales_manager", "sales manager", "receptionist", "caller"]);
    if (!auth.isAuthorized || !auth.session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.session._id;
    let body: any = {};
    try { body = await req.json(); } catch { }

    const { type, module, leadId, leadName, action } = body;
    if (!type || !action) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }

    // Insert structured event into permanent audit history
    await query(`
      INSERT INTO employee_activity_logs 
      (user_id, action_type, description, module, lead_id, lead_name, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      userId,
      type,         // e.g. "LEAD_EDIT"
      action,       // e.g. "Editing Sales Form"
      module || "Dashboard",
      leadId || null,
      leadName || null
    ]);

    // Broadcast live historical event to Admins and Site Heads
    broadcastEvent({
      type: "ACTIVITY",
      userId,
      userName: auth.session.name,
      action_type: type,
      action,
      module: module || "Dashboard",
      leadId: leadId || null,
      leadName: leadName || null,
      timestamp: new Date().toISOString()
    }, ["admin", "site_head"]);

    // 2. IMMEDIATELY upsert the real-time snapshot (Live State)
    // We check if lead_id changed to update lead_started_at
    await query(`
      INSERT INTO employee_live_state (
        user_id, current_module, active_lead_id, active_lead_name, current_action, current_route,
        last_activity, is_idle, updated_at, lead_started_at, productivity_score
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), false, NOW(), NOW(), 1)
      ON CONFLICT (user_id) DO UPDATE SET
        current_module = EXCLUDED.current_module,
        current_action = EXCLUDED.current_action,
        current_route = EXCLUDED.current_route,
        last_activity = EXCLUDED.last_activity,
        is_idle = false,
        updated_at = EXCLUDED.updated_at,
        productivity_score = employee_live_state.productivity_score + 1,
        lead_started_at = CASE 
          WHEN employee_live_state.active_lead_id IS DISTINCT FROM EXCLUDED.active_lead_id THEN NOW()
          ELSE employee_live_state.lead_started_at 
        END,
        active_lead_id = EXCLUDED.active_lead_id,
        active_lead_name = EXCLUDED.active_lead_name
    `, [
      userId,
      module || "Dashboard",
      leadId || null,
      leadName || null,
      action,
      "/"
    ]);

    // Broadcast the snapshot state immediately for instant UI refresh
    broadcastEvent({
      type: "SESSION_UPDATE",
      userId,
      current_module: module || "Dashboard",
      active_lead_id: leadId || null,
      active_lead_name: leadName || null,
      current_action: action,
      is_idle: false,
      last_activity: new Date().toISOString()
    }, ["admin", "site_head"]);

    // Risk Engine: Check for excessive lead switching (e.g. 20+ leads in 10 mins)
    if (leadId) {
      const switchResult = await query(`
        SELECT COUNT(DISTINCT lead_id) as lead_count
        FROM employee_activity_logs
        WHERE user_id = $1 AND timestamp > NOW() - INTERVAL '10 minutes' AND lead_id IS NOT NULL
      `, [userId]);

      const leadCount = parseInt(switchResult[0]?.lead_count || "0", 10);
      if (leadCount >= 20) {
        broadcastEvent({
          type: "SMART_ALERT",
          alertType: "EXCESSIVE_LEAD_SWITCHING",
          userId,
          userName: auth.session.name,
          message: `⚠ ${auth.session.name} has rapidly opened ${leadCount} distinct leads in the last 10 minutes.`,
          timestamp: new Date().toISOString()
        }, ["admin", "site_head"]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Log activity error:", error);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
