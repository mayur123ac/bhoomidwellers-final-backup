import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/activity-logs — returns user's activity logs, or CSV export
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const from = url.searchParams.get("from") || "1970-01-01";
  const to = url.searchParams.get("to");
  const actionFilter = url.searchParams.get("action") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const perPage = 50;

  try {
    const conditions = ["user_id = $1", "created_at >= $2::timestamptz"];
    const params: any[] = [userId, from];
    let idx = 3;

    if (to) {
      conditions.push(`created_at <= $${idx++}::timestamptz`);
      params.push(to);
    }

    if (actionFilter) {
      conditions.push(`action ILIKE $${idx++}`);
      params.push(`%${actionFilter}%`);
    }

    const where = conditions.join(" AND ");
    const limit = format === "csv" ? 10000 : perPage;
    const offset = format === "csv" ? 0 : (page - 1) * perPage;

    const rows = await query<any>(
      `SELECT id, action, details, ip_address, user_agent, created_at
       FROM audit_logs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    if (format === "csv") {
      const header = "Date,Action,Details,IP Address\n";
      const body = rows
        .map((r: any) => {
          const date = new Date(r.created_at).toISOString();
          const action = (r.action ?? "").replace(/"/g, '""');
          const details = JSON.stringify(r.details ?? {}).replace(/"/g, '""');
          const ip = r.ip_address ?? "";
          return `"${date}","${action}","${details}","${ip}"`;
        })
        .join("\n");

      return new NextResponse(header + body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="activity-logs.csv"`,
        },
      });
    }

    // Count for pagination
    const countRows = await query<any>(
      `SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}`,
      params
    );
    const total = countRows[0]?.total ?? rows.length;

    return NextResponse.json({
      success: true,
      logs: rows,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (err: any) {
    console.error("[GET /api/settings/activity-logs]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
