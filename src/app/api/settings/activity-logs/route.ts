import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { fetchActivityFeed } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

// GET /api/settings/activity-logs — returns authenticated user's activity logs,
// or CSV export when ?format=csv is passed.
//
// User identity and tenant scope are always derived from the authenticated
// session; neither user_id nor organization_id can be supplied by the client
// to widen the query scope.
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const actionFilter = url.searchParams.get("action") || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const perPage = 50;

  try {
    const { rows, total } = await fetchActivityFeed({
      userId,
      from,
      to,
      action: actionFilter,
      limit: format === "csv" ? 10000 : perPage,
      offset: format === "csv" ? 0 : (page - 1) * perPage,
    });

    // Map ActivityRow snake_case fields to the camelCase names the UI expects.
    // audit_logs has no 'details' column — fetchActivityFeed assembles it from
    // entity_type + new_value (audit), module/description/lead_name (activity),
    // and action text (admin). See lib/auditLog.ts for the UNION query.
    const mapped = rows.map((r) => ({
      id: r.id,
      source: r.source,
      action: r.action,
      details: r.details,
      timestamp: r.created_at,
      actor: r.actor_name,
      ipAddress: r.ip_address,
      device: r.user_agent,
    }));

    if (format === "csv") {
      const header = "Date,Action,Details,IP Address\n";
      const body = mapped
        .map((r) => {
          const date = new Date(r.timestamp).toISOString();
          const action = (r.action ?? "").replace(/"/g, '""');
          const details = (r.details ?? "").replace(/"/g, '""');
          const ip = r.ipAddress ?? "";
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

    return NextResponse.json({
      success: true,
      rows: mapped,
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
