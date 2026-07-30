// api/notifications/route.ts — the notification history and readiness feed.
//
// Two jobs in one endpoint because they answer the same question at different
// times. Before go-live it answers "is this wired up correctly?" — which
// variables are missing, which template names the code expects, which Sourcing
// Managers have no WhatsApp number. After go-live it answers "did that alert
// arrive?" — status, delivery times, retry count, last error.
//
// ── Role gate ───────────────────────────────────────────────────────────────
// Admin only, via requireRole rather than the cpRbac gates. This is not partner
// data: it is a cross-manager operational feed carrying other managers' phone
// numbers, Meta diagnostics and raw error strings. Whoever can read it can see
// every notification the business has ever sent.

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/serverAuth";
import { listNotifications, readiness } from "@/services/whatsapp.service";
import { redactDeep } from "@/config/whatsapp.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if (!auth.isAuthorized) {
    return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
  }

  const sp = req.nextUrl.searchParams;
  const includePayload = sp.get("include") === "payload";

  try {
    const meta = await readiness();

    // Before the migration has been run there is nothing to list, and querying
    // would throw. Returning 200 with table_present:false is deliberate — a
    // readiness endpoint that 500s when you have not yet run the migration is
    // useless to exactly the person it exists for.
    if (!meta.table_present) {
      return NextResponse.json(
        {
          success: true,
          data: [],
          total: 0,
          meta,
          message:
            "notification_logs does not exist yet. Run: node scripts/run_sql_migration.js 2026-07-30_whatsapp_notification_logs.sql",
        },
        { status: 200 }
      );
    }

    const { rows, total } = await listNotifications({
      limit: Number(sp.get("limit")) || 50,
      offset: Number(sp.get("offset")) || 0,
      status: sp.get("status"),
      type: sp.get("type"),
      q: sp.get("q"),
      includePayload,
    });

    // Defense in depth. The payload column should never contain a credential —
    // the request body holds only recipient, template name and parameters — but
    // this is the one place its contents leave the server.
    const data = includePayload ? redactDeep(rows) : rows;

    return NextResponse.json({ success: true, data, total, meta }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/notifications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
