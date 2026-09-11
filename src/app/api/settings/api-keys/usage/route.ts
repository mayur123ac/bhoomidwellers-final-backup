import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/api-keys/usage?days=30
export async function GET(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  const url = new URL(req.url);
  const days = Math.min(Math.max(1, parseInt(url.searchParams.get("days") || "30", 10)), 365);

  try {
    const empty = {
      windowDays: days,
      totals: { requests: 0, errors: 0, avgMs: null as number | null },
      daily: [] as any[],
      endpoints: [] as any[],
      byKey: [] as any[],
    };

    let data = empty;

    try {
      const conditions = ["created_at >= NOW() - $1::int * INTERVAL '1 day'"];
      const params: any[] = [days];
      let idx = 2;

      if (orgId) {
        conditions.push(`organization_id = $${idx++}`);
        params.push(orgId);
      }

      const where = conditions.join(" AND ");

      const daily = await query<any>(
        `SELECT DATE(created_at) AS date,
                COUNT(*)::int AS requests,
                COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors,
                AVG(latency_ms)::int AS avg_latency
         FROM api_request_log
         WHERE ${where}
         GROUP BY DATE(created_at)
         ORDER BY date`,
        params
      );

      const total = daily.reduce((sum: number, r: any) => sum + r.requests, 0);
      const totalErrors = daily.reduce((sum: number, r: any) => sum + r.errors, 0);
      const avgLatency = daily.length > 0
        ? Math.round(daily.reduce((sum: number, r: any) => sum + (r.avg_latency ?? 0), 0) / daily.length)
        : null;

      data = {
        windowDays: days,
        totals: { requests: total, errors: totalErrors, avgMs: avgLatency },
        daily: daily.map((r: any) => ({
          day: r.date,
          requests: r.requests,
          errors: r.errors,
        })),
        endpoints: [],
        byKey: [],
      };
    } catch {
      // api_request_log table may not exist
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("[GET /api/settings/api-keys/usage]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
