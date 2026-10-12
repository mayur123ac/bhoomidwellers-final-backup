import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { broadcastEvent } from "@/lib/eventBus";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin", "site_head", "site head", "sales_manager", "sales manager", "receptionist", "caller"]);
    if (!auth.isAuthorized || !auth.session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.session._id;
    // MT-05: resolved once per request, then reused by every statement below.
    const orgId = await getOrganizationId();
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

    // Score weight dictionary
    const actionScores: Record<string, number> = {
      "Opened Lead": 1,
      "Added Followup": 5,
      "Started Call": 8,
      "Sent WhatsApp": 4,
      "Added Site Visit": 10
    };

    const scoreBoost = actionScores[current_action] || 0;

    // ── Single-statement heartbeat ────────────────────────────────────────────
    //
    // Previously three separate query() calls, each acquiring its own pool
    // connection: session check → heartbeat UPDATE → live-state UPSERT.
    // At 30-second intervals per tab, N users × M tabs meant 3×N×M pool
    // check-outs every 30 s — the primary cause of the pool(total=10 idle=0
    // waiting=5) exhaustion observed in production.
    //
    // Now a single CTE does all three in one statement, one connection, one
    // Neon round trip. The three operations are independent writes on different
    // tables, so combining them changes no observable behaviour.
    //
    // session_check: reads is_active from today's latest employee_sessions row.
    // heartbeat_update: stamps last_heartbeat on the active session row.
    // live_state: upserts the employee_live_state snapshot.
    //
    // The RETURNING clause on live_state gives us idle_duration_seconds for the
    // alert check, and session_check gives us force_logout.
    const rows = await query<{
      force_logout: boolean;
      idle_duration_seconds: number;
    }>(`
      WITH session_check AS (
        SELECT is_active
          FROM employee_sessions
         WHERE user_id = $1
           AND organization_id = $2
           AND DATE(session_start) = CURRENT_DATE
         ORDER BY session_start DESC
         LIMIT 1
      ),
      heartbeat_update AS (
        UPDATE employee_sessions
           SET last_heartbeat = $3
         WHERE user_id = $1
           AND organization_id = $2
           AND is_active = true
           AND id = (
             SELECT id FROM employee_sessions
              WHERE user_id = $1
                AND organization_id = $2
                AND is_active = true
              ORDER BY session_start DESC
              LIMIT 1
           )
        RETURNING id
      ),
      live_state AS (
        INSERT INTO employee_live_state (
          user_id, current_module, active_lead_id, active_lead_name,
          current_action, current_route, last_activity,
          idle_duration_seconds, productivity_score, is_idle, updated_at,
          organization_id
        ) VALUES (
          $1, $4, $5, $6, $7, $8, $3,
          $9, $10, $11, $3,
          (SELECT organization_id FROM users WHERE id = $1)
        )
        ON CONFLICT (user_id) DO UPDATE SET
          current_module = EXCLUDED.current_module,
          active_lead_id = EXCLUDED.active_lead_id,
          active_lead_name = EXCLUDED.active_lead_name,
          current_action = EXCLUDED.current_action,
          current_route = EXCLUDED.current_route,
          last_activity = EXCLUDED.last_activity,
          idle_duration_seconds = CASE
            WHEN EXCLUDED.is_idle
            THEN employee_live_state.idle_duration_seconds
                 + EXTRACT(EPOCH FROM (EXCLUDED.last_activity - employee_live_state.updated_at))
            ELSE 0
          END,
          productivity_score = GREATEST(0,
            employee_live_state.productivity_score + $12
            - (CASE WHEN EXCLUDED.is_idle THEN 1 ELSE 0 END)),
          is_idle = EXCLUDED.is_idle,
          updated_at = EXCLUDED.last_activity
        RETURNING idle_duration_seconds
      )
      SELECT
        COALESCE((SELECT NOT is_active FROM session_check), false) AS force_logout,
        COALESCE((SELECT idle_duration_seconds FROM live_state), 0) AS idle_duration_seconds
    `, [
      userId,           // $1
      orgId,            // $2
      now,              // $3
      current_module,   // $4
      active_lead_id,   // $5
      active_lead_name, // $6
      current_action,   // $7
      current_route,    // $8
      0,                // $9  idle_duration_seconds (initial)
      scoreBoost,       // $10 productivity_score (initial)
      is_idle,          // $11
      scoreBoost,       // $12 productivity_score boost
    ]);

    const row = rows[0];

    if (row?.force_logout) {
      return NextResponse.json({ forceLogout: true }, { status: 401 });
    }

    const currentIdleSeconds = row?.idle_duration_seconds || 0;
    if (currentIdleSeconds > 2700) { // 45 minutes
      const alertPayload = {
        type: "SMART_ALERT",
        alertType: "EXCESSIVE_IDLE",
        userId,
        userName: auth.session.name,
        message: `${auth.session.name} has been idle for over ${Math.floor(currentIdleSeconds / 60)} minutes.`,
        timestamp: now.toISOString()
      };
      broadcastEvent(orgId, alertPayload, ["admin", "site_head"]);
      broadcastToOrg(orgId, "activity.smart_alert", alertPayload);
    }

    // Broadcast to Admins so they see the live status instantly
    const sessionPayload = {
      type: "SESSION_UPDATE",
      userId,
      current_module,
      active_lead_id,
      active_lead_name,
      current_action,
      is_idle,
      last_activity: now.toISOString()
    };
    broadcastEvent(orgId, sessionPayload, ["admin", "site_head"]);
    broadcastToOrg(orgId, "activity.session_update", sessionPayload);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
