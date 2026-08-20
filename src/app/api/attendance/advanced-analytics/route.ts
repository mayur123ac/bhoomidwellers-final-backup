import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "sales_manager", "site_head"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    // We will gather:
    // 1. KPI Cards data
    // 2. Weekly Heatmap data
    // 3. Module Usage %
    // 4. Most active employee
    
    // Every statement in this route was "global" when no userId was supplied —
    // i.e. it aggregated across the whole table. Post-MT-05, "global" means the
    // whole of THIS organization: the organization predicate is unconditional and
    // always $1, so the optional user filter can never be the only predicate.
    // It is applied before GROUP BY, so another tenant's rows cannot be folded
    // into these counts, percentages or rankings.
    const orgId = await getOrganizationId();

    // ==========================================
    // 1. Module Usage (Whole organization, or per user)
    // ==========================================
    let moduleUsageFilter = "";
    const moduleParams: any[] = [orgId];
    if (userId) {
      moduleUsageFilter = "AND user_id = $2";
      moduleParams.push(userId);
    }
    
    const moduleQuery = await query(`
      SELECT module, COUNT(*) as count 
      FROM employee_activity_logs 
      WHERE organization_id = $1 ${moduleUsageFilter}
      GROUP BY module
      ORDER BY count DESC
    `, moduleParams);

    const totalLogs = moduleQuery.reduce((sum, r) => sum + Number(r.count), 0);
    const moduleUsage = moduleQuery.map(m => ({
      module: m.module,
      count: Number(m.count),
      percentage: totalLogs > 0 ? Math.round((Number(m.count) / totalLogs) * 100) : 0
    }));

    // ==========================================
    // 2. Weekly Heatmap (Last 7 days)
    // ==========================================
    const heatmapFilter = userId ? "AND user_id = $2" : "";
    const heatmapParams = userId ? [orgId, userId] : [orgId];
    
    const heatmapQuery = await query(`
      SELECT DATE(timestamp) as day, COUNT(*) as activity_count
      FROM employee_activity_logs
      WHERE organization_id = $1 AND timestamp > NOW() - INTERVAL '7 days' ${heatmapFilter}
      GROUP BY DATE(timestamp)
      ORDER BY day ASC
    `, heatmapParams);

    const weeklyHeatmap = heatmapQuery.map(row => {
      const count = Number(row.activity_count);
      let intensity = "🔴 Low";
      if (count > 50) intensity = "🟡 Moderate";
      if (count > 150) intensity = "🔥 High";
      return {
        date: row.day,
        day: new Date(row.day).toLocaleDateString("en-IN", { weekday: 'long' }),
        count,
        intensity
      };
    });

    // ==========================================
    // 3. Top-level KPIs
    // ==========================================
    // Active time today
    const liveStateParams = userId ? [orgId, userId] : [orgId];
    const activeTimeQuery = await query(`
      SELECT SUM(session_duration_seconds) as total_duration, SUM(idle_duration_seconds) as total_idle
      FROM employee_sessions
      WHERE organization_id = $1 AND DATE(session_start) = CURRENT_DATE ${userId ? "AND user_id = $2" : ""}
    `, liveStateParams);

    const totalDuration = Number(activeTimeQuery[0]?.total_duration || 0);
    const totalIdle = Number(activeTimeQuery[0]?.total_idle || 0);
    const avgActiveTime = Math.max(0, totalDuration - totalIdle);

    // Most active employee (Only makes sense globally)
    let mostActiveEmployee = null;
    let highestIdleEmployee = null;
    
    if (!userId) {
      // Ranking employees by name: the JOIN carries its own tenant predicate so a
      // same-named user in another organization cannot be merged into one row by
      // the GROUP BY.
      const activeRankQuery = await query(`
        SELECT u.name, SUM(s.session_duration_seconds - s.idle_duration_seconds) as active_time, SUM(s.idle_duration_seconds) as idle_time
        FROM employee_sessions s
        JOIN users u ON s.user_id = u.id AND u.organization_id = s.organization_id
        WHERE s.organization_id = $1 AND DATE(s.session_start) = CURRENT_DATE
        GROUP BY u.name
        ORDER BY active_time DESC
      `, [orgId]);
      if (activeRankQuery.length > 0) {
        mostActiveEmployee = { name: activeRankQuery[0].name, time: Number(activeRankQuery[0].active_time) };
        
        // Sort by idle time to find worst
        const idleRank = [...activeRankQuery].sort((a, b) => Number(b.idle_time) - Number(a.idle_time));
        highestIdleEmployee = { name: idleRank[0].name, time: Number(idleRank[0].idle_time) };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        moduleUsage,
        weeklyHeatmap,
        kpis: {
          avgActiveTimeSeconds: avgActiveTime,
          totalIdleSeconds: totalIdle,
          mostActiveEmployee,
          highestIdleEmployee
        }
      }
    });

  } catch (error) {
    console.error("Advanced Analytics API Error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
