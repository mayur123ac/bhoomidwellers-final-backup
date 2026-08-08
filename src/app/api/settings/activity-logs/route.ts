// app/api/settings/activity-logs/route.ts — the Activity Logs table and its CSV export.
//
// ── Who sees whose logs ─────────────────────────────────────────────────────
// A non-admin sees only their own rows. The `userId` query parameter is honoured
// for admins only; for everyone else it is ignored and forced to the session's
// own id, so it is not a way to read a colleague's activity by editing the URL.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { fetchActivityFeed } from "@/lib/auditLog";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAdmin(role: unknown): boolean {
  return (role ?? "").toString().trim().toLowerCase() === "admin";
}

/** RFC 4180 quoting. Without it a description containing a comma splits a column. */
function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const params = req.nextUrl.searchParams;
  const admin = isAdmin(gate.session.role);

  const requestedUserId = params.get("userId");
  let userId: number | null;

  if (admin) {
    // "all" is the admin's explicit choice to widen the view; anything else is
    // read as a specific user id, defaulting to themselves.
    userId =
      requestedUserId === "all"
        ? null
        : requestedUserId
        ? Number(requestedUserId)
        : gate.userId;
  } else {
    userId = gate.userId;
  }

  const exportCsv = params.get("format") === "csv";
  const page = Math.max(Number(params.get("page") ?? 1), 1);
  const perPage = 50;

  const { rows, total } = await fetchActivityFeed({
    userId,
    action: params.get("action"),
    from: params.get("from"),
    to: params.get("to"),
    // The export covers the whole filtered set, not just the page on screen —
    // an export that silently gave you 50 of 4,000 rows would be worse than none.
    limit: exportCsv ? 5000 : perPage,
    offset: exportCsv ? 0 : (page - 1) * perPage,
  });

  if (exportCsv) {
    const header = ["Timestamp", "User", "Action", "Details", "IP Address", "Device", "Source"];
    const body = rows.map((r) =>
      [
        r.created_at,
        r.actor_name,
        r.action,
        r.details,
        r.ip_address,
        r.user_agent,
        r.source,
      ]
        .map(csvCell)
        .join(",")
    );

    return new NextResponse([header.join(","), ...body].join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="activity-logs-${
          new Date().toISOString().slice(0, 10)
        }.csv"`,
      },
    });
  }

  // The user filter is only meaningful for an admin, and listing colleagues to
  // everyone else would leak the directory to roles that cannot see it.
  const users = admin
    ? await query<{ id: number; name: string }>(
        `SELECT id, name FROM users WHERE deleted_at IS NULL ORDER BY name`
      )
    : [];

  return NextResponse.json({
    success: true,
    canFilterByUser: admin,
    users,
    rows: rows.map((r) => ({
      id: `${r.source}-${r.id}`,
      source: r.source,
      timestamp: r.created_at,
      actor: r.actor_name,
      action: r.action,
      details: r.details,
      ipAddress: r.ip_address,
      device: r.user_agent,
    })),
    page,
    perPage,
    total,
    totalPages: Math.max(Math.ceil(total / perPage), 1),
  });
}
