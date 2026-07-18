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
    const now = new Date();
    let body: any = {};
    try { body = await req.json(); } catch { }

    const {
      current_module = "Dashboard",
      active_lead_id = null,
      active_lead_name = null,
      current_action = "Viewing",
      current_route = "/",
      is_idle = false
    } = body;

    // Force Logout Check: verify if the most recent session has been marked inactive by an admin
    const sessionCheck = await query(`
      SELECT is_active 
      FROM employee_sessions 
      WHERE user_id = $1 AND DATE(session_start) = CURRENT_DATE
      ORDER BY session_start DESC LIMIT 1
    `, [userId]);

    if (sessionCheck.length > 0 && !sessionCheck[0].is_active) {
      return NextResponse.json({ forceLogout: true }, { status: 401 });
    }

    // Update the most recent active session for this user (legacy heartbeat)
    await query(
      `UPDATE employee_sessions 
       SET last_heartbeat = $1 
       WHERE user_id = $2 AND is_active = true
       AND id = (
           SELECT id FROM employee_sessions 
           WHERE user_id = $2 AND is_active = true 
           ORDER BY session_start DESC LIMIT 1
       )`,
      [now, userId]
    );

    // Score weight dictionary
    const actionScores: Record<string, number> = {
      "Opened Lead": 1,
      "Added Followup": 5,
      "Started Call": 8,
      "Sent WhatsApp": 4,
      "Added Site Visit": 10
    };
    
    const scoreBoost = actionScores[current_action] || 0;

    // Upsert live operational state
    const liveStateResult = await query(`
      INSERT INTO employee_live_state (
        user_id, current_module, active_lead_id, active_lead_name, current_action, current_route,
        last_activity, idle_duration_seconds, productivity_score, is_idle, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7)
      ON CONFLICT (user_id) DO UPDATE SET
        current_module = EXCLUDED.current_module,
        active_lead_id = EXCLUDED.active_lead_id,
        active_lead_name = EXCLUDED.active_lead_name,
        current_action = EXCLUDED.current_action,
        current_route = EXCLUDED.current_route,
        last_activity = EXCLUDED.last_activity,
        idle_duration_seconds = CASE 
          WHEN EXCLUDED.is_idle THEN employee_live_state.idle_duration_seconds + EXTRACT(EPOCH FROM (EXCLUDED.last_activity - employee_live_state.updated_at))
          ELSE 0 
        END,
        productivity_score = GREATEST(0, employee_live_state.productivity_score + $11 - (CASE WHEN EXCLUDED.is_idle THEN 1 ELSE 0 END)),
        is_idle = EXCLUDED.is_idle,
        updated_at = EXCLUDED.last_activity
      RETURNING idle_duration_seconds
    `, [
      userId, current_module, active_lead_id, active_lead_name, current_action, current_route,
      now, 0, scoreBoost, is_idle, scoreBoost
    ]);

    const currentIdleSeconds = liveStateResult[0]?.idle_duration_seconds || 0;
    if (currentIdleSeconds > 2700) { // 45 minutes
      broadcastEvent({
        type: "SMART_ALERT",
        alertType: "EXCESSIVE_IDLE",
        userId,
        userName: auth.session.name,
        message: `⚠ ${auth.session.name} has been idle for over ${Math.floor(currentIdleSeconds / 60)} minutes.`,
        timestamp: now.toISOString()
      }, ["admin", "site_head"]);
    }

    // Broadcast to Admins so they see the live status instantly
    broadcastEvent({
      type: "SESSION_UPDATE",
      userId,
      current_module,
      active_lead_id,
      active_lead_name,
      current_action,
      is_idle,
      last_activity: now.toISOString()
    }, ["admin", "site_head"]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
